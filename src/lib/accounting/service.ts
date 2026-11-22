import {
  Prisma,
  type AccountType,
  type NormalBalance,
  type PaymentMethod,
} from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { money, type Numeric } from "@/lib/inventory/decimal";
import { documentNumber } from "@/lib/inventory/stock";
import {
  ACCOUNTS,
  AccountingError,
  paymentAccountCode,
  postJournal,
  reverseJournal,
} from "./journal";

/**
 * Accounting documents around the journal engine: the chart of accounts,
 * expenses and the read models (trial balance, account ledger).
 *
 * Expenses are drafted, then posted by a manager. Posting writes the journal and
 * freezes the document; voiding a posted expense writes a reversal and marks the
 * document VOID. Nothing is deleted.
 */

function run<T>(
  outer: Prisma.TransactionClient | undefined,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return outer ? work(outer) : prisma.$transaction(work);
}

function explain(error: unknown): never {
  if (error instanceof AccountingError) throw error;
  throw error;
}

// ---------------------------------------------------------------------------
// Chart of accounts
// ---------------------------------------------------------------------------

export type CreateAccountInput = {
  code: string;
  name: string;
  nameBn?: string | null;
  type: AccountType;
  normalBalance?: NormalBalance;
  parentId?: string | null;
  description?: string | null;
};

const NORMAL_BALANCE: Record<AccountType, NormalBalance> = {
  ASSET: "DEBIT",
  EXPENSE: "DEBIT",
  LIABILITY: "CREDIT",
  EQUITY: "CREDIT",
  REVENUE: "CREDIT",
};

export async function createAccount(
  input: CreateAccountInput,
  outer?: Prisma.TransactionClient,
) {
  const code = input.code.trim();
  if (!/^\d{3,6}$/.test(code)) {
    throw new AccountingError("An account code is 3–6 digits, e.g. 6060.");
  }
  const name = input.name.trim();
  if (name.length < 2) throw new AccountingError("Give the account a name.");

  return run(outer, async (tx) => {
    const existing = await tx.account.findUnique({ where: { code }, select: { id: true } });
    if (existing) throw new AccountingError(`Account ${code} already exists.`);
    if (input.parentId) {
      const parent = await tx.account.findUnique({
        where: { id: input.parentId },
        select: { id: true },
      });
      if (!parent) throw new AccountingError("That parent account no longer exists.");
    }

    return tx.account.create({
      data: {
        code,
        name,
        nameBn: input.nameBn?.trim() || null,
        type: input.type,
        normalBalance: input.normalBalance ?? NORMAL_BALANCE[input.type],
        parentId: input.parentId ?? null,
        description: input.description?.trim() || null,
      },
      select: { id: true, code: true, name: true },
    });
  });
}

export async function setAccountActive(
  id: string,
  isActive: boolean,
  outer?: Prisma.TransactionClient,
) {
  return run(outer, async (tx) => {
    const account = await tx.account.findUnique({
      where: { id },
      select: { id: true, isSystem: true },
    });
    if (!account) throw new AccountingError("That account no longer exists.");
    if (account.isSystem && !isActive) {
      throw new AccountingError("A system account cannot be deactivated.");
    }
    return tx.account.update({
      where: { id },
      data: { isActive },
      select: { id: true, isActive: true },
    });
  });
}

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------

export type CreateExpenseInput = {
  category: string;
  accountId: string;
  amount: Numeric;
  vatAmount?: Numeric;
  paymentMethod: PaymentMethod;
  cashAccountId?: string | null;
  bankAccountId?: string | null;
  supplierId?: string | null;
  description?: string | null;
  expenseDate?: Date;
  actorUserId: string;
};

export async function createExpense(
  input: CreateExpenseInput,
  outer?: Prisma.TransactionClient,
) {
  const category = input.category.trim();
  if (category.length < 2) throw new AccountingError("Give the expense a category.");
  const amount = money(input.amount);
  const vatAmount = money(input.vatAmount ?? 0);
  if (!amount.greaterThan(0)) throw new AccountingError("The expense amount must be greater than zero.");
  if (vatAmount.lessThan(0)) throw new AccountingError("VAT cannot be negative.");

  return run(outer, async (tx) => {
    const account = await tx.account.findUnique({
      where: { id: input.accountId },
      select: { id: true, type: true, isActive: true },
    });
    if (!account || !account.isActive) throw new AccountingError("Choose an active expense account.");
    if (account.type !== "EXPENSE") {
      throw new AccountingError("An expense posts to an EXPENSE account.");
    }
    if (input.cashAccountId && input.bankAccountId) {
      throw new AccountingError("Choose either a cash account or a bank account, not both.");
    }

    return tx.expense.create({
      data: {
        expenseNumber: documentNumber("EXP"),
        expenseDate: input.expenseDate ?? new Date(),
        category,
        accountId: account.id,
        amount,
        vatAmount,
        paymentMethod: input.paymentMethod,
        cashAccountId: input.cashAccountId ?? null,
        bankAccountId: input.bankAccountId ?? null,
        supplierId: input.supplierId ?? null,
        description: input.description?.trim() || null,
        status: "DRAFT",
        createdByUserId: input.actorUserId,
      },
      select: { id: true, expenseNumber: true },
    });
  });
}

