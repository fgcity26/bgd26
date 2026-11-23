import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DraftConversionForm } from "@/components/ai/draft-conversion-form";
import { CancelOrderForm, OrderStatusForm } from "@/components/orders/order-actions";
import { OrdersNav } from "@/components/orders/orders-nav";
import { RefundForm, type RefundableItem } from "@/components/orders/refund-form";
import { hasPermission } from "@/lib/auth/permissions";
import { requirePagePermission } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { formatMoney, formatQty } from "@/lib/inventory/format";
import { canTransition, nextStatuses } from "@/lib/orders/service";

export const metadata: Metadata = {
  title: "Order",
  robots: { index: false, follow: false },
};

const dateTime = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Dhaka",
});

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  PENDING_PAYMENT: "Pending payment",
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

const SHIPMENT_LABELS: Record<string, string> = {
  PENDING: "Pending booking",
  BOOKED: "Booked",
  PICKED_UP: "Picked up",
  IN_TRANSIT: "In transit",
  OUT_FOR_DELIVERY: "Out for delivery",
  DELIVERED: "Delivered",
  RETURNED: "Returned",
  CANCELLED: "Cancelled",
  FAILED: "Failed",
};

const REFUNDABLE = new Set([
  "CONFIRMED",
  "PROCESSING",
  "READY_TO_SHIP",
  "SHIPPED",
  "DELIVERED",
  "COMPLETED",
]);

function statusStyle(status: string): string {
  if (status === "COMPLETED" || status === "DELIVERED" || status === "PAID") {
    return "bg-brand-50 text-brand-700 ring-brand-200";
  }
  if (status === "CANCELLED" || status === "REFUNDED" || status === "RETURNED") {
    return "bg-slate-100 text-ink-500 ring-slate-200";
  }
  if (
    status === "ON_HOLD" ||
    status === "PENDING_VERIFICATION" ||
    status === "PENDING_PAYMENT"
  ) {
    return "bg-amber-50 text-amber-800 ring-amber-200";
  }
  if (status === "UNPAID" || status === "FAILED") {
    return "bg-red-50 text-red-800 ring-red-200";
  }
  return "bg-slate-100 text-ink-700 ring-slate-200";
}

