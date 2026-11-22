"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { audit } from "@/lib/auth/audit";
import { requestMeta } from "@/lib/auth/request-meta";
import { requirePermission } from "@/lib/auth/session";
import {
  addTrackingEvent,
  cancelShipment,
  createCourier,
  createShipment,
  postCodRemittance,
  ShippingError,
  updateCourier,
} from "@/lib/shipping/service";

/**
 * Shipping actions: validate, authorise, call one service, audit, revalidate.
 *
 * Booking a courier and recording events needs `shipment.write`. Cancelling a
 * booked consignment and clearing COD money needs `shipment.approve`, because
 * both undo or recognise money and a physical commitment.
 */
export type ShippingFormState = {
  error?: string;
  success?: string;
};

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function checked(formData: FormData, key: string): boolean {
  const value = formData.get(key);
  return value === "on" || value === "true" || value === "1";
}

function explain(error: unknown): string {
  if (error instanceof ShippingError) return error.message;
  if (error instanceof z.ZodError) {
    return error.issues[0]?.message ?? "Check the form and try again.";
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") return "That code or number is already in use.";
    if (error.code === "P2025") return "That record no longer exists.";
  }
  return error instanceof Error ? error.message : "Could not save the shipping change.";
}

const PROVIDERS = ["MANUAL", "PATHAO", "STEADFAST", "REDX", "DROPSHIP_SUPPLIER"] as const;

const courierSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2, "Enter a courier code.")
    .max(30)
    .regex(/^[A-Za-z0-9-]+$/, "Use letters, numbers and hyphens only."),
  name: z.string().trim().min(2, "Enter the courier name.").max(120),
  provider: z.enum(PROVIDERS),
  apiBaseUrl: z.string().trim().max(300).optional(),
  credentialEnvPrefix: z.string().trim().max(60).optional(),
  supportsCod: z.boolean(),
  supportsDropship: z.boolean(),
  isActive: z.boolean(),
});

function readCourier(formData: FormData) {
  return courierSchema.parse({
    code: text(formData, "code"),
    name: text(formData, "name"),
    provider: text(formData, "provider") || "MANUAL",
    apiBaseUrl: text(formData, "apiBaseUrl"),
    credentialEnvPrefix: text(formData, "credentialEnvPrefix"),
    supportsCod: checked(formData, "supportsCod"),
    supportsDropship: checked(formData, "supportsDropship"),
    isActive: checked(formData, "isActive"),
  });
}

export async function createCourierAction(
  _previous: ShippingFormState,
  formData: FormData,
): Promise<ShippingFormState> {
  const session = await requirePermission("shipment.write");

  let created: { id: string; code: string };
  try {
    created = await createCourier(readCourier(formData));
  } catch (error) {
    return { error: explain(error) };
  }

  await audit({
    actorUserId: session.user.id,
    action: "shipment.courier.created",
    entityType: "courier",
    entityId: created.id,
    metadata: { code: created.code },
    ...(await requestMeta()),
  });

  revalidatePath("/shipping/couriers");
  redirect(`/shipping/couriers/${created.id}`);
}

export async function updateCourierAction(
  _previous: ShippingFormState,
  formData: FormData,
): Promise<ShippingFormState> {
  const session = await requirePermission("shipment.write");
  const id = text(formData, "id");
  if (!id) return { error: "Missing courier id." };

  try {
    await updateCourier(id, readCourier(formData));
  } catch (error) {
    return { error: explain(error) };
  }

  await audit({
    actorUserId: session.user.id,
    action: "shipment.courier.updated",
    entityType: "courier",
    entityId: id,
    ...(await requestMeta()),
  });

  revalidatePath("/shipping/couriers");
  revalidatePath(`/shipping/couriers/${id}`);
  return { success: "Courier saved." };
}

const shipmentSchema = z.object({
  orderId: z.string().trim().min(1, "Choose an order."),
  courierId: z.string().trim().optional(),
  trackingNumber: z.string().trim().max(80).optional(),
  note: z.string().trim().max(300).optional(),
});

export async function createShipmentAction(
  _previous: ShippingFormState,
  formData: FormData,
): Promise<ShippingFormState> {
  const session = await requirePermission("shipment.write");

  let created: { id: string; shipmentNumber: string };
  try {
    const input = shipmentSchema.parse({
      orderId: text(formData, "orderId"),
      courierId: text(formData, "courierId"),
      trackingNumber: text(formData, "trackingNumber"),
      note: text(formData, "note"),
    });
    created = await createShipment({
      ...input,
      courierId: input.courierId || null,
      trackingNumber: input.trackingNumber || null,
      note: input.note || null,
      actorUserId: session.user.id,
    });
  } catch (error) {
    return { error: explain(error) };
  }

  await audit({
    actorUserId: session.user.id,
    action: "shipment.created",
    entityType: "shipment",
    entityId: created.id,
    metadata: { shipmentNumber: created.shipmentNumber },
    ...(await requestMeta()),
  });

  revalidatePath("/shipping");
  revalidatePath("/orders");
  redirect(`/shipping/${created.id}`);
}

