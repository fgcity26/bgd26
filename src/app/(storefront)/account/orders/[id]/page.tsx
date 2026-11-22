import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCustomer } from "@/lib/customer-auth/session";
import { customerOrderDetail } from "@/lib/customer-auth/orders";
import { formatMoney } from "@/lib/inventory/format";
import {
  FULFILLMENT_LABELS,
  ORDER_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  SHIPMENT_STATUS_LABELS,
  statusTone,
} from "@/lib/order-labels";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Order detail",
  robots: { index: false, follow: false },
};

const dateTime = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Dhaka",
});

export default async function CustomerOrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const customer = await requireCustomer("/account/orders");
  const { id } = await params;
  const order = await customerOrderDetail(customer.id, id);
  if (!order) notFound();

  const address =
    order.shippingAddress && typeof order.shippingAddress === "object"
      ? (order.shippingAddress as Record<string, unknown>)
      : null;
  const addressParts = address
    ? [address.address, address.upazila, address.district, address.division]
        .filter((part): part is string => typeof part === "string" && Boolean(part.trim()))
        .join(", ")
    : "";

  return (
    <div className="space-y-5">
      <div>
        <Link href="/account/orders" className="text-sm font-medium text-brand-700 hover:underline">
          ← All orders
        </Link>
      </div>

      <section className="rounded-2xl border border-brand-200 bg-brand-50 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="font-mono text-xl font-semibold tracking-tight">{order.orderNumber}</h2>
            <p className="mt-1 text-sm text-ink-600">
              Placed {dateTime.format(order.placedAt)}
            </p>
          </div>
          <p className="text-xl font-semibold tabular-nums">৳{formatMoney(order.grandTotal)}</p>
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
          <span className="rounded-full bg-white/70 px-2 py-0.5 text-xs font-medium text-ink-600 ring-1 ring-slate-200">
            {FULFILLMENT_LABELS[order.fulfillmentStatus] ?? order.fulfillmentStatus}
          </span>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 p-4">
        <h3 className="text-base font-semibold">Items</h3>
        <ul className="mt-3 divide-y divide-slate-100">
          {order.items.map((item) => (
            <li key={item.id} className="flex gap-3 py-3 first:pt-0 last:pb-0">
              <div className="size-14 shrink-0 overflow-hidden rounded-lg bg-slate-100">
                {item.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.imageUrl}
                    alt={item.productNameSnapshot}
                    width={120}
                    height={120}
                    className="size-full object-cover"
                  />
                ) : (
                  <span className="grid size-full place-items-center text-lg font-bold text-slate-300">
                    {item.productNameSnapshot.slice(0, 1)}
                  </span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{item.productNameSnapshot}</p>
                <p className="text-xs text-ink-500">
                  {item.variantNameSnapshot} · {item.skuSnapshot} · × {item.quantity}
                </p>
              </div>
              <p className="shrink-0 text-sm font-medium">৳{formatMoney(item.lineTotal)}</p>
            </li>
          ))}
        </ul>

        <dl className="mt-4 space-y-1.5 border-t border-slate-200 pt-3 text-sm">
          <div className="flex justify-between">
            <dt className="text-ink-500">Merchandise</dt>
            <dd>৳{formatMoney(order.subtotal)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-ink-500">VAT</dt>
            <dd>৳{formatMoney(order.vatTotal)}</dd>
          </div>
          {Number(order.couponDiscount) > 0 ? (
            <div className="flex justify-between text-brand-700">
              <dt>Coupon {order.coupon?.code}</dt>
              <dd>−৳{formatMoney(order.couponDiscount)}</dd>
            </div>
          ) : null}
          {Number(order.loyaltyDiscount) > 0 ? (
            <div className="flex justify-between text-brand-700">
              <dt>Loyalty points ({order.loyaltyRedeemedPoints})</dt>
              <dd>−৳{formatMoney(order.loyaltyDiscount)}</dd>
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
          {order.loyaltyEarnedPoints > 0 ? (
            <div className="flex justify-between text-xs text-brand-700">
              <dt>Points earned</dt>
              <dd>{order.loyaltyEarnedPoints}</dd>
            </div>
          ) : null}
        </dl>
      </section>

      <div className="grid gap-4 sm:grid-cols-2">
        <section className="rounded-2xl border border-slate-200 p-4">
          <h3 className="text-sm font-semibold">Delivery to</h3>
          <p className="mt-2 text-sm font-medium">{order.recipientName}</p>
          <p className="text-sm text-ink-500">{order.recipientMobile}</p>
          {addressParts ? (
            <p className="mt-2 text-sm text-ink-700">{addressParts}</p>
          ) : null}
          {order.deliveryZone ? (
            <p className="mt-2 text-xs text-ink-500">
              {order.deliveryZone.name} · {order.deliveryZone.estimatedDaysMin}–
              {order.deliveryZone.estimatedDaysMax} days
            </p>
          ) : null}
          {order.customerNote ? (
            <p className="mt-3 whitespace-pre-line rounded-lg bg-slate-50 px-3 py-2 text-xs text-ink-600">
              {order.customerNote}
            </p>
          ) : null}
        </section>

        <section className="rounded-2xl border border-slate-200 p-4">
          <h3 className="text-sm font-semibold">Payment</h3>
          <ul className="mt-2 space-y-2 text-sm">
            {order.payments.length === 0 ? (
              <li className="text-ink-500">No payment recorded yet.</li>
            ) : (
              order.payments.map((payment, index) => (
                <li key={`${payment.method}-${index}`} className="flex justify-between gap-3">
                  <span className="text-ink-700">
                    {payment.method.replaceAll("_", " ")}
                    <span className="block text-xs text-ink-500">
                      {PAYMENT_STATUS_LABELS[payment.status] ?? payment.status}
                    </span>
                  </span>
                  <span className="tabular-nums">৳{formatMoney(payment.amount)}</span>
                </li>
              ))
            )}
          </ul>
        </section>
      </div>

      {order.shipments.length > 0 ? (
        <section className="rounded-2xl border border-slate-200 p-4">
          <h3 className="text-base font-semibold">Delivery progress</h3>
          <ul className="mt-3 space-y-3">
            {order.shipments.map((shipment) => (
              <li key={shipment.id} className="rounded-xl bg-slate-50 p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-medium">
                    {shipment.courier?.name ?? "Courier"}{" "}
                    <span className="font-mono text-xs text-ink-500">
                      {shipment.shipmentNumber}
                    </span>
                  </p>
                  <span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-ink-600 ring-1 ring-slate-200">
                    {SHIPMENT_STATUS_LABELS[shipment.status] ?? shipment.status}
                  </span>
                </div>
                {shipment.trackingNumber ? (
                  <p className="mt-1 font-mono text-xs text-ink-500">
                    Tracking {shipment.trackingNumber}
                  </p>
                ) : null}
                <ul className="mt-2 space-y-1">
                  {shipment.trackingEvents.map((event) => (
                    <li key={event.id} className="text-xs text-ink-600">
                      {dateTime.format(event.eventAt)} ·{" "}
                      {SHIPMENT_STATUS_LABELS[event.status] ?? event.status}
                      {event.message ? ` · ${event.message}` : ""}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {order.statusHistory.length > 0 ? (
        <section className="rounded-2xl border border-slate-200 p-4">
          <h3 className="text-base font-semibold">History</h3>
          <ul className="mt-3 space-y-2">
            {order.statusHistory.map((entry, index) => (
              <li key={`${entry.createdAt.toISOString()}-${index}`} className="text-sm">
                <span className="text-ink-700">
                  {entry.field === "ORDER_STATUS"
                    ? (ORDER_STATUS_LABELS[entry.toValue ?? ""] ?? entry.toValue)
                    : entry.field === "PAYMENT_STATUS"
                      ? (PAYMENT_STATUS_LABELS[entry.toValue ?? ""] ?? entry.toValue)
                      : (FULFILLMENT_LABELS[entry.toValue ?? ""] ?? entry.toValue)}{" "}
                  status
                </span>
                <span className="block text-xs text-ink-500">
                  {dateTime.format(entry.createdAt)}
                  {entry.note ? ` · ${entry.note}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
