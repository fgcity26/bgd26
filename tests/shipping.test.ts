import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { Prisma } from "../src/generated/prisma/client";
import { prisma } from "../src/lib/db";
import { hashSecret } from "../src/lib/password";
import { postStockMovement } from "../src/lib/inventory/stock";
import { createSale, setOrderStatus } from "../src/lib/orders/service";
import { getCourierAdapter } from "../src/lib/adapters/couriers/registry";
import { CourierError } from "../src/lib/adapters/couriers/types";
import {
  addTrackingEvent,
  cancelShipment,
  createCourier,
  createShipment,
  postCodRemittance,
  ShippingError,
} from "../src/lib/shipping/service";

/**
 * Shipping tests: consignment booking, one-live-shipment-per-order, tracking
 * events driving the order status, cancellation and the COD remittance journal.
 *
 * Database scenarios run inside a transaction that is rolled back, so the real
 * CHECK constraints, partial unique index and journal triggers are exercised
 * without leaving rows.
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
      email: `shipping-${run}@bgd26.test`,
      fullName: "Shipping test manager",
      passwordHash: await hashSecret(`Shipping-${run}-password`),
      status: "ACTIVE",
      userRoles: { create: { roleId: role.id } },
    },
    select: { id: true },
  });
  const category = await tx.category.create({
    data: {
      name: `Shipping ${run}`,
      nameBn: "চালান",
      slug: `shipping-${run}`,
      vatPercentage: "15.00",
    },
    select: { id: true },
  });
  const product = await tx.product.create({
    data: {
      categoryId: category.id,
      name: `Shipping product ${run}`,
      slug: `shipping-product-${run}`,
      basePrice: "115.00",
      status: "ACTIVE",
      isPublished: true,
    },
    select: { id: true },
  });
  const variant = await tx.productVariant.create({
    data: {
      productId: product.id,
      sku: `SHP-${run.toUpperCase()}`,
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

/** A confirmed COD online order, moved to ready to ship. */
async function readyOrder(tx: Prisma.TransactionClient, run: string) {
  const data = await fixture(tx, run);
  const sale = await createSale(
    {
      source: "WEB",
      warehouseId: data.warehouse.id,
      customerMobile: testMobile(run),
      customerName: "Shipping buyer",
      recipientName: "Shipping buyer",
      recipientMobile: testMobile(run),
      shippingAddress: {
        address: "12 Test Road",
        division: "Dhaka",
        district: "Dhaka",
      },
      lines: [{ variantId: data.variant.id, quantity: 1 }],
      deliveryCharge: "60",
      payments: [{ method: "COD" }],
      actorUserId: data.manager.id,
      clientTransactionUuid: `shipping-${run}`,
    },
    tx,
  );
  await setOrderStatus(sale.orderId, "READY_TO_SHIP", data.manager.id, null, tx);
  return { ...data, orderId: sale.orderId };
}

async function manualCourier(tx: Prisma.TransactionClient, run: string) {
  return createCourier(
    {
      code: `TEST-${run.toUpperCase()}`,
      name: "Test manual courier",
      provider: "MANUAL",
      supportsCod: true,
      supportsDropship: false,
      isActive: true,
    },
    tx,
  );
}

// ---------------------------------------------------------------------------
// Booking
// ---------------------------------------------------------------------------

test("booking a shipment records a consignment without moving the order", async () => {
  await rolledBack(async (tx) => {
    const run = suffix();
    const data = await readyOrder(tx, run);
    const courier = await manualCourier(tx, run);

    const shipment = await createShipment(
      {
        orderId: data.orderId,
        courierId: courier.id,
        trackingNumber: `TRK-${run}`,
        actorUserId: data.manager.id,
      },
      tx,
    );

    const stored = await tx.shipment.findUniqueOrThrow({
      where: { id: shipment.id },
      include: { order: { select: { status: true } }, trackingEvents: true },
    });
    assert.equal(stored.status, "BOOKED");
    assert.equal(stored.trackingNumber, `TRK-${run}`);
    assert.equal(stored.codAmount.toFixed(2), "175.00");
    assert.equal(stored.order.status, "READY_TO_SHIP");
    assert.equal(stored.trackingEvents.length, 1);
  });
});

test("a manual booking without a tracking number stays pending", async () => {
  await rolledBack(async (tx) => {
    const run = suffix();
    const data = await readyOrder(tx, run);
    const shipment = await createShipment(
      { orderId: data.orderId, actorUserId: data.manager.id },
      tx,
    );
    const stored = await tx.shipment.findUniqueOrThrow({
      where: { id: shipment.id },
      select: { status: true, trackingNumber: true },
    });
    assert.equal(stored.status, "PENDING");
    assert.equal(stored.trackingNumber, null);
  });
});

