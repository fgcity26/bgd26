import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { Prisma } from "../src/generated/prisma/client";
import { prisma } from "../src/lib/db";
import { hashSecret } from "../src/lib/password";
import { postStockMovement } from "../src/lib/inventory/stock";
import { createSale } from "../src/lib/orders/service";
import {
  netMerchandise,
  pointsForNet,
} from "../src/lib/loyalty/service";
import {
  signOrderAccessToken,
  signSessionToken,
  SESSION_VERSION,
  verifyOrderAccessToken,
} from "../src/lib/auth/token";
import {
  lockCoupon,
  quoteCoupon,
  recordCouponRedemption,
} from "../src/lib/storefront/coupons";
import { StorefrontError } from "../src/lib/storefront/errors";

/**
 * Storefront tests: coupon maths and limits, guest order access tokens, and a
 * full online sale through the shared order engine (WEB source, COD pending
 * verification, coupon discount in the journal, stock from a warehouse).
 *
 * Database scenarios run inside a transaction that is rolled back, so the real
 * CHECK constraints and journal triggers are exercised without leaving rows.
 */

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

async function fixture(tx: Prisma.TransactionClient, run: string) {
  const warehouse = await tx.warehouse.findFirstOrThrow({
    where: { isActive: true },
    orderBy: { code: "asc" },
    select: { id: true, code: true },
  });
  const store = await tx.store.findFirstOrThrow({
    where: { isActive: true },
    orderBy: { code: "asc" },
    select: { id: true },
  });
  const role = await tx.role.findFirstOrThrow({
    where: { code: "OWNER" },
    select: { id: true },
  });
  const manager = await tx.user.create({
    data: {
      email: `storefront-${run}@bgd26.test`,
      fullName: "Storefront test manager",
      passwordHash: await hashSecret(`Storefront-${run}-password`),
      status: "ACTIVE",
      userRoles: { create: { roleId: role.id } },
    },
    select: { id: true },
  });
  const category = await tx.category.create({
    data: {
      name: `Storefront ${run}`,
      nameBn: "অনলাইন দোকান",
      slug: `storefront-${run}`,
      vatPercentage: "15.00",
    },
    select: { id: true },
  });
  const product = await tx.product.create({
    data: {
      categoryId: category.id,
      name: `Storefront product ${run}`,
      slug: `storefront-product-${run}`,
      basePrice: "115.00",
      status: "ACTIVE",
      isPublished: true,
    },
    select: { id: true },
  });
  const variant = await tx.productVariant.create({
    data: {
      productId: product.id,
      sku: `WEB-${run.toUpperCase()}`,
      name: "Default",
      price: "115.00",
      costPrice: "80.0000",
      fulfillmentType: "STOCKED",
    },
    select: { id: true },
  });
  await postStockMovement(tx, {
    variantId: variant.id,
    warehouseId: warehouse.id,
    storeId: store.id,
    movementType: "OPENING_BALANCE",
    quantity: "10",
    unitCost: "80",
    referenceType: "test",
    referenceId: run,
    actorUserId: manager.id,
  });

  return { warehouse, store, manager, category, product, variant };
}

async function makeCoupon(
  tx: Prisma.TransactionClient,
  run: string,
  overrides: Partial<{
    type: "PERCENTAGE" | "FIXED_AMOUNT" | "FREE_SHIPPING";
    value: string;
    minOrderValue: string;
    maxDiscount: string | null;
    isActive: boolean;
    startsAt: Date | null;
    endsAt: Date | null;
    usageLimit: number | null;
    usageLimitPerCustomer: number;
    appliesToChannels: Array<"ONLINE" | "POS">;
  }> = {},
) {
  return tx.coupon.create({
    data: {
      code: `WEB${run.toUpperCase()}`,
      name: "Storefront test coupon",
      type: overrides.type ?? "PERCENTAGE",
      value: overrides.value ?? "10",
      minOrderValue: overrides.minOrderValue ?? "0",
      maxDiscount: overrides.maxDiscount ?? null,
      isActive: overrides.isActive ?? true,
      startsAt: overrides.startsAt ?? null,
      endsAt: overrides.endsAt ?? null,
      usageLimit: overrides.usageLimit ?? null,
      usageLimitPerCustomer: overrides.usageLimitPerCustomer ?? 1,
      appliesToChannels: overrides.appliesToChannels ?? ["ONLINE"],
    },
    select: { id: true, code: true },
  });
}

