/**
 * End-to-end inventory verification.
 *
 *   npm run build
 *   STORAGE_PROVIDER=local npm start     # in another terminal
 *   npm run verify:inventory
 *
 * Point it elsewhere with BASE_URL=http://localhost:3100 npm run verify:inventory
 *
 * Proves over real HTTP: inventory permissions, the 403 page for a cashier,
 * opening stock, a two-step warehouse transfer, a damage adjustment, AVCO,
 * the append-only ledger and cost-price hiding. The stock ledger cannot be
 * deleted by design, so the verification variant is archived and the two
 * verification warehouses are deactivated; their history is retained.
 */
import { config } from "dotenv";
config({ path: [".env.local", ".env"], quiet: true });

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { prisma } from "../src/lib/db";
import { SESSION_VERSION, signSessionToken } from "../src/lib/auth/token";
import {
  createAdjustment,
  createTransfer,
  postAdjustment,
  postOpeningStock,
  receiveTransfer,
  sendTransfer,
} from "../src/lib/inventory/service";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const COOKIE = process.env.SESSION_COOKIE_NAME?.trim() || "bgd26_session";

const VERIFY_WAREHOUSE_CODES = ["VERIFY-INV-A", "VERIFY-INV-B"] as const;

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

const [ownerRole, cashierRole, category] = await Promise.all([
  prisma.role.findUniqueOrThrow({ where: { code: "OWNER" }, select: { id: true } }),
  prisma.role.findUniqueOrThrow({ where: { code: "CASHIER" }, select: { id: true } }),
  prisma.category.findFirstOrThrow({ orderBy: { sortOrder: "asc" }, select: { id: true } }),
]);

const [owner, cashier] = await Promise.all([
  prisma.user.create({
    data: {
      email: `verify-inventory-owner-${run}@example.test`,
      fullName: "Verify Inventory Owner",
      status: "ACTIVE",
      mustChangePassword: false,
      userRoles: { create: [{ roleId: ownerRole.id }] },
    },
    select: { id: true, email: true },
  }),
  prisma.user.create({
    data: {
      email: `verify-inventory-cashier-${run}@example.test`,
      fullName: "Verify Inventory Cashier",
      status: "ACTIVE",
      mustChangePassword: false,
      userRoles: { create: [{ roleId: cashierRole.id }] },
    },
    select: { id: true, email: true },
  }),
]);

const product = await prisma.product.upsert({
  where: { slug: "verify-inventory" },
  update: { status: "ACTIVE", isPublished: false },
  create: {
    categoryId: category.id,
    sku: "VERIFY-INV",
    name: "Verify inventory product",
    slug: "verify-inventory",
    status: "ACTIVE",
    isPublished: false,
    basePrice: "100.00",
  },
  select: { id: true, name: true },
});

const variant = await prisma.productVariant.create({
  data: {
    productId: product.id,
    sku: `VERIFY-INV-${run.toUpperCase()}`,
    name: `Verification run ${run}`,
    price: "100.00",
    costPrice: "0.0000",
    fulfillmentType: "STOCKED",
    // Earlier verification runs keep their archived variants, so this product
    // already has a default variant; the partial unique index allows only one.
    isDefault: false,
    status: "ACTIVE",
  },
  select: { id: true, sku: true, name: true },
});

const [warehouseA, warehouseB] = await Promise.all(
  VERIFY_WAREHOUSE_CODES.map((code) =>
    prisma.warehouse.upsert({
      where: { code },
      update: { isActive: true },
      create: {
        code,
        name: `Verify inventory ${code}`,
        type: "SECONDARY",
        isActive: true,
      },
      select: { id: true, code: true },
    }),
  ),
);

const opening = await postOpeningStock({
  warehouseId: warehouseA.id,
  variantId: variant.id,
  quantity: "10",
  unitCost: "100",
  note: "Verification opening stock",
  actorUserId: owner.id,
});

