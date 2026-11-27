"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { audit } from "@/lib/auth/audit";
import { requestMeta } from "@/lib/auth/request-meta";
import { signCustomerSessionToken } from "@/lib/auth/token";
import { maskMobile } from "@/lib/ai/audit";
import { tryNormalizeBdMobile } from "@/lib/crm/phone";
import {
  AccountError,
} from "@/lib/customer-auth/service";
import {
  requestCustomerPasswordReset,
  resetCustomerPassword,
} from "@/lib/customer-auth/password-reset";
import { writeCustomerCookie } from "@/lib/customer-auth/cookies";
import type { CustomerActionState } from "@/lib/customer-auth/action-state";

/**
 * Public password-reset actions.
 *
 * Both responses are deliberately uniform. A request always ends on the same
 * "check your WhatsApp" screen whether or not the number has an account, and a
 * bad code always returns the same sentence. The audit row records the real
 * outcome for staff without telling the browser.
 */

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

export async function requestPasswordResetAction(
  _previous: CustomerActionState,
  formData: FormData,
): Promise<CustomerActionState> {
  const mobile = tryNormalizeBdMobile(text(formData, "mobile"));
  if (!mobile) {
    return { error: "Enter a valid Bangladeshi mobile number." };
  }

  const meta = await requestMeta();
  const result = await requestCustomerPasswordReset({
    mobile,
    ip: meta.ipAddress,
  });

  await audit({
    action: "customer.password_reset.requested",
    entityType: "customer",
    entityId: result.customerId ?? null,
    reason: result.status,
    metadata: { mobile: maskMobile(mobile), status: result.status },
    ...meta,
  });

  redirect(
    `/account/reset-password?mobile=${encodeURIComponent(mobile)}&sent=1`,
  );
}

export async function resetCustomerPasswordAction(
  _previous: CustomerActionState,
  formData: FormData,
): Promise<CustomerActionState> {
  let result: { customerId: string; mobile: string };
  try {
    result = await resetCustomerPassword({
      mobile: text(formData, "mobile"),
      code: text(formData, "code"),
      newPassword: text(formData, "newPassword"),
      confirmPassword: text(formData, "confirmPassword"),
    });
  } catch (error) {
    if (error instanceof AccountError) return { error: error.message };
    return { error: "Something went wrong. Please try again." };
  }

  const meta = await requestMeta();
  await audit({
    actorUserId: null,
    action: "customer.password_reset.completed",
    entityType: "customer",
    entityId: result.customerId,
    metadata: { mobile: maskMobile(result.mobile) },
    ...meta,
  });

  await writeCustomerCookie(
    signCustomerSessionToken({
      customerId: result.customerId,
      mobile: result.mobile,
    }),
  );
  revalidatePath("/account");
  redirect("/account?reset=1");
}
