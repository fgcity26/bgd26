import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { adjustPointsAction, expirePointsAction } from "@/app/actions/loyalty";
import { hasPermission } from "@/lib/auth/permissions";
import { requirePagePermission } from "@/lib/auth/session";
import { formatBdMobile } from "@/lib/crm/phone";
import { prisma } from "@/lib/db";
import { loyaltyLedger } from "@/lib/loyalty/service";

export const metadata: Metadata = {
  title: "Loyalty ledger",
  robots: { index: false, follow: false },
};

const dateTime = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Dhaka",
});

const dateOnly = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeZone: "Asia/Dhaka",
});

function typeStyle(type: string): string {
  if (type === "EARN") return "bg-emerald-50 text-emerald-700 ring-emerald-200";
  if (type === "REDEEM") return "bg-brand-50 text-brand-700 ring-brand-200";
  if (type === "EXPIRE") return "bg-amber-50 text-amber-800 ring-amber-200";
  if (type === "REVERSAL") return "bg-slate-100 text-ink-700 ring-slate-200";
  return "bg-indigo-50 text-indigo-700 ring-indigo-200";
}

export default async function LoyaltyCustomerPage({
  params,
  searchParams,
}: {
  params: Promise<{ customerId: string }>;
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const session = await requirePagePermission("customer.read");
  const canApprove = hasPermission(session, "customer.approve");
  const { customerId } = await params;
  const { ok, error } = await searchParams;

  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: {
      id: true,
      fullName: true,
      mobileNormalized: true,
      status: true,
      deletedAt: true,
      isWalkInCash: true,
      loyaltyPointsBalance: true,
      totalOrders: true,
      lifetimeValue: true,
      lastOrderAt: true,
    },
  });
  if (!customer) notFound();

  const [ledger, earned, redeemed, expired, adjusted, reversed] = await Promise.all([
    loyaltyLedger(customer.id),
    prisma.loyaltyTransaction.aggregate({
      where: { customerId: customer.id, type: "EARN" },
      _sum: { points: true },
    }),
    prisma.loyaltyTransaction.aggregate({
      where: { customerId: customer.id, type: "REDEEM" },
      _sum: { points: true },
    }),
    prisma.loyaltyTransaction.aggregate({
      where: { customerId: customer.id, type: "EXPIRE" },
      _sum: { points: true },
    }),
    prisma.loyaltyTransaction.aggregate({
      where: { customerId: customer.id, type: "ADJUSTMENT" },
      _sum: { points: true },
    }),
    prisma.loyaltyTransaction.aggregate({
      where: { customerId: customer.id, type: "REVERSAL" },
      _sum: { points: true },
    }),
  ]);

  return (
    <div className="space-y-5">
      <header className="space-y-3">
        <Link href="/loyalty" className="text-sm font-medium text-brand-700 hover:underline">
          ← Loyalty
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{customer.fullName}</h1>
            <p className="mt-1 text-sm text-ink-500">
              {formatBdMobile(customer.mobileNormalized)} ·{" "}
              <Link href={`/customers/${customer.id}`} className="text-brand-700 hover:underline">
                customer profile
              </Link>
              {customer.deletedAt ? " · soft-deleted" : ""}
              {customer.status === "BLOCKED" ? " · blocked" : ""}
            </p>
          </div>
          {canApprove && !customer.isWalkInCash ? (
            <form action={expirePointsAction}>
              <input type="hidden" name="customerId" value={customer.id} />
              <button
                type="submit"
                className="min-h-11 rounded-xl border border-amber-300 bg-amber-50 px-4 text-sm font-semibold text-amber-900 hover:bg-amber-100"
              >
                Expire due points
              </button>
            </form>
          ) : null}
        </div>
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

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="rounded-2xl bg-brand-50 p-4 ring-1 ring-brand-200">
          <p className="text-xs font-medium uppercase tracking-wide text-brand-700">Balance</p>
          <p className="mt-1 text-2xl font-semibold text-brand-900">
            {customer.loyaltyPointsBalance}
          </p>
          <p className="mt-1 text-xs text-brand-800">points · ৳1 each</p>
        </div>
        <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Earned</p>
          <p className="mt-1 text-lg font-semibold">{earned._sum.points ?? 0}</p>
        </div>
        <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Redeemed</p>
          <p className="mt-1 text-lg font-semibold">
            {Math.abs(redeemed._sum.points ?? 0)}
          </p>
        </div>
        <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Expired</p>
          <p className="mt-1 text-lg font-semibold">{Math.abs(expired._sum.points ?? 0)}</p>
        </div>
        <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">
            Adjustments / reversals
          </p>
          <p className="mt-1 text-lg font-semibold">
            {adjusted._sum.points ?? 0} / {reversed._sum.points ?? 0}
          </p>
        </div>
      </section>

      {canApprove && !customer.isWalkInCash && !customer.deletedAt ? (
        <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <h2 className="text-base font-semibold">Manual adjustment</h2>
          <p className="mt-1 text-xs text-ink-500">
            Positive points are a goodwill grant and expire in twelve months; negative points
            are a correction and cannot take the balance below zero. Every adjustment posts a
            balanced journal.
          </p>
          <form action={adjustPointsAction} className="mt-3 grid gap-2 sm:grid-cols-[8rem_minmax(0,1fr)_auto]">
            <input type="hidden" name="customerId" value={customer.id} />
            <input
              name="points"
              type="number"
              step="1"
              required
              placeholder="+/- points"
              aria-label="Points"
              className="min-h-11 rounded-xl border border-slate-300 px-3 text-sm"
            />
            <input
              name="reason"
              required
              minLength={3}
              maxLength={300}
              placeholder="Reason (required)"
              aria-label="Reason"
              className="min-h-11 rounded-xl border border-slate-300 px-3 text-sm"
            />
            <button
              type="submit"
              className="min-h-11 rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700"
            >
              Adjust
            </button>
          </form>
        </section>
      ) : null}

      <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
        <h2 className="text-base font-semibold">Points ledger</h2>
        {ledger.length === 0 ? (
          <p className="mt-3 rounded-xl bg-slate-50 px-3 py-4 text-sm text-ink-500">
            No movements yet. Points appear here once a sale is paid or completed.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[44rem] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-ink-500">
                  <th className="py-2 pr-3 font-medium">When</th>
                  <th className="py-2 pr-3 font-medium">Type</th>
                  <th className="py-2 pr-3 text-right font-medium">Points</th>
                  <th className="py-2 pr-3 text-right font-medium">Balance</th>
                  <th className="py-2 pr-3 font-medium">Note</th>
                  <th className="py-2 font-medium">Expires</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {ledger.map((row) => (
                  <tr key={row.id}>
                    <td className="py-2 pr-3 text-xs text-ink-500">
                      {dateTime.format(row.createdAt)}
                    </td>
                    <td className="py-2 pr-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${typeStyle(row.type)}`}
                      >
                        {row.type}
                      </span>
                    </td>
                    <td
                      className={`py-2 pr-3 text-right font-semibold ${
                        row.points > 0 ? "text-emerald-700" : "text-red-700"
                      }`}
                    >
                      {row.points > 0 ? "+" : ""}
                      {row.points}
                    </td>
                    <td className="py-2 pr-3 text-right">{row.balanceAfter}</td>
                    <td className="py-2 pr-3 text-xs text-ink-600">
                      {row.order ? (
                        <Link
                          href={`/orders/${row.order.id}`}
                          className="text-brand-700 hover:underline"
                        >
                          {row.order.orderNumber}
                        </Link>
                      ) : null}
                      {row.note ? <span className={row.order ? " · " : ""}>{row.note}</span> : null}
                      {row.createdBy ? (
                        <span className="block text-[11px] text-ink-500">
                          by {row.createdBy.fullName}
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2 text-xs text-ink-500">
                      {row.expiresAt ? dateOnly.format(row.expiresAt) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
