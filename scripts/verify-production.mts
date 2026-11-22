/**
 * End-to-end engraving production verification.
 *
 *   npm run build
 *   STORAGE_PROVIDER=local npm start     # in another terminal
 *   npm run verify:production
 *
 * Point it elsewhere with BASE_URL=http://localhost:3100.
 *
 * Proves over real HTTP: the job list and detail screens, the design revision
 * and approval flow, components leaving stock at average cost into work in
 * progress, completion moving that value to cost of goods sold, and cancellation
 * returning materials to stock. Permission separation is checked for a stock
 * keeper, an accountant and a cashier.
 *
 * Each run uses a fresh product, variant, warehouse and order. The stock ledger
 * and journals are append-only, so the variant is archived and the warehouse
 * deactivated at the end; the history stays in the books.
 */
import { config } from "dotenv";
config({ path: [".env.local", ".env"], quiet: true });

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { prisma } from "../src/lib/db";
import { SESSION_VERSION, signSessionToken } from "../src/lib/auth/token";
import { ACCOUNTS } from "../src/lib/accounting/journal";
import { postStockMovement } from "../src/lib/inventory/stock";
import {
  addDesignRevision,
  approveDesign,
  createProductionJob,
  issueComponents,
  productionWipValue,
  sendDesignForApproval,
  transitionProduction,
} from "../src/lib/production/service";

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
const digits = String(Date.now()).slice(-9);

const [ownerRole, stockRole, accountantRole, cashierRole, store, category] = await Promise.all([
  prisma.role.findUniqueOrThrow({ where: { code: "OWNER" }, select: { id: true } }),
  prisma.role.findUniqueOrThrow({ where: { code: "STOCK" }, select: { id: true } }),
  prisma.role.findUniqueOrThrow({ where: { code: "ACCOUNTANT" }, select: { id: true } }),
  prisma.role.findUniqueOrThrow({ where: { code: "CASHIER" }, select: { id: true } }),
  prisma.store.findFirstOrThrow({
    where: { isActive: true },
    orderBy: { code: "asc" },
    select: { id: true },
  }),
  prisma.category.findFirstOrThrow({ orderBy: { sortOrder: "asc" }, select: { id: true } }),
]);

const [owner, stock, accountant, cashier] = await Promise.all([
  prisma.user.create({
    data: {
      email: `verify-production-owner-${run}@example.test`,
      fullName: "Verify production owner",
      status: "ACTIVE",
      mustChangePassword: false,
      userRoles: { create: [{ roleId: ownerRole.id }] },
    },
    select: { id: true, email: true },
  }),
  prisma.user.create({
    data: {
      email: `verify-production-stock-${run}@example.test`,
      fullName: "Verify production stock keeper",
      status: "ACTIVE",
      mustChangePassword: false,
      userRoles: { create: [{ roleId: stockRole.id }] },
    },
    select: { id: true, email: true },
  }),
  prisma.user.create({
    data: {
      email: `verify-production-accountant-${run}@example.test`,
      fullName: "Verify production accountant",
      status: "ACTIVE",
      mustChangePassword: false,
      userRoles: { create: [{ roleId: accountantRole.id }] },
    },
    select: { id: true, email: true },
  }),
  prisma.user.create({
    data: {
      email: `verify-production-cashier-${run}@example.test`,
      fullName: "Verify production cashier",
      status: "ACTIVE",
      mustChangePassword: false,
      userRoles: { create: [{ roleId: cashierRole.id }] },
    },
    select: { id: true, email: true },
  }),
]);

const warehouse = await prisma.warehouse.create({
  data: {
    code: `VPROD-${run.toUpperCase()}`,
    name: `Verify production warehouse ${run}`,
    type: "SECONDARY",
    isActive: true,
  },
  select: { id: true, code: true },
});

const product = await prisma.product.create({
  data: {
    categoryId: category.id,
    sku: `VPROD-${run.toUpperCase()}`,
    name: `Verify engraved product ${run}`,
    slug: `verify-engraved-product-${run}`,
    status: "ACTIVE",
    isPublished: false,
    basePrice: "1000.00",
  },
  select: { id: true },
});