test("only a ready-to-ship order can be booked", async () => {
  await rolledBack(async (tx) => {
    const run = suffix();
    const data = await fixture(tx, run);
    const sale = await createSale(
      {
        source: "WEB",
        warehouseId: data.warehouse.id,
        customerMobile: testMobile(run),
        customerName: "Not ready",
        lines: [{ variantId: data.variant.id, quantity: 1 }],
        payments: [{ method: "COD" }],
        actorUserId: data.manager.id,
        clientTransactionUuid: `notready-${run}`,
      },
      tx,
    );
    await assert.rejects(
      createShipment({ orderId: sale.orderId, actorUserId: data.manager.id }, tx),
      ShippingError,
    );
  });
});

test("an order cannot have two live shipments", async () => {
  await rolledBack(async (tx) => {
    const run = suffix();
    const data = await readyOrder(tx, run);
    await createShipment({ orderId: data.orderId, actorUserId: data.manager.id }, tx);
    await assert.rejects(
      createShipment({ orderId: data.orderId, actorUserId: data.manager.id }, tx),
      ShippingError,
    );
  });
});

test("the database refuses a second live shipment for the same order", async () => {
  await rolledBack(async (tx) => {
    const run = suffix();
    const data = await readyOrder(tx, run);
    const shipment = await createShipment(
      { orderId: data.orderId, actorUserId: data.manager.id },
      tx,
    );
    await assert.rejects(
      tx.shipment.create({
        data: {
          shipmentNumber: `SHP-DUP-${run}`,
          orderId: data.orderId,
          shipmentType: "OUTBOUND",
          status: "BOOKED",
          recipientName: "Dup",
          recipientMobile: testMobile(run),
          codAmount: "0",
          deliveryCharge: "0",
          createdByUserId: data.manager.id,
        },
      }),
      /uq_shipment_active_order|duplicate key/i,
    );
    assert.ok(shipment.id);
  });
});

// ---------------------------------------------------------------------------
// Tracking and order status
// ---------------------------------------------------------------------------

test("a pickup event moves the order to shipped", async () => {
  await rolledBack(async (tx) => {
    const run = suffix();
    const data = await readyOrder(tx, run);
    const shipment = await createShipment(
      { orderId: data.orderId, actorUserId: data.manager.id },
      tx,
    );

    await addTrackingEvent(
      {
        shipmentId: shipment.id,
        status: "PICKED_UP",
        location: "Dhaka hub",
        actorUserId: data.manager.id,
      },
      tx,
    );

    const order = await tx.order.findUniqueOrThrow({
      where: { id: data.orderId },
      select: { status: true },
    });
    const stored = await tx.shipment.findUniqueOrThrow({
      where: { id: shipment.id },
      select: { status: true, shippedAt: true },
    });
    assert.equal(order.status, "SHIPPED");
    assert.equal(stored.status, "PICKED_UP");
    assert.ok(stored.shippedAt);
  });
});

test("a delivery event moves the order to delivered", async () => {
  await rolledBack(async (tx) => {
    const run = suffix();
    const data = await readyOrder(tx, run);
    const shipment = await createShipment(
      { orderId: data.orderId, actorUserId: data.manager.id },
      tx,
    );

    await addTrackingEvent(
      { shipmentId: shipment.id, status: "IN_TRANSIT", actorUserId: data.manager.id },
      tx,
    );
    await addTrackingEvent(
      { shipmentId: shipment.id, status: "DELIVERED", actorUserId: data.manager.id },
      tx,
    );

    const order = await tx.order.findUniqueOrThrow({
      where: { id: data.orderId },
      select: { status: true },
    });
    const stored = await tx.shipment.findUniqueOrThrow({
      where: { id: shipment.id },
      select: { status: true, deliveredAt: true },
    });
    assert.equal(order.status, "DELIVERED");
    assert.equal(stored.status, "DELIVERED");
    assert.ok(stored.deliveredAt);
  });
});

test("a courier failure leaves the order alone", async () => {
  await rolledBack(async (tx) => {
    const run = suffix();
    const data = await readyOrder(tx, run);
    const shipment = await createShipment(
      { orderId: data.orderId, actorUserId: data.manager.id },
      tx,
    );
    await addTrackingEvent(
      { shipmentId: shipment.id, status: "FAILED", actorUserId: data.manager.id },
      tx,
    );
    const order = await tx.order.findUniqueOrThrow({
      where: { id: data.orderId },
      select: { status: true },
    });
    assert.equal(order.status, "READY_TO_SHIP");
  });
});

test("a closed shipment rejects further events", async () => {
  await rolledBack(async (tx) => {
    const run = suffix();
    const data = await readyOrder(tx, run);
    const shipment = await createShipment(
      { orderId: data.orderId, actorUserId: data.manager.id },
      tx,
    );
    await addTrackingEvent(
      { shipmentId: shipment.id, status: "RETURNED", actorUserId: data.manager.id },
      tx,
    );
    await assert.rejects(
      addTrackingEvent(
        { shipmentId: shipment.id, status: "IN_TRANSIT", actorUserId: data.manager.id },
        tx,
      ),
      ShippingError,
    );
  });
});

// ---------------------------------------------------------------------------
// Cancellation
// ---------------------------------------------------------------------------

