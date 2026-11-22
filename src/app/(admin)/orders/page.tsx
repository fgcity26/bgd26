import type { Metadata } from "next";
import Link from "next/link";
import { Prisma } from "@/generated/prisma/client";
import { OrdersNav } from "@/components/orders/orders-nav";
import { requirePagePermission } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/inventory/format";

export const metadata: Metadata = {
  title: "Orders",
  robots: { index: false, follow: false },
};

const PAGE_SIZE = 25;

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "DRAFT", label: "Draft" },
  { value: "PENDING_PAYMENT", label: "Pending payment" },
  { value: "CONFIRMED", label: "Confirmed" },
  { value: "PROCESSING", label: "Processing" },
  { value: "READY_TO_SHIP", label: "Ready to ship" },
  { value: "SHIPPED", label: "Shipped" },
  { value: "DELIVERED", label: "Delivered" },
  { value: "COMPLETED", label: "Completed" },
  { value: "ON_HOLD", label: "On hold" },
  { value: "CANCELLED", label: "Cancelled" },
  { value: "RETURNED", label: "Returned" },
  { value: "REFUNDED", label: "Refunded" },
] as const;

const PAYMENT_OPTIONS = [
  { value: "", label: "All payments" },
  { value: "UNPAID", label: "Unpaid" },
  { value: "PARTIALLY_PAID", label: "Partially paid" },
  { value: "PENDING_VERIFICATION", label: "Pending verification" },
  { value: "PAID", label: "Paid" },
  { value: "PARTIALLY_REFUNDED", label: "Partially refunded" },
  { value: "REFUNDED", label: "Refunded" },
] as const;

const dateTime = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Dhaka",
});

function orderStatusStyle(status: string): string {
  if (status === "COMPLETED" || status === "DELIVERED") {
    return "bg-brand-50 text-brand-700 ring-brand-200";
  }
  if (status === "CANCELLED" || status === "REFUNDED" || status === "RETURNED") {
    return "bg-slate-100 text-ink-500 ring-slate-200";
  }
  if (status === "ON_HOLD") return "bg-amber-50 text-amber-800 ring-amber-200";
  return "bg-slate-100 text-ink-700 ring-slate-200";
}

