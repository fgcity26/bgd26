import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { Prisma } from "../src/generated/prisma/client";
import { prisma } from "../src/lib/db";
import { ACCOUNTS } from "../src/lib/accounting/journal";
import { money } from "../src/lib/inventory/decimal";
import {
  createPurchaseOrder,
  createGrn,
  createSupplier,
  postGrn,
  sendPurchaseOrder,
  setSupplierStatus,
} from "../src/lib/purchasing/service";
import {
  approvePurchaseReturn,
  cancelPurchaseReturn,
  completePurchaseReturn,
  createPurchaseReturn,
  recordPurchasePayment,
  returnableGrns,
  supplierPayable,
  supplierStatement,
} from "../src/lib/purchasing/settlement";

/**
 * Supplier settlement tests: payments, purchase returns and the payable
 * statement.
 *
 * Each scenario runs in one transaction that is rolled back. A GRN is really
 * posted (stock ledger and journal included) because the payable balance is
 * derived from those posted lines — a fake balance would test nothing.
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

async function actorId(tx: Prisma.TransactionClient): Promise<string> {
  const user = await tx.user.findFirst({
    where: { deletedAt: null, status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  assert.ok(user, "The local database must be seeded before running this test.");
  return user.id;
}

async function makeVariant(tx: Prisma.TransactionClient, run: string) {
  const category = await tx.category.create({
    data: {
      name: `Settlement test ${run}`,
      nameBn: "নিষ্পত্তি পরীক্ষা",
      slug: `settlement-test-${run}`,
    },
    select: { id: true },
  });
  const product = await tx.product.create({
    data: {
      categoryId: category.id,
      name: `Settlement test product ${run}`,
      slug: `settlement-test-product-${run}`,
      basePrice: "100.00",
      status: "ACTIVE",
    },
    select: { id: true },
  });
  return tx.productVariant.create({
    data: {
      productId: product.id,
      sku: `SET-${run.toUpperCase()}`,
      name: "Default",
      price: "100.00",
      costPrice: "0.0000",
      fulfillmentType: "STOCKED",
    },
    select: { id: true, sku: true },
  });
}

/** Receive `quantity` units at `unitCost` and return everything a test needs. */
async function receive(
  tx: Prisma.TransactionClient,
  actor: string,
  run: string,
  quantity: string,
  unitCost: string,
) {
  const supplier = await createSupplier(
    {
      name: `Settlement test supplier ${run}`,
      paymentTermsDays: 15,
      leadTimeDays: 3,
      isDropshipVendor: false,
      status: "ACTIVE",
    },
    tx,
  );
  const warehouse = await tx.warehouse.create({
    data: {
      code: `S-${run.toUpperCase()}`,
      name: `Settlement warehouse ${run}`,
      type: "SECONDARY",
      isActive: true,
    },
    select: { id: true },
  });
  const variant = await makeVariant(tx, run);

  const order = await createPurchaseOrder(
    {
      supplierId: supplier.id,
      warehouseId: warehouse.id,
      lines: [{ variantId: variant.id, quantity, unitCost }],
    },
    tx,
  );
  await sendPurchaseOrder(order.id, actor, tx);

  const item = await tx.purchaseItem.findFirstOrThrow({
    where: { purchaseOrderId: order.id },
    select: { id: true },
  });
  const grn = await createGrn(
    {
      purchaseOrderId: order.id,
      lines: [{ purchaseItemId: item.id, quantity, unitCost, condition: "GOOD" }],
    },
    tx,
  );
  await postGrn(grn.id, actor, tx);
  await tx.$executeRawUnsafe("SET CONSTRAINTS ALL IMMEDIATE");

  const received = await tx.goodsReceivedItem.findFirstOrThrow({
    where: { grnId: grn.id },
    select: { id: true },
  });

  return { supplier, warehouse, variant, order, grn, item: received };
}

async function journalLines(tx: Prisma.TransactionClient, entryId: string) {
  return tx.journalEntryLine.findMany({
    where: { journalEntryId: entryId },
    orderBy: { lineOrder: "asc" },
    select: {
      debit: true,
      credit: true,
      account: { select: { code: true } },
    },
  });
}

