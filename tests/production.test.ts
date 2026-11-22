import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { Prisma } from "../src/generated/prisma/client";
import { prisma } from "../src/lib/db";
import { ACCOUNTS } from "../src/lib/accounting/journal";
import { postStockMovement } from "../src/lib/inventory/stock";
import {
  addComponent,
  addDesignRevision,
  approveDesign,
  createProductionJob,
  issueComponents,
  productionWipValue,
  removeComponent,
  requestDesignChanges,
  sendDesignForApproval,
  transitionProduction,
} from "../src/lib/production/service";

/**
 * Engraving production tests.
 *
 * Every scenario runs inside one transaction that is rolled back. The stock
 * ledger and journals are append-only at the database level, so a job cannot be
 * deleted; rolling back keeps the development database clean while exercising
 * the real SQL, AVCO, row locks and the deferred balance trigger.
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

type Fixture = Awaited<ReturnType<typeof fixture>>;

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
      name: `Production test ${run}`,
      nameBn: "উৎপাদন পরীক্ষা",
      slug: `production-test-${run}`,
      vatPercentage: "0.00",
    },
    select: { id: true },
  });

  const product = await tx.product.create({
    data: {
      categoryId: category.id,
      name: `Engraved product ${run}`,
      slug: `engraved-product-${run}`,
      basePrice: "1000.00",
      status: "ACTIVE",
      isPublished: false,
    },
    select: { id: true },
  });

  const finished = await tx.productVariant.create({
    data: {
      productId: product.id,
      sku: `FIN-${run.toUpperCase()}`,
      name: "Finished",
      price: "1000.00",
      costPrice: "0.0000",
      fulfillmentType: "STOCKED",
    },
    select: { id: true, sku: true },
  });

  const component = await tx.productVariant.create({
    data: {
      productId: product.id,
      sku: `CMP-${run.toUpperCase()}`,
      name: "Component",
      price: "0.00",
      costPrice: "80.0000",
      fulfillmentType: "STOCKED",
      isDefault: false,
    },
    select: { id: true, sku: true },
  });

  // Opening stock for the component at ৳80 each, so AVCO is known.
  await postStockMovement(tx, {
    variantId: component.id,
    warehouseId: warehouse.id,
    storeId: store.id,
    movementType: "OPENING_BALANCE",
    quantity: "10",
    unitCost: "80",
    referenceType: "test",
    referenceId: run,
    actorUserId: actor,
  });

  const customer = await tx.customer.create({
    data: {
      mobileNormalized: `+8801${String(Date.now()).slice(-9)}`,
      fullName: `Production customer ${run}`,
    },
    select: { id: true },
  });

  const order = await tx.order.create({
    data: {
      orderNumber: `PT-${run.toUpperCase()}`,
      channel: "ONLINE",
      status: "CONFIRMED",
      source: "ADMIN",
      customerId: customer.id,
      storeId: store.id,
      warehouseId: warehouse.id,
      recipientName: `Production customer ${run}`,
      recipientMobile: `+8801${String(Date.now()).slice(-9)}`,
      subtotal: "1000.00",
      grandTotal: "1000.00",
      paidAmount: "1000.00",
      paymentStatus: "PAID",
      items: {
        create: [
          {
            variantId: finished.id,
            productId: product.id,
            productNameSnapshot: `Engraved product ${run}`,
            variantNameSnapshot: "Finished",
            skuSnapshot: finished.sku,
            unitPrice: "1000.00",
            costPriceSnapshot: "0.0000",
            vatPercentageSnapshot: "0.00",
            vatAmount: "0.00",
            lineSubtotal: "1000.00",
            lineTotal: "1000.00",
            quantity: "1",
            fulfillmentType: "STOCKED",
          },
          {
            variantId: finished.id,
            productId: product.id,
            productNameSnapshot: `Engraved product ${run}`,
            variantNameSnapshot: "Second unit",
            skuSnapshot: `${finished.sku}-B`,
            unitPrice: "1000.00",
            costPriceSnapshot: "0.0000",
            vatPercentageSnapshot: "0.00",
            vatAmount: "0.00",
            lineSubtotal: "1000.00",
            lineTotal: "1000.00",
            quantity: "1",
            fulfillmentType: "STOCKED",
          },
        ],
      },
    },
    select: { id: true, items: { select: { id: true } } },
  });

  return {
    actor,
    warehouse,
    store,
    finished,
    component,
    order,
    orderItemId: order.items[0]!.id,
    secondItemId: order.items[1]!.id,
  };
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

/** Take a job from creation to an approved design with components attached. */
async function approvedJob(
  tx: Prisma.TransactionClient,
  data: Fixture,
  quantity = "2",
) {
  const job = await createProductionJob(
    {
      orderItemId: data.orderItemId,
      engravingText: "Ayesha · 2026",
      fontName: "Serif",
      components: [{ variantId: data.component.id, quantity }],
      actorUserId: data.actor,
    },
    tx,
  );

  await addDesignRevision(
    job.id,
    { description: "First proof", previewUrl: "https://example.test/proof-1.png" },
    data.actor,
    tx,
  );
  await sendDesignForApproval(job.id, data.actor, tx);
  await approveDesign(job.id, data.actor, "Customer approved by phone", tx);

  return job;
}

