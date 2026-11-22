/**
 * End-to-end shipping verification.
 *
 *   npm run build
 *   STORAGE_PROVIDER=local npm start     # in another terminal
 *   npm run verify:shipping
 *
 * Point it elsewhere with BASE_URL=http://localhost:3100 npm run verify:shipping
 *
 * Proves over real HTTP: the shipments list, courier registry and COD remittance
 * page render for staff and refuse an anonymous visitor; a ready-to-ship order
 * can be booked, appears on the order page and its own page; a pickup event
 * moves the order to shipped and a delivery event to delivered; a booked
 * shipment can be cancelled and rebooked; an un-wired provider adapter says so;
 * and a COD remittance posts a balanced journal that clears account 1060.
 *
 * Posted journals are immutable, so this run's entries stay in the ledger; the
 * verification product is archived and the temporary courier deactivated.
 */
import { config } from "dotenv";
config({ path: [".env.local", ".env"], quiet: true });

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { prisma } from "../src/lib/db";
import { SESSION_VERSION, signSessionToken } from "../src/lib/auth/token";
import { postOpeningStock } from "../src/lib/inventory/service";
import { createSale, setOrderStatus } from "../src/lib/orders/service";
import {
  addTrackingEvent,
  cancelShipment,
  createCourier,
  createShipment,
  postCodRemittance,
} from "../src/lib/shipping/service";

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

const run = randomBytes(4).toString("hex");
const mobileSeed = Number(String(Date.now()).slice(-9));

function mobileFor(n: number): string {
  const seed = mobileSeed + n;
  const operator = 3 + (seed % 7);
  const tail = String(seed % 100_000_000).padStart(8, "0");
  return `+8801${operator}${tail}`;
}

const [ownerRole, cashierRole, category, warehouse] =
  await Promise.all([
    prisma.role.findUniqueOrThrow({ where: { code: "OWNER" }, select: { id: true } }),
    prisma.role.findUniqueOrThrow({ where: { code: "CASHIER" }, select: { id: true } }),
    prisma.category.findFirstOrThrow({
      where: { isActive: true },
      orderBy: { sortOrder: "asc" },
      select: { id: true },
    }),
    prisma.warehouse.findFirstOrThrow({
      where: { isDefault: true, isActive: true },
      select: { id: true, code: true },
    }),
  ]);

const owner = await prisma.user.create({
  data: {
    email: `verify-shipping-${run}@bgd26.test`,
    fullName: `Verify shipping owner ${run}`,
    passwordHash: "not-used-by-this-script",
    status: "ACTIVE",
    userRoles: { create: { roleId: ownerRole.id } },
  },
  select: { id: true, email: true },
});

const cashier = await prisma.user.create({
  data: {
    email: `verify-shipping-cashier-${run}@bgd26.test`,
    fullName: `Verify shipping cashier ${run}`,
    passwordHash: "not-used-by-this-script",
    status: "ACTIVE",
    userRoles: { create: { roleId: cashierRole.id } },
  },
  select: { id: true, email: true },
});

const ownerCookie = sessionCookie(owner);
const cashierCookie = sessionCookie(cashier);

const category2 = await prisma.product.create({
  data: {
    categoryId: category.id,
    name: `Verify shipping product ${run}`,
    nameBn: "ভেরিফাই চালান",
    slug: `verify-shipping-${run}`,
    basePrice: "115.00",
    status: "ACTIVE",
    isPublished: true,
  },
  select: { id: true },
});

