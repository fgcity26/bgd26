/**
 * End-to-end storefront verification.
 *
 *   npm run build
 *   STORAGE_PROVIDER=local npm start     # in another terminal
 *   npm run verify:storefront
 *
 * Point it elsewhere with BASE_URL=http://localhost:3100 npm run verify:storefront
 *
 * Proves over real HTTP: the public home, shop, product and track pages render
 * without a session; a draft product is 404; cost price never reaches the HTML;
 * the cart and checkout pages read the guest cart cookie; the coupon API quotes
 * a saving; a COD order is created through the same engine as the POS (stock
 * leaves, the journal balances, the payment waits for verification); the signed
 * order link works, rejects tampering and can be reissued from the mobile; and
 * cancelling the order restores stock, releases the coupon and fails the pending
 * payment.
 *
 * Posted journals are immutable, so this run's entries stay in the ledger; the
 * variant is archived, the coupon deactivated and the cart removed.
 */
import { config } from "dotenv";
config({ path: [".env.local", ".env"], quiet: true });

import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { prisma } from "../src/lib/db";
import { signOrderAccessToken } from "../src/lib/auth/token";
import { postOpeningStock } from "../src/lib/inventory/service";
import { cancelOrder } from "../src/lib/orders/service";
import { issueOrderAccessToken, placeOnlineOrder } from "../src/lib/storefront/checkout";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const CART_COOKIE = "bgd26_cart";

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

