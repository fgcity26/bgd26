/**
 * End-to-end storefront account verification.
 *
 *   npm run build
 *   STORAGE_PROVIDER=local npm start     # in another terminal
 *   npm run verify:account
 *
 * Point it elsewhere with BASE_URL=http://localhost:3100 npm run verify:account
 *
 * Proves over real HTTP: guests are sent to the account login; a signed customer
 * cookie opens the dashboard, order history, addresses, points and profile; one
 * account cannot read another account's order; a staff session and a guest order
 * token are both refused as a customer session; and checkout prefills the
 * account's mobile, saved address and redeemable points.
 *
 * The account's order posts an immutable journal, so it stays as history. The
 * verification product and variant are archived and the customers are blocked.
 */
import { config } from "dotenv";
config({ path: [".env.local", ".env"], quiet: true });

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { prisma } from "../src/lib/db";
import {
  SESSION_VERSION,
  signCustomerSessionToken,
  signOrderAccessToken,
  signSessionToken,
} from "../src/lib/auth/token";
import { hashSecret } from "../src/lib/password";
import { postOpeningStock } from "../src/lib/inventory/service";
import { createSale } from "../src/lib/orders/service";
import { createCustomerAddress } from "../src/lib/customer-auth/addresses";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const CUSTOMER_COOKIE = process.env.CUSTOMER_SESSION_COOKIE_NAME?.trim() || "bgd26_customer";
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

/** Visible text of a server-rendered page, without tags. */
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

function customerCookie(customer: { id: string; mobileNormalized: string }): string {
  return `${CUSTOMER_COOKIE}=${signCustomerSessionToken({
    customerId: customer.id,
    mobile: customer.mobileNormalized,
  })}`;
}

const [ownerRole, warehouse, category] = await Promise.all([
  prisma.role.findUniqueOrThrow({ where: { code: "OWNER" }, select: { id: true } }),
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
    email: `verify-account-${run}@bgd26.test`,
    fullName: `Verify account owner ${run}`,
    passwordHash: "not-used-by-this-script",
    status: "ACTIVE",
    userRoles: { create: { roleId: ownerRole.id } },
  },
  select: { id: true, email: true },
});

const product = await prisma.product.create({
  data: {
    categoryId: category.id,
    name: `Verify account product ${run}`,
    nameBn: "ভেরিফাই অ্যাকাউন্ট",
    slug: `verify-account-${run}`,
    basePrice: "115.00",
    status: "ACTIVE",
    isPublished: true,
  },
  select: { id: true },
});

