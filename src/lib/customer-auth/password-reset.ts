import { randomInt } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { tryNormalizeBdMobile } from "@/lib/crm/phone";
import { passwordProblem } from "@/lib/auth/policy";
import { hashSecret, verifySecret } from "@/lib/password";
import {
  getWhatsAppAdapter,
  whatsappSettings,
  WhatsAppError,
} from "@/lib/adapters/whatsapp";
import { PASSWORD_RESET_TEMPLATE } from "@/lib/whatsapp/templates";
import { AccountError } from "./service";

/**
 * Storefront password reset over WhatsApp.
 *
 * The customer asks for a six-digit code, receives it as an authentication
 * template and enters it with a new password. Only a scrypt hash of the code is
 * stored, so a database dump cannot be used to reset an account. The response
 * to a request is always the same, whether or not the mobile has an account.
 *
 * This is a transactional message the customer initiated, so it is not gated by
 * marketing consent. Tight throttling (one per minute, three per hour per
 * customer, ten per hour per IP) limits abuse without locking a real customer
 * out of their own account.
 */

const WALK_IN_MOBILE = "+8800000000000";

export const PASSWORD_RESET = {
  codeLength: 6,
  ttlMinutes: 10,
  maxAttempts: 5,
  resendSeconds: 60,
  perHour: 3,
  perIpPerHour: 10,
} as const;

export type ResetRequestStatus = "SENT" | "IGNORED" | "THROTTLED";

export type ResetRequestResult = {
  status: ResetRequestStatus;
  customerId?: string;
};

export type ResetResult = {
  customerId: string;
  mobile: string;
};

function run<T>(
  outer: Prisma.TransactionClient | undefined,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  if (outer) return work(outer);
  return prisma.$transaction(work);
}

function mobileOrNull(value: string): string | null {
  const mobile = tryNormalizeBdMobile(value);
  if (!mobile || mobile === WALK_IN_MOBILE) return null;
  return mobile;
}

function generateCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(PASSWORD_RESET.codeLength, "0");
}

function genericCodeError(): AccountError {
  return new AccountError(
    "That code is invalid or has expired. Request a new code and try again.",
  );
}

/**
 * Queue a reset code. `code` exists for tests and the verification script; the
 * public actions never pass it, so production always uses a fresh random code.
 */
