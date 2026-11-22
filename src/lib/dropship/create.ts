import type { Prisma } from "@/generated/prisma/client";
import { money, qty, unitCost } from "@/lib/inventory/decimal";
import { documentNumber } from "@/lib/inventory/stock";

/**
 * Dropship purchase orders, created from a sale.
 *
 * A dropship variant is never stocked: when it is sold, the supplier must be
 * told what to ship and to whom. This module turns the dropship lines of one
 * order into supplier purchase orders, grouped by supplier, at the variant's
 * dropship cost (falling back to its recorded cost price).
 *
 * It lives apart from `lib/dropship/service.ts` so the sale engine can import it
 * without a cycle: the service drives those orders, the sale creates them.
 *
 * The purchase order is the payable. It is never received into stock, so no GRN
 * is posted; the supplier's cost is recognised when the parcel ships.
 */

export class DropshipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DropshipError";
  }
}

export type DropshipOrderCreated = {
  id: string;
  poNumber: string;
  supplierId: string;
  grandTotal: Prisma.Decimal;
};

type DropshipLine = {
  id: string;
  variantId: string | null;
  dropshipSupplierId: string | null;
  quantity: Prisma.Decimal;
  costPriceSnapshot: Prisma.Decimal;
  productNameSnapshot: string;
  variantNameSnapshot: string | null;
  skuSnapshot: string;
  variant: {
    dropshipCost: Prisma.Decimal | null;
    dropshipSupplierSku: string | null;
  } | null;
};

/**
 * Create one dropship purchase order per supplier for the dropship lines of an
 * order. Safe to call twice: a supplier that already has an order for this sale
 * is skipped. Must run inside the caller's transaction.
 */
export async function createDropshipOrdersForOrder(
  tx: Prisma.TransactionClient,
  orderId: string,
): Promise<DropshipOrderCreated[]> {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      orderNumber: true,
      items: {
        where: { fulfillmentType: "DROPSHIP" },
        select: {
          id: true,
          variantId: true,
          dropshipSupplierId: true,
          quantity: true,
          costPriceSnapshot: true,
          productNameSnapshot: true,
          variantNameSnapshot: true,
          skuSnapshot: true,
          variant: {
            select: { dropshipCost: true, dropshipSupplierSku: true },
          },
        },
      },
    },
  });
  if (!order || order.items.length === 0) return [];

  const groups = new Map<string, DropshipLine[]>();
  for (const item of order.items) {
    if (!item.dropshipSupplierId) {
      throw new DropshipError(
        `“${item.skuSnapshot}” is a dropship item but has no supplier. Set one on the variant first.`,
      );
    }
    const bucket = groups.get(item.dropshipSupplierId);
    if (bucket) bucket.push(item);
    else groups.set(item.dropshipSupplierId, [item]);
  }

  const existing = await tx.purchaseOrder.findMany({
    where: { orderId, poType: "DROPSHIP" },
    select: { supplierId: true },
  });
  const alreadyOrdered = new Set(existing.map((row) => row.supplierId));

  const created: DropshipOrderCreated[] = [];

  for (const [supplierId, items] of groups) {
    if (alreadyOrdered.has(supplierId)) continue;

    const lines = items.map((item) => {
      const cost = unitCost(item.variant?.dropshipCost ?? item.costPriceSnapshot);
      const quantity = qty(item.quantity);
      const supplierSku = item.variant?.dropshipSupplierSku?.trim();
      return {
        variantId: item.variantId,
        orderItemId: item.id,
        description: [
          item.productNameSnapshot,
          item.variantNameSnapshot,
          `(${item.skuSnapshot}${supplierSku ? ` / supplier ${supplierSku}` : ""})`,
        ]
          .filter(Boolean)
          .join(" · "),
        quantity,
        unitCost: cost,
        lineTotal: money(cost.mul(quantity)),
      };
    });

    const subtotal = lines.reduce((sum, line) => sum.add(line.lineTotal), money(0));

    const purchaseOrder = await tx.purchaseOrder.create({
      data: {
        poNumber: documentNumber("DPO"),
        supplierId,
        // Dropship orders are never received into a warehouse.
        warehouseId: null,
        orderId: order.id,
        poType: "DROPSHIP",
        status: "DRAFT",
        subtotal,
        grandTotal: subtotal,
        notes: `Dropship for ${order.orderNumber}. The supplier ships straight to the customer.`,
        items: { create: lines },
      },
      select: { id: true, poNumber: true, supplierId: true, grandTotal: true },
    });

    created.push(purchaseOrder);
  }

  return created;
}
