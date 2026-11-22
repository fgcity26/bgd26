import {
  Prisma,
  type JournalSource,
  type PaymentMethod,
} from "@/generated/prisma/client";
import { money, type Numeric } from "@/lib/inventory/decimal";
import { documentNumber } from "@/lib/inventory/stock";

/**
 * Double-entry journal engine.
 *
 * Every business event posts one balanced entry through `postJournal`. The
 * database refuses to store a posted entry whose debits and credits differ
 * (`trg_journal_balanced`) and refuses every later UPDATE or DELETE of a posted
 * entry or its lines (`trg_journal_immutable`, `trg_journal_line_immutable`).
 * Corrections are therefore new entries: `reverseJournal` mirrors an entry and
 * points at the original through `reversalOfId`.
 *
 * Entries are written DRAFT, their lines inserted, then the status moves to
 * POSTED inside the same transaction. That order matters: the line trigger
 * rejects any insert into an already-posted entry.
 */
export class AccountingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccountingError";
  }
}

/** Chart-of-accounts codes used by the posting rules (seeded in prisma/seed.ts). */
export const ACCOUNTS = {
  cash: "1000",
  bank: "1010",
  bkash: "1020",
  nagad: "1030",
  card: "1040",
  receivable: "1050",
  codClearing: "1060",
  inventory: "1100",
  wip: "1130",
  inputVat: "1150",
  payable: "1300",
  vatPayable: "1400",
  loyaltyLiability: "1500",
  equity: "3000",
  sales: "4000",
  deliveryRevenue: "4010",
  salesDiscounts: "4020",
  salesReturns: "4030",
  cogs: "5000",
  dropshipCogs: "5010",
  shrinkage: "5020",
  loyaltyExpense: "5500",
} as const;

/** The asset account that receives a payment made by a given method. */
export function paymentAccountCode(method: PaymentMethod): string {
  switch (method) {
    case "CASH":
      return ACCOUNTS.cash;
    case "BKASH":
      return ACCOUNTS.bkash;
    case "NAGAD":
      return ACCOUNTS.nagad;
    case "CARD":
    case "GATEWAY":
      return ACCOUNTS.card;
    case "BANK_TRANSFER":
    case "CHEQUE":
      return ACCOUNTS.bank;
    case "COD":
      return ACCOUNTS.codClearing;
    default:
      return ACCOUNTS.cash;
  }
}

export type JournalLineInput = {
  /** Account code, e.g. `"1050"`. Codes are stable; ids are not. */
  account: string;
  debit?: Numeric;
  credit?: Numeric;
  description?: string | null;
  customerId?: string | null;
  supplierId?: string | null;
};

export type PostJournalInput = {
  entryDate?: Date;
  description: string;
  source: JournalSource;
  referenceType?: string | null;
  referenceId?: string | null;
  /** Set only when this entry reverses another; the original stays untouched. */
  reversalOfId?: string | null;
  lines: JournalLineInput[];
  actorUserId: string;
};

export type PostedJournal = {
  id: string;
  entryNumber: string;
  totalDebit: Prisma.Decimal;
  totalCredit: Prisma.Decimal;
};

type NormalizedLine = {
  account: string;
  debit: Prisma.Decimal;
  credit: Prisma.Decimal;
  description: string | null;
  customerId: string | null;
  supplierId: string | null;
};

function normalize(lines: JournalLineInput[]): NormalizedLine[] {
  return lines
    .map((line) => {
      const debit = money(line.debit ?? 0);
      const credit = money(line.credit ?? 0);
      if (debit.lessThan(0) || credit.lessThan(0)) {
        throw new AccountingError("A journal amount cannot be negative.");
      }
      if (debit.greaterThan(0) && credit.greaterThan(0)) {
        throw new AccountingError("A journal line is either a debit or a credit, never both.");
      }
      return {
        account: line.account.trim(),
        debit,
        credit,
        description: line.description?.trim() || null,
        customerId: line.customerId ?? null,
        supplierId: line.supplierId ?? null,
      };
    })
    .filter((line) => line.debit.greaterThan(0) || line.credit.greaterThan(0));
}

async function requireOpenPeriod(
  tx: Prisma.TransactionClient,
  entryDate: Date,
): Promise<string> {
  const period = await tx.fiscalPeriod.findFirst({
    where: { startDate: { lte: entryDate }, endDate: { gte: entryDate } },
    select: { id: true, name: true, status: true },
  });
  if (!period) {
    throw new AccountingError(
      `No fiscal period covers ${entryDate.toISOString().slice(0, 10)}. Create or extend one first.`,
    );
  }
  if (period.status !== "OPEN") {
    throw new AccountingError(`${period.name} is ${period.status.toLowerCase()}; it accepts no new entries.`);
  }
  return period.id;
}

async function accountIdsByCode(
  tx: Prisma.TransactionClient,
  codes: string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(codes)];
  const rows = await tx.account.findMany({
    where: { code: { in: unique } },
    select: { id: true, code: true, isActive: true },
  });
  const byCode = new Map(rows.map((row) => [row.code, row]));
  const result = new Map<string, string>();
  for (const code of unique) {
    const row = byCode.get(code);
    if (!row) throw new AccountingError(`Account ${code} is missing from the chart of accounts.`);
    if (!row.isActive) throw new AccountingError(`Account ${code} is inactive.`);
    result.set(code, row.id);
  }
  return result;
}