const variant = await prisma.productVariant.create({
  data: {
    productId: product.id,
    sku: `VERIFY-ACC-${run.toUpperCase()}`,
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
  quantity: "40",
  unitCost: "80",
  note: `Account verification opening ${run}`,
  actorUserId: owner.id,
});

const password = `VerifyAccount-${run}-1`;
const passwordHash = await hashSecret(password);

const customerMobile = mobileFor(1);
const secondMobile = mobileFor(2);

const customer = await prisma.customer.create({
  data: {
    mobileNormalized: customerMobile,
    mobileRaw: `01${customerMobile.slice(5)}`,
    fullName: `Verify account shopper ${run}`,
    email: `verify-account-${run}@example.com`,
    loyaltyPointsBalance: 500,
    passwordHash,
    passwordUpdatedAt: new Date(),
    lastLoginAt: new Date(),
    accountClaimedAt: new Date(),
  },
  select: { id: true, mobileNormalized: true, fullName: true },
});

const otherCustomer = await prisma.customer.create({
  data: {
    mobileNormalized: secondMobile,
    mobileRaw: `01${secondMobile.slice(5)}`,
    fullName: `Verify other shopper ${run}`,
    passwordHash,
    passwordUpdatedAt: new Date(),
    lastLoginAt: new Date(),
    accountClaimedAt: new Date(),
  },
  select: { id: true, mobileNormalized: true, fullName: true },
});

const homeAddress = await createCustomerAddress(customer.id, {
  label: "Home",
  recipientName: `Verify account shopper ${run}`,
  mobile: customerMobile,
  division: "Dhaka",
  district: "Dhaka",
  upazila: "Mirpur",
  area: "Block C",
  addressLine: "House 12, Road 5, Mirpur",
  postcode: "1216",
});
assert.ok(homeAddress);
await createCustomerAddress(customer.id, {
  label: "Office",
  recipientName: `Verify account shopper ${run}`,
  mobile: customerMobile,
  division: "Dhaka",
  district: "Gazipur",
  upazila: "Tongi",
  area: "Station Road",
  addressLine: "Plot 7, Tongi Bazar Road",
  postcode: "1710",
});

function webOrder(mobile: string, name: string, suffix: string) {
  return createSale({
    source: "WEB",
    warehouseId: warehouse.id,
    customerMobile: mobile,
    customerName: name,
    recipientName: name,
    recipientMobile: mobile,
    shippingAddress: {
      address: "House 12, Road 5, Mirpur",
      division: "Dhaka",
      district: "Dhaka",
    },
    lines: [{ variantId: variant.id, quantity: 10 }],
    deliveryCharge: "60",
    payments: [{ method: "COD" }],
    actorUserId: owner.id,
    clientTransactionUuid: `verify-account-${run}-${suffix}`,
  });
}

const ownOrder = await webOrder(customerMobile, `Verify account shopper ${run}`, "own");
const otherOrder = await webOrder(secondMobile, `Verify other shopper ${run}`, "other");

const orderAccessToken = signOrderAccessToken({
  orderId: ownOrder.orderId,
  orderNumber: ownOrder.orderNumber,
  mobile: customerMobile,
});

const staffToken = signSessionToken({
  v: SESSION_VERSION,
  userId: owner.id,
  email: owner.email,
  provider: "local",
  issuedAt: Math.floor(Date.now() / 1000),
  expiresAt: Math.floor(Date.now() / 1000) + 3600,
});

const cartToken = `verify-account-cart-${run}`;
const cart = await prisma.cart.create({
  data: {
    token: cartToken,
    customerId: customer.id,
    items: {
      create: {
        variantId: variant.id,
        quantity: "10",
        unitPrice: "115.00",
      },
    },
  },
  select: { id: true },
});

const signedCookie = customerCookie(customer);
const otherCookie = customerCookie(otherCustomer);

await check("an anonymous visitor is sent to the account login", async () => {
  const page = await get("/account");
  assert.equal(page.status, 307);
  assert.match(page.location, /\/account\/login\?next=%2Faccount$/);
});

await check("anonymous order history redirects and keeps the destination", async () => {
  const page = await get("/account/orders");
  assert.equal(page.status, 307);
  assert.match(page.location, /\/account\/login\?next=%2Faccount%2Forders$/);
});

await check("the login and register pages render for guests", async () => {
  const login = await get("/account/login");
  assert.equal(login.status, 200);
  assert.match(visible(login.text), /Sign in/);
  assert.match(visible(login.text), /Mobile number/);

  const register = await get("/account/register");
  assert.equal(register.status, 200);
  const text = visible(register.text);
  assert.match(text, /Create an account/);
  assert.match(text, /order number/i);
});

await check("a signed customer sees the dashboard with points and address", async () => {
  const page = await get("/account", signedCookie);
  assert.equal(page.status, 200);
  const text = visible(page.text);
  assert.match(text, new RegExp(customer.fullName));
  assert.ok(text.includes(customerMobile), "mobile number is shown");
  assert.match(text, /500/);
  assert.match(text, /Home · Dhaka/);
});

await check("the order list shows only this account's orders", async () => {
  const page = await get("/account/orders", signedCookie);
  assert.equal(page.status, 200);
  const text = visible(page.text);
  assert.match(text, new RegExp(ownOrder.orderNumber));
  assert.doesNotMatch(text, new RegExp(otherOrder.orderNumber));
});

await check("the order detail page opens for its owner", async () => {
  const page = await get(`/account/orders/${ownOrder.orderId}`, signedCookie);
  assert.equal(page.status, 200);
  const text = visible(page.text);
  assert.match(text, new RegExp(ownOrder.orderNumber));
  assert.match(text, /House 12, Road 5, Mirpur/);
  assert.match(text, new RegExp(`Verify account product ${run}`));
});

await check("another account gets a 404 for that order", async () => {
  const page = await get(`/account/orders/${ownOrder.orderId}`, otherCookie);
  assert.equal(page.status, 404);
});

await check("the addresses page lists both saved addresses with a default", async () => {
  const page = await get("/account/addresses", signedCookie);
  assert.equal(page.status, 200);
  const text = visible(page.text);
  assert.match(text, /House 12, Road 5, Mirpur/);
  assert.match(text, /Plot 7, Tongi Bazar Road/);
  assert.match(text, /default/);
  assert.match(text, /2 of 20/);
});

await check("the points page shows the balance and the rules", async () => {
  const page = await get("/account/loyalty", signedCookie);
  assert.equal(page.status, 200);
  const text = visible(page.text);
  assert.match(text, /500/);
  assert.match(text, /1 point = ৳1/);
  assert.match(text, /20%/);
});

await check("the profile page shows the read-only mobile number", async () => {
  const page = await get("/account/profile", signedCookie);
  assert.equal(page.status, 200);
  const text = visible(page.text);
  assert.match(text, new RegExp(customer.fullName));
  assert.ok(text.includes(customerMobile), "mobile number is shown");
  assert.match(text, /cannot be changed here/);
  assert.match(text, /Change password/);
});

await check("a staff session is not a customer session", async () => {
  const page = await get("/account", `${CUSTOMER_COOKIE}=${staffToken}`);
  assert.equal(page.status, 307);
  assert.match(page.location, /\/account\/login/);
});

await check("a guest order token is not a customer session", async () => {
  const page = await get("/account", `${CUSTOMER_COOKIE}=${orderAccessToken}`);
  assert.equal(page.status, 307);
  assert.match(page.location, /\/account\/login/);
});

await check("checkout prefills the account's address and points", async () => {
  const cookie = `${signedCookie}; ${CART_COOKIE}=${cartToken}`;
  const page = await get("/checkout", cookie);
  assert.equal(page.status, 200);
  const text = visible(page.text);
  assert.match(text, new RegExp(`Signed in as ${customer.fullName}`));
  assert.match(text, /Ordering as/);
  assert.ok(text.includes(customerMobile), "mobile number is shown");
  assert.match(text, /Home · /);
  assert.match(text, /Loyalty points · 500/);
  assert.match(text, /up to 200/);
});

await check("a guest checkout still offers sign-in instead of points", async () => {
  const page = await get("/checkout", `${CART_COOKIE}=${cartToken}`);
  assert.equal(page.status, 200);
  const text = visible(page.text);
  assert.match(text, /Sign in/);
  assert.doesNotMatch(text, /Loyalty points · 500/);
});

await check("the storefront header links to the account", async () => {
  const page = await get("/");
  assert.equal(page.status, 200);
  assert.match(page.text, /href="\/account"/);
  assert.match(page.text, /Track order/);
});

// Cleanup: archive the verification product, drop the cart and block the
// customers. Orders and their journals stay as immutable history.
await prisma.cart.delete({ where: { id: cart.id } }).catch(() => undefined);
await prisma.product.update({
  where: { id: product.id },
  data: { status: "ARCHIVED", isPublished: false, archivedAt: new Date() },
});
await prisma.productVariant.update({
  where: { id: variant.id },
  data: { status: "ARCHIVED" },
});
await prisma.customer.updateMany({
  where: { id: { in: [customer.id, otherCustomer.id] } },
  data: { status: "BLOCKED" },
});

console.log(`\n${checks - failures}/${checks} account checks passed`);
if (failures > 0) process.exitCode = 1;
