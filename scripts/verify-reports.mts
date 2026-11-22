/**
 * End-to-end financial statement verification.
 *
 *   npm run build
 *   STORAGE_PROVIDER=local npm start     # in another terminal
 *   npm run verify:reports
 *
 * Point it elsewhere with BASE_URL=http://localhost:3100 npm run verify:reports
 *
 * Proves over real HTTP: the three statements render for staff, an anonymous
 * visitor and a cashier are refused, the profit and loss statement matches a
 * known set of posted journals, the balance sheet balances, and the cash-flow
 * statement ties its net change to the cash accounts.
 *
 * The verification posts into a quiet past day derived from this run, so
 * existing data cannot move the expected profit and the entries never crowd the
 * journal browser. Posted journals are immutable and stay in the ledger by
 * design.
 */
import { config } from "dotenv";
config({ path: [".env.local", ".env"], quiet: true });

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { prisma } from "../src/lib/db";
import { SESSION_VERSION, signSessionToken } from "../src/lib/auth/token";
import { postJournal, reverseJournal } from "../src/lib/accounting/journal";
import { formatMoney } from "../src/lib/inventory/format";

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
// A quiet past day, so this run's entries never crowd page one of the journal
// browser. The day is derived from the run id; the odds of two runs colliding
// on the same day are about one in ten thousand.
const year = 1990 + (Number.parseInt(run, 16) % 30);
const month = 1 + (Number.parseInt(run.slice(0, 2), 16) % 12);
const day = 1 + (Number.parseInt(run.slice(2, 4), 16) % 28);
const stamp = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
const sale = 1000 + (Number.parseInt(run.slice(4, 8), 16) % 500);
const periodStart = new Date(`${year}-01-01T00:00:00.000Z`);
const periodEnd = new Date(`${year}-12-31T23:59:59.999Z`);
const entryDate = new Date(`${stamp}T12:00:00.000Z`);
const from = stamp;
const to = stamp;

const [ownerRole, cashierRole] = await Promise.all([
  prisma.role.findUniqueOrThrow({ where: { code: "OWNER" }, select: { id: true } }),
  prisma.role.findUniqueOrThrow({ where: { code: "CASHIER" }, select: { id: true } }),
]);

const owner = await prisma.user.create({
  data: {
    email: `verify-reports-${run}@bgd26.test`,
    fullName: `Verify reports owner ${run}`,
    passwordHash: "not-used-by-this-script",
    status: "ACTIVE",
    userRoles: { create: { roleId: ownerRole.id } },
  },
  select: { id: true, email: true },
});

const cashier = await prisma.user.create({
  data: {
    email: `verify-reports-cashier-${run}@bgd26.test`,
    fullName: `Verify reports cashier ${run}`,
    passwordHash: "not-used-by-this-script",
    status: "ACTIVE",
    userRoles: { create: { roleId: cashierRole.id } },
  },
  select: { id: true, email: true },
});

const ownerCookie = sessionCookie(owner);
const cashierCookie = sessionCookie(cashier);

const existingPeriod = await prisma.fiscalPeriod.findFirst({
  where: { startDate: periodStart, endDate: periodEnd },
  select: { id: true },
});
if (!existingPeriod) {
  await prisma.fiscalPeriod.create({
    data: { name: `Verification ${year}`, startDate: periodStart, endDate: periodEnd, status: "OPEN" },
  });
}

async function entry(description: string, lines: Array<{ account: string; debit?: string; credit?: string }>) {
  return prisma.$transaction(async (tx) =>
    postJournal(tx, {
      entryDate,
      description,
      source: "MANUAL",
      referenceType: "verification",
      referenceId: `reports-${run}-${description}`,
      actorUserId: owner.id,
      lines,
    }),
  );
}

