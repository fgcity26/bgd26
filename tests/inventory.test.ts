import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { Prisma } from "../src/generated/prisma/client";
import { prisma } from "../src/lib/db";
import {
  cancelTransfer,
  createAdjustment,
  createTransfer,
  postAdjustment,
  postOpeningStock,
  receiveTransfer,
  sendTransfer,
  setWarehouseActive,
  voidAdjustment,
} from "../src/lib/inventory/service";
import { InventoryError, postStockMovement } from "../src/lib/inventory/stock";

/**
 * Inventory engine tests.
 *
 * Every scenario runs in one interactive transaction that is deliberately
 * rolled back at the end. The stock ledger is append-only at the database
 * level, so tests cannot delete their own movements; rolling back keeps the
 * development database clean while still exercising the real SQL, row locks,
 * deferred balance trigger and immutability trigger.
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

async function makeStockedVariant(
  tx: Prisma.TransactionClient,
  run: string,
  fulfillmentType: "STOCKED" | "NON_STOCK" = "STOCKED",
) {
  const category = await tx.category.create({
    data: {
      name: `Inventory test ${run}`,
      nameBn: "ইনভেন্টরি পরীক্ষা",
      slug: `inventory-test-${run}`,
    },
    select: { id: true },
  });

  const product = await tx.product.create({
    data: {
      categoryId: category.id,
      name: `Inventory test product ${run}`,
      slug: `inventory-test-product-${run}`,
      basePrice: "100.00",
      status: "ACTIVE",
    },
    select: { id: true },
  });

  return tx.productVariant.create({
    data: {
      productId: product.id,
      sku: `INV-${run.toUpperCase()}`,
      name: "Default",
      price: "100.00",
      costPrice: "0.0000",
      fulfillmentType,
    },
    select: { id: true, sku: true },
  });
}

async function makeWarehouse(tx: Prisma.TransactionClient, code: string) {
  return tx.warehouse.create({
    data: {
      code,
      name: `Test warehouse ${code}`,
      type: "SECONDARY",
      isActive: true,
    },
    select: { id: true, code: true },
  });
}

async function balanceAt(
  tx: Prisma.TransactionClient,
  variantId: string,
  warehouseId: string,
) {
  return tx.inventoryBalance.findUniqueOrThrow({
    where: { variantId_warehouseId: { variantId, warehouseId } },
  });
}

test("AVCO blends receipts and damage/write-off keep the balance projection exact", async () => {
  const run = suffix();

  await rolledBack(async (tx) => {
    const actor = await actorId(tx);
    const variant = await makeStockedVariant(tx, run);
    const warehouse = await makeWarehouse(tx, `T1-${run.toUpperCase()}`);

    await postOpeningStock(
      {
        warehouseId: warehouse.id,
        variantId: variant.id,
        quantity: "10",
        unitCost: "100",
        actorUserId: actor,
      },
      tx,
    );

    // Force the deferred balance-math trigger to run on every later statement.
    await tx.$executeRawUnsafe("SET CONSTRAINTS ALL IMMEDIATE");

    let balance = await balanceAt(tx, variant.id, warehouse.id);
    assert.equal(balance.physicalQty.toString(), "10");
    assert.equal(balance.availableQty.toString(), "10");
    assert.equal(balance.avcoUnitCost.toString(), "100");

    await postStockMovement(tx, {
      variantId: variant.id,
      warehouseId: warehouse.id,
      movementType: "PURCHASE_RECEIPT",
      quantity: "10",
      unitCost: "200",
      referenceType: "test",
      referenceId: "purchase-1",
      actorUserId: actor,
    });

    balance = await balanceAt(tx, variant.id, warehouse.id);
    assert.equal(balance.physicalQty.toString(), "20");
    assert.equal(balance.availableQty.toString(), "20");
    // (10 × 100 + 10 × 200) / 20 = 150
    assert.equal(balance.avcoUnitCost.toString(), "150");

    await postStockMovement(tx, {
      variantId: variant.id,
      warehouseId: warehouse.id,
      movementType: "SALE",
      quantity: "5",
      referenceType: "test",
      referenceId: "sale-1",
      actorUserId: actor,
    });

    balance = await balanceAt(tx, variant.id, warehouse.id);
    assert.equal(balance.physicalQty.toString(), "15");
    assert.equal(balance.availableQty.toString(), "15");
    assert.equal(balance.avcoUnitCost.toString(), "150");

    await postStockMovement(tx, {
      variantId: variant.id,
      warehouseId: warehouse.id,
      movementType: "DAMAGE",
      quantity: "2",
      referenceType: "test",
      referenceId: "damage-1",
      actorUserId: actor,
    });

    balance = await balanceAt(tx, variant.id, warehouse.id);
    assert.equal(balance.physicalQty.toString(), "15");
    assert.equal(balance.availableQty.toString(), "13");
    assert.equal(balance.damagedQty.toString(), "2");

    await postStockMovement(tx, {
      variantId: variant.id,
      warehouseId: warehouse.id,
      movementType: "WRITE_OFF",
      quantity: "2",
      referenceType: "test",
      referenceId: "write-off-1",
      actorUserId: actor,
    });

    balance = await balanceAt(tx, variant.id, warehouse.id);
    assert.equal(balance.physicalQty.toString(), "13");
    assert.equal(balance.availableQty.toString(), "13");
    assert.equal(balance.damagedQty.toString(), "0");

    const ledger = await tx.stockLedger.findMany({
      where: { variantId: variant.id, warehouseId: warehouse.id },
      orderBy: { createdAt: "asc" },
      select: {
        movementType: true,
        quantity: true,
        unitCost: true,
        totalValue: true,
        balanceAfterQty: true,
      },
    });

    assert.deepEqual(
      ledger.map((entry) => entry.movementType),
      ["OPENING_BALANCE", "PURCHASE_RECEIPT", "SALE", "DAMAGE", "WRITE_OFF"],
    );
    assert.equal(ledger[2]?.quantity.toString(), "-5");
    assert.equal(ledger[2]?.unitCost.toString(), "150");
    assert.equal(ledger[2]?.totalValue.toString(), "-750");
    assert.equal(ledger[2]?.balanceAfterQty.toString(), "15");

    const history = await tx.inventoryCostHistory.findMany({
      where: { variantId: variant.id, warehouseId: warehouse.id },
      orderBy: { createdAt: "asc" },
      select: { unitCostBefore: true, unitCostAfter: true, qtyIn: true },
    });
    assert.equal(history.length, 2);
    assert.equal(history[0]?.unitCostAfter.toString(), "100");
    assert.equal(history[1]?.unitCostBefore.toString(), "100");
    assert.equal(history[1]?.unitCostAfter.toString(), "150");
    assert.equal(history[1]?.qtyIn.toString(), "10");
  });
});

test("a draft adjustment changes nothing until a manager posts it", async () => {
  const run = suffix();

  await rolledBack(async (tx) => {
    const actor = await actorId(tx);
    const variant = await makeStockedVariant(tx, run);
    const warehouse = await makeWarehouse(tx, `T2-${run.toUpperCase()}`);

    await postOpeningStock(
      {
        warehouseId: warehouse.id,
        variantId: variant.id,
        quantity: "10",
        unitCost: "100",
        actorUserId: actor,
      },
      tx,
    );

    const draft = await createAdjustment(
      {
        warehouseId: warehouse.id,
        variantId: variant.id,
        adjustmentType: "DECREASE",
        quantity: "3",
        reason: "Missing after the physical count",
        actorUserId: actor,
      },
      tx,
    );

    let balance = await balanceAt(tx, variant.id, warehouse.id);
    assert.equal(balance.physicalQty.toString(), "10");

    await postAdjustment(draft.id, actor, tx);
    balance = await balanceAt(tx, variant.id, warehouse.id);
    assert.equal(balance.physicalQty.toString(), "7");
    assert.equal(balance.availableQty.toString(), "7");

    const voided = await createAdjustment(
      {
        warehouseId: warehouse.id,
        variantId: variant.id,
        adjustmentType: "INCREASE",
        quantity: "5",
        unitCost: "120",
        reason: "Found during recount, then cancelled",
        actorUserId: actor,
      },
      tx,
    );
    await voidAdjustment(voided.id, actor, tx);

    await assert.rejects(() => postAdjustment(voided.id, actor, tx), InventoryError);

    balance = await balanceAt(tx, variant.id, warehouse.id);
    assert.equal(balance.physicalQty.toString(), "7");
    assert.equal(balance.avcoUnitCost.toString(), "100");

    const posted = await tx.stockAdjustment.findUniqueOrThrow({
      where: { id: draft.id },
      select: { status: true },
    });
    assert.equal(posted.status, "POSTED");

    const ledger = await tx.stockLedger.findMany({
      where: { referenceType: "stock_adjustment", referenceId: draft.id },
      select: { movementType: true, quantity: true },
    });
    assert.deepEqual(
      ledger.map((entry) => entry.movementType),
      ["ADJUSTMENT_OUT"],
    );
    assert.equal(ledger[0]?.quantity.toString(), "-3");
  });
});

test("a transfer posts out on send and in on receive at the same unit cost", async () => {
  const run = suffix();

  await rolledBack(async (tx) => {
    const actor = await actorId(tx);
    const variant = await makeStockedVariant(tx, run);
    const source = await makeWarehouse(tx, `T3A-${run.toUpperCase()}`);
    const destination = await makeWarehouse(tx, `T3B-${run.toUpperCase()}`);

    await postOpeningStock(
      {
        warehouseId: source.id,
        variantId: variant.id,
        quantity: "10",
        unitCost: "100",
        actorUserId: actor,
      },
      tx,
    );

    const transfer = await createTransfer(
      {
        fromWarehouseId: source.id,
        toWarehouseId: destination.id,
        lines: [{ variantId: variant.id, quantity: "4" }],
        notes: "Replenish the outlet",
        actorUserId: actor,
      },
      tx,
    );

    // Draft: stock has not moved.
    assert.equal((await balanceAt(tx, variant.id, source.id)).physicalQty.toString(), "10");
    assert.equal(
      await tx.inventoryBalance.count({
        where: { variantId: variant.id, warehouseId: destination.id },
      }),
      0,
    );

    await sendTransfer(transfer.id, actor, tx);
    assert.equal((await balanceAt(tx, variant.id, source.id)).physicalQty.toString(), "6");

    await receiveTransfer(transfer.id, actor, tx);
    const received = await balanceAt(tx, variant.id, destination.id);
    assert.equal(received.physicalQty.toString(), "4");
    assert.equal(received.availableQty.toString(), "4");
    assert.equal(received.avcoUnitCost.toString(), "100");

    const document = await tx.stockTransfer.findUniqueOrThrow({
      where: { id: transfer.id },
      select: {
        status: true,
        receivedAt: true,
        items: { select: { receivedQty: true, sourceUnitCost: true, totalCost: true } },
      },
    });
    assert.equal(document.status, "RECEIVED");
    assert.ok(document.receivedAt);
    assert.equal(document.items[0]?.receivedQty.toString(), "4");
    assert.equal(document.items[0]?.sourceUnitCost.toString(), "100");
    assert.equal(document.items[0]?.totalCost.toString(), "400");

    const legs = await tx.stockLedger.findMany({
      where: { referenceType: "stock_transfer", referenceId: transfer.id },
      orderBy: { createdAt: "asc" },
      select: { movementType: true, warehouseId: true, quantity: true, unitCost: true },
    });
    assert.deepEqual(
      legs.map((leg) => leg.movementType),
      ["TRANSFER_OUT", "TRANSFER_IN"],
    );
    assert.equal(legs[0]?.warehouseId, source.id);
    assert.equal(legs[1]?.warehouseId, destination.id);
    assert.equal(legs[0]?.unitCost.toString(), "100");
    assert.equal(legs[1]?.unitCost.toString(), "100");

    await assert.rejects(() => receiveTransfer(transfer.id, actor, tx), InventoryError);
  });
});

test("cancelling an in-transit transfer returns the stock to the source", async () => {
  const run = suffix();

  await rolledBack(async (tx) => {
    const actor = await actorId(tx);
    const variant = await makeStockedVariant(tx, run);
    const source = await makeWarehouse(tx, `T4A-${run.toUpperCase()}`);
    const destination = await makeWarehouse(tx, `T4B-${run.toUpperCase()}`);

    await postOpeningStock(
      {
        warehouseId: source.id,
        variantId: variant.id,
        quantity: "10",
        unitCost: "100",
        actorUserId: actor,
      },
      tx,
    );

    const transfer = await createTransfer(
      {
        fromWarehouseId: source.id,
        toWarehouseId: destination.id,
        lines: [{ variantId: variant.id, quantity: "4" }],
        actorUserId: actor,
      },
      tx,
    );
    await sendTransfer(transfer.id, actor, tx);
    assert.equal((await balanceAt(tx, variant.id, source.id)).physicalQty.toString(), "6");

    await cancelTransfer(transfer.id, actor, tx);
    const returned = await balanceAt(tx, variant.id, source.id);
    assert.equal(returned.physicalQty.toString(), "10");
    assert.equal(returned.availableQty.toString(), "10");
    assert.equal(
      await tx.inventoryBalance.count({
        where: { variantId: variant.id, warehouseId: destination.id },
      }),
      0,
    );

    const document = await tx.stockTransfer.findUniqueOrThrow({
      where: { id: transfer.id },
      select: { status: true },
    });
    assert.equal(document.status, "CANCELLED");

    const legs = await tx.stockLedger.findMany({
      where: { referenceType: "stock_transfer", referenceId: transfer.id },
      orderBy: { createdAt: "asc" },
      select: { movementType: true, warehouseId: true },
    });
    assert.deepEqual(
      legs.map((leg) => leg.movementType),
      ["TRANSFER_OUT", "TRANSFER_IN"],
    );
    assert.equal(legs[1]?.warehouseId, source.id);
  });
});

test("insufficient stock, non-stock variants and a second opening entry are refused", async () => {
  const run = suffix();

  await rolledBack(async (tx) => {
    const actor = await actorId(tx);
    const variant = await makeStockedVariant(tx, run);
    const warehouse = await makeWarehouse(tx, `T5-${run.toUpperCase()}`);

    await postOpeningStock(
      {
        warehouseId: warehouse.id,
        variantId: variant.id,
        quantity: "2",
        unitCost: "50",
        actorUserId: actor,
      },
      tx,
    );

    await assert.rejects(
      () =>
        postStockMovement(tx, {
          variantId: variant.id,
          warehouseId: warehouse.id,
          movementType: "SALE",
          quantity: "5",
          referenceType: "test",
          referenceId: "oversell",
          actorUserId: actor,
        }),
      InventoryError,
    );
    assert.equal((await balanceAt(tx, variant.id, warehouse.id)).physicalQty.toString(), "2");

    await assert.rejects(
      () =>
        postOpeningStock(
          {
            warehouseId: warehouse.id,
            variantId: variant.id,
            quantity: "5",
            unitCost: "50",
            actorUserId: actor,
          },
          tx,
        ),
      InventoryError,
    );

    const serviceVariant = await makeStockedVariant(tx, `${run}-service`, "NON_STOCK");
    await assert.rejects(
      () =>
        postOpeningStock(
          {
            warehouseId: warehouse.id,
            variantId: serviceVariant.id,
            quantity: "5",
            unitCost: "50",
            actorUserId: actor,
          },
          tx,
        ),
      InventoryError,
    );
  });
});

test("a warehouse holding stock cannot be deactivated", async () => {
  const run = suffix();

  await rolledBack(async (tx) => {
    const actor = await actorId(tx);
    const variant = await makeStockedVariant(tx, run);
    const warehouse = await makeWarehouse(tx, `T6-${run.toUpperCase()}`);

    await postOpeningStock(
      {
        warehouseId: warehouse.id,
        variantId: variant.id,
        quantity: "1",
        unitCost: "50",
        actorUserId: actor,
      },
      tx,
    );

    await assert.rejects(
      () => setWarehouseActive(warehouse.id, false, tx),
      /still holds stock/i,
    );

    const stored = await tx.warehouse.findUniqueOrThrow({
      where: { id: warehouse.id },
      select: { isActive: true },
    });
    assert.equal(stored.isActive, true);
  });
});

test("the stock ledger refuses updates at the database level", async () => {
  const run = suffix();

  await assert.rejects(
    () =>
      prisma.$transaction(async (tx) => {
        const actor = await actorId(tx);
        const variant = await makeStockedVariant(tx, run);
        const warehouse = await makeWarehouse(tx, `T7-${run.toUpperCase()}`);

        await postOpeningStock(
          {
            warehouseId: warehouse.id,
            variantId: variant.id,
            quantity: "1",
            unitCost: "50",
            actorUserId: actor,
          },
          tx,
        );

        const row = await tx.stockLedger.findFirstOrThrow({
          where: { variantId: variant.id },
          select: { id: true },
        });
        await tx.stockLedger.update({
          where: { id: row.id },
          data: { note: "an edit that must never happen" },
        });
      }),
    /immutable/i,
  );
});
