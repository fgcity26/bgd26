/**
 * End-to-end accounting verification.
 *
 *   npm run build
 *   STORAGE_PROVIDER=local npm start     # in another terminal
 *   npm run verify:accounting
 *
 * Point it elsewhere with BASE_URL=http://localhost:3100 npm run verify:accounting
 *
 * Proves over real HTTP: the accounting section is closed to anonymous visitors
 * and to a cashier, an accountant can read the trial balance, chart of accounts,
 * account ledger, journal list and expenses, and every business event of this
 * run (opening stock, cash sale, verified digital payment, refund, goods
 * receipt, stock adjustment, expense, void and manual reversal) appears as a
 * balanced journal. Mutations run through the same domain services the server
 * actions call; the pages are then read back.
 *
 * Posted journals are immutable, so this run's entries stay in the ledger; the
 * variant is archived, the device revoked, the warehouse deactivated and the
 * verification users suspended.
 */
import { config } from "dotenv";
config({ path: [".env.local", ".env"], quiet: true });

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { Prisma } from "../src/generated/prisma/client";
import { prisma } from "../src/lib/db";
import { SESSION_VERSION, signSessionToken } from "../src/lib/auth/token";
import { hashPin } from "../src/lib/password";
import { postOpeningStock, createAdjustment, postAdjustment } from "../src/lib/inventory/service";
import {
  createGrn,
  createPurchaseOrder,
  createSupplier,
  postGrn,
  sendPurchaseOrder,
} from "../src/lib/purchasing/service";
import {
  approveRefund,
  completeRefund,
  createSale,
  requestRefund,
  verifyPayment,
} from "../src/lib/orders/service";
import { postJournal, reverseJournal } from "../src/lib/accounting/journal";
import {
  createExpense,
  postExpense,
  trialBalance,
  voidExpense,
} from "../src/lib/accounting/service";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const COOKIE = process.env.SESSION_COOKIE_NAME?.trim() || "bgd26_session";
const MANAGER_PIN = "246810";

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

/** Visible text of a server-rendered page, without tags or React text markers. */
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
const digits = String(Date.now()).slice(-8);

const [ownerRole, accountantRole, cashierRole, category, store, rent] = await Promise.all([
  prisma.role.findUniqueOrThrow({ where: { code: "OWNER" }, select: { id: true } }),
  prisma.role.findUniqueOrThrow({ where: { code: "ACCOUNTANT" }, select: { id: true } }),
  prisma.role.findUniqueOrThrow({ where: { code: "CASHIER" }, select: { id: true } }),
  prisma.category.findFirstOrThrow({
    where: { isActive: true },
    orderBy: { sortOrder: "asc" },
    select: { id: true, vatPercentage: true },
  }),
  prisma.store.findFirstOrThrow({
    where: { isActive: true },
    orderBy: { code: "asc" },
    select: { id: true, name: true },
  }),
  prisma.account.findUniqueOrThrow({ where: { code: "6000" }, select: { id: true } }),
]);

const warehouse = await prisma.warehouse.upsert({
  where: { code: "VERIFY-ACCT" },
  update: { isActive: true },
  create: {
    code: "VERIFY-ACCT",
    name: "Verify accounting warehouse",
    type: "SECONDARY",
    isActive: true,
  },
  select: { id: true, code: true },
});

const [owner, accountant, cashier] = await Promise.all([
  prisma.user.create({
    data: {
      email: `verify-acct-owner-${run}@example.test`,
      fullName: "Verify Accounting Owner",
      status: "ACTIVE",
      mustChangePassword: false,
      managerPinHash: await hashPin(MANAGER_PIN),
      userRoles: { create: [{ roleId: ownerRole.id }] },
    },
    select: { id: true, email: true },
  }),
  prisma.user.create({
    data: {
      email: `verify-acct-accountant-${run}@example.test`,
      fullName: "Verify Accounting Accountant",
      status: "ACTIVE",
      mustChangePassword: false,
      userRoles: { create: [{ roleId: accountantRole.id }] },
    },
    select: { id: true, email: true },
  }),
  prisma.user.create({
    data: {
      email: `verify-acct-cashier-${run}@example.test`,
      fullName: "Verify Accounting Cashier",
      status: "ACTIVE",
      mustChangePassword: false,
      userRoles: { create: [{ roleId: cashierRole.id }] },
    },
    select: { id: true, email: true },
  }),
]);

