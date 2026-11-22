import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AccountingNav } from "@/components/accounting/accounting-nav";
import { requirePagePermission } from "@/lib/auth/session";
import { accountLedger } from "@/lib/accounting/service";
import { formatMoney } from "@/lib/inventory/format";

export const metadata: Metadata = {
  title: "Account ledger",
  robots: { index: false, follow: false },
};

const dateTime = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Dhaka",
});

export default async function AccountLedgerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePagePermission("account.read");
  const { id } = await params;

  const { account, lines } = await accountLedger(id);
  if (!account) notFound();

  const closing = lines.at(-1)?.balance ?? "0";

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <div>
          <Link href="/accounting/accounts" className="text-xs font-medium text-brand-700 hover:underline">
            ← Chart of accounts
          </Link>
          <h1 className="mt-1 text-xl font-semibold tracking-tight">
            {account.code} · {account.name}
          </h1>
          <p className="mt-1 text-sm text-ink-600">
            {account.normalBalance === "DEBIT" ? "Debit" : "Credit"}-normal account. The running
            balance is signed in the account&apos;s natural direction.
          </p>
        </div>
        <AccountingNav />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Closing balance</p>
          <p className="mt-1 text-lg font-semibold tabular-nums">৳{formatMoney(closing)}</p>
        </div>
        <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Posted lines</p>
          <p className="mt-1 text-lg font-semibold tabular-nums">{lines.length}</p>
        </div>
      </div>

      {lines.length === 0 ? (
        <div className="rounded-2xl bg-white p-6 text-center ring-1 ring-slate-200">
          <p className="text-sm font-medium">No posted movement on this account yet.</p>
        </div>
      ) : (
        <section className="overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Date</th>
                  <th className="px-4 py-2 font-medium">Entry</th>
                  <th className="px-4 py-2 font-medium">Description</th>
                  <th className="px-4 py-2 text-right font-medium">Debit</th>
                  <th className="px-4 py-2 text-right font-medium">Credit</th>
                  <th className="px-4 py-2 text-right font-medium">Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {lines.map((line) => (
                  <tr key={`${line.entryId}-${line.entryNumber}`} className="hover:bg-slate-50">
                    <td className="whitespace-nowrap px-4 py-2 text-xs text-ink-500">
                      {dateTime.format(line.entryDate)}
                    </td>
                    <td className="px-4 py-2">
                      <Link
                        href={`/accounting/journals/${line.entryId}`}
                        className="font-mono text-xs text-brand-700 hover:underline"
                      >
                        {line.entryNumber}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-xs text-ink-700">{line.description}</td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {line.debit.isZero() ? "—" : `৳${formatMoney(line.debit)}`}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {line.credit.isZero() ? "—" : `৳${formatMoney(line.credit)}`}
                    </td>
                    <td className="px-4 py-2 text-right font-medium tabular-nums">
                      ৳{formatMoney(line.balance)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
