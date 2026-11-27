import {
  Prisma,
  type CourierProvider,
  type ShipmentStatus,
} from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { queueOrderNotification } from "@/lib/whatsapp/service";
import { ACCOUNTS, postJournal } from "@/lib/accounting/journal";
import { getCourierAdapter } from "@/lib/adapters/couriers/registry";
import { CourierError } from "@/lib/adapters/couriers/types";
import { money, type Numeric } from "@/lib/inventory/decimal";
import { documentNumber } from "@/lib/inventory/stock";
import { canTransition, setOrderStatus } from "@/lib/orders/service";

/**
 * Shipping: couriers, consignments, tracking and cash-on-delivery remittance.
 *
 * The shipment is the physical hand-over of an order. Booking does not move the
 * order: it stays `READY_TO_SHIP` until a pickup or transit event proves the
 * parcel left. A delivery event moves it to `DELIVERED`, where the existing
 * refund and completion rules take over.
 *
 * COD money is not recognised here. The courier collects cash, the payment
 * stays `PENDING_VERIFICATION` (debit 1060 Courier COD Clearing on verification),
 * and a remittance entry moves the cleared balance to cash or bank when the
 * courier actually pays the shop.
 */

export class ShippingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShippingError";
  }
}

function run<T>(
  outer: Prisma.TransactionClient | undefined,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return outer ? work(outer) : prisma.$transaction(work);
}

function explain(error: unknown): never {
  if (error instanceof ShippingError) throw error;
  if (error instanceof CourierError) throw new ShippingError(error.message);
  throw error;
}

const LIVE_SHIPMENT_STATUSES: ShipmentStatus[] = [
  "PENDING",
  "BOOKED",
  "PICKED_UP",
  "IN_TRANSIT",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
];

const TERMINAL_SHIPMENT_STATUSES: ShipmentStatus[] = ["CANCELLED", "RETURNED", "FAILED"];

export const SHIPMENT_STATUS_LABELS: Record<ShipmentStatus, string> = {
  PENDING: "Pending booking",
  BOOKED: "Booked",
  PICKED_UP: "Picked up",
  IN_TRANSIT: "In transit",
  OUT_FOR_DELIVERY: "Out for delivery",
  DELIVERED: "Delivered",
  RETURNED: "Returned",
  CANCELLED: "Cancelled",
  FAILED: "Failed",
};

function addressPart(address: Prisma.JsonValue | null, key: string): string {
  if (!address || typeof address !== "object" || Array.isArray(address)) return "";
  const value = (address as Record<string, unknown>)[key];
  return typeof value === "string" ? value : "";
}

function addressLine(address: Prisma.JsonValue | null): string {
  return [
    addressPart(address, "address"),
    addressPart(address, "upazila"),
    addressPart(address, "district"),
    addressPart(address, "division"),
  ]
    .filter((part) => part.trim().length > 0)
    .join(", ");
}