const finished = await prisma.productVariant.create({
  data: {
    productId: product.id,
    sku: `VPROD-FIN-${run.toUpperCase()}`,
    name: "Finished unit",
    price: "1000.00",
    costPrice: "0.0000",
    fulfillmentType: "STOCKED",
    status: "ACTIVE",
  },
  select: { id: true, sku: true },
});

const component = await prisma.productVariant.create({
  data: {
    productId: product.id,
    sku: `VPROD-CMP-${run.toUpperCase()}`,
    name: "Component plate",
    price: "0.00",
    costPrice: "80.0000",
    fulfillmentType: "STOCKED",
    isDefault: false,
    status: "ACTIVE",
  },
  select: { id: true, sku: true },
});

await prisma.$transaction(async (tx) => {
  await postStockMovement(tx, {
    variantId: component.id,
    warehouseId: warehouse.id,
    storeId: store.id,
    movementType: "OPENING_BALANCE",
    quantity: "10",
    unitCost: "80",
    referenceType: "verification",
    referenceId: run,
    actorUserId: owner.id,
  });
});

const customer = await prisma.customer.create({
  data: {
    mobileNormalized: `+8801${digits}`,
    fullName: `Verify production customer ${run}`,
  },
  select: { id: true },
});

const order = await prisma.order.create({
  data: {
    orderNumber: `VPROD-${run.toUpperCase()}`,
    channel: "ONLINE",
    status: "CONFIRMED",
    source: "ADMIN",
    customerId: customer.id,
    storeId: store.id,
    warehouseId: warehouse.id,
    recipientName: `Verify production customer ${run}`,
    recipientMobile: `+8801${digits}`,
    subtotal: "2000.00",
    grandTotal: "2000.00",
    paidAmount: "2000.00",
    paymentStatus: "PAID",
    items: {
      create: [
        {
          variantId: finished.id,
          productId: product.id,
          productNameSnapshot: `Verify engraved product ${run}`,
          variantNameSnapshot: "Finished unit",
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
          productNameSnapshot: `Verify engraved product ${run}`,
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
  select: { id: true, orderNumber: true, items: { select: { id: true } } },
});

const firstItemId = order.items[0]!.id;
const secondItemId = order.items[1]!.id;

const ownerCookie = sessionCookie(owner);
const stockCookie = sessionCookie(stock);
const accountantCookie = sessionCookie(accountant);
const cashierCookie = sessionCookie(cashier);

const job = await createProductionJob({
  orderItemId: firstItemId,
  priority: "HIGH",
  engravingText: "Ayesha · 2026",
  fontName: "Serif",
  instructions: "Centre of the lid",
  components: [{ variantId: component.id, quantity: "2" }],
  actorUserId: owner.id,
});

try {
  await check("anonymous visitors are sent to login from production pages", async () => {
    for (const path of ["/production", "/production/new", `/production/${job.id}`]) {
      const response = await get(path);
      assert.ok([302, 303, 307, 308].includes(response.status), `${path} ${response.status}`);
      assert.match(response.location, /\/login/);
    }
  });

  await check("the owner sees the job list and the new-job picker", async () => {
    const list = await get("/production", ownerCookie);
    assert.equal(list.status, 200);
    const listText = visible(list.text);
    assert.match(listText, /Production/);
    assert.match(listText, new RegExp(job.jobNumber));
    assert.match(listText, new RegExp(order.orderNumber));
    assert.match(listText, /Pending design/);

    const picker = await get("/production/new", ownerCookie);
    assert.equal(picker.status, 200);
    assert.match(visible(picker.text), new RegExp(order.orderNumber));

    const form = await get(`/production/new?orderItemId=${secondItemId}`, ownerCookie);
    assert.equal(form.status, 200);
    assert.match(visible(form.text), /New production job/);
    assert.match(visible(form.text), new RegExp(component.sku));
  });

  await check("the job detail shows the brief, components and next step", async () => {
    const detail = await get(`/production/${job.id}`, ownerCookie);
    assert.equal(detail.status, 200);
    const text = visible(detail.text);

    assert.match(text, new RegExp(job.jobNumber));
    assert.match(text, new RegExp(order.orderNumber));
    assert.match(text, /Ayesha · 2026/);
    assert.match(text, /Serif/);
    assert.match(text, /Centre of the lid/);
    assert.match(text, new RegExp(component.sku));
    assert.match(text, /Work in progress/);
    assert.match(text, /Start design/);
    assert.match(text, /Cancel job/);
    assert.match(text, /Status history/);
    assert.match(text, /Job created/);
  });

  await addDesignRevision(
    job.id,
    { description: "First proof", previewUrl: "https://example.test/proof-1.png" },
    owner.id,
  );

  await check("a design revision moves the job into design", async () => {
    const detail = visible((await get(`/production/${job.id}`, ownerCookie)).text);
    assert.match(detail, /Design in progress/);
    assert.match(detail, /Revision 1/);
    assert.match(detail, /First proof/);
    assert.match(detail, /Send latest revision for approval/);
  });

  await sendDesignForApproval(job.id, owner.id);

  await check("sending for approval shows the approve and changes forms", async () => {
    const detail = visible((await get(`/production/${job.id}`, ownerCookie)).text);
    assert.match(detail, /Awaiting approval/);
    assert.match(detail, /Approve design/);
    assert.match(detail, /Send back for changes/);
  });

  await approveDesign(job.id, owner.id, "Customer approved on the phone");

  await check("approving the design shows the issue-materials action", async () => {
    const detail = visible((await get(`/production/${job.id}`, ownerCookie)).text);
    assert.match(detail, /Approved/);
    assert.match(detail, /Issue outstanding components/);
    assert.match(detail, /Production cannot start until every component is issued/);
  });

  const issued = await issueComponents(job.id, owner.id);

  await check("issuing components takes stock at average cost into work in progress", async () => {
    assert.equal(issued.issued.toString(), "160");
    assert.ok(issued.journalEntryId);

    const balance = await prisma.inventoryBalance.findUniqueOrThrow({
      where: { variantId_warehouseId: { variantId: component.id, warehouseId: warehouse.id } },
    });
    assert.equal(balance.physicalQty.toString(), "8");
    assert.equal(balance.avcoUnitCost.toString(), "80");

    assert.equal((await productionWipValue(job.id)).toString(), "160");

    const entry = await prisma.journalEntry.findUniqueOrThrow({
      where: { id: issued.journalEntryId! },
      select: {
        entryNumber: true,
        source: true,
        lines: { select: { debit: true, credit: true, account: { select: { code: true } } } },
      },
    });
    assert.equal(entry.source, "PRODUCTION");
    const wip = entry.lines.find((line) => line.account.code === ACCOUNTS.wip);
    const inventory = entry.lines.find((line) => line.account.code === ACCOUNTS.inventory);
    assert.equal(wip?.debit.toString(), "160");
    assert.equal(inventory?.credit.toString(), "160");

    const detail = visible((await get(`/production/${job.id}`, ownerCookie)).text);
    assert.match(detail, new RegExp(entry.entryNumber));
    assert.match(detail, /160\.00/);
    assert.match(detail, /Start production/);
    assert.match(detail, /Components all issued/);
  });

  await transitionProduction(job.id, "PRODUCTION", owner.id, "Engraving started");
  await transitionProduction(job.id, "QUALITY_CHECK", owner.id, "Inspection passed");
  await transitionProduction(job.id, "READY_TO_SHIP", owner.id);
  const completed = await transitionProduction(job.id, "COMPLETED", owner.id, "Handed to dispatch");

  await check("completing the job moves work in progress to cost of goods sold", async () => {
    assert.ok(completed.journalEntryId);
    assert.equal((await productionWipValue(job.id)).toString(), "0");

    const entry = await prisma.journalEntry.findUniqueOrThrow({
      where: { id: completed.journalEntryId! },
      select: {
        entryNumber: true,
        lines: { select: { debit: true, credit: true, account: { select: { code: true } } } },
      },
    });
    const cogs = entry.lines.find((line) => line.account.code === ACCOUNTS.cogs);
    const wip = entry.lines.find((line) => line.account.code === ACCOUNTS.wip);
    assert.equal(cogs?.debit.toString(), "160");
    assert.equal(wip?.credit.toString(), "160");

    const detail = visible((await get(`/production/${job.id}`, ownerCookie)).text);
    assert.match(detail, /Completed/);
    assert.match(detail, new RegExp(entry.entryNumber));
    assert.match(detail, /COGS|Cost of Goods|5000/i);
    assert.doesNotMatch(detail, /Cancel job/);
  });

  const secondJob = await createProductionJob({
    orderItemId: secondItemId,
    engravingText: "Second unit",
    components: [{ variantId: component.id, quantity: "2" }],
    actorUserId: owner.id,
  });
  await addDesignRevision(secondJob.id, { description: "Second proof" }, owner.id);
  await sendDesignForApproval(secondJob.id, owner.id);
  await approveDesign(secondJob.id, owner.id);
  await issueComponents(secondJob.id, owner.id);
  const cancelled = await transitionProduction(
    secondJob.id,
    "CANCELLED",
    owner.id,
    "Customer changed their mind",
  );

  await check("cancelling after issue returns the materials and clears work in progress", async () => {
    assert.ok(cancelled.journalEntryId);
    assert.equal((await productionWipValue(secondJob.id)).toString(), "0");

    const balance = await prisma.inventoryBalance.findUniqueOrThrow({
      where: { variantId_warehouseId: { variantId: component.id, warehouseId: warehouse.id } },
    });
    assert.equal(balance.physicalQty.toString(), "8");

    const movement = await prisma.stockLedger.findFirstOrThrow({
      where: {
        referenceType: "production_job",
        referenceId: secondJob.id,
        movementType: "PRODUCTION_RETURN",
      },
      select: { quantity: true, totalValue: true },
    });
    assert.equal(movement.quantity.toString(), "2");
    assert.equal(movement.totalValue.toString(), "160");

    const detail = visible((await get(`/production/${secondJob.id}`, ownerCookie)).text);
    assert.match(detail, /Cancelled/);
    assert.match(detail, /returned to stock/i);
  });

  await check("a stock keeper can run production", async () => {
    for (const path of ["/production", `/production/${job.id}`, "/production/new"]) {
      const response = await get(path, stockCookie);
      assert.equal(response.status, 200, `${path} returned ${response.status}`);
    }
  });

  await check("an accountant and a cashier are refused production", async () => {
    for (const [label, cookie] of [
      ["accountant", accountantCookie],
      ["cashier", cashierCookie],
    ] as const) {
      for (const path of ["/production", `/production/${job.id}`]) {
        const response = await get(path, cookie);
        assert.ok(
          [302, 303, 307, 308].includes(response.status),
          `${label} ${path} ${response.status}`,
        );
        assert.match(response.location, /\/forbidden/, `${label} ${path}`);
      }
    }
  });
} finally {
  await prisma.productVariant
    .updateMany({
      where: { id: { in: [finished.id, component.id] } },
      data: { status: "ARCHIVED" },
    })
    .catch(() => undefined);
  await prisma.product
    .update({ where: { id: product.id }, data: { isPublished: false, status: "ARCHIVED" } })
    .catch(() => undefined);
  await prisma.warehouse
    .update({ where: { id: warehouse.id }, data: { isActive: false } })
    .catch(() => undefined);
  await prisma.customer
    .update({ where: { id: customer.id }, data: { deletedAt: new Date(), status: "BLOCKED" } })
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
  "\nThe stock ledger and journals are append-only, so this run's variants were " +
    "archived and its warehouse deactivated; the production history is retained.",
);
console.log(`\n${checks - failures}/${checks} production checks passed.`);
process.exitCode = failures === 0 ? 0 : 1;
