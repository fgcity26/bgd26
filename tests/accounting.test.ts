import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { Prisma } from "../src/generated/prisma/client";
import { prisma } from "../src/lib/db";
import { hashPin, hashSecret } from "../src/lib/password";
import {
  createAdjustment,
  postAdjustment,
  postOpeningStock,
} from "../src/lib/inventory/service";
import {
  createPurchaseOrder,
  createGrn,
  createSupplier,
  postGrn,
  sendPurchaseOrder,
} from "../src/lib/purchasing/service";
import {
  approveRefund,
  completeRefund,
  createSale,
  requestRefund,
  verifyPayment,
} from "../src/lib/orders/service";
import {
  ACCOUNTS,
  AccountingError,
  postJournal,
  reverseJournal,
} from "../src/lib/accounting/journal";
import {
  createExpense,
  postExpense,
  trialBalance,
  voidExpense,
} from "../src/lib/accounting/service";

/**
 * Accounting tests: balanced posting, immutability, reversal, fiscal-period
 * locks, and the journal that each business event writes.
 *
 * Every database scenario runs inside one interactive transaction that is
 * rolled back, so the real SQL, triggers and constraints are exercised while the
 * development database keeps only its committed history.
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
      email: `accounting-manager-${run}@bgd26.test`,
      fullName: "Accounting test manager",
      passwordHash: await hashSecret(`Manager-${run}-password`),
      managerPinHash: await hashPin(MANAGER_PIN),
      status: "ACTIVE",
      userRoles: { create: { roleId: role.id } },
    },
    select: { id: true },
  });

  const category = await tx.category.create({
    data: {
      name: `Accounting test ${run}`,
      nameBn: "হিসাব পরীক্ষা",
      slug: `accounting-test-${run}`,
      vatPercentage: "15.00",
    },
    select: { id: true },
  });

  const product = await tx.product.create({
    data: {
      categoryId: category.id,
      name: `Accounting test product ${run}`,
      slug: `accounting-test-product-${run}`,
      basePrice: "115.00",
      status: "ACTIVE",
      isPublished: true,
    },
    select: { id: true },
  });

  const variant = await tx.productVariant.create({
    data: {
      productId: product.id,
      sku: `ACC-${run.toUpperCase()}`,
      name: "Default",
      price: "115.00",
      costPrice: "80.0000",
      fulfillmentType: "STOCKED",
    },
    select: { id: true, sku: true },
  });

  const device = await tx.posDevice.create({
    data: {
      code: `A${run}`.toUpperCase(),
      name: `Accounting till ${run}`,
      storeId: store.id,
      warehouseId: warehouse.id,
      deviceFingerprint: `acc-fp-${run}`,
      registeredByUserId: manager.id,
    },
    select: { id: true },
  });

  await postOpeningStock(
    {
      variantId: variant.id,
      warehouseId: warehouse.id,
      quantity: "10",
      unitCost: "80",
      note: "Accounting test opening",
      actorUserId: manager.id,
    },
    tx,
  );

  return {
    warehouse,
    store,
    managerId: manager.id,
    variant,
    device,
  };
}

async function entriesFor(
  tx: Prisma.TransactionClient,
  referenceType: string,
  referenceId: string,
) {
  return tx.journalEntry.findMany({
    where: { referenceType, referenceId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      entryNumber: true,
      source: true,
      status: true,
      totalDebit: true,
      totalCredit: true,
      reversalOfId: true,
      reversalEntry: { select: { id: true } },
      lines: {
        orderBy: { lineOrder: "asc" },
        select: {
          debit: true,
          credit: true,
          account: { select: { code: true } },
        },
      },
    },
  });
}

function lineFor(
  entry: { lines: Array<{ debit: Prisma.Decimal; credit: Prisma.Decimal; account: { code: string } }> },
  code: string,
): { debit: Prisma.Decimal; credit: Prisma.Decimal } {
  const line = entry.lines.find((row) => row.account.code === code);
  assert.ok(line, `expected a line on account ${code}`);
  return { debit: line.debit, credit: line.credit };
}

// ---------------------------------------------------------------------------
// Core journal engine
// ---------------------------------------------------------------------------

test("a balanced journal posts, and a posted entry cannot be edited", async () => {
  const run = suffix();
  await rolledBack(async (tx) => {
    const setup = await fixture(tx, run);
    const entry = await postJournal(tx, {
      description: "Manual test entry",
      source: "MANUAL",
      referenceType: "test",
      referenceId: run,
      actorUserId: setup.managerId,
      lines: [
        { account: ACCOUNTS.cash, debit: "250.00" },
        { account: ACCOUNTS.equity, credit: "250.00" },
      ],
    });
    assert.ok(entry);
    assert.equal(entry.totalDebit.toFixed(2), "250.00");
    assert.equal(entry.totalCredit.toFixed(2), "250.00");

    const posted = await tx.journalEntry.findUniqueOrThrow({
      where: { id: entry.id },
      select: { status: true, postedAt: true, lines: { select: { lineOrder: true } } },
    });
    assert.equal(posted.status, "POSTED");
    assert.ok(posted.postedAt);
    assert.equal(posted.lines.length, 2);

    // The database aborts the transaction on the first trigger error, so this
    // probe is the last statement: the rollback wrapper discards the aborted
    // transaction and the development database keeps no partial row.
    await assert.rejects(
      tx.journalEntry.update({ where: { id: entry.id }, data: { description: "edited" } }),
      /immutable/i,
    );
  });
});

test("an unbalanced journal is refused before it reaches the database", async () => {
  const run = suffix();
  await rolledBack(async (tx) => {
    const setup = await fixture(tx, run);
    await assert.rejects(
      postJournal(tx, {
        description: "Unbalanced",
        source: "MANUAL",
        actorUserId: setup.managerId,
        lines: [
          { account: ACCOUNTS.cash, debit: "100.00" },
          { account: ACCOUNTS.equity, credit: "99.00" },
        ],
      }),
      (error: unknown) => error instanceof AccountingError && /does not balance/i.test(error.message),
    );
    await assert.rejects(
      postJournal(tx, {
        description: "Both sides",
        source: "MANUAL",
        actorUserId: setup.managerId,
        lines: [
          { account: ACCOUNTS.cash, debit: "100.00", credit: "100.00" },
          { account: ACCOUNTS.equity, credit: "100.00" },
        ],
      }),
      /either a debit or a credit/i,
    );
  });
});

test("a reversal mirrors the entry, points at the original, and happens once", async () => {
  const run = suffix();
  await rolledBack(async (tx) => {
    const setup = await fixture(tx, run);
    const original = await postJournal(tx, {
      description: "Original entry",
      source: "MANUAL",
      actorUserId: setup.managerId,
      lines: [
        { account: ACCOUNTS.cash, debit: "50.00" },
        { account: ACCOUNTS.equity, credit: "50.00" },
      ],
    });
    assert.ok(original);

    const reversal = await reverseJournal(tx, {
      entryId: original.id,
      actorUserId: setup.managerId,
      reason: "posted by mistake",
    });
    assert.ok(reversal);

    const row = await tx.journalEntry.findUniqueOrThrow({
      where: { id: reversal.id },
      select: {
        reversalOfId: true,
        status: true,
        lines: { select: { debit: true, credit: true, account: { select: { code: true } } } },
      },
    });
    assert.equal(row.reversalOfId, original.id);
    assert.equal(row.status, "POSTED");
    assert.equal(lineFor(row, ACCOUNTS.cash).credit.toFixed(2), "50.00");
    assert.equal(lineFor(row, ACCOUNTS.equity).debit.toFixed(2), "50.00");

    await assert.rejects(
      reverseJournal(tx, {
        entryId: original.id,
        actorUserId: setup.managerId,
        reason: "again",
      }),
      /already been reversed/i,
    );
  });
});

test("a locked fiscal period refuses new entries", async () => {
  const run = suffix();
  await rolledBack(async (tx) => {
    const setup = await fixture(tx, run);
    const period = await tx.fiscalPeriod.findFirstOrThrow({
      where: { startDate: { lte: new Date() }, endDate: { gte: new Date() } },
      select: { id: true },
    });
    await tx.fiscalPeriod.update({ where: { id: period.id }, data: { status: "LOCKED" } });

    await assert.rejects(
      postJournal(tx, {
        description: "After lock",
        source: "MANUAL",
        actorUserId: setup.managerId,
        lines: [
          { account: ACCOUNTS.cash, debit: "10.00" },
          { account: ACCOUNTS.equity, credit: "10.00" },
        ],
      }),
      /accepts no new entries/i,
    );
  });
});

// ---------------------------------------------------------------------------
// Business events
// ---------------------------------------------------------------------------

test("a cash sale posts the sale and the drawer as balanced entries", async () => {
  const run = suffix();
  await rolledBack(async (tx) => {
    const setup = await fixture(tx, run);
    const sale = await createSale(
      {
        source: "POS_ONLINE",
        deviceId: setup.device.id,
        customerMobile: "01712345678",
        lines: [{ variantId: setup.variant.id, quantity: "1" }],
        payments: [{ method: "CASH", amount: "115.00" }],
        clientTransactionUuid: `acc-sale-${run}`,
        actorUserId: setup.managerId,
      },
      tx,
    );

    const entries = await entriesFor(tx, "order", sale.orderId);
    assert.equal(entries.length, 1);
    const saleEntry = entries[0]!;
    assert.equal(saleEntry.source, "POS_SALE");
    assert.equal(saleEntry.status, "POSTED");
    assert.equal(saleEntry.totalDebit.toFixed(2), "195.00");
    assert.equal(saleEntry.totalCredit.toFixed(2), "195.00");
    assert.equal(lineFor(saleEntry, ACCOUNTS.receivable).debit.toFixed(2), "115.00");
    assert.equal(lineFor(saleEntry, ACCOUNTS.sales).credit.toFixed(2), "100.00");
    assert.equal(lineFor(saleEntry, ACCOUNTS.vatPayable).credit.toFixed(2), "15.00");
    assert.equal(lineFor(saleEntry, ACCOUNTS.cogs).debit.toFixed(2), "80.00");
    assert.equal(lineFor(saleEntry, ACCOUNTS.inventory).credit.toFixed(2), "80.00");

    const payment = await tx.payment.findFirstOrThrow({
      where: { orderId: sale.orderId },
      select: { id: true },
    });
    const drawer = await entriesFor(tx, "payment", payment.id);
    assert.equal(drawer.length, 1);
    assert.equal(lineFor(drawer[0]!, ACCOUNTS.cash).debit.toFixed(2), "115.00");
    assert.equal(lineFor(drawer[0]!, ACCOUNTS.receivable).credit.toFixed(2), "115.00");
  });
});

test("a digital payment posts nothing until a manager verifies it", async () => {
  const run = suffix();
  await rolledBack(async (tx) => {
    const setup = await fixture(tx, run);
    const sale = await createSale(
      {
        source: "POS_ONLINE",
        deviceId: setup.device.id,
        customerMobile: "01812345678",
        lines: [{ variantId: setup.variant.id, quantity: "1" }],
        payments: [{ method: "BKASH", amount: "115.00", reference: `BK-${run}` }],
        clientTransactionUuid: `acc-bkash-${run}`,
        actorUserId: setup.managerId,
      },
      tx,
    );

    const payment = await tx.payment.findFirstOrThrow({
      where: { orderId: sale.orderId },
      select: { id: true, status: true },
    });
    assert.equal(payment.status, "PENDING_VERIFICATION");
    assert.equal((await entriesFor(tx, "payment", payment.id)).length, 0);

    await verifyPayment(payment.id, setup.managerId, { reference: `BK-${run}` }, tx);
    const verified = await entriesFor(tx, "payment", payment.id);
    assert.equal(verified.length, 1);
    assert.equal(lineFor(verified[0]!, ACCOUNTS.bkash).debit.toFixed(2), "115.00");
    assert.equal(lineFor(verified[0]!, ACCOUNTS.receivable).credit.toFixed(2), "115.00");
  });
});

test("a refund returns stock on approval and pays out on completion", async () => {
  const run = suffix();
  await rolledBack(async (tx) => {
    const setup = await fixture(tx, run);
    const sale = await createSale(
      {
        source: "POS_ONLINE",
        deviceId: setup.device.id,
        customerMobile: "01912345678",
        lines: [{ variantId: setup.variant.id, quantity: "2" }],
        payments: [{ method: "CASH", amount: "230.00" }],
        clientTransactionUuid: `acc-refund-${run}`,
        actorUserId: setup.managerId,
      },
      tx,
    );
    const item = await tx.orderItem.findFirstOrThrow({
      where: { orderId: sale.orderId },
      select: { id: true },
    });
    const refund = await requestRefund(
      {
        orderId: sale.orderId,
        lines: [{ orderItemId: item.id, quantity: "1", restock: true }],
        reason: "Customer returned one",
        method: "CASH",
        actorUserId: setup.managerId,
      },
      tx,
    );

    await approveRefund(refund.refundId, setup.managerId, tx);
    const restock = await entriesFor(tx, "refund", refund.refundId);
    assert.equal(restock.length, 1);
    assert.equal(restock[0]!.source, "SALE_RETURN");
    assert.equal(lineFor(restock[0]!, ACCOUNTS.inventory).debit.toFixed(2), "80.00");
    assert.equal(lineFor(restock[0]!, ACCOUNTS.cogs).credit.toFixed(2), "80.00");

    await completeRefund(refund.refundId, setup.managerId, tx);
    const payout = await entriesFor(tx, "refund", refund.refundId);
    const money = payout.find((entry) => entry.source === "REFUND");
    assert.ok(money);
    assert.equal(lineFor(money, ACCOUNTS.salesReturns).debit.toFixed(2), "100.00");
    assert.equal(lineFor(money, ACCOUNTS.vatPayable).debit.toFixed(2), "15.00");
    assert.equal(lineFor(money, ACCOUNTS.cash).credit.toFixed(2), "115.00");
  });
});

test("a posted goods receipt raises inventory and accounts payable", async () => {
  const run = suffix();
  await rolledBack(async (tx) => {
    const setup = await fixture(tx, run);
    const supplier = await createSupplier(
      {
        name: `Accounting supplier ${run}`,
        paymentTermsDays: 0,
        leadTimeDays: 0,
        isDropshipVendor: false,
        status: "ACTIVE",
      },
      tx,
    );
    const order = await createPurchaseOrder(
      {
        supplierId: supplier.id,
        warehouseId: setup.warehouse.id,
        lines: [{ variantId: setup.variant.id, quantity: "5", unitCost: "100" }],
      },
      tx,
    );
    await sendPurchaseOrder(order.id, setup.managerId, tx);
    const line = await tx.purchaseItem.findFirstOrThrow({
      where: { purchaseOrderId: order.id },
      select: { id: true },
    });
    const grn = await createGrn(
      {
        purchaseOrderId: order.id,
        warehouseId: setup.warehouse.id,
        lines: [{ purchaseItemId: line.id, quantity: "5", unitCost: "100", condition: "GOOD" }],
      },
      tx,
    );
    await postGrn(grn.id, setup.managerId, tx);

    const entries = await entriesFor(tx, "goods_received_note", grn.id);
    assert.equal(entries.length, 1);
    assert.equal(entries[0]!.source, "PURCHASE");
    assert.equal(lineFor(entries[0]!, ACCOUNTS.inventory).debit.toFixed(2), "500.00");
    assert.equal(lineFor(entries[0]!, ACCOUNTS.payable).credit.toFixed(2), "500.00");
  });
});

test("a stock adjustment writes the value to shrinkage", async () => {
  const run = suffix();
  await rolledBack(async (tx) => {
    const setup = await fixture(tx, run);
    const increase = await createAdjustment(
      {
        warehouseId: setup.warehouse.id,
        variantId: setup.variant.id,
        adjustmentType: "INCREASE",
        quantity: "2",
        unitCost: "80",
        reason: "Found two more on the shelf",
        actorUserId: setup.managerId,
      },
      tx,
    );
    await postAdjustment(increase.id, setup.managerId, tx);
    const plus = await entriesFor(tx, "stock_adjustment", increase.id);
    assert.equal(plus.length, 1);
    assert.equal(lineFor(plus[0]!, ACCOUNTS.inventory).debit.toFixed(2), "160.00");
    assert.equal(lineFor(plus[0]!, ACCOUNTS.shrinkage).credit.toFixed(2), "160.00");

    const decrease = await createAdjustment(
      {
        warehouseId: setup.warehouse.id,
        variantId: setup.variant.id,
        adjustmentType: "DECREASE",
        quantity: "1",
        reason: "One unit missing at count",
        actorUserId: setup.managerId,
      },
      tx,
    );
    await postAdjustment(decrease.id, setup.managerId, tx);
    const minus = await entriesFor(tx, "stock_adjustment", decrease.id);
    assert.equal(minus.length, 1);
    assert.equal(lineFor(minus[0]!, ACCOUNTS.shrinkage).debit.toFixed(2), "80.00");
    assert.equal(lineFor(minus[0]!, ACCOUNTS.inventory).credit.toFixed(2), "80.00");
  });
});

test("an expense posts to its account and a void reverses it", async () => {
  const run = suffix();
  await rolledBack(async (tx) => {
    const setup = await fixture(tx, run);
    const rent = await tx.account.findUniqueOrThrow({
      where: { code: "6000" },
      select: { id: true },
    });
    const expense = await createExpense(
      {
        category: "Shop rent",
        accountId: rent.id,
        amount: "1000.00",
        vatAmount: "0",
        paymentMethod: "CASH",
        description: "November rent",
        actorUserId: setup.managerId,
      },
      tx,
    );
    await postExpense(expense.id, setup.managerId, tx);
    const posted = await entriesFor(tx, "expense", expense.id);
    assert.equal(posted.length, 1);
    assert.equal(posted[0]!.source, "EXPENSE");
    assert.equal(lineFor(posted[0]!, "6000").debit.toFixed(2), "1000.00");
    assert.equal(lineFor(posted[0]!, ACCOUNTS.cash).credit.toFixed(2), "1000.00");

    await voidExpense(expense.id, setup.managerId, "Wrong month", tx);
    const rows = await entriesFor(tx, "expense", expense.id);
    assert.equal(rows.length, 2);
    const reversal = rows.find((entry) => entry.reversalOfId === posted[0]!.id);
    assert.ok(reversal);
    assert.equal(lineFor(reversal, ACCOUNTS.cash).debit.toFixed(2), "1000.00");
    assert.equal(lineFor(reversal, "6000").credit.toFixed(2), "1000.00");
  });
});

test("the trial balance totals agree with the posted lines", async () => {
  const run = suffix();
  await rolledBack(async (tx) => {
    const setup = await fixture(tx, run);

    // The ledger is append-only and already holds committed history from real
    // runs, so compare the cash movement this sale makes, not an absolute total.
    const before = await trialBalance({}, tx);
    const beforeCash =
      before.rows.find((row) => row.code === ACCOUNTS.cash)?.debit ??
      new Prisma.Decimal(0);

    await createSale(
      {
        source: "POS_ONLINE",
        deviceId: setup.device.id,
        customerMobile: "01612345678",
        lines: [{ variantId: setup.variant.id, quantity: "1" }],
        payments: [{ method: "CASH", amount: "115.00" }],
        clientTransactionUuid: `acc-tb-${run}`,
        actorUserId: setup.managerId,
      },
      tx,
    );

    const balance = await trialBalance({}, tx);
    assert.ok(balance.rows.length > 0);
    assert.equal(balance.totalDebit.toFixed(2), balance.totalCredit.toFixed(2));
    assert.ok(balance.totalDebit.greaterThan(0));
    const cash = balance.rows.find((row) => row.code === ACCOUNTS.cash);
    assert.ok(cash);
    assert.equal(cash.debit.sub(beforeCash).toFixed(2), "115.00");
  });
});

test("opening stock posts against equity, not profit", async () => {
  const run = suffix();
  await rolledBack(async (tx) => {
    const setup = await fixture(tx, run);
    const opening = await tx.stockAdjustment.findFirstOrThrow({
      where: { adjustmentNumber: { startsWith: "OPEN-" }, variantId: setup.variant.id },
      select: { id: true },
    });
    const entries = await entriesFor(tx, "stock_adjustment", opening.id);
    assert.equal(entries.length, 1);
    assert.equal(entries[0]!.source, "OPENING_BALANCE");
    assert.equal(lineFor(entries[0]!, ACCOUNTS.inventory).debit.toFixed(2), "800.00");
    assert.equal(lineFor(entries[0]!, ACCOUNTS.equity).credit.toFixed(2), "800.00");
  });
});
