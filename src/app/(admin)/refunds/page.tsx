import type { Metadata } from "next";
import Link from "next/link";
import { approveRefundAction, completeRefundAction } from "@/app/actions/orders";
import { Prisma } from "@/generated/prisma/client";
import { OrdersNav } from "@/components/orders/orders-nav";
import { hasPermission } from "@/lib/auth/permissions";
import { requirePagePermission } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { formatMoney, formatQty } from "@/lib/inventory/format";

export const metadata: Metadata = {
  title: "Refunds",
  robots: { index: false, follow: false },
};

const dateTime = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Dhaka",
});

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "REQUESTED", label: "Requested" },
  { value: "APPROVED", label: "Approved" },
  { value: "COMPLETED", label: "Completed" },
  { value: "REJECTED", label: "Rejected" },
  { value: "FAILED", label: "Failed" },
] as const;

function statusStyle(status: string): string {
  if (status === "COMPLETED") return "bg-brand-50 text-brand-700 ring-brand-200";
  if (status === "REQUESTED" || status === "APPROVED") {
    return "bg-amber-50 text-amber-800 ring-amber-200";
  }
  if (status === "REJECTED" || status === "FAILED") {
    return "bg-red-50 text-red-800 ring-red-200";
  }
  return "bg-slate-100 text-ink-700 ring-slate-200";
}

export default async function RefundsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; error?: string; ok?: string; highlight?: string }>;
}) {
  const session = await requirePagePermission("refund.read");
  const canApprove = hasPermission(session, "refund.approve");
  const params = await searchParams;
  const status = STATUS_OPTIONS.some((option) => option.value === params.status)
    ? (params.status ?? "")
    : "";

  const refunds = await prisma.refund.findMany({
    where: status ? { status: status as Prisma.EnumRefundStatusFilter } : {},
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      refundNumber: true,
      status: true,
      refundType: true,
      method: true,
      reason: true,
      totalAmount: true,
      createdAt: true,
      approvedAt: true,
      completedAt: true,
      order: { select: { id: true, orderNumber: true } },
      customer: { select: { fullName: true, mobileNormalized: true } },
      requestedBy: { select: { fullName: true } },
      approvedBy: { select: { fullName: true } },
      items: {
        select: {
          id: true,
          quantity: true,
          restock: true,
          lineTotal: true,
          orderItem: { select: { productNameSnapshot: true, skuSnapshot: true } },
        },
      },
    },
  });

  const pendingCount = refunds.filter((refund) => refund.status === "REQUESTED").length;

  return (
    <div className="space-y-5">
      <header className="space-y-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Refunds</h1>
          <p className="mt-1 text-sm text-ink-500">
            ফেরত তিন ধাপে: অনুরোধ → অনুমোদন (স্টক ফিরে আসে) → পরিশোধ সম্পন্ন।
          </p>
        </div>
        <OrdersNav />
      </header>

      {params.error ? (
        <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-200">
          {params.error}
        </p>
      ) : null}
      {params.ok ? (
        <p className="rounded-xl bg-brand-50 px-3 py-2 text-sm text-brand-800 ring-1 ring-brand-200">
          Refund updated.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <form method="get" className="flex items-center gap-2">
          <select
            name="status"
            defaultValue={status}
            className="min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm"
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="min-h-11 rounded-xl border border-slate-300 px-4 text-sm font-medium"
          >
            Filter
          </button>
        </form>
        <p className="text-sm text-ink-500">
          {pendingCount} waiting for approval
        </p>
      </div>

      <section className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
        {refunds.length === 0 ? (
          <p className="px-4 py-6 text-sm text-ink-500">No refund matches this filter.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {refunds.map((refund) => {
              const highlighted = params.highlight === refund.id;
              return (
                <li
                  key={refund.id}
                  className={`px-4 py-4 ${highlighted ? "bg-brand-50/60" : ""}`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold">
                        {refund.refundNumber} · ৳{formatMoney(refund.totalAmount)} ·{" "}
                        {refund.refundType}
                      </p>
                      <p className="text-xs text-ink-500">
                        <Link href={`/orders/${refund.order.id}`} className="text-brand-700">
                          {refund.order.orderNumber}
                        </Link>{" "}
                        · {refund.customer.fullName} · {refund.customer.mobileNormalized} ·{" "}
                        {dateTime.format(refund.createdAt)} · via {refund.method}
                      </p>
                      <p className="text-xs text-ink-500">{refund.reason}</p>
                      <ul className="mt-1 text-xs text-ink-500">
                        {refund.items.map((item) => (
                          <li key={item.id}>
                            {item.orderItem.productNameSnapshot} ({item.orderItem.skuSnapshot}) ·{" "}
                            {formatQty(item.quantity)} × ৳{formatMoney(item.lineTotal)}
                            {item.restock ? " · restock" : " · no restock"}
                          </li>
                        ))}
                      </ul>
                      <p className="mt-1 text-xs text-ink-500">
                        Requested by {refund.requestedBy?.fullName ?? "—"}
                        {refund.approvedBy ? ` · approved by ${refund.approvedBy.fullName}` : ""}
                        {refund.completedAt
                          ? ` · completed ${dateTime.format(refund.completedAt)}`
                          : ""}
                      </p>
                    </div>
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${statusStyle(refund.status)}`}
                    >
                      {refund.status}
                    </span>
                  </div>

                  {canApprove && refund.status === "REQUESTED" ? (
                    <form action={approveRefundAction} className="mt-3">
                      <input type="hidden" name="id" value={refund.id} />
                      <button
                        type="submit"
                        className="min-h-10 rounded-xl bg-brand-600 px-4 text-xs font-semibold text-white hover:bg-brand-700"
                      >
                        Approve &amp; restock
                      </button>
                    </form>
                  ) : null}

                  {canApprove && refund.status === "APPROVED" ? (
                    <form action={completeRefundAction} className="mt-3">
                      <input type="hidden" name="id" value={refund.id} />
                      <button
                        type="submit"
                        className="min-h-10 rounded-xl bg-brand-600 px-4 text-xs font-semibold text-white hover:bg-brand-700"
                      >
                        Complete payout
                      </button>
                    </form>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
