"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { audit } from "@/lib/auth/audit";
import { requestMeta } from "@/lib/auth/request-meta";
import { requirePermission } from "@/lib/auth/session";
import {
  approveRefund,
  cancelOrder,
  closeShift,
  completeRefund,
  createSale,
  openShift,
  OrdersError,
  recordCashMovement,
  registerPosDevice,
  rejectPayment,
  requestRefund,
  setOrderStatus,
  verifyPayment,
} from "@/lib/orders/service";

/**
 * Order, payment, refund and POS actions.
 *
 * Each action validates with zod, re-checks a permission on the server, calls
 * one domain function, writes an audit row and revalidates. Nothing here
 * computes money: the service re-prices every sale from the catalogue.
 */
export type OrderFormState = {
  error?: string;
  success?: string;
};

export type PosSaleState = {
  error?: string;
  sale?: {
    orderId: string;
    orderNumber: string;
    grandTotal: string;
    paidAmount: string;
    dueAmount: string;
    duplicate: boolean;
    approvalDeferred: boolean;
  };
  /** Set when the sale could not reach the server; the client queues it. */
  offline?: boolean;
};

const optionalText = (max: number) => z.string().trim().max(max).optional().nullable();

const decimal = (places: number) =>
  z
    .string()
    .trim()
    .regex(
      new RegExp(`^\\d{1,11}(\\.\\d{1,${places}})?$`),
      `Use a number with up to ${places} decimal places.`,
    );

const PAYMENT_METHODS = [
  "CASH",
  "BKASH",
  "NAGAD",
  "CARD",
  "BANK_TRANSFER",
  "COD",
  "CHEQUE",
  "GATEWAY",
] as const;

const saleSchema = z.object({
  source: z.enum(["POS_ONLINE", "POS_OFFLINE"]),
  deviceId: z.string().trim().min(1, "Choose a POS device."),
  shiftId: optionalText(40),
  customerMobile: optionalText(30),
  customerName: optionalText(120),
  lines: z
    .array(
      z.object({
        variantId: z.string().trim().min(1),
        quantity: decimal(3),
      }),
    )
    .min(1, "Add at least one item."),
  discountTotal: z.union([z.literal(""), decimal(2)]).optional(),
  loyaltyRedeemPoints: z.number().int().min(0).max(1_000_000).optional(),
  payments: z
    .array(
      z.object({
        method: z.enum(PAYMENT_METHODS),
        amount: decimal(2),
        reference: optionalText(120),
      }),
    )
    .min(1, "Add at least one payment."),
  managerPin: optionalText(12),
  note: optionalText(500),
  clientTransactionUuid: z.string().trim().min(8).max(80),
  offlineCreatedAt: optionalText(40),
});

const orderStatusSchema = z.object({
  id: z.string().trim().min(1),
  status: z.enum([
    "PENDING_PAYMENT",
    "CONFIRMED",
    "PROCESSING",
    "READY_TO_SHIP",
    "SHIPPED",
    "DELIVERED",
    "COMPLETED",
    "ON_HOLD",
  ]),
  note: optionalText(300),
});

const cancelSchema = z.object({
  id: z.string().trim().min(1),
  reason: z.string().trim().min(3, "Give a reason for cancelling.").max(300),
});

const refundSchema = z.object({
  orderId: z.string().trim().min(1),
  reason: z.string().trim().min(3, "Give a reason for the refund.").max(300),
  method: z.enum(PAYMENT_METHODS),
  paymentId: optionalText(40),
  notes: optionalText(500),
  orderItemId: z.array(z.string().trim().min(1)).min(1, "Choose at least one item."),
  quantity: z.array(decimal(3)),
  restock: z.array(z.string()).optional(),
});

const paymentSchema = z.object({
  id: z.string().trim().min(1),
  reference: optionalText(120),
  note: optionalText(300),
});