const transfer = await createTransfer({
  fromWarehouseId: warehouseA.id,
  toWarehouseId: warehouseB.id,
  lines: [{ variantId: variant.id, quantity: "4" }],
  notes: "Verification transfer",
  actorUserId: owner.id,
});
await sendTransfer(transfer.id, owner.id);
await receiveTransfer(transfer.id, owner.id);

const adjustment = await createAdjustment({
  warehouseId: warehouseA.id,
  variantId: variant.id,
  adjustmentType: "DAMAGE",
  quantity: "2",
  reason: "Verification damage after a physical count",
  actorUserId: owner.id,
});
await postAdjustment(adjustment.id, owner.id);

const ownerCookie = sessionCookie(owner);
const cashierCookie = sessionCookie(cashier);

try {
  await check("opening stock, transfer and damage produced the expected balances", async () => {
    const [balanceA, balanceB] = await Promise.all([
      prisma.inventoryBalance.findUniqueOrThrow({
        where: {
          variantId_warehouseId: { variantId: variant.id, warehouseId: warehouseA.id },
        },
      }),
      prisma.inventoryBalance.findUniqueOrThrow({
        where: {
          variantId_warehouseId: { variantId: variant.id, warehouseId: warehouseB.id },
        },
      }),
    ]);

    assert.equal(balanceA.physicalQty.toString(), "6");
    assert.equal(balanceA.availableQty.toString(), "4");
    assert.equal(balanceA.damagedQty.toString(), "2");
    assert.equal(balanceA.avcoUnitCost.toString(), "100");
    assert.equal(balanceB.physicalQty.toString(), "4");
    assert.equal(balanceB.availableQty.toString(), "4");
    assert.equal(balanceB.avcoUnitCost.toString(), "100");

    const ledger = await prisma.stockLedger.findMany({
      where: { variantId: variant.id },
      orderBy: { createdAt: "asc" },
      select: { movementType: true, quantity: true, unitCost: true },
    });
    assert.deepEqual(
      ledger.map((entry) => entry.movementType),
      ["OPENING_BALANCE", "TRANSFER_OUT", "TRANSFER_IN", "DAMAGE"],
    );
    assert.equal(ledger[1]?.quantity.toString(), "-4");
    assert.equal(ledger[2]?.quantity.toString(), "4");
    assert.equal(ledger[3]?.quantity.toString(), "-2");
    assert.equal(ledger[1]?.unitCost.toString(), "100");
    assert.equal(ledger[2]?.unitCost.toString(), "100");

    const document = await prisma.stockTransfer.findUniqueOrThrow({
      where: { id: transfer.id },
      select: { status: true, items: { select: { receivedQty: true } } },
    });
    assert.equal(document.status, "RECEIVED");
    assert.equal(document.items[0]?.receivedQty.toString(), "4");
  });

  await check("anonymous visitors are redirected from inventory", async () => {
    const response = await get("/inventory");
    assert.ok([302, 303, 307, 308].includes(response.status), `status ${response.status}`);
    assert.match(response.location, /\/login/);
  });

  await check("owner sees every inventory screen", async () => {
    for (const path of [
      "/inventory",
      `/inventory/${variant.id}`,
      "/inventory/warehouses",
      `/inventory/warehouses/${warehouseA.id}`,
      "/inventory/opening",
      "/inventory/adjustments",
      `/inventory/adjustments/${opening.id}`,
      `/inventory/adjustments/${adjustment.id}`,
      "/inventory/transfers",
      `/inventory/transfers/${transfer.id}`,
    ]) {
      const response = await get(path, ownerCookie);
      assert.equal(response.status, 200, `${path} returned ${response.status}`);
    }
  });

  await check("the stock detail shows both warehouses and the append-only ledger", async () => {
    const response = await get(`/inventory/${variant.id}`, ownerCookie);
    assert.equal(response.status, 200);
    assert.match(response.text, new RegExp(variant.sku));
    assert.match(response.text, new RegExp(warehouseA.code));
    assert.match(response.text, new RegExp(warehouseB.code));
    assert.match(response.text, /OPENING_BALANCE/);
    assert.match(response.text, /TRANSFER_OUT/);
    assert.match(response.text, /TRANSFER_IN/);
    assert.match(response.text, /DAMAGE/);
    assert.match(response.text, /append-only/i);
    assert.match(response.text, /Stock value/);
    assert.match(response.text, /AVCO/);
  });

  await check("the adjustment and transfer documents show their posted state", async () => {
    const adjustmentPage = await get(`/inventory/adjustments/${adjustment.id}`, ownerCookie);
    assert.equal(adjustmentPage.status, 200);
    assert.match(adjustmentPage.text, new RegExp(adjustment.adjustmentNumber));
    assert.match(adjustmentPage.text, /POSTED/);
    assert.match(adjustmentPage.text, /Verification damage/);

    const transferPage = await get(`/inventory/transfers/${transfer.id}`, ownerCookie);
    assert.equal(transferPage.status, 200);
    assert.match(transferPage.text, new RegExp(transfer.transferNumber));
    assert.match(transferPage.text, /RECEIVED/);
    assert.match(transferPage.text, /received/);
    assert.match(transferPage.text, /TRANSFER_OUT/);
    assert.match(transferPage.text, /TRANSFER_IN/);
  });

  await check("the opening stock list contains this run", async () => {
    const response = await get("/inventory/opening", ownerCookie);
    assert.equal(response.status, 200);
    assert.match(response.text, new RegExp(variant.sku));
    assert.match(response.text, /Open document/);
  });

  await check("cashier can view balances but never cost prices", async () => {
    const list = await get("/inventory", cashierCookie);
    assert.equal(list.status, 200);
    assert.match(list.text, new RegExp(variant.sku));
    assert.doesNotMatch(list.text, /Stock value/);
    assert.doesNotMatch(list.text, /AVCO \/ value/);

    const detail = await get(`/inventory/${variant.id}`, cashierCookie);
    assert.equal(detail.status, 200);
    assert.match(detail.text, /Physical/);
    assert.match(detail.text, /Available/);
    assert.doesNotMatch(detail.text, /Stock value/);
    assert.doesNotMatch(detail.text, /AVCO \/ value/);

    const warehouses = await get("/inventory/warehouses", cashierCookie);
    assert.equal(warehouses.status, 200);
    assert.doesNotMatch(warehouses.text, /Add a warehouse/);

    const warehouseDetail = await get(`/inventory/warehouses/${warehouseA.id}`, cashierCookie);
    assert.equal(warehouseDetail.status, 200);
    assert.doesNotMatch(warehouseDetail.text, /Edit warehouse/);
  });

  await check("cashier is redirected from every stock-changing screen", async () => {
    for (const path of [
      "/inventory/opening",
      "/inventory/adjustments/new",
      "/inventory/transfers/new",
    ]) {
      const response = await get(path, cashierCookie);
      assert.ok(
        [302, 303, 307, 308].includes(response.status),
        `${path} returned ${response.status}`,
      );
      assert.match(response.location, /\/forbidden/, `${path} did not redirect to /forbidden`);
    }
  });

  await check("the owner can still reach the stock-changing screens", async () => {
    for (const path of [
      "/inventory/opening",
      "/inventory/adjustments/new",
      "/inventory/transfers/new",
    ]) {
      const response = await get(path, ownerCookie);
      assert.equal(response.status, 200, `${path} returned ${response.status}`);
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
    .updateMany({
      where: { code: { in: [...VERIFY_WAREHOUSE_CODES] } },
      data: { isActive: false },
    })
    .catch(() => undefined);
  await prisma.user
    .updateMany({
      where: { id: { in: [owner.id, cashier.id] } },
      data: { status: "SUSPENDED", deletedAt: new Date() },
    })
    .catch(() => undefined);
  await prisma.$disconnect();
}

console.log(
  "\nThe stock ledger is append-only, so this run's variant was archived and the " +
    "verification warehouses were deactivated; their ledger history is retained.",
);
console.log(`\n${checks - failures}/${checks} inventory checks passed.`);
process.exitCode = failures === 0 ? 0 : 1;
