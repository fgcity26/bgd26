import type { Metadata } from "next";
import { AccountingNav } from "@/components/accounting/accounting-nav";
import { ReportsNav } from "@/components/accounting/reports-nav";
import { ReportRange, StatementTable } from "@/components/accounting/report-parts";
import { requirePagePermission } from "@/lib/auth/session";
import { profitAndLoss } from "@/lib/accounting/reports";
import { parseRange } from "@/lib/accounting/report-dates";
import { formatMoney } from "@/lib/inventory/format";

export const metadata: Metadata = {
  title: "Profit and loss",
  robots: { index: false, follow: false },
};

const dateLabel = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeZone: "Asia/Dhaka",
});

export default async function ProfitAndLossPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  await requirePagePermission("report.read");
  const { from: fromParam, to: toParam } = await searchParams;
  const range = parseRange(fromParam, toParam);
  const report = await profitAndLoss(range.from, range.to);
  const margin =
    report.netRevenue.isZero()
      ? null
      : report.netProfit.div(report.netRevenue).mul(100).toDecimalPlaces(1);

  return (
    <div className="space-y-5">
      <header className="space-y-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Profit &amp; loss · লাভ-ক্ষতি</h1>
          <p className="mt-1 text-sm text-ink-600">
            Revenue, cost of sales and operating expenses from posted journals only.
            Discounts and returns reduce net revenue; reversals are already netted.
          </p>
        </div>
        <AccountingNav />
        <ReportsNav />
      </header>

      <ReportRange
        action="/accounting/reports"
        fromValue={range.fromValue}
        toValue={range.toValue}
      />

      <p className="text-xs text-ink-500">
        {dateLabel.format(range.from)} — {dateLabel.format(range.to)} · Dhaka time
      </p>

      <section className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Net revenue</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">
            ৳{formatMoney(report.netRevenue)}
          </p>
        </div>
        <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Gross profit</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">
            ৳{formatMoney(report.grossProfit)}
          </p>
        </div>
        <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Net profit</p>
          <p
            className={`mt-1 text-2xl font-semibold tabular-nums ${
              report.netProfit.lessThan(0) ? "text-red-700" : "text-brand-700"
            }`}
          >
            ৳{formatMoney(report.netProfit)}
          </p>
          {margin === null ? null : (
            <p className="mt-1 text-xs text-ink-500">{margin.toFixed(1)}% of net revenue</p>
          )}
        </div>
      </section>

      <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
        <h2 className="text-base font-semibold">Revenue</h2>
        <div className="mt-3">
          <StatementTable
            rows={report.revenue}
            total={report.netRevenue}
            totalLabel="Net revenue"
            empty="No revenue posted in this period."
            emphasis
          />
        </div>
      </section>

      <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
        <h2 className="text-base font-semibold">Cost of sales</h2>
        <div className="mt-3">
          <StatementTable
            rows={report.costOfSales}
            total={report.totalCostOfSales}
            totalLabel="Total cost of sales"
            empty="No cost of sales posted in this period."
          />
        </div>
      </section>

      <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
        <h2 className="text-base font-semibold">Operating expenses</h2>
        <div className="mt-3">
          <StatementTable
            rows={report.operatingExpenses}
            total={report.totalOperatingExpenses}
            totalLabel="Total operating expenses"
            empty="No operating expense posted in this period."
          />
        </div>
      </section>

      <section className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold">Net profit</h2>
          <p
            className={`text-xl font-semibold tabular-nums ${
              report.netProfit.lessThan(0) ? "text-red-700" : "text-brand-700"
            }`}
          >
            ৳{formatMoney(report.netProfit)}
          </p>
        </div>
        <p className="mt-1 text-xs text-ink-500">
          Net revenue ৳{formatMoney(report.netRevenue)} − cost of sales ৳
          {formatMoney(report.totalCostOfSales)} − operating expenses ৳
          {formatMoney(report.totalOperatingExpenses)}.
        </p>
      </section>
    </div>
  );
}