const product = await prisma.product.create({
  data: {
    categoryId: category.id,
    sku: `VERIFY-ACCT-${run.toUpperCase()}`,
    name: `Verify accounting product ${run}`,
    slug: `verify-accounting-${run}`,
    status: "ACTIVE",
    isPublished: false,
    basePrice: "115.00",
  },
  select: { id: true },
});

const variant = await prisma.productVariant.create({
  data: {
    productId: product.id,
    sku: `VERIFY-ACCT-${run.toUpperCase()}`,
    name: `Verification run ${run}`,
    price: "115.00",
    costPrice: "80.0000",
    fulfillmentType: "STOCKED",
    isDefault: false,
    status: "ACTIVE",
  },
  select: { id: true, sku: true },
});

const device = await prisma.posDevice.create({
  data: {
    code: `A${run}`.toUpperCase(),
    name: `Verify accounting till ${run}`,
    storeId: store.id,
    warehouseId: warehouse.id,
    deviceFingerprint: `verify-acct-fp-${run}`,
    platform: "verification",
    registeredByUserId: owner.id,
  },
  select: { id: true, code: true },
});

const opening = await postOpeningStock({
  variantId: variant.id,
  warehouseId: warehouse.id,
  quantity: "20",
  unitCost: "80",
  note: `Verification opening ${run}`,
  actorUserId: owner.id,
});

const customerMobile = `018${digits}`;

const cashSale = await createSale({
  source: "POS_ONLINE",
  deviceId: device.id,
  lines: [{ variantId: variant.id, quantity: "2" }],
  payments: [{ method: "CASH", amount: "230.00" }],
  customerMobile,
  clientTransactionUuid: `verify-acct-cash-${run}`,
  actorUserId: cashier.id,
});

const digitalSale = await createSale({
  source: "POS_ONLINE",
  deviceId: device.id,
  lines: [{ variantId: variant.id, quantity: "1" }],
  payments: [{ method: "BKASH", amount: "115.00", reference: `TRX-${run}` }],
  customerMobile,
  clientTransactionUuid: `verify-acct-bkash-${run}`,
  actorUserId: cashier.id,
});

const digitalPayment = await prisma.payment.findFirstOrThrow({
  where: { orderId: digitalSale.orderId },
  select: { id: true, paymentNumber: true },
});
await verifyPayment(digitalPayment.id, owner.id, { reference: `TRX-${run}` });

const refundItem = await prisma.orderItem.findFirstOrThrow({
  where: { orderId: cashSale.orderId },
  select: { id: true },
});
const refund = await requestRefund({
  orderId: cashSale.orderId,
  lines: [{ orderItemId: refundItem.id, quantity: "1", restock: true }],
  reason: "Verification accounting refund",
  method: "CASH",
  actorUserId: cashier.id,
});
await approveRefund(refund.refundId, owner.id);
await completeRefund(refund.refundId, owner.id);

const supplier = await createSupplier({
  name: `Verify accounting supplier ${run}`,
  paymentTermsDays: 0,
  leadTimeDays: 0,
  isDropshipVendor: false,
  status: "ACTIVE",
});
const purchaseOrder = await createPurchaseOrder({
  supplierId: supplier.id,
  warehouseId: warehouse.id,
  lines: [{ variantId: variant.id, quantity: "5", unitCost: "100" }],
});
await sendPurchaseOrder(purchaseOrder.id, owner.id);
const purchaseLine = await prisma.purchaseItem.findFirstOrThrow({
  where: { purchaseOrderId: purchaseOrder.id },
  select: { id: true },
});
const grn = await createGrn({
  purchaseOrderId: purchaseOrder.id,
  warehouseId: warehouse.id,
  lines: [
    { purchaseItemId: purchaseLine.id, quantity: "5", unitCost: "100", condition: "GOOD" },
  ],
});
await postGrn(grn.id, owner.id);