async function postJson(path: string, body: unknown, cookie?: string) {
  const response = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    body: (await response.json().catch(() => null)) as Record<string, unknown> | null,
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
const mobile = `+88019${String(Date.now()).slice(-8)}`;

const [category, warehouse, zone] = await Promise.all([
  prisma.category.findFirstOrThrow({
    where: { isActive: true },
    orderBy: { sortOrder: "asc" },
    select: { id: true },
  }),
  prisma.warehouse.findFirstOrThrow({
    where: { isDefault: true, isActive: true },
    select: { id: true },
  }),
  prisma.deliveryZone.findFirstOrThrow({
    where: { isActive: true, division: "Dhaka", district: "Dhaka" },
    orderBy: { charge: "asc" },
    select: { id: true, name: true, charge: true },
  }),
]);

const product = await prisma.product.create({
  data: {
    categoryId: category.id,
    name: `Verify storefront product ${run}`,
    nameBn: "ভেরিফাই দোকান",
    slug: `verify-storefront-${run}`,
    shortDescription: "A temporary product used by the storefront verification.",
    description: "If you can read this, the public product page is rendering.",
    basePrice: "115.00",
    status: "ACTIVE",
    isPublished: true,
  },
  select: { id: true, slug: true },
});

const variant = await prisma.productVariant.create({
  data: {
    productId: product.id,
    sku: `VERIFY-WEB-${run.toUpperCase()}`,
    name: "Default",
    price: "115.00",
    costPrice: "80.0000",
    fulfillmentType: "STOCKED",
    status: "ACTIVE",
  },
  select: { id: true },
});

const draft = await prisma.product.create({
  data: {
    categoryId: category.id,
    name: `Draft storefront product ${run}`,
    slug: `verify-storefront-draft-${run}`,
    basePrice: "99.00",
    status: "DRAFT",
    isPublished: false,
  },
  select: { id: true, slug: true },
});

const coupon = await prisma.coupon.create({
  data: {
    code: `VERIFY${run.toUpperCase()}`,
    name: "Verification 10%",
    type: "PERCENTAGE",
    value: "10",
    minOrderValue: "0",
    usageLimitPerCustomer: 1,
    appliesToChannels: ["ONLINE"],
    isActive: true,
  },
  select: { id: true, code: true },
});

const actor = await prisma.user.findFirstOrThrow({
  where: { status: "ACTIVE", deletedAt: null },
  orderBy: { createdAt: "asc" },
  select: { id: true },
});

await postOpeningStock({
  variantId: variant.id,
  warehouseId: warehouse.id,
  quantity: "10",
  unitCost: "80",
  note: `Storefront verification opening ${run}`,
  actorUserId: actor.id,
});

const cartToken = randomBytes(24).toString("base64url");
const cart = await prisma.cart.create({
  data: {
    token: cartToken,
    channel: "ONLINE",
    status: "ACTIVE",
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    items: {
      create: {
        variantId: variant.id,
        quantity: "2",
        unitPrice: "115.00",
      },
    },
  },
  select: { id: true },
});

const cartCookie = `${CART_COOKIE}=${cartToken}`;
const expectedMerchandise = 230;
const expectedCoupon = 23;
const expectedTotal = expectedMerchandise - expectedCoupon + Number(zone.charge);

let orderNumber = "";
let orderId = "";
let orderToken = "";

await check("the public home page renders without a session", async () => {
  const page = await get("/");
  assert.equal(page.status, 200);
  assert.match(visible(page.text), /Everyday things|bgd26/);
});

await check("the shop lists the published product", async () => {
  const page = await get("/shop");
  assert.equal(page.status, 200);
  assert.match(visible(page.text), new RegExp(`Verify storefront product ${run}`));
});

await check("the product page renders and never exposes cost price", async () => {
  const page = await get(`/product/${product.slug}`);
  assert.equal(page.status, 200);
  const text = visible(page.text);
  assert.match(text, /Verify storefront product/);
  assert.match(text, /115\.00/);
  assert.doesNotMatch(page.text, /80\.0000/);
  assert.doesNotMatch(page.text, /costPrice/);
});

await check("a draft product is not public", async () => {
  const page = await get(`/product/${draft.slug}`);
  assert.equal(page.status, 404);
});

await check("the cart badge endpoint counts the guest cart", async () => {
  const empty = await get("/api/storefront/cart-count");
  assert.equal(empty.status, 200);
  assert.equal(JSON.parse(empty.text).count, 0);

  const filled = await get("/api/storefront/cart-count", cartCookie);
  assert.equal(filled.status, 200);
  assert.equal(JSON.parse(filled.text).count, 2);
});

await check("the cart page reads the guest cart cookie", async () => {
  const page = await get("/cart", cartCookie);
  assert.equal(page.status, 200);
  const text = visible(page.text);
  assert.match(text, /Verify storefront product/);
  assert.match(text, /230\.00/);
});

await check("the checkout page shows the delivery zone", async () => {
  const page = await get("/checkout", cartCookie);
  assert.equal(page.status, 200);
  const text = visible(page.text);
  assert.match(text, new RegExp(zone.name));
  assert.match(text, /Place order/);
});

await check("the coupon API quotes a saving", async () => {
  const response = await postJson(
    "/api/storefront/coupon",
    { code: coupon.code },
    cartCookie,
  );
  assert.equal(response.status, 200);
  assert.equal(response.body?.ok, true);
  assert.equal(response.body?.discount, expectedCoupon.toFixed(2));
});

await check("a COD order is created through the shared order engine", async () => {
  const result = await placeOnlineOrder(
    {
      customerName: `Verify Buyer ${run}`,
      customerMobile: mobile,
      address: "House 1, Road 2, Dhanmondi",
      division: "Dhaka",
      district: "Dhaka",
      deliveryZoneId: zone.id,
      paymentMethod: "COD",
      couponCode: coupon.code,
      idempotencyKey: randomUUID(),
    },
    cartToken,
  );
  orderNumber = result.orderNumber;
  orderId = result.orderId;
  orderToken = result.token;
  assert.equal(result.grandTotal, expectedTotal.toFixed(2));

  const order = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    include: { payments: true },
  });
  assert.equal(order.channel, "ONLINE");
  assert.equal(order.source, "WEB");
  assert.equal(order.status, "CONFIRMED");
  assert.equal(order.paymentStatus, "PENDING_VERIFICATION");
  assert.equal(order.couponDiscount.toFixed(2), expectedCoupon.toFixed(2));
  assert.equal(order.payments[0]?.method, "COD");
  assert.equal(order.payments[0]?.status, "PENDING_VERIFICATION");

  const balance = await prisma.inventoryBalance.findFirstOrThrow({
    where: { variantId: variant.id, warehouseId: warehouse.id },
    select: { availableQty: true },
  });
  assert.equal(balance.availableQty.toFixed(3), "8.000");

  const journal = await prisma.journalEntry.findFirstOrThrow({
    where: { referenceType: "order", referenceId: orderId },
    include: { lines: true },
  });
  assert.equal(journal.source, "ONLINE_SALE");
  const debit = journal.lines.reduce((sum, line) => sum + Number(line.debit), 0);
  const credit = journal.lines.reduce((sum, line) => sum + Number(line.credit), 0);
  assert.equal(debit.toFixed(2), credit.toFixed(2));

  const converted = await prisma.cart.findUniqueOrThrow({
    where: { id: cart.id },
    select: { status: true },
  });
  assert.equal(converted.status, "CONVERTED");

  const used = await prisma.coupon.findUniqueOrThrow({
    where: { id: coupon.id },
    select: { usedCount: true },
  });
  assert.equal(used.usedCount, 1);
});

