import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { Prisma } from "../src/generated/prisma/client";
import { prisma } from "../src/lib/db";
import { hashSecret } from "../src/lib/password";
import { postStockMovement } from "../src/lib/inventory/stock";
import { cancelOrder, setOrderStatus } from "../src/lib/orders/service";
import { runAssistant } from "../src/lib/ai/service";
import {
  createAiDraft,
  convertAiDraft,
  runTool,
  type ToolContext,
} from "../src/lib/ai/tools";

/**
 * AI assistant tests.
 *
 * All scenarios run inside one rolled-back transaction, so the real CHECK
 * constraints, stock ledger and journal triggers are exercised without leaving
 * fixtures behind. The assistant is tested at its service boundary: no network
 * provider is contacted; the deterministic local adapter drives the same tools
 * a live model would use.
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

const PERMISSIONS = new Set([
  "ai.read",
  "ai.write",
  "product.read",
  "order.read",
  "order.write",
]);

async function actorId(tx: Prisma.TransactionClient, run: string): Promise<string> {
  const role = await tx.role.findFirstOrThrow({
    where: { code: "OWNER" },
    select: { id: true },
  });
  const actor = await tx.user.create({
    data: {
      email: `ai-${run}@bgd26.test`,
      fullName: "AI test actor",
      passwordHash: await hashSecret(`Ai-${run}-password`),
      status: "ACTIVE",
      userRoles: { create: { roleId: role.id } },
    },
    select: { id: true },
  });
  return actor.id;
}

async function fixture(tx: Prisma.TransactionClient, run: string) {
  const warehouse = await tx.warehouse.findFirstOrThrow({
    where: { isDefault: true, isActive: true },
    select: { id: true },
  });
  const category = await tx.category.create({
    data: {
      name: `AI test ${run}`,
      nameBn: "এআই পরীক্ষা",
      slug: `ai-test-${run}`,
      vatPercentage: "15.00",
    },
    select: { id: true },
  });
  const product = await tx.product.create({
    data: {
      categoryId: category.id,
      name: `AI test product ${run}`,
      slug: `ai-test-product-${run}`,
      basePrice: "115.00",
      status: "ACTIVE",
      isPublished: true,
    },
    select: { id: true },
  });
  const variant = await tx.productVariant.create({
    data: {
      productId: product.id,
      sku: `AI-${run.toUpperCase()}`,
      name: "Default",
      price: "115.00",
      costPrice: "80.0000",
      fulfillmentType: "STOCKED",
    },
    select: { id: true, sku: true },
  });
  const actor = await actorId(tx, run);

  await postStockMovement(tx, {
    variantId: variant.id,
    warehouseId: warehouse.id,
    movementType: "OPENING_BALANCE",
    quantity: "50",
    unitCost: "80",
    referenceType: "test",
    referenceId: run,
    actorUserId: actor,
  });

  const zone = await tx.deliveryZone.create({
    data: {
      name: `AI zone ${run}`,
      division: "Dhaka",
      district: "Dhaka",
      charge: "70.00",
      freeShippingThreshold: "1000.00",
      estimatedDaysMin: 1,
      estimatedDaysMax: 2,
    },
    select: { id: true, name: true },
  });

  return { warehouse, category, product, variant, actor, zone };
}

function context(actor: string, tx: Prisma.TransactionClient): ToolContext {
  return { actorUserId: actor, permissions: PERMISSIONS, tx, conversationLogId: null };
}

async function withEnv<T>(name: string, value: string, work: () => Promise<T>): Promise<T> {
  const previous = process.env[name];
  process.env[name] = value;
  try {
    return await work();
  } finally {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  }
}

test("the local assistant searches live products and logs the tool", async () => {
  const run = suffix();
  await rolledBack(async (tx) => {
    const setup = await fixture(tx, run);
    const result = await runAssistant({
      actorUserId: setup.actor,
      conversationKey: `search-${run}`,
      messages: [{ role: "user", content: `price of ${setup.variant.sku}` }],
      permissions: PERMISSIONS,
      tx,
    });

    assert.equal(result.ok, true);
    assert.equal(result.tools[0]?.name, "search_products");
    assert.equal(result.tools[0]?.status, "SUCCESS");
    assert.match(result.reply, /115\.00/);
    assert.match(result.reply, new RegExp(setup.variant.sku, "i"));

    const logs = await tx.aiActionLog.findMany({
      where: { actorUserId: setup.actor, toolName: "search_products" },
      select: { status: true, riskLevel: true, conversationLogId: true },
    });
    assert.equal(logs.length, 1);
    assert.equal(logs[0]?.status, "SUCCESS");
    assert.equal(logs[0]?.riskLevel, "READ");
    assert.ok(logs[0]?.conversationLogId);

    const conversation = await tx.aiConversationLog.findFirstOrThrow({
      where: { userId: setup.actor },
      select: { messageCount: true, lastMessageAt: true },
    });
    assert.equal(conversation.messageCount, 1);
    assert.ok(conversation.lastMessageAt);
  });
});

test("an order lookup masks the mobile number in the reply and the log", async () => {
  const run = suffix();
  await rolledBack(async (tx) => {
    const setup = await fixture(tx, run);
    const mobile = testMobile(run);
    const customer = await tx.customer.create({
      data: { mobileNormalized: mobile, fullName: `AI customer ${run}` },
      select: { id: true },
    });
    const order = await tx.order.create({
      data: {
        orderNumber: `SO-AI-${run.toUpperCase()}`,
        channel: "ONLINE",
        customerId: customer.id,
        recipientName: `AI customer ${run}`,
        recipientMobile: mobile,
        grandTotal: "115.00",
        subtotal: "100.00",
        vatTotal: "15.00",
        dueAmount: "115.00",
        status: "CONFIRMED",
      },
      select: { id: true, orderNumber: true },
    });

    const result = await runTool(
      "get_order_status",
      { orderNumber: order.orderNumber.toLowerCase() },
      context(setup.actor, tx),
    );
    assert.equal(result.ok, true);
    const data = result.data as { order: { mobileMasked: string; orderNumber: string } };
    assert.equal(data.order.orderNumber, order.orderNumber);
    assert.notEqual(data.order.mobileMasked, mobile);
    assert.match(data.order.mobileMasked, /\*/);

    const log = await tx.aiActionLog.findFirstOrThrow({
      where: { actorUserId: setup.actor, toolName: "get_order_status" },
      select: { output: true, relatedOrderId: true },
    });
    assert.equal(log.relatedOrderId, order.id);
    assert.ok(!JSON.stringify(log.output).includes(mobile));
  });
});

