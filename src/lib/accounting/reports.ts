import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { money, type Numeric } from "@/lib/inventory/decimal";

/**
 * Financial statements built from posted journals.
 *
 * Every number here is a sum of `journal_entry_lines` on a `POSTED` entry. The
 * reports never read orders, stock or payments directly: if it is not in the
 * ledger, it is not in the statement. Reversals are ordinary posted entries, so
 * a corrected mistake shows up exactly once, net.
 *
 * Sign conventions:
 *  - revenue is credit-positive (`credit - debit`), so a discount or return
 *    account with a debit balance reduces net revenue;
 *  - expenses are debit-positive (`debit - credit`);
 *  - assets are debit-positive, liabilities and equity credit-positive.
 *
 * There are no closing entries yet, so the profit and loss accounts keep their
 * cumulative balance. The balance sheet therefore presents that cumulative
 * result as "accumulated earnings" inside equity, which makes assets equal
 * liabilities plus equity by construction.
 */

export type StatementRow = {
  id: string;
  code: string;
  name: string;
  nameBn: string | null;
  amount: Prisma.Decimal;
};

type RawBalance = {
  id: string;
  code: string;
  name: string;
  nameBn: string | null;
  type: string;
  debit: string;
  credit: string;
};

async function accountBalances(
  options?: { from?: Date; to?: Date },
  outer?: Prisma.TransactionClient,
): Promise<RawBalance[]> {
  const client = outer ?? prisma;
  const conditions: Prisma.Sql[] = [Prisma.sql`e."status" = 'POSTED'`];
  if (options?.from) conditions.push(Prisma.sql`e."entryDate" >= ${options.from}`);
  if (options?.to) conditions.push(Prisma.sql`e."entryDate" <= ${options.to}`);
  const where = Prisma.join(conditions, " AND ");

  return client.$queryRaw<RawBalance[]>(Prisma.sql`
    SELECT
      a."id",
      a."code",
      a."name",
      a."nameBn",
      a."type"::text AS "type",
      COALESCE(SUM(l."debit"), 0)::text AS "debit",
      COALESCE(SUM(l."credit"), 0)::text AS "credit"
    FROM "accounts" a
    JOIN "journal_entry_lines" l ON l."accountId" = a."id"
    JOIN "journal_entries" e ON e."id" = l."journalEntryId"
    WHERE ${where}
    GROUP BY a."id", a."code", a."name", a."nameBn", a."type"
    ORDER BY a."code"
  `);
}

function signed(type: string, debit: Numeric, credit: Numeric): Prisma.Decimal {
  const d = money(debit);
  const c = money(credit);
  if (type === "REVENUE" || type === "LIABILITY" || type === "EQUITY") {
    return money(c.sub(d));
  }
  return money(d.sub(c));
}

function row(balance: RawBalance): StatementRow {
  return {
    id: balance.id,
    code: balance.code,
    name: balance.name,
    nameBn: balance.nameBn,
    amount: signed(balance.type, balance.debit, balance.credit),
  };
}

function sumRows(rows: StatementRow[]): Prisma.Decimal {
  return rows.reduce((sum, line) => sum.add(line.amount), money(0));
}

const COGS_CODES = new Set(["5000", "5010", "5020", "5030"]);

/* -------------------------------------------------------------------------- */
/* Profit and loss                                                            */
/* -------------------------------------------------------------------------- */

export type ProfitAndLoss = {
  from: Date;
  to: Date;
  revenue: StatementRow[];
  netRevenue: Prisma.Decimal;
  costOfSales: StatementRow[];
  totalCostOfSales: Prisma.Decimal;
  grossProfit: Prisma.Decimal;
  operatingExpenses: StatementRow[];
  totalOperatingExpenses: Prisma.Decimal;
  netProfit: Prisma.Decimal;
};

