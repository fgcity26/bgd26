import type { Metadata } from "next";
import Link from "next/link";
import { requireCustomer } from "@/lib/customer-auth/session";
import { listCustomerOrders } from "@/lib/customer-auth/orders";
import { listCustomerAddresses } from "@/lib/customer-auth/addresses";
import { formatMoney } from "@/lib/inventory/format";
import { ORDER_STATUS_LABELS, statusTone } from "@/lib/order-labels";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your account",
  robots: { index: false, follow: false },
};

const dateOnly = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeZone: "Asia/Dhaka",
});

export default async function AccountPage() {
  const customer = await requireCustomer("/account");
  const [orders, addresses] = await Promise.all([
    listCustomerOrders(customer.id, 3),
    listCustomerAddresses(customer.id),
  ]);
  const defaultAddress = addresses[0] ?? null;

  return (
    <div className="space-y-5">
      <section className="grid gap-3 sm:grid-cols-3">
        <Link
          href="/account/orders"
          className="rounded-2xl border border-slate-200 p-4 hover:border-brand-300"
        >
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Orders</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{customer.totalOrders}</p>
          <p className="mt-1 text-xs text-ink-500">View your order history →</p>
        </Link>
        <Link
          href="/account/loyalty"
          className="rounded-2xl border border-brand-200 bg-brand-50 p-4 hover:border-brand-400"
        >
          <p className="text-xs font-medium uppercase tracking-wide text-brand-700">Points</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-brand-700">
            {customer.loyaltyPointsBalance}
          </p>
          <p className="mt-1 text-xs text-brand-700">
            1 point = ৳1 · spend up to 20% of an order →
          </p>
        </Link>
        <Link
          href="/account/addresses"
          className="rounded-2xl border border-slate-200 p-4 hover:border-brand-300"
        >
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Addresses</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{addresses.length}</p>
          <p className="mt-1 truncate text-xs text-ink-500">
            {defaultAddress
              ? `${defaultAddress.label ?? "Home"} · ${defaultAddress.district}`
              : "Add a delivery address →"}
          </p>
        </Link>
      </section>

      <section className="rounded-2xl border border-slate-200 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold">Recent orders</h2>
          <Link href="/account/orders" className="text-sm font-medium text-brand-700 hover:underline">
            All orders →
          </Link>
        </div>

        {orders.length === 0 ? (
          <p className="mt-3 text-sm text-ink-500">
            No orders yet.{" "}
            <Link href="/shop" className="font-medium text-brand-700 hover:underline">
              Start shopping
            </Link>
            .
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100">
            {orders.map((order) => (
              <li key={order.id} className="py-3 first:pt-1 last:pb-1">
                <Link
                  href={`/account/orders/${order.id}`}
                  className="flex flex-wrap items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <p className="font-mono text-sm text-ink-900">{order.orderNumber}</p>
                    <p className="mt-0.5 text-xs text-ink-500">
                      {dateOnly.format(order.placedAt)} · {order._count.items} item
                      {order._count.items === 1 ? "" : "s"} · ৳{formatMoney(order.grandTotal)}
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${statusTone(order.status)}`}
                  >
                    {ORDER_STATUS_LABELS[order.status] ?? order.status}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-ink-600">
        <p className="font-medium text-ink-800">Need help with an order?</p>
        <p className="mt-1">
          Use{" "}
          <Link href="/track" className="font-medium text-brand-700 hover:underline">
            Track order
          </Link>{" "}
          with your order number, or message the shop on WhatsApp. Keep your mobile number handy.
        </p>
      </section>
    </div>
  );
}
