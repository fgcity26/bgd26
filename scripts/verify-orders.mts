/**
 * End-to-end sales verification.
 *
 *   npm run build
 *   STORAGE_PROVIDER=local npm start     # in another terminal
 *   npm run verify:orders
 *
 * Point it elsewhere with BASE_URL=http://localhost:3100 npm run verify:orders
 *
 * Proves over real HTTP: the till, order list and detail, the payment
 * verification queue, refunds, shifts, the POS search/catalogue API, and the
 * permission split between an owner, a cashier and an accountant. Mutations are
 * performed through the same domain services the server actions call, then read
 * back through the rendered pages.
 *
 * The stock ledger is append-only, so the verification variant is archived, the
 * device revoked and the warehouse deactivated; their history is retained.
 */
import { config } from "dotenv";
config({ path: [".env.local", ".env"], quiet: true });

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { prisma } from "../src/lib/db";
import { SESSION_VERSION, signSessionToken } from "../src/lib/auth/token";
import { hashPin } from "../src/lib/password";
import { postStockMovement } from "../src/lib/inventory/stock";
import {
  approveRefund,
  closeShift,
  completeRefund,
  createSale,
  openShift,
  requestRefund,
  verifyPayment,
} from "../src/lib/orders/service";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const COOKIE = process.env.SESSION_COOKIE_NAME?.trim() || "bgd26_session";
const MANAGER_PIN = "135790";

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
    headers: response.headers,
    text: bytes.toString("utf8"),
  };
}

async function getJson(path: string, cookie?: string) {
  const response = await fetch(`${BASE}${path}`, {
    redirect: "manual",
    headers: cookie ? { cookie } : undefined,
  });
  const text = await response.text();
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  return { status: response.status, body };
}

const run = randomBytes(4).toString("hex");
const digits = String(Date.now()).slice(-8);

const [ownerRole, accountantRole, cashierRole, category, store] =
  await Promise.all([
    prisma.role.findUniqueOrThrow({ where: { code: "OWNER" }, select: { id: true } }),
    prisma.role.findUniqueOrThrow({ where: { code: "ACCOUNTANT" }, select: { id: true } }),
    prisma.role.findUniqueOrThrow({ where: { code: "CASHIER" }, select: { id: true } }),
    prisma.category.findFirstOrThrow({
      where: { isActive: true },
      orderBy: { sortOrder: "asc" },
      select: { id: true, vatPercentage: true },
    }),
    prisma.store.findFirstOrThrow({
      where: { isActive: true },
      orderBy: { code: "asc" },
      select: { id: true, name: true },
    }),
  ]);

const warehouse = await prisma.warehouse.upsert({
  where: { code: "VERIFY-SALE" },
  update: { isActive: true },
  create: {
    code: "VERIFY-SALE",
    name: "Verify sales warehouse",
    type: "SECONDARY",
    isActive: true,
  },
  select: { id: true, code: true },
});

const [owner, accountant, cashier] = await Promise.all([
  prisma.user.create({
    data: {
      email: `verify-orders-owner-${run}@example.test`,
      fullName: "Verify Sales Owner",
      status: "ACTIVE",
      mustChangePassword: false,
      managerPinHash: await hashPin(MANAGER_PIN),
      userRoles: { create: [{ roleId: ownerRole.id }] },
    },
    select: { id: true, email: true },
  }),
  prisma.user.create({
    data: {
      email: `verify-orders-accountant-${run}@example.test`,
      fullName: "Verify Sales Accountant",
      status: "ACTIVE",
      mustChangePassword: false,
      userRoles: { create: [{ roleId: accountantRole.id }] },
    },
    select: { id: true, email: true },
  }),
  prisma.user.create({
    data: {
      email: `verify-orders-cashier-${run}@example.test`,
      fullName: "Verify Sales Cashier",
      status: "ACTIVE",
      mustChangePassword: false,
      userRoles: { create: [{ roleId: cashierRole.id }] },
    },
    select: { id: true, email: true },
  }),
]);

const product = await prisma.product.create({
  data: {
    categoryId: category.id,
    sku: `VERIFY-SALE-${run.toUpperCase()}`,
    name: `Verify sales product ${run}`,
    slug: `verify-sales-${run}`,
    status: "ACTIVE",
    isPublished: false,
    basePrice: "115.00",
  },
  select: { id: true },
});