export async function profitAndLoss(
  from: Date,
  to: Date,
  outer?: Prisma.TransactionClient,
): Promise<ProfitAndLoss> {
  const balances = await accountBalances({ from, to }, outer);
  const revenue = balances
    .filter((line) => line.type === "REVENUE")
    .map(row)
    .filter((line) => !line.amount.isZero());
  const expenses = balances
    .filter((line) => line.type === "EXPENSE")
    .map(row)
    .filter((line) => !line.amount.isZero());

  const costOfSales = expenses.filter((line) => COGS_CODES.has(line.code));
  const operatingExpenses = expenses.filter((line) => !COGS_CODES.has(line.code));

  const netRevenue = sumRows(revenue);
  const totalCostOfSales = sumRows(costOfSales);
  const grossProfit = money(netRevenue.sub(totalCostOfSales));
  const totalOperatingExpenses = sumRows(operatingExpenses);
  const netProfit = money(grossProfit.sub(totalOperatingExpenses));

  return {
    from,
    to,
    revenue,
    netRevenue,
    costOfSales,
    totalCostOfSales,
    grossProfit,
    operatingExpenses,
    totalOperatingExpenses,
    netProfit,
  };
}

/* -------------------------------------------------------------------------- */
/* Balance sheet                                                              */
/* -------------------------------------------------------------------------- */

export type BalanceSheet = {
  asOf: Date;
  assets: StatementRow[];
  totalAssets: Prisma.Decimal;
  liabilities: StatementRow[];
  totalLiabilities: Prisma.Decimal;
  equity: StatementRow[];
  accumulatedEarnings: Prisma.Decimal;
  totalEquity: Prisma.Decimal;
  totalLiabilitiesAndEquity: Prisma.Decimal;
  difference: Prisma.Decimal;
  balanced: boolean;
};

export async function balanceSheet(
  asOf: Date,
  outer?: Prisma.TransactionClient,
): Promise<BalanceSheet> {
  const balances = await accountBalances({ to: asOf }, outer);
  const assets = balances
    .filter((line) => line.type === "ASSET")
    .map(row)
    .filter((line) => !line.amount.isZero());
  const liabilities = balances
    .filter((line) => line.type === "LIABILITY")
    .map(row)
    .filter((line) => !line.amount.isZero());
  const equity = balances
    .filter((line) => line.type === "EQUITY")
    .map(row)
    .filter((line) => !line.amount.isZero());

  const revenue = balances
    .filter((line) => line.type === "REVENUE")
    .map(row)
    .reduce((sum, line) => sum.add(line.amount), money(0));
  const expenses = balances
    .filter((line) => line.type === "EXPENSE")
    .map(row)
    .reduce((sum, line) => sum.add(line.amount), money(0));
  const accumulatedEarnings = money(revenue.sub(expenses));

  const totalAssets = sumRows(assets);
  const totalLiabilities = sumRows(liabilities);
  const totalEquity = money(sumRows(equity).add(accumulatedEarnings));
  const totalLiabilitiesAndEquity = money(totalLiabilities.add(totalEquity));
  const difference = money(totalAssets.sub(totalLiabilitiesAndEquity));

  return {
    asOf,
    assets,
    totalAssets,
    liabilities,
    totalLiabilities,
    equity,
    accumulatedEarnings,
    totalEquity,
    totalLiabilitiesAndEquity,
    difference,
    balanced: difference.isZero(),
  };
}

/* -------------------------------------------------------------------------- */
/* Cash flow                                                                  */
/* -------------------------------------------------------------------------- */

/** Cash and cash-equivalent accounts. Receivables and COD clearing are not cash. */
export const CASH_ACCOUNT_CODES = ["1000", "1010", "1020", "1030", "1040"] as const;

export type CashFlowCategory = "OPERATING" | "FINANCING";

export type CashFlowEntry = {
  id: string;
  entryNumber: string;
  entryDate: Date;
  description: string;
  category: CashFlowCategory;
  amount: Prisma.Decimal;
};

