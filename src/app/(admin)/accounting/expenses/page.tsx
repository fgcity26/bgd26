import type { Metadata } from "next";
import { AccountingNav } from "@/components/accounting/accounting-nav";
import {
  createExpenseAction,
  postExpenseAction,
  voidExpenseAction,
} from "@/app/actions/accounting";
import { hasPermission } from "@/lib/auth/permissions";
import { requirePagePermission } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/inventory/format";

export const metadata: Metadata = {
  title: "Expenses",
  robots: { index: false, follow: false },
};

const inputClass =
  "mt-1 block w-full min-h-10 rounded-xl border border-slate-300 bg-white px-3 text-sm text-ink-900 shadow-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100";

const dateLabel = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeZone: "Asia/Dhaka",
});

const PAYMENT_METHODS = [
  ["CASH", "Cash · নগদ"],
  ["BKASH", "bKash"],
  ["NAGAD", "Nagad"],
  ["CARD", "Card"],
  ["BANK_TRANSFER", "Bank transfer"],
  ["CHEQUE", "Cheque"],
  ["GATEWAY", "Gateway"],
  ["COD", "Courier COD"],
] as const;

function statusStyle(status: string): string {
  if (status === "POSTED") return "bg-brand-50 text-brand-700 ring-brand-200";
  if (status === "VOID") return "bg-slate-100 text-ink-500 ring-slate-200";
  return "bg-amber-50 text-amber-800 ring-amber-200";
}

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  const session = await requirePagePermission("expense.read");
  const canWrite = hasPermission(session, "expense.write");
  const canApprove = hasPermission(session, "expense.approve");
  const { error, ok } = await searchParams;

  const [expenses, expenseAccounts, cashAccounts, bankAccounts, suppliers] = await Promise.all([
    prisma.expense.findMany({
      orderBy: { expenseDate: "desc" },
      take: 60,
      select: {
        id: true,
        expenseNumber: true,
        expenseDate: true,
        category: true,
        amount: true,
        vatAmount: true,
        paymentMethod: true,
        status: true,
        description: true,
        journalEntry: { select: { id: true, entryNumber: true } },
        account: { select: { code: true, name: true } },
      },
    }),
    prisma.account.findMany({
      where: { type: "EXPENSE", isActive: true },
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true },
    }),
    prisma.cashAccount.findMany({
      where: { isActive: true },
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true },
    }),
    prisma.bankAccount.findMany({
      where: { isActive: true },
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true },
    }),
    prisma.supplier.findMany({
      where: { status: "ACTIVE" },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  const okMessage =
    ok === "created"
      ? "Expense drafted. Post it to move the books."
      : ok === "posted"
        ? "Expense posted to the journal."
        : ok === "voided"
          ? "Expense voided; a reversal was posted."
          : null;

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Expenses · খরচ</h1>
          <p className="mt-1 text-sm text-ink-600">
            Draft an expense, then post it. Posting debits the expense account and input VAT, and
            credits cash, bank or the payment account. A posted expense is voided by reversal.
          </p>
        </div>
        <AccountingNav />
      </div>

      {error ? (
        <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-200">
          {error}
        </p>
      ) : null}
      {okMessage ? (
        <p role="status" className="rounded-xl bg-brand-50 px-3 py-2 text-sm text-brand-800 ring-1 ring-brand-200">
          {okMessage}
        </p>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <section className="overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <h2 className="text-sm font-semibold">Recent expenses</h2>
            <span className="text-xs text-ink-500">{expenses.length} shown</span>
          </div>
          {expenses.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-ink-600">No expense recorded yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {expenses.map((expense) => {
                const total = expense.amount.add(expense.vatAmount);
                return (
                  <li key={expense.id} className="px-4 py-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">
                          {expense.category}
                          <span className="ml-2 font-mono text-xs text-ink-500">
                            {expense.expenseNumber}
                          </span>
                        </p>
                        <p className="mt-0.5 text-xs text-ink-500">
                          {dateLabel.format(expense.expenseDate)} ·{" "}
                          {expense.account.code} {expense.account.name} ·{" "}
                          {expense.paymentMethod.toLowerCase().replaceAll("_", " ")}
                        </p>
                        {expense.description ? (
                          <p className="mt-1 text-xs text-ink-600">{expense.description}</p>
                        ) : null}
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold tabular-nums">৳{formatMoney(total)}</p>
                        <span
                          className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${statusStyle(expense.status)}`}
                        >
                          {expense.status.toLowerCase()}
                        </span>
                      </div>
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
                      {expense.vatAmount.greaterThan(0) ? (
                        <span className="text-ink-500">
                          base ৳{formatMoney(expense.amount)} + VAT ৳{formatMoney(expense.vatAmount)}
                        </span>
                      ) : null}
                      {expense.journalEntry ? (
                        <span className="font-mono text-ink-500">{expense.journalEntry.entryNumber}</span>
                      ) : null}
                      {canApprove && expense.status === "DRAFT" ? (
                        <form action={postExpenseAction}>
                          <input type="hidden" name="id" value={expense.id} />
                          <button
                            type="submit"
                            className="min-h-8 rounded-lg bg-brand-600 px-2.5 text-xs font-semibold text-white hover:bg-brand-700"
                          >
                            Post
                          </button>
                        </form>
                      ) : null}
                      {canApprove && expense.status === "POSTED" ? (
                        <details className="w-full">
                          <summary className="cursor-pointer text-xs font-medium text-red-700">
                            Void
                          </summary>
                          <form action={voidExpenseAction} className="mt-2 flex flex-wrap gap-2">
                            <input type="hidden" name="id" value={expense.id} />
                            <input
                              name="reason"
                              required
                              minLength={3}
                              maxLength={300}
                              placeholder="Why is this expense void?"
                              className="min-h-9 flex-1 rounded-lg border border-slate-300 px-2 text-xs"
                            />
                            <button
                              type="submit"
                              className="min-h-9 rounded-lg bg-red-600 px-2.5 text-xs font-semibold text-white hover:bg-red-700"
                            >
                              Void &amp; reverse
                            </button>
                          </form>
                        </details>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {canWrite ? (
          <section className="h-fit rounded-2xl bg-white p-4 ring-1 ring-slate-200">
            <h2 className="text-sm font-semibold">New expense</h2>
            <form action={createExpenseAction} className="mt-3 space-y-3">
              <label className="block text-xs font-medium text-ink-700">
                Category
                <input name="category" required maxLength={80} placeholder="Shop rent" className={inputClass} />
              </label>
              <label className="block text-xs font-medium text-ink-700">
                Expense account
                <select name="accountId" required className={inputClass} defaultValue="">
                  <option value="" disabled>
                    Choose an account
                  </option>
                  {expenseAccounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.code} · {account.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="block text-xs font-medium text-ink-700">
                  Amount ৳
                  <input name="amount" required inputMode="decimal" placeholder="5000.00" className={inputClass} />
                </label>
                <label className="block text-xs font-medium text-ink-700">
                  VAT ৳ (optional)
                  <input name="vatAmount" inputMode="decimal" placeholder="0.00" className={inputClass} />
                </label>
              </div>
              <label className="block text-xs font-medium text-ink-700">
                Payment method
                <select name="paymentMethod" required className={inputClass} defaultValue="CASH">
                  {PAYMENT_METHODS.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="block text-xs font-medium text-ink-700">
                  Cash account (optional)
                  <select name="cashAccountId" className={inputClass} defaultValue="">
                    <option value="">Use method default</option>
                    {cashAccounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.code} · {account.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-xs font-medium text-ink-700">
                  Bank account (optional)
                  <select name="bankAccountId" className={inputClass} defaultValue="">
                    <option value="">Use method default</option>
                    {bankAccounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.code} · {account.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {suppliers.length > 0 ? (
                <label className="block text-xs font-medium text-ink-700">
                  Supplier (optional)
                  <select name="supplierId" className={inputClass} defaultValue="">
                    <option value="">None</option>
                    {suppliers.map((supplier) => (
                      <option key={supplier.id} value={supplier.id}>
                        {supplier.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label className="block text-xs font-medium text-ink-700">
                Date
                <input type="date" name="expenseDate" className={inputClass} />
              </label>
              <label className="block text-xs font-medium text-ink-700">
                Description (optional)
                <input name="description" maxLength={300} className={inputClass} />
              </label>
              <button
                type="submit"
                className="min-h-10 w-full rounded-xl bg-brand-600 px-3 text-sm font-semibold text-white hover:bg-brand-700"
              >
                Save draft
              </button>
              <p className="text-[11px] leading-relaxed text-ink-500">
                A draft touches no account. A manager posts it, which writes the journal entry.
              </p>
            </form>
          </section>
        ) : null}
      </div>
    </div>
  );
}