export async function requestCustomerPasswordReset(
  input: { mobile: string; ip?: string | null; code?: string },
  outer?: Prisma.TransactionClient,
): Promise<ResetRequestResult> {
  const mobile = mobileOrNull(input.mobile);
  if (!mobile) return { status: "IGNORED" };

  const code = input.code ?? generateCode();
  if (!new RegExp(`^\\d{${PASSWORD_RESET.codeLength}}$`).test(code)) {
    throw new AccountError("Enter the six-digit code.");
  }

  const prepared = await run(outer, async (tx) => {
    const customer = await tx.customer.findFirst({
      where: {
        mobileNormalized: mobile,
        deletedAt: null,
        status: "ACTIVE",
        passwordHash: { not: null },
      },
      select: { id: true, fullName: true, mobileNormalized: true },
    });
    if (!customer) return { status: "IGNORED" as const };

    const now = new Date();
    const latest = await tx.customerPasswordReset.findFirst({
      where: { customerId: customer.id },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    if (
      latest &&
      now.getTime() - latest.createdAt.getTime() < PASSWORD_RESET.resendSeconds * 1000
    ) {
      return { status: "THROTTLED" as const, customerId: customer.id };
    }

    const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const hourly = await tx.customerPasswordReset.count({
      where: { customerId: customer.id, createdAt: { gte: hourAgo } },
    });
    if (hourly >= PASSWORD_RESET.perHour) {
      return { status: "THROTTLED" as const, customerId: customer.id };
    }

    if (input.ip) {
      const perIp = await tx.customerPasswordReset.count({
        where: { requestedIp: input.ip, createdAt: { gte: hourAgo } },
      });
      if (perIp >= PASSWORD_RESET.perIpPerHour) {
        return { status: "THROTTLED" as const, customerId: customer.id };
      }
    }

    const template = await tx.whatsappTemplate.findFirst({
      where: {
        name: PASSWORD_RESET_TEMPLATE.name,
        language: PASSWORD_RESET_TEMPLATE.language,
      },
      select: { id: true, name: true, language: true, status: true },
    });

    const reset = await tx.customerPasswordReset.create({
      data: {
        customerId: customer.id,
        phoneNumberNormalized: mobile,
        codeHash: await hashSecret(code),
        expiresAt: new Date(now.getTime() + PASSWORD_RESET.ttlMinutes * 60 * 1000),
        maxAttempts: PASSWORD_RESET.maxAttempts,
        requestedIp: input.ip ? input.ip.slice(0, 64) : null,
      },
      select: { id: true },
    });

    const conversation = await tx.whatsappConversation.upsert({
      where: { waConversationId: `wa:${mobile}` },
      update: {
        customerId: customer.id,
        customerName: customer.fullName,
      },
      create: {
        waConversationId: `wa:${mobile}`,
        phoneNumberNormalized: mobile,
        customerId: customer.id,
        customerName: customer.fullName,
        status: "OPEN",
      },
      select: { id: true },
    });

    return {
      status: "SENT" as const,
      customer,
      resetId: reset.id,
      conversationId: conversation.id,
      template,
      code,
    };
  });

  if (prepared.status !== "SENT") {
    return {
      status: prepared.status,
      customerId: "customerId" in prepared ? prepared.customerId : undefined,
    };
  }

  await deliverResetCode(prepared, outer);
  return { status: "SENT", customerId: prepared.customer.id };
}

async function deliverResetCode(
  prepared: {
    customer: { id: string; fullName: string; mobileNormalized: string };
    resetId: string;
    conversationId: string;
    template: { id: string; name: string; language: string; status: string } | null;
    code: string;
  },
  outer?: Prisma.TransactionClient,
): Promise<void> {
  const settings = whatsappSettings();
  const db = outer ?? prisma;

  if (!settings.enabled) {
    console.error("[password-reset] WhatsApp is switched off; code not delivered");
    return;
  }
  if (!prepared.template) {
    console.error(
      `[password-reset] template ${PASSWORD_RESET_TEMPLATE.name}/${PASSWORD_RESET_TEMPLATE.language} is missing`,
    );
    return;
  }
  if (settings.live && prepared.template.status !== "APPROVED") {
    console.error(
      `[password-reset] template ${PASSWORD_RESET_TEMPLATE.name} is not APPROVED; live send refused`,
    );
    return;
  }

  const adapter = getWhatsAppAdapter(settings);
  let status: "SENT" | "FAILED" = "SENT";
  let waMessageId: string | null = null;
  let errorCode: string | null = null;
  let errorMessage: string | null = null;

  try {
    const result = await adapter.sendTemplate({
      to: prepared.customer.mobileNormalized,
      templateName: prepared.template.name,
      language: prepared.template.language,
      variables: [prepared.code],
      copyCodeButton: true,
      idempotencyKey: `password-reset:${prepared.resetId}`,
    });
    waMessageId = result.waMessageId;
  } catch (error) {
    status = "FAILED";
    const failure =
      error instanceof WhatsAppError
        ? error
        : new WhatsAppError(
            error instanceof Error ? error.message : "The reset code could not be sent.",
            { code: "SEND_FAILED" },
          );
    errorCode = failure.code.slice(0, 40);
    errorMessage = failure.message.slice(0, 500);
    console.error("[password-reset] send failed", prepared.resetId, failure.code);
  }

  try {
    // The body deliberately says only that a code was sent. The code itself is
    // never written to the message history.
    await db.whatsappMessage.create({
      data: {
        conversationId: prepared.conversationId,
        direction: "OUTBOUND",
        messageType: "TEMPLATE",
        body: status === "SENT" ? "Password reset code sent." : null,
        status,
        recipient: prepared.customer.mobileNormalized,
        event: "MANUAL",
        templateId: prepared.template.id,
        templateName: prepared.template.name,
        templateLanguage: prepared.template.language,
        templateVariables: [],
        dedupeKey: `password_reset:${prepared.resetId}`,
        attemptCount: 1,
        maxAttempts: 1,
        waMessageId,
        sentAt: status === "SENT" ? new Date() : null,
        errorCode,
        errorMessage,
      },
    });
    if (status === "SENT") {
      await db.whatsappConversation.update({
        where: { id: prepared.conversationId },
        data: { lastMessageAt: new Date() },
      });
    }
  } catch (error) {
    console.error("[password-reset] could not record the message", prepared.resetId, error);
  }
}

/** Verify the code and set a new password. Wrong codes are counted, never thrown raw. */
export async function resetCustomerPassword(
  input: {
    mobile: string;
    code: string;
    newPassword: string;
    confirmPassword: string;
  },
  outer?: Prisma.TransactionClient,
): Promise<ResetResult> {
  if (input.newPassword !== input.confirmPassword) {
    throw new AccountError("The two new passwords do not match.");
  }
  const problem = passwordProblem(input.newPassword);
  if (problem) throw new AccountError(problem);

  const mobile = mobileOrNull(input.mobile);
  if (!mobile) throw genericCodeError();
  if (!new RegExp(`^\\d{${PASSWORD_RESET.codeLength}}$`).test(input.code.trim())) {
    throw genericCodeError();
  }

  // The transaction returns a result instead of throwing a wrong-code error:
  // throwing inside the transaction would roll back the attempt counter, which
  // is exactly the signal the throttle depends on. Errors are raised after the
  // transaction commits.
  type Outcome =
    | { ok: true; value: ResetResult }
    | { ok: false; error: AccountError };

  const outcome = await run<Outcome>(outer, async (tx) => {
    const customer = await tx.customer.findFirst({
      where: {
        mobileNormalized: mobile,
        deletedAt: null,
        status: "ACTIVE",
        passwordHash: { not: null },
      },
      select: { id: true, mobileNormalized: true, passwordHash: true },
    });
    if (!customer?.passwordHash) return { ok: false, error: genericCodeError() };

    const reset = await tx.customerPasswordReset.findFirst({
      where: {
        customerId: customer.id,
        phoneNumberNormalized: mobile,
        consumedAt: null,
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        codeHash: true,
        attemptCount: true,
        maxAttempts: true,
        expiresAt: true,
      },
    });
    if (!reset) return { ok: false, error: genericCodeError() };

    const now = new Date();
    if (reset.expiresAt.getTime() <= now.getTime()) {
      return {
        ok: false,
        error: new AccountError("That code has expired. Request a new one."),
      };
    }
    if (reset.attemptCount >= reset.maxAttempts) {
      return {
        ok: false,
        error: new AccountError("Too many attempts. Request a new code."),
      };
    }

    const valid = await verifySecret(input.code.trim(), reset.codeHash);
    if (!valid) {
      // Commit the counter bump, then report the failure.
      await tx.customerPasswordReset.update({
        where: { id: reset.id },
        data: { attemptCount: { increment: 1 } },
      });
      return { ok: false, error: genericCodeError() };
    }

    if (await verifySecret(input.newPassword, customer.passwordHash)) {
      return {
        ok: false,
        error: new AccountError("Choose a password you have not used here before."),
      };
    }

    // Consume the code atomically before changing the password, so two requests
    // holding the same valid code cannot both set a password.
    const consumed = await tx.customerPasswordReset.updateMany({
      where: {
        id: reset.id,
        consumedAt: null,
        attemptCount: { lt: reset.maxAttempts },
        expiresAt: { gt: now },
      },
      data: { consumedAt: now },
    });
    if (consumed.count === 0) return { ok: false, error: genericCodeError() };

    await tx.customer.update({
      where: { id: customer.id },
      data: {
        passwordHash: await hashSecret(input.newPassword),
        passwordUpdatedAt: now,
        failedLoginCount: 0,
        lockedUntil: null,
      },
    });

    await tx.customerPasswordReset.updateMany({
      where: { customerId: customer.id, consumedAt: null },
      data: { consumedAt: now },
    });

    return { ok: true, value: { customerId: customer.id, mobile } };
  });

  if (!outcome.ok) throw outcome.error;
  return outcome.value;
}