const variant = await prisma.productVariant.create({
  data: {
    productId: product.id,
    sku: `VERIFY-SALE-${run.toUpperCase()}`,
    name: `Verification run ${run}`,
    price: "115.00",
    costPrice: "80.0000",
    fulfillmentType: "STOCKED",
    isDefault: false,
    status: "ACTIVE",
  },
  select: { id: true, sku: true },
});

const device = await prisma.posDevice.create({
  data: {
    code: `V${run}`.toUpperCase(),
    name: `Verify till ${run}`,
    storeId: store.id,
    warehouseId: warehouse.id,
    deviceFingerprint: `verify-fp-${run}`,
    platform: "verification",
    registeredByUserId: owner.id,
  },
  select: { id: true, code: true },
});

await prisma.$transaction(async (tx) => {
  await postStockMovement(tx, {
    variantId: variant.id,
    warehouseId: warehouse.id,
    storeId: store.id,
    movementType: "OPENING_BALANCE",
    quantity: "20",
    unitCost: "80",
    referenceType: "verification",
    referenceId: run,
    actorUserId: owner.id,
  });
});

const customerMobile = `017${digits}`;

const cashSale = await createSale({
  source: "POS_ONLINE",
  deviceId: device.id,
  lines: [{ variantId: variant.id, quantity: "2" }],
  payments: [{ method: "CASH", amount: "230.00" }],
  customerMobile,
  clientTransactionUuid: `verify-cash-${run}`,
  actorUserId: cashier.id,
  managerPin: null,
});

const digitalSale = await createSale({
  source: "POS_ONLINE",
  deviceId: device.id,
  lines: [{ variantId: variant.id, quantity: "1" }],
  payments: [{ method: "BKASH", amount: "115.00", reference: `TRX-${run}` }],
  customerMobile,
  clientTransactionUuid: `verify-bkash-${run}`,
  actorUserId: cashier.id,
});

const offlineSale = await createSale({
  source: "POS_OFFLINE",
  deviceId: device.id,
  lines: [{ variantId: variant.id, quantity: "1" }],
  payments: [{ method: "CASH", amount: "115.00" }],
  clientTransactionUuid: `verify-offline-${run}`,
  offlineCreatedAt: new Date(),
  actorUserId: cashier.id,
});

const digitalPayment = await prisma.payment.findFirstOrThrow({
  where: { orderId: digitalSale.orderId },
  select: { id: true, paymentNumber: true },
});

const shift = await openShift(
  { deviceId: device.id, openingFloat: "500.00" },
  cashier.id,
);
const shiftSale = await createSale({
  source: "POS_ONLINE",
  deviceId: device.id,
  shiftId: shift.id,
  lines: [{ variantId: variant.id, quantity: "1" }],
  payments: [{ method: "CASH", amount: "115.00" }],
  customerMobile,
  clientTransactionUuid: `verify-shift-${run}`,
  actorUserId: cashier.id,
});
const shiftClose = await closeShift(
  { shiftId: shift.id, countedCash: "615.00" },
  cashier.id,
);

const refundOrderItem = await prisma.orderItem.findFirstOrThrow({
  where: { orderId: cashSale.orderId },
  select: { id: true },
});
const refund = await requestRefund({
  orderId: cashSale.orderId,
  lines: [{ orderItemId: refundOrderItem.id, quantity: "2", restock: true }],
  reason: "Verification refund",
  method: "CASH",
  actorUserId: cashier.id,
});

const ownerCookie = sessionCookie(owner);
const accountantCookie = sessionCookie(accountant);
const cashierCookie = sessionCookie(cashier);