test("delivery quotes read the zone table and apply the free threshold", async () => {
  const run = suffix();
  await rolledBack(async (tx) => {
    const setup = await fixture(tx, run);
    const paid = await runTool(
      "quote_delivery",
      { zone: setup.zone.name, subtotal: 500 },
      context(setup.actor, tx),
    );
    assert.equal(paid.ok, true);
    const paidZones = (paid.data as {
      zones: Array<{ id: string; effectiveCharge: string; isFree: boolean }>;
    }).zones;
    const paidZone = paidZones.find((zone) => zone.id === setup.zone.id);
    assert.ok(paidZone);
    assert.equal(paidZone.effectiveCharge, "70.00");
    assert.equal(paidZone.isFree, false);

    const free = await runTool(
      "quote_delivery",
      { zone: setup.zone.name, subtotal: 1_500 },
      context(setup.actor, tx),
    );
    const freeZone = (free.data as {
      zones: Array<{ id: string; effectiveCharge: string; isFree: boolean }>;
    }).zones.find((zone) => zone.id === setup.zone.id);
    assert.ok(freeZone);
    assert.equal(freeZone.effectiveCharge, "0.00");
    assert.equal(freeZone.isFree, true);
  });
});

test("a draft order is DRAFT only and moves no stock, money or journal", async () => {
  const run = suffix();
  await rolledBack(async (tx) => {
    const setup = await fixture(tx, run);
    const mobile = testMobile(run);
    const ledgerBefore = await tx.stockLedger.count({ where: { variantId: setup.variant.id } });

    const result = await runTool(
      "create_draft_order",
      {
        customerName: `Draft customer ${run}`,
        customerMobile: mobile,
        items: [{ sku: setup.variant.sku, quantity: 2 }],
        deliveryZoneId: setup.zone.id,
        address: "House 1, Road 2",
      },
      context(setup.actor, tx),
    );
    assert.equal(result.ok, true, result.error ?? "draft failed");
    const draft = (result.data as { draft: { id: string; orderNumber: string } }).draft;

    const order = await tx.order.findUniqueOrThrow({
      where: { id: draft.id },
      include: { items: true, payments: true },
    });
    assert.equal(order.status, "DRAFT");
    assert.equal(order.aiDraft, true);
    assert.equal(order.source, "AI_DRAFT");
    assert.equal(order.paymentStatus, "UNPAID");
    assert.equal(order.payments.length, 0);
    assert.equal(order.items.length, 1);
    assert.equal(order.items[0]?.quantity.toString(), "2");
    assert.equal(
      order.grandTotal.toString(),
      order.subtotal
        .add(order.vatTotal)
        .sub(order.discountTotal)
        .add(order.deliveryCharge)
        .sub(order.loyaltyDiscount)
        .toString(),
    );

    assert.equal(
      await tx.stockLedger.count({ where: { variantId: setup.variant.id } }),
      ledgerBefore,
      "a draft never writes the stock ledger",
    );
    assert.equal(
      await tx.journalEntry.count({
        where: { referenceType: "order", referenceId: order.id },
      }),
      0,
    );
  });
});