async function available(
  tx: Prisma.TransactionClient,
  variantId: string,
  warehouseId: string,
): Promise<string> {
  const balance = await tx.inventoryBalance.findFirst({
    where: { variantId, warehouseId },
    select: { availableQty: true },
  });
  return balance?.availableQty.toFixed(3) ?? "0.000";
}

// ---------------------------------------------------------------------------
// Pure maths and tokens
// ---------------------------------------------------------------------------

test("loyalty earning uses net merchandise after the coupon", () => {
  assert.equal(netMerchandise("1000.00", "100.00", "150.00").toFixed(2), "750.00");
  assert.equal(pointsForNet(netMerchandise("1000.00", "0", "999.00")), 0);
  assert.equal(pointsForNet(netMerchandise("1000.00", "100.00", "150.00")), 7);
});

test("guest order links round-trip, reject tampering and expire", () => {
  const now = Math.floor(Date.now() / 1000);
  const token = signOrderAccessToken({
    orderId: "order-1",
    orderNumber: "SO-TEST-1",
    mobile: "+8801712345678",
    nowSeconds: now,
    ttlSeconds: 60,
  });

  const payload = verifyOrderAccessToken(token, now + 10);
  assert.equal(payload?.orderId, "order-1");
  assert.equal(payload?.orderNumber, "SO-TEST-1");

  const tampered = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;
  assert.equal(verifyOrderAccessToken(tampered, now + 10), null);
  assert.equal(verifyOrderAccessToken(token, now + 61), null);

  const session = signSessionToken({
    v: SESSION_VERSION,
    userId: "user-1",
    email: "staff@bgd26.test",
    provider: "local",
    issuedAt: now,
    expiresAt: now + 60,
  });
  assert.equal(verifyOrderAccessToken(session, now + 10), null);
});

// ---------------------------------------------------------------------------
// Coupons
// ---------------------------------------------------------------------------

test("a percentage coupon is capped and respects the minimum order", async () => {
  await rolledBack(async (tx) => {
    const run = suffix();
    const coupon = await makeCoupon(tx, run, {
      type: "PERCENTAGE",
      value: "20",
      maxDiscount: "50",
      minOrderValue: "100",
    });

    const capped = await quoteCoupon({ code: coupon.code, gross: "1000" }, tx);
    assert.equal(capped.discount.toFixed(2), "50.00");

    const proportional = await quoteCoupon({ code: coupon.code, gross: "200" }, tx);
    assert.equal(proportional.discount.toFixed(2), "40.00");

    await assert.rejects(
      quoteCoupon({ code: coupon.code, gross: "99" }, tx),
      StorefrontError,
    );
  });
});

test("a fixed coupon never discounts more than the merchandise", async () => {
  await rolledBack(async (tx) => {
    const run = suffix();
    const coupon = await makeCoupon(tx, run, {
      type: "FIXED_AMOUNT",
      value: "500",
    });
    const quote = await quoteCoupon({ code: coupon.code, gross: "150" }, tx);
    assert.equal(quote.discount.toFixed(2), "150.00");
  });
});

test("a free-shipping coupon discounts the delivery charge, not the goods", async () => {
  await rolledBack(async (tx) => {
    const run = suffix();
    const coupon = await makeCoupon(tx, run, {
      type: "FREE_SHIPPING",
      value: "0",
    });
    const quote = await quoteCoupon(
      { code: coupon.code, gross: "500", deliveryCharge: "60" },
      tx,
    );
    assert.equal(quote.freeShipping, true);
    assert.equal(quote.discount.toFixed(2), "60.00");
  });
});