const rejectSchema = z.object({
  id: z.string().trim().min(1),
  reason: z.string().trim().min(3, "Give a reason for rejecting.").max(300),
});

const deviceSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2, "Enter a short device code.")
    .max(20)
    .regex(/^[A-Za-z0-9-]+$/, "Use letters, numbers and hyphens only."),
  name: z.string().trim().min(2, "Enter the device name.").max(120),
  storeId: z.string().trim().min(1, "Choose a store."),
  warehouseId: z.string().trim().min(1, "Choose a warehouse."),
  deviceFingerprint: z.string().trim().min(4, "Enter a device fingerprint.").max(120),
  platform: optionalText(60),
});

const shiftSchema = z.object({
  deviceId: z.string().trim().min(1),
  openingFloat: decimal(2),
  notes: optionalText(300),
});

const closeShiftSchema = z.object({
  shiftId: z.string().trim().min(1),
  countedCash: decimal(2),
  notes: optionalText(300),
});

const cashMovementSchema = z.object({
  shiftId: z.string().trim().min(1),
  type: z.enum(["CASH_IN", "CASH_OUT", "CASH_DROP"]),
  amount: decimal(2),
  reason: z.string().trim().min(3, "Give a reason.").max(300),
});

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Check the highlighted fields.";
}

function explain(error: unknown): string {
  if (error instanceof OrdersError) return error.message;
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") return "That document number or fingerprint is already in use.";
    if (error.code === "P2025") return "That record no longer exists.";
  }
  return error instanceof Error ? error.message : "Could not complete that action.";
}

function readSale(formData: FormData) {
  const raw = text(formData, "payload");
  let payload: unknown;
  try {
    payload = JSON.parse(raw || "{}");
  } catch {
    throw new OrdersError("The sale data could not be read. Reload the till and try again.");
  }
  const parsed = saleSchema.safeParse(payload);
  if (!parsed.success) throw new OrdersError(firstIssue(parsed.error));
  return parsed.data;
}

/**
 * Checkout for the POS terminal. The client sends one JSON payload so a queued
 * offline sale can be replayed with exactly the same bytes.
 */
export async function createSaleAction(
  _previous: PosSaleState,
  formData: FormData,
): Promise<PosSaleState> {
  const session = await requirePermission("pos.write");

  try {
    const input = readSale(formData);
    const sale = await createSale({
      source: input.source,
      deviceId: input.deviceId,
      shiftId: input.shiftId || null,
      customerMobile: input.customerMobile || null,
      customerName: input.customerName || null,
      lines: input.lines,
      discountTotal: input.discountTotal || 0,
      loyaltyRedeemPoints: input.loyaltyRedeemPoints ?? 0,
      payments: input.payments.map((payment) => ({
        method: payment.method,
        amount: payment.amount,
        reference: payment.reference || null,
      })),
      managerPin: input.managerPin || null,
      note: input.note || null,
      clientTransactionUuid: input.clientTransactionUuid,
      offlineCreatedAt: input.offlineCreatedAt ? new Date(input.offlineCreatedAt) : null,
      actorUserId: session.user.id,
    });

    const meta = await requestMeta();
    await audit({
      actorUserId: session.user.id,
      action: "order.created",
      entityType: "order",
      entityId: sale.orderId,
      metadata: {
        document: sale.orderNumber,
        source: input.source,
        grandTotal: sale.grandTotal.toString(),
        duplicate: sale.duplicate,
        approvalDeferred: sale.approvalDeferred,
      },
      ...meta,
    });
    if (sale.approvalDeferred) {
      await audit({
        actorUserId: session.user.id,
        action: "order.offline.approval_required",
        entityType: "order",
        entityId: sale.orderId,
        reason: "Walk-in or discount above 5 % accepted offline without a manager PIN.",
        metadata: { document: sale.orderNumber },
        ...meta,
      });
    }

    revalidatePath("/pos");
    revalidatePath("/orders");
    revalidatePath("/payments");

    return {
      sale: {
        orderId: sale.orderId,
        orderNumber: sale.orderNumber,
        grandTotal: sale.grandTotal.toString(),
        paidAmount: sale.paidAmount.toString(),
        dueAmount: sale.dueAmount.toString(),
        duplicate: sale.duplicate,
        approvalDeferred: sale.approvalDeferred,
      },
    };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientInitializationError) {
      return { offline: true, error: "The server is unreachable; the sale was queued." };
    }
    return { error: explain(error) };
  }
}

