/**
 * End-to-end purchasing verification.
 *
 *   npm run build
 *   STORAGE_PROVIDER=local npm start     # in another terminal
 *   npm run verify:purchasing
 *
 * Point it elsewhere with BASE_URL=http://localhost:3100 npm run verify:purchasing
 *
 * Proves over real HTTP: supplier and purchase-order screens, receiving a
 * purchase order in three goods receipts (partial, damaged, final), landed cost
 * entering AVCO, the append-only ledger, permission separation for an accountant
 * and a cashier, and the immutable posted receipt.
 *
 * The stock ledger cannot be deleted by design, so the verification variant is
 * archived, the supplier deactivated and the warehouse deactivated; their
 * history is retained.
 */
import { config } from "dotenv";
config({ path: [".env.local", ".env"], quiet: true });

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { prisma } from "../src/lib/db";
import { SESSION_VERSION, signSessionToken } from "../src/lib/auth/token";
import {
  createGrn,
  createPurchaseOrder,
  postGrn,
  sendPurchaseOrder,
} from "../src/lib/purchasing/service";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const COOKIE = process.env.SESSION_COOKIE_NAME?.trim() || "bgd26_session";

const VERIFY_WAREHOUSE_CODE = "VERIFY-PUR";
const VERIFY_SUPPLIER_CODE = "VERIFY-SUP";

let failures = 0;
let checks = 0;

async function check(label: string, run: () => Promise<void>): Promise<void> {
  checks += 1;
  try {
    await run();
    console.log(`ok   ${label}`);
  } catch (error) {
    failures += 1;
    console.log(`FAIL ${label}\n     ${(error as Error).message}`);
  }
}

function sessionCookie(user: { id: string; email: string }): string {
  const now = Math.floor(Date.now() / 1000);
  const token = signSessionToken({
    v: SESSION_VERSION,
    userId: user.id,
    email: user.email,
    provider: "local",
    issuedAt: now,
    expiresAt: now + 3600,
  });
  return `${COOKIE}=${token}`;
}

