import { Prisma, type PaymentMethod } from "@/generated/prisma/client";
import { ACCOUNTS, postJournal } from "@/lib/accounting/journal";
import { prisma } from "@/lib/db";
import { money } from "@/lib/inventory/decimal";
import { documentNumber } from "@/lib/inventory/stock";
import { canTransition, setOrderStatus } from "@/lib/orders/service";

/**
 * Dropship order lifecycle.
 *
 * The sale creates one purchase order per supplier (see `./create.ts`). This
 * module moves that order through the supplier's own states and keeps the
 * customer order, the shipment and the books in step:
 *
 *   DRAFT → SENT → CONFIRMED → SHIPPED → DELIVERED
 *
 * Nothing is received into stock. When the supplier ships, the cost becomes
 * cost of goods sold (DR 5010 / CR 1300) and the supplier's payable appears in
 * the existing settlement statement. Shipping is refused while the customer
 * still owes money, because the supplier must not extend credit to us.
 */

export class DropshipServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DropshipServiceError";
  }
}

function run<T>(
  outer: Prisma.TransactionClient | undefined,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return outer ? work(outer) : prisma.$transaction(work);
}

export const DROPSHIP_STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  SENT: "Sent to supplier",
  CONFIRMED: "Supplier confirmed",
  SHIPPED: "Shipped by supplier",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
};

/** The next steps the console offers for a dropship order. */
export const DROPSHIP_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ["SENT", "CANCELLED"],
  SENT: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["SHIPPED", "CANCELLED"],
  SHIPPED: ["DELIVERED"],
  DELIVERED: [],
  CANCELLED: [],
};

export const DROPSHIP_OPEN_STATUSES = ["DRAFT", "SENT", "CONFIRMED"] as const;

type Tx = Prisma.TransactionClient;

/**
 * Whether every live supplier order on a sale has reached a milestone.
 *
 * A sale split across two suppliers travels as two parcels, so the sale is only
 * shipped when both have shipped and only delivered when both have arrived.
 * Cancelled supplier orders drop out of the gate: they no longer promise
 * anything, so they must not hold the sale open.
 */
async function supplierGate(
  tx: Tx,
  orderId: string,
  currentId: string,
  currentStatus: string,
) {
  const others = await tx.purchaseOrder.findMany({
    where: { orderId, poType: "DROPSHIP", id: { not: currentId } },
    select: { status: true },
  });
  const live = [currentStatus, ...others.map((po) => po.status)].filter(
    (status) => status !== "CANCELLED",
  );
  return {
    allShipped: live.every((status) => status === "SHIPPED" || status === "DELIVERED"),
    allDelivered: live.every((status) => status === "DELIVERED"),
  };
}

async function requireDropshipOrder(tx: Tx, id: string) {
  const order = await tx.purchaseOrder.findUnique({
    where: { id },
    select: {
      id: true,
      poNumber: true,
      poType: true,
      status: true,
      supplierId: true,
      orderId: true,
      grandTotal: true,
      notes: true,
      order: {
        select: {
          id: true,
          orderNumber: true,
          status: true,
          paymentStatus: true,
          dueAmount: true,
          recipientName: true,
          recipientMobile: true,
          shippingAddress: true,
          warehouseId: true,
        },
      },
      items: {
        select: {
          id: true,
          description: true,
          quantity: true,
          unitCost: true,
          lineTotal: true,
        },
      },
    },
  });
  if (!order) throw new DropshipServiceError("That dropship order no longer exists.");
  if (order.poType !== "DROPSHIP") {
    throw new DropshipServiceError("That purchase order is not a dropship order.");
  }
  return order;
}

/** Mark the supplier order as sent. Only a draft can be sent. */
export async function sendDropshipOrder(
  id: string,
  actorUserId: string,
  outer?: Prisma.TransactionClient,
) {
  return run(outer, async (tx) => {
    const order = await requireDropshipOrder(tx, id);
    if (order.status !== "DRAFT") {
      throw new DropshipServiceError("Only a draft dropship order can be sent.");
    }
    await tx.purchaseOrder.update({
      where: { id: order.id },
      data: { status: "SENT", sentAt: new Date(), approvedByUserId: actorUserId },
    });
    return { id: order.id, status: "SENT" as const };
  });
}

/** The supplier accepted the order and will ship it. */
export async function confirmDropshipOrder(
  id: string,
  actorUserId: string,
  note?: string | null,
  outer?: Prisma.TransactionClient,
) {
  return run(outer, async (tx) => {
    const order = await requireDropshipOrder(tx, id);
    if (order.status !== "SENT") {
      throw new DropshipServiceError("Only a sent dropship order can be confirmed.");
    }
    const confirmation = note?.trim();
    await tx.purchaseOrder.update({
      where: { id: order.id },
      data: {
        status: "CONFIRMED",
        confirmedAt: new Date(),
        approvedByUserId: actorUserId,
        notes: confirmation
          ? [order.notes, `Supplier confirmation: ${confirmation}`].filter(Boolean).join("\n")
          : order.notes,
      },
    });
    return { id: order.id, status: "CONFIRMED" as const };
  });
}

