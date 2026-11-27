/**
 * End-to-end password-reset verification (module 4d).
 *
 *   npm run build
 *   STORAGE_PROVIDER=local npm start     # in another terminal
 *   npm run verify:password-reset
 *
 * Point it elsewhere with BASE_URL=http://localhost:3100 npm run verify:password-reset
 *
 * Proves over real HTTP and the real database that: the forgot/reset pages
 * render; the login page links to the reset flow; requesting a code stores only
 * a scrypt hash and a WhatsApp message that never contains the code; an unknown
 * number is ignored without revealing anything; a wrong code is counted; the
 * reset sets a new password, rejects the old one and ends older sessions; and a
 * fresh session still opens the account.
 *
 * The temporary customer is blocked at the end. The WhatsApp history stays as
 * append-only history; only the one-time reset rows are removed.
 */
import { config } from "dotenv";
config({ path: [".env.local", ".env"], quiet: true });

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { prisma } from "../src/lib/db";
import {
  signCustomerSessionToken,
  verifyCustomerSessionToken,
} from "../src/lib/auth/token";
import { verifySecret } from "../src/lib/password";
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

// The service runs in this process, so force the offline simulator. The Next
// server under test must point at the same database for the HTTP checks.
process.env.FEATURE_WHATSAPP = "true";
process.env.WHATSAPP_PROVIDER = "local";
delete process.env.WHATSAPP_PHONE_NUMBER_ID;
delete process.env.WHATSAPP_ACCESS_TOKEN;

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const CUSTOMER_COOKIE =
  process.env.CUSTOMER_SESSION_COOKIE_NAME?.trim() || "bgd26_customer";

let failures = 0;
let checks = 0;

async function check(label: string, run: () => Promise<void>): Promise<void> {
  checks += 1;
  try {
    await run();
    console.log(`ok   ${label}`);
  } catch (error) {
    failures += 1;
    console.log(`FAIL ${label}\n     ${(error as Error).message}`);
  }
}