export async function setOrderStatusAction(formData: FormData): Promise<void> {
  const session = await requirePermission("order.write");
  const parsed = orderStatusSchema.safeParse({
    id: text(formData, "id"),
    status: text(formData, "status"),
    note: text(formData, "note"),
  });
  if (!parsed.success) {
    redirect(`/orders/${text(formData, "id")}?error=${encodeURIComponent(firstIssue(parsed.error))}`);
  }

  try {
    await setOrderStatus(parsed.data.id, parsed.data.status, session.user.id, parsed.data.note);
    const meta = await requestMeta();
    await audit({
      actorUserId: session.user.id,
      action: "order.status.changed",
      entityType: "order",
      entityId: parsed.data.id,
      metadata: { status: parsed.data.status },
      ...meta,
    });
  } catch (error) {
    redirect(`/orders/${parsed.data.id}?error=${encodeURIComponent(explain(error))}`);
  }

  revalidatePath("/orders");
  revalidatePath(`/orders/${parsed.data.id}`);
  redirect(`/orders/${parsed.data.id}?ok=1`);
}

export async function cancelOrderAction(formData: FormData): Promise<void> {
  const session = await requirePermission("order.approve");
  const parsed = cancelSchema.safeParse({
    id: text(formData, "id"),
    reason: text(formData, "reason"),
  });
  if (!parsed.success) {
    redirect(`/orders/${text(formData, "id")}?error=${encodeURIComponent(firstIssue(parsed.error))}`);
  }

  try {
    await cancelOrder(parsed.data.id, session.user.id, parsed.data.reason);
    const meta = await requestMeta();
    await audit({
      actorUserId: session.user.id,
      action: "order.cancelled",
      entityType: "order",
      entityId: parsed.data.id,
      reason: parsed.data.reason,
      ...meta,
    });
  } catch (error) {
    redirect(`/orders/${parsed.data.id}?error=${encodeURIComponent(explain(error))}`);
  }

  revalidatePath("/orders");
  revalidatePath(`/orders/${parsed.data.id}`);
  redirect(`/orders/${parsed.data.id}?ok=1`);
}

export async function requestRefundAction(formData: FormData): Promise<void> {
  const session = await requirePermission("refund.write");
  const parsed = refundSchema.safeParse({
    orderId: text(formData, "orderId"),
    reason: text(formData, "reason"),
    method: text(formData, "method") || "CASH",
    paymentId: text(formData, "paymentId"),
    notes: text(formData, "notes"),
    orderItemId: formData.getAll("orderItemId").map(String),
    quantity: formData.getAll("quantity").map(String),
    restock: formData.getAll("restock").map(String),
  });
  if (!parsed.success) {
    redirect(
      `/orders/${text(formData, "orderId")}?error=${encodeURIComponent(firstIssue(parsed.error))}`,
    );
  }

  const restockIds = new Set(parsed.data.restock ?? []);
  const lines = parsed.data.orderItemId
    .map((orderItemId, index) => ({
      orderItemId,
      quantity: parsed.data.quantity[index] ?? "",
      restock: restockIds.has(orderItemId),
    }))
    .filter((line) => Number(line.quantity) > 0);

  if (lines.length === 0) {
    redirect(
      `/orders/${parsed.data.orderId}?error=${encodeURIComponent("Enter a refund quantity.")}`,
    );
  }

  let refundId = "";
  try {
    const refund = await requestRefund({
      orderId: parsed.data.orderId,
      lines,
      reason: parsed.data.reason,
      method: parsed.data.method,
      paymentId: parsed.data.paymentId || null,
      notes: parsed.data.notes || null,
      actorUserId: session.user.id,
    });
    refundId = refund.refundId;
    const meta = await requestMeta();
    await audit({
      actorUserId: session.user.id,
      action: "refund.requested",
      entityType: "refund",
      entityId: refund.refundId,
      metadata: { document: refund.refundNumber, total: refund.totalAmount.toString() },
      ...meta,
    });
  } catch (error) {
    redirect(
      `/orders/${parsed.data.orderId}?error=${encodeURIComponent(explain(error))}`,
    );
  }

  revalidatePath("/refunds");
  revalidatePath(`/orders/${parsed.data.orderId}`);
  redirect(`/refunds?highlight=${refundId}`);
}