test("a job is raised for one order line and a second live job is refused", async () => {
  const run = suffix();

  await rolledBack(async (tx) => {
    const data = await fixture(tx, run);

    const job = await createProductionJob(
      {
        orderItemId: data.orderItemId,
        priority: "HIGH",
        engravingText: "Ayesha · 2026",
        fontName: "Serif",
        designNotes: "Use the wider spacing from the sample.",
        components: [
          { variantId: data.component.id, quantity: "2" },
          { variantId: data.component.id, quantity: "1" },
        ],
        actorUserId: data.actor,
      },
      tx,
    );

    const stored = await tx.productionJob.findUniqueOrThrow({
      where: { id: job.id },
      select: {
        status: true,
        priority: true,
        designNotes: true,
        orderId: true,
        warehouseId: true,
        items: { select: { quantityRequired: true } },
      },
    });
    assert.equal(stored.status, "PENDING_DESIGN");
    assert.equal(stored.priority, "HIGH");
    assert.equal(stored.orderId, data.order.id);
    assert.equal(stored.warehouseId, data.warehouse.id);
    // Repeated component lines merge into one requirement.
    assert.equal(stored.items.length, 1);
    assert.equal(stored.items[0]?.quantityRequired.toString(), "3");

    const item = await tx.orderItem.findUniqueOrThrow({
      where: { id: data.orderItemId },
      select: {
        productionRequired: true,
        productionStatus: true,
        customizationRequired: true,
        customizations: { select: { type: true, textContent: true, fontName: true } },
      },
    });
    assert.equal(item.productionRequired, true);
    assert.equal(item.productionStatus, "PENDING_DESIGN");
    assert.equal(item.customizationRequired, true);
    assert.equal(item.customizations[0]?.type, "ENGRAVING");
    assert.equal(item.customizations[0]?.textContent, "Ayesha · 2026");
    assert.equal(item.customizations[0]?.fontName, "Serif");

    const order = await tx.order.findUniqueOrThrow({
      where: { id: data.order.id },
      select: { requiresProduction: true },
    });
    assert.equal(order.requiresProduction, true);

    await assert.rejects(
      () =>
        createProductionJob(
          { orderItemId: data.orderItemId, actorUserId: data.actor },
          tx,
        ),
      /already has a live job/i,
    );

    // A job cannot consume the variant it produces.
    await assert.rejects(
      () =>
        createProductionJob(
          {
            orderItemId: data.secondItemId,
            components: [{ variantId: data.finished.id, quantity: "1" }],
            actorUserId: data.actor,
          },
          tx,
        ),
      /same variant/i,
    );
  });
});