/**
 * Post one balanced, immutable journal entry inside the caller's transaction.
 *
 * Returns `null` when every line is zero, which happens for an event that
 * carries no money (a fully discounted line, a zero-cost stock adjustment). A
 * zero-value entry is never written because the database rejects it.
 */
export async function postJournal(
  tx: Prisma.TransactionClient,
  input: PostJournalInput,
): Promise<PostedJournal | null> {
  const lines = normalize(input.lines);
  if (lines.length === 0) return null;
  if (lines.length < 2) {
    throw new AccountingError("A journal entry needs at least two lines.");
  }

  const totalDebit = lines.reduce((sum, line) => sum.add(line.debit), money(0));
  const totalCredit = lines.reduce((sum, line) => sum.add(line.credit), money(0));
  if (!totalDebit.equals(totalCredit)) {
    throw new AccountingError(
      `That journal does not balance: debit ${totalDebit.toFixed(2)}, credit ${totalCredit.toFixed(2)}.`,
    );
  }
  if (!totalDebit.greaterThan(0)) return null;

  const entryDate = input.entryDate ?? new Date();
  const fiscalPeriodId = await requireOpenPeriod(tx, entryDate);
  const ids = await accountIdsByCode(
    tx,
    lines.map((line) => line.account),
  );

  const entry = await tx.journalEntry.create({
    data: {
      entryNumber: documentNumber("JE"),
      entryDate,
      fiscalPeriodId,
      description: input.description.trim(),
      source: input.source,
      referenceType: input.referenceType ?? null,
      referenceId: input.referenceId ?? null,
      reversalOfId: input.reversalOfId ?? null,
      status: "DRAFT",
      totalDebit,
      totalCredit,
      createdByUserId: input.actorUserId,
    },
    select: { id: true, entryNumber: true },
  });

  await tx.journalEntryLine.createMany({
    data: lines.map((line, index) => ({
      journalEntryId: entry.id,
      accountId: ids.get(line.account)!,
      debit: line.debit,
      credit: line.credit,
      description: line.description,
      customerId: line.customerId,
      supplierId: line.supplierId,
      lineOrder: index + 1,
    })),
  });

  // Only now may the entry become POSTED: the line trigger blocks inserts into
  // a posted entry, and the deferred balance trigger checks the total at commit.
  await tx.journalEntry.update({
    where: { id: entry.id },
    data: {
      status: "POSTED",
      postedAt: new Date(),
      postedByUserId: input.actorUserId,
    },
  });

  return {
    id: entry.id,
    entryNumber: entry.entryNumber,
    totalDebit,
    totalCredit,
  };
}

export type ReverseJournalInput = {
  entryId: string;
  actorUserId: string;
  reason: string;
  entryDate?: Date;
};

/**
 * Mirror a posted entry. The original keeps `POSTED` — the database forbids
 * touching it — and the new entry points at it through `reversalOfId`, which is
 * unique so an entry can be reversed exactly once.
 */
export async function reverseJournal(
  tx: Prisma.TransactionClient,
  input: ReverseJournalInput,
): Promise<PostedJournal | null> {
  const original = await tx.journalEntry.findUnique({
    where: { id: input.entryId },
    select: {
      id: true,
      entryNumber: true,
      entryDate: true,
      description: true,
      source: true,
      referenceType: true,
      referenceId: true,
      status: true,
      reversalEntry: { select: { id: true } },
      lines: {
        orderBy: { lineOrder: "asc" },
        select: {
          account: { select: { code: true } },
          debit: true,
          credit: true,
          description: true,
          customerId: true,
          supplierId: true,
        },
      },
    },
  });
  if (!original) throw new AccountingError("That journal entry no longer exists.");
  if (original.status !== "POSTED") {
    throw new AccountingError("Only a posted journal entry can be reversed.");
  }
  if (original.reversalEntry) {
    throw new AccountingError("That journal entry has already been reversed.");
  }

  return postJournal(tx, {
    entryDate: input.entryDate ?? new Date(),
    description: `Reversal of ${original.entryNumber}: ${input.reason.trim()}`,
    source: original.source,
    referenceType: original.referenceType,
    referenceId: original.referenceId,
    reversalOfId: original.id,
    actorUserId: input.actorUserId,
    lines: original.lines.map((line) => ({
      account: line.account.code,
      debit: line.credit,
      credit: line.debit,
      description: line.description,
      customerId: line.customerId,
      supplierId: line.supplierId,
    })),
  });
}

/**
 * Reverse every live posted entry that belongs to one business document.
 *
 * `reversalEntry: null` skips entries that are themselves reversals, so calling
 * this twice cannot unwind the same document twice.
 */
export async function reverseJournalsForReference(
  tx: Prisma.TransactionClient,
  referenceType: string,
  referenceId: string,
  actorUserId: string,
  reason: string,
): Promise<number> {
  const entries = await tx.journalEntry.findMany({
    where: {
      referenceType,
      referenceId,
      status: "POSTED",
      reversalOfId: null,
      reversalEntry: null,
    },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });

  for (const entry of entries) {
    await reverseJournal(tx, { entryId: entry.id, actorUserId, reason });
  }
  return entries.length;
}
