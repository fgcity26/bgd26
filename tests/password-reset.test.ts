import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { Prisma } from "../src/generated/prisma/client";
import { prisma } from "../src/lib/db";
import { hashSecret, verifySecret } from "../src/lib/password";
import {
  signCustomerSessionToken,
  verifyCustomerSessionToken,
} from "../src/lib/auth/token";
import {
  AccountError,
  registerCustomer,
  signInCustomer,
} from "../src/lib/customer-auth/service";
import {
  PASSWORD_RESET,
  requestCustomerPasswordReset,
  resetCustomerPassword,
} from "../src/lib/customer-auth/password-reset";
import { sessionPredatesPasswordUpdate } from "../src/lib/customer-auth/session-policy";
import { PASSWORD_RESET_TEMPLATE } from "../src/lib/whatsapp/templates";

/**
 * Password reset over WhatsApp.
 *
 * Every database scenario runs inside one interactive transaction that is
 * rolled back, so the real constraints run without leaving rows behind. The
 * local WhatsApp simulator is forced so nothing can leave the machine, and the
 * code is always injected so the assertions are deterministic.
 */

process.env.FEATURE_WHATSAPP = "true";
delete process.env.WHATSAPP_PROVIDER;
delete process.env.WHATSAPP_PHONE_NUMBER_ID;
delete process.env.WHATSAPP_ACCESS_TOKEN;

class Rollback<T> extends Error {
  constructor(readonly value: T) {
    super("test rollback");
  }
}

async function rolledBack<T>(
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  try {
    return await prisma.$transaction(
      async (tx) => {
        const value = await work(tx);
        throw new Rollback(value);
      },
      { timeout: 30_000 },
    );
  } catch (error) {
    if (error instanceof Rollback) return error.value as T;
    throw error;
  }
}

function suffix(): string {
  return randomBytes(5).toString("hex");
}

function testMobile(run: string): string {
  const raw = (BigInt(`0x${run}`) % 1_000_000_000n).toString().padStart(9, "0");
  const digits = String(3 + (Number(raw[0]) % 7)) + raw.slice(1);
  return `+8801${digits}`;
}

const PASSWORD = "account-test-pass1";

async function account(
  tx: Prisma.TransactionClient,
  run: string,
  mobile = testMobile(run),
) {
  const created = await registerCustomer(
    {
      fullName: `Reset Shopper ${run}`,
      mobile,
      password: PASSWORD,
      confirmPassword: PASSWORD,
    },
    tx,
  );
  return { id: created.id, mobile: created.mobile };
}

test("an unknown number is ignored and creates nothing", async () => {
  const run = suffix();
  await rolledBack(async (tx) => {
    const mobile = testMobile(run);
    const result = await requestCustomerPasswordReset(
      { mobile, code: "123456" },
      tx,
    );
    assert.equal(result.status, "IGNORED");
    assert.equal(
      await tx.customerPasswordReset.count({ where: { phoneNumberNormalized: mobile } }),
      0,
    );
  });
});

test("the code is stored only as a scrypt hash and never in the message", async () => {
  const run = suffix();
  await rolledBack(async (tx) => {
    const user = await account(tx, run);
    const result = await requestCustomerPasswordReset(
      { mobile: user.mobile, code: "135790" },
      tx,
    );
    assert.equal(result.status, "SENT");
    assert.equal(result.customerId, user.id);

    const reset = await tx.customerPasswordReset.findFirstOrThrow({
      where: { customerId: user.id },
      orderBy: { createdAt: "desc" },
    });
    assert.match(reset.codeHash, /^scrypt\$/);
    assert.notEqual(reset.codeHash, "135790");
    assert.equal(await verifySecret("135790", reset.codeHash), true);
    assert.equal(await verifySecret("000000", reset.codeHash), false);
    assert.equal(reset.attemptCount, 0);
    assert.equal(reset.maxAttempts, PASSWORD_RESET.maxAttempts);

    const message = await tx.whatsappMessage.findFirstOrThrow({
      where: { dedupeKey: `password_reset:${reset.id}` },
    });
    assert.equal(message.status, "SENT");
    assert.equal(message.templateName, PASSWORD_RESET_TEMPLATE.name);
    assert.equal(message.templateLanguage, PASSWORD_RESET_TEMPLATE.language);
    assert.deepEqual(message.templateVariables, []);
    assert.ok(!message.body?.includes("135790"), "message body must not contain the code");
  });
});

test("a resend inside the cooldown is throttled", async () => {
  const run = suffix();
  await rolledBack(async (tx) => {
    const user = await account(tx, run);
    const first = await requestCustomerPasswordReset(
      { mobile: user.mobile, code: "111111" },
      tx,
    );
    const second = await requestCustomerPasswordReset(
      { mobile: user.mobile, code: "222222" },
      tx,
    );
    assert.equal(first.status, "SENT");
    assert.equal(second.status, "THROTTLED");
  });
});

test("a customer is limited to three codes an hour", async () => {
  const run = suffix();
  await rolledBack(async (tx) => {
    const user = await account(tx, run);
    const now = Date.now();
    const codeHash = await hashSecret("000000");
    for (let index = 0; index < PASSWORD_RESET.perHour; index += 1) {
      await tx.customerPasswordReset.create({
        data: {
          customerId: user.id,
          phoneNumberNormalized: user.mobile,
          codeHash,
          expiresAt: new Date(now + 10 * 60_000),
          // Older than the one-minute cooldown but inside the hour window.
          createdAt: new Date(now - (index + 2) * 60_000),
        },
      });
    }
    const result = await requestCustomerPasswordReset(
      { mobile: user.mobile, code: "333333" },
      tx,
    );
    assert.equal(result.status, "THROTTLED");
  });
});

