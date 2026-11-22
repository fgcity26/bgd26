import type { Metadata } from "next";
import { AccountingNav } from "@/components/accounting/accounting-nav";
import { ReportsNav } from "@/components/accounting/reports-nav";
import { ReportRange, StatementTable } from "@/components/accounting/report-parts";
import { requirePagePermission } from "@/lib/auth/session";
import { balanceSheet } from "@/lib/accounting/reports";
import { parseAsOf } from "@/lib/accounting/report-dates";
import { formatMoney } from "@/lib/inventory/format";

export const metadata: Metadata = {
  title: "Balance sheet",
  robots: { index: false, follow: false },
};

const dateLabel = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeZone: "Asia/Dhaka",
});

export default async function BalanceSheetPage({
  searchParams,
}: {
  searchParams: Promise<{ asOf?: string }>;
}) {
  await requirePagePermission("report.read");
  const { asOf: asOfParam } = await searchParams;
  const { asOf, value } = parseAsOf(asOfParam);
  const report = await balanceSheet(asOf);

  const equityRows = [
    ...report.equity,
    {
      id: "accumulated-earnings",
      code: "—",
      name: "Accumulated earnings",
      nameBn: "সঞ্চিত ফলাফল",
      amount: report.accumulatedEarnings,
    },
  ].filter((line) => !line.amount.isZero());

  return (
    <div className="space-y-5">
      <header className="space-y-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            Balance sheet · উদ্বৃত্তপত্র
          </h1>
          <p className="mt-1 text-sm text-ink-600">
            Assets, liabilities and equity at a point in time, from posted journals.
            There are no closing entries yet, so the cumulative profit sits inside equity
            as accumulated earnings.
          </p>
        </div>
        <AccountingNav />
        <ReportsNav />
      </header>

      <ReportRange action="/accounting/reports/balance-sheet" fromValue={value} fromLabel="As of" />

      <div className="flex flex-wrap items-center gap-3">
        <p className="text-xs text-ink-500">
          As of {dateLabel.format(asOf)} · Dhaka time
        </p>
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${
            report.balanced
              ? "bg-brand-50 text-brand-700 ring-brand-200"
              : "bg-red-50 text-red-700 ring-red-200"
          }`}
        >
          {report.balanced
            ? "Balanced"
            : `Out by ৳${formatMoney(report.difference.abs())}`}
        </span>
      </div>

      <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
        <h2 className="text-base font-semibold">Assets</h2>
        <div className="mt-3">
          <StatementTable
            rows={report.assets}
            total={report.totalAssets}
            totalLabel="Total assets"
            empty="No asset balance yet."
            emphasis
          />
        </div>
      </section>

      <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
        <h2 className="text-base font-semibold">Liabilities</h2>
        <div className="mt-3">
          <StatementTable
            rows={report.liabilities}
            total={report.totalLiabilities}
            totalLabel="Total liabilities"
            empty="No liability balance yet."
          />
        </div>
      </section>

      <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
        <h2 className="text-base font-semibold">Equity</h2>
        <div className="mt-3">
          <StatementTable
            rows={equityRows}
            total={report.totalEquity}
            totalLabel="Total equity"
            empty="No equity balance yet."
          />
        </div>
      </section>

      <section className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200">
        <dl className="space-y-1 text-sm">
          <div className="flex justify-between">
            <dt>Total assets</dt>
            <dd className="tabular-nums">৳{formatMoney(report.totalAssets)}</dd>
          </div>
          <div className="flex justify-between">
            <dt>Total liabilities</dt>
            <dd className="tabular-nums">৳{formatMoney(report.totalLiabilities)}</dd>
          </div>
          <div className="flex justify-between">
            <dt>Total equity</dt>
            <dd className="tabular-nums">৳{formatMoney(report.totalEquity)}</dd>
          </div>
          <div className="flex justify-between border-t border-slate-300 pt-1 font-semibold">
            <dt>Liabilities + equity</dt>
            <dd className="tabular-nums">
              ৳{formatMoney(report.totalLiabilitiesAndEquity)}
            </dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
