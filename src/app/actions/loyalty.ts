"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { audit } from "@/lib/auth/audit";
import { requestMeta } from "@/lib/auth/request-meta";
import { requirePermission } from "@/lib/auth/session";
import {
  adjustPoints,
  expirePoints,
  LoyaltyError,
} from "@/lib/loyalty/service";

/**
 * Loyalty actions.
 *
 * Points are money-adjacent, so reading uses `customer.read` and every manual
 * movement uses `customer.approve`. A cashier redeems points only through a
 * sale, where the service applies the cap and the balance check.
 */

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function explain(error: unknown): string {
  if (error instanceof LoyaltyError) return error.message;
  return error instanceof Error ? error.message : "Could not complete that action.";
}

export async function adjustPointsAction(formData: FormData): Promise<void> {
  const session = await requirePermission("customer.approve");
  const customerId = text(formData, "customerId").trim();
  const target = customerId ? `/loyalty/${customerId}` : "/loyalty";

  const points = Number(text(formData, "points"));
  const reason = text(formData, "reason").trim();
  if (!Number.isInteger(points) || points === 0) {
    redirect(`${target}?error=${encodeURIComponent("Enter a non-zero whole number of points.")}`);
  }
  if (reason.length < 3) {
    redirect(`${target}?error=${encodeURIComponent("Give a reason for the adjustment.")}`);
  }

  try {
    const movement = await adjustPoints({
      customerId,
      points,
      reason,
      actorUserId: session.user.id,
    });
    const meta = await requestMeta();
    await audit({
      actorUserId: session.user.id,
      action: "loyalty.adjusted",
      entityType: "customer",
      entityId: customerId,
      reason,
      metadata: {
        points: movement.points,
        balanceAfter: movement.balanceAfter,
        transactionId: movement.transactionId,
      },
      ...meta,
    });
  } catch (error) {
    redirect(`${target}?error=${encodeURIComponent(explain(error))}`);
  }

  revalidatePath("/loyalty");
  revalidatePath(target);
  revalidatePath(`/customers/${customerId}`);
  redirect(`${target}?ok=${encodeURIComponent("Points adjusted.")}`);
}

export async function expirePointsAction(formData: FormData): Promise<void> {
  const session = await requirePermission("customer.approve");
  const customerId = text(formData, "customerId").trim();
  const target = customerId ? `/loyalty/${customerId}` : "/loyalty";

  try {
    const result = await expirePoints({
      customerId: customerId || null,
      actorUserId: session.user.id,
    });
    const meta = await requestMeta();
    await audit({
      actorUserId: session.user.id,
      action: "loyalty.expired",
      entityType: "customer",
      entityId: customerId || null,
      reason: "Twelve-month loyalty expiry",
      metadata: result,
      ...meta,
    });

    revalidatePath("/loyalty");
    if (customerId) revalidatePath(target);
    revalidatePath("/customers");
    redirect(
      `${target}?ok=${encodeURIComponent(
        result.points > 0
          ? `${result.points} point${result.points === 1 ? "" : "s"} expired across ${result.customers} customer${result.customers === 1 ? "" : "s"}.`
          : "No points are due to expire.",
      )}`,
    );
  } catch (error) {
    redirect(`${target}?error=${encodeURIComponent(explain(error))}`);
  }
}
