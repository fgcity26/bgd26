import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { Prisma } from "../src/generated/prisma/client";
import { prisma } from "../src/lib/db";
import { hashSecret } from "../src/lib/password";
import { postStockMovement } from "../src/lib/inventory/stock";
import {
  approveRefund,
  cancelOrder,
  completeRefund,
  createSale,
  requestRefund,
  verifyPayment,
} from "../src/lib/orders/service";
import {
  adjustPoints,
  expirePoints,
  LOYALTY,
  LoyaltyError,
  maxRedeemablePoints,
  netMerchandise,
  pointsForNet,
} from "../src/lib/loyalty/service";

/**
 * Loyalty tests: earning, redemption and the cap, the ledger, expiry, manual
 * adjustments, cancellation, refund claw-back, offline behaviour and the
 * database invariants.
 *
 * Every scenario runs inside one interactive transaction that is rolled back,
 * so the real SQL, CHECK constraints and partial unique indexes are exercised
 * while the development database keeps only its committed history.
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
  // Bangladeshi mobile numbers start with an operator digit 3–9 after +8801.
  const digits = String(3 + (Number(raw[0]) % 7)) + raw.slice(1);
  return `+8801${digits}`;
}

async function fixture(tx: Prisma.TransactionClient, run: string, points = 0) {
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

  const actor = await tx.user.create({
    data: {
      email: `loyalty-${run}@bgd26.test`,
      fullName: "Loyalty test actor",
      passwordHash: await hashSecret(`Loyalty-${run}-password`),
      status: "ACTIVE",
      userRoles: { create: { roleId: role.id } },
    },
    select: { id: true },
  });

  const category = await tx.category.create({
    data: {
      name: `Loyalty test ${run}`,
      nameBn: "লয়্যালটি পরীক্ষা",
      slug: `loyalty-test-${run}`,
      vatPercentage: "15.00",
    },
    select: { id: true },
  });

  const product = await tx.product.create({
    data: {
      categoryId: category.id,
      name: `Loyalty product ${run}`,
      slug: `loyalty-product-${run}`,
      basePrice: "115.00",
      status: "ACTIVE",
      isPublished: true,
    },
    select: { id: true },
  });

  const variant = await tx.productVariant.create({
    data: {
      productId: product.id,
      sku: `LOY-${run.toUpperCase()}`,
      name: "Default",
      price: "115.00",
      costPrice: "80.0000",
      fulfillmentType: "STOCKED",
    },
    select: { id: true },
  });

  const device = await tx.posDevice.create({
    data: {
      code: `L${run}`.toUpperCase(),
      name: `Loyalty till ${run}`,
      storeId: store.id,
      warehouseId: warehouse.id,
      deviceFingerprint: `loyalty-fp-${run}`,
      registeredByUserId: actor.id,
    },
    select: { id: true },
  });

  await postStockMovement(tx, {
    variantId: variant.id,
    warehouseId: warehouse.id,
    storeId: store.id,
    movementType: "OPENING_BALANCE",
    quantity: "50",
    unitCost: "80",
    referenceType: "test",
    referenceId: run,
    actorUserId: actor.id,
  });

  const customer = await tx.customer.create({
    data: {
      mobileNormalized: testMobile(run),
      mobileRaw: `01${testMobile(run).slice(5)}`,
      fullName: `Loyalty customer ${run}`,
      loyaltyPointsBalance: points,
    },
    select: { id: true, loyaltyPointsBalance: true, mobileNormalized: true },
  });

  return {
    warehouse,
    store,
    actorId: actor.id,
    variant,
    device,
    customer,
  };
}

function cashSale(
  setup: Awaited<ReturnType<typeof fixture>>,
  run: string,
  overrides: Partial<Parameters<typeof createSale>[0]> = {},
): Parameters<typeof createSale>[0] {
  return {
    source: "POS_ONLINE",
    deviceId: setup.device.id,
    customerMobile: setup.customer.mobileNormalized,
    lines: [{ variantId: setup.variant.id, quantity: "10" }],
    payments: [{ method: "CASH", amount: "1150.00" }],
    clientTransactionUuid: `loyalty-sale-${run}`,
    actorUserId: setup.actorId,
    ...overrides,
  };
}

async function orderLoyalty(
  tx: Prisma.TransactionClient,
  orderId: string,
): Promise<{
  loyaltyRedeemedPoints: number;
  loyaltyDiscount: string;
  loyaltyEarnedPoints: number;
  grandTotal: string;
  paymentStatus: string;
}> {
  const order = await tx.order.findUniqueOrThrow({
    where: { id: orderId },
    select: {
      loyaltyRedeemedPoints: true,
      loyaltyDiscount: true,
      loyaltyEarnedPoints: true,
      grandTotal: true,
      paymentStatus: true,
    },
  });
  return {
    loyaltyRedeemedPoints: order.loyaltyRedeemedPoints,
    loyaltyDiscount: order.loyaltyDiscount.toFixed(2),
    loyaltyEarnedPoints: order.loyaltyEarnedPoints,
    grandTotal: order.grandTotal.toFixed(2),
    paymentStatus: order.paymentStatus,
  };
}

async function journalFor(
  tx: Prisma.TransactionClient,
  referenceType: string,
  referenceId: string,
) {
  return tx.journalEntry.findFirstOrThrow({
    where: { referenceType, referenceId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      status: true,
      totalDebit: true,
      totalCredit: true,
      lines: {
        select: { debit: true, credit: true, account: { select: { code: true } } },
      },
    },
  });
}

function lineAmount(
  entry: Awaited<ReturnType<typeof journalFor>>,
  code: string,
  side: "debit" | "credit",
): string {
  const line = entry.lines.find((row) => row.account.code === code);
  return (line?.[side] ?? new Prisma.Decimal(0)).toFixed(2);
}

// ---------------------------------------------------------------------------
// Pure rules
// ---------------------------------------------------------------------------

test("one point per ৳100 of net merchandise and a 20 % redemption cap", () => {
  assert.equal(netMerchandise("1000.00", "0").toFixed(2), "1000.00");
  assert.equal(netMerchandise("1000.00", "150.00").toFixed(2), "850.00");
  assert.equal(pointsForNet("1000.00"), 10);
  assert.equal(pointsForNet("99.99"), 0);
  assert.equal(maxRedeemablePoints("1000.00"), 200);
  assert.equal(LOYALTY.pointValue, 1);
  assert.equal(LOYALTY.expiryMonths, 12);
});

// ---------------------------------------------------------------------------
// Earning and redeeming
// ---------------------------------------------------------------------------

test("a paid sale redeems points, posts the liability line and earns new points", async () => {
  const run = suffix();
  await rolledBack(async (tx) => {
    const setup = await fixture(tx, run, 500);
    const sale = await createSale(
      cashSale(setup, run, {
        loyaltyRedeemPoints: 100,
        payments: [{ method: "CASH", amount: "1050.00" }],
      }),
      tx,
    );

    const order = await orderLoyalty(tx, sale.orderId);
    assert.equal(order.loyaltyRedeemedPoints, 100);
    assert.equal(order.loyaltyDiscount, "100.00");
    assert.equal(order.grandTotal, "1050.00");
    assert.equal(order.paymentStatus, "PAID");
    // Net merchandise is ৳1,000 → 10 points earned; 500 − 100 + 10 = 410.
    assert.equal(order.loyaltyEarnedPoints, 10);

    const customer = await tx.customer.findUniqueOrThrow({
      where: { id: setup.customer.id },
      select: { loyaltyPointsBalance: true },
    });
    assert.equal(customer.loyaltyPointsBalance, 410);

    const redeem = await tx.loyaltyTransaction.findFirstOrThrow({
      where: { orderId: sale.orderId, type: "REDEEM" },
      select: { points: true, balanceAfter: true },
    });
    assert.equal(redeem.points, -100);
    assert.equal(redeem.balanceAfter, 400);

    const earn = await tx.loyaltyTransaction.findFirstOrThrow({
      where: { orderId: sale.orderId, type: "EARN" },
      select: { id: true, points: true, balanceAfter: true, expiresAt: true },
    });
    assert.equal(earn.points, 10);
    assert.equal(earn.balanceAfter, 410);
    assert.ok(earn.expiresAt);

    const saleEntry = await journalFor(tx, "order", sale.orderId);
    assert.equal(saleEntry.status, "POSTED");
    assert.equal(saleEntry.totalDebit.toFixed(2), saleEntry.totalCredit.toFixed(2));
    assert.equal(lineAmount(saleEntry, "1500", "debit"), "100.00");
    assert.equal(lineAmount(saleEntry, "1050", "debit"), "1050.00");

    const earnEntry = await journalFor(tx, "loyalty_transaction", earn.id);
    assert.equal(lineAmount(earnEntry, "5500", "debit"), "10.00");
    assert.equal(lineAmount(earnEntry, "1500", "credit"), "10.00");
  });
});

test("the redemption cap and the live balance are enforced", async () => {
  const run = suffix();
  await rolledBack(async (tx) => {
    const setup = await fixture(tx, run, 500);

    await assert.rejects(
      createSale(cashSale(setup, run, { loyaltyRedeemPoints: 201 }), tx),
      (error: unknown) => error instanceof LoyaltyError || /at most 200 points/.test(String(error)),
    );

    const poor = await tx.customer.create({
      data: {
        mobileNormalized: testMobile(`${run}aa`),
        fullName: "Poor points customer",
        loyaltyPointsBalance: 5,
      },
      select: { id: true, mobileNormalized: true },
    });
    await assert.rejects(
      createSale(
        cashSale(setup, run, {
          customerMobile: poor.mobileNormalized,
          loyaltyRedeemPoints: 10,
          clientTransactionUuid: `loyalty-poor-${run}`,
        }),
        tx,
      ),
      (error: unknown) => error instanceof LoyaltyError || /at most 5 points/.test(String(error)),
    );
  });
});

test("a digital sale earns only when a manager verifies the payment", async () => {
  const run = suffix();
  await rolledBack(async (tx) => {
    const setup = await fixture(tx, run, 0);
    const sale = await createSale(
      cashSale(setup, run, {
        lines: [{ variantId: setup.variant.id, quantity: "1" }],
        payments: [{ method: "BKASH", amount: "115.00", reference: `TRX-${run}` }],
      }),
      tx,
    );

    let order = await orderLoyalty(tx, sale.orderId);
    assert.equal(order.paymentStatus, "PENDING_VERIFICATION");
    assert.equal(order.loyaltyEarnedPoints, 0);
    assert.equal(
      await tx.loyaltyTransaction.count({ where: { orderId: sale.orderId, type: "EARN" } }),
      0,
    );

    const payment = await tx.payment.findFirstOrThrow({
      where: { orderId: sale.orderId },
      select: { id: true },
    });
    await verifyPayment(payment.id, setup.actorId, { reference: `TRX-${run}` }, tx);

    order = await orderLoyalty(tx, sale.orderId);
    assert.equal(order.paymentStatus, "PAID");
    assert.equal(order.loyaltyEarnedPoints, 1);

    const earn = await tx.loyaltyTransaction.findFirstOrThrow({
      where: { orderId: sale.orderId, type: "EARN" },
      select: { id: true, points: true },
    });
    assert.equal(earn.points, 1);

    const entry = await journalFor(tx, "loyalty_transaction", earn.id);
    assert.equal(lineAmount(entry, "5500", "debit"), "1.00");
    assert.equal(lineAmount(entry, "1500", "credit"), "1.00");
  });
});

test("an offline sale cannot redeem but earns after it syncs", async () => {
  const run = suffix();
  await rolledBack(async (tx) => {
    const setup = await fixture(tx, run, 300);
    const sale = await createSale(
      cashSale(setup, run, {
        source: "POS_OFFLINE",
        loyaltyRedeemPoints: 100,
        payments: [{ method: "CASH", amount: "1150.00" }],
      }),
      tx,
    );

    const order = await orderLoyalty(tx, sale.orderId);
    assert.equal(order.loyaltyRedeemedPoints, 0);
    assert.equal(order.loyaltyDiscount, "0.00");
    assert.equal(order.grandTotal, "1150.00");
    assert.equal(order.paymentStatus, "PAID");
    assert.equal(order.loyaltyEarnedPoints, 10);

    assert.equal(
      await tx.loyaltyTransaction.count({ where: { orderId: sale.orderId, type: "REDEEM" } }),
      0,
    );
    const customer = await tx.customer.findUniqueOrThrow({
      where: { id: setup.customer.id },
      select: { loyaltyPointsBalance: true },
    });
    assert.equal(customer.loyaltyPointsBalance, 310);
  });
});

// ---------------------------------------------------------------------------
// Cancellation and refunds
// ---------------------------------------------------------------------------

test("cancelling restores redeemed points and claws back earned points", async () => {
  const run = suffix();
  await rolledBack(async (tx) => {
    const setup = await fixture(tx, run, 500);
    const sale = await createSale(
      cashSale(setup, run, {
        loyaltyRedeemPoints: 100,
        payments: [{ method: "CASH", amount: "1050.00" }],
      }),
      tx,
    );

    await cancelOrder(sale.orderId, setup.actorId, "Loyalty cancellation test", tx);

    const customer = await tx.customer.findUniqueOrThrow({
      where: { id: setup.customer.id },
      select: { loyaltyPointsBalance: true },
    });
    assert.equal(customer.loyaltyPointsBalance, 500);

    const movements = await tx.loyaltyTransaction.findMany({
      where: { orderId: sale.orderId, type: "REVERSAL" },
      orderBy: { points: "asc" },
      select: { points: true, referenceType: true },
    });
    assert.deepEqual(
      movements.map((row) => row.points),
      [-10, 100],
    );
    assert.equal(
      movements.find((row) => row.points === -10)?.referenceType,
      "order_cancel_earn",
    );
    assert.equal(
      movements.find((row) => row.points === 100)?.referenceType,
      "order_cancel_redeem",
    );

    const earnedReversal = await tx.journalEntry.findFirstOrThrow({
      where: {
        referenceType: "loyalty_transaction",
        referenceId: {
          in: (
            await tx.loyaltyTransaction.findMany({
              where: { orderId: sale.orderId, referenceType: "order_cancel_earn" },
              select: { id: true },
            })
          ).map((row) => row.id),
        },
      },
      select: { id: true, lines: { select: { debit: true, credit: true, account: { select: { code: true } } } } },
    });
    const liability = earnedReversal.lines.find((line) => line.account.code === "1500");
    assert.equal(liability?.debit.toFixed(2), "10.00");
  });
});

test("a refund reverses earned points in proportion to the refund", async () => {
  const run = suffix();
  await rolledBack(async (tx) => {
    const setup = await fixture(tx, run, 0);
    const sale = await createSale(cashSale(setup, run), tx);
    assert.equal((await orderLoyalty(tx, sale.orderId)).loyaltyEarnedPoints, 10);

    const item = await tx.orderItem.findFirstOrThrow({
      where: { orderId: sale.orderId },
      select: { id: true },
    });
    const refund = await requestRefund(
      {
        orderId: sale.orderId,
        lines: [{ orderItemId: item.id, quantity: "1", restock: true }],
        reason: "Loyalty refund test",
        method: "CASH",
        actorUserId: setup.actorId,
      },
      tx,
    );
    await approveRefund(refund.refundId, setup.actorId, tx);
    await completeRefund(refund.refundId, setup.actorId, tx);

    const customer = await tx.customer.findUniqueOrThrow({
      where: { id: setup.customer.id },
      select: { loyaltyPointsBalance: true },
    });
    assert.equal(customer.loyaltyPointsBalance, 9);

    const reversal = await tx.loyaltyTransaction.findFirstOrThrow({
      where: { orderId: sale.orderId, type: "REVERSAL" },
      select: { points: true, referenceType: true, referenceId: true },
    });
    assert.equal(reversal.points, -1);
    assert.equal(reversal.referenceType, "refund");
    assert.equal(reversal.referenceId, refund.refundId);
  });
});

// ---------------------------------------------------------------------------
// Expiry, adjustments and database invariants
// ---------------------------------------------------------------------------

test("points older than twelve months expire once and post a reversal journal", async () => {
  const run = suffix();
  await rolledBack(async (tx) => {
    const setup = await fixture(tx, run, 50);
    const old = await tx.loyaltyTransaction.create({
      data: {
        customerId: setup.customer.id,
        type: "EARN",
        points: 50,
        balanceAfter: 50,
        expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
        referenceType: "test",
        referenceId: run,
        createdByUserId: setup.actorId,
      },
      select: { id: true },
    });

    const first = await expirePoints({ customerId: setup.customer.id, actorUserId: setup.actorId }, tx);
    assert.equal(first.points, 50);
    assert.equal(first.customers, 1);

    const customer = await tx.customer.findUniqueOrThrow({
      where: { id: setup.customer.id },
      select: { loyaltyPointsBalance: true },
    });
    assert.equal(customer.loyaltyPointsBalance, 0);

    const expiry = await tx.loyaltyTransaction.findFirstOrThrow({
      where: { customerId: setup.customer.id, type: "EXPIRE" },
      select: { id: true, points: true, balanceAfter: true },
    });
    assert.equal(expiry.points, -50);
    assert.equal(expiry.balanceAfter, 0);

    const entry = await journalFor(tx, "loyalty_transaction", expiry.id);
    assert.equal(lineAmount(entry, "1500", "debit"), "50.00");
    assert.equal(lineAmount(entry, "5500", "credit"), "50.00");

    const second = await expirePoints({ customerId: setup.customer.id, actorUserId: setup.actorId }, tx);
    assert.equal(second.points, 0);
    assert.ok(old.id);
  });
});

test("a manager adjustment posts a journal and cannot take a balance negative", async () => {
  const run = suffix();
  await rolledBack(async (tx) => {
    const setup = await fixture(tx, run, 0);

    const grant = await adjustPoints(
      {
        customerId: setup.customer.id,
        points: 25,
        reason: "Goodwill grant",
        actorUserId: setup.actorId,
      },
      tx,
    );
    assert.equal(grant.points, 25);
    assert.equal(grant.balanceAfter, 25);

    const grantEntry = await journalFor(tx, "loyalty_transaction", grant.transactionId);
    assert.equal(lineAmount(grantEntry, "5500", "debit"), "25.00");
    assert.equal(lineAmount(grantEntry, "1500", "credit"), "25.00");

    const correction = await adjustPoints(
      {
        customerId: setup.customer.id,
        points: -10,
        reason: "Correction",
        actorUserId: setup.actorId,
      },
      tx,
    );
    assert.equal(correction.balanceAfter, 15);

    await assert.rejects(
      adjustPoints(
        {
          customerId: setup.customer.id,
          points: -100,
          reason: "Too much",
          actorUserId: setup.actorId,
        },
        tx,
      ),
      LoyaltyError,
    );
  });
});

test("the database refuses a negative balance and a wrongly signed movement", async () => {
  const run = suffix();
  await rolledBack(async (tx) => {
    const setup = await fixture(tx, run, 0);

    await assert.rejects(
      tx.customer.update({
        where: { id: setup.customer.id },
        data: { loyaltyPointsBalance: -1 },
      }),
    );
  });

  const second = suffix();
  await rolledBack(async (tx) => {
    const setup = await fixture(tx, second, 10);
    await assert.rejects(
      tx.loyaltyTransaction.create({
        data: {
          customerId: setup.customer.id,
          type: "REDEEM",
          points: 5,
          balanceAfter: 5,
        },
      }),
    );
  });
});