test("an unknown SKU or invalid mobile is refused without an order", async () => {
  const run = suffix();
  await rolledBack(async (tx) => {
    const setup = await fixture(tx, run);
    const mobile = testMobile(run);
    await assert.rejects(
      createAiDraft(
        {
          customerName: `Bad SKU ${run}`,
          customerMobile: mobile,
          items: [{ sku: `MISSING-${run}`, quantity: 1 }],
          deliveryZoneId: setup.zone.id,
        },
        setup.actor,
        tx,
      ),
      /No active product variant/,
    );
    await assert.rejects(
      createAiDraft(
        {
          customerName: `Bad mobile ${run}`,
          customerMobile: "1234567890",
          items: [{ sku: setup.variant.sku, quantity: 1 }],
          deliveryZoneId: setup.zone.id,
        },
        setup.actor,
        tx,
      ),
      /valid Bangladeshi mobile/,
    );
    assert.equal(
      await tx.order.count({
        where: { customer: { mobileNormalized: mobile } },
      }),
      0,
    );
  });
});

test("draft creation can be switched off and then logs BLOCKED", async () => {
  const run = suffix();
  await rolledBack(async (tx) => {
    const setup = await fixture(tx, run);
    await withEnv("AI_DRAFT_ORDERS_ENABLED", "false", async () => {
      const result = await runTool(
        "create_draft_order",
        {
          customerName: `Disabled ${run}`,
          customerMobile: testMobile(run),
          items: [{ sku: setup.variant.sku, quantity: 1 }],
          deliveryZoneId: setup.zone.id,
        },
        context(setup.actor, tx),
      );
      assert.equal(result.ok, false);
      assert.equal(result.status, "BLOCKED");
    });
    const log = await tx.aiActionLog.findFirstOrThrow({
      where: { actorUserId: setup.actor, toolName: "create_draft_order" },
      select: { status: true, riskLevel: true },
    });
    assert.equal(log.status, "BLOCKED");
    assert.equal(log.riskLevel, "DRAFT");
  });
});

test("converting a draft creates a real sale, reserves stock and posts a journal", async () => {
  const run = suffix();
  await rolledBack(async (tx) => {
    const setup = await fixture(tx, run);
    const draft = await createAiDraft(
      {
        customerName: `Convert ${run}`,
        customerMobile: testMobile(run),
        items: [{ sku: setup.variant.sku, quantity: 3 }],
        deliveryZoneId: setup.zone.id,
      },
      setup.actor,
      tx,
    );
    const stockBefore = await tx.inventoryBalance.findFirstOrThrow({
      where: { variantId: setup.variant.id },
      select: { availableQty: true },
    });

    const sale = await convertAiDraft(
      {
        draftOrderId: draft.id,
        paymentMethod: "COD",
        actorUserId: setup.actor,
      },
      tx,
    );

    const order = await tx.order.findUniqueOrThrow({
      where: { id: sale.orderId },
      include: { payments: true, items: true },
    });
    assert.equal(order.status, "CONFIRMED");
    assert.equal(order.paymentStatus, "PENDING_VERIFICATION");
    assert.equal(order.aiDraft, false);
    assert.equal(order.source, "ADMIN");
    assert.equal(order.items[0]?.quantity.toString(), "3");
    assert.equal(order.payments.length, 1);
    assert.equal(order.payments[0]?.status, "PENDING_VERIFICATION");
    assert.equal(order.payments[0]?.method, "COD");

    const stockAfter = await tx.inventoryBalance.findFirstOrThrow({
      where: { variantId: setup.variant.id },
      select: { availableQty: true },
    });
    assert.equal(
      Number(stockBefore.availableQty) - Number(stockAfter.availableQty),
      3,
    );

    const ledger = await tx.stockLedger.findFirstOrThrow({
      where: { referenceType: "order", referenceId: sale.orderId, movementType: "SALE" },
      select: { quantity: true },
    });
    assert.equal(ledger.quantity.toString(), "-3");

    const journal = await tx.journalEntry.findFirstOrThrow({
      where: { referenceType: "order", referenceId: sale.orderId },
      include: { lines: true },
    });
    assert.equal(journal.status, "POSTED");
    const debit = journal.lines.reduce(
      (sum, line) => sum.add(line.debit),
      new Prisma.Decimal(0),
    );
    const credit = journal.lines.reduce(
      (sum, line) => sum.add(line.credit),
      new Prisma.Decimal(0),
    );
    assert.equal(debit.toString(), credit.toString());

    const cancelledDraft = await tx.order.findUniqueOrThrow({
      where: { id: draft.id },
      select: { status: true, cancelReason: true, aiDraft: true },
    });
    assert.equal(cancelledDraft.status, "CANCELLED");
    assert.equal(cancelledDraft.aiDraft, true);
    assert.match(cancelledDraft.cancelReason ?? "", new RegExp(sale.orderNumber));
  });
});