try {
  await check("anonymous visitors cannot reach sales screens or the POS API", async () => {
    for (const path of ["/pos", "/pos/devices", "/pos/shifts", "/orders", "/payments", "/refunds"]) {
      const response = await get(path);
      assert.ok([302, 303, 307, 308].includes(response.status), `${path} ${response.status}`);
      assert.match(response.location, /\/login/);
    }
    const search = await getJson("/api/pos/search?q=VERIFY");
    assert.equal(search.status, 401);
    const catalog = await getJson("/api/pos/catalog");
    assert.equal(catalog.status, 401);
  });

  await check("the POS search API returns sellable variants without cost price", async () => {
    const response = await getJson(
      `/api/pos/search?q=${encodeURIComponent(variant.sku)}&warehouse=${warehouse.id}`,
      cashierCookie,
    );
    assert.equal(response.status, 200);
    const body = response.body as { variants: Array<Record<string, unknown>> };
    assert.ok(Array.isArray(body.variants));
    const found = body.variants.find((row) => row.sku === variant.sku);
    assert.ok(found, "the variant was not returned");
    assert.equal(found.price, "115");
    assert.equal(found.vatPercentage, category.vatPercentage.toString());
    assert.equal("costPrice" in found, false, "cost price leaked to the till");

    const catalog = await getJson(`/api/pos/catalog?warehouse=${warehouse.id}`, cashierCookie);
    assert.equal(catalog.status, 200);
    const catalogBody = catalog.body as { variants: Array<Record<string, unknown>> };
    assert.ok(catalogBody.variants.some((row) => row.sku === variant.sku));
  });

  await check("an accountant can read sales but not use the till", async () => {
    for (const path of ["/orders", `/orders/${cashSale.orderId}`, "/payments", "/refunds"]) {
      const response = await get(path, accountantCookie);
      assert.equal(response.status, 200, `${path} returned ${response.status}`);
    }
    for (const path of ["/pos", "/pos/devices", "/pos/shifts"]) {
      const response = await get(path, accountantCookie);
      assert.ok([302, 303, 307, 308].includes(response.status), `${path} ${response.status}`);
      assert.match(response.location, /\/forbidden/);
    }
    const search = await getJson("/api/pos/search?q=VERIFY", accountantCookie);
    assert.equal(search.status, 403);
  });

  await check("the cashier sees the till, orders, payments and refunds", async () => {
    for (const path of ["/pos", "/pos/devices", "/pos/shifts", "/orders", "/payments"]) {
      const response = await get(path, cashierCookie);
      assert.equal(response.status, 200, `${path} returned ${response.status}`);
    }
    const refunds = await get("/refunds", cashierCookie);
    assert.ok([302, 303, 307, 308].includes(refunds.status));
    assert.match(refunds.location, /\/forbidden/);
    const till = await get("/pos", cashierCookie);
    assert.match(till.text, new RegExp(device.code));
    assert.match(till.text, /Complete sale/);
  });

  await check("the order list and detail show the cash sale, VAT and its payment", async () => {
    const list = await get(`/orders?q=${encodeURIComponent(cashSale.orderNumber)}`, cashierCookie);
    assert.equal(list.status, 200);
    assert.match(list.text, new RegExp(cashSale.orderNumber));
    assert.match(list.text, /230\.00/);

    const detail = await get(`/orders/${cashSale.orderId}`, cashierCookie);
    assert.equal(detail.status, 200);
    assert.match(detail.text, new RegExp(cashSale.orderNumber));
    assert.match(detail.text, new RegExp(variant.sku));
    assert.match(detail.text, /VAT/);
    assert.match(detail.text, /PAID/);
    assert.match(detail.text, /CASH DRAWER/);
  });

  await check("the offline sale is marked as needing a manager's review", async () => {
    assert.equal(offlineSale.approvalDeferred, true);
    const detail = await get(`/orders/${offlineSale.orderId}`, ownerCookie);
    assert.equal(detail.status, 200);
    assert.match(detail.text, /approval deferred/i);
    assert.match(detail.text, /POS OFFLINE/);
  });

  await check("the payment queue shows the digital payment and hides approval from a cashier", async () => {
    const ownerView = await get("/payments", ownerCookie);
    assert.equal(ownerView.status, 200);
    assert.match(ownerView.text, new RegExp(digitalPayment.paymentNumber));
    assert.match(ownerView.text, /PENDING VERIFICATION/);
    assert.match(ownerView.text, /Verify payment/);

    const cashierView = await get("/payments", cashierCookie);
    assert.equal(cashierView.status, 200);
    assert.match(cashierView.text, new RegExp(digitalPayment.paymentNumber));
    assert.doesNotMatch(cashierView.text, /Verify payment/);
  });

  await check("verifying a payment marks the order paid", async () => {
    await verifyPayment(digitalPayment.id, owner.id, { reference: `TRX-${run}` });
    const order = await prisma.order.findUniqueOrThrow({
      where: { id: digitalSale.orderId },
      select: { paymentStatus: true, paidAmount: true },
    });
    assert.equal(order.paymentStatus, "PAID");
    assert.equal(order.paidAmount.toFixed(2), "115.00");

    const detail = await get(`/orders/${digitalSale.orderId}`, ownerCookie);
    assert.match(detail.text, /MANUAL MANAGER/);
  });

  await check("a requested refund is visible and approval restocks the item", async () => {
    const before = await prisma.inventoryBalance.findUniqueOrThrow({
      where: { variantId_warehouseId: { variantId: variant.id, warehouseId: warehouse.id } },
      select: { availableQty: true },
    });

    const page = await get("/refunds", ownerCookie);
    assert.equal(page.status, 200);
    assert.match(page.text, new RegExp(refund.refundNumber));
    assert.match(page.text, /REQUESTED/);
    assert.match(page.text, /Approve &amp; restock|Approve & restock/);

    await approveRefund(refund.refundId, owner.id);
    const afterApprove = await prisma.inventoryBalance.findUniqueOrThrow({
      where: { variantId_warehouseId: { variantId: variant.id, warehouseId: warehouse.id } },
      select: { availableQty: true },
    });
    assert.equal(afterApprove.availableQty.minus(before.availableQty).toFixed(3), "2.000");

    await completeRefund(refund.refundId, owner.id);
    const completed = await get("/refunds?status=COMPLETED", ownerCookie);
    assert.equal(completed.status, 200);
    assert.match(completed.text, new RegExp(refund.refundNumber));
    assert.match(completed.text, /COMPLETED/);
  });

  await check("the shift page reconciles the drawer with no variance", async () => {
    assert.equal(shiftClose.expectedCash.toFixed(2), "615.00");
    assert.equal(shiftClose.variance.toFixed(2), "0.00");

    const page = await get("/pos/shifts", cashierCookie);
    assert.equal(page.status, 200);
    assert.match(page.text, new RegExp(shift.shiftNumber));
    assert.match(page.text, /615\.00/);
    assert.match(page.text, /0\.00/);
  });

  await check("the shift sale is linked to the order detail", async () => {
    const detail = await get(`/orders/${shiftSale.orderId}`, ownerCookie);
    assert.equal(detail.status, 200);
    assert.match(detail.text, new RegExp(shift.shiftNumber));
    assert.match(detail.text, new RegExp(device.code));
  });

  await check("the order detail offers status actions to a writer", async () => {
    const ownerView = await get(`/orders/${shiftSale.orderId}`, ownerCookie);
    assert.match(ownerView.text, /Move to/);
    assert.match(ownerView.text, /Request a refund/);

    const accountantView = await get(`/orders/${shiftSale.orderId}`, accountantCookie);
    assert.doesNotMatch(accountantView.text, /Move to/);
  });

  await check("stock left exactly once per stocked line", async () => {
    const balance = await prisma.inventoryBalance.findUniqueOrThrow({
      where: { variantId_warehouseId: { variantId: variant.id, warehouseId: warehouse.id } },
      select: { physicalQty: true },
    });
    // 20 opening − 2 cash − 1 bKash − 1 offline − 1 shift + 2 refunded = 17
    assert.equal(balance.physicalQty.toFixed(3), "17.000");

    const sales = await prisma.stockLedger.count({
      where: { variantId: variant.id, movementType: "SALE" },
    });
    assert.equal(sales, 4);
  });
} finally {
  await prisma.productVariant
    .update({ where: { id: variant.id }, data: { status: "ARCHIVED" } })
    .catch(() => undefined);
  await prisma.product
    .update({ where: { id: product.id }, data: { isPublished: false } })
    .catch(() => undefined);
  await prisma.posDevice
    .update({ where: { id: device.id }, data: { status: "REVOKED" } })
    .catch(() => undefined);
  await prisma.warehouse
    .updateMany({ where: { code: "VERIFY-SALE" }, data: { isActive: false } })
    .catch(() => undefined);
  await prisma.user
    .updateMany({
      where: { id: { in: [owner.id, accountant.id, cashier.id] } },
      data: { status: "SUSPENDED", deletedAt: new Date() },
    })
    .catch(() => undefined);
  await prisma.$disconnect();
}

console.log(
  "\nThe stock ledger is append-only, so this run's variant was archived, the " +
    "device revoked and the warehouse deactivated; their sales history is retained.",
);
console.log(`\n${checks - failures}/${checks} sales checks passed.`);
process.exitCode = failures === 0 ? 0 : 1;