export type CashFlow = {
  from: Date;
  to: Date;
  openingCash: Prisma.Decimal;
  operatingIn: Prisma.Decimal;
  operatingOut: Prisma.Decimal;
  financingIn: Prisma.Decimal;
  financingOut: Prisma.Decimal;
  netChange: Prisma.Decimal;
  closingCash: Prisma.Decimal;
  entries: CashFlowEntry[];
};

const cashList = Prisma.join(CASH_ACCOUNT_CODES.map((code) => Prisma.sql`${code}`));

async function cashAt(
  date: Date,
  inclusive: boolean,
  outer?: Prisma.TransactionClient,
): Promise<Prisma.Decimal> {
  const client = outer ?? prisma;
  const rows = await client.$queryRaw<Array<{ amount: string }>>(Prisma.sql`
    SELECT COALESCE(SUM(l."debit" - l."credit"), 0)::text AS "amount"
    FROM "journal_entry_lines" l
    JOIN "journal_entries" e ON e."id" = l."journalEntryId"
    JOIN "accounts" a ON a."id" = l."accountId"
    WHERE e."status" = 'POSTED'
      AND a."code" IN (${cashList})
      AND e."entryDate" ${inclusive ? Prisma.sql`<=` : Prisma.sql`<`} ${date}
  `);
  return money(rows[0]?.amount ?? "0");
}

export async function cashFlow(
  from: Date,
  to: Date,
  outer?: Prisma.TransactionClient,
): Promise<CashFlow> {
  const client = outer ?? prisma;
  const rows = await client.$queryRaw<
    Array<{
      id: string;
      entryNumber: string;
      entryDate: Date;
      description: string;
      amount: string;
      hasEquity: boolean;
    }>
  >(Prisma.sql`
    SELECT
      e."id",
      e."entryNumber",
      e."entryDate",
      e."description",
      SUM(CASE WHEN a."code" IN (${cashList}) THEN l."debit" - l."credit" ELSE 0 END)::text AS "amount",
      BOOL_OR(a."type" = 'EQUITY') AS "hasEquity"
    FROM "journal_entries" e
    JOIN "journal_entry_lines" l ON l."journalEntryId" = e."id"
    JOIN "accounts" a ON a."id" = l."accountId"
    WHERE e."status" = 'POSTED'
      AND e."entryDate" >= ${from}
      AND e."entryDate" <= ${to}
    GROUP BY e."id", e."entryNumber", e."entryDate", e."description"
    HAVING SUM(CASE WHEN a."code" IN (${cashList}) THEN l."debit" - l."credit" ELSE 0 END) <> 0
    ORDER BY e."entryDate" ASC, e."entryNumber" ASC
  `);

  const entries: CashFlowEntry[] = rows.map((line) => ({
    id: line.id,
    entryNumber: line.entryNumber,
    entryDate: line.entryDate,
    description: line.description,
    category: line.hasEquity ? "FINANCING" : "OPERATING",
    amount: money(line.amount),
  }));

  const positive = (category: CashFlowCategory) =>
    entries
      .filter((line) => line.category === category && line.amount.greaterThan(0))
      .reduce((sum, line) => sum.add(line.amount), money(0));
  const negative = (category: CashFlowCategory) =>
    entries
      .filter((line) => line.category === category && line.amount.lessThan(0))
      .reduce((sum, line) => sum.add(line.amount.neg()), money(0));

  const operatingIn = positive("OPERATING");
  const operatingOut = negative("OPERATING");
  const financingIn = positive("FINANCING");
  const financingOut = negative("FINANCING");
  const netChange = money(
    operatingIn.sub(operatingOut).add(financingIn).sub(financingOut),
  );
  const openingCash = await cashAt(from, false, outer);

  return {
    from,
    to,
    openingCash,
    operatingIn,
    operatingOut,
    financingIn,
    financingOut,
    netChange,
    closingCash: money(openingCash.add(netChange)),
    entries,
  };
}
