/**
 * End-to-end loyalty verification.
 *
 *   npm run build
 *   STORAGE_PROVIDER=local npm start     # in another terminal
 *   npm run verify:loyalty
 *
 * Point it elsewhere with BASE_URL=http://localhost:3100 npm run verify:loyalty
 *
 * Proves over real HTTP: the loyalty section is closed to anonymous visitors and
 * to an accountant, a cashier can read it but cannot adjust points, the owner
 * sees the balance and the whole ledger, and the POS loyalty preview answers
 * 401/403/200 correctly. Mutations run through the same services the actions
 * call: a cash sale redeems points and earns new ones, a verified digital sale
 * earns, a refund and a cancellation reverse points, a manual adjustment posts a
 * journal and an expiry removes old points.
 *
 * Posted journals are immutable, so this run's entries stay in the ledger; the
 * variant is archived, the device revoked, the warehouse deactivated and the
 * verification users suspended.
 */
import { config } from "dotenv";
config({ path: [".env.local", ".env"], quiet: true });

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { prisma } from "../src/lib/db";
import { SESSION_VERSION, signSessionToken } from "../src/lib/auth/token";
import { hashPin } from "../src/lib/password";
import { postOpeningStock } from "../src/lib/inventory/service";
import { ACCOUNTS, postJournal } from "../src/lib/accounting/journal";
import {
  approveRefund,
  cancelOrder,
  completeRefund,
  createSale,
  requestRefund,
  verifyPayment,
} from "../src/lib/orders/service";
import {
  adjustPoints,
  expirePoints,
  LOYALTY,
} from "../src/lib/loyalty/service";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const COOKIE = process.env.SESSION_COOKIE_NAME?.trim() || "bgd26_session";
const MANAGER_PIN = "135790";

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

