/**
 * End-to-end dropship verification.
 *
 *   npm run build
 *   STORAGE_PROVIDER=local npm start     # in another terminal
 *   npm run verify:dropship
 *
 * Point it elsewhere with BASE_URL=http://localhost:3100.
 *
 * Proves over real HTTP: a dropship sale raises a supplier order automatically,
 * the list and detail screens show it, the supplier order moves through send,
 * confirm, ship and deliver, shipping recognises cost of goods sold once and
 * creates a direct shipment with no warehouse, the payable reaches the supplier
 * statement, and permissions separate the owner and stock keeper from the
 * cashier. Standard purchase screens never show a dropship order.
 *
 * Each run uses a fresh supplier, product, variant and sale. The stock ledger
 * and journals are append-only, so the variant is archived, the supplier
 * deactivated and the customer blocked at the end; the history stays in the
 * books.
 */
import { config } from "dotenv";
config({ path: [".env.local", ".env"], quiet: true });

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { prisma } from "../src/lib/db";
import { SESSION_VERSION, signSessionToken } from "../src/lib/auth/token";
import { ACCOUNTS } from "../src/lib/accounting/journal";
import {
  cancelDropshipOrder,
  confirmDropshipOrder,
  deliverDropshipOrder,
  sendDropshipOrder,
  shipDropshipOrder,
} from "../src/lib/dropship/service";
import { createSale } from "../src/lib/orders/service";
import { supplierPayable } from "../src/lib/purchasing/settlement";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const COOKIE = process.env.SESSION_COOKIE_NAME?.trim() || "bgd26_session";

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
    text: bytes.toString("utf8"),
  };
}

