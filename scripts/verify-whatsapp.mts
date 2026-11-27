/**
 * End-to-end WhatsApp verification (module 4c).
 *
 *   npm run build
 *   STORAGE_PROVIDER=local npm start     # in another terminal
 *   npm run verify:whatsapp
 *
 * Point it elsewhere with BASE_URL=http://localhost:3100 npm run verify:whatsapp
 *
 * Proves over real HTTP and the real database that: the console is closed to
 * anonymous visitors and to a cashier, the owner sees the inbox, queue,
 * templates and consent screens; an online checkout records opt-in and sends
 * one order-confirmation template through the local adapter; the event dedupe
 * key prevents a second send; an opt-out skips the next event and cannot be
 * flipped back by another order; a signed delivery receipt moves the row to
 * DELIVERED; a STOP reply opts the customer out; a retryable failure returns to
 * the queue with backoff; a live adapter refuses a PENDING template; and the
 * worker endpoint requires its secret.
 *
 * The temporary product is archived; test users are suspended. Orders and the
 * WhatsApp history stay as append-only history.
 */
import { config } from "dotenv";
config({ path: [".env.local", ".env"], quiet: true });

import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { prisma } from "../src/lib/db";
import { SESSION_VERSION, signSessionToken } from "../src/lib/auth/token";
import { postOpeningStock } from "../src/lib/inventory/service";
import { createSale } from "../src/lib/orders/service";
import {
  dispatchMessage,
  handleWebhook,
  queueOrderNotification,
  recordConsent,
  recordOrderConsent,
} from "../src/lib/whatsapp/service";
import {
  WhatsAppError,
  type WhatsAppAdapter,
} from "../src/lib/adapters/whatsapp";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const COOKIE = process.env.SESSION_COOKIE_NAME?.trim() || "bgd26_session";
const APP_SECRET = `verify-whatsapp-${randomBytes(8).toString("hex")}`;

// The webhook runs in this process, not the server, so it can verify a signed
// body even though the deployed app has no Meta secret yet.
process.env.WHATSAPP_APP_SECRET = APP_SECRET;

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

