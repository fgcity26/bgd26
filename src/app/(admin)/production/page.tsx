import type { Metadata } from "next";
import Link from "next/link";
import { ProductionNav } from "@/components/production/production-nav";
import { hasPermission } from "@/lib/auth/permissions";
import { requirePagePermission } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { formatQty } from "@/lib/inventory/format";
import {
  PRODUCTION_STATUS_LABELS,
  PRODUCTION_TRANSITIONS,
} from "@/lib/production/service";
import type { ProductionStatus } from "@/generated/prisma/client";

export const metadata: Metadata = {
  title: "Production",
  robots: { index: false, follow: false },
};

const dateLabel = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeZone: "Asia/Dhaka",
});

const FILTERS: Record<string, ProductionStatus[]> = {
  design: ["PENDING_DESIGN", "DESIGN_PREPARATION", "AWAITING_CUSTOMER_APPROVAL"],
  production: ["APPROVED", "PRODUCTION", "QUALITY_CHECK"],
  ready: ["READY_TO_SHIP"],
  done: ["COMPLETED"],
};

const STATUS_STYLE: Record<string, string> = {
  PENDING_DESIGN: "bg-slate-100 text-ink-600 ring-slate-200",
  DESIGN_PREPARATION: "bg-sky-50 text-sky-800 ring-sky-200",
  AWAITING_CUSTOMER_APPROVAL: "bg-amber-50 text-amber-800 ring-amber-200",
  APPROVED: "bg-brand-50 text-brand-700 ring-brand-200",
  PRODUCTION: "bg-brand-50 text-brand-700 ring-brand-200",
  QUALITY_CHECK: "bg-violet-50 text-violet-800 ring-violet-200",
  READY_TO_SHIP: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  COMPLETED: "bg-slate-100 text-ink-500 ring-slate-200",
  CANCELLED: "bg-red-50 text-red-700 ring-red-200",
};

const PRIORITY_STYLE: Record<string, string> = {
  LOW: "bg-slate-100 text-ink-500 ring-slate-200",
  NORMAL: "bg-slate-100 text-ink-600 ring-slate-200",
  HIGH: "bg-amber-50 text-amber-800 ring-amber-200",
  URGENT: "bg-red-50 text-red-700 ring-red-200",
};

export default async function ProductionPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const session = await requirePagePermission("production.read");
  const canWrite = hasPermission(session, "production.write");
  const { status } = await searchParams;
  const filter = status && FILTERS[status] ? FILTERS[status] : undefined;

  const [jobs, counts] = await Promise.all([
    prisma.productionJob.findMany({
      where: filter ? { status: { in: filter } } : {},
      orderBy: [{ priority: "desc" }, { dueAt: "asc" }, { createdAt: "desc" }],
      take: 60,
      select: {
        id: true,
        jobNumber: true,
        status: true,
        priority: true,
        dueAt: true,
        createdAt: true,
        completedAt: true,
        order: { select: { id: true, orderNumber: true } },
        orderItem: {
          select: {
            productNameSnapshot: true,
            variantNameSnapshot: true,
            skuSnapshot: true,
            quantity: true,
          },
        },
        items: { select: { quantityRequired: true, quantityIssued: true } },
      },
    }),
    prisma.productionJob.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);

  const byStatus = new Map(counts.map((row) => [row.status, row._count._all]));
  const open = counts
    .filter((row) => !["COMPLETED", "CANCELLED"].includes(row.status))
    .reduce((sum, row) => sum + row._count._all, 0);

  return (
    <div className="space-y-5">
      <header className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">
              Production · উৎপাদন
            </h1>
            <p className="mt-1 text-sm text-ink-600">
              Engraving and made-to-order work, from design approval to materials issued and
              handed over. Shipping keeps its own status, so production never blocks dispatch.
            </p>
          </div>
          {canWrite ? (
            <Link
              href="/production/new"
              className="inline-flex min-h-11 items-center rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700"
            >
              New job
            </Link>
          ) : null}
        </div>
        <ProductionNav />
      </header>

      <section className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Open jobs</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{open}</p>
        </div>
        <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">
            Waiting on design
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">
            {(byStatus.get("PENDING_DESIGN") ?? 0) +
              (byStatus.get("DESIGN_PREPARATION") ?? 0) +
              (byStatus.get("AWAITING_CUSTOMER_APPROVAL") ?? 0)}
          </p>
        </div>
        <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Ready to ship</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">
            {byStatus.get("READY_TO_SHIP") ?? 0}
          </p>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-semibold">
            {status && FILTERS[status] ? PRODUCTION_STATUS_LABELS[FILTERS[status][0]] : "All jobs"}
          </h2>
          <p className="text-xs text-ink-500">{jobs.length} shown</p>
        </div>

        {jobs.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-ink-500">
            No production job in this view.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {jobs.map((job) => {
              const required = job.items.reduce(
                (sum, item) => sum + Number(item.quantityRequired.toString()),
                0,
              );
              const issued = job.items.reduce(
                (sum, item) => sum + Number(item.quantityIssued.toString()),
                0,
              );
              return (
                <li key={job.id} className="px-4 py-3">
                  <Link href={`/production/${job.id}`} className="block hover:bg-slate-50">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs text-brand-700">{job.jobNumber}</span>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${
                              STATUS_STYLE[job.status] ?? STATUS_STYLE.PENDING_DESIGN
                            }`}
                          >
                            {PRODUCTION_STATUS_LABELS[job.status]}
                          </span>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${
                              PRIORITY_STYLE[job.priority] ?? PRIORITY_STYLE.NORMAL
                            }`}
                          >
                            {job.priority.toLowerCase()}
                          </span>
                        </div>
                        <p className="mt-1 text-sm font-medium">
                          {job.orderItem.productNameSnapshot}
                          {job.orderItem.variantNameSnapshot
                            ? ` · ${job.orderItem.variantNameSnapshot}`
                            : ""}
                        </p>
                        <p className="text-xs text-ink-500">
                          {job.order.orderNumber} · {job.orderItem.skuSnapshot} ·{" "}
                          {formatQty(job.orderItem.quantity)} unit(s)
                          {job.dueAt ? ` · due ${dateLabel.format(job.dueAt)}` : ""}
                        </p>
                      </div>
                      <div className="text-right text-xs text-ink-500">
                        {required > 0 ? (
                          <p>
                            materials {formatQty(issued)} / {formatQty(required)}
                          </p>
                        ) : (
                          <p>no components</p>
                        )}
                        <p>{PRODUCTION_TRANSITIONS[job.status].length > 0 ? "open" : "closed"}</p>
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
