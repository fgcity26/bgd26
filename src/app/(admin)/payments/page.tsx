import type { Metadata } from "next";
import Link from "next/link";
import { OrdersNav } from "@/components/orders/orders-nav";
import {
  RejectPaymentForm,
  VerifyPaymentForm,
} from "@/components/payments/payment-actions";
import { hasPermission } from "@/lib/auth/permissions";
import { requirePagePermission } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/inventory/format";

export const metadata: Metadata = {
  title: "Payments",
  robots: { index: false, follow: false },
};

const dateTime = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Dhaka",
});

function statusStyle(status: string): string {
  if (status === "PAID") return "bg-brand-50 text-brand-700 ring-brand-200";
  if (status === "PENDING_VERIFICATION") return "bg-amber-50 text-amber-800 ring-amber-200";
  if (status === "FAILED") return "bg-red-50 text-red-800 ring-red-200";
  return "bg-slate-100 text-ink-700 ring-slate-200";
}

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  const session = await requirePagePermission("payment.read");
  const canApprove = hasPermission(session, "payment.approve");
  const { error, ok } = await searchParams;

  const [pending, recent] = await Promise.all([
    prisma.payment.findMany({
      where: { status: "PENDING_VERIFICATION" },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        paymentNumber: true,
        method: true,
        status: true,
        amount: true,
        notes: true,
        isOffline: true,
        createdAt: true,
        order: {
          select: {
            id: true,
            orderNumber: true,
            grandTotal: true,
            paymentStatus: true,
            customer: { select: { fullName: true, mobileNormalized: true } },
          },
        },
        createdBy: { select: { fullName: true } },
      },
    }),
    prisma.payment.findMany({
      orderBy: { createdAt: "desc" },
      take: 25,
      select: {
        id: true,
        paymentNumber: true,
        method: true,
        status: true,
        amount: true,
        isOffline: true,
        createdAt: true,
        verifiedAt: true,
        verifiedBy: { select: { fullName: true } },
        order: { select: { id: true, orderNumber: true } },
      },
    }),
  ]);

  return (
    <div className="space-y-5">
      <header className="space-y-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Payments</h1>
          <p className="mt-1 text-sm text-ink-500">
            ডিজিটাল পেমেন্ট ম্যানেজার যাচাই করার আগ পর্যন্ত অপেক্ষমাণ থাকে। নগদ পেমেন্ট
            কাউন্টারেই নিশ্চিত হয়।
          </p>
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
          Payment updated.
        </p>
      ) : null}

      <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Awaiting verification</h2>
          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-amber-200">
            {pending.length} pending
          </span>
        </div>

        {pending.length === 0 ? (
          <p className="mt-3 text-sm text-ink-500">Nothing is waiting. The queue is clear.</p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100">
            {pending.map((payment) => (
              <li key={payment.id} className="py-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold">
                      {payment.paymentNumber} · {payment.method} · ৳
                      {formatMoney(payment.amount)}
                    </p>
                    <p className="text-xs text-ink-500">
                      <Link href={`/orders/${payment.order.id}`} className="text-brand-700">
                        {payment.order.orderNumber}
                      </Link>{" "}
                      · {payment.order.customer.fullName} ·{" "}
                      {payment.order.customer.mobileNormalized} ·{" "}
                      {dateTime.format(payment.createdAt)}
                      {payment.isOffline ? " · offline" : ""}
                      {payment.createdBy ? ` · by ${payment.createdBy.fullName}` : ""}
                    </p>
                    {payment.notes ? (
                      <p className="text-xs text-ink-500">Reference: {payment.notes}</p>
                    ) : null}
                  </div>
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${statusStyle(payment.status)}`}
                  >
                    PENDING VERIFICATION
                  </span>
                </div>

                {canApprove ? (
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <div>
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500">
                        Verify
                      </h3>
                      <div className="mt-2">
                        <VerifyPaymentForm paymentId={payment.id} />
                      </div>
                    </div>
                    <div>
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500">
                        Reject
                      </h3>
                      <div className="mt-2">
                        <RejectPaymentForm paymentId={payment.id} />
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-ink-500">
                    A manager with <code>payment.approve</code> verifies this payment.
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
        <h2 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold">
          Recent payments
        </h2>
        {recent.length === 0 ? (
          <p className="px-4 py-6 text-sm text-ink-500">No payment recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-4 py-2">Payment</th>
                  <th className="px-4 py-2">Order</th>
                  <th className="px-4 py-2">Method</th>
                  <th className="px-4 py-2 text-right">Amount</th>
                  <th className="px-4 py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {recent.map((payment) => (
                  <tr key={payment.id}>
                    <td className="px-4 py-3">
                      <span className="font-medium">{payment.paymentNumber}</span>
                      <span className="block text-xs text-ink-500">
                        {dateTime.format(payment.createdAt)}
                        {payment.isOffline ? " · offline" : ""}
                        {payment.verifiedBy ? ` · ${payment.verifiedBy.fullName}` : ""}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <Link href={`/orders/${payment.order.id}`} className="text-brand-700">
                        {payment.order.orderNumber}
                      </Link>
                    </td>
                    <td className="px-4 py-3">{payment.method}</td>
                    <td className="px-4 py-3 text-right font-medium">
                      ৳{formatMoney(payment.amount)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${statusStyle(payment.status)}`}
                      >
                        {payment.status.replaceAll("_", " ")}
                      </span>
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