function sessionCookie(user: { id: string; email: string }): string {
  const now = Math.floor(Date.now() / 1000);
  const token = signSessionToken({
    v: SESSION_VERSION,
    userId: user.id,
    email: user.email,
    provider: "local",
    issuedAt: now,
    expiresAt: now + 3600,
  });
  return `${COOKIE}=${token}`;
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

/** Visible text of a server-rendered page, without tags. */
function visible(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function sign(body: string): string {
  return `sha256=${createHmac("sha256", APP_SECRET).update(body, "utf8").digest("hex")}`;
}

async function webhook(body: unknown) {
  const rawBody = JSON.stringify(body);
  return handleWebhook({ rawBody, signatureHeader: sign(rawBody) });
}

const run = randomBytes(4).toString("hex");
const mobileSeed = Number(String(Date.now()).slice(-9));

function mobileFor(n: number): string {
  const seed = mobileSeed + n;
  const operator = 3 + (seed % 7);
  const tail = String(seed % 100_000_000).padStart(8, "0");
  return `+8801${operator}${tail}`;
}

const [ownerRole, cashierRole, category, warehouse] = await Promise.all([
  prisma.role.findUniqueOrThrow({ where: { code: "OWNER" }, select: { id: true } }),
  prisma.role.findUniqueOrThrow({ where: { code: "CASHIER" }, select: { id: true } }),
  prisma.category.findFirstOrThrow({
    where: { isActive: true },
    orderBy: { sortOrder: "asc" },
    select: { id: true },
  }),
  prisma.warehouse.findFirstOrThrow({
    where: { isDefault: true, isActive: true },
    select: { id: true },
  }),
]);

const owner = await prisma.user.create({
  data: {
    email: `verify-whatsapp-${run}@bgd26.test`,
    fullName: `Verify WhatsApp owner ${run}`,
    passwordHash: "not-used-by-this-script",
    status: "ACTIVE",
    userRoles: { create: { roleId: ownerRole.id } },
  },
  select: { id: true, email: true },
});

const cashier = await prisma.user.create({
  data: {
    email: `verify-whatsapp-cashier-${run}@bgd26.test`,
    fullName: `Verify WhatsApp cashier ${run}`,
    passwordHash: "not-used-by-this-script",
    status: "ACTIVE",
    userRoles: { create: { roleId: cashierRole.id } },
  },
  select: { id: true, email: true },
});

const ownerCookie = sessionCookie(owner);
const cashierCookie = sessionCookie(cashier);

const product = await prisma.product.create({
  data: {
    categoryId: category.id,
    name: `Verify WhatsApp product ${run}`,
    nameBn: "ভেরিফাই হোয়াটসঅ্যাপ",
    slug: `verify-whatsapp-${run}`,
    basePrice: "115.00",
    status: "ACTIVE",
    isPublished: true,
  },
  select: { id: true },
});

const variant = await prisma.productVariant.create({
  data: {
    productId: product.id,
    sku: `VERIFY-WA-${run.toUpperCase()}`,
    name: "Default",
    price: "115.00",
    costPrice: "80.0000",
    fulfillmentType: "STOCKED",
    status: "ACTIVE",
  },
  select: { id: true },
});

await postOpeningStock({
  variantId: variant.id,
  warehouseId: warehouse.id,
  quantity: "5",
  unitCost: "80",
  note: `WhatsApp verification opening ${run}`,
  actorUserId: owner.id,
});

const customerMobile = mobileFor(1);
const customerName = `Verify WhatsApp buyer ${run}`;

const sale = await createSale({
  source: "WEB",
  warehouseId: warehouse.id,
  customerMobile,
  customerName,
  recipientName: customerName,
  recipientMobile: customerMobile,
  shippingAddress: {
    address: "House 9, Road 4, Dhanmondi",
    division: "Dhaka",
    district: "Dhaka",
  },
  lines: [{ variantId: variant.id, quantity: 1 }],
  deliveryCharge: "60",
  payments: [{ method: "COD" }],
  actorUserId: owner.id,
  clientTransactionUuid: `verify-whatsapp-${run}`,
});

const confirmation = await prisma.whatsappMessage.findUniqueOrThrow({
  where: { dedupeKey: `ORDER_CONFIRMED:${sale.orderId}` },
  select: {
    id: true,
    status: true,
    waMessageId: true,
    templateName: true,
    templateLanguage: true,
    attemptCount: true,
    relatedOrderId: true,
    conversationId: true,
    body: true,
  },
});

/* -------------------------------------------------------------------------- */
/* Access control                                                             */
/* -------------------------------------------------------------------------- */

await check("an anonymous visitor is sent to login from WhatsApp", async () => {
  const page = await get("/whatsapp");
  assert.equal(page.status, 307);
  assert.match(page.location, /\/login/);
});

await check("a cashier has no WhatsApp access by default", async () => {
  const page = await get("/whatsapp", cashierCookie);
  assert.equal(page.status, 307);
  assert.match(page.location, /\/forbidden/);

  const consents = await get("/whatsapp/consents", cashierCookie);
  assert.equal(consents.status, 307);
  assert.match(consents.location, /\/forbidden/);
});

await check("the owner sees the live provider state and the new conversation", async () => {
  const page = await get("/whatsapp", ownerCookie);
  assert.equal(page.status, 200);
  const text = visible(page.text);
  assert.match(text, /Local simulator|Cloud API live/);
  assert.match(text, new RegExp(customerName));
  assert.match(text, /opted in/);
});

await check("the queue page shows the event, settings and the send button", async () => {
  const page = await get("/whatsapp/queue", ownerCookie);
  assert.equal(page.status, 200);
  const text = visible(page.text);
  assert.match(text, /Automatic notifications/);
  assert.match(text, /Order confirmed/);
  assert.match(text, /Send queued now/);
  assert.match(text, /Requeue failed|Retry/);
});

await check("the template registry lists the shipped defaults and approval state", async () => {
  const page = await get("/whatsapp/templates", ownerCookie);
  assert.equal(page.status, 200);
  const text = visible(page.text);
  assert.match(text, /order_confirmation/);
  assert.match(text, /order_shipped/);
  assert.match(text, /APPROVED|PENDING|REJECTED|PAUSED/);
});

await check("the consent page lists the online-checkout opt-in", async () => {
  const page = await get("/whatsapp/consents", ownerCookie);
  assert.equal(page.status, 200);
  const text = visible(page.text);
  assert.match(text, new RegExp(customerName));
  assert.match(text, /online checkout/);
  assert.match(text, /opted in/);
});

/* -------------------------------------------------------------------------- */
/* Queue and consent                                                          */
/* -------------------------------------------------------------------------- */

await check("an online checkout records opt-in and sends one confirmation", async () => {
  assert.equal(confirmation.relatedOrderId, sale.orderId);
  assert.equal(confirmation.status, "SENT");
  assert.match(confirmation.waMessageId ?? "", /^local_/);
  assert.equal(confirmation.templateName, "order_confirmation");
  assert.equal(confirmation.templateLanguage, "bn");
  assert.equal(confirmation.attemptCount, 1);
  assert.match(confirmation.body ?? "", new RegExp(sale.orderNumber));

  const consent = await prisma.whatsappConsent.findFirstOrThrow({
    where: { customerId: sale.customerId },
    select: { status: true, source: true },
  });
  assert.equal(consent.status, "OPTED_IN");
  assert.equal(consent.source, "online_checkout");
});

await check("the event dedupe key refuses to queue a second confirmation", async () => {
  const again = await queueOrderNotification({
    event: "ORDER_CONFIRMED",
    orderId: sale.orderId,
    actorUserId: owner.id,
  });
  assert.equal(again.status, "DUPLICATE");
  assert.equal(again.messageId, confirmation.id);

  const count = await prisma.whatsappMessage.count({
    where: { dedupeKey: `ORDER_CONFIRMED:${sale.orderId}` },
  });
  assert.equal(count, 1);
});

await check("an opt-out skips the next event and an order cannot flip it back", async () => {
  await recordConsent({
    mobile: customerMobile,
    status: "OPTED_OUT",
    source: "phone_call",
  });

  // Another online checkout would normally record opt-in; an explicit opt-out
  // wins because the unique row already exists.
  await recordOrderConsent(sale.customerId, customerMobile, "online_checkout");
  const consent = await prisma.whatsappConsent.findFirstOrThrow({
    where: { customerId: sale.customerId },
    select: { status: true, source: true },
  });
  assert.equal(consent.status, "OPTED_OUT");
  assert.equal(consent.source, "phone_call");

  const skipped = await queueOrderNotification({
    event: "ORDER_SHIPPED",
    orderId: sale.orderId,
    actorUserId: owner.id,
  });
  assert.equal(skipped.status, "SKIPPED");
  assert.match(skipped.reason ?? "", /opted out/i);

  const row = await prisma.whatsappMessage.findFirstOrThrow({
    where: { dedupeKey: `ORDER_SHIPPED:${sale.orderId}:skipped` },
    select: { status: true, errorMessage: true },
  });
  assert.equal(row.status, "SKIPPED");
  assert.match(row.errorMessage ?? "", /opted out/i);
});

/* -------------------------------------------------------------------------- */
/* Webhook and retry                                                          */
/* -------------------------------------------------------------------------- */

await check("a signed delivery receipt moves the confirmation to DELIVERED", async () => {
  const body = {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "verify-waba",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { phone_number_id: "verify-phone" },
              statuses: [
                {
                  id: confirmation.waMessageId,
                  status: "delivered",
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  recipient_id: customerMobile.replace("+", ""),
                },
              ],
            },
          },
        ],
      },
    ],
  };
  const result = await webhook(body);
  assert.equal(result.statuses, 1);

  const row = await prisma.whatsappMessage.findUniqueOrThrow({
    where: { id: confirmation.id },
    select: { status: true },
  });
  assert.equal(row.status, "DELIVERED");
});