test("cancelling a draft does not put phantom stock back on the shelf", async () => {
  const run = suffix();
  await rolledBack(async (tx) => {
    const setup = await fixture(tx, run);
    const draft = await createAiDraft(
      {
        customerName: `Cancel ${run}`,
        customerMobile: testMobile(run),
        items: [{ sku: setup.variant.sku, quantity: 2 }],
        deliveryZoneId: setup.zone.id,
      },
      setup.actor,
      tx,
    );
    const ledgerBefore = await tx.stockLedger.count({
      where: { referenceType: "order", referenceId: draft.id },
    });

    await cancelOrder(draft.id, setup.actor, "Draft no longer needed", tx);

    assert.equal(
      await tx.stockLedger.count({
        where: { referenceType: "order", referenceId: draft.id },
      }),
      ledgerBefore,
    );
    assert.equal(
      await tx.stockLedger.count({
        where: { referenceId: draft.id, movementType: "SALE_RETURN" },
      }),
      0,
    );
    const cancelled = await tx.order.findUniqueOrThrow({
      where: { id: draft.id },
      select: { status: true },
    });
    assert.equal(cancelled.status, "CANCELLED");
  });
});

test("an AI draft cannot be confirmed without going through the sale path", async () => {
  const run = suffix();
  await rolledBack(async (tx) => {
    const setup = await fixture(tx, run);
    const draft = await createAiDraft(
      {
        customerName: `Confirm ${run}`,
        customerMobile: testMobile(run),
        items: [{ sku: setup.variant.sku, quantity: 1 }],
        deliveryZoneId: setup.zone.id,
      },
      setup.actor,
      tx,
    );
    await assert.rejects(
      setOrderStatus(draft.id, "CONFIRMED", setup.actor, undefined, tx),
      /Convert it to a sale/,
    );
  });
});

test("the hourly request limit degrades to a human handover", async () => {
  const run = suffix();
  await rolledBack(async (tx) => {
    const setup = await fixture(tx, run);
    await withEnv("AI_REQUESTS_PER_HOUR", "1", async () => {
      const first = await runAssistant({
        actorUserId: setup.actor,
        conversationKey: `rate-${run}`,
        messages: [{ role: "user", content: `price of ${setup.variant.sku}` }],
        permissions: PERMISSIONS,
        tx,
      });
      assert.equal(first.ok, true);

      const second = await runAssistant({
        actorUserId: setup.actor,
        conversationKey: `rate-${run}`,
        messages: [{ role: "user", content: `price of ${setup.variant.sku}` }],
        permissions: PERMISSIONS,
        tx,
      });
      assert.equal(second.ok, false);
      assert.equal(second.handover, true);
      assert.match(second.reply, /hourly limit/);
    });
  });
});

test("the hourly draft cap blocks the next draft and records the block", async () => {
  const run = suffix();
  await rolledBack(async (tx) => {
    const setup = await fixture(tx, run);
    await withEnv("AI_MAX_DRAFTS_PER_HOUR", "1", async () => {
      const input = {
        customerName: `Cap ${run}`,
        customerMobile: testMobile(run),
        items: [{ sku: setup.variant.sku, quantity: 1 }],
        deliveryZoneId: setup.zone.id,
      };
      const first = await runTool("create_draft_order", input, context(setup.actor, tx));
      assert.equal(first.ok, true, first.error ?? "draft failed");

      const second = await runTool("create_draft_order", input, context(setup.actor, tx));
      assert.equal(second.ok, false);
      assert.equal(second.status, "BLOCKED");
    });
  });
});

test("an unknown tool is refused and logged as blocked", async () => {
  const run = suffix();
  await rolledBack(async (tx) => {
    const setup = await fixture(tx, run);
    const result = await runTool("delete_everything", {}, context(setup.actor, tx));
    assert.equal(result.ok, false);
    assert.equal(result.status, "BLOCKED");
    const log = await tx.aiActionLog.findFirstOrThrow({
      where: { actorUserId: setup.actor, toolName: "delete_everything" },
      select: { status: true, riskLevel: true },
    });
    assert.equal(log.status, "BLOCKED");
    assert.equal(log.riskLevel, "READ");
  });
});