test("a booked shipment can be cancelled and booked again", async () => {
  await rolledBack(async (tx) => {
    const run = suffix();
    const data = await readyOrder(tx, run);
    const first = await createShipment(
      { orderId: data.orderId, actorUserId: data.manager.id },
      tx,
    );

    await cancelShipment(first.id, data.manager.id, "Wrong courier", tx);
    const cancelled = await tx.shipment.findUniqueOrThrow({
      where: { id: first.id },
      select: { status: true },
    });
    assert.equal(cancelled.status, "CANCELLED");

    const second = await createShipment(
      { orderId: data.orderId, actorUserId: data.manager.id },
      tx,
    );
    assert.notEqual(second.id, first.id);
  });
});

test("a picked-up shipment cannot be cancelled", async () => {
  await rolledBack(async (tx) => {
    const run = suffix();
    const data = await readyOrder(tx, run);
    const shipment = await createShipment(
      { orderId: data.orderId, actorUserId: data.manager.id },
      tx,
    );
    await addTrackingEvent(
      { shipmentId: shipment.id, status: "PICKED_UP", actorUserId: data.manager.id },
      tx,
    );
    await assert.rejects(
      cancelShipment(shipment.id, data.manager.id, "Too late", tx),
      ShippingError,
    );
  });
});

// ---------------------------------------------------------------------------
// Couriers and adapters
// ---------------------------------------------------------------------------

test("provider adapters that are not wired refuse to book", async () => {
  for (const provider of ["PATHAO", "STEADFAST", "REDX"] as const) {
    const adapter = getCourierAdapter(provider);
    assert.equal(adapter.isConfigured(), false);
    await assert.rejects(
      adapter.book({
        shipmentNumber: "SHP-TEST",
        orderNumber: "SO-TEST",
        recipientName: "Test",
        recipientMobile: "+8801700000000",
        address: "Road",
        district: "Dhaka",
        division: "Dhaka",
        codAmount: "0.00",
        deliveryCharge: "60.00",
      }),
      CourierError,
    );
  }
});

test("the manual adapter is configured and echoes a tracking number", async () => {
  const adapter = getCourierAdapter("MANUAL");
  assert.equal(adapter.isConfigured(), true);
  const result = await adapter.book({
    shipmentNumber: "SHP-TEST",
    orderNumber: "SO-TEST",
    recipientName: "Test",
    recipientMobile: "+8801700000000",
    address: "Road",
    district: "Dhaka",
    division: "Dhaka",
    codAmount: "0.00",
    deliveryCharge: "60.00",
    trackingNumber: "TRACK-1",
  });
  assert.equal(result.status, "BOOKED");
  assert.equal(result.trackingNumber, "TRACK-1");
});

test("a duplicate courier code is refused", async () => {
  await rolledBack(async (tx) => {
    const run = suffix();
    const courier = await manualCourier(tx, run);
    await assert.rejects(
      createCourier(
        {
          code: courier.code,
          name: "Another",
          provider: "MANUAL",
          supportsCod: true,
          supportsDropship: false,
          isActive: true,
        },
        tx,
      ),
      ShippingError,
    );
  });
});

// ---------------------------------------------------------------------------
// COD remittance
// ---------------------------------------------------------------------------

test("a COD remittance clears the courier clearing account to the bank", async () => {
  await rolledBack(async (tx) => {
    const run = suffix();
    const data = await readyOrder(tx, run);
    const courier = await manualCourier(tx, run);

    const result = await postCodRemittance(
      {
        courierId: courier.id,
        amount: "175.00",
        destination: "BANK",
        reference: `PAYOUT-${run}`,
        actorUserId: data.manager.id,
      },
      tx,
    );

    assert.ok(result.journalEntryId);
    const entry = await tx.journalEntry.findUniqueOrThrow({
      where: { id: result.journalEntryId },
      include: { lines: { include: { account: { select: { code: true } } } } },
    });
    assert.equal(entry.status, "POSTED");
    assert.equal(entry.referenceType, "cod_remittance");
    const byCode = new Map(
      entry.lines.map((line) => [
        line.account.code,
        { debit: line.debit.toFixed(2), credit: line.credit.toFixed(2) },
      ]),
    );
    assert.deepEqual(byCode.get("1010"), { debit: "175.00", credit: "0.00" });
    assert.deepEqual(byCode.get("1060"), { debit: "0.00", credit: "175.00" });
    assert.equal(entry.totalDebit.toFixed(2), entry.totalCredit.toFixed(2));
  });
});

test("a remittance needs a positive amount", async () => {
  await rolledBack(async (tx) => {
    const run = suffix();
    const data = await readyOrder(tx, run);
    const courier = await manualCourier(tx, run);
    await assert.rejects(
      postCodRemittance(
        {
          courierId: courier.id,
          amount: "0",
          destination: "CASH",
          actorUserId: data.manager.id,
        },
        tx,
      ),
      ShippingError,
    );
  });
});
