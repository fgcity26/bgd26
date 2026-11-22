import type { Metadata } from "next";
import Link from "next/link";
import { requireCustomer } from "@/lib/customer-auth/session";
import { loyaltyLedger, LOYALTY } from "@/lib/loyalty/service";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Loyalty points",
  robots: { index: false, follow: false },
};

const dateTime = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Dhaka",
});

const TYPE_LABELS: Record<string, string> = {
  EARN: "Earned",
  REDEEM: "Spent",
  ADJUSTMENT: "Adjustment",
  EXPIRE: "Expired",
  REVERSAL: "Reversed",
};

export default async function CustomerLoyaltyPage() {
  const customer = await requireCustomer("/account/loyalty");
  const ledger = await loyaltyLedger(customer.id, 60);

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-brand-200 bg-brand-50 p-5">
        <p className="text-sm font-medium text-brand-700">Your balance</p>
        <p className="mt-1 text-3xl font-bold tabular-nums text-brand-800">
          {customer.loyaltyPointsBalance}
        </p>
        <p className="mt-1 text-sm text-brand-800">
          point{customer.loyaltyPointsBalance === 1 ? "" : "s"} · 1 point = ৳1
        </p>
        <p className="mt-3 text-xs leading-relaxed text-brand-900/80">
          Earn 1 point for every ৳{LOYALTY.takaPerPoint} of merchandise after discount and before
          VAT. Spend up to {Math.round(LOYALTY.redemptionCap * 100)}% of an order&apos;s
          merchandise value at checkout. Points expire {LOYALTY.expiryMonths} months after they
          are earned.
        </p>
      </section>

      <section className="rounded-2xl border border-slate-200 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold">Points history</h2>
          <Link href="/shop" className="text-sm font-medium text-brand-700 hover:underline">
            Shop →
          </Link>
        </div>

        {ledger.length === 0 ? (
          <p className="mt-3 text-sm text-ink-500">
            No points yet. Points arrive after a paid order is completed.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100">
            {ledger.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-start justify-between gap-2 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink-800">
                    {TYPE_LABELS[entry.type] ?? entry.type}
                    {entry.order ? (
                      <>
                        {" · "}
                        <Link
                          href={`/account/orders/${entry.order.id}`}
                          className="font-mono text-xs text-brand-700 hover:underline"
                        >
                          {entry.order.orderNumber}
                        </Link>
                      </>
                    ) : null}
                  </p>
                  <p className="mt-0.5 text-xs text-ink-500">
                    {dateTime.format(entry.createdAt)}
                    {entry.note ? ` · ${entry.note}` : ""}
                    {entry.expiresAt && entry.points > 0
                      ? ` · expires ${dateTime.format(entry.expiresAt)}`
                      : ""}
                  </p>
                </div>
                <div className="text-right">
                  <p
                    className={`text-sm font-semibold tabular-nums ${
                      entry.points >= 0 ? "text-brand-700" : "text-red-700"
                    }`}
                  >
                    {entry.points > 0 ? "+" : ""}
                    {entry.points}
                  </p>
                  <p className="text-xs text-ink-500">balance {entry.balanceAfter}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-ink-500">
        Points are a shop credit, not cash. They cannot be transferred, and a cancelled or refunded
        order reverses the points it earned.
      </p>
    </div>
  );
}