async function creditAccountForExpense(
  tx: Prisma.TransactionClient,
  expense: {
    cashAccountId: string | null;
    bankAccountId: string | null;
    paymentMethod: PaymentMethod;
  },
): Promise<string> {
  if (expense.cashAccountId) {
    const cash = await tx.cashAccount.findUnique({
      where: { id: expense.cashAccountId },
      select: { account: { select: { code: true } } },
    });
    if (!cash) throw new AccountingError("That cash account no longer exists.");
    return cash.account.code;
  }
  if (expense.bankAccountId) {
    const bank = await tx.bankAccount.findUnique({
      where: { id: expense.bankAccountId },
      select: { account: { select: { code: true } } },
    });
    if (!bank) throw new AccountingError("That bank account no longer exists.");
    return bank.account.code;
  }
  return paymentAccountCode(expense.paymentMethod);
}

export async function postExpense(
  id: string,
  actorUserId: string,
  outer?: Prisma.TransactionClient,
) {
  return run(outer, async (tx) => {
    const claimed = await tx.expense.updateMany({
      where: { id, status: "DRAFT" },
      data: { status: "POSTED" },
    });
    if (claimed.count === 0) {
      throw new AccountingError("Only a draft expense can be posted.");
    }

    const expense = await tx.expense.findUnique({
      where: { id },
      select: {
        id: true,
        expenseNumber: true,
        category: true,
        amount: true,
        vatAmount: true,
        paymentMethod: true,
        cashAccountId: true,
        bankAccountId: true,
        supplierId: true,
        description: true,
        account: { select: { code: true } },
      },
    });
    if (!expense) throw new AccountingError("That expense no longer exists.");

    const creditCode = await creditAccountForExpense(tx, expense);
    const journal = await postJournal(tx, {
      description: `${expense.expenseNumber} · ${expense.category}`,
      source: "EXPENSE",
      referenceType: "expense",
      referenceId: expense.id,
      actorUserId,
      lines: [
        { account: expense.account.code, debit: expense.amount, description: expense.description },
        { account: ACCOUNTS.inputVat, debit: expense.vatAmount },
        {
          account: creditCode,
          credit: expense.amount.add(expense.vatAmount),
          supplierId: expense.supplierId,
        },
      ],
    });
    if (journal) {
      await tx.expense.update({
        where: { id: expense.id },
        data: { journalEntryId: journal.id },
      });
    }

    return expense;
  });
}

export async function voidExpense(
  id: string,
  actorUserId: string,
  reason: string,
  outer?: Prisma.TransactionClient,
) {
  return run(outer, async (tx) => {
    const expense = await tx.expense.findUnique({
      where: { id },
      select: { id: true, status: true, journalEntryId: true, expenseNumber: true },
    });
    if (!expense) throw new AccountingError("That expense no longer exists.");
    if (expense.status !== "POSTED") {
      throw new AccountingError("Only a posted expense can be voided.");
    }

    if (expense.journalEntryId) {
      await reverseJournal(tx, {
        entryId: expense.journalEntryId,
        actorUserId,
        reason: `${expense.expenseNumber} voided: ${reason.trim()}`,
      });
    }

    await tx.expense.update({ where: { id: expense.id }, data: { status: "VOID" } });
    return expense;
  });
}

// ---------------------------------------------------------------------------
// Journal reversal
// ---------------------------------------------------------------------------

export async function reverseEntry(
  id: string,
  actorUserId: string,
  reason: string,
  outer?: Prisma.TransactionClient,
) {
  return run(outer, async (tx) => {
    const entry = await tx.journalEntry.findUnique({
      where: { id },
      select: { id: true, entryNumber: true },
    });
    if (!entry) throw new AccountingError("That journal entry no longer exists.");
    return reverseJournal(tx, { entryId: entry.id, actorUserId, reason });
  });
}

// ---------------------------------------------------------------------------
// Read models
// ---------------------------------------------------------------------------

