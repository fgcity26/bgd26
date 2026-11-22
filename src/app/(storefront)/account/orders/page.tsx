import type { Metadata } from "next";
import Link from "next/link";
import { requireCustomer } from "@/lib/customer-auth/session";
import { listCustomerOrders } from "@/lib/customer-auth/orders";
import { formatMoney } from "@/lib/inventory/format";
import {
  FULFILLMENT_LABELS,
  ORDER_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  statusTone,
} from "@/lib/order-labels";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your orders",
  robots: { index: false, follow: false },
};

const dateTime = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Dhaka",
});

export default async function CustomerOrdersPage() {
  const customer = await requireCustomer("/account/orders");
  const orders = await listCustomerOrders(customer.id);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Your orders</h2>
          <p className="mt-1 text-sm text-ink-500">
            {orders.length === 0
              ? "No orders yet."
              : `${orders.length} order${orders.length === 1 ? "" : "s"} on this mobile number.`}
          </p>
        </div>
        <Link href="/shop" className="text-sm font-medium text-brand-700 hover:underline">
          Shop →
        </Link>
      </div>

      {orders.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 px-5 py-10 text-center">
          <p className="text-sm font-medium text-ink-700">Nothing here yet.</p>
          <p className="mt-1 text-sm text-ink-500">
            Orders placed while signed in, or as a guest with this mobile, appear here.
          </p>
          <Link
            href="/shop"
            className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-brand-600 px-5 text-sm font-semibold text-white hover:bg-brand-700"
          >
            Start shopping
          </Link>
        </div>
      ) : (
        <ul className="space-y-2">
          {orders.map((order) => (
            <li key={order.id}>
              <Link
                href={`/account/orders/${order.id}`}
                className="block rounded-2xl border border-slate-200 p-4 transition-colors hover:border-brand-300"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-mono text-sm font-semibold text-ink-900">
                      {order.orderNumber}
                    </p>
                    <p className="mt-1 text-xs text-ink-500">
                      {dateTime.format(order.placedAt)} ·{" "}
                      {order.items[0]?.productNameSnapshot ?? "Order"}
                      {order._count.items > 1 ? ` +${order._count.items - 1} more` : ""}
                    </p>
                  </div>
                  <p className="text-sm font-semibold tabular-nums">
                    ৳{formatMoney(order.grandTotal)}
                  </p>
                </div>

                <div className="mt-2 flex flex-wrap gap-1.5">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${statusTone(order.status)}`}
                  >
                    {ORDER_STATUS_LABELS[order.status] ?? order.status}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${statusTone(order.paymentStatus)}`}
                  >
                    {PAYMENT_STATUS_LABELS[order.paymentStatus] ?? order.paymentStatus}
                  </span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-ink-600 ring-1 ring-slate-200">
                    {FULFILLMENT_LABELS[order.fulfillmentStatus] ?? order.fulfillmentStatus}
                  </span>
                  {order.coupon ? (
                    <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700 ring-1 ring-brand-200">
                      {order.coupon.code}
                    </span>
                  ) : null}
                </div>

                {order.loyaltyEarnedPoints > 0 || order.loyaltyRedeemedPoints > 0 ? (
                  <p className="mt-2 text-xs text-ink-500">
                    {order.loyaltyRedeemedPoints > 0
                      ? `${order.loyaltyRedeemedPoints} points spent`
                      : null}
                    {order.loyaltyRedeemedPoints > 0 && order.loyaltyEarnedPoints > 0
                      ? " · "
                      : null}
                    {order.loyaltyEarnedPoints > 0
                      ? `${order.loyaltyEarnedPoints} points earned`
                      : null}
                  </p>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