function paymentStatusStyle(status: string): string {
  if (status === "PAID") return "bg-brand-50 text-brand-700 ring-brand-200";
  if (status === "PENDING_VERIFICATION") return "bg-amber-50 text-amber-800 ring-amber-200";
  if (status === "UNPAID") return "bg-red-50 text-red-800 ring-red-200";
  return "bg-slate-100 text-ink-700 ring-slate-200";
}

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; payment?: string; page?: string }>;
}) {
  await requirePagePermission("order.read");

  const params = await searchParams;
  const query = params.q?.trim() ?? "";
  const status = STATUS_OPTIONS.some((option) => option.value === params.status)
    ? (params.status ?? "")
    : "";
  const payment = PAYMENT_OPTIONS.some((option) => option.value === params.payment)
    ? (params.payment ?? "")
    : "";
  const page = Math.max(1, Number(params.page) || 1);

  const where: Prisma.OrderWhereInput = {
    ...(status ? { status: status as Prisma.EnumOrderStatusFilter } : {}),
    ...(payment ? { paymentStatus: payment as Prisma.EnumPaymentStatusFilter } : {}),
    ...(query
      ? {
          OR: [
            { orderNumber: { contains: query, mode: "insensitive" } },
            { recipientName: { contains: query, mode: "insensitive" } },
            { recipientMobile: { contains: query } },
            { customer: { fullName: { contains: query, mode: "insensitive" } } },
            { customer: { mobileNormalized: { contains: query } } },
          ],
        }
      : {}),
  };

  const [total, orders] = await Promise.all([
    prisma.order.count({ where }),
    prisma.order.findMany({
      where,
      orderBy: { placedAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        orderNumber: true,
        channel: true,
        source: true,
        status: true,
        paymentStatus: true,
        grandTotal: true,
        paidAmount: true,
        dueAmount: true,
        placedAt: true,
        isWalkInCash: true,
        recipientName: true,
        recipientMobile: true,
        customer: { select: { fullName: true, mobileNormalized: true } },
        _count: { select: { items: true } },
      },
    }),
  ]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const linkFor = (nextPage: number) => {
    const search = new URLSearchParams();
    if (query) search.set("q", query);
    if (status) search.set("status", status);
    if (payment) search.set("payment", payment);
    if (nextPage > 1) search.set("page", String(nextPage));
    const suffix = search.toString();
    return suffix ? `/orders?${suffix}` : "/orders";
  };

  return (
    <div className="space-y-5">
      <header className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Orders</h1>
            <p className="mt-1 text-sm text-ink-500">
              সব বিক্রয় — কাউন্টার ও অনলাইন। স্টক বিক্রয়ের সময়ই খাতা থেকে বের হয়।
            </p>
          </div>
          <Link
            href="/pos"
            className="inline-flex min-h-11 items-center rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700"
          >
            Open till · কাউন্টার
          </Link>
        </div>
        <OrdersNav />
      </header>

      <form method="get" className="grid gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:grid-cols-[minmax(0,1fr)_11rem_12rem_auto]">
        <label className="block text-sm font-medium text-ink-700">
          <span className="sr-only">Search orders</span>
          <input
            name="q"
            defaultValue={query}
            placeholder="Order number, customer, mobile…"
            className="block w-full min-h-11 rounded-xl border border-slate-300 px-3 text-sm"
          />
        </label>
        <label className="block text-sm font-medium text-ink-700">
          <span className="sr-only">Status</span>
          <select
            name="status"
            defaultValue={status}
            className="block w-full min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm"
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-medium text-ink-700">
          <span className="sr-only">Payment</span>
          <select
            name="payment"
            defaultValue={payment}
            className="block w-full min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm"
          >
            {PAYMENT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="min-h-11 rounded-xl border border-slate-300 px-4 text-sm font-medium"
        >
          Filter
        </button>
      </form>

      <section className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <p className="text-sm text-ink-500">
            {total} order{total === 1 ? "" : "s"}
          </p>
          <p className="text-xs text-ink-500">
            Page {page} of {pages}
          </p>
        </div>

        {orders.length === 0 ? (
          <p className="px-4 py-6 text-sm text-ink-500">No order matches this filter.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-4 py-2">Order</th>
                  <th className="px-4 py-2">Customer</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">Payment</th>
                  <th className="px-4 py-2 text-right">Total</th>
                  <th className="px-4 py-2 text-right">Due</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {orders.map((order) => (
                  <tr key={order.id} className="align-top">
                    <td className="px-4 py-3">
                      <Link href={`/orders/${order.id}`} className="font-medium text-brand-700">
                        {order.orderNumber}
                      </Link>
                      <span className="block text-xs text-ink-500">
                        {dateTime.format(order.placedAt)} · {order.source.replaceAll("_", " ")}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="block font-medium">{order.customer.fullName}</span>
                      <span className="block text-xs text-ink-500">
                        {order.customer.mobileNormalized}
                        {order.isWalkInCash ? " · walk-in" : ""}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${orderStatusStyle(order.status)}`}
                      >
                        {order.status.replaceAll("_", " ")}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${paymentStatusStyle(order.paymentStatus)}`}
                      >
                        {order.paymentStatus.replaceAll("_", " ")}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-medium">
                      ৳{formatMoney(order.grandTotal)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      ৳{formatMoney(order.dueAmount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {pages > 1 ? (
          <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-sm">
            {page > 1 ? (
              <Link href={linkFor(page - 1)} className="text-brand-700">
                ← Previous
              </Link>
            ) : (
              <span />
            )}
            {page < pages ? (
              <Link href={linkFor(page + 1)} className="text-brand-700">
                Next →
              </Link>
            ) : (
              <span />
            )}
          </div>
        ) : null}
      </section>
    </div>
  );
}