await check("an unsigned or tampered webhook body is rejected", async () => {
  const rawBody = JSON.stringify({ object: "whatsapp_business_account", entry: [] });
  await assert.rejects(
    handleWebhook({ rawBody, signatureHeader: "sha256=deadbeef" }),
    (error: unknown) => error instanceof Error && /signature/i.test(error.message),
  );
  await assert.rejects(
    handleWebhook({ rawBody: `${rawBody} `, signatureHeader: sign(rawBody) }),
    (error: unknown) => error instanceof Error && /signature/i.test(error.message),
  );
});

await check("a STOP reply opts the customer out and a duplicate is ignored", async () => {
  await recordConsent({ mobile: customerMobile, status: "OPTED_IN", source: "staff" });

  const id = `wamid.verify-${run}`;
  const body = {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "verify-waba",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { phone_number_id: "verify-phone" },
              contacts: [{ profile: { name: customerName }, wa_id: customerMobile.replace("+", "") }],
              messages: [
                {
                  from: customerMobile.replace("+", ""),
                  id,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  type: "text",
                  text: { body: "STOP" },
                },
              ],
            },
          },
        ],
      },
    ],
  };

  const first = await webhook(body);
  assert.equal(first.messages, 1);
  assert.equal(first.optOuts, 1);

  const consent = await prisma.whatsappConsent.findFirstOrThrow({
    where: { customerId: sale.customerId },
    select: { status: true, source: true },
  });
  assert.equal(consent.status, "OPTED_OUT");
  assert.equal(consent.source, "whatsapp_keyword");

  const second = await webhook(body);
  assert.equal(second.duplicates, 1);
});

