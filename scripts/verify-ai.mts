/**
 * End-to-end AI assistant verification.
 *
 *   npm run build
 *   STORAGE_PROVIDER=local npm start     # in another terminal
 *   npm run verify:ai
 *
 * Point it elsewhere with BASE_URL=http://localhost:3100 npm run verify:ai
 *
 * Proves over real HTTP that the console is closed to anonymous visitors and to
 * a role without `ai.read`, that the owner sees the provider state, guardrails
 * and draft form, and that the order page exposes the conversion panel. The
 * service checks run the same local adapter and tools the action uses: a
 * product answer comes from the database, delivery reads the zone table, a
 * draft moves no stock or money, and converting it reserves stock and posts a
 * balanced journal.
 *
 * Posted journals are immutable, so the converted sale stays as history. The
 * verification product is archived, the zone deactivated and the users
 * suspended.
 */
import { config } from "dotenv";
config({ path: [".env.local", ".env"], quiet: true });

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { Prisma } from "../src/generated/prisma/client";
import { prisma } from "../src/lib/db";
import { SESSION_VERSION, signSessionToken } from "../src/lib/auth/token";
import { hashSecret } from "../src/lib/password";
import { postOpeningStock } from "../src/lib/inventory/service";
import { runAssistant } from "../src/lib/ai/service";
import {
  convertAiDraft,
  runTool,
} from "../src/lib/ai/tools";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const COOKIE = process.env.SESSION_COOKIE_NAME?.trim() || "bgd26_session";

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

function sessionCookie(user: { id: string; email: string }): string {
  const now = Math.floor(Date.now() / 1000);
  const token = signSessionToken({
    v: SESSION_VERSION,
    userId: user.id,
    email: user.email,
    provider: "local",
    issuedAt: now,
    expiresAt: now + 3_600,
  });
  return `${COOKIE}=${token}`;
}

const [ownerRole, accountantRole, warehouse, category] = await Promise.all([
  prisma.role.findUniqueOrThrow({ where: { code: "OWNER" }, select: { id: true } }),
  prisma.role.findUniqueOrThrow({ where: { code: "ACCOUNTANT" }, select: { id: true } }),
  prisma.warehouse.findFirstOrThrow({
    where: { isDefault: true, isActive: true },
    select: { id: true, code: true },
  }),
  prisma.category.findFirstOrThrow({
    where: { isActive: true },
    orderBy: { sortOrder: "asc" },
    select: { id: true },
  }),
]);

const owner = await prisma.user.create({
  data: {
    email: `verify-ai-${run}@bgd26.test`,
    fullName: `Verify AI owner ${run}`,
    passwordHash: await hashSecret(`VerifyAi-${run}-password`),
    status: "ACTIVE",
    userRoles: { create: { roleId: ownerRole.id } },
  },
  select: { id: true, email: true },
});

const accountant = await prisma.user.create({
  data: {
    email: `verify-ai-accountant-${run}@bgd26.test`,
    fullName: `Verify AI accountant ${run}`,
    passwordHash: await hashSecret(`VerifyAiAccountant-${run}-password`),
    status: "ACTIVE",
    userRoles: { create: { roleId: accountantRole.id } },
  },
  select: { id: true, email: true },
});

const product = await prisma.product.create({
  data: {
    categoryId: category.id,
    name: `Verify AI product ${run}`,
    nameBn: "ভেরিফাই এআই",
    slug: `verify-ai-${run}`,
    basePrice: "115.00",
    status: "ACTIVE",
    isPublished: true,
  },
  select: { id: true },
});

const variant = await prisma.productVariant.create({
  data: {
    productId: product.id,
    sku: `VERIFY-AI-${run.toUpperCase()}`,
    name: "Default",
    price: "115.00",
    costPrice: "80.0000",
    fulfillmentType: "STOCKED",
  },
  select: { id: true, sku: true },
});

await postOpeningStock({
  variantId: variant.id,
  warehouseId: warehouse.id,
  quantity: "30",
  unitCost: "80",
  note: `AI verification opening ${run}`,
  actorUserId: owner.id,
});

const zone = await prisma.deliveryZone.create({
  data: {
    name: `Verify AI zone ${run}`,
    division: "Dhaka",
    district: "Dhaka",
    charge: "70.00",
    freeShippingThreshold: "1000.00",
    estimatedDaysMin: 1,
    estimatedDaysMax: 2,
  },
  select: { id: true, name: true },
});

