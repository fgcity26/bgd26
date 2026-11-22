import type { Metadata } from "next";
import Link from "next/link";
import { PurchaseNav } from "@/components/purchasing/purchasing-nav";
import { SUPPLIER_METHOD_LABELS } from "@/components/purchasing/payment-form";
import { hasPermission } from "@/lib/auth/permissions";
import { requirePagePermission } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { money } from "@/lib/inventory/decimal";
import { formatMoney } from "@/lib/inventory/format";
import { supplierPayables } from "@/lib/purchasing/settlement";
import { startOfDay } from "@/lib/accounting/report-dates";

export const metadata: Metadata = {
  title: "Supplier payments",
  robots: { index: false, follow: false },
};

const dateLabel = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeZone: "Asia/Dhaka",
});

function monthStart(): Date {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return startOfDay(`${today.slice(0, 7)}-01`);
}

export default async function SupplierPaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string }>;
}) {
  const session = await requirePagePermission("purchase.read");
  const { ok } = await searchParams;
  const canApprove = hasPermission(session, "purchase.approve");

  const [payments, payables, paidThisMonth] = await Promise.all([
    prisma.purchasePayment.findMany({
      orderBy: { paidAt: "desc" },
      take: 50,
      select: {
        id: true,
        paymentNumber: true,
        amount: true,
        method: true,
        reference: true,
        paidAt: true,
        supplier: { select: { id: true, name: true, code: true } },
        recordedBy: { select: { fullName: true } },
      },
    }),
    supplierPayables(),
    prisma.purchasePayment.aggregate({
      where: { paidAt: { gte: monthStart() } },
      _sum: { amount: true },
    }),
  ]);

  const outstanding = [...payables.values()].reduce(
    (sum, row) => sum.add(row.outstanding),
    money(0),
  );

  return (
    <div className="space-y-5">
      <header className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">
              Supplier payments · সরবরাহকারী পরিশোধ
            </h1>
            <p className="mt-1 text-sm text-ink-600">
              Money paid against received goods. Each payment debits accounts payable and
              credits the account it left from, so the payables balance is always the ledger.
            </p>
          </div>
          {canApprove ? (
            <Link
              href="/purchases/payments/new"
              className="inline-flex min-h-11 items-center rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700"
            >
              Record payment
            </Link>
          ) : null}
        </div>
        <PurchaseNav />
      </header>

      {ok ? (
        <p className="rounded-2xl bg-brand-50 px-4 py-3 text-sm text-brand-800 ring-1 ring-brand-200">
          Payment {ok} recorded and posted to the ledger.
        </p>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">
            Paid this month
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">
            ৳{formatMoney(paidThisMonth._sum.amount ?? 0)}
          </p>
        </div>
        <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">
            Still owed
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">
            ৳{formatMoney(outstanding)}
          </p>
        </div>
        <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">
            Suppliers with a balance
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{payables.size}</p>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200">
        <h2 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold">
          Recent payments
        </h2>
        {payments.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-ink-500">
            No supplier payment recorded yet.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {payments.map((payment) => (
              <li key={payment.id} className="px-4 py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-mono text-xs text-ink-500">{payment.paymentNumber}</p>
                    <Link
                      href={`/suppliers/${payment.supplier.id}`}
                      className="text-sm font-medium text-brand-700 hover:underline"
                    >
                      {payment.supplier.name}
                    </Link>
                    <p className="text-xs text-ink-500">
                      {SUPPLIER_METHOD_LABELS[payment.method] ?? payment.method}
                      {payment.reference ? ` · ${payment.reference}` : ""} ·{" "}
                      {dateLabel.format(payment.paidAt)}
                      {payment.recordedBy ? ` · ${payment.recordedBy.fullName}` : ""}
                    </p>
                  </div>
                  <p className="text-sm font-semibold tabular-nums">
                    ৳{formatMoney(payment.amount)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