const eventSchema = z.object({
  shipmentId: z.string().trim().min(1),
  status: z.enum([
    "BOOKED",
    "PICKED_UP",
    "IN_TRANSIT",
    "OUT_FOR_DELIVERY",
    "DELIVERED",
    "RETURNED",
    "FAILED",
  ]),
  message: z.string().trim().max(300).optional(),
  location: z.string().trim().max(120).optional(),
});

export async function addTrackingEventAction(
  _previous: ShippingFormState,
  formData: FormData,
): Promise<ShippingFormState> {
  const session = await requirePermission("shipment.write");

  try {
    const input = eventSchema.parse({
      shipmentId: text(formData, "shipmentId"),
      status: text(formData, "status"),
      message: text(formData, "message"),
      location: text(formData, "location"),
    });
    await addTrackingEvent({
      ...input,
      message: input.message || null,
      location: input.location || null,
      actorUserId: session.user.id,
    });
  } catch (error) {
    return { error: explain(error) };
  }

  const shipmentId = text(formData, "shipmentId");
  await audit({
    actorUserId: session.user.id,
    action: "shipment.event",
    entityType: "shipment",
    entityId: shipmentId,
    metadata: { status: text(formData, "status") },
    ...(await requestMeta()),
  });

  revalidatePath("/shipping");
  revalidatePath(`/shipping/${shipmentId}`);
  revalidatePath("/orders");
  return { success: "Tracking event recorded." };
}

export async function cancelShipmentAction(
  _previous: ShippingFormState,
  formData: FormData,
): Promise<ShippingFormState> {
  const session = await requirePermission("shipment.approve");
  const id = text(formData, "id");
  const reason = text(formData, "reason").trim();
  if (!id) return { error: "Missing shipment id." };
  if (reason.length < 3) return { error: "Say why the shipment is cancelled." };

  try {
    await cancelShipment(id, session.user.id, reason);
  } catch (error) {
    return { error: explain(error) };
  }

  await audit({
    actorUserId: session.user.id,
    action: "shipment.cancelled",
    entityType: "shipment",
    entityId: id,
    reason,
    ...(await requestMeta()),
  });

  revalidatePath("/shipping");
  revalidatePath(`/shipping/${id}`);
  return { success: "Shipment cancelled." };
}

const remittanceSchema = z.object({
  courierId: z.string().trim().min(1, "Choose a courier."),
  amount: z
    .string()
    .trim()
    .regex(/^\d{1,11}(\.\d{1,2})?$/, "Enter the amount with up to two decimals."),
  destination: z.enum(["CASH", "BANK"]),
  reference: z.string().trim().max(120).optional(),
  receivedAt: z.string().trim().optional(),
  note: z.string().trim().max(200).optional(),
});

export async function postCodRemittanceAction(
  _previous: ShippingFormState,
  formData: FormData,
): Promise<ShippingFormState> {
  const session = await requirePermission("shipment.approve");

  try {
    const input = remittanceSchema.parse({
      courierId: text(formData, "courierId"),
      amount: text(formData, "amount"),
      destination: text(formData, "destination") || "BANK",
      reference: text(formData, "reference"),
      receivedAt: text(formData, "receivedAt"),
      note: text(formData, "note"),
    });
    const receivedAt = input.receivedAt ? new Date(input.receivedAt) : null;
    if (receivedAt && Number.isNaN(receivedAt.getTime())) {
      return { error: "Enter a valid received date." };
    }
    const result = await postCodRemittance({
      courierId: input.courierId,
      amount: input.amount,
      destination: input.destination,
      reference: input.reference || null,
      receivedAt,
      note: input.note || null,
      actorUserId: session.user.id,
    });

    await audit({
      actorUserId: session.user.id,
      action: "shipment.cod.remitted",
      entityType: "journal_entry",
      entityId: result.journalEntryId,
      metadata: { amount: result.amount.toFixed(2), courierId: input.courierId },
      ...(await requestMeta()),
    });

    revalidatePath("/shipping/remittances");
    revalidatePath("/accounting");
    return { success: `COD remittance posted for ৳${result.amount.toFixed(2)}.` };
  } catch (error) {
    return { error: explain(error) };
  }
}
