import type { Metadata } from "next";
import Link from "next/link";
import { expirePointsAction } from "@/app/actions/loyalty";
import { hasPermission } from "@/lib/auth/permissions";
import { requirePagePermission } from "@/lib/auth/session";
import { formatBdMobile } from "@/lib/crm/phone";
import { prisma } from "@/lib/db";
import { LOYALTY, loyaltyOverview } from "@/lib/loyalty/service";

export const metadata: Metadata = {
  title: "Loyalty",
  robots: { index: false, follow: false },
};

const dateTime = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Dhaka",
});

const moneyFormat = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function pointsLabel(points: number): string {
  return `${points > 0 ? "+" : ""}${points}`;
}

function typeStyle(type: string): string {
  if (type === "EARN" || type === "ADJUSTMENT") {
    return "bg-emerald-50 text-emerald-700 ring-emerald-200";
  }
  if (type === "REDEEM") return "bg-brand-50 text-brand-700 ring-brand-200";
  if (type === "EXPIRE") return "bg-amber-50 text-amber-800 ring-amber-200";
  if (type === "REVERSAL") return "bg-slate-100 text-ink-700 ring-slate-200";
  return "bg-slate-100 text-ink-700 ring-slate-200";
}

export default async function LoyaltyPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; ok?: string; error?: string }>;
}) {
  const session = await requirePagePermission("customer.read");
  const canApprove = hasPermission(session, "customer.approve");
  const { q, ok, error } = await searchParams;
  const query = q?.trim() ?? "";

  const [overview, customers] = await Promise.all([
    loyaltyOverview(),
    prisma.customer.findMany({
      where: {
        isWalkInCash: false,
        deletedAt: null,
        ...(query
          ? {
              OR: [
                { fullName: { contains: query, mode: "insensitive" as const } },
                { mobileNormalized: { contains: query.replace(/\D/g, "") } },
              ],
            }
          : { loyaltyPointsBalance: { gt: 0 } }),
      },
      orderBy: [{ loyaltyPointsBalance: "desc" }, { fullName: "asc" }],
      take: 50,
      select: {
        id: true,
        fullName: true,
        mobileNormalized: true,
        loyaltyPointsBalance: true,
        totalOrders: true,
        lastOrderAt: true,
        status: true,
      },
    }),
  ]);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Loyalty · লয়্যালটি</h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-500">
            One point per ৳{LOYALTY.takaPerPoint} of net merchandise, worth ৳
            {LOYALTY.pointValue} each. A sale may spend at most{" "}
            {Math.round(LOYALTY.redemptionCap * 100)} % of its net merchandise in points, and
            points expire after {LOYALTY.expiryMonths} months.
          </p>
        </div>
        {canApprove ? (
          <form action={expirePointsAction}>
            <button
              type="submit"
              className="min-h-11 rounded-xl border border-amber-300 bg-amber-50 px-4 text-sm font-semibold text-amber-900 hover:bg-amber-100"
            >
              Expire due points
            </button>
          </form>
        ) : null}
      </header>

      {error ? (
        <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-200">
          {error}
        </p>
      ) : null}
      {ok ? (
        <p className="rounded-xl bg-brand-50 px-3 py-2 text-sm text-brand-800 ring-1 ring-brand-200">
          {ok}
        </p>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">
            Outstanding points
          </p>
          <p className="mt-1 text-2xl font-semibold">{overview.outstandingPoints}</p>
          <p className="mt-1 text-xs text-ink-500">
            Liability ৳{moneyFormat.format(overview.outstandingPoints * LOYALTY.pointValue)}
          </p>
        </div>
        <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Holders</p>
          <p className="mt-1 text-2xl font-semibold">{overview.holders}</p>
          <p className="mt-1 text-xs text-ink-500">
            of {overview.customerCount} customers with a loyalty record
          </p>
        </div>
        <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Rules</p>
          <p className="mt-1 text-sm font-medium">Earn ৳{LOYALTY.takaPerPoint} → 1 point</p>
          <p className="mt-1 text-xs text-ink-500">
            Earned once paid or completed · redeem on the next sale · never offline
          </p>
        </div>
      </section>

      <form className="flex flex-wrap gap-2" action="/loyalty">
        <input
          name="q"
          defaultValue={query}
          placeholder="Search name or mobile"
          className="min-h-11 flex-1 rounded-xl border border-slate-300 px-3 text-sm"
        />
        <button
          type="submit"
          className="min-h-11 rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700"
        >
          Search
        </button>
        {query ? (
          <Link
            href="/loyalty"
            className="inline-flex min-h-11 items-center rounded-xl border border-slate-300 px-4 text-sm font-medium text-ink-700"
          >
            Clear
          </Link>
        ) : null}
      </form>

      <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
        <h2 className="text-base font-semibold">
          {query ? "Matching customers" : "Customers holding points"}
        </h2>
        {customers.length === 0 ? (
          <p className="mt-3 rounded-xl bg-slate-50 px-3 py-4 text-sm text-ink-500">
            {query
              ? "No customer matches that search."
              : "No points have been earned yet. A paid sale starts the ledger."}
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[36rem] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-ink-500">
                  <th className="py-2 pr-3 font-medium">Customer</th>
                  <th className="py-2 pr-3 font-medium">Mobile</th>
                  <th className="py-2 pr-3 text-right font-medium">Points</th>
                  <th className="py-2 pr-3 text-right font-medium">Orders</th>
                  <th className="py-2 pr-3 font-medium">Last order</th>
                  <th className="py-2 font-medium" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {customers.map((customer) => (
                  <tr key={customer.id}>
                    <td className="py-2 pr-3">
                      <span className="font-medium">{customer.fullName}</span>
                      {customer.status === "BLOCKED" ? (
                        <span className="ml-2 rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700 ring-1 ring-red-200">
                          blocked
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2 pr-3 text-ink-600">
                      {formatBdMobile(customer.mobileNormalized)}
                    </td>
                    <td className="py-2 pr-3 text-right font-semibold">
                      {customer.loyaltyPointsBalance}
                    </td>
                    <td className="py-2 pr-3 text-right text-ink-600">{customer.totalOrders}</td>
                    <td className="py-2 pr-3 text-xs text-ink-500">
                      {customer.lastOrderAt ? dateTime.format(customer.lastOrderAt) : "—"}
                    </td>
                    <td className="py-2 text-right">
                      <Link
                        href={`/loyalty/${customer.id}`}
                        className="text-sm font-medium text-brand-700 hover:underline"
                      >
                        Ledger
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
        <h2 className="text-base font-semibold">Recent movements</h2>
        {overview.recent.length === 0 ? (
          <p className="mt-3 text-sm text-ink-500">Nothing yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100">
            {overview.recent.map((movement) => (
              <li key={movement.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${typeStyle(movement.type)}`}
                >
                  {movement.type}
                </span>
                <span className="font-medium">{pointsLabel(movement.points)}</span>
                <Link
                  href={`/loyalty/${movement.customer.id}`}
                  className="min-w-0 truncate text-ink-700 hover:underline"
                >
                  {movement.customer.fullName} · {formatBdMobile(movement.customer.mobileNormalized)}
                </Link>
                <span className="text-xs text-ink-500">balance {movement.balanceAfter}</span>
                <span className="ml-auto text-xs text-ink-500">
                  {dateTime.format(movement.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