test("design revisions move the job to approval and approval unlocks production", async () => {
  const run = suffix();

  await rolledBack(async (tx) => {
    const data = await fixture(tx, run);

    const job = await createProductionJob(
      {
        orderItemId: data.orderItemId,
        engravingText: "Ayesha · 2026",
        actorUserId: data.actor,
      },
      tx,
    );
    assert.equal(
      (await tx.productionJob.findUniqueOrThrow({ where: { id: job.id } })).status,
      "PENDING_DESIGN",
    );

    // No revision means nothing to send.
    await assert.rejects(
      () => sendDesignForApproval(job.id, data.actor, tx),
      /only a job in design/i,
    );

    const first = await addDesignRevision(
      job.id,
      { description: "First proof" },
      data.actor,
      tx,
    );
    assert.equal(first.revisionNumber, 1);
    assert.equal(
      (await tx.productionJob.findUniqueOrThrow({ where: { id: job.id } })).status,
      "DESIGN_PREPARATION",
    );

    await sendDesignForApproval(job.id, data.actor, tx);
    assert.equal(
      (await tx.productionJob.findUniqueOrThrow({ where: { id: job.id } })).status,
      "AWAITING_CUSTOMER_APPROVAL",
    );

    await requestDesignChanges(job.id, "Move the date lower", data.actor, tx);
    assert.equal(
      (await tx.productionJob.findUniqueOrThrow({ where: { id: job.id } })).status,
      "DESIGN_PREPARATION",
    );

    const second = await addDesignRevision(
      job.id,
      { description: "Second proof, date moved", previewUrl: "https://example.test/p2.png" },
      data.actor,
      tx,
    );
    assert.equal(second.revisionNumber, 2);

    await sendDesignForApproval(job.id, data.actor, tx);
    await approveDesign(job.id, data.actor, "Approved on the phone", tx);

    const stored = await tx.productionJob.findUniqueOrThrow({
      where: { id: job.id },
      select: {
        status: true,
        designApprovals: { select: { status: true, notes: true } },
        orderItem: {
          select: {
            productionStatus: true,
            customizations: { select: { status: true, approvedAt: true } },
          },
        },
      },
    });
    assert.equal(stored.status, "APPROVED");
    assert.equal(stored.orderItem.productionStatus, "APPROVED");
    assert.equal(stored.designApprovals[0]?.status, "APPROVED");
    assert.equal(stored.designApprovals[0]?.notes, "Approved on the phone");
    assert.equal(stored.orderItem.customizations[0]?.status, "APPROVED");
    assert.ok(stored.orderItem.customizations[0]?.approvedAt);

    // The design cannot be approved twice, and a revision cannot be added
    // once production is approved.
    await assert.rejects(
      () => approveDesign(job.id, data.actor, undefined, tx),
      /only a job awaiting approval/i,
    );
    await assert.rejects(
      () => addDesignRevision(job.id, { description: "Late" }, data.actor, tx),
      /already approved/i,
    );
  });
});

test("issuing components moves stock at average cost into work in progress", async () => {
  const run = suffix();

  await rolledBack(async (tx) => {
    const data = await fixture(tx, run);
    const job = await approvedJob(tx, data, "2");

    // Production is blocked until every component is issued.
    await assert.rejects(
      () => transitionProduction(job.id, "PRODUCTION", data.actor, undefined, tx),
      /issue all components first/i,
    );

    const opening = await balanceAt(tx, data.component.id, data.warehouse.id);
    assert.equal(opening.physicalQty.toString(), "10");

    const issued = await issueComponents(job.id, data.actor, tx);
    await tx.$executeRawUnsafe("SET CONSTRAINTS ALL IMMEDIATE");

    assert.equal(issued.issued.toString(), "160");
    assert.ok(issued.journalEntryId);

    const balance = await balanceAt(tx, data.component.id, data.warehouse.id);
    assert.equal(balance.physicalQty.toString(), "8");
    assert.equal(balance.availableQty.toString(), "8");
    assert.equal(balance.avcoUnitCost.toString(), "80");

    const movement = await tx.stockLedger.findFirstOrThrow({
      where: { referenceType: "production_job", referenceId: job.id },
      select: { movementType: true, quantity: true, totalValue: true, unitCost: true },
    });
    assert.equal(movement.movementType, "PRODUCTION_ISSUE");
    assert.equal(movement.quantity.toString(), "-2");
    assert.equal(movement.totalValue.toString(), "-160");
    assert.equal(movement.unitCost?.toString(), "80");

    const lines = await journalLines(tx, issued.journalEntryId!);
    const wip = lines.find((line) => line.account.code === ACCOUNTS.wip);
    const inventory = lines.find((line) => line.account.code === ACCOUNTS.inventory);
    assert.equal(wip?.debit.toString(), "160");
    assert.equal(inventory?.credit.toString(), "160");

    assert.equal((await productionWipValue(job.id, tx)).toString(), "160");

    const item = await tx.productionJobItem.findFirstOrThrow({
      where: { jobId: job.id },
      select: { quantityRequired: true, quantityIssued: true, quantityConsumed: true, unitCost: true },
    });
    assert.equal(item.quantityIssued.toString(), "2");
    assert.equal(item.quantityConsumed.toString(), "2");
    assert.equal(item.unitCost?.toString(), "80");

    // Issuing again is idempotent: there is nothing outstanding.
    const again = await issueComponents(job.id, data.actor, tx);
    assert.equal(again.issued.toString(), "0");
    assert.equal(again.journalEntryId, null);

    await transitionProduction(job.id, "PRODUCTION", data.actor, undefined, tx);
    assert.equal(
      (await tx.productionJob.findUniqueOrThrow({ where: { id: job.id } })).status,
      "PRODUCTION",
    );
  });
});

