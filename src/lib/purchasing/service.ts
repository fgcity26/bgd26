import { randomBytes } from "node:crypto";
import {
  Prisma,
  type GoodsCondition,
  type PurchaseOrderStatus,
  type SupplierStatus,
} from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { ACCOUNTS, postJournal } from "@/lib/accounting/journal";
import { normalizeBdMobile, PhoneError } from "@/lib/crm/phone";
import { money, qty, unitCost, type Numeric } from "@/lib/inventory/decimal";
import { InventoryError, postStockMovement } from "@/lib/inventory/stock";

/**
 * Purchasing: suppliers, purchase orders and goods-received notes.
 *
 * A purchase order is a promise; only a posted GRN changes stock. Posting a GRN
 * runs in one transaction that claims the document, locks the ordered lines,
 * appends PURCHASE_RECEIPT movements (plus a damage/quarantine hold when the
 * received condition is not GOOD) and advances the PO status.
 *
 * Landed cost: the GRN line's unit cost is what enters AVCO. The receiver can
 * raise it above the ordered cost to include freight, duty or handling, which is
 * the allocation for this module.
 */

export class PurchasingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PurchasingError";
  }
}

function run<T>(
  outer: Prisma.TransactionClient | undefined,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return outer ? work(outer) : prisma.$transaction(work);
}