test("a supplier payment posts against payables and never exceeds what is owed", async () => {
  const run = suffix();

  await rolledBack(async (tx) => {
    const actor = await actorId(tx);
    const { supplier, grn } = await receive(tx, actor, run, "10", "100");

    const opening = await supplierPayable(supplier.id, tx);
    assert.equal(opening.outstanding.toString(), "1000");

    const payment = await recordPurchasePayment(
      {
        supplierId: supplier.id,
        amount: "400",
        method: "CASH",
        reference: "TEST-1",
        actorUserId: actor,
      },
      tx,
    );
    await tx.$executeRawUnsafe("SET CONSTRAINTS ALL IMMEDIATE");

    assert.equal(payment.outstandingAfter.toString(), "600");

    const stored = await tx.purchasePayment.findUniqueOrThrow({
      where: { id: payment.id },
      select: { status: true, amount: true, journalEntryId: true },
    });
    assert.equal(stored.status, "SUCCESS");
    assert.equal(stored.amount.toString(), "400");
    assert.ok(stored.journalEntryId);

    const lines = await journalLines(tx, stored.journalEntryId!);
    const payable = lines.find((line) => line.account.code === ACCOUNTS.payable);
    const cash = lines.find((line) => line.account.code === ACCOUNTS.cash);
    assert.equal(payable?.debit.toString(), "400");
    assert.equal(cash?.credit.toString(), "400");

    const after = await supplierPayable(supplier.id, tx);
    assert.equal(after.outstanding.toString(), "600");

    await assert.rejects(
      () =>
        recordPurchasePayment(
          { supplierId: supplier.id, amount: "700", method: "CASH", actorUserId: actor },
          tx,
        ),
      /only ৳600\.00 is outstanding/i,
    );

    await setSupplierStatus(supplier.id, "BLACKLISTED", tx);
    await assert.rejects(
      () =>
        recordPurchasePayment(
          { supplierId: supplier.id, amount: "100", method: "CASH", actorUserId: actor },
          tx,
        ),
      /blacklisted/i,
    );

    // The receipt stays the source of the payable: the journal references it.
    const entry = await tx.journalEntry.findFirstOrThrow({
      where: { referenceType: "goods_received_note", referenceId: grn.id },
      select: { id: true },
    });
    assert.ok(entry.id);
  });
});

test("a purchase return leaves stock at average cost and reduces the payable by that value", async () => {
  const run = suffix();

  await rolledBack(async (tx) => {
    const actor = await actorId(tx);
    const { supplier, warehouse, variant, grn, item } = await receive(
      tx,
      actor,
      run,
      "10",
      "100",
    );

    const draft = await createPurchaseReturn(
      {
        grnId: grn.id,
        reason: "Wrong colour",
        actorUserId: actor,
        lines: [{ goodsReceivedItemId: item.id, quantity: "4" }],
      },
      tx,
    );
    assert.equal(draft.estimatedValue.toString(), "400");

    // A draft moves nothing.
    assert.equal(
      (await tx.inventoryBalance.findUniqueOrThrow({
        where: { variantId_warehouseId: { variantId: variant.id, warehouseId: warehouse.id } },
      })).physicalQty.toString(),
      "10",
    );
    assert.equal((await supplierPayable(supplier.id, tx)).outstanding.toString(), "1000");

    await assert.rejects(
      () =>
        createPurchaseReturn(
          {
            grnId: grn.id,
            reason: "Too many",
            actorUserId: actor,
            lines: [{ goodsReceivedItemId: item.id, quantity: "11" }],
          },
          tx,
        ),
      /only 10\.000 unit/i,
    );

    const approved = await approvePurchaseReturn(draft.id, actor, tx);
    await tx.$executeRawUnsafe("SET CONSTRAINTS ALL IMMEDIATE");

    assert.equal(approved.totalValue.toString(), "400");

    const balance = await tx.inventoryBalance.findUniqueOrThrow({
      where: { variantId_warehouseId: { variantId: variant.id, warehouseId: warehouse.id } },
    });
    assert.equal(balance.physicalQty.toString(), "6");
    assert.equal(balance.availableQty.toString(), "6");
    assert.equal(balance.avcoUnitCost.toString(), "100");

    const movement = await tx.stockLedger.findFirstOrThrow({
      where: { referenceType: "purchase_return", referenceId: draft.id },
      select: { movementType: true, quantity: true, totalValue: true },
    });
    assert.equal(movement.movementType, "PURCHASE_RETURN");
    assert.equal(movement.quantity.toString(), "-4");
    assert.equal(movement.totalValue.toString(), "-400");

    const lines = await journalLines(tx, approved.journalEntryId!);
    const payable = lines.find((line) => line.account.code === ACCOUNTS.payable);
    const inventory = lines.find((line) => line.account.code === ACCOUNTS.inventory);
    assert.equal(payable?.debit.toString(), "400");
    assert.equal(inventory?.credit.toString(), "400");

    assert.equal((await supplierPayable(supplier.id, tx)).outstanding.toString(), "600");

    const stored = await tx.goodsReceivedItem.findUniqueOrThrow({
      where: { id: item.id },
      select: { returnedQty: true },
    });
    assert.equal(stored.returnedQty.toString(), "4");

    // Six remain returnable, so the same unit cannot go back twice.
    await assert.rejects(
      () =>
        createPurchaseReturn(
          {
            grnId: grn.id,
            reason: "Second attempt",
            actorUserId: actor,
            lines: [{ goodsReceivedItemId: item.id, quantity: "7" }],
          },
          tx,
        ),
      /only 6\.000 unit/i,
    );

    // Approving twice is refused, and a draft can be cancelled but an approved
    // return cannot.
    await assert.rejects(() => approvePurchaseReturn(draft.id, actor, tx), /only a draft/i);
    await assert.rejects(() => cancelPurchaseReturn(draft.id, tx), /only a draft/i);

    const returnable = await returnableGrns(undefined, tx);
    assert.ok(returnable.some((row) => row.id === grn.id));
  });
});