export type ShipDropshipInput = {
  trackingNumber?: string | null;
  courierId?: string | null;
  note?: string | null;
};

/**
 * The supplier has handed the parcel to its courier.
 *
 * The customer must owe nothing: a cash-on-delivery order has to be collected
 * before this point. Shipping recognises the supplier cost once (idempotent on
 * the journal reference), creates a direct shipment with no warehouse and moves
 * the customer order to shipped.
 */
export async function shipDropshipOrder(
  id: string,
  actorUserId: string,
  input: ShipDropshipInput = {},
  outer?: Prisma.TransactionClient,
) {
  return run(outer, async (tx) => {
    const order = await requireDropshipOrder(tx, id);
    if (!order.order) throw new DropshipServiceError("That dropship order has no customer order.");
    if (order.status !== "CONFIRMED") {
      throw new DropshipServiceError("Confirm the supplier order before shipping it.");
    }
    if (money(order.order.dueAmount).greaterThan(0)) {
      throw new DropshipServiceError(
        `Collect the ৳${money(order.order.dueAmount).toFixed(2)} still due before the supplier ships. Dropship is prepaid only.`,
      );
    }

    const courierId = input.courierId?.trim() || null;
    if (courierId) {
      const courier = await tx.courier.findUnique({
        where: { id: courierId },
        select: { id: true, isActive: true },
      });
      if (!courier || !courier.isActive) {
        throw new DropshipServiceError("Choose an active courier.");
      }
    }

    const existingShipment = await tx.shipment.findFirst({
      where: {
        orderId: order.order.id,
        supplierId: order.supplierId,
        shipmentType: "DROPSHIP_DIRECT",
        status: { notIn: ["CANCELLED", "FAILED"] },
      },
      select: { id: true, shipmentNumber: true },
    });
    if (existingShipment) {
      throw new DropshipServiceError(
        `Shipment ${existingShipment.shipmentNumber} already exists for this supplier.`,
      );
    }

    // The sale keeps moving while any supplier order is still open. The first
    // supplier to ship makes the sale ready; the sale itself only ships once
    // every live supplier order has.
    if (
      order.order.status !== "READY_TO_SHIP" &&
      order.order.status !== "SHIPPED" &&
      order.order.status !== "DELIVERED"
    ) {
      if (!canTransition(order.order.status, "READY_TO_SHIP")) {
        throw new DropshipServiceError(
          `Order ${order.order.orderNumber} is ${order.order.status.replaceAll("_", " ").toLowerCase()} and cannot ship.`,
        );
      }
      await setOrderStatus(
        order.order.id,
        "READY_TO_SHIP",
        actorUserId,
        `Dropship ${order.poNumber} ready`,
        tx,
      );
    }

    // Recognise the supplier cost exactly once.
    const value = order.items.reduce(
      (sum, item) => sum.add(money(item.lineTotal)),
      money(0),
    );
    if (value.greaterThan(0)) {
      const posted = await tx.journalEntry.findFirst({
        where: {
          referenceType: "purchase_order",
          referenceId: order.id,
          source: "DROPSHIP_COGS",
          status: "POSTED",
        },
        select: { id: true },
      });
      if (!posted) {
        await postJournal(tx, {
          description: `${order.poNumber} · dropship cost of goods sold`,
          source: "DROPSHIP_COGS",
          referenceType: "purchase_order",
          referenceId: order.id,
          actorUserId,
          lines: [
            { account: ACCOUNTS.dropshipCogs, debit: value },
            { account: ACCOUNTS.payable, credit: value, supplierId: order.supplierId },
          ],
        });
      }
    }

    const trackingNumber = input.trackingNumber?.trim() || null;
    const shipmentNumber = documentNumber("SHP");
    const shipment = await tx.shipment.create({
      data: {
        shipmentNumber,
        orderId: order.order.id,
        courierId,
        // No warehouse: the supplier ships from its own premises.
        warehouseId: null,
        supplierId: order.supplierId,
        shipmentType: "DROPSHIP_DIRECT",
        status: "PICKED_UP",
        trackingNumber,
        recipientName: order.order.recipientName,
        recipientMobile: order.order.recipientMobile,
        deliveryAddress: order.order.shippingAddress ?? undefined,
        codAmount: money(0),
        deliveryCharge: money(0),
        shippedAt: new Date(),
        createdByUserId: actorUserId,
      },
      select: { id: true, shipmentNumber: true },
    });

    await tx.shipmentTrackingEvent.create({
      data: {
        shipmentId: shipment.id,
        status: "PICKED_UP",
        message:
          input.note?.trim() ||
          `Supplier dispatched directly${trackingNumber ? ` · ${trackingNumber}` : ""}`,
        eventAt: new Date(),
      },
    });

    await tx.purchaseOrder.update({
      where: { id: order.id },
      data: { status: "SHIPPED", shippedAt: new Date() },
    });

    // Only close the sale once every live supplier order has shipped.
    const gate = await supplierGate(tx, order.order.id, order.id, "SHIPPED");
    if (gate.allShipped) {
      const current = await tx.order.findUniqueOrThrow({
        where: { id: order.order.id },
        select: { status: true },
      });
      if (current.status !== "SHIPPED" && current.status !== "DELIVERED") {
        await setOrderStatus(
          order.order.id,
          "SHIPPED",
          actorUserId,
          `All supplier orders shipped · ${order.poNumber} last`,
          tx,
        );
      }
    }

    return { id: order.id, status: "SHIPPED" as const, shipmentNumber: shipment.shipmentNumber };
  });
}

