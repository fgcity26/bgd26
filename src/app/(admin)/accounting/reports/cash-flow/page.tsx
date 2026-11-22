import type { Metadata } from "next";
import { AccountingNav } from "@/components/accounting/accounting-nav";
import { ReportsNav } from "@/components/accounting/reports-nav";
import { ReportRange } from "@/components/accounting/report-parts";
import { requirePagePermission } from "@/lib/auth/session";
import { cashFlow } from "@/lib/accounting/reports";
import { parseRange } from "@/lib/accounting/report-dates";
import { formatMoney } from "@/lib/inventory/format";

export const metadata: Metadata = {
  title: "Cash flow",
  robots: { index: false, follow: false },
};

const dateLabel = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeZone: "Asia/Dhaka",
});

const CATEGORY_LABELS: Record<string, string> = {
  OPERATING: "Operating",
  FINANCING: "Financing",
};

export default async function CashFlowPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  await requirePagePermission("report.read");
  const { from: fromParam, to: toParam } = await searchParams;
  const range = parseRange(fromParam, toParam);
  const report = await cashFlow(range.from, range.to);

  return (
    <div className="space-y-5">
      <header className="space-y-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Cash flow · নগদ প্রবাহ</h1>
          <p className="mt-1 text-sm text-ink-600">
            Every posted journal that touches cash, bank, bKash, Nagad or card clearing.
            A transfer between two cash accounts nets to zero and is not listed. There are
            no fixed-asset accounts yet, so nothing is classified as investing.
          </p>
        </div>
        <AccountingNav />
        <ReportsNav />
      </header>

      <ReportRange
        action="/accounting/reports/cash-flow"
        fromValue={range.fromValue}
        toValue={range.toValue}
      />

      <p className="text-xs text-ink-500">
        {dateLabel.format(range.from)} — {dateLabel.format(range.to)} · Dhaka time
      </p>

      <section className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">
            Opening cash
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">
            ৳{formatMoney(report.openingCash)}
          </p>
        </div>
        <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Net change</p>
          <p
            className={`mt-1 text-2xl font-semibold tabular-nums ${
              report.netChange.lessThan(0) ? "text-red-700" : "text-brand-700"
            }`}
          >
            ৳{formatMoney(report.netChange)}
          </p>
        </div>
        <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">
            Closing cash
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">
            ৳{formatMoney(report.closingCash)}
          </p>
        </div>
      </section>

      <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
        <h2 className="text-base font-semibold">Summary</h2>
        <dl className="mt-3 space-y-1 text-sm">
          <div className="flex justify-between">
            <dt>Operating inflows</dt>
            <dd className="tabular-nums text-brand-700">
              ৳{formatMoney(report.operatingIn)}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt>Operating outflows</dt>
            <dd className="tabular-nums text-red-700">
              −৳{formatMoney(report.operatingOut)}
            </dd>
          </div>
          <div className="flex justify-between border-t border-slate-200 pt-1 font-medium">
            <dt>Net operating</dt>
            <dd className="tabular-nums">
              ৳{formatMoney(report.operatingIn.sub(report.operatingOut))}
            </dd>
          </div>
          <div className="flex justify-between pt-2">
            <dt>Financing inflows</dt>
            <dd className="tabular-nums text-brand-700">
              ৳{formatMoney(report.financingIn)}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt>Financing outflows</dt>
            <dd className="tabular-nums text-red-700">
              −৳{formatMoney(report.financingOut)}
            </dd>
          </div>
          <div className="flex justify-between border-t border-slate-300 pt-1 font-semibold">
            <dt>Net change in cash</dt>
            <dd className="tabular-nums">৳{formatMoney(report.netChange)}</dd>
          </div>
        </dl>
      </section>

      <section className="overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200">
        <h2 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold">
          Cash movements
        </h2>
        {report.entries.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-ink-500">
            No cash movement in this period.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {report.entries.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink-900">
                    {entry.description}
                  </p>
                  <p className="text-xs text-ink-500">
                    {entry.entryNumber} · {dateLabel.format(entry.entryDate)} ·{" "}
                    {CATEGORY_LABELS[entry.category]}
                  </p>
                </div>
                <p
                  className={`text-sm font-semibold tabular-nums ${
                    entry.amount.lessThan(0) ? "text-red-700" : "text-brand-700"
                  }`}
                >
                  ৳{formatMoney(entry.amount)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
