import Link from "next/link";
import type { Prisma } from "@/generated/prisma/client";
import type { StatementRow } from "@/lib/accounting/reports";
import { formatMoney } from "@/lib/inventory/format";

export function ReportRange({
  action,
  fromValue,
  toValue,
  fromLabel = "From",
  toLabel = "To",
}: {
  action: string;
  fromValue: string;
  toValue?: string;
  fromLabel?: string;
  toLabel?: string;
}) {
  return (
    <form action={action} method="get" className="flex flex-wrap items-end gap-2">
      <label className="block text-xs font-medium text-ink-700">
        {fromLabel}
        <input
          type="date"
          name={toValue === undefined ? "asOf" : "from"}
          defaultValue={fromValue}
          className="mt-1 block min-h-10 rounded-xl border border-slate-300 bg-white px-3 text-sm"
        />
      </label>
      {toValue === undefined ? null : (
        <label className="block text-xs font-medium text-ink-700">
          {toLabel}
          <input
            type="date"
            name="to"
            defaultValue={toValue}
            className="mt-1 block min-h-10 rounded-xl border border-slate-300 bg-white px-3 text-sm"
          />
        </label>
      )}
      <button
        type="submit"
        className="min-h-10 rounded-xl bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700"
      >
        Show
      </button>
      <Link
        href={action}
        className="min-h-10 px-3 text-sm leading-10 text-ink-500 hover:text-brand-700"
      >
        This month
      </Link>
    </form>
  );
}

export function StatementTable({
  rows,
  total,
  totalLabel,
  empty = "No movement in this period.",
  emphasis = false,
}: {
  rows: StatementRow[];
  total: Prisma.Decimal;
  totalLabel: string;
  empty?: string;
  emphasis?: boolean;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-ink-500">
            <th className="py-2 pr-3 font-medium">Code</th>
            <th className="py-2 pr-3 font-medium">Account</th>
            <th className="py-2 text-right font-medium">Amount</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={3} className="py-4 text-center text-ink-500">
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((line) => (
              <tr key={line.id}>
                <td className="py-2 pr-3 font-mono text-xs text-ink-500">{line.code}</td>
                <td className="py-2 pr-3">
                  {line.name}
                  {line.nameBn ? (
                    <span className="ml-2 text-xs text-ink-500">{line.nameBn}</span>
                  ) : null}
                </td>
                <td className="py-2 text-right tabular-nums">৳{formatMoney(line.amount)}</td>
              </tr>
            ))
          )}
        </tbody>
        <tfoot>
          <tr className={emphasis ? "border-t-2 border-slate-300 font-semibold" : "border-t border-slate-200 font-medium"}>
            <td className="py-2 pr-3" />
            <td className="py-2 pr-3">{totalLabel}</td>
            <td className="py-2 text-right tabular-nums">৳{formatMoney(total)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
