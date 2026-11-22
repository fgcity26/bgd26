import type { Metadata } from "next";
import Link from "next/link";
import { PurchaseNav } from "@/components/purchasing/purchasing-nav";
import { hasPermission } from "@/lib/auth/permissions";
import { requirePagePermission } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/inventory/format";

export const metadata: Metadata = {
  title: "Purchase returns",
  robots: { index: false, follow: false },
};

const dateLabel = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeZone: "Asia/Dhaka",
});

const STATUS_STYLE: Record<string, string> = {
  DRAFT: "bg-slate-100 text-ink-600 ring-slate-200",
  APPROVED: "bg-amber-50 text-amber-800 ring-amber-200",
  COMPLETED: "bg-brand-50 text-brand-700 ring-brand-200",
  CANCELLED: "bg-slate-100 text-ink-500 ring-slate-200",
};

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Draft",
  APPROVED: "Approved · stock out",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

export default async function PurchaseReturnsPage() {
  const session = await requirePagePermission("purchase.read");
  const canWrite = hasPermission(session, "purchase.write");

  const [returns, counts] = await Promise.all([
    prisma.purchaseReturn.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        returnNumber: true,
        status: true,
        reason: true,
        totalValue: true,
        createdAt: true,
        completedAt: true,
        supplier: { select: { name: true } },
        grn: { select: { grnNumber: true } },
        createdBy: { select: { fullName: true } },
      },
    }),
    prisma.purchaseReturn.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);

  const byStatus = new Map(counts.map((row) => [row.status, row._count._all]));

  return (
    <div className="space-y-5">
      <header className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">
              Purchase returns · সরবরাহকারীকে ফেরত
            </h1>
            <p className="mt-1 text-sm text-ink-600">
              Goods going back to a supplier. Approving a return removes the stock at average
              cost and reduces the supplier payable by the same value; completing it records a
              cash refund if the supplier paid one.
            </p>
          </div>
          {canWrite ? (
            <Link
              href="/purchases/returns/new"
              className="inline-flex min-h-11 items-center rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700"
            >
              New return
            </Link>
          ) : null}
        </div>
        <PurchaseNav />
      </header>

      <section className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Drafts</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{byStatus.get("DRAFT") ?? 0}</p>
        </div>
        <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">
            Approved, awaiting refund
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">
            {byStatus.get("APPROVED") ?? 0}
          </p>
        </div>
        <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Completed</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">
            {byStatus.get("COMPLETED") ?? 0}
          </p>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200">
        <h2 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold">
          Recent returns
        </h2>
        {returns.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-ink-500">
            No purchase return yet.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {returns.map((row) => (
              <li key={row.id} className="px-4 py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/purchases/returns/${row.id}`}
                        className="font-mono text-xs text-brand-700 hover:underline"
                      >
                        {row.returnNumber}
                      </Link>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${
                          STATUS_STYLE[row.status] ?? STATUS_STYLE.DRAFT
                        }`}
                      >
                        {STATUS_LABEL[row.status] ?? row.status}
                      </span>
                    </div>
                    <p className="mt-1 text-sm font-medium">{row.supplier.name}</p>
                    <p className="text-xs text-ink-500">
                      {row.reason}
                      {row.grn ? ` · against ${row.grn.grnNumber}` : ""} ·{" "}
                      {dateLabel.format(row.createdAt)}
                      {row.createdBy ? ` · ${row.createdBy.fullName}` : ""}
                    </p>
                  </div>
                  <p className="text-sm font-semibold tabular-nums">
                    ৳{formatMoney(row.totalValue)}
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