export default async function OrderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  const session = await requirePagePermission("order.read");
  const { id } = await params;
  const { error, ok } = await searchParams;

  const canWriteOrder = hasPermission(session, "order.write");
  const canWriteAi = hasPermission(session, "ai.write");
  const canApproveOrder = hasPermission(session, "order.approve");
  const canWriteRefund = hasPermission(session, "refund.write");
  const canWriteShipment = hasPermission(session, "shipment.write");

  const order = await prisma.order.findUnique({
    where: { id },
    select: {
      id: true,
      orderNumber: true,
      channel: true,
      source: true,
      status: true,
      paymentStatus: true,
      fulfillmentStatus: true,
      grandTotal: true,
      subtotal: true,
      discountTotal: true,
      vatTotal: true,
      deliveryCharge: true,
      paidAmount: true,
      dueAmount: true,
      placedAt: true,
      confirmedAt: true,
      cancelledAt: true,
      cancelReason: true,
      isWalkInCash: true,
      walkInReason: true,
      aiDraft: true,
      internalNote: true,
      customerNote: true,
      offlineCreatedAt: true,
      syncedAt: true,
      clientTransactionUuid: true,
      recipientName: true,
      recipientMobile: true,
      customer: {
        select: { id: true, fullName: true, mobileNormalized: true, customerType: true },
      },
      cashier: { select: { fullName: true } },
      posDevice: { select: { code: true, name: true } },
      posShift: { select: { shiftNumber: true } },
      warehouse: { select: { code: true } },
      walkInApprover: { select: { fullName: true } },
      items: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          productNameSnapshot: true,
          variantNameSnapshot: true,
          skuSnapshot: true,
          unitPrice: true,
          quantity: true,
          refundedQty: true,
          discountAmount: true,
          vatAmount: true,
          lineSubtotal: true,
          lineTotal: true,
          fulfillmentType: true,
        },
      },
      payments: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          paymentNumber: true,
          method: true,
          status: true,
          amount: true,
          notes: true,
          isOffline: true,
          verificationMethod: true,
          verifiedAt: true,
          verifiedBy: { select: { fullName: true } },
          createdAt: true,
        },
      },
      refunds: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          refundNumber: true,
          status: true,
          refundType: true,
          totalAmount: true,
          reason: true,
          createdAt: true,
          approvedAt: true,
          completedAt: true,
          items: {
            select: {
              id: true,
              quantity: true,
              restock: true,
              lineTotal: true,
              orderItem: {
                select: { productNameSnapshot: true, skuSnapshot: true },
              },
            },
          },
        },
      },
      shipments: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          shipmentNumber: true,
          status: true,
          trackingNumber: true,
          codAmount: true,
          createdAt: true,
          deliveredAt: true,
          courier: { select: { name: true } },
        },
      },
      statusHistory: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          field: true,
          fromValue: true,
          toValue: true,
          note: true,
          createdAt: true,
          actor: { select: { fullName: true } },
        },
      },
    },
  });

  if (!order) notFound();

  const allowed = canWriteOrder
    ? nextStatuses(order.status).map((status) => ({
        value: status,
        label: STATUS_LABELS[status] ?? status,
      }))
    : [];
  const canCancel = canApproveOrder && canTransition(order.status, "CANCELLED");

  const refundableItems: RefundableItem[] = order.items.map((item) => {
    const remaining = Number(item.quantity) - Number(item.refundedQty);
    return {
      id: item.id,
      label: `${item.productNameSnapshot}${item.variantNameSnapshot ? ` · ${item.variantNameSnapshot}` : ""}`,
      sku: item.skuSnapshot,
      quantity: formatQty(item.quantity),
      refundedQty: formatQty(item.refundedQty),
      remaining: String(Math.max(0, remaining)),
      unitPrice: item.unitPrice.toString(),
      lineTotal: item.lineTotal.toString(),
    };
  });
  const hasRefundable = REFUNDABLE.has(order.status) && canWriteRefund;

  return (
    <div className="space-y-5">
      <header className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-ink-500">Order</p>
            <h1 className="text-2xl font-bold tracking-tight">{order.orderNumber}</h1>
            <p className="mt-1 text-sm text-ink-500">
              {dateTime.format(order.placedAt)} · {order.source.replaceAll("_", " ")} ·{" "}
              {order.channel}
              {order.posDevice ? ` · ${order.posDevice.code}` : ""}
              {order.posShift ? ` · ${order.posShift.shiftNumber}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span
              className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ring-1 ${statusStyle(order.status)}`}
            >
              {order.status.replaceAll("_", " ")}
            </span>
            <span
              className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ring-1 ${statusStyle(order.paymentStatus)}`}
            >
              {order.paymentStatus.replaceAll("_", " ")}
            </span>
          </div>
        </div>
        <OrdersNav />
      </header>

      {error ? (
        <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-200">
          {error}
        </p>
      ) : null}
      {ok ? (
        <p className="rounded-xl bg-brand-50 px-3 py-2 text-sm text-brand-800 ring-1 ring-brand-200">
          Saved.
        </p>
      ) : null}
      {order.cancelReason ? (
        <p className="rounded-xl bg-slate-100 px-3 py-2 text-sm text-ink-700">
          Cancelled: {order.cancelReason}
        </p>
      ) : null}
      {order.isWalkInCash ? (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200">
          Walk-in cash sale{order.walkInApprover ? ` approved by ${order.walkInApprover.fullName}` : ""}.
          {order.walkInReason ? ` ${order.walkInReason}.` : ""}
        </p>
      ) : null}
      {order.aiDraft ? (
        <div className="rounded-xl bg-brand-50 px-3 py-2 text-sm text-brand-900 ring-1 ring-brand-200">
          <p className="font-semibold">Assistant draft · সহায়কের ড্রাফট</p>
          <p className="mt-1 text-brand-800">
            This draft reserved no stock, took no payment and posted no journal. Convert it to a
            sale to re-price every line and reserve stock.
          </p>
        </div>
      ) : null}
      {order.internalNote ? (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200">
          {order.internalNote}
        </p>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-4">
          <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <h2 className="text-sm font-semibold">Items · পণ্য</h2>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-ink-500">
                  <tr>
                    <th className="py-2 pr-3">Item</th>
                    <th className="py-2 pr-3 text-right">Qty</th>
                    <th className="py-2 pr-3 text-right">Price</th>
                    <th className="py-2 pr-3 text-right">VAT</th>
                    <th className="py-2 pr-3 text-right">Line total</th>
                    <th className="py-2 text-right">Refunded</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {order.items.map((item) => (
                    <tr key={item.id}>
                      <td className="py-2 pr-3">
                        <span className="font-medium">{item.productNameSnapshot}</span>
                        <span className="block text-xs text-ink-500">
                          {item.skuSnapshot}
                          {item.variantNameSnapshot ? ` · ${item.variantNameSnapshot}` : ""} ·{" "}
                          {item.fulfillmentType}
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-right">{formatQty(item.quantity)}</td>
                      <td className="py-2 pr-3 text-right">৳{formatMoney(item.unitPrice)}</td>
                      <td className="py-2 pr-3 text-right">৳{formatMoney(item.vatAmount)}</td>
                      <td className="py-2 pr-3 text-right font-medium">
                        ৳{formatMoney(item.lineTotal)}
                      </td>
                      <td className="py-2 text-right">{formatQty(item.refundedQty)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <dl className="mt-4 ml-auto max-w-xs space-y-1 text-sm">
              <div className="flex justify-between">
                <dt className="text-ink-500">Subtotal (excl. VAT)</dt>
                <dd>৳{formatMoney(order.subtotal)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-500">VAT</dt>
                <dd>৳{formatMoney(order.vatTotal)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-500">Discount</dt>
                <dd>−৳{formatMoney(order.discountTotal)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-500">Delivery</dt>
                <dd>৳{formatMoney(order.deliveryCharge)}</dd>
              </div>
              <div className="flex justify-between border-t border-slate-200 pt-1 text-base font-semibold">
                <dt>Total</dt>
                <dd>৳{formatMoney(order.grandTotal)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-500">Paid</dt>
                <dd>৳{formatMoney(order.paidAmount)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-500">Due</dt>
                <dd>৳{formatMoney(order.dueAmount)}</dd>
              </div>
            </dl>
          </section>

          <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <h2 className="text-sm font-semibold">Payments · পেমেন্ট</h2>
            {order.payments.length === 0 ? (
              <p className="mt-2 text-sm text-ink-500">No payment recorded.</p>
            ) : (
              <ul className="mt-3 divide-y divide-slate-100">
                {order.payments.map((payment) => (
                  <li key={payment.id} className="flex flex-wrap items-start justify-between gap-2 py-3">
                    <div>
                      <p className="text-sm font-medium">
                        {payment.paymentNumber} · {payment.method} · ৳
                        {formatMoney(payment.amount)}
                      </p>
                      <p className="text-xs text-ink-500">
                        {dateTime.format(payment.createdAt)}
                        {payment.notes ? ` · ${payment.notes}` : ""}
                        {payment.isOffline ? " · offline" : ""}
                        {payment.verificationMethod
                          ? ` · ${payment.verificationMethod.replaceAll("_", " ")}`
                          : ""}
                        {payment.verifiedBy ? ` by ${payment.verifiedBy.fullName}` : ""}
                      </p>
                    </div>
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${statusStyle(payment.status)}`}
                    >
                      {payment.status.replaceAll("_", " ")}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {order.payments.some((payment) => payment.status === "PENDING_VERIFICATION") ? (
              <p className="mt-2 text-xs text-amber-800">
                A digital payment is waiting for verification on the{" "}
                <Link href="/payments" className="underline">
                  payments page
                </Link>
                .
              </p>
            ) : null}
          </section>

          <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <h2 className="text-sm font-semibold">Refunds · ফেরত</h2>
            {order.refunds.length === 0 ? (
              <p className="mt-2 text-sm text-ink-500">No refund yet.</p>
            ) : (
              <ul className="mt-3 divide-y divide-slate-100">
                {order.refunds.map((refund) => (
                  <li key={refund.id} className="py-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium">
                          {refund.refundNumber} · ৳{formatMoney(refund.totalAmount)}
                        </p>
                        <p className="text-xs text-ink-500">
                          {refund.refundType} · {refund.reason} ·{" "}
                          {dateTime.format(refund.createdAt)}
                        </p>
                        <ul className="mt-1 text-xs text-ink-500">
                          {refund.items.map((item) => (
                            <li key={item.id}>
                              {item.orderItem.productNameSnapshot} · {formatQty(item.quantity)} ×
                              ৳{formatMoney(item.lineTotal)}
                              {item.restock ? " · restocked" : " · not restocked"}
                            </li>
                          ))}
                        </ul>
                      </div>
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${statusStyle(refund.status)}`}
                      >
                        {refund.status}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {hasRefundable ? (
              <details className="mt-4 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
                <summary className="cursor-pointer text-sm font-medium">Request a refund</summary>
                <div className="mt-3">
                  <RefundForm
                    orderId={order.id}
                    items={refundableItems}
                    payments={order.payments.map((payment) => ({
                      id: payment.id,
                      label: `${payment.paymentNumber} · ${payment.method} · ৳${formatMoney(payment.amount)} · ${payment.status}`,
                    }))}
                  />
                </div>
              </details>
            ) : null}
          </section>

          <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <h2 className="text-sm font-semibold">History · ইতিহাস</h2>
            <ol className="mt-3 space-y-2 text-sm">
              {order.statusHistory.map((entry) => (
                <li key={entry.id} className="flex flex-wrap gap-2 border-l-2 border-slate-200 pl-3">
                  <span className="text-xs text-ink-500">{dateTime.format(entry.createdAt)}</span>
                  <span>
                    {entry.field.replaceAll("_", " ")}: {entry.fromValue ?? "—"} →{" "}
                    <span className="font-medium">{entry.toValue}</span>
                  </span>
                  {entry.note ? <span className="text-xs text-ink-500">· {entry.note}</span> : null}
                  {entry.actor ? (
                    <span className="text-xs text-ink-500">· {entry.actor.fullName}</span>
                  ) : null}
                </li>
              ))}
            </ol>
          </section>
        </div>

        <aside className="space-y-4">
          <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <h2 className="text-sm font-semibold">Customer</h2>
            <p className="mt-2 text-sm font-medium">{order.customer.fullName}</p>
            <p className="text-xs text-ink-500">{order.customer.mobileNormalized}</p>
            <p className="text-xs text-ink-500">{order.customer.customerType}</p>
            <p className="mt-2 text-xs text-ink-500">
              Deliver to {order.recipientName} · {order.recipientMobile}
            </p>
            {order.customerNote ? (
              <p className="mt-2 text-xs text-ink-600">{order.customerNote}</p>
            ) : null}
            <p className="mt-2 text-xs text-ink-500">
              Cashier {order.cashier?.fullName ?? "—"} · warehouse{" "}
              {order.warehouse?.code ?? "—"}
            </p>
            {order.offlineCreatedAt ? (
              <p className="mt-2 text-xs text-amber-800">
                Created offline {dateTime.format(order.offlineCreatedAt)}
                {order.syncedAt ? ` · synced ${dateTime.format(order.syncedAt)}` : ""}
              </p>
            ) : null}
          </section>

          {order.shipments.length > 0 ? (
            <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
              <h2 className="text-sm font-semibold">Shipments · চালান</h2>
              <ul className="mt-2 divide-y divide-slate-100">
                {order.shipments.map((shipment) => (
                  <li key={shipment.id} className="py-2">
                    <Link
                      href={`/shipping/${shipment.id}`}
                      className="text-sm font-medium text-brand-700 hover:underline"
                    >
                      {shipment.shipmentNumber}
                    </Link>
                    <p className="text-xs text-ink-500">
                      {SHIPMENT_LABELS[shipment.status] ?? shipment.status} ·{" "}
                      {shipment.courier?.name ?? "Manual delivery"}
                      {shipment.trackingNumber ? ` · ${shipment.trackingNumber}` : ""}
                    </p>
                    <p className="text-xs text-ink-500">
                      {Number(shipment.codAmount) > 0
                        ? `COD ৳${formatMoney(shipment.codAmount)} · `
                        : ""}
                      {dateTime.format(shipment.deliveredAt ?? shipment.createdAt)}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {canWriteShipment &&
          order.status === "READY_TO_SHIP" &&
          !order.shipments.some(
            (shipment) => !["CANCELLED", "RETURNED", "FAILED"].includes(shipment.status),
          ) ? (
            <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
              <h2 className="text-sm font-semibold">Courier · কুরিয়ার</h2>
              <p className="mt-1 text-xs text-ink-500">
                This order is ready to ship but has no live consignment.
              </p>
              <Link
                href={`/shipping/new?orderId=${order.id}`}
                className="mt-3 inline-flex min-h-10 items-center rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700"
              >
                Book shipment
              </Link>
            </section>
          ) : null}

          {order.aiDraft && order.status === "DRAFT" && canWriteOrder && canWriteAi ? (
            <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-brand-200">
              <h2 className="text-sm font-semibold">Convert draft to sale</h2>
              <p className="mt-1 text-xs text-ink-500">
                The sale re-checks price, VAT, stock and delivery on the server.
              </p>
              <div className="mt-3">
                <DraftConversionForm draftOrderId={order.id} />
              </div>
            </section>
          ) : null}

          {canWriteOrder && !(order.aiDraft && order.status === "DRAFT") ? (
            <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
              <h2 className="text-sm font-semibold">Status</h2>
              <div className="mt-3">
                <OrderStatusForm orderId={order.id} allowed={allowed} />
              </div>
            </section>
          ) : null}

          {canCancel ? (
            <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
              <h2 className="text-sm font-semibold">Cancel</h2>
              <div className="mt-3">
                <CancelOrderForm orderId={order.id} />
              </div>
            </section>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
