import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AccountingNav } from "@/components/accounting/accounting-nav";
import { reverseJournalAction } from "@/app/actions/accounting";
import { hasPermission } from "@/lib/auth/permissions";
import { requirePagePermission } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/inventory/format";

export const metadata: Metadata = {
  title: "Journal entry",
  robots: { index: false, follow: false },
};

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

export default async function JournalEntryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  const session = await requirePagePermission("account.read");
  const canApprove = hasPermission(session, "account.approve");
  const { id } = await params;
  const { error, ok } = await searchParams;

  const entry = await prisma.journalEntry.findUnique({
    where: { id },
    select: {
      id: true,
      entryNumber: true,
      entryDate: true,
      description: true,
      source: true,
      referenceType: true,
      referenceId: true,
      status: true,
      totalDebit: true,
      totalCredit: true,
      postedAt: true,
      fiscalPeriod: { select: { name: true, status: true } },
      postedBy: { select: { fullName: true } },
      createdBy: { select: { fullName: true } },
      reversalOf: { select: { id: true, entryNumber: true } },
      reversalEntry: { select: { id: true, entryNumber: true } },
      lines: {
        orderBy: { lineOrder: "asc" },
        select: {
          id: true,
          debit: true,
          credit: true,
          description: true,
          lineOrder: true,
          account: { select: { id: true, code: true, name: true, nameBn: true } },
          customer: { select: { fullName: true, mobileNormalized: true } },
          supplier: { select: { name: true } },
        },
      },
    },
  });
  if (!entry) notFound();

  const balanced = entry.totalDebit.equals(entry.totalCredit);

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <div>
          <Link href="/accounting/journals" className="text-xs font-medium text-brand-700 hover:underline">
            ← Journals
          </Link>
          <h1 className="mt-1 font-mono text-lg font-semibold tracking-tight">{entry.entryNumber}</h1>
          <p className="mt-1 text-sm text-ink-600">{entry.description}</p>
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
          Reversal posted. The original entry is unchanged.
        </p>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Date</p>
          <p className="mt-1 text-sm font-medium">{dateTime.format(entry.entryDate)}</p>
        </div>
        <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Source</p>
          <p className="mt-1 text-sm font-medium">{sourceLabel(entry.source)}</p>
        </div>
        <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Fiscal period</p>
          <p className="mt-1 text-sm font-medium">
            {entry.fiscalPeriod.name} · {entry.fiscalPeriod.status.toLowerCase()}
          </p>
        </div>
        <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Status</p>
          <p className="mt-1 text-sm font-medium">
            {entry.status.toLowerCase()}
            {entry.reversalEntry ? " · reversed" : ""}
          </p>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-4 py-2 font-medium">#</th>
                <th className="px-4 py-2 font-medium">Account</th>
                <th className="px-4 py-2 font-medium">Description</th>
                <th className="px-4 py-2 text-right font-medium">Debit</th>
                <th className="px-4 py-2 text-right font-medium">Credit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {entry.lines.map((line) => (
                <tr key={line.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2 text-xs text-ink-400">{line.lineOrder}</td>
                  <td className="px-4 py-2">
                    <Link
                      href={`/accounting/accounts/${line.account.id}`}
                      className="font-medium text-brand-700 hover:underline"
                    >
                      {line.account.code} · {line.account.name}
                    </Link>
                    {line.customer ? (
                      <span className="ml-2 text-xs text-ink-500">
                        {line.customer.fullName} · {line.customer.mobileNormalized}
                      </span>
                    ) : null}
                    {line.supplier ? (
                      <span className="ml-2 text-xs text-ink-500">{line.supplier.name}</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-2 text-xs text-ink-600">{line.description ?? "—"}</td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {line.debit.isZero() ? "—" : `৳${formatMoney(line.debit)}`}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {line.credit.isZero() ? "—" : `৳${formatMoney(line.credit)}`}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-slate-50 text-sm font-semibold">
              <tr>
                <td className="px-4 py-2" colSpan={3}>
                  Totals {balanced ? "· balanced" : "· UNBALANCED"}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">৳{formatMoney(entry.totalDebit)}</td>
                <td className="px-4 py-2 text-right tabular-nums">৳{formatMoney(entry.totalCredit)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl bg-white p-4 text-sm ring-1 ring-slate-200">
          <h2 className="text-sm font-semibold">Trace</h2>
          <dl className="mt-2 space-y-1 text-xs text-ink-600">
            <div className="flex justify-between gap-3">
              <dt>Reference</dt>
              <dd className="font-mono">
                {entry.referenceType ?? "—"}
                {entry.referenceId ? ` · ${entry.referenceId}` : ""}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>Posted</dt>
              <dd>{entry.postedAt ? dateTime.format(entry.postedAt) : "—"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>Posted by</dt>
              <dd>{entry.postedBy?.fullName ?? "—"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>Created by</dt>
              <dd>{entry.createdBy?.fullName ?? "—"}</dd>
            </div>
            {entry.reversalOf ? (
              <div className="flex justify-between gap-3">
                <dt>Reverses</dt>
                <dd>
                  <Link
                    href={`/accounting/journals/${entry.reversalOf.id}`}
                    className="font-mono text-brand-700 hover:underline"
                  >
                    {entry.reversalOf.entryNumber}
                  </Link>
                </dd>
              </div>
            ) : null}
            {entry.reversalEntry ? (
              <div className="flex justify-between gap-3">
                <dt>Reversed by</dt>
                <dd>
                  <Link
                    href={`/accounting/journals/${entry.reversalEntry.id}`}
                    className="font-mono text-brand-700 hover:underline"
                  >
                    {entry.reversalEntry.entryNumber}
                  </Link>
                </dd>
              </div>
            ) : null}
          </dl>
        </div>

        {canApprove && !entry.reversalEntry && entry.status === "POSTED" ? (
          <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
            <h2 className="text-sm font-semibold">Reverse this entry</h2>
            <p className="mt-1 text-xs text-ink-500">
              A posted entry is never edited. Reversing writes a mirrored entry that cancels it, and
              both stay in the ledger.
            </p>
            <form action={reverseJournalAction} className="mt-3 space-y-2">
              <input type="hidden" name="id" value={entry.id} />
              <input
                name="reason"
                required
                minLength={3}
                maxLength={300}
                placeholder="Why is this being reversed?"
                className="block w-full min-h-10 rounded-xl border border-slate-300 bg-white px-3 text-sm"
              />
              <button
                type="submit"
                className="min-h-10 rounded-xl bg-red-600 px-3 text-xs font-semibold text-white hover:bg-red-700"
              >
                Post reversal
              </button>
            </form>
          </div>
        ) : null}
      </section>
    </div>
  );
}