await entry("Reports verification capital", [
  { account: "1000", debit: "5000" },
  { account: "3000", credit: "5000" },
]);
await entry("Reports verification opening inventory", [
  { account: "1100", debit: "1000" },
  { account: "3000", credit: "1000" },
]);
const saleEntry = await entry("Reports verification sale", [
  { account: "1000", debit: String(sale) },
  { account: "4000", credit: String(sale) },
]);
await entry("Reports verification discount", [
  { account: "4020", debit: "100" },
  { account: "1000", credit: "100" },
]);
await entry("Reports verification cost", [
  { account: "5000", debit: "400" },
  { account: "1100", credit: "400" },
]);
await entry("Reports verification rent", [
  { account: "6000", debit: "200" },
  { account: "1000", credit: "200" },
]);

const expectedProfit = sale - 700;
const expectedNetCash = sale + 4700;

await check("an anonymous visitor is sent to login from the reports", async () => {
  const page = await get("/accounting/reports");
  assert.equal(page.status, 307);
  assert.match(page.location, /\/login/);
});

await check("a cashier without report.read is sent to forbidden", async () => {
  const page = await get("/accounting/reports", cashierCookie);
  assert.equal(page.status, 307);
  assert.match(page.location, /\/forbidden/);
});

await check("the profit and loss page matches the posted journals", async () => {
  const page = await get(
    `/accounting/reports?from=${from}&to=${to}`,
    ownerCookie,
  );
  assert.equal(page.status, 200);
  const text = visible(page.text);
  assert.match(text, /Profit & loss/);
  assert.match(text, new RegExp(`৳${formatMoney(expectedProfit)}`));
  assert.match(text, /Net revenue/);
  assert.match(text, /Cost of sales/);
  assert.match(text, /Operating expenses/);
});

await check("the balance sheet renders and balances", async () => {
  const page = await get(
    `/accounting/reports/balance-sheet?asOf=${to}`,
    ownerCookie,
  );
  assert.equal(page.status, 200);
  const text = visible(page.text);
  assert.match(text, /Balance sheet/);
  assert.match(text, /Balanced/);
  assert.match(text, /Total assets/);
  assert.match(text, /Liabilities \+ equity/);
});

await check("the cash flow page ties the net change to cash", async () => {
  const page = await get(
    `/accounting/reports/cash-flow?from=${from}&to=${to}`,
    ownerCookie,
  );
  assert.equal(page.status, 200);
  const text = visible(page.text);
  assert.match(text, /Cash flow/);
  assert.match(text, new RegExp(`৳${formatMoney(expectedNetCash)}`));
  assert.match(text, /Operating inflows/);
  assert.match(text, /Financing inflows/);
  assert.match(text, new RegExp(`৳${formatMoney(sale)}`));
});

await check("the accounting navigation exposes the reports", async () => {
  const page = await get("/accounting", ownerCookie);
  assert.equal(page.status, 200);
  const text = visible(page.text);
  assert.match(text, /Reports/);
  assert.match(text, /প্রতিবেদন/);
});

await check("the three statements are linked to each other", async () => {
  const page = await get("/accounting/reports", ownerCookie);
  assert.equal(page.status, 200);
  assert.match(page.text, /\/accounting\/reports\/balance-sheet/);
  assert.match(page.text, /\/accounting\/reports\/cash-flow/);
});

await check("a reversal removes the sale from the profit and loss statement", async () => {
  assert.ok(saleEntry);
  await prisma.$transaction(async (tx) =>
    reverseJournal(tx, {
      entryId: saleEntry.id,
      actorUserId: owner.id,
      reason: `Reports verification reversal ${run}`,
      entryDate,
    }),
  );

  const page = await get(
    `/accounting/reports?from=${from}&to=${to}`,
    ownerCookie,
  );
  assert.equal(page.status, 200);
  const text = visible(page.text);
  // Revenue is now only the 100 discount, so the result is 0 - 400 - 200.
  assert.match(text, new RegExp(`৳${formatMoney(-700)}`));
  assert.doesNotMatch(text, new RegExp(`৳${formatMoney(sale - 700)}`));
});

console.log(`\n${checks - failures}/${checks} report checks passed`);
if (failures > 0) process.exitCode = 1;