const variant = await prisma.productVariant.create({
  data: {
    productId: category2.id,
    sku: `VERIFY-SHP-${run.toUpperCase()}`,
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
  quantity: "20",
  unitCost: "80",
  note: `Shipping verification opening ${run}`,
  actorUserId: owner.id,
});

const courier = await createCourier({
  code: `VERIFY-${run.toUpperCase()}`,
  name: `Verify courier ${run}`,
  provider: "MANUAL",
  supportsCod: true,
  supportsDropship: false,
  isActive: true,
});

async function readyOrder(suffix: string, index: number) {
  const mobile = mobileFor(index);
  const sale = await createSale({
    source: "WEB",
    warehouseId: warehouse.id,
    customerMobile: mobile,
    customerName: `Verify shipping buyer ${run} ${suffix}`,
    recipientName: `Verify shipping buyer ${run} ${suffix}`,
    recipientMobile: mobile,
    shippingAddress: {
      address: "House 9, Road 4, Dhanmondi",
      division: "Dhaka",
      district: "Dhaka",
    },
    lines: [{ variantId: variant.id, quantity: 1 }],
    deliveryCharge: "60",
    payments: [{ method: "COD" }],
    actorUserId: owner.id,
    clientTransactionUuid: `verify-shipping-${run}-${suffix}`,
  });
  await setOrderStatus(sale.orderId, "READY_TO_SHIP", owner.id);
  return sale;
}

const first = await readyOrder("a", 1);

let firstShipmentId = "";
let firstShipmentNumber = "";

await check("an anonymous visitor is sent to login from shipping", async () => {
  const page = await get("/shipping");
  assert.equal(page.status, 307);
  assert.match(page.location, /\/login/);
});

await check("the shipments list renders for staff", async () => {
  const page = await get("/shipping", ownerCookie);
  assert.equal(page.status, 200);
  const text = visible(page.text);
  assert.match(text, /Shipments/);
  assert.match(text, /Book a shipment/);
  assert.match(text, /COD remittance/);
});

await check("a ready-to-ship order is booked and appears on its own page", async () => {
  const shipment = await createShipment({
    orderId: first.orderId,
    courierId: courier.id,
    trackingNumber: `TRK-${run}`,
    note: "Verification booking",
    actorUserId: owner.id,
  });
  firstShipmentId = shipment.id;
  firstShipmentNumber = shipment.shipmentNumber;

  const page = await get(`/shipping/${shipment.id}`, ownerCookie);
  assert.equal(page.status, 200);
  const text = visible(page.text);
  assert.match(text, new RegExp(shipment.shipmentNumber));
  assert.match(text, new RegExp(`TRK-${run}`));
  assert.match(text, new RegExp(first.orderNumber));
  assert.match(text, /COD/);
});

await check("the order page shows the shipment and no longer offers a new booking", async () => {
  const page = await get(`/orders/${first.orderId}`, ownerCookie);
  assert.equal(page.status, 200);
  const text = visible(page.text);
  assert.match(text, new RegExp(firstShipmentNumber));
  assert.doesNotMatch(text, /Book shipment/);
});

await check("a pickup event moves the order to shipped", async () => {
  await addTrackingEvent({
    shipmentId: firstShipmentId,
    status: "PICKED_UP",
    location: "Dhaka hub",
    actorUserId: owner.id,
  });
  const order = await prisma.order.findUniqueOrThrow({
    where: { id: first.orderId },
    select: { status: true },
  });
  assert.equal(order.status, "SHIPPED");

  const page = await get(`/shipping/${firstShipmentId}`, ownerCookie);
  assert.equal(page.status, 200);
  assert.match(visible(page.text), /Picked up/);
});

await check("a delivery event moves the order to delivered", async () => {
  await addTrackingEvent({
    shipmentId: firstShipmentId,
    status: "DELIVERED",
    actorUserId: owner.id,
  });
  const order = await prisma.order.findUniqueOrThrow({
    where: { id: first.orderId },
    select: { status: true },
  });
  assert.equal(order.status, "DELIVERED");

  const page = await get(`/orders/${first.orderId}`, ownerCookie);
  assert.equal(page.status, 200);
  assert.match(visible(page.text), /Delivered/);
});

await check("a booked shipment can be cancelled and rebooked", async () => {
  const second = await readyOrder("b", 2);
  const booked = await createShipment({
    orderId: second.orderId,
    courierId: courier.id,
    actorUserId: owner.id,
  });
  await cancelShipment(booked.id, owner.id, "Verification cancellation");

  const page = await get(`/shipping/${booked.id}`, ownerCookie);
  assert.equal(page.status, 200);
  assert.match(visible(page.text), /Cancelled/);

  const rebooked = await createShipment({
    orderId: second.orderId,
    courierId: courier.id,
    actorUserId: owner.id,
  });
  assert.notEqual(rebooked.id, booked.id);
});

await check("the courier registry says which adapters are wired", async () => {
  const page = await get("/shipping/couriers", ownerCookie);
  assert.equal(page.status, 200);
  const text = visible(page.text);
  assert.match(text, /Manual \/ own delivery/);
  assert.match(text, /Pathao Courier/);
  assert.match(text, /Adapter ready/);
  assert.match(text, /Manual entry only/);
});

await check("a cashier reads shipments but cannot open the booking form", async () => {
  const list = await get("/shipping", cashierCookie);
  assert.equal(list.status, 200);

  const booking = await get("/shipping/new", cashierCookie);
  assert.equal(booking.status, 307);
  assert.match(booking.location, /\/forbidden/);
});

await check("a COD remittance posts a balanced journal that clears 1060", async () => {
  const result = await postCodRemittance({
    courierId: courier.id,
    amount: "175.00",
    destination: "BANK",
    reference: `PAYOUT-${run}`,
    note: "Verification remittance",
    actorUserId: owner.id,
  });
  assert.ok(result.journalEntryId);

  const entry = await prisma.journalEntry.findUniqueOrThrow({
    where: { id: result.journalEntryId },
    include: { lines: { include: { account: { select: { code: true } } } } },
  });
  assert.equal(entry.status, "POSTED");
  assert.equal(entry.referenceType, "cod_remittance");
  assert.equal(entry.totalDebit.toFixed(2), "175.00");
  assert.equal(entry.totalCredit.toFixed(2), "175.00");

  const byCode = new Map(
    entry.lines.map((line) => [line.account.code, line]),
  );
  assert.equal(byCode.get("1010")?.debit.toFixed(2), "175.00");
  assert.equal(byCode.get("1060")?.credit.toFixed(2), "175.00");

  const page = await get("/shipping/remittances", ownerCookie);
  assert.equal(page.status, 200);
  const text = visible(page.text);
  assert.match(text, new RegExp(`PAYOUT-${run}`));
  assert.match(text, /175\.00/);
});

// ---------------------------------------------------------------------------
// Clean up what can be cleaned up; history stays by design.
// ---------------------------------------------------------------------------

await prisma.courier.update({ where: { id: courier.id }, data: { isActive: false } });
await prisma.product.update({
  where: { id: category2.id },
  data: { status: "ARCHIVED", isPublished: false, archivedAt: new Date() },
});

console.log(`\n${checks - failures}/${checks} shipping checks passed`);
if (failures > 0) process.exitCode = 1;