function expectedFrom(zone: { estimatedDaysMax: number } | null): Date {
  const days = Math.max(1, zone?.estimatedDaysMax ?? 3);
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

/* -------------------------------------------------------------------------- */
/* Couriers                                                                   */
/* -------------------------------------------------------------------------- */

export type CourierInput = {
  code: string;
  name: string;
  provider: CourierProvider;
  apiBaseUrl?: string | null;
  credentialEnvPrefix?: string | null;
  supportsCod: boolean;
  supportsDropship: boolean;
  isActive: boolean;
};

function clean(value: string | null | undefined, max: number): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function courierData(input: CourierInput) {
  return {
    code: input.code.trim().toUpperCase(),
    name: input.name.trim(),
    provider: input.provider,
    apiBaseUrl: clean(input.apiBaseUrl, 300),
    credentialEnvPrefix: clean(input.credentialEnvPrefix, 60),
    supportsCod: input.supportsCod,
    supportsDropship: input.supportsDropship,
    isActive: input.isActive,
  };
}

export async function createCourier(input: CourierInput, outer?: Prisma.TransactionClient) {
  return run(outer, async (tx) => {
    const code = input.code.trim().toUpperCase();
    if (!/^[A-Z0-9-]{2,30}$/.test(code)) {
      throw new ShippingError("Use 2–30 letters, numbers or hyphens for the courier code.");
    }
    if (input.name.trim().length < 2) {
      throw new ShippingError("Enter the courier name.");
    }
    const existing = await tx.courier.findUnique({ where: { code }, select: { id: true } });
    if (existing) throw new ShippingError("A courier with that code already exists.");
    return tx.courier.create({ data: courierData(input), select: { id: true, code: true } });
  });
}

export async function updateCourier(
  id: string,
  input: CourierInput,
  outer?: Prisma.TransactionClient,
) {
  return run(outer, async (tx) => {
    const current = await tx.courier.findUnique({
      where: { id },
      select: { id: true, code: true },
    });
    if (!current) throw new ShippingError("That courier no longer exists.");
    const code = input.code.trim().toUpperCase();
    if (code !== current.code) {
      const clash = await tx.courier.findUnique({ where: { code }, select: { id: true } });
      if (clash) throw new ShippingError("A courier with that code already exists.");
    }
    return tx.courier.update({
      where: { id },
      data: courierData({ ...input, code }),
      select: { id: true, code: true },
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Shipments                                                                  */
/* -------------------------------------------------------------------------- */

export type CreateShipmentInput = {
  orderId: string;
  courierId?: string | null;
  trackingNumber?: string | null;
  note?: string | null;
  expectedAt?: Date | null;
  actorUserId: string;
};

export async function createShipment(
  input: CreateShipmentInput,
  outer?: Prisma.TransactionClient,
) {
  try {
    return await run(outer, async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: input.orderId },
        select: {
          id: true,
          orderNumber: true,
          status: true,
          warehouseId: true,
          recipientName: true,
          recipientMobile: true,
          shippingAddress: true,
          deliveryCharge: true,
          dueAmount: true,
          deliveryZone: {
            select: { name: true, estimatedDaysMin: true, estimatedDaysMax: true },
          },
          payments: { select: { method: true, status: true } },
          shipments: {
            where: { status: { notIn: TERMINAL_SHIPMENT_STATUSES } },
            select: { id: true, shipmentNumber: true },
          },
        },
      });
      if (!order) throw new ShippingError("That order no longer exists.");
      if (order.status !== "READY_TO_SHIP") {
        throw new ShippingError(
          "Move the order to ready to ship before booking a courier.",
        );
      }
      if (order.shipments.length > 0) {
        throw new ShippingError(
          `Order ${order.orderNumber} already has shipment ${order.shipments[0]?.shipmentNumber}.`,
        );
      }

      const courier = input.courierId
        ? await tx.courier.findUnique({
            where: { id: input.courierId },
            select: {
              id: true,
              name: true,
              provider: true,
              supportsCod: true,
              isActive: true,
            },
          })
        : null;
      if (input.courierId && (!courier || !courier.isActive)) {
        throw new ShippingError("Choose an active courier.");
      }

      const hasPendingCod = order.payments.some(
        (payment) => payment.method === "COD" && payment.status === "PENDING_VERIFICATION",
      );
      const codAmount = hasPendingCod ? money(order.dueAmount) : money(0);
      if (codAmount.greaterThan(0) && courier && !courier.supportsCod) {
        throw new ShippingError(`${courier.name} does not collect cash on delivery.`);
      }

      const adapter = getCourierAdapter(courier?.provider ?? "MANUAL");
      const shipmentNumber = documentNumber("SHP");
      const booking = await adapter.book({
        shipmentNumber,
        orderNumber: order.orderNumber,
        recipientName: order.recipientName,
        recipientMobile: order.recipientMobile,
        address: addressLine(order.shippingAddress),
        district: addressPart(order.shippingAddress, "district"),
        division: addressPart(order.shippingAddress, "division"),
        codAmount: codAmount.toFixed(2),
        deliveryCharge: money(order.deliveryCharge).toFixed(2),
        trackingNumber: input.trackingNumber,
        note: input.note,
      });

      const shipment = await tx.shipment.create({
        data: {
          shipmentNumber,
          orderId: order.id,
          courierId: courier?.id ?? null,
          warehouseId: order.warehouseId,
          shipmentType: "OUTBOUND",
          status: booking.status,
          trackingNumber: booking.trackingNumber,
          consignmentId: booking.consignmentId,
          recipientName: order.recipientName,
          recipientMobile: order.recipientMobile,
          deliveryAddress: order.shippingAddress ?? undefined,
          codAmount,
          deliveryCharge: money(order.deliveryCharge),
          expectedAt: input.expectedAt ?? expectedFrom(order.deliveryZone),
          labelUrl: booking.labelUrl,
          createdByUserId: input.actorUserId,
        },
        select: { id: true, shipmentNumber: true, status: true },
      });

      await tx.shipmentTrackingEvent.create({
        data: {
          shipmentId: shipment.id,
          status: booking.status,
          message:
            clean(input.note, 300) ??
            (booking.trackingNumber
              ? `Booked with ${courier?.name ?? "manual delivery"} · ${booking.trackingNumber}`
              : `Booked with ${courier?.name ?? "manual delivery"}`),
          location: order.deliveryZone?.name ?? null,
          eventAt: new Date(),
        },
      });

      return shipment;
    });
  } catch (error) {
    return explain(error);
  }
}

export type TrackingEventInput = {
  shipmentId: string;
  status: ShipmentStatus;
  message?: string | null;
  location?: string | null;
  eventAt?: Date | null;
  actorUserId: string;
};

/**
 * Append a tracking event and keep the order status in step.
 *
 * The event table is append-only history; the shipment row carries the latest
 * status for fast lists. A pickup or transit event moves a ready order to
 * `SHIPPED`; a delivery moves it to `DELIVERED`. A courier return or failure
 * leaves the order alone on purpose — the refund/return document decides what
 * happens to stock and money.
 */
export async function addTrackingEvent(
  input: TrackingEventInput,
  outer?: Prisma.TransactionClient,
) {
  try {
    const result = await run(outer, async (tx) => {
      const shipment = await tx.shipment.findUnique({
        where: { id: input.shipmentId },
        select: {
          id: true,
          shipmentNumber: true,
          status: true,
          shippedAt: true,
          deliveredAt: true,
          order: { select: { id: true, orderNumber: true, status: true } },
        },
      });
      if (!shipment) throw new ShippingError("That shipment no longer exists.");
      if (TERMINAL_SHIPMENT_STATUSES.includes(shipment.status)) {
        throw new ShippingError("This shipment is closed; no further events can be added.");
      }
      if (input.status === "DELIVERED" && shipment.status === "DELIVERED") {
        throw new ShippingError("This shipment is already delivered.");
      }

      const eventAt = input.eventAt ?? new Date();
      if (eventAt.getTime() > Date.now() + 5 * 60 * 1000) {
        throw new ShippingError("The event time cannot be in the future.");
      }

      const isPickup =
        input.status === "PICKED_UP" ||
        input.status === "IN_TRANSIT" ||
        input.status === "OUT_FOR_DELIVERY";
      const shippedAt =
        shipment.shippedAt ?? (isPickup || input.status === "DELIVERED" ? eventAt : null);
      const deliveredAt =
        input.status === "DELIVERED" ? eventAt : shipment.deliveredAt;

      await tx.shipmentTrackingEvent.create({
        data: {
          shipmentId: shipment.id,
          status: input.status,
          message: clean(input.message, 300),
          location: clean(input.location, 120),
          eventAt,
        },
      });

      await tx.shipment.update({
        where: { id: shipment.id },
        data: {
          status: input.status,
          shippedAt,
          deliveredAt,
        },
      });

      // Order status follows proof of movement, not the booking click.
      if (isPickup && shipment.order.status === "READY_TO_SHIP") {
        await setOrderStatus(
          shipment.order.id,
          "SHIPPED",
          input.actorUserId,
          `Shipment ${shipment.shipmentNumber} · ${SHIPMENT_STATUS_LABELS[input.status]}`,
          tx,
        );
      }
      if (input.status === "DELIVERED" && canTransition(shipment.order.status, "DELIVERED")) {
        await setOrderStatus(
          shipment.order.id,
          "DELIVERED",
          input.actorUserId,
          `Shipment ${shipment.shipmentNumber} delivered`,
          tx,
        );
      }

      return { id: shipment.id, orderId: shipment.order.id, status: input.status };
    });

    // Proof of movement is the moment the customer cares about. Queue after
    // commit; the event dedupe key keeps pickup + delivery to one message.
    if (
      !outer &&
      (input.status === "PICKED_UP" ||
        input.status === "IN_TRANSIT" ||
        input.status === "OUT_FOR_DELIVERY" ||
        input.status === "DELIVERED")
    ) {
      try {
        await queueOrderNotification({
          event: "ORDER_SHIPPED",
          orderId: result.orderId,
          actorUserId: input.actorUserId,
        });
      } catch (error) {
        console.error("[whatsapp] shipment notification failed", result.orderId, error);
      }
    }
    return result;
  } catch (error) {
    return explain(error);
  }
}

export async function cancelShipment(
  shipmentId: string,
  actorUserId: string,
  reason: string,
  outer?: Prisma.TransactionClient,
) {
  try {
    return await run(outer, async (tx) => {
      const shipment = await tx.shipment.findUnique({
        where: { id: shipmentId },
        select: {
          id: true,
          shipmentNumber: true,
          status: true,
          trackingNumber: true,
          courier: { select: { provider: true } },
        },
      });
      if (!shipment) throw new ShippingError("That shipment no longer exists.");
      if (!["PENDING", "BOOKED"].includes(shipment.status)) {
        throw new ShippingError(
          "Only a shipment that has not been picked up can be cancelled.",
        );
      }

      await getCourierAdapter(shipment.courier?.provider ?? "MANUAL").cancel(
        shipment.trackingNumber,
      );

      await tx.shipment.update({
        where: { id: shipment.id },
        data: { status: "CANCELLED" },
      });
      await tx.shipmentTrackingEvent.create({
        data: {
          shipmentId: shipment.id,
          status: "CANCELLED",
          message: reason.trim() || "Shipment cancelled",
          eventAt: new Date(),
        },
      });

      return { id: shipment.id, status: "CANCELLED" as const };
    });
  } catch (error) {
    return explain(error);
  }
}

/* -------------------------------------------------------------------------- */
/* COD remittance                                                             */
/* -------------------------------------------------------------------------- */

export type CodRemittanceInput = {
  courierId: string;
  amount: Numeric;
  destination: "CASH" | "BANK";
  reference?: string | null;
  receivedAt?: Date | null;
  note?: string | null;
  actorUserId: string;
};

/**
 * Move cleared COD money from the courier to the shop's cash or bank account.
 *
 * Verifying a COD payment debits 1060 Courier COD Clearing; this entry clears
 * it. The reference ties the journal back to the courier's payout advice.
 */
export async function postCodRemittance(
  input: CodRemittanceInput,
  outer?: Prisma.TransactionClient,
) {
  try {
    return await run(outer, async (tx) => {
      const courier = await tx.courier.findUnique({
        where: { id: input.courierId },
        select: { id: true, name: true, supportsCod: true, isActive: true },
      });
      if (!courier || !courier.isActive) throw new ShippingError("Choose an active courier.");
      if (!courier.supportsCod) {
        throw new ShippingError(`${courier.name} does not collect cash on delivery.`);
      }

      const amount = money(input.amount);
      if (!amount.greaterThan(0)) {
        throw new ShippingError("Enter the amount the courier paid.");
      }

      const reference = clean(input.reference, 120);
      const receivedAt = input.receivedAt ?? new Date();
      if (receivedAt.getTime() > Date.now() + 5 * 60 * 1000) {
        throw new ShippingError("The received date cannot be in the future.");
      }

      const entry = await postJournal(tx, {
        description:
          `COD remittance · ${courier.name}` +
          (reference ? ` · ${reference}` : "") +
          (clean(input.note, 200) ? ` · ${clean(input.note, 200)}` : ""),
        source: "MANUAL",
        referenceType: "cod_remittance",
        referenceId: documentNumber("COD"),
        entryDate: receivedAt,
        actorUserId: input.actorUserId,
        lines: [
          {
            account:
              input.destination === "CASH" ? ACCOUNTS.cash : ACCOUNTS.bank,
            debit: amount,
            description: `COD collected by ${courier.name}`,
          },
          {
            account: ACCOUNTS.codClearing,
            credit: amount,
            description: `COD cleared by ${courier.name}`,
          },
        ],
      });

      return { journalEntryId: entry?.id ?? null, amount };
    });
  } catch (error) {
    return explain(error);
  }
}

/* -------------------------------------------------------------------------- */
/* Read helpers                                                               */
/* -------------------------------------------------------------------------- */

export async function shippableOrders() {
  return prisma.order.findMany({
    where: {
      status: "READY_TO_SHIP",
      shipments: { none: { status: { notIn: TERMINAL_SHIPMENT_STATUSES } } },
    },
    orderBy: { placedAt: "asc" },
    select: {
      id: true,
      orderNumber: true,
      recipientName: true,
      recipientMobile: true,
      grandTotal: true,
      dueAmount: true,
      paymentStatus: true,
      placedAt: true,
      deliveryZone: { select: { name: true } },
    },
  });
}

export { LIVE_SHIPMENT_STATUSES, TERMINAL_SHIPMENT_STATUSES };