async function api(path: string, cookie?: string) {
  const response = await fetch(`${BASE}${path}`, {
    headers: cookie ? { cookie } : undefined,
  });
  const body = (await response.json().catch(() => null)) as
    | {
        customer?: { id: string; name: string; balance: number } | null;
        maxPoints?: number;
        error?: string;
      }
    | null;
  return { status: response.status, body };
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

const [ownerRole, accountantRole, cashierRole, category, store] = await Promise.all([
  prisma.role.findUniqueOrThrow({ where: { code: "OWNER" }, select: { id: true } }),
  prisma.role.findUniqueOrThrow({ where: { code: "ACCOUNTANT" }, select: { id: true } }),
  prisma.role.findUniqueOrThrow({ where: { code: "CASHIER" }, select: { id: true } }),
  prisma.category.findFirstOrThrow({
    where: { isActive: true },
    orderBy: { sortOrder: "asc" },
    select: { id: true },
  }),
  prisma.store.findFirstOrThrow({
    where: { isActive: true },
    orderBy: { code: "asc" },
    select: { id: true },
  }),
]);

const warehouse = await prisma.warehouse.upsert({
  where: { code: "VERIFY-LOYALTY" },
  update: { isActive: true },
  create: {
    code: "VERIFY-LOYALTY",
    name: "Verify loyalty warehouse",
    type: "SECONDARY",
    isActive: true,
  },
  select: { id: true, code: true },
});

const [owner, accountant, cashier] = await Promise.all([
  prisma.user.create({
    data: {
      email: `verify-loyalty-owner-${run}@example.test`,
      fullName: "Verify Loyalty Owner",
      status: "ACTIVE",
      mustChangePassword: false,
      managerPinHash: await hashPin(MANAGER_PIN),
      userRoles: { create: [{ roleId: ownerRole.id }] },
    },
    select: { id: true, email: true },
  }),
  prisma.user.create({
    data: {
      email: `verify-loyalty-accountant-${run}@example.test`,
      fullName: "Verify Loyalty Accountant",
      status: "ACTIVE",
      mustChangePassword: false,
      userRoles: { create: [{ roleId: accountantRole.id }] },
    },
    select: { id: true, email: true },
  }),
  prisma.user.create({
    data: {
      email: `verify-loyalty-cashier-${run}@example.test`,
      fullName: "Verify Loyalty Cashier",
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
    name: `Verify loyalty product ${run}`,
    slug: `verify-loyalty-${run}`,
    status: "ACTIVE",
    isPublished: false,
    basePrice: "115.00",
  },
  select: { id: true },
});

const variant = await prisma.productVariant.create({
  data: {
    productId: product.id,
    sku: `VERIFY-LOY-${run.toUpperCase()}`,
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
    code: `LY${run}`.toUpperCase(),
    name: `Verify loyalty till ${run}`,
    storeId: store.id,
    warehouseId: warehouse.id,
    deviceFingerprint: `verify-loyalty-fp-${run}`,
    platform: "verification",
    registeredByUserId: owner.id,
  },
  select: { id: true, code: true },
});

await postOpeningStock({
  variantId: variant.id,
  warehouseId: warehouse.id,
  quantity: "100",
  unitCost: "80",
  note: `Verification opening ${run}`,
  actorUserId: owner.id,
});

const mainMobile = `+88017${digits.slice(0, 8)}`;
const expiryMobile = `+88018${digits.slice(0, 8)}`;

const mainCustomer = await prisma.customer.create({
  data: {
    mobileNormalized: mainMobile,
    mobileRaw: `01${mainMobile.slice(5)}`,
    fullName: `Verify loyalty customer ${run}`,
    loyaltyPointsBalance: 500,
    loyaltyTransactions: {
      create: {
        type: "EARN",
        points: 500,
        balanceAfter: 500,
        expiresAt: new Date(Date.now() + 300 * 24 * 60 * 60 * 1000),
        referenceType: "verification_seed",
        referenceId: run,
        note: "Verification opening points",
        createdByUserId: owner.id,
      },
    },
  },
  select: { id: true, mobileNormalized: true, fullName: true },
});

const expiryCustomer = await prisma.customer.create({
  data: {
    mobileNormalized: expiryMobile,
    mobileRaw: `01${expiryMobile.slice(5)}`,
    fullName: `Verify expiry customer ${run}`,
    loyaltyPointsBalance: 30,
    loyaltyTransactions: {
      create: {
        type: "EARN",
        points: 30,
        balanceAfter: 30,
        expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
        referenceType: "verification_seed",
        referenceId: run,
        note: "Old verification points",
        createdByUserId: owner.id,
      },
    },
  },
  select: { id: true, mobileNormalized: true, fullName: true },
});

// The seeded balances must have a matching liability in the books, otherwise
// the loyalty accounts would start from a one-sided balance.
const [mainSeed, expirySeed] = await Promise.all([
  prisma.loyaltyTransaction.findFirstOrThrow({
    where: { customerId: mainCustomer.id, referenceType: "verification_seed" },
    select: { id: true },
  }),
  prisma.loyaltyTransaction.findFirstOrThrow({
    where: { customerId: expiryCustomer.id, referenceType: "verification_seed" },
    select: { id: true },
  }),
]);

await prisma.$transaction(async (tx) => {
  await postJournal(tx, {
    description: `Verification opening loyalty points · ${run}`,
    source: "MANUAL",
    referenceType: "loyalty_transaction",
    referenceId: mainSeed.id,
    actorUserId: owner.id,
    lines: [
      { account: ACCOUNTS.loyaltyExpense, debit: 500 },
      { account: ACCOUNTS.loyaltyLiability, credit: 500, customerId: mainCustomer.id },
    ],
  });
  await postJournal(tx, {
    description: `Verification opening loyalty points · ${run}`,
    source: "MANUAL",
    referenceType: "loyalty_transaction",
    referenceId: expirySeed.id,
    actorUserId: owner.id,
    lines: [
      { account: ACCOUNTS.loyaltyExpense, debit: 30 },
      { account: ACCOUNTS.loyaltyLiability, credit: 30, customerId: expiryCustomer.id },
    ],
  });
});

const cashSale = await createSale({
  source: "POS_ONLINE",
  deviceId: device.id,
  customerMobile: mainCustomer.mobileNormalized,
  lines: [{ variantId: variant.id, quantity: "10" }],
  loyaltyRedeemPoints: 100,
  payments: [{ method: "CASH", amount: "1050.00" }],
  clientTransactionUuid: `verify-loyalty-cash-${run}`,
  actorUserId: cashier.id,
});

const digitalSale = await createSale({
  source: "POS_ONLINE",
  deviceId: device.id,
  customerMobile: mainCustomer.mobileNormalized,
  lines: [{ variantId: variant.id, quantity: "1" }],
  payments: [{ method: "BKASH", amount: "115.00", reference: `TRX-${run}` }],
  clientTransactionUuid: `verify-loyalty-bkash-${run}`,
  actorUserId: cashier.id,
});

const digitalPayment = await prisma.payment.findFirstOrThrow({
  where: { orderId: digitalSale.orderId },
  select: { id: true },
});
await verifyPayment(digitalPayment.id, owner.id, { reference: `TRX-${run}` });

const refundItem = await prisma.orderItem.findFirstOrThrow({
  where: { orderId: cashSale.orderId },
  select: { id: true },
});
const refund = await requestRefund({
  orderId: cashSale.orderId,
  lines: [{ orderItemId: refundItem.id, quantity: "1", restock: true }],
  reason: "Verification loyalty refund",
  method: "CASH",
  actorUserId: cashier.id,
});
await approveRefund(refund.refundId, owner.id);
await completeRefund(refund.refundId, owner.id);

await cancelOrder(digitalSale.orderId, owner.id, "Verification loyalty cancellation");

const adjustment = await adjustPoints({
  customerId: mainCustomer.id,
  points: 25,
  reason: "Verification goodwill grant",
  actorUserId: owner.id,
});

const expiry = await expirePoints({
  customerId: expiryCustomer.id,
  actorUserId: owner.id,
});

const mainBalance = await prisma.customer.findUniqueOrThrow({
  where: { id: mainCustomer.id },
  select: { loyaltyPointsBalance: true },
});
// 500 seed − 100 redeemed + 10 earned − 1 refunded + 1 digital earned
// − 1 cancellation + 25 adjustment = 434
assert.equal(mainBalance.loyaltyPointsBalance, 434);

const cashEarn = await prisma.loyaltyTransaction.findFirstOrThrow({
  where: { orderId: cashSale.orderId, type: "EARN" },
  select: { id: true, points: true },
});
const digitalEarn = await prisma.loyaltyTransaction.findFirstOrThrow({
  where: { orderId: digitalSale.orderId, type: "EARN" },
  select: { id: true, points: true },
});
const redeem = await prisma.loyaltyTransaction.findFirstOrThrow({
  where: { orderId: cashSale.orderId, type: "REDEEM" },
  select: { id: true, points: true },
});
const refundReversal = await prisma.loyaltyTransaction.findFirstOrThrow({
  where: { orderId: cashSale.orderId, type: "REVERSAL", referenceType: "refund" },
  select: { id: true, points: true },
});
const cancelReversal = await prisma.loyaltyTransaction.findFirstOrThrow({
  where: { orderId: digitalSale.orderId, type: "REVERSAL", referenceType: "order_cancel_earn" },
  select: { id: true, points: true },
});
const expiryTxn = await prisma.loyaltyTransaction.findFirstOrThrow({
  where: { customerId: expiryCustomer.id, type: "EXPIRE" },
  select: { id: true, points: true },
});

assert.equal(redeem.points, -100);
assert.equal(cashEarn.points, 10);
assert.equal(digitalEarn.points, 1);
assert.equal(refundReversal.points, -1);
assert.equal(cancelReversal.points, -1);
assert.equal(expiryTxn.points, -30);
assert.equal(expiry.points, 30);

const [saleEntry, cashEarnEntry, digitalEarnEntry, refundEntry, adjustmentEntry, expiryEntry] =
  await Promise.all([
    prisma.journalEntry.findFirstOrThrow({
      where: { referenceType: "order", referenceId: cashSale.orderId },
      select: { id: true, entryNumber: true },
    }),
    prisma.journalEntry.findFirstOrThrow({
      where: { referenceType: "loyalty_transaction", referenceId: cashEarn.id },
      select: { id: true, entryNumber: true },
    }),
    prisma.journalEntry.findFirstOrThrow({
      where: { referenceType: "loyalty_transaction", referenceId: digitalEarn.id },
      select: { id: true, entryNumber: true },
    }),
    prisma.journalEntry.findFirstOrThrow({
      where: { referenceType: "loyalty_transaction", referenceId: refundReversal.id },
      select: { id: true, entryNumber: true },
    }),
    prisma.journalEntry.findFirstOrThrow({
      where: { referenceType: "loyalty_transaction", referenceId: adjustment.transactionId },
      select: { id: true, entryNumber: true },
    }),
    prisma.journalEntry.findFirstOrThrow({
      where: { referenceType: "loyalty_transaction", referenceId: expiryTxn.id },
      select: { id: true, entryNumber: true },
    }),
  ]);

const saleLiability = await prisma.journalEntryLine.findFirstOrThrow({
  where: { journalEntryId: saleEntry.id, account: { code: "1500" } },
  select: { debit: true, credit: true },
});
assert.equal(saleLiability.debit.toFixed(2), "100.00");

const ownerCookie = sessionCookie(owner);
const accountantCookie = sessionCookie(accountant);
const cashierCookie = sessionCookie(cashier);

try {
  await check("anonymous visitors cannot reach the loyalty section", async () => {
    for (const path of ["/loyalty", `/loyalty/${mainCustomer.id}`]) {
      const response = await get(path);
      assert.ok([302, 303, 307, 308].includes(response.status), `${path} ${response.status}`);
      assert.match(response.location, /\/login/);
    }
  });

  await check("an accountant without customer.read is refused", async () => {
    for (const path of ["/loyalty", `/loyalty/${mainCustomer.id}`]) {
      const response = await get(path, accountantCookie);
      assert.ok([302, 303, 307, 308].includes(response.status), `${path} ${response.status}`);
      assert.match(response.location, /\/forbidden/);
    }
    const dashboard = await get("/dashboard", accountantCookie);
    assert.equal(dashboard.status, 200);
    assert.doesNotMatch(dashboard.text, /href="\/loyalty"/);
  });

  await check("a cashier can read loyalty but cannot adjust points", async () => {
    const page = await get("/loyalty", cashierCookie);
    assert.equal(page.status, 200);
    const text = visible(page.text);
    assert.match(text, /Loyalty · লয়্যালটি/);
    assert.match(text, new RegExp(mainCustomer.fullName));
    assert.doesNotMatch(text, /Manual adjustment/);

    const ledger = await get(`/loyalty/${mainCustomer.id}`, cashierCookie);
    assert.equal(ledger.status, 200);
    assert.match(visible(ledger.text), /Points ledger/);
    assert.doesNotMatch(visible(ledger.text), /Manual adjustment/);

    const dashboard = await get("/dashboard", cashierCookie);
    assert.match(dashboard.text, /href="\/loyalty"/);
  });

  await check("the owner sees the balance, the rules and the whole ledger", async () => {
    const page = await get("/loyalty", ownerCookie);
    assert.equal(page.status, 200);
    const text = visible(page.text);
    assert.match(text, /Loyalty · লয়্যালটি/);
    assert.match(text, /Outstanding points/);
    assert.match(text, /Recent movements/);
    assert.match(text, new RegExp(mainCustomer.fullName));
    assert.match(text, /434/);

    const ledger = await get(`/loyalty/${mainCustomer.id}`, ownerCookie);
    assert.equal(ledger.status, 200);
    const ledgerText = visible(ledger.text);
    assert.match(ledgerText, /Points ledger/);
    assert.match(ledgerText, /Manual adjustment/);
    assert.match(ledgerText, /EARN/);
    assert.match(ledgerText, /REDEEM/);
    assert.match(ledgerText, /REVERSAL/);
    assert.match(ledgerText, /ADJUSTMENT/);
    assert.match(ledgerText, /434/);
  });

  await check("expiry removes old points and shows an EXPIRE row", async () => {
    const page = await get(`/loyalty/${expiryCustomer.id}`, ownerCookie);
    assert.equal(page.status, 200);
    const text = visible(page.text);
    assert.match(text, /EXPIRE/);
    assert.match(text, /30/);
    assert.match(text, /0/);
  });

  await check("the customer profile links to the loyalty ledger", async () => {
    const page = await get(`/customers/${mainCustomer.id}`, ownerCookie);
    assert.equal(page.status, 200);
    assert.match(visible(page.text), /open ledger/);
    assert.match(page.text, new RegExp(`/loyalty/${mainCustomer.id}`));
  });

  await check("the POS loyalty preview answers 401, 403 and 200 correctly", async () => {
    const anonymous = await api(
      `/api/pos/loyalty?mobile=${encodeURIComponent(mainCustomer.mobileNormalized)}&subtotal=1000&discount=0`,
    );
    assert.equal(anonymous.status, 401);

    const accountantResponse = await api(
      `/api/pos/loyalty?mobile=${encodeURIComponent(mainCustomer.mobileNormalized)}&subtotal=1000&discount=0`,
      accountantCookie,
    );
    assert.equal(accountantResponse.status, 403);

    const cashierResponse = await api(
      `/api/pos/loyalty?mobile=${encodeURIComponent(mainCustomer.mobileNormalized)}&subtotal=1000&discount=0`,
      cashierCookie,
    );
    assert.equal(cashierResponse.status, 200);
    assert.equal(cashierResponse.body?.customer?.balance, 434);
    assert.equal(cashierResponse.body?.maxPoints, 200);
    assert.equal(LOYALTY.pointValue, 1);

    const unknown = await api(
      `/api/pos/loyalty?mobile=${encodeURIComponent("+8801999999999")}&subtotal=1000&discount=0`,
      cashierCookie,
    );
    assert.equal(unknown.status, 200);
    assert.equal(unknown.body?.customer ?? null, null);
    assert.equal(unknown.body?.maxPoints, 0);
  });

  await check("every loyalty movement posted a balanced journal", async () => {
    const entries = await prisma.journalEntry.findMany({
      where: {
        id: {
          in: [
            saleEntry.id,
            cashEarnEntry.id,
            digitalEarnEntry.id,
            refundEntry.id,
            adjustmentEntry.id,
            expiryEntry.id,
          ],
        },
      },
      select: { id: true, status: true, totalDebit: true, totalCredit: true },
    });
    assert.equal(entries.length, 6);
    for (const entry of entries) {
      assert.equal(entry.status, "POSTED");
      assert.equal(entry.totalDebit.toFixed(2), entry.totalCredit.toFixed(2));
    }

    const adjustmentLines = await prisma.journalEntryLine.findMany({
      where: { journalEntryId: adjustmentEntry.id },
      select: { debit: true, credit: true, account: { select: { code: true } } },
    });
    const expense = adjustmentLines.find((line) => line.account.code === "5500");
    const liability = adjustmentLines.find((line) => line.account.code === "1500");
    assert.equal(expense?.debit.toFixed(2), "25.00");
    assert.equal(liability?.credit.toFixed(2), "25.00");

    const expiryLines = await prisma.journalEntryLine.findMany({
      where: { journalEntryId: expiryEntry.id },
      select: { debit: true, credit: true, account: { select: { code: true } } },
    });
    assert.equal(
      expiryLines.find((line) => line.account.code === "1500")?.debit.toFixed(2),
      "30.00",
    );
    assert.equal(
      expiryLines.find((line) => line.account.code === "5500")?.credit.toFixed(2),
      "30.00",
    );
  });

  await check("the accounting pages show the loyalty accounts and entries", async () => {
    const journals = await get("/accounting/journals", ownerCookie);
    assert.equal(journals.status, 200);
    const text = visible(journals.text);
    for (const entry of [cashEarnEntry, adjustmentEntry, expiryEntry]) {
      assert.match(text, new RegExp(entry.entryNumber));
    }

    const trial = await get("/accounting", ownerCookie);
    assert.equal(trial.status, 200);
    const trialText = visible(trial.text);
    assert.match(trialText, /Loyalty Points Liability/);
    assert.match(trialText, /Loyalty Expense/);
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
    .update({ where: { code: "VERIFY-LOYALTY" }, data: { isActive: false } })
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
console.log(`\n${checks - failures}/${checks} loyalty checks passed.`);
process.exitCode = failures === 0 ? 0 : 1;
