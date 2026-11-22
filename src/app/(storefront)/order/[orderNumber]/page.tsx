import type { Metadata } from "next";
import Link from "next/link";
import { formatMoney } from "@/lib/inventory/format";
import { getOrderForGuest } from "@/lib/storefront/checkout";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Order",
  robots: { index: false, follow: false },
};

type Params = {
  params: Promise<{ orderNumber: string }>;
  searchParams: Promise<{ t?: string }>;
};

const dateTime = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Dhaka",
});

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Draft",
  PENDING_PAYMENT: "Waiting for payment",
  CONFIRMED: "Confirmed",
  PROCESSING: "Processing",
  READY_TO_SHIP: "Ready to ship",
  SHIPPED: "Shipped",
  DELIVERED: "Delivered",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  RETURNED: "Returned",
  REFUNDED: "Refunded",
  ON_HOLD: "On hold",
};

const PAYMENT_LABEL: Record<string, string> = {
  UNPAID: "Unpaid",
  PARTIALLY_PAID: "Partly paid",
  PENDING_VERIFICATION: "Verifying payment",
  PAID: "Paid",
  PARTIALLY_REFUNDED: "Partly refunded",
  REFUNDED: "Refunded",
  FAILED: "Payment failed",
};

export default async function OrderPage({ params, searchParams }: Params) {
  const { orderNumber } = await params;
  const { t } = await searchParams;
  const order = await getOrderForGuest(orderNumber, t ?? null);

  if (!order) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl border border-slate-200 px-6 py-12 text-center">
        <h1 className="text-xl font-semibold">This order link has expired</h1>
        <p className="mt-2 text-sm text-ink-500">
          For your privacy, order links last seven days. Enter your order number and mobile to get a
          fresh one.
        </p>
        <Link
          href="/track"
          className="mt-5 inline-flex min-h-11 items-center rounded-xl bg-brand-600 px-5 text-sm font-semibold text-white hover:bg-brand-700"
        >
          Track your order
        </Link>
      </div>
    );
  }

  const address = order.shippingAddress;
  const isPending = order.paymentStatus === "PENDING_VERIFICATION";

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <section className="rounded-2xl border border-brand-200 bg-brand-50 p-5">
        <p className="text-sm font-medium text-brand-700">Thank you</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">Order {order.orderNumber}</h1>
        <p className="mt-2 text-sm text-ink-700">
          Placed {dateTime.format(new Date(order.placedAt))} ·{" "}
          <span className="font-medium">{STATUS_LABEL[order.status] ?? order.status}</span> ·{" "}
          <span className="font-medium">
            {PAYMENT_LABEL[order.paymentStatus] ?? order.paymentStatus}
          </span>
        </p>
        {isPending ? (
          <p className="mt-3 rounded-xl bg-white/70 px-3 py-2 text-sm text-ink-700">
            {order.payments.some((payment) => payment.method === "COD")
              ? "Pay the courier when the parcel arrives. We will confirm the order by mobile."
              : "We are checking your bKash/Nagad transaction. The order moves to processing once it is verified."}
          </p>
        ) : null}
      </section>

      <section className="rounded-2xl border border-slate-200 p-4 sm:p-5">
        <h2 className="text-base font-semibold">Items</h2>
        <ul className="mt-3 divide-y divide-slate-100">
          {order.items.map((item, index) => (
            <li key={`${item.sku}-${index}`} className="flex gap-3 py-3 first:pt-0 last:pb-0">
              <div className="size-14 shrink-0 overflow-hidden rounded-lg bg-slate-100">
                {item.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.imageUrl}
                    alt={item.name}
                    width={120}
                    height={120}
                    className="size-full object-cover"
                  />
                ) : (
                  <span className="grid size-full place-items-center text-lg font-bold text-slate-300">
                    {item.name.slice(0, 1)}
                  </span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{item.name}</p>
                <p className="text-xs text-ink-500">
                  {item.variantName} · {item.sku} · × {item.quantity}
                </p>
              </div>
              <p className="shrink-0 text-sm font-medium">৳{formatMoney(item.lineTotal)}</p>
            </li>
          ))}
        </ul>

        <dl className="mt-4 space-y-1.5 border-t border-slate-200 pt-3 text-sm">
          <div className="flex justify-between">
            <dt className="text-ink-500">Merchandise</dt>
            <dd>৳{formatMoney(Number(order.subtotal) + Number(order.vatTotal))}</dd>
          </div>
          {Number(order.couponDiscount) > 0 ? (
            <div className="flex justify-between text-brand-700">
              <dt>Coupon {order.couponCode}</dt>
              <dd>−৳{formatMoney(order.couponDiscount)}</dd>
            </div>
          ) : null}
          <div className="flex justify-between">
            <dt className="text-ink-500">Delivery</dt>
            <dd>
              {Number(order.deliveryCharge) === 0
                ? "Free"
                : `৳${formatMoney(order.deliveryCharge)}`}
            </dd>
          </div>
          <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-semibold">
            <dt>Total</dt>
            <dd>৳{formatMoney(order.grandTotal)}</dd>
          </div>
          <div className="flex justify-between text-xs text-ink-500">
            <dt>Paid</dt>
            <dd>৳{formatMoney(order.paidAmount)}</dd>
          </div>
          <div className="flex justify-between text-xs text-ink-500">
            <dt>Due</dt>
            <dd>৳{formatMoney(order.dueAmount)}</dd>
          </div>
        </dl>
      </section>

      <div className="grid gap-4 sm:grid-cols-2">
        <section className="rounded-2xl border border-slate-200 p-4">
          <h2 className="text-sm font-semibold">Delivery to</h2>
          <p className="mt-2 text-sm font-medium">{order.recipientName}</p>
          <p className="text-sm text-ink-500">{order.recipientMobile}</p>
          {address ? (
            <p className="mt-2 whitespace-pre-line text-sm text-ink-700">
              {[address.address, address.upazila, address.district, address.division]
                .filter((value) => typeof value === "string" && value.trim())
                .join(", ")}
            </p>
          ) : null}
          {order.deliveryZone ? (
            <p className="mt-2 text-xs text-ink-500">{order.deliveryZone}</p>
          ) : null}
        </section>

        <section className="rounded-2xl border border-slate-200 p-4">
          <h2 className="text-sm font-semibold">Payment</h2>
          <ul className="mt-2 space-y-2 text-sm">
            {order.payments.map((payment, index) => (
              <li key={`${payment.method}-${index}`} className="flex justify-between gap-2">
                <span>
                  {payment.method}
                  {payment.reference ? (
                    <span className="block text-xs text-ink-500">{payment.reference}</span>
                  ) : null}
                </span>
                <span className="text-right">
                  ৳{formatMoney(payment.amount)}
                  <span className="block text-xs text-ink-500">
                    {PAYMENT_LABEL[payment.status] ?? payment.status}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          {order.customerNote ? (
            <p className="mt-3 border-t border-slate-100 pt-2 text-xs text-ink-500">
              Note: {order.customerNote}
            </p>
          ) : null}
        </section>
      </div>

      <section className="rounded-2xl border border-slate-200 p-4 sm:p-5">
        <h2 className="text-base font-semibold">Order updates</h2>
        <ol className="mt-3 space-y-3">
          {order.timeline.map((entry, index) => (
            <li key={`${entry.field}-${index}`} className="flex gap-3 text-sm">
              <span className="mt-1 size-2 shrink-0 rounded-full bg-brand-500" aria-hidden />
              <span>
                <span className="font-medium">
                  {entry.field === "PAYMENT_STATUS"
                    ? (PAYMENT_LABEL[entry.value] ?? entry.value)
                    : (STATUS_LABEL[entry.value] ?? entry.value)}
                </span>
                <span className="block text-xs text-ink-500">
                  {dateTime.format(new Date(entry.at))}
                  {entry.note ? ` · ${entry.note}` : ""}
                </span>
              </span>
            </li>
          ))}
        </ol>
      </section>

      <div className="flex flex-wrap gap-3">
        <Link
          href="/shop"
          className="inline-flex min-h-11 items-center rounded-xl bg-brand-600 px-5 text-sm font-semibold text-white hover:bg-brand-700"
        >
          Continue shopping
        </Link>
        <Link
          href="/track"
          className="inline-flex min-h-11 items-center rounded-xl border border-slate-300 px-5 text-sm font-semibold text-ink-700 hover:border-brand-300 hover:text-brand-700"
        >
          Track another order
        </Link>
      </div>
    </div>
  );
}
