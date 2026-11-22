import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { Prisma } from "../src/generated/prisma/client";
import { prisma } from "../src/lib/db";
import {
  cancelGrn,
  cancelPurchaseOrder,
  closePurchaseOrder,
  createGrn,
  createPurchaseOrder,
  createSupplier,
  outstandingLines,
  postGrn,
  sendPurchaseOrder,
  setSupplierStatus,
  updatePurchaseOrder,
  PurchasingError,
} from "../src/lib/purchasing/service";

/**
 * Purchasing tests: suppliers, purchase orders and goods receipts.
 *
 * Every scenario runs inside one interactive transaction that is rolled back.
 * The stock ledger is append-only at the database level, so a receipt cannot be
 * deleted; rolling back keeps the development database clean while exercising
 * the real SQL, row locks, the deferred balance trigger and AVCO.
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

async function makeSupplier(tx: Prisma.TransactionClient, run: string) {
  return createSupplier(
    {
      name: `Purchasing test supplier ${run}`,
      paymentTermsDays: 15,
      leadTimeDays: 3,
      isDropshipVendor: false,
      status: "ACTIVE",
    },
    tx,
  );
}

async function makeStockedVariant(
  tx: Prisma.TransactionClient,
  run: string,
  fulfillmentType: "STOCKED" | "NON_STOCK" = "STOCKED",
) {
  const category = await tx.category.create({
    data: {
      name: `Purchasing test ${run}`,
      nameBn: "ক্রয় পরীক্ষা",
      slug: `purchasing-test-${run}`,
    },
    select: { id: true },
  });

  const product = await tx.product.create({
    data: {
      categoryId: category.id,
      name: `Purchasing test product ${run}`,
      slug: `purchasing-test-product-${run}`,
      basePrice: "100.00",
      status: "ACTIVE",
    },
    select: { id: true },
  });

  return tx.productVariant.create({
    data: {
      productId: product.id,
      sku: `PUR-${run.toUpperCase()}`,
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

test("purchase order totals are computed and a draft can be edited before sending", async () => {
  const run = suffix();

  await rolledBack(async (tx) => {
    const actor = await actorId(tx);
    const supplier = await makeSupplier(tx, run);
    const warehouse = await makeWarehouse(tx, `P1-${run.toUpperCase()}`);
    const first = await makeStockedVariant(tx, `${run}-a`);
    const second = await makeStockedVariant(tx, `${run}-b`);

    const order = await createPurchaseOrder(
      {
        supplierId: supplier.id,
        warehouseId: warehouse.id,
        discountTotal: "100",
        shippingTotal: "30",
        lines: [
          { variantId: first.id, quantity: "10", unitCost: "100", taxAmount: "50" },
          { variantId: second.id, quantity: "2", unitCost: "250" },
        ],
      },
      tx,
    );

    let stored = await tx.purchaseOrder.findUniqueOrThrow({ where: { id: order.id } });
    assert.equal(stored.status, "DRAFT");
    assert.equal(stored.subtotal.toString(), "1500");
    assert.equal(stored.taxTotal.toString(), "50");
    assert.equal(stored.discountTotal.toString(), "100");
    assert.equal(stored.shippingTotal.toString(), "30");
    assert.equal(stored.grandTotal.toString(), "1480");

    await updatePurchaseOrder(
      order.id,
      {
        supplierId: supplier.id,
        warehouseId: warehouse.id,
        lines: [{ variantId: first.id, quantity: "5", unitCost: "120" }],
      },
      tx,
    );

    const withItems = await tx.purchaseOrder.findUniqueOrThrow({
      where: { id: order.id },
      include: { items: true },
    });
    assert.equal(withItems.items.length, 1);
    assert.equal(withItems.items[0]?.quantity.toString(), "5");
    assert.equal(withItems.items[0]?.lineTotal.toString(), "600");
    assert.equal(withItems.grandTotal.toString(), "600");

    await sendPurchaseOrder(order.id, actor, tx);
    stored = await tx.purchaseOrder.findUniqueOrThrow({ where: { id: order.id } });
    assert.equal(stored.status, "SENT");
    assert.ok(stored.sentAt);

    await assert.rejects(
      () =>
        updatePurchaseOrder(
          order.id,
          {
            supplierId: supplier.id,
            warehouseId: warehouse.id,
            lines: [{ variantId: first.id, quantity: "5", unitCost: "120" }],
          },
          tx,
        ),
      /only a draft purchase order can be edited/i,
    );

    await assert.rejects(() => sendPurchaseOrder(order.id, actor, tx), PurchasingError);
  });
});

test("partial receipts post AVCO at landed cost and advance the order status", async () => {
  const run = suffix();

  await rolledBack(async (tx) => {
    const actor = await actorId(tx);
    const supplier = await makeSupplier(tx, run);
    const warehouse = await makeWarehouse(tx, `P2-${run.toUpperCase()}`);
    const variant = await makeStockedVariant(tx, run);

    const order = await createPurchaseOrder(
      {
        supplierId: supplier.id,
        warehouseId: warehouse.id,
        lines: [{ variantId: variant.id, quantity: "10", unitCost: "100" }],
      },
      tx,
    );
    await sendPurchaseOrder(order.id, actor, tx);

    const items = await tx.purchaseItem.findMany({
      where: { purchaseOrderId: order.id },
      select: { id: true },
    });
    const purchaseItemId = items[0]?.id;
    assert.ok(purchaseItemId);

    const firstGrn = await createGrn(
      {
        purchaseOrderId: order.id,
        lines: [{ purchaseItemId, quantity: "4", unitCost: "100", condition: "GOOD" }],
      },
      tx,
    );

    // A draft receipt changes nothing.
    assert.equal(
      await tx.inventoryBalance.count({ where: { variantId: variant.id } }),
      0,
    );
    assert.equal((await tx.purchaseOrder.findUniqueOrThrow({ where: { id: order.id } })).status, "SENT");

    await postGrn(firstGrn.id, actor, tx);
    await tx.$executeRawUnsafe("SET CONSTRAINTS ALL IMMEDIATE");

    let balance = await balanceAt(tx, variant.id, warehouse.id);
    assert.equal(balance.physicalQty.toString(), "4");
    assert.equal(balance.availableQty.toString(), "4");
    assert.equal(balance.avcoUnitCost.toString(), "100");

    const stored = await tx.purchaseOrder.findUniqueOrThrow({ where: { id: order.id } });
    assert.equal(stored.status, "PARTIALLY_RECEIVED");

    let outstanding = await outstandingLines(order.id, tx);
    assert.equal(outstanding[0]?.outstanding.toString(), "6");

    await assert.rejects(
      () =>
        createGrn(
          {
            purchaseOrderId: order.id,
            lines: [{ purchaseItemId, quantity: "7", condition: "GOOD" }],
          },
          tx,
        ),
      /remain outstanding/i,
    );

    const secondGrn = await createGrn(
      {
        purchaseOrderId: order.id,
        lines: [{ purchaseItemId, quantity: "6", unitCost: "150", condition: "GOOD" }],
      },
      tx,
    );
    await postGrn(secondGrn.id, actor, tx);
    await tx.$executeRawUnsafe("SET CONSTRAINTS ALL IMMEDIATE");

    balance = await balanceAt(tx, variant.id, warehouse.id);
    assert.equal(balance.physicalQty.toString(), "10");
    assert.equal(balance.availableQty.toString(), "10");
    // (4 × 100 + 6 × 150) / 10 = 130
    assert.equal(balance.avcoUnitCost.toString(), "130");

    const receivedOrder = await tx.purchaseOrder.findUniqueOrThrow({
      where: { id: order.id },
      include: { items: true },
    });
    assert.equal(receivedOrder.status, "RECEIVED");
    assert.equal(receivedOrder.items[0]?.receivedQty.toString(), "10");

    outstanding = await outstandingLines(order.id, tx);
    assert.equal(outstanding[0]?.outstanding.toString(), "0");

    const ledger = await tx.stockLedger.findMany({
      where: {
        referenceType: "goods_received_note",
        referenceId: { in: [firstGrn.id, secondGrn.id] },
      },
      orderBy: { createdAt: "asc" },
      select: { movementType: true, quantity: true, unitCost: true, totalValue: true },
    });
    assert.deepEqual(
      ledger.map((entry) => entry.movementType),
      ["PURCHASE_RECEIPT", "PURCHASE_RECEIPT"],
    );
    assert.equal(ledger[0]?.quantity.toString(), "4");
    assert.equal(ledger[1]?.unitCost.toString(), "150");
    assert.equal(ledger[1]?.totalValue.toString(), "900");

    await assert.rejects(
      () =>
        createGrn(
          {
            purchaseOrderId: order.id,
            lines: [{ purchaseItemId, quantity: "1", condition: "GOOD" }],
          },
          tx,
        ),
      /sent or partially received/i,
    );
    await assert.rejects(() => postGrn(firstGrn.id, actor, tx), PurchasingError);
  });
});

test("a damaged receipt raises damaged stock and never makes it available", async () => {
  const run = suffix();

  await rolledBack(async (tx) => {
    const actor = await actorId(tx);
    const supplier = await makeSupplier(tx, run);
    const warehouse = await makeWarehouse(tx, `P3-${run.toUpperCase()}`);
    const variant = await makeStockedVariant(tx, run);

    const order = await createPurchaseOrder(
      {
        supplierId: supplier.id,
        warehouseId: warehouse.id,
        lines: [{ variantId: variant.id, quantity: "5", unitCost: "100" }],
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
        lines: [
          {
            purchaseItemId: item.id,
            quantity: "2",
            unitCost: "100",
            condition: "DAMAGED",
            batchNumber: "BATCH-1",
          },
        ],
      },
      tx,
    );
    await postGrn(grn.id, actor, tx);
    await tx.$executeRawUnsafe("SET CONSTRAINTS ALL IMMEDIATE");

    const balance = await balanceAt(tx, variant.id, warehouse.id);
    assert.equal(balance.physicalQty.toString(), "2");
    assert.equal(balance.availableQty.toString(), "0");
    assert.equal(balance.damagedQty.toString(), "2");
    assert.equal(balance.quarantinedQty.toString(), "0");

    const ledger = await tx.stockLedger.findMany({
      where: { referenceType: "goods_received_note", referenceId: grn.id },
      orderBy: { createdAt: "asc" },
      select: { movementType: true, quantity: true },
    });
    assert.deepEqual(
      ledger.map((entry) => entry.movementType),
      ["PURCHASE_RECEIPT", "DAMAGE"],
    );
    assert.equal(ledger[1]?.quantity.toString(), "-2");

    const stored = await tx.goodsReceivedItem.findFirstOrThrow({
      where: { grnId: grn.id },
      select: { condition: true, batchNumber: true },
    });
    assert.equal(stored.condition, "DAMAGED");
    assert.equal(stored.batchNumber, "BATCH-1");

    // Damaged stock does not satisfy the order: it is still outstanding.
    const outstanding = await outstandingLines(order.id, tx);
    assert.equal(outstanding[0]?.outstanding.toString(), "3");
  });
});

test("draft receipts reserve outstanding quantity and cancelling releases it", async () => {
  const run = suffix();

  await rolledBack(async (tx) => {
    const actor = await actorId(tx);
    const supplier = await makeSupplier(tx, run);
    const warehouse = await makeWarehouse(tx, `P4-${run.toUpperCase()}`);
    const variant = await makeStockedVariant(tx, run);

    const order = await createPurchaseOrder(
      {
        supplierId: supplier.id,
        warehouseId: warehouse.id,
        lines: [{ variantId: variant.id, quantity: "10", unitCost: "100" }],
      },
      tx,
    );

    await assert.rejects(
      () =>
        createGrn(
          {
            purchaseOrderId: order.id,
            lines: [{ purchaseItemId: "missing", quantity: "1", condition: "GOOD" }],
          },
          tx,
        ),
      /only a sent or partially received order/i,
    );

    await sendPurchaseOrder(order.id, actor, tx);
    const item = await tx.purchaseItem.findFirstOrThrow({
      where: { purchaseOrderId: order.id },
      select: { id: true },
    });

    const draft = await createGrn(
      {
        purchaseOrderId: order.id,
        lines: [{ purchaseItemId: item.id, quantity: "4", condition: "GOOD" }],
      },
      tx,
    );

    let outstanding = await outstandingLines(order.id, tx);
    assert.equal(outstanding[0]?.outstanding.toString(), "6");

    await assert.rejects(
      () =>
        createGrn(
          {
            purchaseOrderId: order.id,
            lines: [{ purchaseItemId: item.id, quantity: "7", condition: "GOOD" }],
          },
          tx,
        ),
      /only 6 unit/i,
    );

    await assert.rejects(() => cancelPurchaseOrder(order.id, actor, tx), /draft goods receipt/i);
    await assert.rejects(() => postGrn("missing", actor, tx), PurchasingError);

    await cancelGrn(draft.id, tx);
    outstanding = await outstandingLines(order.id, tx);
    assert.equal(outstanding[0]?.outstanding.toString(), "10");

    const cancelled = await tx.goodsReceivedNote.findUniqueOrThrow({
      where: { id: draft.id },
      select: { status: true },
    });
    assert.equal(cancelled.status, "CANCELLED");

    await cancelPurchaseOrder(order.id, actor, tx);
    const closed = await tx.purchaseOrder.findUniqueOrThrow({ where: { id: order.id } });
    assert.equal(closed.status, "CANCELLED");
    assert.ok(closed.closedAt);
  });
});

test("a posted receipt is immutable and cannot be cancelled or re-posted", async () => {
  const run = suffix();

  await rolledBack(async (tx) => {
    const actor = await actorId(tx);
    const supplier = await makeSupplier(tx, run);
    const warehouse = await makeWarehouse(tx, `P5-${run.toUpperCase()}`);
    const variant = await makeStockedVariant(tx, run);

    const order = await createPurchaseOrder(
      {
        supplierId: supplier.id,
        warehouseId: warehouse.id,
        lines: [{ variantId: variant.id, quantity: "3", unitCost: "100" }],
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
        lines: [{ purchaseItemId: item.id, quantity: "3", condition: "GOOD" }],
      },
      tx,
    );
    await postGrn(grn.id, actor, tx);
    await tx.$executeRawUnsafe("SET CONSTRAINTS ALL IMMEDIATE");

    await assert.rejects(() => cancelGrn(grn.id, tx), /only a draft goods receipt/i);
    await assert.rejects(() => postGrn(grn.id, actor, tx), PurchasingError);

    const stored = await tx.goodsReceivedNote.findUniqueOrThrow({ where: { id: grn.id } });
    assert.equal(stored.status, "POSTED");
    assert.ok(stored.postedAt);

    await closePurchaseOrder(order.id, actor, tx);
    const closed = await tx.purchaseOrder.findUniqueOrThrow({ where: { id: order.id } });
    assert.equal(closed.status, "CLOSED");

    // A received order cannot be cancelled.
    await assert.rejects(() => cancelPurchaseOrder(order.id, actor, tx), PurchasingError);
  });
});

test("non-stock variants, inactive suppliers and duplicate lines are refused", async () => {
  const run = suffix();

  await rolledBack(async (tx) => {
    const supplier = await makeSupplier(tx, run);
    const warehouse = await makeWarehouse(tx, `P6-${run.toUpperCase()}`);
    const stocked = await makeStockedVariant(tx, `${run}-stocked`);
    const service = await makeStockedVariant(tx, `${run}-service`, "NON_STOCK");

    await assert.rejects(
      () =>
        createPurchaseOrder(
          {
            supplierId: supplier.id,
            warehouseId: warehouse.id,
            lines: [{ variantId: service.id, quantity: "1", unitCost: "100" }],
          },
          tx,
        ),
      /stocked variants/i,
    );

    await assert.rejects(
      () =>
        createPurchaseOrder(
          {
            supplierId: supplier.id,
            warehouseId: warehouse.id,
            lines: [
              { variantId: stocked.id, quantity: "1", unitCost: "100" },
              { variantId: stocked.id, quantity: "2", unitCost: "100" },
            ],
          },
          tx,
        ),
      /only once/i,
    );

    await setSupplierStatus(supplier.id, "INACTIVE", tx);
    await assert.rejects(
      () =>
        createPurchaseOrder(
          {
            supplierId: supplier.id,
            warehouseId: warehouse.id,
            lines: [{ variantId: stocked.id, quantity: "1", unitCost: "100" }],
          },
          tx,
        ),
      /active supplier/i,
    );
  });
});