async function get(path: string, cookie?: string) {
  const response = await fetch(`${BASE}${path}`, {
    redirect: "manual",
    headers: cookie ? { cookie } : undefined,
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  return {
    status: response.status,
    location: response.headers.get("location") ?? "",
    text: bytes.toString("utf8"),
  };
}

function visible(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ");
}

const run = randomBytes(4).toString("hex");
const mobileSeed = Number(String(Date.now()).slice(-9));
function mobileFor(n: number): string {
  const seed = mobileSeed + n;
  const operator = 3 + (seed % 7);
  const tail = String(seed % 100_000_000).padStart(8, "0");
  return `+8801${operator}${tail}`;
}

function cookieFor(customer: { id: string; mobileNormalized: string }, issuedAt?: number): string {
  return `${CUSTOMER_COOKIE}=${signCustomerSessionToken({
    customerId: customer.id,
    mobile: customer.mobileNormalized,
    ...(issuedAt !== undefined ? { nowSeconds: issuedAt } : {}),
  })}`;
}

const mobile = mobileFor(0);
const unknownMobile = mobileFor(1);
const OLD_PASSWORD = "verify-reset-old1";
const NEW_PASSWORD = "verify-reset-new2";
const CODE = "482615";

const customer = await registerCustomer({
  fullName: `Verify password reset ${run}`,
  mobile,
  password: OLD_PASSWORD,
  confirmPassword: OLD_PASSWORD,
});
const account = { id: customer.id, mobileNormalized: customer.mobile };

// Simulate an account that already existed before this run, so a session from
// an hour ago is valid until the reset actually changes the password.
await prisma.customer.update({
  where: { id: account.id },
  data: { passwordUpdatedAt: new Date(Date.now() - 2 * 60 * 60 * 1000) },
});

// A cookie minted an hour before the reset must stop working afterwards.
const oldSessionIssuedAt = Math.floor(Date.now() / 1000) - 3_600;
const oldCookie = cookieFor(account, oldSessionIssuedAt);

await check("the forgot-password page renders for a guest", async () => {
  const page = await get("/account/forgot-password");
  assert.equal(page.status, 200);
  const text = visible(page.text);
  assert.match(text, /Forgot password/);
  assert.match(text, /WhatsApp/);
});

await check("the reset page renders and explains the sent code", async () => {
  const page = await get(
    `/account/reset-password?mobile=${encodeURIComponent(mobile)}&sent=1`,
  );
  assert.equal(page.status, 200);
  const text = visible(page.text);
  assert.match(text, /Set a new password/);
  assert.match(text, /on its way on WhatsApp/);
});

await check("the login page links to the reset flow", async () => {
  const page = await get("/account/login");
  assert.equal(page.status, 200);
  assert.match(page.text, /href="\/account\/forgot-password"/);
});

await check("an unknown number is ignored and stores nothing", async () => {
  const result = await requestCustomerPasswordReset({
    mobile: unknownMobile,
    code: "000000",
  });
  assert.equal(result.status, "IGNORED");
  assert.equal(
    await prisma.customerPasswordReset.count({
      where: { phoneNumberNormalized: unknownMobile },
    }),
    0,
  );
});

let resetId = "";
await check("requesting a code stores only a hash and a code-free message", async () => {
  const result = await requestCustomerPasswordReset({ mobile, code: CODE });
  assert.equal(result.status, "SENT");
  assert.equal(result.customerId, account.id);

  const reset = await prisma.customerPasswordReset.findFirstOrThrow({
    where: { customerId: account.id },
    orderBy: { createdAt: "desc" },
  });
  resetId = reset.id;
  assert.match(reset.codeHash, /^scrypt\$/);
  assert.notEqual(reset.codeHash, CODE);
  assert.equal(await verifySecret(CODE, reset.codeHash), true);

  const message = await prisma.whatsappMessage.findFirstOrThrow({
    where: { dedupeKey: `password_reset:${reset.id}` },
  });
  assert.equal(message.status, "SENT");
  assert.equal(message.templateName, PASSWORD_RESET_TEMPLATE.name);
  assert.deepEqual(message.templateVariables, []);
  assert.ok(!message.body?.includes(CODE), "the message must not contain the code");
});

await check("a resend inside the cooldown is throttled", async () => {
  const result = await requestCustomerPasswordReset({ mobile, code: "111111" });
  assert.equal(result.status, "THROTTLED");
});

await check("a wrong code is counted without changing the password", async () => {
  await assert.rejects(
    resetCustomerPassword({
      mobile,
      code: "999999",
      newPassword: NEW_PASSWORD,
      confirmPassword: NEW_PASSWORD,
    }),
    (error: unknown) =>
      error instanceof AccountError && /invalid or has expired/.test(error.message),
  );
  const reset = await prisma.customerPasswordReset.findUniqueOrThrow({
    where: { id: resetId },
    select: { attemptCount: true },
  });
  assert.equal(reset.attemptCount, 1);
  const signedIn = await signInCustomer({ mobile, password: OLD_PASSWORD });
  assert.equal(signedIn.id, account.id);
});

await check("the old session is still valid before the password changes", async () => {
  const page = await get("/account", oldCookie);
  assert.equal(page.status, 200);
});

await check("a good code sets a new password and consumes every active code", async () => {
  const result = await resetCustomerPassword({
    mobile,
    code: CODE,
    newPassword: NEW_PASSWORD,
    confirmPassword: NEW_PASSWORD,
  });
  assert.equal(result.customerId, account.id);

  const resets = await prisma.customerPasswordReset.findMany({
    where: { customerId: account.id },
    select: { consumedAt: true },
  });
  assert.ok(resets.length > 0);
  assert.ok(resets.every((row) => row.consumedAt !== null));
});

await check("the old password is rejected and the new one works", async () => {
  await assert.rejects(
    signInCustomer({ mobile, password: OLD_PASSWORD }),
    (error: unknown) => error instanceof AccountError && /incorrect/.test(error.message),
  );
  const signedIn = await signInCustomer({ mobile, password: NEW_PASSWORD });
  assert.equal(signedIn.id, account.id);
});

await check("the session issued before the reset is rejected by the app", async () => {
  const page = await get("/account", oldCookie);
  assert.equal(page.status, 307);
  assert.match(page.location, /\/account\/login/);
});

await check("a fresh session opens the account and the reset banner shows", async () => {
  const fresh = cookieFor(account);
  const payload = verifyCustomerSessionToken(fresh.split("=")[1]);
  assert.ok(payload);
  const row = await prisma.customer.findUniqueOrThrow({
    where: { id: account.id },
    select: { passwordUpdatedAt: true },
  });
  assert.equal(
    sessionPredatesPasswordUpdate(payload.issuedAt, row.passwordUpdatedAt),
    false,
  );

  const page = await get("/account?reset=1", fresh);
  assert.equal(page.status, 200);
  const text = visible(page.text);
  assert.match(text, /password is updated/i);
});

await check("a signed-in customer is redirected away from the reset pages", async () => {
  const fresh = cookieFor(account);
  const forgot = await get("/account/forgot-password", fresh);
  assert.equal(forgot.status, 307);
  assert.equal(forgot.location, "/account");
  const reset = await get("/account/reset-password", fresh);
  assert.equal(reset.status, 307);
  assert.equal(reset.location, "/account");
});

// Cleanup: remove the one-time reset rows and block the temporary customer.
// The WhatsApp message and the password change remain as history.
await prisma.customerPasswordReset.deleteMany({ where: { customerId: account.id } });
await prisma.customer.update({
  where: { id: account.id },
  data: { status: "BLOCKED" },
});

console.log(`\n${checks - failures}/${checks} password-reset checks passed (${PASSWORD_RESET.perHour}/hour cap)`);
if (failures > 0) process.exitCode = 1;