/** The customer received the parcel; the shipment and the order close. */
export async function deliverDropshipOrder(
  id: string,
  actorUserId: string,
  note?: string | null,
  outer?: Prisma.TransactionClient,
) {
  return run(outer, async (tx) => {
    const order = await requireDropshipOrder(tx, id);
    if (!order.order) throw new DropshipServiceError("That dropship order has no customer order.");
    if (order.status !== "SHIPPED") {
      throw new DropshipServiceError("Only a shipped dropship order can be delivered.");
    }

    const shipment = await tx.shipment.findFirst({
      where: {
        orderId: order.order.id,
        supplierId: order.supplierId,
        shipmentType: "DROPSHIP_DIRECT",
        status: { notIn: ["CANCELLED", "FAILED", "DELIVERED"] },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (shipment) {
      // Close the parcel directly. `addTrackingEvent` also moves the sale, which
      // is wrong here: another supplier's parcel may still be in transit.
      const now = new Date();
      await tx.shipmentTrackingEvent.create({
        data: {
          shipmentId: shipment.id,
          status: "DELIVERED",
          message: note?.trim() || `Dropship ${order.poNumber} delivered`,
          eventAt: now,
        },
      });
      await tx.shipment.update({
        where: { id: shipment.id },
        data: { status: "DELIVERED", deliveredAt: now },
      });
    }

    await tx.purchaseOrder.update({
      where: { id: order.id },
      data: { status: "DELIVERED", deliveredAt: new Date() },
    });

    // The sale closes only when every live supplier order has arrived.
    const gate = await supplierGate(tx, order.order.id, order.id, "DELIVERED");
    const current = await tx.order.findUniqueOrThrow({
      where: { id: order.order.id },
      select: { status: true },
    });
    if (gate.allDelivered) {
      if (current.status === "READY_TO_SHIP") {
        await setOrderStatus(
          order.order.id,
          "SHIPPED",
          actorUserId,
          `All supplier orders shipped · ${order.poNumber} last`,
          tx,
        );
      }
      const afterShip = await tx.order.findUniqueOrThrow({
        where: { id: order.order.id },
        select: { status: true },
      });
      if (canTransition(afterShip.status, "DELIVERED")) {
        await setOrderStatus(
          order.order.id,
          "DELIVERED",
          actorUserId,
          `All supplier orders delivered · ${order.poNumber} last`,
          tx,
        );
      }
      await tx.order.update({
        where: { id: order.order.id },
        data: { fulfillmentStatus: "FULFILLED" },
      });
    }

    return { id: order.id, status: "DELIVERED" as const };
  });
}

/** Cancel a supplier order before it ships. After that, a return is the path. */
export async function cancelDropshipOrder(
  id: string,
  actorUserId: string,
  reason: string,
  outer?: Prisma.TransactionClient,
) {
  return run(outer, async (tx) => {
    const order = await requireDropshipOrder(tx, id);
    if (!(DROPSHIP_OPEN_STATUSES as readonly string[]).includes(order.status)) {
      throw new DropshipServiceError(
        "A dropship order can only be cancelled before the supplier ships it.",
      );
    }
    await tx.purchaseOrder.update({
      where: { id: order.id },
      data: {
        status: "CANCELLED",
        cancelReason: reason.trim() || "Cancelled before shipment",
        closedAt: new Date(),
        approvedByUserId: actorUserId,
      },
    });
    return { id: order.id, status: "CANCELLED" as const };
  });
}

/** The payment methods that can settle a dropship supplier. */
export const DROPSHIP_PAYMENT_METHODS = [
  "CASH",
  "BKASH",
  "NAGAD",
  "BANK_TRANSFER",
  "CHEQUE",
  "CARD",
] as const satisfies readonly PaymentMethod[];
