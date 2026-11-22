import type { Metadata } from "next";
import Link from "next/link";
import { AccountingNav } from "@/components/accounting/accounting-nav";
import { requirePagePermission } from "@/lib/auth/session";
import { trialBalance } from "@/lib/accounting/service";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/inventory/format";

export const metadata: Metadata = {
  title: "Accounting",
  robots: { index: false, follow: false },
};

const dateLabel = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeZone: "Asia/Dhaka",
});

const TYPE_ORDER = ["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"] as const;

function typeLabel(type: string): string {
  return type.charAt(0) + type.slice(1).toLowerCase();
}

function typeStyle(type: string): string {
  if (type === "ASSET") return "bg-brand-50 text-brand-700 ring-brand-200";
  if (type === "LIABILITY") return "bg-amber-50 text-amber-800 ring-amber-200";
  if (type === "EQUITY") return "bg-indigo-50 text-indigo-700 ring-indigo-200";
  if (type === "REVENUE") return "bg-emerald-50 text-emerald-700 ring-emerald-200";
  return "bg-slate-100 text-ink-700 ring-slate-200";
}

export default async function AccountingPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; error?: string; ok?: string }>;
}) {
  await requirePagePermission("account.read");
  const { period: periodParam, error, ok } = await searchParams;

  const periods = await prisma.fiscalPeriod.findMany({
    orderBy: { startDate: "desc" },
    select: { id: true, name: true, startDate: true, endDate: true, status: true },
  });
  const now = new Date();
  const selected =
    periodParam === "all"
      ? null
      : (periods.find((row) => row.id === periodParam) ??
        periods.find((row) => row.status === "OPEN" && row.startDate <= now && row.endDate >= now) ??
        periods[0] ??
        null);

  const [balance, entryCount] = await Promise.all([
    trialBalance({ fiscalPeriodId: selected?.id }),
    prisma.journalEntry.count({
      where: { status: "POSTED", ...(selected ? { fiscalPeriodId: selected.id } : {}) },
    }),
  ]);

  const difference = balance.totalDebit.sub(balance.totalCredit);
  const grouped = TYPE_ORDER.map((type) => ({
    type,
    rows: balance.rows.filter((row) => row.type === type),
  })).filter((group) => group.rows.length > 0);

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Accounting · হিসাব</h1>
          <p className="mt-1 text-sm text-ink-600">
            Every sale, payment, refund, goods receipt, stock movement and expense posts a
            balanced journal. Posted entries are never edited — a correction is a reversal.
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
          Saved.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Link
          href="/accounting?period=all"
          className={`min-h-9 rounded-lg px-3 py-2 text-xs font-medium ring-1 ${
            selected
              ? "bg-white text-ink-700 ring-slate-200 hover:bg-brand-50"
              : "bg-brand-600 text-white ring-brand-600"
          }`}
        >
          All time
        </Link>
        {periods.map((row) => (
          <Link
            key={row.id}
            href={`/accounting?period=${row.id}`}
            className={`min-h-9 rounded-lg px-3 py-2 text-xs font-medium ring-1 ${
              selected?.id === row.id
                ? "bg-brand-600 text-white ring-brand-600"
                : "bg-white text-ink-700 ring-slate-200 hover:bg-brand-50"
            }`}
          >
            {row.name} · {row.status.toLowerCase()}
          </Link>
        ))}
      </div>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Debit total</p>
          <p className="mt-1 text-lg font-semibold tabular-nums">৳{formatMoney(balance.totalDebit)}</p>
        </div>
        <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Credit total</p>
          <p className="mt-1 text-lg font-semibold tabular-nums">৳{formatMoney(balance.totalCredit)}</p>
        </div>
        <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Difference</p>
          <p
            className={`mt-1 text-lg font-semibold tabular-nums ${
              difference.isZero() ? "text-brand-700" : "text-red-700"
            }`}
          >
            ৳{formatMoney(difference)}
          </p>
        </div>
        <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Posted entries</p>
          <p className="mt-1 text-lg font-semibold tabular-nums">{entryCount}</p>
        </div>
      </section>

      {selected ? (
        <p className="text-xs text-ink-500">
          {selected.name} · {dateLabel.format(selected.startDate)} – {dateLabel.format(selected.endDate)} ·{" "}
          {selected.status.toLowerCase()}
        </p>
      ) : (
        <p className="text-xs text-ink-500">All posted entries, every fiscal period.</p>
      )}

      {grouped.length === 0 ? (
        <div className="rounded-2xl bg-white p-6 text-center ring-1 ring-slate-200">
          <p className="text-sm font-medium">No journal entries yet.</p>
          <p className="mt-1 text-sm text-ink-600">
            Complete a sale, receive a purchase or post an expense and it will appear here.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {grouped.map((group) => (
            <section key={group.type} className="overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200">
              <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                <h2 className="text-sm font-semibold">{typeLabel(group.type)}</h2>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${typeStyle(group.type)}`}>
                  {group.rows.length}
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-ink-500">
                    <tr>
                      <th className="px-4 py-2 font-medium">Code</th>
                      <th className="px-4 py-2 font-medium">Account</th>
                      <th className="px-4 py-2 text-right font-medium">Debit</th>
                      <th className="px-4 py-2 text-right font-medium">Credit</th>
                      <th className="px-4 py-2 text-right font-medium">Balance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {group.rows.map((row) => {
                      const net =
                        row.normalBalance === "DEBIT"
                          ? row.debit.sub(row.credit)
                          : row.credit.sub(row.debit);
                      return (
                        <tr key={row.code} className="hover:bg-slate-50">
                          <td className="px-4 py-2 font-mono text-xs text-ink-500">{row.code}</td>
                          <td className="px-4 py-2">
                            <Link
                              href={`/accounting/accounts/${row.id}`}
                              className="font-medium text-brand-700 hover:underline"
                            >
                              {row.name}
                            </Link>
                            {row.nameBn ? (
                              <span className="ml-2 text-xs text-ink-500">{row.nameBn}</span>
                            ) : null}
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums">৳{formatMoney(row.debit)}</td>
                          <td className="px-4 py-2 text-right tabular-nums">৳{formatMoney(row.credit)}</td>
                          <td className="px-4 py-2 text-right font-medium tabular-nums">৳{formatMoney(net)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-white px-4 py-3 text-sm ring-1 ring-slate-200">
            <span className="font-semibold">Totals</span>
            <span className="tabular-nums">
              ৳{formatMoney(balance.totalDebit)} debit · ৳{formatMoney(balance.totalCredit)} credit
            </span>
          </div>
        </div>
      )}

      <p className="text-xs text-ink-500">
        The trial balance only reads posted entries. A difference of ৳0.00 means the books are
        balanced.
      </p>
    </div>
  );
}