export async function approveRefundAction(formData: FormData): Promise<void> {
  const session = await requirePermission("refund.approve");
  const id = text(formData, "id");
  try {
    await approveRefund(id, session.user.id);
    const meta = await requestMeta();
    await audit({
      actorUserId: session.user.id,
      action: "refund.approved",
      entityType: "refund",
      entityId: id,
      ...meta,
    });
  } catch (error) {
    redirect(`/refunds?error=${encodeURIComponent(explain(error))}`);
  }
  revalidatePath("/refunds");
  redirect("/refunds?ok=1");
}

export async function completeRefundAction(formData: FormData): Promise<void> {
  const session = await requirePermission("refund.approve");
  const id = text(formData, "id");
  try {
    await completeRefund(id, session.user.id);
    const meta = await requestMeta();
    await audit({
      actorUserId: session.user.id,
      action: "refund.completed",
      entityType: "refund",
      entityId: id,
      ...meta,
    });
  } catch (error) {
    redirect(`/refunds?error=${encodeURIComponent(explain(error))}`);
  }
  revalidatePath("/refunds");
  redirect("/refunds?ok=1");
}

export async function verifyPaymentAction(formData: FormData): Promise<void> {
  const session = await requirePermission("payment.approve");
  const parsed = paymentSchema.safeParse({
    id: text(formData, "id"),
    reference: text(formData, "reference"),
    note: text(formData, "note"),
  });
  if (!parsed.success) {
    redirect(`/payments?error=${encodeURIComponent(firstIssue(parsed.error))}`);
  }

  try {
    await verifyPayment(parsed.data.id, session.user.id, {
      reference: parsed.data.reference,
      note: parsed.data.note,
    });
    const meta = await requestMeta();
    await audit({
      actorUserId: session.user.id,
      action: "payment.verified",
      entityType: "payment",
      entityId: parsed.data.id,
      ...meta,
    });
  } catch (error) {
    redirect(`/payments?error=${encodeURIComponent(explain(error))}`);
  }
  revalidatePath("/payments");
  revalidatePath("/orders");
  redirect("/payments?ok=1");
}

export async function rejectPaymentAction(formData: FormData): Promise<void> {
  const session = await requirePermission("payment.approve");
  const parsed = rejectSchema.safeParse({
    id: text(formData, "id"),
    reason: text(formData, "reason"),
  });
  if (!parsed.success) {
    redirect(`/payments?error=${encodeURIComponent(firstIssue(parsed.error))}`);
  }

  try {
    await rejectPayment(parsed.data.id, session.user.id, parsed.data.reason);
    const meta = await requestMeta();
    await audit({
      actorUserId: session.user.id,
      action: "payment.rejected",
      entityType: "payment",
      entityId: parsed.data.id,
      reason: parsed.data.reason,
      ...meta,
    });
  } catch (error) {
    redirect(`/payments?error=${encodeURIComponent(explain(error))}`);
  }
  revalidatePath("/payments");
  revalidatePath("/orders");
  redirect("/payments?ok=1");
}