const shrink = await createAdjustment({
  warehouseId: warehouse.id,
  variantId: variant.id,
  adjustmentType: "DECREASE",
  quantity: "1",
  reason: `Verification count shortage ${run}`,
  actorUserId: owner.id,
});
await postAdjustment(shrink.id, owner.id);

const keptExpense = await createExpense({
  category: "Verification rent",
  accountId: rent.id,
  amount: "1000.00",
  vatAmount: "0",
  paymentMethod: "CASH",
  description: `Verification rent ${run}`,
  actorUserId: accountant.id,
});
await postExpense(keptExpense.id, owner.id);

const voidedExpense = await createExpense({
  category: "Verification utilities",
  accountId: rent.id,
  amount: "500.00",
  vatAmount: "0",
  paymentMethod: "CASH",
  description: `Verification utilities ${run}`,
  actorUserId: accountant.id,
});
await postExpense(voidedExpense.id, owner.id);
await voidExpense(voidedExpense.id, owner.id, "Verification void");

const { manual, manualReversal } = await prisma.$transaction(async (tx) => {
  const original = await postJournal(tx, {
    description: `Verification manual entry ${run}`,
    source: "MANUAL",
    referenceType: "verification",
    referenceId: run,
    actorUserId: owner.id,
    lines: [
      { account: "1000", debit: "10.00" },
      { account: "3000", credit: "10.00" },
    ],
  });
  assert.ok(original);
  const reversal = await reverseJournal(tx, {
    entryId: original.id,
    actorUserId: owner.id,
    reason: `Verification reversal ${run}`,
  });
  assert.ok(reversal);
  return { manual: original, manualReversal: reversal };
});

const cashAccount = await prisma.account.findUniqueOrThrow({
  where: { code: "1000" },
  select: { id: true, code: true, name: true },
});

const saleEntry = await prisma.journalEntry.findFirstOrThrow({
  where: { referenceType: "order", referenceId: cashSale.orderId },
  select: { id: true, entryNumber: true },
});
const paymentEntry = await prisma.journalEntry.findFirstOrThrow({
  where: { referenceType: "payment", referenceId: digitalPayment.id },
  select: { id: true, entryNumber: true },
});
const cashPayment = await prisma.payment.findFirstOrThrow({
  where: { orderId: cashSale.orderId },
  select: { id: true },
});
const cashPaymentEntry = await prisma.journalEntry.findFirstOrThrow({
  where: { referenceType: "payment", referenceId: cashPayment.id },
  select: { entryNumber: true },
});
const grnEntry = await prisma.journalEntry.findFirstOrThrow({
  where: { referenceType: "goods_received_note", referenceId: grn.id },
  select: { id: true, entryNumber: true },
});
const openingEntry = await prisma.journalEntry.findFirstOrThrow({
  where: { referenceType: "stock_adjustment", referenceId: opening.id },
  select: { id: true, entryNumber: true },
});
const shrinkEntry = await prisma.journalEntry.findFirstOrThrow({
  where: { referenceType: "stock_adjustment", referenceId: shrink.id },
  select: { id: true, entryNumber: true },
});
const keptExpenseEntry = await prisma.journalEntry.findFirstOrThrow({
  where: { referenceType: "expense", referenceId: keptExpense.id },
  select: { id: true, entryNumber: true },
});
const refundEntries = await prisma.journalEntry.findMany({
  where: { referenceType: "refund", referenceId: refund.refundId },
  orderBy: { createdAt: "asc" },
  select: { id: true, entryNumber: true, source: true },
});

