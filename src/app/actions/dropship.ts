"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { audit } from "@/lib/auth/audit";
import { requestMeta } from "@/lib/auth/request-meta";
import { requirePermission } from "@/lib/auth/session";
import {
  DropshipServiceError,
  cancelDropshipOrder,
  confirmDropshipOrder,
  deliverDropshipOrder,
  sendDropshipOrder,
  shipDropshipOrder,
} from "@/lib/dropship/service";

/**
 * Dropship actions: validate, authorise, call one service, audit, revalidate.
 *
 * Moving a supplier order is an approval step, so every transition needs
 * `purchase.approve`. Reading the list and detail needs `purchase.read`.
 */

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function explain(error: unknown): string {
  if (error instanceof DropshipServiceError) return error.message;
  if (error instanceof Error && error.name === "AccountingError") return error.message;
  if (error instanceof Error && error.name === "OrdersError") return error.message;
  return "Something went wrong. Please try again.";
}

function backTo(id: string, message: string): never {
  redirect(`/purchases/dropship/${id}?error=${encodeURIComponent(message)}`);
}

export async function sendDropshipOrderAction(formData: FormData): Promise<void> {
  const session = await requirePermission("purchase.approve");
  const id = text(formData, "id");
  if (!id) return;

  try {
    await sendDropshipOrder(id, session.user.id);
    await audit({
      actorUserId: session.user.id,
      action: "dropship.order.sent",
      entityType: "purchase_order",
      entityId: id,
      ...(await requestMeta()),
    });
  } catch (error) {
    backTo(id, explain(error));
  }

  revalidatePath("/purchases/dropship");
  revalidatePath(`/purchases/dropship/${id}`);
  redirect(`/purchases/dropship/${id}`);
}

export async function confirmDropshipOrderAction(formData: FormData): Promise<void> {
  const session = await requirePermission("purchase.approve");
  const id = text(formData, "id");
  const note = text(formData, "note");
  if (!id) return;

  try {
    await confirmDropshipOrder(id, session.user.id, note);
    await audit({
      actorUserId: session.user.id,
      action: "dropship.order.confirmed",
      entityType: "purchase_order",
      entityId: id,
      metadata: note.trim() ? { note: note.trim() } : undefined,
      ...(await requestMeta()),
    });
  } catch (error) {
    backTo(id, explain(error));
  }

  revalidatePath("/purchases/dropship");
  revalidatePath(`/purchases/dropship/${id}`);
  redirect(`/purchases/dropship/${id}`);
}

export async function shipDropshipOrderAction(formData: FormData): Promise<void> {
  const session = await requirePermission("purchase.approve");
  const id = text(formData, "id");
  if (!id) return;

  try {
    const result = await shipDropshipOrder(id, session.user.id, {
      trackingNumber: text(formData, "trackingNumber"),
      courierId: text(formData, "courierId"),
      note: text(formData, "note"),
    });
    await audit({
      actorUserId: session.user.id,
      action: "dropship.order.shipped",
      entityType: "purchase_order",
      entityId: id,
      metadata: { shipmentNumber: result.shipmentNumber },
      ...(await requestMeta()),
    });
  } catch (error) {
    backTo(id, explain(error));
  }

  revalidatePath("/purchases/dropship");
  revalidatePath(`/purchases/dropship/${id}`);
  revalidatePath("/orders");
  revalidatePath("/shipments");
  redirect(`/purchases/dropship/${id}`);
}

export async function deliverDropshipOrderAction(formData: FormData): Promise<void> {
  const session = await requirePermission("purchase.approve");
  const id = text(formData, "id");
  if (!id) return;

  try {
    await deliverDropshipOrder(id, session.user.id, text(formData, "note"));
    await audit({
      actorUserId: session.user.id,
      action: "dropship.order.delivered",
      entityType: "purchase_order",
      entityId: id,
      ...(await requestMeta()),
    });
  } catch (error) {
    backTo(id, explain(error));
  }

  revalidatePath("/purchases/dropship");
  revalidatePath(`/purchases/dropship/${id}`);
  revalidatePath("/orders");
  revalidatePath("/shipments");
  redirect(`/purchases/dropship/${id}`);
}

export async function cancelDropshipOrderAction(formData: FormData): Promise<void> {
  const session = await requirePermission("purchase.approve");
  const id = text(formData, "id");
  const reason = text(formData, "reason");
  if (!id) return;

  try {
    await cancelDropshipOrder(id, session.user.id, reason);
    await audit({
      actorUserId: session.user.id,
      action: "dropship.order.cancelled",
      entityType: "purchase_order",
      entityId: id,
      metadata: { reason: reason.trim() || null },
      ...(await requestMeta()),
    });
  } catch (error) {
    backTo(id, explain(error));
  }

  revalidatePath("/purchases/dropship");
  revalidatePath(`/purchases/dropship/${id}`);
  redirect(`/purchases/dropship/${id}`);
}
