import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { Prisma } from "../src/generated/prisma/client";
import { prisma } from "../src/lib/db";
import { hashPin, hashSecret } from "../src/lib/password";
import { postStockMovement } from "../src/lib/inventory/stock";
import {
  approveRefund,
  cancelOrder,
  closeShift,
  completeRefund,
  createSale,
  openShift,
  OrdersError,
  rejectPayment,
  requestRefund,
  verifyPayment,
} from "../src/lib/orders/service";
import {
  allocateDiscount,
  CASHIER_DISCOUNT_CAP,
  computeSaleTotals,
  exceedsCashierCap,
  TotalsError,
} from "../src/lib/orders/totals";

/**
 * Sales tests: VAT-inclusive totals, the cashier discount cap, manager PINs,
 * idempotent offline sync, stock consumption, payment verification, refunds and
 * shift reconciliation.
 *
 * Every database scenario runs inside one interactive transaction that is
 * rolled back. `stock_ledger` is append-only at the database level, so a sale
 * cannot be deleted; rolling back keeps the development database clean while
 * exercising the real SQL, row locks and CHECK constraints.
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

const MANAGER_PIN = "654321";

async function fixture(tx: Prisma.TransactionClient, run: string) {
  const warehouse = await tx.warehouse.findFirstOrThrow({
    where: { isActive: true },
    orderBy: { code: "asc" },
    select: { id: true, code: true },
  });
  const store = await tx.store.findFirstOrThrow({
    where: { isActive: true },
    orderBy: { code: "asc" },
    select: { id: true, name: true },
  });

  const role = await tx.role.findFirstOrThrow({
    where: { code: "OWNER" },
    select: { id: true },
  });

  const manager = await tx.user.create({
    data: {
      email: `sales-manager-${run}@bgd26.test`,
      fullName: "Sales test manager",
      passwordHash: await hashSecret(`Manager-${run}-password`),
      managerPinHash: await hashPin(MANAGER_PIN),
      status: "ACTIVE",
      userRoles: { create: { roleId: role.id } },
    },
    select: { id: true },
  });

  const category = await tx.category.create({
    data: {
      name: `Sales test ${run}`,
      nameBn: "বিক্রয় পরীক্ষা",
      slug: `sales-test-${run}`,
      vatPercentage: "15.00",
    },
    select: { id: true },
  });

  const product = await tx.product.create({
    data: {
      categoryId: category.id,
      name: `Sales test product ${run}`,
      slug: `sales-test-product-${run}`,
      basePrice: "115.00",
      status: "ACTIVE",
      isPublished: true,
    },
    select: { id: true },
  });

  const variant = await tx.productVariant.create({
    data: {
      productId: product.id,
      sku: `SALE-${run.toUpperCase()}`,
      name: "Default",
      price: "115.00",
      costPrice: "80.0000",
      fulfillmentType: "STOCKED",
    },
    select: { id: true, sku: true },
  });

  const device = await tx.posDevice.create({
    data: {
      code: `T${run}`.toUpperCase(),
      name: `Test till ${run}`,
      storeId: store.id,
      warehouseId: warehouse.id,
      deviceFingerprint: `fp-${run}`,
      registeredByUserId: manager.id,
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

  return {
    warehouse,
    store,
    managerId: manager.id,
    actorId: manager.id,
    variant,
    device,
  };
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
// Pure money math
// ---------------------------------------------------------------------------

test("VAT-inclusive totals keep the grand total equal to what the customer pays", () => {
  const totals = computeSaleTotals([
    { quantity: 1, unitPrice: "115.00", vatPercentage: "15.00" },
  ]);
  assert.equal(totals.grandTotal.toFixed(2), "115.00");
  assert.equal(totals.vatTotal.toFixed(2), "15.00");
  assert.equal(totals.subtotal.toFixed(2), "100.00");
  assert.equal(totals.lines[0].lineTotal.toFixed(2), "115.00");
});

test("discount is allocated proportionally and the remainder lands on the last line", () => {
  const shares = allocateDiscount(
    [new Prisma.Decimal("33.33"), new Prisma.Decimal("33.33"), new Prisma.Decimal("33.34")],
    new Prisma.Decimal("10.00"),
  );
  const sum = shares.reduce((total, share) => total.add(share), new Prisma.Decimal(0));
  assert.equal(sum.toFixed(2), "10.00");
  assert.equal(shares.at(-1)?.toFixed(2), "3.34");
});

test("the cashier cap is exactly 5 % of the gross sale value", () => {
  const atCap = computeSaleTotals(
    [{ quantity: 1, unitPrice: "100.00", vatPercentage: "0" }],
    "5.00",
  );
  const aboveCap = computeSaleTotals(
    [{ quantity: 1, unitPrice: "100.00", vatPercentage: "0" }],
    "5.01",
  );
  assert.equal(exceedsCashierCap(atCap), false);
  assert.equal(exceedsCashierCap(aboveCap), true);
  assert.equal(CASHIER_DISCOUNT_CAP, 0.05);
});

test("a discount cannot exceed the sale value or run on an empty cart", () => {
  assert.throws(
    () =>
      computeSaleTotals([{ quantity: 1, unitPrice: "10.00", vatPercentage: "0" }], "11.00"),
    TotalsError,
  );
  assert.throws(() => computeSaleTotals([]), TotalsError);
});

// ---------------------------------------------------------------------------
// Sales, PINs and stock
// ---------------------------------------------------------------------------

test("a walk-in cash sale needs a manager PIN and consumes stock exactly once", async () => {
  const run = suffix();
  await rolledBack(async (tx) => {
    const setup = await fixture(tx, run);
    const sale = {
      source: "POS_ONLINE" as const,
      deviceId: setup.device.id,
      lines: [{ variantId: setup.variant.id, quantity: "1" }],
      payments: [{ method: "CASH" as const, amount: "115.00" }],
      clientTransactionUuid: `walkin-${run}`,
      actorUserId: setup.actorId,
    };

    await assert.rejects(
      createSale(sale, tx),
      (error: unknown) => error instanceof OrdersError && /manager PIN/i.test(error.message),
    );
    assert.equal(await available(tx, setup.variant.id, setup.warehouse.id), "10.000");

    const result = await createSale({ ...sale, managerPin: MANAGER_PIN }, tx);
    assert.equal(result.duplicate, false);
    assert.equal(result.grandTotal.toFixed(2), "115.00");
    assert.equal(result.paidAmount.toFixed(2), "115.00");
    assert.equal(result.dueAmount.toFixed(2), "0.00");
    assert.equal(await available(tx, setup.variant.id, setup.warehouse.id), "9.000");

    const order = await tx.order.findUniqueOrThrow({
      where: { id: result.orderId },
      select: {
        isWalkInCash: true,
        status: true,
        paymentStatus: true,
        walkInApprovedByUserId: true,
        payments: { select: { method: true, status: true, verificationMethod: true } },
      },
    });
    assert.equal(order.isWalkInCash, true);
    assert.equal(order.status, "CONFIRMED");
    assert.equal(order.paymentStatus, "PAID");
    assert.equal(order.walkInApprovedByUserId, setup.managerId);
    assert.deepEqual(order.payments, [
      { method: "CASH", status: "PAID", verificationMethod: "CASH_DRAWER" },
    ]);
  });
});

test("a discount above 5 % needs a PIN; 5 % exactly does not", async () => {
  const run = suffix();
  await rolledBack(async (tx) => {
    const setup = await fixture(tx, run);
    const base = {
      source: "POS_ONLINE" as const,
      deviceId: setup.device.id,
      customerMobile: "01712345678",
      lines: [{ variantId: setup.variant.id, quantity: "1" }],
      payments: [{ method: "CASH" as const, amount: "110.00" }],
      actorUserId: setup.actorId,
    };

    // 5 % of 115 is 5.75, so 5.00 is inside the cashier's authority.
    const allowed = await createSale(
      { ...base, discountTotal: "5.00", clientTransactionUuid: `cap-ok-${run}` },
      tx,
    );
    assert.equal(allowed.grandTotal.toFixed(2), "110.00");

    // 10.00 is 8.7 % and needs a manager.
    const aboveCap = {
      ...base,
      discountTotal: "10.00",
      payments: [{ method: "CASH" as const, amount: "105.00" }],
    };
    await assert.rejects(
      createSale({ ...aboveCap, clientTransactionUuid: `cap-no-${run}` }, tx),
      (error: unknown) => error instanceof OrdersError && /manager PIN/i.test(error.message),
    );

    const approved = await createSale(
      {
        ...aboveCap,
        managerPin: MANAGER_PIN,
        clientTransactionUuid: `cap-pin-${run}`,
      },
      tx,
    );
    assert.equal(approved.grandTotal.toFixed(2), "105.00");

    const order = await tx.order.findUniqueOrThrow({
      where: { id: approved.orderId },
      select: {
        subtotal: true,
        vatTotal: true,
        discountTotal: true,
        grandTotal: true,
        items: {
          select: {
            discountAmount: true,
            vatAmount: true,
            lineSubtotal: true,
            lineTotal: true,
          },
        },
      },
    });
    assert.equal(order.discountTotal.toFixed(2), "10.00");
    assert.equal(order.grandTotal.toFixed(2), "105.00");
    assert.equal(order.subtotal.add(order.vatTotal).sub(order.discountTotal).toFixed(2), "105.00");
    assert.equal(order.items[0].lineTotal.toFixed(2), "105.00");
    assert.equal(order.items[0].discountAmount.toFixed(2), "10.00");
    assert.equal(order.items[0].lineSubtotal.toFixed(2), "100.00");
  });
});

test("an offline sale is never rejected, is flagged for review, and may go negative", async () => {
  const run = suffix();
  await rolledBack(async (tx) => {
    const setup = await fixture(tx, run);
    const result = await createSale(
      {
        source: "POS_OFFLINE",
        deviceId: setup.device.id,
        lines: [{ variantId: setup.variant.id, quantity: "12" }],
        payments: [{ method: "CASH", amount: "1380.00" }],
        clientTransactionUuid: `offline-${run}`,
        offlineCreatedAt: new Date(),
        actorUserId: setup.actorId,
      },
      tx,
    );
    assert.equal(result.approvalDeferred, true);
    assert.equal(await available(tx, setup.variant.id, setup.warehouse.id), "-2.000");

    const order = await tx.order.findUniqueOrThrow({
      where: { id: result.orderId },
      select: { source: true, isWalkInCash: true, internalNote: true, syncedAt: true },
    });
    assert.equal(order.source, "POS_OFFLINE");
    assert.equal(order.isWalkInCash, true);
    assert.match(order.internalNote ?? "", /approval deferred/i);
    assert.ok(order.syncedAt);
  });
});

test("a repeated client transaction id returns the same order without touching stock twice", async () => {
  const run = suffix();
  await rolledBack(async (tx) => {
    const setup = await fixture(tx, run);
    const input = {
      source: "POS_ONLINE" as const,
      deviceId: setup.device.id,
      customerMobile: "01712345678",
      lines: [{ variantId: setup.variant.id, quantity: "2" }],
      payments: [{ method: "CASH" as const, amount: "230.00" }],
      clientTransactionUuid: `idem-${run}`,
      actorUserId: setup.actorId,
    };

    const first = await createSale(input, tx);
    const second = await createSale(input, tx);
    assert.equal(first.duplicate, false);
    assert.equal(second.duplicate, true);
    assert.equal(second.orderId, first.orderId);
    assert.equal(await available(tx, setup.variant.id, setup.warehouse.id), "8.000");
    assert.equal(await tx.order.count({ where: { clientTransactionUuid: `idem-${run}` } }), 1);
  });
});

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

test("digital money waits for verification and only then becomes paid", async () => {
  const run = suffix();
  await rolledBack(async (tx) => {
    const setup = await fixture(tx, run);
    const sale = await createSale(
      {
        source: "POS_ONLINE",
        deviceId: setup.device.id,
        customerMobile: "01712345678",
        lines: [{ variantId: setup.variant.id, quantity: "1" }],
        payments: [{ method: "BKASH", amount: "115.00", reference: `TRX-${run}` }],
        clientTransactionUuid: `bkash-${run}`,
        actorUserId: setup.actorId,
      },
      tx,
    );
    assert.equal(sale.paidAmount.toFixed(2), "0.00");

    const pending = await tx.order.findUniqueOrThrow({
      where: { id: sale.orderId },
      select: {
        paymentStatus: true,
        dueAmount: true,
        payments: { select: { id: true, status: true } },
      },
    });
    assert.equal(pending.paymentStatus, "PENDING_VERIFICATION");
    assert.equal(pending.dueAmount.toFixed(2), "115.00");
    assert.equal(pending.payments[0].status, "PENDING_VERIFICATION");

    await verifyPayment(
      pending.payments[0].id,
      setup.managerId,
      { reference: `TRX-${run}` },
      tx,
    );

    const paid = await tx.order.findUniqueOrThrow({
      where: { id: sale.orderId },
      select: {
        paymentStatus: true,
        paidAmount: true,
        dueAmount: true,
        payments: { select: { status: true, verificationMethod: true } },
      },
    });
    assert.equal(paid.paymentStatus, "PAID");
    assert.equal(paid.paidAmount.toFixed(2), "115.00");
    assert.equal(paid.dueAmount.toFixed(2), "0.00");
    assert.equal(paid.payments[0].verificationMethod, "MANUAL_MANAGER");

    const audit = await tx.paymentAuditLog.count({
      where: { paymentId: pending.payments[0].id, action: "payment.verified" },
    });
    assert.equal(audit, 1);
  });
});

test("a rejected digital payment leaves the order unpaid", async () => {
  const run = suffix();
  await rolledBack(async (tx) => {
    const setup = await fixture(tx, run);
    const sale = await createSale(
      {
        source: "POS_ONLINE",
        deviceId: setup.device.id,
        customerMobile: "01712345678",
        lines: [{ variantId: setup.variant.id, quantity: "1" }],
        payments: [{ method: "NAGAD", amount: "115.00" }],
        clientTransactionUuid: `nagad-${run}`,
        actorUserId: setup.actorId,
      },
      tx,
    );
    const payment = await tx.payment.findFirstOrThrow({
      where: { orderId: sale.orderId },
      select: { id: true },
    });

    await rejectPayment(payment.id, setup.managerId, "Transaction not found", tx);

    const order = await tx.order.findUniqueOrThrow({
      where: { id: sale.orderId },
      select: { paymentStatus: true, payments: { select: { status: true } } },
    });
    assert.equal(order.paymentStatus, "UNPAID");
    assert.equal(order.payments[0].status, "FAILED");
  });
});

// ---------------------------------------------------------------------------
// Refunds and cancellation
// ---------------------------------------------------------------------------

test("approving a refund restocks at the sale-time cost and completing it settles the order", async () => {
  const run = suffix();
  await rolledBack(async (tx) => {
    const setup = await fixture(tx, run);
    const sale = await createSale(
      {
        source: "POS_ONLINE",
        deviceId: setup.device.id,
        customerMobile: "01712345678",
        lines: [{ variantId: setup.variant.id, quantity: "2" }],
        payments: [{ method: "CASH", amount: "230.00" }],
        clientTransactionUuid: `refund-${run}`,
        actorUserId: setup.actorId,
      },
      tx,
    );
    assert.equal(await available(tx, setup.variant.id, setup.warehouse.id), "8.000");

    const item = await tx.orderItem.findFirstOrThrow({
      where: { orderId: sale.orderId },
      select: { id: true },
    });

    const refund = await requestRefund(
      {
        orderId: sale.orderId,
        lines: [{ orderItemId: item.id, quantity: "2", restock: true }],
        reason: "Customer changed their mind",
        method: "CASH",
        actorUserId: setup.actorId,
      },
      tx,
    );
    assert.equal(refund.totalAmount.toFixed(2), "230.00");
    // Requesting does not move stock.
    assert.equal(await available(tx, setup.variant.id, setup.warehouse.id), "8.000");

    await approveRefund(refund.refundId, setup.managerId, tx);
    assert.equal(await available(tx, setup.variant.id, setup.warehouse.id), "10.000");

    await completeRefund(refund.refundId, setup.managerId, tx);
    const order = await tx.order.findUniqueOrThrow({
      where: { id: sale.orderId },
      select: { status: true, paymentStatus: true },
    });
    assert.equal(order.status, "REFUNDED");
    assert.equal(order.paymentStatus, "REFUNDED");

    const ledger = await tx.stockLedger.findMany({
      where: { referenceType: "refund", referenceId: refund.refundId },
      select: { movementType: true, quantity: true, unitCost: true },
    });
    assert.equal(ledger.length, 1);
    assert.equal(ledger[0].movementType, "SALE_RETURN");
    assert.equal(ledger[0].quantity.toFixed(3), "2.000");
    assert.equal(ledger[0].unitCost.toFixed(4), "80.0000");
  });
});

test("cancelling an order returns its stock and cannot happen twice", async () => {
  const run = suffix();
  await rolledBack(async (tx) => {
    const setup = await fixture(tx, run);
    const sale = await createSale(
      {
        source: "POS_ONLINE",
        deviceId: setup.device.id,
        customerMobile: "01712345678",
        lines: [{ variantId: setup.variant.id, quantity: "3" }],
        payments: [{ method: "CASH", amount: "345.00" }],
        clientTransactionUuid: `cancel-${run}`,
        actorUserId: setup.actorId,
      },
      tx,
    );
    assert.equal(await available(tx, setup.variant.id, setup.warehouse.id), "7.000");

    await cancelOrder(sale.orderId, setup.managerId, "Customer cancelled", tx);
    assert.equal(await available(tx, setup.variant.id, setup.warehouse.id), "10.000");

    await assert.rejects(
      cancelOrder(sale.orderId, setup.managerId, "Again", tx),
      OrdersError,
    );
    assert.equal(await available(tx, setup.variant.id, setup.warehouse.id), "10.000");
  });
});

// ---------------------------------------------------------------------------
// Shifts
// ---------------------------------------------------------------------------

test("closing a shift reconciles the drawer and reports the variance", async () => {
  const run = suffix();
  await rolledBack(async (tx) => {
    const setup = await fixture(tx, run);
    const shift = await openShift(
      { deviceId: setup.device.id, openingFloat: "500.00" },
      setup.managerId,
      tx,
    );

    await createSale(
      {
        source: "POS_ONLINE",
        deviceId: setup.device.id,
        shiftId: shift.id,
        customerMobile: "01712345678",
        lines: [{ variantId: setup.variant.id, quantity: "1" }],
        payments: [{ method: "CASH", amount: "115.00" }],
        clientTransactionUuid: `shift-${run}`,
        actorUserId: setup.actorId,
      },
      tx,
    );

    const counted = await closeShift(
      { shiftId: shift.id, countedCash: "615.00" },
      setup.managerId,
      tx,
    );
    assert.equal(counted.expectedCash.toFixed(2), "615.00");
    assert.equal(counted.variance.toFixed(2), "0.00");

    const closed = await tx.posShift.findUniqueOrThrow({
      where: { id: shift.id },
      select: { status: true, expectedCash: true, closingCounted: true, cashVariance: true },
    });
    assert.equal(closed.status, "CLOSED");
    assert.equal(closed.cashVariance?.toFixed(2), "0.00");

    await assert.rejects(
      closeShift({ shiftId: shift.id, countedCash: "615.00" }, setup.managerId, tx),
      OrdersError,
    );
  });
});