const permissions = new Set([
  "ai.read",
  "ai.write",
  "product.read",
  "order.read",
  "order.write",
]);

const customerMobile = mobileFor(1);
const draftResult = await runTool(
  "create_draft_order",
  {
    customerName: `Verify AI customer ${run}`,
    customerMobile,
    items: [{ sku: variant.sku, quantity: 2 }],
    deliveryZoneId: zone.id,
    address: "House 9, Road 3, Dhaka",
  },
  { actorUserId: owner.id, permissions },
);
assert.equal(draftResult.ok, true, draftResult.error ?? "draft failed");
const draft = (draftResult.data as { draft: { id: string; orderNumber: string } }).draft;

const ownerCookie = sessionCookie(owner);
const accountantCookie = sessionCookie(accountant);

await check("an anonymous visitor is sent to the staff login", async () => {
  const page = await get("/assistant");
  assert.equal(page.status, 307);
  assert.match(page.location, /\/login/);
});

await check("a role without ai.read is sent to the forbidden screen", async () => {
  const page = await get("/assistant", accountantCookie);
  assert.equal(page.status, 307);
  assert.match(page.location, /\/forbidden/);
});

await check("the owner sees the assistant, provider and draft form", async () => {
  const page = await get("/assistant", ownerCookie);
  assert.equal(page.status, 200);
  const text = visible(page.text);
  assert.match(text, /Assistant · সহায়ক/);
  assert.match(text, /Assistant online/);
  assert.match(text, /local/);
  assert.match(text, /read \+ draft only/);
  assert.match(text, /Create a draft order/);
  assert.match(text, /Every call is in/);
});

await check("the assistant page offers product, delivery and order prompts", async () => {
  const page = await get("/assistant", ownerCookie);
  const text = visible(page.text);
  assert.match(text, /চালের দাম কত/);
  assert.match(text, /Dhaka delivery charge/);
  assert.match(text, /Show order SO-/);
});

await check("the assistant draft appears with its review banner", async () => {
  const page = await get(`/orders/${draft.id}`, ownerCookie);
  assert.equal(page.status, 200);
  const text = visible(page.text);
  assert.match(text, new RegExp(draft.orderNumber));
  assert.match(text, /Assistant draft/);
  assert.match(text, /reserved no stock/);
  assert.match(text, /Convert draft to sale/);
});

await check("a product question is answered from the live catalogue", async () => {
  const result = await runAssistant({
    actorUserId: owner.id,
    conversationKey: `verify-ai-search-${run}`,
    messages: [{ role: "user", content: `price of ${variant.sku}` }],
    permissions,
  });
  assert.equal(result.ok, true);
  assert.equal(result.tools[0]?.name, "search_products");
  assert.match(result.reply, /115\.00/);
  assert.match(result.reply, new RegExp(variant.sku, "i"));
});

await check("a delivery question reads the zone table and free threshold", async () => {
  const paid = await runTool(
    "quote_delivery",
    { zone: zone.name, subtotal: 500 },
    { actorUserId: owner.id, permissions },
  );
  assert.equal(paid.ok, true);
  const paidZone = (paid.data as {
    zones: Array<{ id: string; effectiveCharge: string }>;
  }).zones.find((entry) => entry.id === zone.id);
  assert.equal(paidZone?.effectiveCharge, "70.00");

  const free = await runTool(
    "quote_delivery",
    { zone: zone.name, subtotal: 1_500 },
    { actorUserId: owner.id, permissions },
  );
  const freeZone = (free.data as {
    zones: Array<{ id: string; effectiveCharge: string }>;
  }).zones.find((entry) => entry.id === zone.id);
  assert.equal(freeZone?.effectiveCharge, "0.00");
});

await check("the draft moved no stock, payment or journal", async () => {
  const order = await prisma.order.findUniqueOrThrow({
    where: { id: draft.id },
    include: { items: true, payments: true },
  });
  assert.equal(order.status, "DRAFT");
  assert.equal(order.aiDraft, true);
  assert.equal(order.source, "AI_DRAFT");
  assert.equal(order.payments.length, 0);
  assert.equal(
    await prisma.stockLedger.count({ where: { referenceId: draft.id } }),
    0,
  );
  assert.equal(
    await prisma.journalEntry.count({
      where: { referenceType: "order", referenceId: draft.id },
    }),
    0,
  );
});