const ownerCookie = sessionCookie(owner);
const accountantCookie = sessionCookie(accountant);
const cashierCookie = sessionCookie(cashier);

try {
  await check("anonymous visitors cannot reach any accounting screen", async () => {
    for (const path of [
      "/accounting",
      "/accounting/accounts",
      `/accounting/accounts/${cashAccount.id}`,
      "/accounting/journals",
      `/accounting/journals/${saleEntry.id}`,
      "/accounting/expenses",
    ]) {
      const response = await get(path);
      assert.ok([302, 303, 307, 308].includes(response.status), `${path} ${response.status}`);
      assert.match(response.location, /\/login/);
    }
  });

  await check("a cashier is refused the accounting section", async () => {
    for (const path of [
      "/accounting",
      "/accounting/accounts",
      "/accounting/journals",
      "/accounting/expenses",
    ]) {
      const response = await get(path, cashierCookie);
      assert.ok([302, 303, 307, 308].includes(response.status), `${path} ${response.status}`);
      assert.match(response.location, /\/forbidden/);
    }
    const dashboard = await get("/dashboard", cashierCookie);
    assert.equal(dashboard.status, 200);
    assert.doesNotMatch(dashboard.text, /href="\/accounting"/);
  });

  await check("an accountant can read every accounting screen", async () => {
    for (const path of [
      "/accounting",
      "/accounting/accounts",
      `/accounting/accounts/${cashAccount.id}`,
      "/accounting/journals",
      `/accounting/journals/${saleEntry.id}`,
      "/accounting/expenses",
    ]) {
      const response = await get(path, accountantCookie);
      assert.equal(response.status, 200, `${path} returned ${response.status}`);
    }
    const dashboard = await get("/dashboard", accountantCookie);
    assert.match(dashboard.text, /href="\/accounting"/);
  });

  await check("the trial balance page is balanced and shows the posted accounts", async () => {
    const balance = await trialBalance();
    assert.equal(balance.totalDebit.toFixed(2), balance.totalCredit.toFixed(2));
    assert.ok(balance.totalDebit.greaterThan(0));

    const page = await get("/accounting", accountantCookie);
    assert.equal(page.status, 200);
    const text = visible(page.text);
    assert.match(text, /Trial balance|Accounting · হিসাব/);
    assert.match(text, /Difference/);
    assert.match(text, /৳0\.00/);
    assert.match(text, /Inventory/);
    assert.match(text, /Product Sales/);
    assert.match(text, /VAT Payable/);
    assert.match(text, /Cost of Goods Sold/);
  });

  await check("every business event of this run is in the journal list", async () => {
    const page = await get("/accounting/journals", accountantCookie);
    assert.equal(page.status, 200);
    const text = visible(page.text);
    for (const entry of [
      saleEntry,
      paymentEntry,
      grnEntry,
      openingEntry,
      shrinkEntry,
      keptExpenseEntry,
      manualReversal,
    ]) {
      assert.ok(entry, "a journal entry was not created");
      assert.match(text, new RegExp(entry.entryNumber));
    }
    for (const entry of refundEntries) {
      assert.match(text, new RegExp(entry.entryNumber));
    }
    assert.match(text, /Pos Sale/);
    assert.match(text, /Purchase/);
    assert.match(text, /Expense/);
    assert.match(text, /reversal/);
  });

  await check("the sale journal detail is balanced and traceable to the order", async () => {
    const page = await get(`/accounting/journals/${saleEntry.id}`, ownerCookie);
    assert.equal(page.status, 200);
    const text = visible(page.text);
    assert.match(text, new RegExp(saleEntry.entryNumber));
    assert.match(text, /balanced/);
    assert.match(text, /1050 · Accounts Receivable/);
    assert.match(text, /4000 · Product Sales/);
    assert.match(text, /1400 · VAT Payable/);
    assert.match(text, /5000 · Cost of Goods Sold/);
    assert.match(text, /1100 · Inventory/);
    assert.match(text, new RegExp(cashSale.orderId));
    assert.match(text, /Post reversal/);
  });

  await check("the verified digital payment and the refund posted their own entries", async () => {
    const paymentPage = await get(`/accounting/journals/${paymentEntry.id}`, ownerCookie);
    assert.equal(paymentPage.status, 200);
    assert.match(visible(paymentPage.text), /1020 · bKash Merchant/);
    assert.match(visible(paymentPage.text), /1050 · Accounts Receivable/);

    assert.equal(refundEntries.length, 2);
    const restock = refundEntries.find((entry) => entry.source === "SALE_RETURN");
    const payout = refundEntries.find((entry) => entry.source === "REFUND");
    assert.ok(restock);
    assert.ok(payout);

    const restockPage = await get(`/accounting/journals/${restock.id}`, ownerCookie);
    assert.match(visible(restockPage.text), /1100 · Inventory/);
    assert.match(visible(restockPage.text), /5000 · Cost of Goods Sold/);

    const payoutPage = await get(`/accounting/journals/${payout.id}`, ownerCookie);
    assert.match(visible(payoutPage.text), /4030 · Sales Returns/);
    assert.match(visible(payoutPage.text), /1400 · VAT Payable/);
    assert.match(visible(payoutPage.text), /1000 · Cash on Hand/);
  });

  await check("the goods receipt owes the supplier and the adjustment writes shrinkage", async () => {
    const grnPage = await get(`/accounting/journals/${grnEntry.id}`, ownerCookie);
    assert.equal(grnPage.status, 200);
    const grnText = visible(grnPage.text);
    assert.match(grnText, /1100 · Inventory/);
    assert.match(grnText, /1300 · Accounts Payable/);
    assert.match(grnText, new RegExp(supplier.name));

    const shrinkPage = await get(`/accounting/journals/${shrinkEntry.id}`, ownerCookie);
    assert.match(visible(shrinkPage.text), /5020 · Inventory Shrinkage/);
    assert.match(visible(shrinkPage.text), /1100 · Inventory/);

    const openingPage = await get(`/accounting/journals/${openingEntry.id}`, ownerCookie);
    const openingText = visible(openingPage.text);
    assert.match(openingText, /Opening Balance|Opening stock/);
    assert.match(openingText, /3000 · Owner/);
  });

  await check("a posted expense is visible and a void leaves a reversal, not an edit", async () => {
    const page = await get("/accounting/expenses", accountantCookie);
    assert.equal(page.status, 200);
    const text = visible(page.text);
    assert.match(text, new RegExp(keptExpense.expenseNumber));
    assert.match(text, new RegExp(voidedExpense.expenseNumber));
    assert.match(text, /posted/);
    assert.match(text, /void/);

    const voided = await prisma.journalEntry.findFirstOrThrow({
      where: {
        referenceType: "expense",
        referenceId: voidedExpense.id,
        reversalOfId: { not: null },
      },
      select: { id: true, entryNumber: true, reversalOfId: true },
    });
    const original = await prisma.journalEntry.findUniqueOrThrow({
      where: { id: voided.reversalOfId! },
      select: { id: true, entryNumber: true, status: true },
    });
    assert.equal(original.status, "POSTED");

    const detail = await get(`/accounting/journals/${original.id}`, accountantCookie);
    assert.equal(detail.status, 200);
    assert.match(visible(detail.text), /Reversed by/);
    assert.match(visible(detail.text), new RegExp(voided.entryNumber));
  });

  await check("reversing a manual entry keeps both entries in the ledger", async () => {
    const page = await get(`/accounting/journals/${manual.id}`, ownerCookie);
    assert.equal(page.status, 200);
    assert.match(visible(page.text), /Reversed by/);
    assert.match(visible(page.text), new RegExp(manualReversal.entryNumber));

    const reversalPage = await get(`/accounting/journals/${manualReversal.id}`, ownerCookie);
    assert.equal(reversalPage.status, 200);
    const reversalText = visible(reversalPage.text);
    assert.match(reversalText, /Reverses/);
    assert.match(reversalText, new RegExp(manual.entryNumber));
    assert.match(reversalText, /balanced/);
  });

  await check("the chart of accounts and the cash ledger render real balances", async () => {
    const accounts = await get("/accounting/accounts", accountantCookie);
    assert.equal(accounts.status, 200);
    const accountsText = visible(accounts.text);
    assert.match(accountsText, /Chart of accounts/);
    assert.match(accountsText, /1000/);
    assert.match(accountsText, /Cash on Hand/);
    assert.match(accountsText, /New account/);

    const ledger = await get(`/accounting/accounts/${cashAccount.id}`, accountantCookie);
    assert.equal(ledger.status, 200);
    const ledgerText = visible(ledger.text);
    assert.match(ledgerText, new RegExp(cashAccount.code));
    assert.match(ledgerText, new RegExp(cashAccount.name));
    assert.match(ledgerText, /Closing balance/);
    assert.match(ledgerText, /1,000\.00/);
    // The sale entry debits receivable; the drawer entry is the cash movement.
    assert.match(ledgerText, new RegExp(cashPaymentEntry.entryNumber));
  });

  await check("the books still balance after the reversal", async () => {
    const balance = await trialBalance();
    assert.equal(balance.totalDebit.toFixed(2), balance.totalCredit.toFixed(2));

    const runEntries = await prisma.journalEntry.findMany({
      where: {
        OR: [
          { referenceType: "order", referenceId: cashSale.orderId },
          { referenceType: "payment", referenceId: { in: [cashPayment.id, digitalPayment.id] } },
          { referenceType: "refund", referenceId: refund.refundId },
          { referenceType: "goods_received_note", referenceId: grn.id },
          { referenceType: "stock_adjustment", referenceId: { in: [opening.id, shrink.id] } },
          { referenceType: "expense", referenceId: { in: [keptExpense.id, voidedExpense.id] } },
          { referenceType: "verification", referenceId: run },
        ],
      },
      select: { id: true },
    });
    const cashLines = await prisma.journalEntryLine.findMany({
      where: {
        accountId: cashAccount.id,
        journalEntryId: { in: runEntries.map((entry) => entry.id) },
      },
      select: { debit: true, credit: true },
    });
    // 230 cash sale − 115 refund − 1000 rent − 500 utilities + 500 void reversal
    // + 10 manual − 10 manual reversal
    const net = cashLines
      .reduce((sum, line) => sum.add(line.debit).sub(line.credit), new Prisma.Decimal(0))
      .toFixed(2);
    assert.equal(net, "-885.00");
  });
} finally {
  await prisma.productVariant
    .update({ where: { id: variant.id }, data: { status: "ARCHIVED" } })
    .catch(() => undefined);
  await prisma.product
    .update({ where: { id: product.id }, data: { isPublished: false } })
    .catch(() => undefined);
  await prisma.posDevice
    .update({ where: { id: device.id }, data: { status: "REVOKED" } })
    .catch(() => undefined);
  await prisma.warehouse
    .updateMany({ where: { code: "VERIFY-ACCT" }, data: { isActive: false } })
    .catch(() => undefined);
  await prisma.supplier
    .updateMany({ where: { id: supplier.id }, data: { status: "INACTIVE" } })
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
  "\nPosted journals are immutable, so this run's entries stay in the ledger; the " +
    "variant was archived, the device revoked, the warehouse deactivated and the " +
    "verification users suspended.",
);
console.log(`\n${checks - failures}/${checks} accounting checks passed.`);
process.exitCode = failures === 0 ? 0 : 1;