function code(prefix: string): string {
  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(
    now.getDate(),
  ).padStart(2, "0")}`;
  return `${prefix}-${stamp}-${randomBytes(3).toString("hex").toUpperCase()}`;
}

function text(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function positiveQty(value: Numeric, label = "Quantity"): Prisma.Decimal {
  const parsed = qty(value);
  if (!parsed.greaterThan(0)) throw new PurchasingError(`${label} must be greater than zero.`);
  return parsed;
}

function nonNegativeCost(value: Numeric, label = "Unit cost"): Prisma.Decimal {
  const parsed = unitCost(value);
  if (parsed.lessThan(0)) throw new PurchasingError(`${label} cannot be negative.`);
  return parsed;
}

function nonNegativeMoney(value: Numeric, label: string): Prisma.Decimal {
  const parsed = money(value);
  if (parsed.lessThan(0)) throw new PurchasingError(`${label} cannot be negative.`);
  return parsed;
}

function normalizedMobile(value: string | null | undefined): string | null {
  const trimmed = text(value);
  if (!trimmed) return null;
  try {
    return normalizeBdMobile(trimmed);
  } catch (error) {
    if (error instanceof PhoneError) throw new PurchasingError(error.message);
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Suppliers
// ---------------------------------------------------------------------------

export type SupplierInput = {
  code?: string | null;
  name: string;
  nameBn?: string | null;
  contactPerson?: string | null;
  mobile?: string | null;
  email?: string | null;
  address?: string | null;
  division?: string | null;
  district?: string | null;
  paymentTermsDays: number;
  leadTimeDays: number;
  isDropshipVendor: boolean;
  status: SupplierStatus;
  notes?: string | null;
};

function supplierData(input: SupplierInput) {
  const name = input.name.trim();
  if (name.length < 2) throw new PurchasingError("Enter the supplier name.");
  if (!Number.isInteger(input.paymentTermsDays) || input.paymentTermsDays < 0) {
    throw new PurchasingError("Payment terms must be a whole number of days.");
  }
  if (!Number.isInteger(input.leadTimeDays) || input.leadTimeDays < 0) {
    throw new PurchasingError("Lead time must be a whole number of days.");
  }

  return {
    code: text(input.code)?.toUpperCase() ?? code("SUP"),
    name,
    nameBn: text(input.nameBn),
    contactPerson: text(input.contactPerson),
    mobileNormalized: normalizedMobile(input.mobile),
    email: text(input.email)?.toLowerCase() ?? null,
    address: text(input.address),
    division: text(input.division),
    district: text(input.district),
    paymentTermsDays: input.paymentTermsDays,
    leadTimeDays: input.leadTimeDays,
    isDropshipVendor: input.isDropshipVendor,
    status: input.status,
    notes: text(input.notes),
  };
}

export async function createSupplier(input: SupplierInput, outer?: Prisma.TransactionClient) {
  return run(outer, (tx) =>
    tx.supplier.create({
      data: supplierData(input),
      select: { id: true, code: true, name: true },
    }),
  );
}

export async function updateSupplier(
  id: string,
  input: SupplierInput,
  outer?: Prisma.TransactionClient,
) {
  return run(outer, async (tx) => {
    const current = await tx.supplier.findUnique({
      where: { id },
      select: { id: true, code: true },
    });
    if (!current) throw new PurchasingError("That supplier no longer exists.");

    return tx.supplier.update({
      where: { id },
      data: supplierData({ ...input, code: input.code?.trim() || current.code }),
      select: { id: true, code: true, name: true },
    });
  });
}

export async function setSupplierStatus(
  id: string,
  status: SupplierStatus,
  outer?: Prisma.TransactionClient,
) {
  return run(outer, async (tx) => {
    const current = await tx.supplier.findUnique({ where: { id }, select: { id: true } });
    if (!current) throw new PurchasingError("That supplier no longer exists.");

    return tx.supplier.update({
      where: { id },
      data: { status },
      select: { id: true, status: true },
    });
  });
}

// ---------------------------------------------------------------------------
// Purchase orders
// ---------------------------------------------------------------------------

export type PurchaseLineInput = {
  variantId: string;
  quantity: Numeric;
  unitCost: Numeric;
  taxAmount?: Numeric | null;
};

export type PurchaseOrderInput = {
  supplierId: string;
  warehouseId: string;
  expectedAt?: Date | null;
  discountTotal?: Numeric | null;
  shippingTotal?: Numeric | null;
  notes?: string | null;
  lines: PurchaseLineInput[];
};

async function requireSupplier(tx: Prisma.TransactionClient, id: string) {
  const supplier = await tx.supplier.findUnique({
    where: { id },
    select: { id: true, name: true, code: true, status: true },
  });
  if (!supplier) throw new PurchasingError("That supplier no longer exists.");
  if (supplier.status !== "ACTIVE") {
    throw new PurchasingError("Choose an active supplier. Reactivate it first.");
  }
  return supplier;
}

async function requireWarehouse(tx: Prisma.TransactionClient, id: string) {
  const warehouse = await tx.warehouse.findUnique({
    where: { id },
    select: { id: true, name: true, code: true, isActive: true },
  });
  if (!warehouse) throw new PurchasingError("That warehouse no longer exists.");
  if (!warehouse.isActive) throw new PurchasingError("That warehouse is inactive.");
  return warehouse;
}

async function requireStockedVariant(tx: Prisma.TransactionClient, id: string) {
  const variant = await tx.productVariant.findUnique({
    where: { id },
    select: { id: true, sku: true, name: true, fulfillmentType: true, status: true },
  });
  if (!variant) throw new PurchasingError("That variant no longer exists.");
  if (variant.fulfillmentType !== "STOCKED") {
    throw new PurchasingError("Purchase orders can only contain stocked variants.");
  }
  return variant;
}

async function buildPurchaseLines(
  tx: Prisma.TransactionClient,
  lines: PurchaseLineInput[],
): Promise<{
  items: Array<{
    variantId: string;
    description: string;
    quantity: Prisma.Decimal;
    unitCost: Prisma.Decimal;
    taxAmount: Prisma.Decimal;
    lineTotal: Prisma.Decimal;
  }>;
  subtotal: Prisma.Decimal;
  taxTotal: Prisma.Decimal;
}> {
  if (lines.length === 0) throw new PurchasingError("Add at least one purchase line.");

  const seen = new Set<string>();
  const items: Array<{
    variantId: string;
    description: string;
    quantity: Prisma.Decimal;
    unitCost: Prisma.Decimal;
    taxAmount: Prisma.Decimal;
    lineTotal: Prisma.Decimal;
  }> = [];

  let subtotal = new Prisma.Decimal(0);
  let taxTotal = new Prisma.Decimal(0);

  for (const line of lines) {
    if (seen.has(line.variantId)) {
      throw new PurchasingError("Each variant may appear only once in a purchase order.");
    }
    seen.add(line.variantId);

    const variant = await requireStockedVariant(tx, line.variantId);
    const quantity = positiveQty(line.quantity);
    const cost = nonNegativeCost(line.unitCost);
    const tax = line.taxAmount ? nonNegativeMoney(line.taxAmount, "Tax") : money(0);
    const lineTotal = money(quantity.mul(cost));

    subtotal = subtotal.add(lineTotal);
    taxTotal = taxTotal.add(tax);
    items.push({
      variantId: variant.id,
      description: `${variant.sku} · ${variant.name}`,
      quantity,
      unitCost: cost,
      taxAmount: tax,
      lineTotal,
    });
  }

  return { items, subtotal: money(subtotal), taxTotal: money(taxTotal) };
}

function totals(
  subtotal: Prisma.Decimal,
  taxTotal: Prisma.Decimal,
  discount: Prisma.Decimal,
  shipping: Prisma.Decimal,
) {
  const grandTotal = money(subtotal.sub(discount).add(taxTotal).add(shipping));
  if (grandTotal.lessThan(0)) {
    throw new PurchasingError("The discount cannot be larger than the order total.");
  }
  return { subtotal, taxTotal, discountTotal: discount, shippingTotal: shipping, grandTotal };
}

export async function createPurchaseOrder(
  input: PurchaseOrderInput,
  outer?: Prisma.TransactionClient,
) {
  return run(outer, async (tx) => {
    const supplier = await requireSupplier(tx, input.supplierId);
    const warehouse = await requireWarehouse(tx, input.warehouseId);
    const built = await buildPurchaseLines(tx, input.lines);
    const discount = input.discountTotal
      ? nonNegativeMoney(input.discountTotal, "Discount")
      : money(0);
    const shipping = input.shippingTotal
      ? nonNegativeMoney(input.shippingTotal, "Shipping")
      : money(0);
    const sums = totals(built.subtotal, built.taxTotal, discount, shipping);

    return tx.purchaseOrder.create({
      data: {
        poNumber: code("PO"),
        supplierId: supplier.id,
        warehouseId: warehouse.id,
        poType: "STANDARD",
        status: "DRAFT",
        notes: text(input.notes),
        expectedAt: input.expectedAt ?? null,
        ...sums,
        items: { create: built.items },
      },
      select: { id: true, poNumber: true },
    });
  });
}

export async function updatePurchaseOrder(
  id: string,
  input: PurchaseOrderInput,
  outer?: Prisma.TransactionClient,
) {
  return run(outer, async (tx) => {
    const current = await tx.purchaseOrder.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        _count: { select: { grns: { where: { status: { not: "CANCELLED" } } } } },
      },
    });
    if (!current) throw new PurchasingError("That purchase order no longer exists.");
    if (current.status !== "DRAFT") {
      throw new PurchasingError("Only a draft purchase order can be edited.");
    }
    if (current._count.grns > 0) {
      throw new PurchasingError("Cancel the draft goods receipt before editing this order.");
    }

    const supplier = await requireSupplier(tx, input.supplierId);
    const warehouse = await requireWarehouse(tx, input.warehouseId);
    const built = await buildPurchaseLines(tx, input.lines);
    const discount = input.discountTotal
      ? nonNegativeMoney(input.discountTotal, "Discount")
      : money(0);
    const shipping = input.shippingTotal
      ? nonNegativeMoney(input.shippingTotal, "Shipping")
      : money(0);
    const sums = totals(built.subtotal, built.taxTotal, discount, shipping);

    await tx.purchaseItem.deleteMany({ where: { purchaseOrderId: id } });

    return tx.purchaseOrder.update({
      where: { id },
      data: {
        supplierId: supplier.id,
        warehouseId: warehouse.id,
        notes: text(input.notes),
        expectedAt: input.expectedAt ?? null,
        ...sums,
        items: { create: built.items },
      },
      select: { id: true, poNumber: true },
    });
  });
}

export async function sendPurchaseOrder(
  id: string,
  actorUserId: string,
  outer?: Prisma.TransactionClient,
) {
  return run(outer, async (tx) => {
    const order = await tx.purchaseOrder.findUnique({
      where: { id },
      select: { id: true, status: true, warehouseId: true, items: { select: { id: true } } },
    });
    if (!order) throw new PurchasingError("That purchase order no longer exists.");
    if (!order.warehouseId) {
      throw new PurchasingError("Choose a warehouse before sending the order.");
    }
    if (order.items.length === 0) {
      throw new PurchasingError("Add at least one line before sending the order.");
    }

    const claimed = await tx.purchaseOrder.updateMany({
      where: { id, status: "DRAFT" },
      data: { status: "SENT", sentAt: new Date(), approvedByUserId: actorUserId },
    });
    if (claimed.count === 0) throw new PurchasingError("Only a draft order can be sent.");

    return { id };
  });
}

export async function cancelPurchaseOrder(
  id: string,
  actorUserId: string,
  outer?: Prisma.TransactionClient,
) {
  return run(outer, async (tx) => {
    const order = await tx.purchaseOrder.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        items: { select: { receivedQty: true } },
        _count: { select: { grns: { where: { status: { not: "CANCELLED" } } } } },
      },
    });
    if (!order) throw new PurchasingError("That purchase order no longer exists.");
    if (!["DRAFT", "SENT"].includes(order.status)) {
      throw new PurchasingError("Only a draft or sent order can be cancelled.");
    }
    if (order.items.some((item) => item.receivedQty.greaterThan(0))) {
      throw new PurchasingError("Stock has already been received against this order.");
    }
    if (order._count.grns > 0) {
      throw new PurchasingError("Cancel the draft goods receipt first, then cancel the order.");
    }

    const claimed = await tx.purchaseOrder.updateMany({
      where: { id, status: { in: ["DRAFT", "SENT"] } },
      data: { status: "CANCELLED", closedAt: new Date(), approvedByUserId: actorUserId },
    });
    if (claimed.count === 0) {
      throw new PurchasingError("The order changed while cancelling. Reload and try again.");
    }

    return { id };
  });
}

export async function closePurchaseOrder(
  id: string,
  actorUserId: string,
  outer?: Prisma.TransactionClient,
) {
  return run(outer, async (tx) => {
    const claimed = await tx.purchaseOrder.updateMany({
      where: { id, status: { in: ["SENT", "PARTIALLY_RECEIVED", "RECEIVED"] } },
      data: { status: "CLOSED", closedAt: new Date(), approvedByUserId: actorUserId },
    });
    if (claimed.count === 0) {
      throw new PurchasingError(
        "Only a sent, partially received or received order can be closed.",
      );
    }
    return { id };
  });
}

// ---------------------------------------------------------------------------
// Goods-received notes
// ---------------------------------------------------------------------------

export type GrnLineInput = {
  purchaseItemId: string;
  quantity: Numeric;
  unitCost?: Numeric | null;
  condition: GoodsCondition;
  batchNumber?: string | null;
  expiryDate?: Date | null;
};

export type CreateGrnInput = {
  purchaseOrderId: string;
  warehouseId?: string | null;
  notes?: string | null;
  lines: GrnLineInput[];
};

async function draftCommitted(
  tx: Prisma.TransactionClient,
  purchaseOrderId: string,
): Promise<Map<string, Prisma.Decimal>> {
  const rows = await tx.goodsReceivedItem.findMany({
    where: {
      grn: { purchaseOrderId, status: "DRAFT" },
      purchaseItemId: { not: null },
    },
    select: { purchaseItemId: true, quantityReceived: true },
  });

  const map = new Map<string, Prisma.Decimal>();
  for (const row of rows) {
    if (!row.purchaseItemId) continue;
    const current = map.get(row.purchaseItemId) ?? new Prisma.Decimal(0);
    map.set(row.purchaseItemId, current.add(row.quantityReceived));
  }
  return map;
}

export async function createGrn(input: CreateGrnInput, outer?: Prisma.TransactionClient) {
  const lines = input.lines.filter((line) => qty(line.quantity).greaterThan(0));
  if (lines.length === 0) throw new PurchasingError("Enter a received quantity on at least one line.");

  return run(outer, async (tx) => {
    const order = await tx.purchaseOrder.findUnique({
      where: { id: input.purchaseOrderId },
      include: {
        supplier: { select: { id: true, name: true } },
        items: true,
      },
    });
    if (!order) throw new PurchasingError("That purchase order no longer exists.");
    if (!["SENT", "PARTIALLY_RECEIVED"].includes(order.status)) {
      throw new PurchasingError("Only a sent or partially received order can be received.");
    }

    const warehouseId = input.warehouseId?.trim() || order.warehouseId;
    if (!warehouseId) throw new PurchasingError("Choose the warehouse receiving the goods.");
    const warehouse = await requireWarehouse(tx, warehouseId);

    const committed = await draftCommitted(tx, order.id);
    const seen = new Set<string>();
    const items: Array<{
      purchaseItemId: string;
      variantId: string;
      quantityReceived: Prisma.Decimal;
      unitCost: Prisma.Decimal;
      totalCost: Prisma.Decimal;
      condition: GoodsCondition;
      batchNumber: string | null;
      expiryDate: Date | null;
    }> = [];

    let totalValue = new Prisma.Decimal(0);

    for (const line of lines) {
      if (seen.has(line.purchaseItemId)) {
        throw new PurchasingError("Each ordered line may be received only once per GRN.");
      }
      seen.add(line.purchaseItemId);

      const ordered = order.items.find((item) => item.id === line.purchaseItemId);
      if (!ordered) throw new PurchasingError("That line does not belong to this purchase order.");
      if (!ordered.variantId) {
        throw new PurchasingError("A purchase line without a variant cannot be received into stock.");
      }

      const received = positiveQty(line.quantity, "Received quantity");
      const already = ordered.receivedQty.add(committed.get(ordered.id) ?? 0);
      const outstanding = ordered.quantity.sub(already);
      if (received.greaterThan(outstanding)) {
        throw new PurchasingError(
          `Only ${outstanding.toString()} unit(s) remain outstanding on ${ordered.description}.`,
        );
      }

      const cost = nonNegativeCost(line.unitCost ?? ordered.unitCost);
      const lineTotal = money(received.mul(cost));
      totalValue = totalValue.add(lineTotal);

      items.push({
        purchaseItemId: ordered.id,
        variantId: ordered.variantId,
        quantityReceived: received,
        unitCost: cost,
        totalCost: lineTotal,
        condition: line.condition,
        batchNumber: text(line.batchNumber),
        expiryDate: line.expiryDate ?? null,
      });
    }

    return tx.goodsReceivedNote.create({
      data: {
        grnNumber: code("GRN"),
        purchaseOrderId: order.id,
        warehouseId: warehouse.id,
        supplierId: order.supplierId,
        status: "DRAFT",
        notes: text(input.notes),
        totalValue: money(totalValue),
        receivedAt: new Date(),
        items: { create: items },
      },
      select: { id: true, grnNumber: true },
    });
  });
}

export async function postGrn(
  id: string,
  actorUserId: string,
  outer?: Prisma.TransactionClient,
) {
  return run(outer, async (tx) => {
    const claimed = await tx.goodsReceivedNote.updateMany({
      where: { id, status: "DRAFT" },
      data: { status: "POSTED", postedAt: new Date(), receivedByUserId: actorUserId },
    });
    if (claimed.count === 0) {
      throw new PurchasingError("Only a draft goods receipt can be posted.");
    }

    const grn = await tx.goodsReceivedNote.findUnique({
      where: { id },
      include: {
        items: true,
        purchaseOrder: {
          select: {
            id: true,
            poNumber: true,
            items: { select: { id: true, description: true, quantity: true, receivedQty: true } },
          },
        },
        supplier: { select: { name: true } },
        warehouse: { select: { name: true } },
      },
    });
    if (!grn) throw new PurchasingError("That goods receipt no longer exists.");

    // Serialise receipts against the same order so two receivers cannot both
    // consume the last outstanding unit.
    await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "purchase_items"
      WHERE "purchaseOrderId" = ${grn.purchaseOrderId}
      FOR UPDATE
    `;

    const fresh = await tx.purchaseItem.findMany({
      where: { purchaseOrderId: grn.purchaseOrderId },
      select: { id: true, description: true, quantity: true, receivedQty: true },
    });
    const byId = new Map(fresh.map((item) => [item.id, item]));

    let totalValue = new Prisma.Decimal(0);

    for (const item of grn.items) {
      if (!item.purchaseItemId) {
        throw new PurchasingError("A receipt line is not linked to an ordered line.");
      }
      const ordered = byId.get(item.purchaseItemId);
      if (!ordered) throw new PurchasingError("That ordered line no longer exists.");

      const outstanding = ordered.quantity.sub(ordered.receivedQty);
      if (item.quantityReceived.greaterThan(outstanding)) {
        throw new PurchasingError(
          `Only ${outstanding.toString()} unit(s) remain outstanding on ${ordered.description}.`,
        );
      }

      const conditionNote =
        item.condition === "GOOD"
          ? "good condition"
          : item.condition === "DAMAGED"
            ? "damaged on arrival"
            : "held in quarantine";

      await postStockMovement(tx, {
        variantId: item.variantId,
        warehouseId: grn.warehouseId,
        movementType: "PURCHASE_RECEIPT",
        quantity: item.quantityReceived,
        unitCost: item.unitCost,
        referenceType: "goods_received_note",
        referenceId: grn.id,
        note: `${grn.grnNumber} from ${grn.supplier.name} · ${conditionNote}`,
        actorUserId,
      });

      if (item.condition !== "GOOD") {
        await postStockMovement(tx, {
          variantId: item.variantId,
          warehouseId: grn.warehouseId,
          movementType: item.condition === "DAMAGED" ? "DAMAGE" : "QUARANTINE",
          quantity: item.quantityReceived,
          referenceType: "goods_received_note",
          referenceId: grn.id,
          note: `${grn.grnNumber} received ${conditionNote}`,
          actorUserId,
        });
      }

      await tx.purchaseItem.update({
        where: { id: ordered.id },
        data: { receivedQty: ordered.receivedQty.add(item.quantityReceived) },
      });
      byId.set(ordered.id, {
        ...ordered,
        receivedQty: ordered.receivedQty.add(item.quantityReceived),
      });

      totalValue = totalValue.add(item.totalCost);
    }

    const nextStatus: PurchaseOrderStatus = [...byId.values()].every((item) =>
      item.receivedQty.greaterThanOrEqualTo(item.quantity),
    )
      ? "RECEIVED"
      : "PARTIALLY_RECEIVED";

    await tx.purchaseOrder.update({
      where: { id: grn.purchaseOrderId },
      data: { status: nextStatus },
    });

    await tx.goodsReceivedNote.update({
      where: { id: grn.id },
      data: { totalValue: money(totalValue) },
    });

    // The receipt raises inventory and owes the supplier. Damaged and
    // quarantined units are still owned stock, so the full landed value enters
    // inventory; the condition hold only removes them from sellable quantity.
    const journal = await postJournal(tx, {
      description: `${grn.grnNumber} · ${grn.supplier.name}`,
      source: "PURCHASE",
      referenceType: "goods_received_note",
      referenceId: grn.id,
      actorUserId,
      lines: [
        { account: ACCOUNTS.inventory, debit: money(totalValue) },
        { account: ACCOUNTS.payable, credit: money(totalValue), supplierId: grn.supplierId },
      ],
    });
    if (journal) {
      await tx.goodsReceivedNote.update({
        where: { id: grn.id },
        data: { journalEntryId: journal.id },
      });
    }

    return { id: grn.id, grnNumber: grn.grnNumber, status: nextStatus };
  });
}