await check("converting the draft creates a real sale and posts a balance", async () => {
  const before = await prisma.inventoryBalance.findFirstOrThrow({
    where: { variantId: variant.id },
    select: { availableQty: true },
  });
  const sale = await convertAiDraft({
    draftOrderId: draft.id,
    paymentMethod: "COD",
    actorUserId: owner.id,
  });
  const order = await prisma.order.findUniqueOrThrow({
    where: { id: sale.orderId },
    include: { payments: true },
  });
  assert.equal(order.status, "CONFIRMED");
  assert.equal(order.paymentStatus, "PENDING_VERIFICATION");
  assert.equal(order.aiDraft, false);
  assert.equal(order.payments[0]?.status, "PENDING_VERIFICATION");

  const after = await prisma.inventoryBalance.findFirstOrThrow({
    where: { variantId: variant.id },
    select: { availableQty: true },
  });
  assert.equal(Number(before.availableQty) - Number(after.availableQty), 2);

  const journal = await prisma.journalEntry.findFirstOrThrow({
    where: { referenceType: "order", referenceId: sale.orderId },
    include: { lines: true },
  });
  const debit = journal.lines.reduce(
    (sum, line) => sum.add(line.debit),
    new Prisma.Decimal(0),
  );
  const credit = journal.lines.reduce(
    (sum, line) => sum.add(line.credit),
    new Prisma.Decimal(0),
  );
  assert.equal(debit.toString(), credit.toString());

  const cancelled = await prisma.order.findUniqueOrThrow({
    where: { id: draft.id },
    select: { status: true, cancelReason: true },
  });
  assert.equal(cancelled.status, "CANCELLED");
  assert.match(cancelled.cancelReason ?? "", new RegExp(sale.orderNumber));
});

await check("an order answer masks the customer's mobile", async () => {
  const sale = await prisma.order.findFirstOrThrow({
    where: { customer: { mobileNormalized: customerMobile } },
    orderBy: { createdAt: "desc" },
    select: { id: true, orderNumber: true },
  });
  const result = await runTool(
    "get_order_status",
    { orderNumber: sale.orderNumber },
    { actorUserId: owner.id, permissions },
  );
  assert.equal(result.ok, true);
  const data = result.data as { order: { mobileMasked: string } };
  assert.ok(!data.order.mobileMasked.includes(customerMobile));
  assert.match(data.order.mobileMasked, /\*/);

  const log = await prisma.aiActionLog.findFirstOrThrow({
    where: { actorUserId: owner.id, toolName: "get_order_status" },
    orderBy: { createdAt: "desc" },
    select: { output: true },
  });
  assert.ok(!JSON.stringify(log.output).includes(customerMobile));
});

await check("an unknown tool is refused and recorded", async () => {
  const result = await runTool(
    "run_sql",
    { sql: "delete from orders" },
    { actorUserId: owner.id, permissions },
  );
  assert.equal(result.ok, false);
  assert.equal(result.status, "BLOCKED");
  const log = await prisma.aiActionLog.findFirstOrThrow({
    where: { actorUserId: owner.id, toolName: "run_sql" },
    select: { status: true },
  });
  assert.equal(log.status, "BLOCKED");
});

// Cleanup: archive the product, deactivate the zone and suspend the users.
// Orders, journals and assistant audit rows stay as immutable history.
await prisma.product.update({
  where: { id: product.id },
  data: { status: "ARCHIVED", isPublished: false, archivedAt: new Date() },
});
await prisma.productVariant.update({
  where: { id: variant.id },
  data: { status: "ARCHIVED" },
});
await prisma.deliveryZone.update({
  where: { id: zone.id },
  data: { isActive: false },
});
await prisma.customer.updateMany({
  where: { mobileNormalized: customerMobile },
  data: { status: "BLOCKED" },
});
await prisma.user.updateMany({
  where: { id: { in: [owner.id, accountant.id] } },
  data: { status: "SUSPENDED" },
});

console.log(`\n${checks - failures}/${checks} assistant checks passed`);
if (failures > 0) process.exitCode = 1;