async function get(path: string, cookie?: string) {
  const response = await fetch(`${BASE}${path}`, {
    redirect: "manual",
    headers: cookie ? { cookie } : undefined,
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  return {
    status: response.status,
    location: response.headers.get("location") ?? "",
    headers: response.headers,
    text: bytes.toString("utf8"),
  };
}

const run = randomBytes(4).toString("hex");

const [ownerRole, accountantRole, cashierRole, category] = await Promise.all([
  prisma.role.findUniqueOrThrow({ where: { code: "OWNER" }, select: { id: true } }),
  prisma.role.findUniqueOrThrow({ where: { code: "ACCOUNTANT" }, select: { id: true } }),
  prisma.role.findUniqueOrThrow({ where: { code: "CASHIER" }, select: { id: true } }),
  prisma.category.findFirstOrThrow({ orderBy: { sortOrder: "asc" }, select: { id: true } }),
]);

const [owner, accountant, cashier] = await Promise.all([
  prisma.user.create({
    data: {
      email: `verify-purchasing-owner-${run}@example.test`,
      fullName: "Verify Purchasing Owner",
      status: "ACTIVE",
      mustChangePassword: false,
      userRoles: { create: [{ roleId: ownerRole.id }] },
    },
    select: { id: true, email: true },
  }),
  prisma.user.create({
    data: {
      email: `verify-purchasing-accountant-${run}@example.test`,
      fullName: "Verify Purchasing Accountant",
      status: "ACTIVE",
      mustChangePassword: false,
      userRoles: { create: [{ roleId: accountantRole.id }] },
    },
    select: { id: true, email: true },
  }),
  prisma.user.create({
    data: {
      email: `verify-purchasing-cashier-${run}@example.test`,
      fullName: "Verify Purchasing Cashier",
      status: "ACTIVE",
      mustChangePassword: false,
      userRoles: { create: [{ roleId: cashierRole.id }] },
    },
    select: { id: true, email: true },
  }),
]);

const supplier = await prisma.supplier.upsert({
  where: { code: VERIFY_SUPPLIER_CODE },
  update: {
    status: "ACTIVE",
    name: "Verify purchasing supplier",
    mobileNormalized: "+8801700000000",
  },
  create: {
    code: VERIFY_SUPPLIER_CODE,
    name: "Verify purchasing supplier",
    mobileNormalized: "+8801700000000",
    paymentTermsDays: 15,
    leadTimeDays: 3,
    status: "ACTIVE",
  },
  select: { id: true, code: true, name: true },
});

const product = await prisma.product.upsert({
  where: { slug: "verify-purchasing" },
  update: { status: "ACTIVE", isPublished: false },
  create: {
    categoryId: category.id,
    sku: "VERIFY-PUR",
    name: "Verify purchasing product",
    slug: "verify-purchasing",
    status: "ACTIVE",
    isPublished: false,
    basePrice: "200.00",
  },
  select: { id: true },
});

const variant = await prisma.productVariant.create({
  data: {
    productId: product.id,
    sku: `VERIFY-PUR-${run.toUpperCase()}`,
    name: `Verification run ${run}`,
    price: "200.00",
    costPrice: "0.0000",
    fulfillmentType: "STOCKED",
    // Earlier verification runs keep their archived variants.
    isDefault: false,
    status: "ACTIVE",
  },
  select: { id: true, sku: true },
});

const warehouse = await prisma.warehouse.upsert({
  where: { code: VERIFY_WAREHOUSE_CODE },
  update: { isActive: true },
  create: {
    code: VERIFY_WAREHOUSE_CODE,
    name: "Verify purchasing warehouse",
    type: "SECONDARY",
    isActive: true,
  },
  select: { id: true, code: true },
});

const order = await createPurchaseOrder({
  supplierId: supplier.id,
  warehouseId: warehouse.id,
  notes: "Verification purchase order",
  lines: [{ variantId: variant.id, quantity: "10", unitCost: "100" }],
});
await sendPurchaseOrder(order.id, owner.id);

const item = await prisma.purchaseItem.findFirstOrThrow({
  where: { purchaseOrderId: order.id },
  select: { id: true },
});

const partial = await createGrn({
  purchaseOrderId: order.id,
  notes: "Verification first delivery: four units",
  lines: [{ purchaseItemId: item.id, quantity: "4", unitCost: "100", condition: "GOOD" }],
});
await postGrn(partial.id, owner.id);

const damaged = await createGrn({
  purchaseOrderId: order.id,
  notes: "Verification second delivery: two damaged units",
  lines: [
    {
      purchaseItemId: item.id,
      quantity: "2",
      unitCost: "100",
      condition: "DAMAGED",
      batchNumber: `VERIFY-BATCH-${run.toUpperCase()}`,
    },
  ],
});
await postGrn(damaged.id, owner.id);

const final = await createGrn({
  purchaseOrderId: order.id,
  notes: "Verification final delivery at a higher landed cost",
  lines: [{ purchaseItemId: item.id, quantity: "4", unitCost: "150", condition: "GOOD" }],
});
await postGrn(final.id, owner.id);

const ownerCookie = sessionCookie(owner);
const accountantCookie = sessionCookie(accountant);
const cashierCookie = sessionCookie(cashier);

try {
  await check("partial, damaged and final receipts produced the expected stock and AVCO", async () => {
    const balance = await prisma.inventoryBalance.findUniqueOrThrow({
      where: {
        variantId_warehouseId: { variantId: variant.id, warehouseId: warehouse.id },
      },
    });
    assert.equal(balance.physicalQty.toString(), "10");
    assert.equal(balance.availableQty.toString(), "8");
    assert.equal(balance.damagedQty.toString(), "2");
    // (4 × 100 + 2 × 100 + 4 × 150) / 10 = 120
    assert.equal(balance.avcoUnitCost.toString(), "120");

    const stored = await prisma.purchaseOrder.findUniqueOrThrow({
      where: { id: order.id },
      include: { items: { select: { receivedQty: true, quantity: true } } },
    });
    assert.equal(stored.status, "RECEIVED");
    assert.equal(stored.items[0]?.receivedQty.toString(), "10");
    assert.equal(stored.items[0]?.quantity.toString(), "10");

    const receipts = await prisma.goodsReceivedNote.findMany({
      where: { purchaseOrderId: order.id },
      orderBy: { createdAt: "asc" },
      select: { status: true, totalValue: true },
    });
    assert.deepEqual(
      receipts.map((receipt) => receipt.status),
      ["POSTED", "POSTED", "POSTED"],
    );
    assert.deepEqual(
      receipts.map((receipt) => receipt.totalValue.toString()),
      ["400", "200", "600"],
    );

    const ledger = await prisma.stockLedger.findMany({
      where: { variantId: variant.id },
      orderBy: { createdAt: "asc" },
      select: { movementType: true, quantity: true, unitCost: true },
    });
    assert.deepEqual(
      ledger.map((entry) => entry.movementType),
      ["PURCHASE_RECEIPT", "PURCHASE_RECEIPT", "DAMAGE", "PURCHASE_RECEIPT"],
    );
    assert.deepEqual(
      ledger.map((entry) => entry.quantity.toString()),
      ["4", "2", "-2", "4"],
    );
    assert.equal(ledger[0]?.unitCost.toString(), "100");
    assert.equal(ledger[3]?.unitCost.toString(), "150");
  });

  await check("anonymous visitors are redirected from purchasing", async () => {
    for (const path of ["/purchases", "/suppliers"]) {
      const response = await get(path);
      assert.ok([302, 303, 307, 308].includes(response.status), `${path} ${response.status}`);
      assert.match(response.location, /\/login/);
    }
  });

  await check("owner sees every purchasing screen", async () => {
    for (const path of [
      "/purchases",
      "/purchases/new",
      `/purchases/${order.id}`,
      `/purchases/${order.id}/receive`,
      "/purchases/grn",
      `/purchases/grn/${partial.id}`,
      `/purchases/grn/${damaged.id}`,
      `/purchases/grn/${final.id}`,
      "/suppliers",
      "/suppliers/new",
      `/suppliers/${supplier.id}`,
    ]) {
      const response = await get(path, ownerCookie);
      assert.equal(response.status, 200, `${path} returned ${response.status}`);
    }
  });

  await check("the purchase order shows lines, totals and its posted receipts", async () => {
    const response = await get(`/purchases/${order.id}`, ownerCookie);
    assert.equal(response.status, 200);
    assert.match(response.text, new RegExp(order.poNumber));
    assert.match(response.text, /RECEIVED/);
    assert.match(response.text, new RegExp(variant.sku));
    assert.match(response.text, /10(<!-- -->)? ordered/);
    assert.match(response.text, /10(<!-- -->)? received/);
    assert.match(response.text, /Grand total/);
    assert.match(response.text, /Goods receipts/);
  });

  await check("each goods receipt shows its condition, landed cost and ledger rows", async () => {
    const partialPage = await get(`/purchases/grn/${partial.id}`, ownerCookie);
    assert.equal(partialPage.status, 200);
    assert.match(partialPage.text, new RegExp(partial.grnNumber));
    assert.match(partialPage.text, /posted/);
    assert.match(partialPage.text, /PURCHASE_RECEIPT/);
    assert.match(partialPage.text, /Receipt value/);

    const damagedPage = await get(`/purchases/grn/${damaged.id}`, ownerCookie);
    assert.equal(damagedPage.status, 200);
    assert.match(damagedPage.text, /damaged/i);
    assert.match(damagedPage.text, /DAMAGE/);
    assert.match(damagedPage.text, new RegExp(`VERIFY-BATCH-${run.toUpperCase()}`));

    const finalPage = await get(`/purchases/grn/${final.id}`, ownerCookie);
    assert.equal(finalPage.status, 200);
    assert.match(finalPage.text, /150/);
    assert.match(finalPage.text, /600/);
  });

  await check("the supplier page links its purchase orders", async () => {
    const response = await get(`/suppliers/${supplier.id}`, ownerCookie);
    assert.equal(response.status, 200);
    assert.match(response.text, new RegExp(supplier.code));
    assert.match(response.text, new RegExp(order.poNumber));
    assert.match(response.text, /Recent purchase orders/);

    const list = await get("/suppliers?q=VERIFY-SUP", ownerCookie);
    assert.equal(list.status, 200);
    assert.match(list.text, /Verify purchasing supplier/);
  });

  await check("the goods-received list contains this run", async () => {
    const response = await get(`/purchases/grn?q=${encodeURIComponent(partial.grnNumber)}`, ownerCookie);
    assert.equal(response.status, 200);
    assert.match(response.text, new RegExp(partial.grnNumber));
    assert.match(response.text, /posted/);
  });

  await check("an accountant can read purchases but cannot raise or receive", async () => {
    for (const path of ["/purchases", `/purchases/${order.id}`, "/suppliers"]) {
      const response = await get(path, accountantCookie);
      assert.equal(response.status, 200, `${path} returned ${response.status}`);
    }
    assert.doesNotMatch((await get(`/purchases/${order.id}`, accountantCookie)).text, /Send order/);
    assert.doesNotMatch((await get(`/purchases/${order.id}`, accountantCookie)).text, /Receive goods/);

    for (const path of ["/purchases/new", `/purchases/${order.id}/receive`, "/suppliers/new"]) {
      const response = await get(path, accountantCookie);
      assert.ok(
        [302, 303, 307, 308].includes(response.status),
        `${path} returned ${response.status}`,
      );
      assert.match(response.location, /\/forbidden/, `${path} did not redirect to /forbidden`);
    }
  });

  await check("a cashier is redirected from every purchasing screen", async () => {
    for (const path of ["/purchases", `/purchases/${order.id}`, "/purchases/grn", "/suppliers"]) {
      const response = await get(path, cashierCookie);
      assert.ok(
        [302, 303, 307, 308].includes(response.status),
        `${path} returned ${response.status}`,
      );
      assert.match(response.location, /\/forbidden/, `${path} did not redirect to /forbidden`);
    }
  });
} finally {
  await prisma.productVariant
    .update({ where: { id: variant.id }, data: { status: "ARCHIVED" } })
    .catch(() => undefined);
  await prisma.product
    .update({ where: { id: product.id }, data: { isPublished: false } })
    .catch(() => undefined);
  await prisma.warehouse
    .updateMany({ where: { code: VERIFY_WAREHOUSE_CODE }, data: { isActive: false } })
    .catch(() => undefined);
  await prisma.supplier
    .updateMany({ where: { code: VERIFY_SUPPLIER_CODE }, data: { status: "INACTIVE" } })
    .catch(() => undefined);
  await prisma.user
    .updateMany({
      where: { id: { in: [owner.id, accountant.id, cashier.id] } },
      data: { status: "SUSPENDED", deletedAt: new Date() },
    })
    .catch(() => undefined);
  await prisma.$disconnect();
}

console.log(
  "\nThe stock ledger is append-only, so this run's variant was archived, the " +
    "supplier and warehouse were deactivated; their purchasing history is retained.",
);
console.log(`\n${checks - failures}/${checks} purchasing checks passed.`);
process.exitCode = failures === 0 ? 0 : 1;
