"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { AuthError, getAuthAdapter } from "@/lib/adapters/auth";
import { audit } from "@/lib/auth/audit";
import { clearSessionCookie } from "@/lib/auth/cookies";
import { passwordProblem, pinProblem } from "@/lib/auth/policy";
import { requestMeta } from "@/lib/auth/request-meta";
import { getStaffSession, requireStaff } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { hashPin } from "@/lib/password";

/**
 * Account self-service actions.
 *
 * Every action re-checks the session and, where relevant, the current password
 * on the server — a hidden field or a disabled button is never trusted.
 */
export type FormState = {
  error?: string;
  success?: string;
};

const passwordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(1).max(200),
  confirmPassword: z.string().min(1).max(200),
});

const pinSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPin: z.string().min(1).max(12),
  confirmPin: z.string().min(1).max(12),
});

export async function changePasswordAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await requireStaff({ allowPendingPasswordChange: true });

  const parsed = passwordSchema.safeParse({
    currentPassword: formData.get("currentPassword"),
    newPassword: formData.get("newPassword"),
    confirmPassword: formData.get("confirmPassword"),
  });

  if (!parsed.success) {
    return { error: "Fill in all three password fields." };
  }

  const { currentPassword, newPassword, confirmPassword } = parsed.data;

  if (newPassword !== confirmPassword) {
    return { error: "The new password and confirmation do not match." };
  }

  const problem = passwordProblem(newPassword);
  if (problem) return { error: problem };

  const adapter = getAuthAdapter();
  try {
    await adapter.changePassword({
      user: { id: session.user.id, email: session.user.email },
      currentPassword,
      newPassword,
    });
  } catch (error) {
    if (error instanceof AuthError) return { error: error.message };
    console.error("[auth] password change failed", error);
    return { error: "Could not change the password right now. Try again." };
  }

  await audit({
    actorUserId: session.user.id,
    action: "auth.password.changed",
    entityType: "user",
    entityId: session.user.id,
    metadata: { provider: adapter.provider, forced: session.user.mustChangePassword },
    ...(await requestMeta()),
  });

  revalidatePath("/profile");

  if (session.user.mustChangePassword) {
    redirect("/dashboard");
  }

  return { success: "Password updated. Use the new one next time you sign in." };
}

export async function changePinAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await requireStaff({ allowPendingPasswordChange: true });

  const parsed = pinSchema.safeParse({
    currentPassword: formData.get("currentPassword"),
    newPin: formData.get("newPin"),
    confirmPin: formData.get("confirmPin"),
  });

  if (!parsed.success) {
    return { error: "Enter your current password and the new PIN twice." };
  }

  const { currentPassword, newPin, confirmPin } = parsed.data;

  if (newPin !== confirmPin) {
    return { error: "The PIN and confirmation do not match." };
  }

  const problem = pinProblem(newPin);
  if (problem) return { error: problem };

  const adapter = getAuthAdapter();
  const authorised = await adapter.verifyPassword({
    userId: session.user.id,
    email: session.user.email,
    password: currentPassword,
  });
  if (!authorised) {
    return { error: "Current password is incorrect." };
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: { managerPinHash: await hashPin(newPin), managerPinUpdatedAt: new Date() },
  });

  await audit({
    actorUserId: session.user.id,
    action: "auth.pin.changed",
    entityType: "user",
    entityId: session.user.id,
    ...(await requestMeta()),
  });

  revalidatePath("/profile");
  return { success: "Manager PIN updated." };
}

export async function logoutAction(): Promise<void> {
  const session = await getStaffSession();

  if (session) {
    await audit({
      actorUserId: session.user.id,
      action: "auth.logout",
      entityType: "user",
      entityId: session.user.id,
      ...(await requestMeta()),
    });
  }

  await clearSessionCookie();
  redirect("/login");
}
