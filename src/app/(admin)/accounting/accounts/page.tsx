import type { Metadata } from "next";
import Link from "next/link";
import { AccountingNav } from "@/components/accounting/accounting-nav";
import { createAccountAction, setAccountActiveAction } from "@/app/actions/accounting";
import { hasPermission } from "@/lib/auth/permissions";
import { requirePagePermission } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

export const metadata: Metadata = {
  title: "Chart of accounts",
  robots: { index: false, follow: false },
};

const inputClass =
  "mt-1 block w-full min-h-10 rounded-xl border border-slate-300 bg-white px-3 text-sm text-ink-900 shadow-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100";

const TYPE_LABEL: Record<string, string> = {
  ASSET: "Asset",
  LIABILITY: "Liability",
  EQUITY: "Equity",
  REVENUE: "Revenue",
  EXPENSE: "Expense",
};

export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  const session = await requirePagePermission("account.read");
  const canWrite = hasPermission(session, "account.write");
  const { error, ok } = await searchParams;

  const accounts = await prisma.account.findMany({
    orderBy: { code: "asc" },
    select: {
      id: true,
      code: true,
      name: true,
      nameBn: true,
      type: true,
      normalBalance: true,
      isActive: true,
      isSystem: true,
    },
  });

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Chart of accounts · হিসাবের তালিকা</h1>
          <p className="mt-1 text-sm text-ink-600">
            Codes are stable identifiers used by every posting rule. A system account can be
            renamed but never deactivated or deleted.
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
          {ok === "created" ? "Account created." : "Account updated."}
        </p>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <section className="overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200">
          <div className="border-b border-slate-200 px-4 py-3">
            <h2 className="text-sm font-semibold">Accounts · {accounts.length}</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Code</th>
                  <th className="px-4 py-2 font-medium">Name</th>
                  <th className="px-4 py-2 font-medium">Type</th>
                  <th className="px-4 py-2 font-medium">Normal</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {accounts.map((account) => (
                  <tr key={account.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2 font-mono text-xs text-ink-500">{account.code}</td>
                    <td className="px-4 py-2">
                      <Link
                        href={`/accounting/accounts/${account.id}`}
                        className="font-medium text-brand-700 hover:underline"
                      >
                        {account.name}
                      </Link>
                      {account.nameBn ? (
                        <span className="ml-2 text-xs text-ink-500">{account.nameBn}</span>
                      ) : null}
                    </td>
                    <td className="px-4 py-2 text-xs">{TYPE_LABEL[account.type] ?? account.type}</td>
                    <td className="px-4 py-2 text-xs">{account.normalBalance.toLowerCase()}</td>
                    <td className="px-4 py-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${
                          account.isActive
                            ? "bg-brand-50 text-brand-700 ring-brand-200"
                            : "bg-slate-100 text-ink-500 ring-slate-200"
                        }`}
                      >
                        {account.isActive ? "active" : "inactive"}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right">
                      {canWrite && !account.isSystem ? (
                        <form action={setAccountActiveAction}>
                          <input type="hidden" name="id" value={account.id} />
                          <input
                            type="hidden"
                            name="isActive"
                            value={account.isActive ? "false" : "true"}
                          />
                          <button
                            type="submit"
                            className="min-h-8 rounded-lg border border-slate-300 px-2 text-xs font-medium text-ink-700 hover:border-brand-300 hover:text-brand-700"
                          >
                            {account.isActive ? "Deactivate" : "Activate"}
                          </button>
                        </form>
                      ) : (
                        <span className="text-[11px] text-ink-400">system</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {canWrite ? (
          <section className="h-fit rounded-2xl bg-white p-4 ring-1 ring-slate-200">
            <h2 className="text-sm font-semibold">New account</h2>
            <p className="mt-1 text-xs text-ink-500">
              Pick a free code in the right range: 1xxx assets, 2xxx liabilities, 3xxx equity,
              4xxx revenue, 5xxx–6xxx expenses.
            </p>
            <form action={createAccountAction} className="mt-3 space-y-3">
              <label className="block text-xs font-medium text-ink-700">
                Code
                <input name="code" required inputMode="numeric" pattern="\d{3,6}" placeholder="6060" className={inputClass} />
              </label>
              <label className="block text-xs font-medium text-ink-700">
                Name
                <input name="name" required maxLength={120} placeholder="Repairs & maintenance" className={inputClass} />
              </label>
              <label className="block text-xs font-medium text-ink-700">
                Bangla name (optional)
                <input name="nameBn" maxLength={120} placeholder="মেরামত" className={inputClass} />
              </label>
              <label className="block text-xs font-medium text-ink-700">
                Type
                <select name="type" required className={inputClass} defaultValue="EXPENSE">
                  {Object.entries(TYPE_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs font-medium text-ink-700">
                Description (optional)
                <input name="description" maxLength={300} className={inputClass} />
              </label>
              <button
                type="submit"
                className="min-h-10 w-full rounded-xl bg-brand-600 px-3 text-sm font-semibold text-white hover:bg-brand-700"
              >
                Create account
              </button>
            </form>
          </section>
        ) : null}
      </div>
    </div>
  );
}