await check("a retryable failure returns to the queue with backoff", async () => {
  const message = await prisma.whatsappMessage.create({
    data: {
      conversationId: confirmation.conversationId,
      direction: "OUTBOUND",
      messageType: "TEXT",
      body: `Retry verification ${run}`,
      status: "QUEUED",
      recipient: customerMobile,
      event: "MANUAL",
      dedupeKey: `verify-retry:${run}`,
      nextAttemptAt: new Date(),
      maxAttempts: 3,
    },
    select: { id: true },
  });

  const failing: WhatsAppAdapter = {
    provider: "local",
    live: false,
    async sendTemplate() {
      throw new Error("not used");
    },
    async sendText() {
      throw new WhatsAppError("Meta is briefly unavailable.", {
        code: "META_503",
        httpStatus: 503,
        retryable: true,
      });
    },
    verifySignature() {
      return false;
    },
  };

  const result = await dispatchMessage(message.id, failing);
  assert.equal(result.status, "QUEUED");

  const row = await prisma.whatsappMessage.findUniqueOrThrow({
    where: { id: message.id },
    select: {
      status: true,
      attemptCount: true,
      nextAttemptAt: true,
      errorCode: true,
      lockedAt: true,
    },
  });
  assert.equal(row.status, "QUEUED");
  assert.equal(row.attemptCount, 1);
  assert.equal(row.errorCode, "META_503");
  assert.equal(row.lockedAt, null);
  assert.ok(row.nextAttemptAt && row.nextAttemptAt.getTime() > Date.now());

  // Do not leave a synthetic retry row for the cron to send to a test number.
  await prisma.whatsappMessage.delete({ where: { id: message.id } });
});

await check("a live adapter refuses a template that is not APPROVED", async () => {
  const pending = await prisma.whatsappTemplate.findFirstOrThrow({
    where: { status: { not: "APPROVED" } },
    select: { id: true, name: true, language: true },
  });
  const message = await prisma.whatsappMessage.create({
    data: {
      conversationId: confirmation.conversationId,
      direction: "OUTBOUND",
      messageType: "TEMPLATE",
      status: "QUEUED",
      recipient: customerMobile,
      event: "MANUAL",
      templateId: pending.id,
      templateName: pending.name,
      templateLanguage: pending.language,
      templateVariables: [],
      dedupeKey: `verify-pending:${run}`,
      nextAttemptAt: new Date(),
      maxAttempts: 1,
    },
    select: { id: true },
  });

  let called = false;
  const live: WhatsAppAdapter = {
    provider: "cloud",
    live: true,
    async sendTemplate() {
      called = true;
      return { waMessageId: "should-not-happen" };
    },
    async sendText() {
      called = true;
      return { waMessageId: "should-not-happen" };
    },
    verifySignature() {
      return true;
    },
  };

  const result = await dispatchMessage(message.id, live);
  assert.equal(result.status, "FAILED");
  assert.equal(called, false);

  const row = await prisma.whatsappMessage.findUniqueOrThrow({
    where: { id: message.id },
    select: { status: true, errorCode: true },
  });
  assert.equal(row.status, "FAILED");
  assert.equal(row.errorCode, "TEMPLATE_NOT_APPROVED");

  await prisma.whatsappMessage.delete({ where: { id: message.id } });
});

await check("the worker endpoint refuses an anonymous caller and accepts its secret", async () => {
  const anonymous = await fetch(`${BASE}/api/whatsapp/worker`, { redirect: "manual" });
  assert.equal(anonymous.status, 401);

  const wrong = await fetch(`${BASE}/api/whatsapp/worker`, {
    redirect: "manual",
    headers: { authorization: "Bearer not-the-secret" },
  });
  assert.equal(wrong.status, 401);

  const secret = process.env.CRON_SECRET?.trim() || process.env.WHATSAPP_WORKER_SECRET?.trim();
  if (secret) {
    const accepted = await fetch(`${BASE}/api/whatsapp/worker?limit=1`, {
      redirect: "manual",
      headers: { authorization: `Bearer ${secret}` },
    });
    assert.equal(accepted.status, 200);
    const payload = (await accepted.json()) as { ok?: boolean };
    assert.equal(payload.ok, true);
  }
});

/* -------------------------------------------------------------------------- */
/* Clean up what can be cleaned up; history stays by design.                  */
/* -------------------------------------------------------------------------- */

await prisma.product.update({
  where: { id: product.id },
  data: { status: "ARCHIVED", isPublished: false, archivedAt: new Date() },
});
await prisma.productVariant.update({
  where: { id: variant.id },
  data: { status: "ARCHIVED" },
});
await prisma.user.updateMany({
  where: { id: { in: [owner.id, cashier.id] } },
  data: { status: "SUSPENDED" },
});

console.log(`\n${checks - failures}/${checks} WhatsApp checks passed`);
if (failures > 0) process.exitCode = 1;
