import type { Metadata } from "next";
import Link from "next/link";
import { Prisma } from "@/generated/prisma/client";
import { AccountingNav } from "@/components/accounting/accounting-nav";
import { requirePagePermission } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/inventory/format";

export const metadata: Metadata = {
  title: "Journals",
  robots: { index: false, follow: false },
};

const PAGE_SIZE = 30;

const SOURCES = [
  "POS_SALE",
  "ONLINE_SALE",
  "PURCHASE",
  "PURCHASE_PAYMENT",
  "SALE_RETURN",
  "REFUND",
  "EXPENSE",
  "STOCK_ADJUSTMENT",
  "TRANSFER_FEE",
  "DROPSHIP_COGS",
  "OPENING_BALANCE",
  "MANUAL",
] as const;

const dateTime = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Dhaka",
});

function sourceLabel(source: string): string {
  return source
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export default async function JournalsPage({
  searchParams,
}: {
  searchParams: Promise<{ source?: string; q?: string; page?: string; error?: string; ok?: string }>;
}) {
  await requirePagePermission("account.read");
  const { source, q, page, error, ok } = await searchParams;

  const pageNumber = Math.max(1, Number(page) || 1);
  const where: Prisma.JournalEntryWhereInput = {
    status: "POSTED",
    ...(source && (SOURCES as readonly string[]).includes(source)
      ? { source: source as (typeof SOURCES)[number] }
      : {}),
    ...(q?.trim()
      ? {
          OR: [
            { entryNumber: { contains: q.trim(), mode: "insensitive" } },
            { description: { contains: q.trim(), mode: "insensitive" } },
            { referenceId: q.trim() },
          ],
        }
      : {}),
  };

  const [total, entries] = await Promise.all([
    prisma.journalEntry.count({ where }),
    prisma.journalEntry.findMany({
      where,
      orderBy: [{ entryDate: "desc" }, { createdAt: "desc" }],
      skip: (pageNumber - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        entryNumber: true,
        entryDate: true,
        description: true,
        source: true,
        totalDebit: true,
        totalCredit: true,
        reversalOfId: true,
        reversalEntry: { select: { id: true, entryNumber: true } },
        _count: { select: { lines: true } },
      },
    }),
  ]);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Journal entries · জার্নাল</h1>
          <p className="mt-1 text-sm text-ink-600">
            Posted entries only. Each is balanced, immutable and traceable to the document that
            created it.
          </p>
        </div>
        <AccountingNav />
      </div>

      {error ? (
        <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-200">
          {error}
        </p>
      ) : null}
      {ok ? (
        <p role="status" className="rounded-xl bg-brand-50 px-3 py-2 text-sm text-brand-800 ring-1 ring-brand-200">
          Reversal posted.
        </p>
      ) : null}

      <form method="get" className="flex flex-wrap items-end gap-2 rounded-2xl bg-white p-3 ring-1 ring-slate-200">
        <label className="min-w-0 flex-1 text-xs font-medium text-ink-700">
          Search
          <input
            name="q"
            defaultValue={q ?? ""}
            placeholder="Entry number or description"
            className="mt-1 block w-full min-h-10 rounded-xl border border-slate-300 bg-white px-3 text-sm"
          />
        </label>
        <label className="text-xs font-medium text-ink-700">
          Source
          <select
            name="source"
            defaultValue={source ?? ""}
            className="mt-1 block min-h-10 rounded-xl border border-slate-300 bg-white px-3 text-sm"
          >
            <option value="">All sources</option>
            {SOURCES.map((value) => (
              <option key={value} value={value}>
                {sourceLabel(value)}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="min-h-10 rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700"
        >
          Filter
        </button>
        <Link
          href="/accounting/journals"
          className="min-h-10 rounded-xl px-3 py-2.5 text-sm font-medium text-ink-600 hover:text-brand-700"
        >
          Clear
        </Link>
      </form>

      {entries.length === 0 ? (
        <div className="rounded-2xl bg-white p-6 text-center ring-1 ring-slate-200">
          <p className="text-sm font-medium">No journal entries match.</p>
          <p className="mt-1 text-sm text-ink-600">
            Sales, payments, refunds, goods receipts, stock adjustments and expenses post here.
          </p>
        </div>
      ) : (
        <section className="overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <h2 className="text-sm font-semibold">{total} entries</h2>
            <span className="text-xs text-ink-500">
              Page {pageNumber} of {pageCount}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Entry</th>
                  <th className="px-4 py-2 font-medium">Date</th>
                  <th className="px-4 py-2 font-medium">Description</th>
                  <th className="px-4 py-2 font-medium">Source</th>
                  <th className="px-4 py-2 text-right font-medium">Debit</th>
                  <th className="px-4 py-2 text-right font-medium">Credit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {entries.map((entry) => (
                  <tr key={entry.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2">
                      <Link
                        href={`/accounting/journals/${entry.id}`}
                        className="font-mono text-xs text-brand-700 hover:underline"
                      >
                        {entry.entryNumber}
                      </Link>
                      {entry.reversalOfId ? (
                        <span className="ml-2 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 ring-1 ring-amber-200">
                          reversal
                        </span>
                      ) : null}
                      {entry.reversalEntry ? (
                        <span className="ml-2 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-ink-600 ring-1 ring-slate-200">
                          reversed
                        </span>
                      ) : null}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-xs text-ink-500">
                      {dateTime.format(entry.entryDate)}
                    </td>
                    <td className="px-4 py-2 text-xs text-ink-700">{entry.description}</td>
                    <td className="px-4 py-2 text-xs text-ink-500">{sourceLabel(entry.source)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">৳{formatMoney(entry.totalDebit)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">৳{formatMoney(entry.totalCredit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {pageCount > 1 ? (
        <div className="flex items-center justify-between text-sm">
          <Link
            href={{ pathname: "/accounting/journals", query: { q: q ?? "", source: source ?? "", page: pageNumber - 1 } }}
            aria-disabled={pageNumber <= 1}
            className={`rounded-lg px-3 py-2 ring-1 ${
              pageNumber <= 1
                ? "pointer-events-none bg-slate-100 text-ink-400 ring-slate-200"
                : "bg-white text-ink-700 ring-slate-200 hover:bg-brand-50"
            }`}
          >
            Previous
          </Link>
          <Link
            href={{ pathname: "/accounting/journals", query: { q: q ?? "", source: source ?? "", page: pageNumber + 1 } }}
            aria-disabled={pageNumber >= pageCount}
            className={`rounded-lg px-3 py-2 ring-1 ${
              pageNumber >= pageCount
                ? "pointer-events-none bg-slate-100 text-ink-400 ring-slate-200"
                : "bg-white text-ink-700 ring-slate-200 hover:bg-brand-50"
            }`}
          >
            Next
          </Link>
        </div>
      ) : null}
    </div>
  );
}