test("completing a job expenses work in progress to cost of goods sold", async () => {
  const run = suffix();

  await rolledBack(async (tx) => {
    const data = await fixture(tx, run);
    const job = await approvedJob(tx, data, "3");
    await issueComponents(job.id, data.actor, tx);
    await tx.$executeRawUnsafe("SET CONSTRAINTS ALL IMMEDIATE");

    await transitionProduction(job.id, "PRODUCTION", data.actor, undefined, tx);
    await transitionProduction(job.id, "QUALITY_CHECK", data.actor, "Passed inspection", tx);
    await transitionProduction(job.id, "READY_TO_SHIP", data.actor, undefined, tx);
    const completed = await transitionProduction(
      job.id,
      "COMPLETED",
      data.actor,
      "Handed to dispatch",
      tx,
    );
    await tx.$executeRawUnsafe("SET CONSTRAINTS ALL IMMEDIATE");

    assert.ok(completed.journalEntryId);
    assert.equal((await productionWipValue(job.id, tx)).toString(), "0");

    const stored = await tx.productionJob.findUniqueOrThrow({
      where: { id: job.id },
      select: { status: true, completedAt: true },
    });
    assert.equal(stored.status, "COMPLETED");
    assert.ok(stored.completedAt);

    const lines = await journalLines(tx, completed.journalEntryId!);
    const cogs = lines.find((line) => line.account.code === ACCOUNTS.cogs);
    const wip = lines.find((line) => line.account.code === ACCOUNTS.wip);
    assert.equal(cogs?.debit.toString(), "240");
    assert.equal(wip?.credit.toString(), "240");

    // A completed job is terminal.
    await assert.rejects(
      () => transitionProduction(job.id, "PRODUCTION", data.actor, undefined, tx),
      /cannot move to/i,
    );
  });
});

test("cancelling after issue returns components to stock and clears work in progress", async () => {
  const run = suffix();

  await rolledBack(async (tx) => {
    const data = await fixture(tx, run);
    const job = await approvedJob(tx, data, "4");
    await issueComponents(job.id, data.actor, tx);
    await tx.$executeRawUnsafe("SET CONSTRAINTS ALL IMMEDIATE");
    assert.equal((await productionWipValue(job.id, tx)).toString(), "320");

    const cancelled = await transitionProduction(
      job.id,
      "CANCELLED",
      data.actor,
      "Customer cancelled the order",
      tx,
    );
    await tx.$executeRawUnsafe("SET CONSTRAINTS ALL IMMEDIATE");

    assert.equal(cancelled.status, "CANCELLED");
    assert.ok(cancelled.journalEntryId);
    assert.equal((await productionWipValue(job.id, tx)).toString(), "0");

    const balance = await balanceAt(tx, data.component.id, data.warehouse.id);
    assert.equal(balance.physicalQty.toString(), "10");
    assert.equal(balance.availableQty.toString(), "10");

    const returned = await tx.stockLedger.findFirstOrThrow({
      where: {
        referenceType: "production_job",
        referenceId: job.id,
        movementType: "PRODUCTION_RETURN",
      },
      select: { quantity: true, totalValue: true },
    });
    assert.equal(returned.quantity.toString(), "4");
    assert.equal(returned.totalValue.toString(), "320");

    const lines = await journalLines(tx, cancelled.journalEntryId!);
    const inventory = lines.find((line) => line.account.code === ACCOUNTS.inventory);
    const wip = lines.find((line) => line.account.code === ACCOUNTS.wip);
    assert.equal(inventory?.debit.toString(), "320");
    assert.equal(wip?.credit.toString(), "320");

    const item = await tx.orderItem.findUniqueOrThrow({
      where: { id: data.orderItemId },
      select: { productionStatus: true },
    });
    assert.equal(item.productionStatus, "CANCELLED");

    // A cancelled job is terminal and cannot be revived.
    await assert.rejects(
      () => transitionProduction(job.id, "APPROVED", data.actor, undefined, tx),
      /cannot move to/i,
    );
  });
});

test("a component can be added and removed before anything is issued", async () => {
  const run = suffix();

  await rolledBack(async (tx) => {
    const data = await fixture(tx, run);
    const job = await createProductionJob(
      { orderItemId: data.orderItemId, actorUserId: data.actor },
      tx,
    );

    const added = await addComponent(
      job.id,
      { variantId: data.component.id, quantity: "2.5" },
      tx,
    );
    assert.equal(added.quantityRequired.toString(), "2.5");

    await assert.rejects(
      () => addComponent(job.id, { variantId: data.finished.id, quantity: "1" }, tx),
      /same variant/i,
    );

    await removeComponent(job.id, added.id, tx);
    assert.equal(await tx.productionJobItem.count({ where: { jobId: job.id } }), 0);

    assert.equal((await productionWipValue(job.id, tx)).toString(), "0");
  });
});