export type TrialBalanceRow = {
  id: string;
  code: string;
  name: string;
  nameBn: string | null;
  type: AccountType;
  normalBalance: NormalBalance;
  debit: Prisma.Decimal;
  credit: Prisma.Decimal;
  lines: number;
};

export type TrialBalance = {
  rows: TrialBalanceRow[];
  totalDebit: Prisma.Decimal;
  totalCredit: Prisma.Decimal;
};

export async function trialBalance(options?: {
  from?: Date;
  to?: Date;
  fiscalPeriodId?: string;
}, outer?: Prisma.TransactionClient): Promise<TrialBalance> {
  const client = outer ?? prisma;
  const conditions: Prisma.Sql[] = [Prisma.sql`e."status" = 'POSTED'`];
  if (options?.from) conditions.push(Prisma.sql`e."entryDate" >= ${options.from}`);
  if (options?.to) conditions.push(Prisma.sql`e."entryDate" <= ${options.to}`);
  if (options?.fiscalPeriodId) {
    conditions.push(Prisma.sql`e."fiscalPeriodId" = ${options.fiscalPeriodId}`);
  }
  const where = Prisma.join(conditions, " AND ");

  const rows = await client.$queryRaw<
    Array<{
      id: string;
      code: string;
      name: string;
      nameBn: string | null;
      type: AccountType;
      normalBalance: NormalBalance;
      debit: string;
      credit: string;
      lines: number;
    }>
  >(Prisma.sql`
    SELECT
      a."id",
      a."code",
      a."name",
      a."nameBn",
      a."type"::text AS "type",
      a."normalBalance"::text AS "normalBalance",
      COALESCE(SUM(l."debit"), 0)::text AS "debit",
      COALESCE(SUM(l."credit"), 0)::text AS "credit",
      COUNT(l."id")::int AS "lines"
    FROM "accounts" a
    JOIN "journal_entry_lines" l ON l."accountId" = a."id"
    JOIN "journal_entries" e ON e."id" = l."journalEntryId"
    WHERE ${where}
    GROUP BY a."id", a."code", a."name", a."nameBn", a."type", a."normalBalance"
    ORDER BY a."code"
  `);

  const mapped = rows.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    nameBn: row.nameBn,
    type: row.type,
    normalBalance: row.normalBalance,
    debit: money(row.debit),
    credit: money(row.credit),
    lines: row.lines,
  }));

  return {
    rows: mapped,
    totalDebit: mapped.reduce((sum, row) => sum.add(row.debit), money(0)),
    totalCredit: mapped.reduce((sum, row) => sum.add(row.credit), money(0)),
  };
}

export type LedgerLine = {
  entryId: string;
  entryNumber: string;
  entryDate: Date;
  description: string;
  source: string;
  debit: Prisma.Decimal;
  credit: Prisma.Decimal;
  balance: Prisma.Decimal;
};

export async function accountLedger(
  accountId: string,
  options?: { from?: Date; to?: Date; limit?: number },
  outer?: Prisma.TransactionClient,
): Promise<{ account: { code: string; name: string; normalBalance: NormalBalance } | null; lines: LedgerLine[] }> {
  const client = outer ?? prisma;
  const account = await client.account.findUnique({
    where: { id: accountId },
    select: { code: true, name: true, normalBalance: true },
  });
  if (!account) return { account: null, lines: [] };

  const entries = await client.journalEntryLine.findMany({
    where: {
      accountId,
      journalEntry: {
        status: "POSTED",
        ...(options?.from || options?.to
          ? {
              entryDate: {
                ...(options?.from ? { gte: options.from } : {}),
                ...(options?.to ? { lte: options.to } : {}),
              },
            }
          : {}),
      },
    },
    orderBy: [{ journalEntry: { entryDate: "asc" } }, { lineOrder: "asc" }],
    take: options?.limit ?? 500,
    select: {
      debit: true,
      credit: true,
      description: true,
      journalEntry: {
        select: { id: true, entryNumber: true, entryDate: true, description: true, source: true },
      },
    },
  });

  const signed = account.normalBalance === "DEBIT" ? 1 : -1;
  let running = money(0);
  const lines = entries.map((line) => {
    running = money(running.add(money(line.debit.sub(line.credit).mul(signed))));
    return {
      entryId: line.journalEntry.id,
      entryNumber: line.journalEntry.entryNumber,
      entryDate: line.journalEntry.entryDate,
      description: line.description ?? line.journalEntry.description,
      source: line.journalEntry.source,
      debit: line.debit,
      credit: line.credit,
      balance: running,
    };
  });

  return { account, lines };
}

export { explain };