test("completing a return with a refund clears the credit the supplier owes back", async () => {
  const run = suffix();

  await rolledBack(async (tx) => {
    const actor = await actorId(tx);
    const { supplier, grn, item } = await receive(tx, actor, run, "10", "100");

    // Pay in full first, so the return creates a debit balance with the supplier.
    await recordPurchasePayment(
      { supplierId: supplier.id, amount: "1000", method: "BANK_TRANSFER", actorUserId: actor },
      tx,
    );
    assert.equal((await supplierPayable(supplier.id, tx)).outstanding.toString(), "0");

    const draft = await createPurchaseReturn(
      {
        grnId: grn.id,
        reason: "Damaged on arrival",
        refundMethod: "CASH",
        refundReference: "REF-9",
        actorUserId: actor,
        lines: [{ goodsReceivedItemId: item.id, quantity: "4" }],
      },
      tx,
    );
    const approved = await approvePurchaseReturn(draft.id, actor, tx);
    await tx.$executeRawUnsafe("SET CONSTRAINTS ALL IMMEDIATE");

    assert.equal((await supplierPayable(supplier.id, tx)).outstanding.toString(), "-400");

    const completed = await completePurchaseReturn(draft.id, actor, tx);
    await tx.$executeRawUnsafe("SET CONSTRAINTS ALL IMMEDIATE");

    assert.ok(completed.refundEntryId);
    assert.equal((await supplierPayable(supplier.id, tx)).outstanding.toString(), "0");

    const lines = await journalLines(tx, completed.refundEntryId!);
    const cash = lines.find((line) => line.account.code === ACCOUNTS.cash);
    const payable = lines.find((line) => line.account.code === ACCOUNTS.payable);
    assert.equal(cash?.debit.toString(), "400");
    assert.equal(payable?.credit.toString(), "400");

    const stored = await tx.purchaseReturn.findUniqueOrThrow({
      where: { id: draft.id },
      select: { status: true, completedAt: true, journalEntryId: true },
    });
    assert.equal(stored.status, "COMPLETED");
    assert.ok(stored.completedAt);
    assert.equal(stored.journalEntryId, approved.journalEntryId);

    await assert.rejects(() => completePurchaseReturn(draft.id, actor, tx), /only an approved/i);
  });
});

test("the supplier statement lists every movement with a running balance", async () => {
  const run = suffix();

  await rolledBack(async (tx) => {
    const actor = await actorId(tx);
    const { supplier, grn, item } = await receive(tx, actor, run, "10", "100");

    await recordPurchasePayment(
      { supplierId: supplier.id, amount: "400", method: "CASH", actorUserId: actor },
      tx,
    );
    const draft = await createPurchaseReturn(
      {
        grnId: grn.id,
        reason: "Two short",
        actorUserId: actor,
        lines: [{ goodsReceivedItemId: item.id, quantity: "2" }],
      },
      tx,
    );
    await approvePurchaseReturn(draft.id, actor, tx);
    await tx.$executeRawUnsafe("SET CONSTRAINTS ALL IMMEDIATE");

    const statement = await supplierStatement(supplier.id, tx);
    assert.equal(statement.length, 3);
    assert.deepEqual(
      statement.map((row) => row.balance.toString()),
      ["1000", "600", "400"],
    );
    assert.equal(statement[0]?.credit.toString(), "1000");
    assert.equal(statement[0]?.debit.toString(), "0");
    assert.equal(statement[1]?.debit.toString(), "400");
    assert.equal(statement[2]?.debit.toString(), "200");

    const payable = await supplierPayable(supplier.id, tx);
    assert.equal(payable.invoiced.toString(), "1000");
    assert.equal(payable.settled.toString(), "600");
    assert.equal(payable.outstanding.toString(), "400");

    // A supplier with no posted movement simply has a zero balance.
    const untouched = await supplierPayable("does-not-exist", tx);
    assert.equal(untouched.outstanding.toString(), "0");
    assert.equal(money(untouched.invoiced).toString(), "0");
  });
});