export async function registerDeviceAction(
  _previous: OrderFormState,
  formData: FormData,
): Promise<OrderFormState> {
  const session = await requirePermission("pos.approve");
  const parsed = deviceSchema.safeParse({
    code: text(formData, "code"),
    name: text(formData, "name"),
    storeId: text(formData, "storeId"),
    warehouseId: text(formData, "warehouseId"),
    deviceFingerprint: text(formData, "deviceFingerprint"),
    platform: text(formData, "platform"),
  });
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  try {
    const device = await registerPosDevice(parsed.data, session.user.id);
    const meta = await requestMeta();
    await audit({
      actorUserId: session.user.id,
      action: "pos.device.registered",
      entityType: "pos_device",
      entityId: device.id,
      metadata: { code: device.code },
      ...meta,
    });
    revalidatePath("/pos/devices");
    return { success: `Device ${device.code} registered.` };
  } catch (error) {
    return { error: explain(error) };
  }
}

export async function openShiftAction(
  _previous: OrderFormState,
  formData: FormData,
): Promise<OrderFormState> {
  const session = await requirePermission("pos.write");
  const parsed = shiftSchema.safeParse({
    deviceId: text(formData, "deviceId"),
    openingFloat: text(formData, "openingFloat") || "0",
    notes: text(formData, "notes"),
  });
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  try {
    const shift = await openShift(parsed.data, session.user.id);
    const meta = await requestMeta();
    await audit({
      actorUserId: session.user.id,
      action: "pos.shift.opened",
      entityType: "pos_shift",
      entityId: shift.id,
      metadata: { document: shift.shiftNumber, openingFloat: parsed.data.openingFloat },
      ...meta,
    });
    revalidatePath("/pos");
    revalidatePath("/pos/shifts");
    return { success: `Shift ${shift.shiftNumber} opened.` };
  } catch (error) {
    return { error: explain(error) };
  }
}

export async function closeShiftAction(
  _previous: OrderFormState,
  formData: FormData,
): Promise<OrderFormState> {
  const session = await requirePermission("pos.write");
  const parsed = closeShiftSchema.safeParse({
    shiftId: text(formData, "shiftId"),
    countedCash: text(formData, "countedCash") || "0",
    notes: text(formData, "notes"),
  });
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  try {
    const result = await closeShift(parsed.data, session.user.id);
    const meta = await requestMeta();
    await audit({
      actorUserId: session.user.id,
      action: "pos.shift.closed",
      entityType: "pos_shift",
      entityId: parsed.data.shiftId,
      metadata: {
        expected: result.expectedCash.toString(),
        counted: result.countedCash.toString(),
        variance: result.variance.toString(),
      },
      ...meta,
    });
    revalidatePath("/pos");
    revalidatePath("/pos/shifts");
    return { success: `Shift closed. Variance ৳${result.variance.toFixed(2)}.` };
  } catch (error) {
    return { error: explain(error) };
  }
}

export async function cashMovementAction(
  _previous: OrderFormState,
  formData: FormData,
): Promise<OrderFormState> {
  const session = await requirePermission("pos.write");
  const parsed = cashMovementSchema.safeParse({
    shiftId: text(formData, "shiftId"),
    type: text(formData, "type"),
    amount: text(formData, "amount"),
    reason: text(formData, "reason"),
  });
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  try {
    await recordCashMovement(parsed.data, session.user.id);
    const meta = await requestMeta();
    await audit({
      actorUserId: session.user.id,
      action: "pos.cash.movement",
      entityType: "pos_shift",
      entityId: parsed.data.shiftId,
      metadata: { type: parsed.data.type, amount: parsed.data.amount },
      ...meta,
    });
    revalidatePath("/pos/shifts");
    return { success: "Cash movement recorded." };
  } catch (error) {
    return { error: explain(error) };
  }
}