test("inactive, expired and POS-only coupons are refused online", async () => {
  await rolledBack(async (tx) => {
    const run = suffix();
    const inactive = await makeCoupon(tx, `${run}a`, { isActive: false });
    const expired = await makeCoupon(tx, `${run}b`, {
      endsAt: new Date(Date.now() - 60_000),
    });
    const posOnly = await makeCoupon(tx, `${run}c`, { appliesToChannels: ["POS"] });

    for (const coupon of [inactive, expired, posOnly]) {
      await assert.rejects(
        quoteCoupon({ code: coupon.code, gross: "500" }, tx),
        StorefrontError,
      );
    }
  });
});

test("the per-customer limit counts earlier redemptions", async () => {
  await rolledBack(async (tx) => {
    const run = suffix();
    const fixtureData = await fixture(tx, run);
    const coupon = await makeCoupon(tx, run, { usageLimitPerCustomer: 1 });
    const customer = await tx.customer.create({
      data: {
        mobileNormalized: testMobile(run),
        fullName: "Coupon customer",
      },
      select: { id: true },
    });
    const sale = await createSale(
      {
        source: "WEB",
        warehouseId: fixtureData.warehouse.id,
        customerMobile: testMobile(run),
        customerName: "Coupon customer",
        lines: [{ variantId: fixtureData.variant.id, quantity: 1 }],
        payments: [{ method: "COD" }],
        actorUserId: fixtureData.manager.id,
        clientTransactionUuid: `coupon-${run}`,
      },
      tx,
    );
    await recordCouponRedemption(tx, {
      couponId: coupon.id,
      orderId: sale.orderId,
      customerId: sale.customerId,
      discountAmount: "10",
    });

    await assert.rejects(
      quoteCoupon({ code: coupon.code, gross: "500", customerId: customer.id }, tx),
      StorefrontError,
    );
  });
});

test("redeeming a coupon increments its used count exactly once", async () => {
  await rolledBack(async (tx) => {
    const run = suffix();
    const fixtureData = await fixture(tx, run);
    const coupon = await makeCoupon(tx, run);
    const sale = await createSale(
      {
        source: "WEB",
        warehouseId: fixtureData.warehouse.id,
        customerMobile: testMobile(run),
        customerName: "Coupon counter",
        lines: [{ variantId: fixtureData.variant.id, quantity: 1 }],
        payments: [{ method: "COD" }],
        actorUserId: fixtureData.manager.id,
        clientTransactionUuid: `coupon-count-${run}`,
      },
      tx,
    );
    await recordCouponRedemption(tx, {
      couponId: coupon.id,
      orderId: sale.orderId,
      customerId: sale.customerId,
      discountAmount: "10",
    });
    const after = await tx.coupon.findUniqueOrThrow({
      where: { id: coupon.id },
      select: { usedCount: true },
    });
    assert.equal(after.usedCount, 1);
  });
});

test("a locked coupon still quotes inside the checkout transaction", async () => {
  await rolledBack(async (tx) => {
    const run = suffix();
    const coupon = await makeCoupon(tx, run);
    const id = await lockCoupon(tx, `  ${coupon.code.toLowerCase()}  `);
    assert.equal(id, coupon.id);
    const quote = await quoteCoupon({ code: coupon.code, gross: "500" }, tx);
    assert.equal(quote.discount.toFixed(2), "50.00");
  });
});

// ---------------------------------------------------------------------------
// Online sale through the shared engine
// ---------------------------------------------------------------------------