function visible(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

const run = randomBytes(4).toString("hex");

/** A valid BD mobile: +8801, then an operator digit 3–9 and eight digits. */
function bdMobile(offset = 0): string {
  const tail = String((Number(String(Date.now()).slice(-8)) + offset) % 100_000_000).padStart(8, "0");
  return `+8801${3 + (offset % 7)}${tail}`;
}

const mobileA = bdMobile(0);
const mobileB = bdMobile(1);

const [ownerRole, stockRole, accountantRole, cashierRole, category, warehouse] =
  await Promise.all([
    prisma.role.findUniqueOrThrow({ where: { code: "OWNER" }, select: { id: true } }),
    prisma.role.findUniqueOrThrow({ where: { code: "STOCK" }, select: { id: true } }),
    prisma.role.findUniqueOrThrow({ where: { code: "ACCOUNTANT" }, select: { id: true } }),
    prisma.role.findUniqueOrThrow({ where: { code: "CASHIER" }, select: { id: true } }),
    prisma.category.findFirstOrThrow({ orderBy: { sortOrder: "asc" }, select: { id: true } }),
    prisma.warehouse.findFirstOrThrow({
      where: { isActive: true },
      orderBy: { code: "asc" },
      select: { id: true, code: true },
    }),
  ]);

const [owner, stock, accountant, cashier] = await Promise.all([
  prisma.user.create({
    data: {
      email: `verify-dropship-owner-${run}@example.test`,
      fullName: "Verify dropship owner",
      status: "ACTIVE",
      mustChangePassword: false,
      userRoles: { create: [{ roleId: ownerRole.id }] },
    },
    select: { id: true, email: true },
  }),
  prisma.user.create({
    data: {
      email: `verify-dropship-stock-${run}@example.test`,
      fullName: "Verify dropship stock keeper",
      status: "ACTIVE",
      mustChangePassword: false,
      userRoles: { create: [{ roleId: stockRole.id }] },
    },
    select: { id: true, email: true },
  }),
  prisma.user.create({
    data: {
      email: `verify-dropship-accountant-${run}@example.test`,
      fullName: "Verify dropship accountant",
      status: "ACTIVE",
      mustChangePassword: false,
      userRoles: { create: [{ roleId: accountantRole.id }] },
    },
    select: { id: true, email: true },
  }),
  prisma.user.create({
    data: {
      email: `verify-dropship-cashier-${run}@example.test`,
      fullName: "Verify dropship cashier",
      status: "ACTIVE",
      mustChangePassword: false,
      userRoles: { create: [{ roleId: cashierRole.id }] },
    },
    select: { id: true, email: true },
  }),
]);

const supplier = await prisma.supplier.create({
  data: {
    code: `VDS-${run.toUpperCase()}`,
    name: `Verify dropship supplier ${run}`,
    isDropshipVendor: true,
    status: "ACTIVE",
  },
  select: { id: true, code: true, name: true },
});

const product = await prisma.product.create({
  data: {
    categoryId: category.id,
    sku: `VDS-${run.toUpperCase()}`,
    name: `Verify dropship product ${run}`,
    slug: `verify-dropship-product-${run}`,
    status: "ACTIVE",
    isPublished: false,
    basePrice: "1150.00",
  },
  select: { id: true },
});

const variant = await prisma.productVariant.create({
  data: {
    productId: product.id,
    sku: `VDS-VAR-${run.toUpperCase()}`,
    name: "Dropship unit",
    price: "1150.00",
    costPrice: "0.0000",
    fulfillmentType: "DROPSHIP",
    dropshipSupplierId: supplier.id,
    dropshipCost: "700.0000",
    status: "ACTIVE",
  },
  select: { id: true, sku: true },
});

const sale = await createSale({
  source: "WEB",
  warehouseId: warehouse.id,
  customerMobile: mobileA,
  customerName: `Verify dropship buyer ${run}`,
  recipientName: `Verify dropship buyer ${run}`,
  recipientMobile: mobileA,
  shippingAddress: {
    line1: "12 Test Road",
    area: "Gulshan",
    district: "Dhaka",
    division: "Dhaka",
  },
  lines: [{ variantId: variant.id, quantity: "2" }],
  payments: [{ method: "CASH" }],
  actorUserId: owner.id,
});

const po = await prisma.purchaseOrder.findFirstOrThrow({
  where: { orderId: sale.orderId, poType: "DROPSHIP" },
  select: { id: true, poNumber: true, grandTotal: true, status: true },
});

// A second sale, partly paid, proves the prepaid shipping guard.
const unpaidSale = await createSale({
  source: "WEB",
  warehouseId: warehouse.id,
  customerMobile: mobileB,
  customerName: `Verify dropship unpaid buyer ${run}`,
  recipientName: `Verify dropship unpaid buyer ${run}`,
  recipientMobile: mobileB,
  lines: [{ variantId: variant.id, quantity: "1" }],
  payments: [{ method: "CASH", amount: "100.00" }],
  actorUserId: owner.id,
});
const unpaidPo = await prisma.purchaseOrder.findFirstOrThrow({
  where: { orderId: unpaidSale.orderId, poType: "DROPSHIP" },
  select: { id: true, poNumber: true },
});

const ownerCookie = sessionCookie(owner);
const stockCookie = sessionCookie(stock);
const accountantCookie = sessionCookie(accountant);
const cashierCookie = sessionCookie(cashier);

try {
  await check("anonymous visitors are sent to login from dropship pages", async () => {
    for (const path of ["/purchases/dropship", `/purchases/dropship/${po.id}`]) {
      const response = await get(path);
      assert.ok([302, 303, 307, 308].includes(response.status), `${path} ${response.status}`);
      assert.match(response.location, /\/login/);
    }
  });

  await check("the sale raised a supplier order with no warehouse and no stock", async () => {
    const stored = await prisma.purchaseOrder.findUniqueOrThrow({
      where: { id: po.id },
      select: {
        poType: true,
        warehouseId: true,
        supplierId: true,
        status: true,
        grandTotal: true,
        items: { select: { quantity: true, unitCost: true, lineTotal: true, orderItemId: true } },
      },
    });
    assert.equal(stored.poType, "DROPSHIP");
    assert.equal(stored.warehouseId, null);
    assert.equal(stored.supplierId, supplier.id);
    assert.equal(stored.status, "DRAFT");
    assert.equal(stored.grandTotal.toFixed(2), "1400.00");
    assert.equal(stored.items.length, 1);
    assert.equal(stored.items[0]?.quantity.toString(), "2");
    assert.equal(stored.items[0]?.unitCost.toFixed(4), "700.0000");
    assert.ok(stored.items[0]?.orderItemId);

    assert.equal(await prisma.stockLedger.count({ where: { variantId: variant.id } }), 0);
    assert.equal(await prisma.inventoryBalance.count({ where: { variantId: variant.id } }), 0);

    const order = await prisma.order.findUniqueOrThrow({
      where: { id: sale.orderId },
      select: { fulfillmentStatus: true, hasDropshipItems: true },
    });
    assert.equal(order.hasDropshipItems, true);
    assert.equal(order.fulfillmentStatus, "PENDING_DROPSHIP");
  });

  await check("the owner sees the supplier order in the dropship list", async () => {
    const list = await get("/purchases/dropship", ownerCookie);
    assert.equal(list.status, 200);
    const text = visible(list.text);
    assert.match(text, /Dropship orders/);
    assert.match(text, new RegExp(po.poNumber));
    assert.match(text, new RegExp(sale.orderNumber));
    assert.match(text, new RegExp(supplier.name));
    assert.match(text, /Draft/);
  });

  await check("the detail shows the supplier, sale, lines and next step", async () => {
    const detail = await get(`/purchases/dropship/${po.id}`, ownerCookie);
    assert.equal(detail.status, 200);
    const text = visible(detail.text);

    assert.match(text, new RegExp(po.poNumber));
    assert.match(text, new RegExp(supplier.name));
    assert.match(text, new RegExp(sale.orderNumber));
    assert.match(text, new RegExp(variant.sku));
    assert.match(text, /Verify dropship buyer/);
    assert.match(text, /12 Test Road/);
    assert.match(text, /Supplier lines/);
    assert.match(text, /Send to supplier/);
    assert.match(text, /not shipped yet/);
    assert.match(text, /1,400\.00/);
  });

  await check("standard purchase screens never show a dropship order", async () => {
    const list = visible((await get("/purchases", ownerCookie)).text);
    assert.doesNotMatch(list, new RegExp(po.poNumber));

    const detail = await get(`/purchases/${po.id}`, ownerCookie);
    assert.ok([302, 303, 307, 308].includes(detail.status), `detail ${detail.status}`);
    assert.match(detail.location, /\/purchases\/dropship\//);
  });

  await sendDropshipOrder(po.id, owner.id);

  await check("sending shows the supplier-confirmation step", async () => {
    const text = visible((await get(`/purchases/dropship/${po.id}`, ownerCookie)).text);
    assert.match(text, /Sent to supplier/);
    assert.match(text, /Supplier confirmed/);
    assert.match(text, /Cancel order/);
  });

  await confirmDropshipOrder(po.id, owner.id, "Supplier reference 8812");

  await check("confirming shows the ship step and stores the reference", async () => {
    const text = visible((await get(`/purchases/dropship/${po.id}`, ownerCookie)).text);
    assert.match(text, /Supplier confirmed/);
    assert.match(text, /Mark shipped by supplier/);
    assert.match(text, /8812/);
  });

  await shipDropshipOrder(po.id, owner.id, {
    trackingNumber: "TRK-DS-1",
    note: "Handed to the supplier courier",
  });

  await check("shipping posts cost of goods sold and creates a direct shipment", async () => {
    const stored = await prisma.purchaseOrder.findUniqueOrThrow({
      where: { id: po.id },
      select: { status: true, shippedAt: true },
    });
    assert.equal(stored.status, "SHIPPED");
    assert.ok(stored.shippedAt);

    const shipment = await prisma.shipment.findFirstOrThrow({
      where: { orderId: sale.orderId, supplierId: supplier.id, shipmentType: "DROPSHIP_DIRECT" },
      select: {
        shipmentNumber: true,
        warehouseId: true,
        status: true,
        trackingNumber: true,
        trackingEvents: { select: { status: true } },
      },
    });
    assert.equal(shipment.warehouseId, null);
    assert.equal(shipment.status, "PICKED_UP");
    assert.equal(shipment.trackingNumber, "TRK-DS-1");
    assert.equal(shipment.trackingEvents.length, 1);

    const entry = await prisma.journalEntry.findFirstOrThrow({
      where: {
        referenceType: "purchase_order",
        referenceId: po.id,
        source: "DROPSHIP_COGS",
      },
      select: {
        entryNumber: true,
        lines: { select: { debit: true, credit: true, supplierId: true, account: { select: { code: true } } } },
      },
    });
    const cogs = entry.lines.find((line) => line.account.code === ACCOUNTS.dropshipCogs);
    const payable = entry.lines.find((line) => line.account.code === ACCOUNTS.payable);
    assert.equal(cogs?.debit.toFixed(2), "1400.00");
    assert.equal(payable?.credit.toFixed(2), "1400.00");
    assert.equal(payable?.supplierId, supplier.id);

    const owed = await supplierPayable(supplier.id);
    assert.equal(owed.outstanding.toFixed(2), "1400.00");

    const order = await prisma.order.findUniqueOrThrow({
      where: { id: sale.orderId },
      select: { status: true },
    });
    assert.equal(order.status, "SHIPPED");

    const text = visible((await get(`/purchases/dropship/${po.id}`, ownerCookie)).text);
    assert.match(text, /Shipped by supplier/);
    assert.match(text, new RegExp(entry.entryNumber));
    assert.match(text, /Mark delivered/);
    assert.match(text, new RegExp(shipment.shipmentNumber));
    assert.match(text, /TRK-DS-1/);
  });

  await check("a shipped supplier order cannot be cancelled", async () => {
    await assert.rejects(
      () => cancelDropshipOrder(po.id, owner.id, "Too late"),
      /before the supplier ships/i,
    );
  });

  await check("shipping is refused while the sale still owes money", async () => {
    await sendDropshipOrder(unpaidPo.id, owner.id);
    await confirmDropshipOrder(unpaidPo.id, owner.id);
    await assert.rejects(
      () => shipDropshipOrder(unpaidPo.id, owner.id),
      /still due before the supplier ships/i,
    );
    const stored = await prisma.purchaseOrder.findUniqueOrThrow({
      where: { id: unpaidPo.id },
      select: { status: true },
    });
    assert.equal(stored.status, "CONFIRMED");
  });

  await deliverDropshipOrder(po.id, owner.id, "Received by the customer");

  await check("delivery closes the shipment and fulfils the sale", async () => {
    const stored = await prisma.purchaseOrder.findUniqueOrThrow({
      where: { id: po.id },
      select: { status: true, deliveredAt: true },
    });
    assert.equal(stored.status, "DELIVERED");
    assert.ok(stored.deliveredAt);

    const shipment = await prisma.shipment.findFirstOrThrow({
      where: { orderId: sale.orderId, shipmentType: "DROPSHIP_DIRECT" },
      select: { status: true, trackingEvents: { select: { status: true } } },
    });
    assert.equal(shipment.status, "DELIVERED");

    const order = await prisma.order.findUniqueOrThrow({
      where: { id: sale.orderId },
      select: { status: true, fulfillmentStatus: true },
    });
    assert.equal(order.status, "DELIVERED");
    assert.equal(order.fulfillmentStatus, "FULFILLED");

    const text = visible((await get(`/purchases/dropship/${po.id}`, ownerCookie)).text);
    assert.match(text, /Delivered/);
    assert.match(text, /Received by the customer/);
  });

  await check("a stock keeper can read and run dropship orders", async () => {
    for (const path of ["/purchases/dropship", `/purchases/dropship/${po.id}`]) {
      const response = await get(path, stockCookie);
      assert.equal(response.status, 200, `${path} returned ${response.status}`);
    }
    const text = visible((await get(`/purchases/dropship/${unpaidPo.id}`, stockCookie)).text);
    assert.match(text, /Mark shipped by supplier/);
  });

  await check("an accountant can read but not move a dropship order", async () => {
    const list = await get("/purchases/dropship", accountantCookie);
    assert.equal(list.status, 200);
    const text = visible((await get(`/purchases/dropship/${unpaidPo.id}`, accountantCookie)).text);
    assert.match(text, /purchase\.approve/);
    assert.doesNotMatch(text, /Mark shipped by supplier/);
  });

  await check("a cashier is refused dropship pages", async () => {
    for (const path of ["/purchases/dropship", `/purchases/dropship/${po.id}`]) {
      const response = await get(path, cashierCookie);
      assert.ok([302, 303, 307, 308].includes(response.status), `${path} ${response.status}`);
      assert.match(response.location, /\/forbidden/);
    }
  });
} finally {
  await prisma.productVariant
    .updateMany({ where: { id: variant.id }, data: { status: "ARCHIVED" } })
    .catch(() => undefined);
  await prisma.product
    .update({ where: { id: product.id }, data: { isPublished: false, status: "ARCHIVED" } })
    .catch(() => undefined);
  await prisma.supplier
    .update({ where: { id: supplier.id }, data: { status: "INACTIVE" } })
    .catch(() => undefined);
  await prisma.customer
    .updateMany({
      where: { mobileNormalized: { in: [mobileA, mobileB] } },
      data: { status: "BLOCKED", deletedAt: new Date() },
    })
    .catch(() => undefined);
  await prisma.user
    .updateMany({
      where: { id: { in: [owner.id, stock.id, accountant.id, cashier.id] } },
      data: { status: "SUSPENDED", deletedAt: new Date() },
    })
    .catch(() => undefined);
  await prisma.$disconnect();
}

console.log(
  "\nThe stock ledger and journals are append-only, so this run's variant was " +
    "archived, its supplier deactivated and its customer blocked; the dropship " +
    "history is retained.",
);
console.log(`\n${checks - failures}/${checks} dropship checks passed.`);
process.exitCode = failures === 0 ? 0 : 1;
