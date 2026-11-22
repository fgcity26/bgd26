import test from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "../src/generated/prisma/client";
import { prisma } from "../src/lib/db";
import { postJournal } from "../src/lib/accounting/journal";
import {
  balanceSheet,
  cashFlow,
  profitAndLoss,
} from "../src/lib/accounting/reports";
import { money } from "../src/lib/inventory/decimal";

/**
 * Financial statement tests.
 *
 * The tests post their own journals into a fiscal period in 2099 and roll the
 * whole transaction back, so existing verification data cannot move the
 * expected numbers. Balance-sheet and cash-flow totals are asserted as deltas
 * between two dates for the same reason.
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

const DATE = new Date("2099-01-15T12:00:00.000Z");
const BEFORE = new Date("2098-12-31T23:59:59.999Z");
const AFTER = new Date("2099-12-31T23:59:59.999Z");

async function fixture(tx: Prisma.TransactionClient) {
  await tx.fiscalPeriod.create({
    data: {
      name: "Test period 2099",
      startDate: new Date("2099-01-01T00:00:00.000Z"),
      endDate: new Date("2099-12-31T23:59:59.999Z"),
      status: "OPEN",
    },
  });
  const actor = await tx.user.findFirstOrThrow({
    where: { status: "ACTIVE", deletedAt: null },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  return actor.id;
}

async function entry(
  tx: Prisma.TransactionClient,
  actorUserId: string,
  description: string,
  lines: Array<{ account: string; debit?: string; credit?: string }>,
) {
  return postJournal(tx, {
    entryDate: DATE,
    description,
    source: "MANUAL",
    actorUserId,
    lines,
  });
}

/** The standard test set: capital, inventory, a discounted sale and rent. */
async function postScenario(tx: Prisma.TransactionClient, actorUserId: string) {
  await entry(tx, actorUserId, "Owner capital", [
    { account: "1000", debit: "5000" },
    { account: "3000", credit: "5000" },
  ]);
  await entry(tx, actorUserId, "Opening inventory", [
    { account: "1100", debit: "1000" },
    { account: "3000", credit: "1000" },
  ]);
  await entry(tx, actorUserId, "Cash sale", [
    { account: "1000", debit: "1000" },
    { account: "4000", credit: "1000" },
  ]);
  await entry(tx, actorUserId, "Sales discount", [
    { account: "4020", debit: "100" },
    { account: "1000", credit: "100" },
  ]);
  await entry(tx, actorUserId, "Cost of sale", [
    { account: "5000", debit: "400" },
    { account: "1100", credit: "400" },
  ]);
  await entry(tx, actorUserId, "Rent", [
    { account: "6000", debit: "200" },
    { account: "1000", credit: "200" },
  ]);
}

test("profit and loss nets discounts and separates cost of sales", async () => {
  await rolledBack(async (tx) => {
    const actorUserId = await fixture(tx);
    await postScenario(tx, actorUserId);

    const report = await profitAndLoss(DATE, DATE, tx);
    assert.equal(report.netRevenue.toFixed(2), "900.00");
    assert.equal(report.totalCostOfSales.toFixed(2), "400.00");
    assert.equal(report.grossProfit.toFixed(2), "500.00");
    assert.equal(report.totalOperatingExpenses.toFixed(2), "200.00");
    assert.equal(report.netProfit.toFixed(2), "300.00");

    const revenue = new Map(report.revenue.map((line) => [line.code, line.amount.toFixed(2)]));
    assert.equal(revenue.get("4000"), "1000.00");
    assert.equal(revenue.get("4020"), "-100.00");
  });
});

test("the balance sheet balances and its totals move by the posted amounts", async () => {
  await rolledBack(async (tx) => {
    const actorUserId = await fixture(tx);
    const before = await balanceSheet(BEFORE, tx);
    await postScenario(tx, actorUserId);
    const after = await balanceSheet(AFTER, tx);

    assert.equal(after.balanced, true);
    assert.equal(after.difference.toFixed(2), "0.00");

    const assetDelta = after.totalAssets.sub(before.totalAssets);
    const liabilityDelta = after.totalLiabilities.sub(before.totalLiabilities);
    const equityDelta = after.totalEquity.sub(before.totalEquity);

    assert.equal(assetDelta.toFixed(2), "6300.00");
    assert.equal(liabilityDelta.toFixed(2), "0.00");
    assert.equal(equityDelta.toFixed(2), "6300.00");
    assert.equal(after.accumulatedEarnings.sub(before.accumulatedEarnings).toFixed(2), "300.00");
  });
});

test("cash flow separates operating and financing and ties to the cash balance", async () => {
  await rolledBack(async (tx) => {
    const actorUserId = await fixture(tx);
    const before = await balanceSheet(BEFORE, tx);

    await postScenario(tx, actorUserId);

    const afterReport = await cashFlow(BEFORE, AFTER, tx);
    assert.equal(afterReport.operatingIn.toFixed(2), "1000.00");
    assert.equal(afterReport.operatingOut.toFixed(2), "300.00");
    assert.equal(afterReport.financingIn.toFixed(2), "5000.00");
    assert.equal(afterReport.financingOut.toFixed(2), "0.00");
    assert.equal(afterReport.netChange.toFixed(2), "5700.00");

    const afterBalance = await balanceSheet(AFTER, tx);
    const cashBefore = before.assets
      .filter((line) => ["1000", "1010", "1020", "1030", "1040"].includes(line.code))
      .reduce((sum, line) => sum.add(line.amount), money(0));
    const cashAfter = afterBalance.assets
      .filter((line) => ["1000", "1010", "1020", "1030", "1040"].includes(line.code))
      .reduce((sum, line) => sum.add(line.amount), money(0));
    assert.equal(cashAfter.sub(cashBefore).toFixed(2), afterReport.netChange.toFixed(2));
  });
});

test("a transfer between two cash accounts nets to zero and is not listed", async () => {
  await rolledBack(async (tx) => {
    const actorUserId = await fixture(tx);
    await entry(tx, actorUserId, "Move cash to bank", [
      { account: "1010", debit: "300" },
      { account: "1000", credit: "300" },
    ]);

    const report = await cashFlow(DATE, DATE, tx);
    assert.equal(report.netChange.toFixed(2), "0.00");
    assert.equal(report.entries.length, 0);
    assert.equal(report.closingCash.toFixed(2), report.openingCash.toFixed(2));
  });
});

test("an empty period reports zero rather than failing", async () => {
  await rolledBack(async (tx) => {
    await fixture(tx);
    const emptyDate = new Date("2099-06-01T00:00:00.000Z");
    const report = await profitAndLoss(emptyDate, emptyDate, tx);
    assert.equal(report.netRevenue.toFixed(2), "0.00");
    assert.equal(report.netProfit.toFixed(2), "0.00");

    const balance = await balanceSheet(emptyDate, tx);
    assert.equal(balance.balanced, true);
  });
});
