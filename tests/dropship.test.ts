import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { Prisma } from "../src/generated/prisma/client";
import { prisma } from "../src/lib/db";
import { ACCOUNTS } from "../src/lib/accounting/journal";
import { createDropshipOrdersForOrder } from "../src/lib/dropship/create";
import {
  cancelDropshipOrder,
  confirmDropshipOrder,
  deliverDropshipOrder,
  sendDropshipOrder,
  shipDropshipOrder,
} from "../src/lib/dropship/service";
import { postStockMovement } from "../src/lib/inventory/stock";
import { cancelOrder, createSale } from "../src/lib/orders/service";
import { supplierPayable } from "../src/lib/purchasing/settlement";

/**
 * Dropship tests.
 *
 * Every scenario runs inside one transaction that is rolled back. The stock
 * ledger and journals are append-only at the database level, so a sale cannot be
 * deleted; rolling back keeps the development database clean while exercising
 * the real SQL, row locks and constraints.
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

let mobileCounter = 0;
function mobile(): string {
  mobileCounter += 1;
  const tail = String((Number(String(Date.now()).slice(-8)) + mobileCounter) % 100_000_000).padStart(
    8,
    "0",
  );
  return `+8801${3 + (mobileCounter % 7)}${tail}`;
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

async function makeVariant(
  tx: Prisma.TransactionClient,
  input: {
    run: string;
    label: string;
    categoryId: string;
    price: string;
    costPrice?: string;
    fulfillmentType: "STOCKED" | "DROPSHIP";
    supplierId?: string | null;
    dropshipCost?: string | null;
  },
) {
  const product = await tx.product.create({
    data: {
      categoryId: input.categoryId,
      name: `Dropship ${input.label} ${input.run}`,
      slug: `dropship-${input.label}-${input.run}`,
      basePrice: input.price,
      status: "ACTIVE",
      isPublished: false,
    },
    select: { id: true },
  });
  return tx.productVariant.create({
    data: {
      productId: product.id,
      sku: `DS-${input.label}-${input.run.toUpperCase()}`,
      name: input.label,
      price: input.price,
      costPrice: input.costPrice ?? "0.0000",
      fulfillmentType: input.fulfillmentType,
      dropshipSupplierId: input.supplierId ?? null,
      dropshipCost: input.dropshipCost ?? null,
    },
    select: { id: true, sku: true },
  });
}

async function fixture(tx: Prisma.TransactionClient, run: string) {
  const actor = await actorId(tx);
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
  const category = await tx.category.create({
    data: {
      name: `Dropship test ${run}`,
      nameBn: "ড্রপশিপ পরীক্ষা",
      slug: `dropship-test-${run}`,
      vatPercentage: "0.00",
    },
    select: { id: true },
  });

  const supplierA = await tx.supplier.create({
    data: {
      code: `DSA-${run.toUpperCase()}`,
      name: `Dropship supplier A ${run}`,
      isDropshipVendor: true,
      status: "ACTIVE",
    },
    select: { id: true },
  });
  const supplierB = await tx.supplier.create({
    data: {
      code: `DSB-${run.toUpperCase()}`,
      name: `Dropship supplier B ${run}`,
      isDropshipVendor: true,
      status: "ACTIVE",
    },
    select: { id: true },
  });

  const dropship = await makeVariant(tx, {
    run,
    label: "dropship",
    categoryId: category.id,
    price: "1150.00",
    fulfillmentType: "DROPSHIP",
    supplierId: supplierA.id,
    dropshipCost: "700.0000",
  });
  const dropshipSameSupplier = await makeVariant(tx, {
    run,
    label: "second",
    categoryId: category.id,
    price: "1150.00",
    fulfillmentType: "DROPSHIP",
    supplierId: supplierA.id,
    dropshipCost: "700.0000",
  });
  const dropshipOtherSupplier = await makeVariant(tx, {
    run,
    label: "other",
    categoryId: category.id,
    price: "950.00",
    fulfillmentType: "DROPSHIP",
    supplierId: supplierB.id,
    dropshipCost: "650.0000",
  });
  const withoutSupplier = await makeVariant(tx, {
    run,
    label: "orphan",
    categoryId: category.id,
    price: "500.00",
    fulfillmentType: "DROPSHIP",
    supplierId: null,
  });
  const stocked = await makeVariant(tx, {
    run,
    label: "stocked",
    categoryId: category.id,
    price: "300.00",
    costPrice: "180.0000",
    fulfillmentType: "STOCKED",
  });

  await postStockMovement(tx, {
    variantId: stocked.id,
    warehouseId: warehouse.id,
    storeId: store.id,
    movementType: "OPENING_BALANCE",
    quantity: "5",
    unitCost: "180",
    referenceType: "test",
    referenceId: run,
    actorUserId: actor,
  });

  return {
    actor,
    warehouse,
    store,
    category,
    supplierA,
    supplierB,
    dropship,
    dropshipSameSupplier,
    dropshipOtherSupplier,
    withoutSupplier,
    stocked,
  };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;

function sale(
  data: Fixture,
  lines: Array<{ variantId: string; quantity: string }>,
  payment: "full" | "partial" = "full",
) {
  return {
    source: "WEB" as const,
    warehouseId: data.warehouse.id,
    customerMobile: mobile(),
    customerName: "Dropship buyer",
    recipientName: "Dropship buyer",
    recipientMobile: mobile(),
    lines,
    payments:
      payment === "full"
        ? [{ method: "CASH" as const }]
        : [{ method: "CASH" as const, amount: "100.00" }],
    actorUserId: data.actor,
  };
}

async function journalLines(tx: Prisma.TransactionClient, entryId: string) {
  return tx.journalEntryLine.findMany({
    where: { journalEntryId: entryId },
    orderBy: { lineOrder: "asc" },
    select: {
      debit: true,
      credit: true,
      supplierId: true,
      account: { select: { code: true } },
    },
  });
}

test("a dropship sale raises a supplier order and takes no stock", async () => {
  const run = suffix();

  await rolledBack(async (tx) => {
    const data = await fixture(tx, run);

    const result = await createSale(
      sale(data, [{ variantId: data.dropship.id, quantity: "2" }]),
      tx,
    );

    const po = await tx.purchaseOrder.findFirstOrThrow({
      where: { orderId: result.orderId },
      include: { items: true },
    });
    assert.equal(po.poType, "DROPSHIP");
    assert.equal(po.status, "DRAFT");
    assert.equal(po.warehouseId, null);
    assert.equal(po.supplierId, data.supplierA.id);
    assert.equal(po.grandTotal.toFixed(2), "1400.00");
    assert.equal(po.items.length, 1);
    assert.equal(po.items[0]?.quantity.toString(), "2");
    assert.equal(po.items[0]?.unitCost.toFixed(4), "700.0000");
    assert.equal(po.items[0]?.lineTotal.toFixed(2), "1400.00");
    assert.ok(po.items[0]?.orderItemId);

    const order = await tx.order.findUniqueOrThrow({
      where: { id: result.orderId },
      select: { fulfillmentStatus: true, hasDropshipItems: true, status: true },
    });
    assert.equal(order.hasDropshipItems, true);
    assert.equal(order.fulfillmentStatus, "PENDING_DROPSHIP");
    assert.equal(order.status, "CONFIRMED");

    // A dropship variant never touches the stock ledger or a balance.
    assert.equal(await tx.stockLedger.count({ where: { variantId: data.dropship.id } }), 0);
    assert.equal(await tx.inventoryBalance.count({ where: { variantId: data.dropship.id } }), 0);

    // The purchase order is the payable; nothing was received.
    assert.equal(await tx.goodsReceivedNote.count({ where: { purchaseOrderId: po.id } }), 0);
  });
});

test("dropship lines are grouped per supplier and creation is idempotent", async () => {
  const run = suffix();

  await rolledBack(async (tx) => {
    const data = await fixture(tx, run);

    const result = await createSale(
      sale(data, [
        { variantId: data.dropship.id, quantity: "2" },
        { variantId: data.dropshipSameSupplier.id, quantity: "3" },
        { variantId: data.dropshipOtherSupplier.id, quantity: "1" },
      ]),
      tx,
    );

    const orders = await tx.purchaseOrder.findMany({
      where: { orderId: result.orderId },
      include: { items: true },
      orderBy: { supplierId: "asc" },
    });
    assert.equal(orders.length, 2);

    const forA = orders.find((po) => po.supplierId === data.supplierA.id);
    const forB = orders.find((po) => po.supplierId === data.supplierB.id);
    assert.ok(forA);
    assert.ok(forB);
    assert.equal(forA.items.length, 2);
    assert.equal(forA.grandTotal.toFixed(2), "3500.00");
    assert.equal(forB.items.length, 1);
    assert.equal(forB.grandTotal.toFixed(2), "650.00");

    const again = await createDropshipOrdersForOrder(tx, result.orderId);
    assert.equal(again.length, 0);
    assert.equal(
      await tx.purchaseOrder.count({ where: { orderId: result.orderId, poType: "DROPSHIP" } }),
      2,
    );
  });
});

test("a dropship line without a supplier stops the sale", async () => {
  const run = suffix();

  await rolledBack(async (tx) => {
    const data = await fixture(tx, run);

    const input = sale(data, [{ variantId: data.withoutSupplier.id, quantity: "1" }]);
    await assert.rejects(() => createSale(input, tx), /no supplier/i);

    // No supplier order was raised for the failed sale.
    assert.equal(
      await tx.purchaseOrder.count({ where: { order: { recipientMobile: input.recipientMobile } } }),
      0,
    );
  });
});

test("shipping posts the supplier cost once, creates a direct shipment and moves the sale", async () => {
  const run = suffix();

  await rolledBack(async (tx) => {
    const data = await fixture(tx, run);
    const result = await createSale(
      sale(data, [{ variantId: data.dropship.id, quantity: "2" }]),
      tx,
    );
    const po = await tx.purchaseOrder.findFirstOrThrow({
      where: { orderId: result.orderId },
    });

    await sendDropshipOrder(po.id, data.actor, tx);
    assert.equal(
      (await tx.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } })).status,
      "SENT",
    );

    await confirmDropshipOrder(po.id, data.actor, "Supplier ref 4471", tx);
    const confirmed = await tx.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } });
    assert.equal(confirmed.status, "CONFIRMED");
    assert.ok(confirmed.confirmedAt);
    assert.match(confirmed.notes ?? "", /4471/);

    const shipped = await shipDropshipOrder(
      po.id,
      data.actor,
      { trackingNumber: "TRK-9001", note: "Handed to supplier courier" },
      tx,
    );
    assert.ok(shipped.shipmentNumber);

    const stored = await tx.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } });
    assert.equal(stored.status, "SHIPPED");
    assert.ok(stored.shippedAt);

    const order = await tx.order.findUniqueOrThrow({
      where: { id: result.orderId },
      select: { status: true, fulfillmentStatus: true },
    });
    assert.equal(order.status, "SHIPPED");
    assert.equal(order.fulfillmentStatus, "PENDING_DROPSHIP");

    const shipment = await tx.shipment.findFirstOrThrow({
      where: { orderId: result.orderId, shipmentType: "DROPSHIP_DIRECT" },
      select: {
        supplierId: true,
        warehouseId: true,
        status: true,
        trackingNumber: true,
        codAmount: true,
        trackingEvents: { select: { status: true, message: true } },
      },
    });
    assert.equal(shipment.supplierId, data.supplierA.id);
    assert.equal(shipment.warehouseId, null);
    assert.equal(shipment.status, "PICKED_UP");
    assert.equal(shipment.trackingNumber, "TRK-9001");
    assert.equal(shipment.codAmount.toFixed(2), "0.00");
    assert.equal(shipment.trackingEvents.length, 1);

    const entries = await tx.journalEntry.findMany({
      where: {
        referenceType: "purchase_order",
        referenceId: po.id,
        source: "DROPSHIP_COGS",
      },
      select: { id: true },
    });
    assert.equal(entries.length, 1);
    const lines = await journalLines(tx, entries[0]!.id);
    const cogs = lines.find((line) => line.account.code === ACCOUNTS.dropshipCogs);
    const payable = lines.find((line) => line.account.code === ACCOUNTS.payable);
    assert.equal(cogs?.debit.toFixed(2), "1400.00");
    assert.equal(payable?.credit.toFixed(2), "1400.00");
    assert.equal(payable?.supplierId, data.supplierA.id);

    // The existing settlement statement sees the supplier payable.
    const owed = await supplierPayable(data.supplierA.id, tx);
    assert.equal(owed.outstanding.toFixed(2), "1400.00");

    // Shipping twice is refused and does not double the cost.
    await assert.rejects(
      () => shipDropshipOrder(po.id, data.actor, {}, tx),
      /Confirm the supplier order before shipping/i,
    );
    assert.equal(
      await tx.journalEntry.count({
        where: { referenceType: "purchase_order", referenceId: po.id, source: "DROPSHIP_COGS" },
      }),
      1,
    );
  });
});

test("shipping is refused while the customer still owes money", async () => {
  const run = suffix();

  await rolledBack(async (tx) => {
    const data = await fixture(tx, run);
    const result = await createSale(
      sale(data, [{ variantId: data.dropship.id, quantity: "1" }], "partial"),
      tx,
    );
    const po = await tx.purchaseOrder.findFirstOrThrow({ where: { orderId: result.orderId } });
    await sendDropshipOrder(po.id, data.actor, tx);
    await confirmDropshipOrder(po.id, data.actor, undefined, tx);

    await assert.rejects(
      () => shipDropshipOrder(po.id, data.actor, {}, tx),
      /still due before the supplier ships/i,
    );
    assert.equal(
      (await tx.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } })).status,
      "CONFIRMED",
    );
    assert.equal(
      await tx.journalEntry.count({
        where: { referenceType: "purchase_order", referenceId: po.id, source: "DROPSHIP_COGS" },
      }),
      0,
    );
  });
});

test("delivery closes the shipment and fulfils the sale", async () => {
  const run = suffix();

  await rolledBack(async (tx) => {
    const data = await fixture(tx, run);
    const result = await createSale(
      sale(data, [{ variantId: data.dropship.id, quantity: "1" }]),
      tx,
    );
    const po = await tx.purchaseOrder.findFirstOrThrow({ where: { orderId: result.orderId } });
    await sendDropshipOrder(po.id, data.actor, tx);
    await confirmDropshipOrder(po.id, data.actor, undefined, tx);
    await shipDropshipOrder(po.id, data.actor, { trackingNumber: "TRK-1" }, tx);

    await deliverDropshipOrder(po.id, data.actor, "Received by the customer", tx);

    const stored = await tx.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } });
    assert.equal(stored.status, "DELIVERED");
    assert.ok(stored.deliveredAt);

    const order = await tx.order.findUniqueOrThrow({
      where: { id: result.orderId },
      select: { status: true, fulfillmentStatus: true },
    });
    assert.equal(order.status, "DELIVERED");
    assert.equal(order.fulfillmentStatus, "FULFILLED");

    const shipment = await tx.shipment.findFirstOrThrow({
      where: { orderId: result.orderId, shipmentType: "DROPSHIP_DIRECT" },
      select: {
        status: true,
        deliveredAt: true,
        trackingEvents: { orderBy: { eventAt: "asc" }, select: { status: true } },
      },
    });
    assert.equal(shipment.status, "DELIVERED");
    assert.ok(shipment.deliveredAt);
    assert.deepEqual(
      shipment.trackingEvents.map((event) => event.status),
      ["PICKED_UP", "DELIVERED"],
    );
  });
});

test("a dropship order can be cancelled before shipping but not after", async () => {
  const run = suffix();

  await rolledBack(async (tx) => {
    const data = await fixture(tx, run);
    const result = await createSale(
      sale(data, [{ variantId: data.dropship.id, quantity: "1" }]),
      tx,
    );
    const po = await tx.purchaseOrder.findFirstOrThrow({ where: { orderId: result.orderId } });

    await sendDropshipOrder(po.id, data.actor, tx);
    await confirmDropshipOrder(po.id, data.actor, undefined, tx);
    await cancelDropshipOrder(po.id, data.actor, "Supplier out of stock", tx);

    const cancelled = await tx.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } });
    assert.equal(cancelled.status, "CANCELLED");
    assert.equal(cancelled.cancelReason, "Supplier out of stock");
    assert.equal(
      await tx.journalEntry.count({
        where: { referenceType: "purchase_order", referenceId: po.id },
      }),
      0,
    );
  });

  await rolledBack(async (tx) => {
    const data = await fixture(tx, run);
    const result = await createSale(
      sale(data, [{ variantId: data.dropship.id, quantity: "1" }]),
      tx,
    );
    const po = await tx.purchaseOrder.findFirstOrThrow({ where: { orderId: result.orderId } });
    await sendDropshipOrder(po.id, data.actor, tx);
    await confirmDropshipOrder(po.id, data.actor, undefined, tx);
    await shipDropshipOrder(po.id, data.actor, {}, tx);

    await assert.rejects(
      () => cancelDropshipOrder(po.id, data.actor, "Too late", tx),
      /before the supplier ships/i,
    );
  });
});

test("cancelling the sale cancels open supplier orders and is refused after shipping", async () => {
  const run = suffix();

  await rolledBack(async (tx) => {
    const data = await fixture(tx, run);
    const result = await createSale(
      sale(data, [{ variantId: data.dropship.id, quantity: "1" }]),
      tx,
    );
    await sendDropshipOrder(
      (await tx.purchaseOrder.findFirstOrThrow({ where: { orderId: result.orderId } })).id,
      data.actor,
      tx,
    );

    await cancelOrder(result.orderId, data.actor, "Customer changed their mind", tx);

    const po = await tx.purchaseOrder.findFirstOrThrow({ where: { orderId: result.orderId } });
    assert.equal(po.status, "CANCELLED");
    assert.match(po.cancelReason ?? "", /Customer changed their mind/);
  });

  await rolledBack(async (tx) => {
    const data = await fixture(tx, run);
    const result = await createSale(
      sale(data, [{ variantId: data.dropship.id, quantity: "1" }]),
      tx,
    );
    const po = await tx.purchaseOrder.findFirstOrThrow({ where: { orderId: result.orderId } });
    await sendDropshipOrder(po.id, data.actor, tx);
    await confirmDropshipOrder(po.id, data.actor, undefined, tx);
    await shipDropshipOrder(po.id, data.actor, {}, tx);

    // Put the sale back into a cancellable state to prove the guard, not the
    // order's own status, stops the cancellation.
    await tx.order.update({ where: { id: result.orderId }, data: { status: "CONFIRMED" } });

    await assert.rejects(
      () => cancelOrder(result.orderId, data.actor, "Too late", tx),
      /already shipped/i,
    );
    assert.equal(
      (await tx.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } })).status,
      "SHIPPED",
    );
  });
});

test("a sale split across suppliers ships and delivers only when every parcel moves", async () => {
  const run = suffix();

  await rolledBack(async (tx) => {
    const data = await fixture(tx, run);
    const result = await createSale(
      sale(data, [
        { variantId: data.dropship.id, quantity: "1" },
        { variantId: data.dropshipOtherSupplier.id, quantity: "1" },
      ]),
      tx,
    );

    const orders = await tx.purchaseOrder.findMany({
      where: { orderId: result.orderId, poType: "DROPSHIP" },
    });
    assert.equal(orders.length, 2);
    const forA = orders.find((po) => po.supplierId === data.supplierA.id);
    const forB = orders.find((po) => po.supplierId === data.supplierB.id);
    assert.ok(forA);
    assert.ok(forB);

    for (const po of [forA, forB]) {
      await sendDropshipOrder(po.id, data.actor, tx);
      await confirmDropshipOrder(po.id, data.actor, undefined, tx);
    }

    // First parcel: the sale is ready but not shipped.
    await shipDropshipOrder(forA.id, data.actor, { trackingNumber: "TRK-A" }, tx);
    let order = await tx.order.findUniqueOrThrow({
      where: { id: result.orderId },
      select: { status: true, fulfillmentStatus: true },
    });
    assert.equal(order.status, "READY_TO_SHIP");
    assert.equal(order.fulfillmentStatus, "PENDING_DROPSHIP");

    // Second parcel: now every supplier order has shipped.
    await shipDropshipOrder(forB.id, data.actor, { trackingNumber: "TRK-B" }, tx);
    order = await tx.order.findUniqueOrThrow({
      where: { id: result.orderId },
      select: { status: true, fulfillmentStatus: true },
    });
    assert.equal(order.status, "SHIPPED");

    // First delivery leaves the sale shipped because the other parcel is live.
    await deliverDropshipOrder(forA.id, data.actor, "A arrived", tx);
    order = await tx.order.findUniqueOrThrow({
      where: { id: result.orderId },
      select: { status: true, fulfillmentStatus: true },
    });
    assert.equal(order.status, "SHIPPED");
    assert.equal(order.fulfillmentStatus, "PENDING_DROPSHIP");

    // Second delivery closes the sale.
    await deliverDropshipOrder(forB.id, data.actor, "B arrived", tx);
    order = await tx.order.findUniqueOrThrow({
      where: { id: result.orderId },
      select: { status: true, fulfillmentStatus: true },
    });
    assert.equal(order.status, "DELIVERED");
    assert.equal(order.fulfillmentStatus, "FULFILLED");

    const shipments = await tx.shipment.findMany({
      where: { orderId: result.orderId, shipmentType: "DROPSHIP_DIRECT" },
      select: { status: true, deliveredAt: true },
    });
    assert.equal(shipments.length, 2);
    assert.ok(shipments.every((shipment) => shipment.status === "DELIVERED"));
    assert.ok(shipments.every((shipment) => shipment.deliveredAt));
  });
});

test("a stocked sale is untouched and a mixed sale still fulfils normally", async () => {
  const run = suffix();

  await rolledBack(async (tx) => {
    const data = await fixture(tx, run);

    const stockedSale = await createSale(
      sale(data, [{ variantId: data.stocked.id, quantity: "2" }]),
      tx,
    );
    assert.equal(
      await tx.purchaseOrder.count({ where: { orderId: stockedSale.orderId } }),
      0,
    );
    const stockedOrder = await tx.order.findUniqueOrThrow({
      where: { id: stockedSale.orderId },
      select: { hasDropshipItems: true, fulfillmentStatus: true },
    });
    assert.equal(stockedOrder.hasDropshipItems, false);
    assert.equal(stockedOrder.fulfillmentStatus, "UNFULFILLED");
    const balance = await tx.inventoryBalance.findUniqueOrThrow({
      where: {
        variantId_warehouseId: { variantId: data.stocked.id, warehouseId: data.warehouse.id },
      },
      select: { availableQty: true },
    });
    assert.equal(balance.availableQty.toFixed(3), "3.000");

    // Mixed: stock leaves for the stocked line, a supplier order is raised for
    // the dropship line, and fulfilment is not marked as dropship-only.
    const mixed = await createSale(
      sale(data, [
        { variantId: data.stocked.id, quantity: "1" },
        { variantId: data.dropshipOtherSupplier.id, quantity: "1" },
      ]),
      tx,
    );
    const mixedOrder = await tx.order.findUniqueOrThrow({
      where: { id: mixed.orderId },
      select: { hasDropshipItems: true, fulfillmentStatus: true },
    });
    assert.equal(mixedOrder.hasDropshipItems, true);
    assert.equal(mixedOrder.fulfillmentStatus, "UNFULFILLED");
    assert.equal(
      await tx.purchaseOrder.count({ where: { orderId: mixed.orderId, poType: "DROPSHIP" } }),
      1,
    );
  });
});