test("a wrong code is counted, then blocks further attempts", async () => {
  const run = suffix();
  await rolledBack(async (tx) => {
    const user = await account(tx, run);
    await requestCustomerPasswordReset({ mobile: user.mobile, code: "123456" }, tx);

    await assert.rejects(
      resetCustomerPassword(
        {
          mobile: user.mobile,
          code: "654321",
          newPassword: "fresh-password1",
          confirmPassword: "fresh-password1",
        },
        tx,
      ),
      (error: unknown) =>
        error instanceof AccountError && /invalid or has expired/.test(error.message),
    );

    const afterOne = await tx.customerPasswordReset.findFirstOrThrow({
      where: { customerId: user.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, attemptCount: true },
    });
    assert.equal(afterOne.attemptCount, 1);

    // The password is unchanged after a wrong code.
    await signInCustomer({ mobile: user.mobile, password: PASSWORD }, tx);

    await tx.customerPasswordReset.update({
      where: { id: afterOne.id },
      data: { attemptCount: PASSWORD_RESET.maxAttempts },
    });
    await assert.rejects(
      resetCustomerPassword(
        {
          mobile: user.mobile,
          code: "123456",
          newPassword: "fresh-password1",
          confirmPassword: "fresh-password1",
        },
        tx,
      ),
      (error: unknown) =>
        error instanceof AccountError && /Too many attempts/.test(error.message),
    );
  });
});

test("an expired code is refused", async () => {
  const run = suffix();
  await rolledBack(async (tx) => {
    const user = await account(tx, run);
    await requestCustomerPasswordReset({ mobile: user.mobile, code: "123456" }, tx);
    await tx.customerPasswordReset.updateMany({
      where: { customerId: user.id },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });

    await assert.rejects(
      resetCustomerPassword(
        {
          mobile: user.mobile,
          code: "123456",
          newPassword: "fresh-password1",
          confirmPassword: "fresh-password1",
        },
        tx,
      ),
      (error: unknown) =>
        error instanceof AccountError && /expired/.test(error.message),
    );
  });
});

test("a good code sets a new password, consumes every active code and ends old sessions", async () => {
  const run = suffix();
  await rolledBack(async (tx) => {
    const user = await account(tx, run);
    const oldToken = signCustomerSessionToken({
      customerId: user.id,
      mobile: user.mobile,
      nowSeconds: Math.floor(Date.now() / 1000) - 3_600,
    });

    await requestCustomerPasswordReset({ mobile: user.mobile, code: "246810" }, tx);
    const result = await resetCustomerPassword(
      {
        mobile: user.mobile,
        code: "246810",
        newPassword: "brand-new-pass1",
        confirmPassword: "brand-new-pass1",
      },
      tx,
    );
    assert.equal(result.customerId, user.id);

    // The old password no longer works; the new one does.
    await assert.rejects(
      signInCustomer({ mobile: user.mobile, password: PASSWORD }, tx),
      (error: unknown) => error instanceof AccountError && /incorrect/.test(error.message),
    );
    const signedIn = await signInCustomer(
      { mobile: user.mobile, password: "brand-new-pass1" },
      tx,
    );
    assert.equal(signedIn.id, user.id);

    const resets = await tx.customerPasswordReset.findMany({
      where: { customerId: user.id },
      select: { consumedAt: true },
    });
    assert.ok(resets.length > 0);
    assert.ok(resets.every((row) => row.consumedAt !== null));

    const row = await tx.customer.findUniqueOrThrow({
      where: { id: user.id },
      select: { passwordUpdatedAt: true, failedLoginCount: true, lockedUntil: true },
    });
    assert.ok(row.passwordUpdatedAt);
    assert.equal(row.failedLoginCount, 0);
    assert.equal(row.lockedUntil, null);

    // A token issued before the reset is rejected; a fresh one is accepted.
    const payload = verifyCustomerSessionToken(oldToken);
    assert.ok(payload);
    assert.equal(
      sessionPredatesPasswordUpdate(payload.issuedAt, row.passwordUpdatedAt),
      true,
    );
    const freshPayload = verifyCustomerSessionToken(
      signCustomerSessionToken({ customerId: user.id, mobile: user.mobile }),
    );
    assert.ok(freshPayload);
    assert.equal(
      sessionPredatesPasswordUpdate(freshPayload.issuedAt, row.passwordUpdatedAt),
      false,
    );
  });
});

test("a stopped marketing consent does not block a requested reset code", async () => {
  const run = suffix();
  await rolledBack(async (tx) => {
    const user = await account(tx, run);
    await tx.whatsappConsent.create({
      data: {
        customerId: user.id,
        phoneNumberNormalized: user.mobile,
        status: "OPTED_OUT",
        optedOutAt: new Date(),
      },
    });
    const result = await requestCustomerPasswordReset(
      { mobile: user.mobile, code: "123456" },
      tx,
    );
    assert.equal(result.status, "SENT");
  });
});

test("mismatched confirmation and a weak password are refused before touching data", async () => {
  const run = suffix();
  await rolledBack(async (tx) => {
    const user = await account(tx, run);
    await requestCustomerPasswordReset({ mobile: user.mobile, code: "123456" }, tx);

    await assert.rejects(
      resetCustomerPassword(
        {
          mobile: user.mobile,
          code: "123456",
          newPassword: "brand-new-pass1",
          confirmPassword: "different-pass1",
        },
        tx,
      ),
      (error: unknown) => error instanceof AccountError && /do not match/.test(error.message),
    );
    await assert.rejects(
      resetCustomerPassword(
        {
          mobile: user.mobile,
          code: "123456",
          newPassword: "short1",
          confirmPassword: "short1",
        },
        tx,
      ),
      (error: unknown) => error instanceof AccountError && /at least/.test(error.message),
    );
  });
});