export async function cancelGrn(id: string, outer?: Prisma.TransactionClient) {
  return run(outer, async (tx) => {
    const claimed = await tx.goodsReceivedNote.updateMany({
      where: { id, status: "DRAFT" },
      data: { status: "CANCELLED" },
    });
    if (claimed.count === 0) {
      throw new PurchasingError(
        "Only a draft goods receipt can be cancelled. A posted receipt is corrected with a purchase return.",
      );
    }
    return { id };
  });
}

/** Exposed for the receive form: what is still outstanding per ordered line. */
export async function outstandingLines(
  purchaseOrderId: string,
  outer?: Prisma.TransactionClient,
): Promise<
  Array<{
    id: string;
    description: string;
    variantId: string | null;
    quantity: Prisma.Decimal;
    receivedQty: Prisma.Decimal;
    unitCost: Prisma.Decimal;
    outstanding: Prisma.Decimal;
  }>
> {
  return run(outer, async (tx) => {
    const order = await tx.purchaseOrder.findUnique({
      where: { id: purchaseOrderId },
      select: {
        items: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            description: true,
            variantId: true,
            quantity: true,
            receivedQty: true,
            unitCost: true,
          },
        },
      },
    });
    if (!order) throw new PurchasingError("That purchase order no longer exists.");

    const committed = await draftCommitted(tx, purchaseOrderId);

    return order.items.map((item) => {
      const reserved = committed.get(item.id) ?? new Prisma.Decimal(0);
      return {
        ...item,
        outstanding: item.quantity.sub(item.receivedQty).sub(reserved),
      };
    });
  });
}

/** Re-export so actions can explain stock refusals without a second import. */
export { InventoryError };