test("an online COD sale consumes stock, posts a balanced journal and stays pending", async () => {
  await rolledBack(async (tx) => {
    const run = suffix();
    const fixtureData = await fixture(tx, run);
    const coupon = await makeCoupon(tx, run, {
      type: "PERCENTAGE",
      value: "20",
      maxDiscount: "50",
    });

    const sale = await createSale(
      {
        source: "WEB",
        warehouseId: fixtureData.warehouse.id,
        customerMobile: testMobile(run),
        customerName: "Online buyer",
        recipientName: "Online buyer",
        recipientMobile: testMobile(run),
        shippingAddress: {
          address: "12 Test Road",
          division: "Dhaka",
          district: "Dhaka",
        },
        lines: [{ variantId: fixtureData.variant.id, quantity: 2 }],
        deliveryCharge: "60",
        coupon: { id: coupon.id, code: coupon.code, discount: "46" },
        payments: [{ method: "COD" }],
        actorUserId: fixtureData.manager.id,
        clientTransactionUuid: `online-${run}`,
      },
      tx,
    );

    const order = await tx.order.findUniqueOrThrow({
      where: { id: sale.orderId },
      include: { payments: true, items: true },
    });

    assert.equal(order.channel, "ONLINE");
    assert.equal(order.source, "WEB");
    assert.equal(order.status, "CONFIRMED");
    assert.equal(order.paymentStatus, "PENDING_VERIFICATION");
    assert.equal(order.warehouseId, fixtureData.warehouse.id);
    assert.equal(order.couponId, coupon.id);
    assert.equal(order.subtotal.toFixed(2), "200.00");
    assert.equal(order.vatTotal.toFixed(2), "30.00");
    assert.equal(order.discountTotal.toFixed(2), "0.00");
    assert.equal(order.couponDiscount.toFixed(2), "46.00");
    assert.equal(order.deliveryCharge.toFixed(2), "60.00");
    assert.equal(order.grandTotal.toFixed(2), "244.00");
    assert.equal(order.paidAmount.toFixed(2), "0.00");
    assert.equal(order.dueAmount.toFixed(2), "244.00");
    assert.equal(order.items[0]?.discountAmount.toFixed(2), "46.00");
    assert.equal(order.payments.length, 1);
    assert.equal(order.payments[0]?.method, "COD");
    assert.equal(order.payments[0]?.status, "PENDING_VERIFICATION");

    assert.equal(await available(tx, fixtureData.variant.id, fixtureData.warehouse.id), "8.000");

    const journal = await tx.journalEntry.findFirstOrThrow({
      where: { referenceType: "order", referenceId: sale.orderId },
      include: { lines: { include: { account: { select: { code: true } } } } },
    });
    assert.equal(journal.source, "ONLINE_SALE");
    const byCode = new Map(
      journal.lines.map((line) => [
        line.account.code,
        { debit: line.debit.toFixed(2), credit: line.credit.toFixed(2) },
      ]),
    );
    assert.deepEqual(byCode.get("1050"), { debit: "244.00", credit: "0.00" });
    assert.deepEqual(byCode.get("4020"), { debit: "46.00", credit: "0.00" });
    assert.deepEqual(byCode.get("5000"), { debit: "160.00", credit: "0.00" });
    assert.deepEqual(byCode.get("4000"), { debit: "0.00", credit: "200.00" });
    assert.deepEqual(byCode.get("1400"), { debit: "0.00", credit: "30.00" });
    assert.deepEqual(byCode.get("4010"), { debit: "0.00", credit: "60.00" });
    assert.deepEqual(byCode.get("1100"), { debit: "0.00", credit: "160.00" });
  });
});

test("an online sale needs no payment when a coupon covers the whole order", async () => {
  await rolledBack(async (tx) => {
    const run = suffix();
    const fixtureData = await fixture(tx, run);
    const coupon = await makeCoupon(tx, run, {
      type: "FIXED_AMOUNT",
      value: "115",
    });

    const sale = await createSale(
      {
        source: "WEB",
        warehouseId: fixtureData.warehouse.id,
        customerMobile: testMobile(run),
        customerName: "Free order",
        lines: [{ variantId: fixtureData.variant.id, quantity: 1 }],
        coupon: { id: coupon.id, code: coupon.code, discount: "115" },
        payments: [],
        actorUserId: fixtureData.manager.id,
        clientTransactionUuid: `free-${run}`,
      },
      tx,
    );

    const order = await tx.order.findUniqueOrThrow({
      where: { id: sale.orderId },
      select: { grandTotal: true, paymentStatus: true, paidAmount: true, dueAmount: true },
    });
    assert.equal(order.grandTotal.toFixed(2), "0.00");
    assert.equal(order.paymentStatus, "PAID");
    assert.equal(order.paidAmount.toFixed(2), "0.00");
    assert.equal(order.dueAmount.toFixed(2), "0.00");
  });
});