await check("the signed order link shows the confirmation", async () => {
  const page = await get(
    `/order/${encodeURIComponent(orderNumber)}?t=${encodeURIComponent(orderToken)}`,
  );
  assert.equal(page.status, 200);
  const text = visible(page.text);
  assert.match(text, new RegExp(orderNumber));
  assert.match(text, new RegExp(`Verify Buyer ${run}`));
  assert.match(text, /Verifying payment/);
  assert.match(text, new RegExp(expectedTotal.toFixed(2).replace(".", "\\.")));
});

await check("a missing or tampered order token reveals nothing", async () => {
  const missing = await get(`/order/${encodeURIComponent(orderNumber)}`);
  assert.equal(missing.status, 200);
  assert.doesNotMatch(visible(missing.text), new RegExp(`Verify Buyer ${run}`));

  const wrong = signOrderAccessToken({
    orderId: "not-the-order",
    orderNumber,
    mobile,
  });
  const tampered = await get(
    `/order/${encodeURIComponent(orderNumber)}?t=${encodeURIComponent(wrong)}`,
  );
  assert.equal(tampered.status, 200);
  assert.doesNotMatch(visible(tampered.text), new RegExp(`Verify Buyer ${run}`));
});

await check("the track page issues a fresh link from order number and mobile", async () => {
  const page = await get("/track");
  assert.equal(page.status, 200);
  assert.match(visible(page.text), /Track your order/);

  const issued = await issueOrderAccessToken(orderNumber, mobile);
  assert.ok(issued);
  const orderPage = await get(
    `/order/${encodeURIComponent(orderNumber)}?t=${encodeURIComponent(issued.token)}`,
  );
  assert.equal(orderPage.status, 200);
  assert.match(visible(orderPage.text), new RegExp(`Verify Buyer ${run}`));

  const wrongMobile = await issueOrderAccessToken(orderNumber, "+8801700000000");
  assert.equal(wrongMobile, null);
});

await check("cancelling the order restores stock and releases the coupon", async () => {
  const actor = await prisma.user.findUniqueOrThrow({
    where: { email: "storefront@bgd26.local" },
    select: { id: true },
  });
  await cancelOrder(orderId, actor.id, "Storefront verification cleanup");

  const order = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    include: { payments: true },
  });
  assert.equal(order.status, "CANCELLED");
  assert.equal(order.paymentStatus, "FAILED");
  assert.equal(order.payments[0]?.status, "FAILED");

  const balance = await prisma.inventoryBalance.findFirstOrThrow({
    where: { variantId: variant.id, warehouseId: warehouse.id },
    select: { availableQty: true },
  });
  assert.equal(balance.availableQty.toFixed(3), "10.000");

  const used = await prisma.coupon.findUniqueOrThrow({
    where: { id: coupon.id },
    select: { usedCount: true },
  });
  assert.equal(used.usedCount, 0);
  const redemptions = await prisma.couponRedemption.count({ where: { orderId } });
  assert.equal(redemptions, 0);
});

await check("the cancelled order page still opens for its owner", async () => {
  const page = await get(
    `/order/${encodeURIComponent(orderNumber)}?t=${encodeURIComponent(orderToken)}`,
  );
  assert.equal(page.status, 200);
  assert.match(visible(page.text), /Cancelled/);
});

// Cleanup: archive the product and variant, deactivate the coupon, drop the cart
// and the draft. The cancelled order and its journals stay as history.
await prisma.cart.delete({ where: { id: cart.id } }).catch(() => undefined);
await prisma.product.update({
  where: { id: product.id },
  data: { status: "ARCHIVED", isPublished: false, archivedAt: new Date() },
});
await prisma.productVariant.update({
  where: { id: variant.id },
  data: { status: "ARCHIVED" },
});
await prisma.coupon.update({
  where: { id: coupon.id },
  data: { isActive: false },
});
await prisma.product.delete({ where: { id: draft.id } });

console.log(`\n${checks - failures}/${checks} storefront checks passed`);
if (failures > 0) process.exitCode = 1;
