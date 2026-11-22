import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  addComponentAction,
  approveDesignAction,
  issueComponentsAction,
  removeComponentAction,
  sendForApprovalAction,
  transitionProductionAction,
} from "@/app/actions/production";
import { ChangesForm, RevisionForm } from "@/components/production/design-forms";
import { ProductionNav } from "@/components/production/production-nav";
import { hasPermission } from "@/lib/auth/permissions";
import { requirePagePermission } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { formatCost, formatMoney, formatQty } from "@/lib/inventory/format";
import {
  PRODUCTION_STATUS_LABELS,
  PRODUCTION_TRANSITIONS,
  productionWipValue,
} from "@/lib/production/service";

export const metadata: Metadata = {
  title: "Production job",
  robots: { index: false, follow: false },
};

const dateTime = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Dhaka",
});

const dateLabel = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeZone: "Asia/Dhaka",
});

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

const APPROVAL_STYLE: Record<string, string> = {
  PENDING: "bg-amber-50 text-amber-800 ring-amber-200",
  APPROVED: "bg-brand-50 text-brand-700 ring-brand-200",
  REJECTED: "bg-red-50 text-red-700 ring-red-200",
  CHANGES_REQUESTED: "bg-sky-50 text-sky-800 ring-sky-200",
  EXPIRED: "bg-slate-100 text-ink-500 ring-slate-200",
};

const inputClass =
  "mt-1 block w-full min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm text-ink-900 shadow-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100";

function transitionLabel(status: string): string {
  switch (status) {
    case "DESIGN_PREPARATION":
      return "Start design";
    case "AWAITING_CUSTOMER_APPROVAL":
      return "Send for approval";
    case "APPROVED":
      return "Approve design";
    case "PRODUCTION":
      return "Start production";
    case "QUALITY_CHECK":
      return "Send to quality check";
    case "READY_TO_SHIP":
      return "Mark ready to ship";
    case "COMPLETED":
      return "Complete job";
    case "CANCELLED":
      return "Cancel job";
    default:
      return status;
  }
}

export default async function ProductionJobPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await requirePagePermission("production.read");
  const { id } = await params;
  const { error } = await searchParams;
  const canWrite = hasPermission(session, "production.write");
  const canApprove = hasPermission(session, "production.approve");

  const job = await prisma.productionJob.findUnique({
    where: { id },
    include: {
      order: {
        select: {
          id: true,
          orderNumber: true,
          status: true,
          fulfillmentStatus: true,
          recipientName: true,
          recipientMobile: true,
        },
      },
      orderItem: {
        select: {
          id: true,
          variantId: true,
          productNameSnapshot: true,
          variantNameSnapshot: true,
          skuSnapshot: true,
          quantity: true,
          lineTotal: true,
          productionStatus: true,
          customizations: {
            select: {
              id: true,
              type: true,
              textContent: true,
              fontName: true,
              instructions: true,
              status: true,
            },
          },
        },
      },
      warehouse: { select: { id: true, code: true, name: true } },
      createdBy: { select: { fullName: true } },
      assignedTo: { select: { fullName: true } },
      items: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          quantityRequired: true,
          quantityIssued: true,
          quantityConsumed: true,
          unitCost: true,
          variant: {
            select: {
              id: true,
              sku: true,
              name: true,
              product: { select: { name: true } },
            },
          },
        },
      },
      designRevisions: {
        orderBy: { revisionNumber: "desc" },
        select: {
          id: true,
          revisionNumber: true,
          description: true,
          previewUrl: true,
          createdAt: true,
          createdBy: { select: { fullName: true } },
          approvals: {
            select: { id: true, status: true, approvedAt: true, notes: true },
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
      },
      statusHistory: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          fromStatus: true,
          toStatus: true,
          note: true,
          createdAt: true,
          changedBy: { select: { fullName: true } },
        },
      },
    },
  });
  if (!job) notFound();

  const [wip, journalEntries, balances] = await Promise.all([
    productionWipValue(job.id),
    prisma.journalEntry.findMany({
      where: { referenceType: "production_job", referenceId: job.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        entryNumber: true,
        entryDate: true,
        description: true,
        status: true,
        totalDebit: true,
        lines: {
          orderBy: { lineOrder: "asc" },
          select: {
            id: true,
            debit: true,
            credit: true,
            account: { select: { code: true, name: true } },
          },
        },
      },
    }),
    prisma.inventoryBalance.findMany({
      where: {
        warehouseId: job.warehouseId,
        availableQty: { gt: 0 },
        variant: { fulfillmentType: "STOCKED", status: "ACTIVE" },
      },
      orderBy: { variant: { sku: "asc" } },
      take: 100,
      select: {
        availableQty: true,
        variant: { select: { id: true, sku: true, name: true, product: { select: { name: true } } } },
      },
    }),
  ]);

  const componentOptions = balances.filter(
    (balance) => balance.variant.id !== job.orderItem.variantId,
  );

  const required = job.items.reduce(
    (sum, item) => sum + Number(item.quantityRequired.toString()),
    0,
  );
  const issued = job.items.reduce(
    (sum, item) => sum + Number(item.quantityIssued.toString()),
    0,
  );
  const hasOutstanding =
    job.items.some((item) => item.quantityRequired.greaterThan(item.quantityIssued));

  const transitions = PRODUCTION_TRANSITIONS[job.status];
  const isOpen = transitions.length > 0;
  const engraving = job.orderItem.customizations.find((row) => row.type === "ENGRAVING");

  return (
    <div className="space-y-5">
      <header className="space-y-3">
        <Link href="/production" className="text-sm font-medium text-brand-700 hover:underline">
          ← Production
        </Link>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-mono text-xl font-semibold tracking-tight">{job.jobNumber}</h1>
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${
                  STATUS_STYLE[job.status] ?? STATUS_STYLE.PENDING_DESIGN
                }`}
              >
                {PRODUCTION_STATUS_LABELS[job.status]}
              </span>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-ink-600 ring-1 ring-slate-200">
                {job.priority.toLowerCase()}
              </span>
            </div>
            <p className="mt-1 text-sm text-ink-600">
              {job.orderItem.productNameSnapshot}
              {job.orderItem.variantNameSnapshot ? ` · ${job.orderItem.variantNameSnapshot}` : ""}
            </p>
            <p className="mt-1 text-xs text-ink-500">
              Order{" "}
              <Link href={`/orders/${job.order.id}`} className="hover:underline">
                {job.order.orderNumber}
              </Link>{" "}
              · {job.order.recipientName} · {job.orderItem.skuSnapshot} ·{" "}
              {formatQty(job.orderItem.quantity)} unit(s) · stock from {job.warehouse.code}
            </p>
            <p className="mt-1 text-xs text-ink-500">
              Raised {dateTime.format(job.createdAt)}
              {job.createdBy ? ` by ${job.createdBy.fullName}` : ""}
              {job.dueAt ? ` · due ${dateLabel.format(job.dueAt)}` : ""}
              {job.assignedTo ? ` · ${job.assignedTo.fullName}` : ""}
            </p>
          </div>

          <div className="text-right">
            <p className="text-xs font-medium uppercase tracking-wide text-ink-500">
              Work in progress
            </p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">৳{formatMoney(wip)}</p>
            <p className="mt-1 text-xs text-ink-500">
              materials {formatQty(issued)} / {formatQty(required)}
            </p>
          </div>
        </div>

        <ProductionNav />
      </header>

      {error ? (
        <p
          role="alert"
          className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-red-200"
        >
          {error}
        </p>
      ) : null}

      <p className="rounded-2xl bg-slate-50 px-4 py-3 text-sm leading-relaxed text-ink-700 ring-1 ring-slate-200">
        Production and shipping are independent. This job tracks the engraving work only; the order
        keeps its own fulfilment status, and dispatch books the courier.
      </p>

      {canApprove && isOpen ? (
        <section className="space-y-4 rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-base font-semibold">Next step</h2>
            <p className="text-xs text-ink-500">উৎপাদনের পরবর্তী ধাপ</p>
          </div>

          <div className="flex flex-wrap gap-2">
            {transitions
              .filter((to) => to !== "CANCELLED")
              .map((to) => (
                <form key={to} action={transitionProductionAction}>
                  <input type="hidden" name="id" value={job.id} />
                  <input type="hidden" name="to" value={to} />
                  <button
                    type="submit"
                    className="min-h-11 rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700"
                  >
                    {transitionLabel(to)}
                  </button>
                </form>
              ))}

            {transitions.includes("CANCELLED") ? (
              <form action={transitionProductionAction}>
                <input type="hidden" name="id" value={job.id} />
                <input type="hidden" name="to" value="CANCELLED" />
                <button
                  type="submit"
                  className="min-h-11 rounded-xl border border-slate-300 px-4 text-sm font-semibold text-ink-700 hover:border-red-300 hover:text-red-700"
                >
                  Cancel job
                </button>
              </form>
            ) : null}
          </div>

          {job.status === "APPROVED" || job.status === "PRODUCTION" ? (
            <form action={issueComponentsAction} className="flex flex-wrap items-center gap-3">
              <input type="hidden" name="jobId" value={job.id} />
              <button
                type="submit"
                disabled={!hasOutstanding}
                className="min-h-11 rounded-xl border border-brand-300 px-4 text-sm font-semibold text-brand-700 hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {hasOutstanding ? "Issue outstanding components" : "Components all issued"}
              </button>
              <p className="text-xs text-ink-500">
                Takes stock at average cost into work in progress and posts DR 1130 / CR 1100.
              </p>
            </form>
          ) : null}

          {job.status === "APPROVED" && hasOutstanding ? (
            <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-200">
              Production cannot start until every component is issued.
            </p>
          ) : null}

          {job.status === "AWAITING_CUSTOMER_APPROVAL" ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <form action={approveDesignAction} className="space-y-3">
                <input type="hidden" name="jobId" value={job.id} />
                <label className="block text-sm font-medium text-ink-700">
                  <span>
                    Approval note{" "}
                    <span className="text-xs font-normal text-ink-500">অনুমোদন নোট</span>
                  </span>
                  <input name="note" maxLength={300} className={inputClass} />
                </label>
                <button
                  type="submit"
                  className="min-h-11 rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700"
                >
                  Approve design
                </button>
              </form>
              <div>
                <ChangesForm jobId={job.id} />
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {!canApprove && isOpen ? (
        <p className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-ink-600 ring-1 ring-slate-200">
          You can read this job but not move it. Approving a design, issuing materials and changing
          status need <span className="font-mono">production.approve</span>.
        </p>
      ) : null}

      {!isOpen ? (
        <p
          className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ring-1 ${
            job.status === "CANCELLED"
              ? "bg-red-50 text-red-800 ring-red-200"
              : "bg-brand-50 text-brand-800 ring-brand-200"
          }`}
        >
          {job.status === "CANCELLED"
            ? "Cancelled. Any issued components were returned to stock and work in progress was cleared."
            : `Completed${job.completedAt ? ` ${dateTime.format(job.completedAt)}` : ""}. The job value moved to cost of goods sold; the order continues to dispatch on its own status.`}
        </p>
      ) : null}

      <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
        <h2 className="text-base font-semibold">Engraving brief</h2>
        {engraving || job.designNotes ? (
          <dl className="mt-3 grid gap-3 sm:grid-cols-2">
            {engraving?.textContent ? (
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-ink-500">Text</dt>
                <dd className="mt-1 text-sm">{engraving.textContent}</dd>
              </div>
            ) : null}
            {engraving?.fontName ? (
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-ink-500">Font</dt>
                <dd className="mt-1 text-sm">{engraving.fontName}</dd>
              </div>
            ) : null}
            {engraving?.instructions ? (
              <div className="sm:col-span-2">
                <dt className="text-xs font-medium uppercase tracking-wide text-ink-500">
                  Instructions
                </dt>
                <dd className="mt-1 text-sm">{engraving.instructions}</dd>
              </div>
            ) : null}
            {job.designNotes ? (
              <div className="sm:col-span-2">
                <dt className="text-xs font-medium uppercase tracking-wide text-ink-500">
                  Design notes
                </dt>
                <dd className="mt-1 whitespace-pre-line text-sm text-ink-700">{job.designNotes}</dd>
              </div>
            ) : null}
          </dl>
        ) : (
          <p className="mt-3 rounded-xl bg-slate-50 px-3 py-4 text-sm text-ink-500">
            No engraving text or design notes were given. Add a revision below.
          </p>
        )}
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3 rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-base font-semibold">Design revisions</h2>
            <p className="text-xs text-ink-500">{job.designRevisions.length} revision(s)</p>
          </div>

          {job.designRevisions.length === 0 ? (
            <p className="rounded-xl bg-slate-50 px-3 py-4 text-sm text-ink-500">
              No revision yet. Add the first proof to move this job into design.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {job.designRevisions.map((revision) => {
                const approval = revision.approvals[0];
                return (
                  <li key={revision.id} className="py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold">Revision {revision.revisionNumber}</span>
                      {approval ? (
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${
                            APPROVAL_STYLE[approval.status] ?? APPROVAL_STYLE.PENDING
                          }`}
                        >
                          {approval.status.toLowerCase().replace(/_/g, " ")}
                        </span>
                      ) : null}
                    </div>
                    {revision.description ? (
                      <p className="mt-1 text-sm text-ink-700">{revision.description}</p>
                    ) : null}
                    {revision.previewUrl ? (
                      <p className="mt-1 truncate text-xs">
                        <a
                          href={revision.previewUrl}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="text-brand-700 hover:underline"
                        >
                          {revision.previewUrl}
                        </a>
                      </p>
                    ) : null}
                    <p className="mt-1 text-xs text-ink-500">
                      {dateTime.format(revision.createdAt)}
                      {revision.createdBy ? ` · ${revision.createdBy.fullName}` : ""}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}

          {canWrite &&
          ["PENDING_DESIGN", "DESIGN_PREPARATION", "AWAITING_CUSTOMER_APPROVAL"].includes(
            job.status,
          ) ? (
            <div className="border-t border-slate-100 pt-3">
              <RevisionForm jobId={job.id} />
            </div>
          ) : null}

          {canWrite && job.status === "DESIGN_PREPARATION" ? (
            <form action={sendForApprovalAction} className="border-t border-slate-100 pt-3">
              <input type="hidden" name="jobId" value={job.id} />
              <button
                type="submit"
                className="min-h-11 rounded-xl border border-brand-300 px-4 text-sm font-semibold text-brand-700 hover:bg-brand-50"
              >
                Send latest revision for approval
              </button>
            </form>
          ) : null}
        </div>

        <div className="space-y-3 rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-base font-semibold">Components</h2>
            <p className="text-xs text-ink-500">
              {formatQty(issued)} of {formatQty(required)} issued
            </p>
          </div>

          {job.items.length === 0 ? (
            <p className="rounded-xl bg-slate-50 px-3 py-4 text-sm text-ink-500">
              No components. This job has materials-only cost of zero, so completing it posts
              nothing to work in progress.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {job.items.map((item) => (
                <li key={item.id} className="py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        {item.variant.product.name} · {item.variant.name}
                      </p>
                      <p className="text-xs text-ink-500">{item.variant.sku}</p>
                    </div>
                    <p className="text-sm tabular-nums">
                      {formatQty(item.quantityIssued)} / {formatQty(item.quantityRequired)}
                    </p>
                  </div>
                  <p className="mt-1 text-xs text-ink-500">
                    {item.unitCost ? `৳${formatCost(item.unitCost)}/unit at issue` : "not issued yet"}
                  </p>
                  {canWrite && !item.quantityIssued.greaterThan(0) ? (
                    <form action={removeComponentAction} className="mt-2">
                      <input type="hidden" name="jobId" value={job.id} />
                      <input type="hidden" name="itemId" value={item.id} />
                      <button
                        type="submit"
                        className="text-xs font-semibold text-ink-500 hover:text-red-700"
                      >
                        Remove
                      </button>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          {canWrite &&
          !job.items.some((item) => item.quantityIssued.greaterThan(0)) &&
          ["PENDING_DESIGN", "DESIGN_PREPARATION", "AWAITING_CUSTOMER_APPROVAL", "APPROVED"].includes(
            job.status,
          ) ? (
            <form action={addComponentAction} className="space-y-3 border-t border-slate-100 pt-3">
              <input type="hidden" name="jobId" value={job.id} />
              <label className="block text-sm font-medium text-ink-700">
                <span>
                  Add a component{" "}
                  <span className="text-xs font-normal text-ink-500">উপকরণ যোগ করুন</span>
                </span>
                <select name="variantId" className={inputClass} required>
                  <option value="">Choose a stocked variant</option>
                  {componentOptions.map((balance) => (
                    <option key={balance.variant.id} value={balance.variant.id}>
                      {balance.variant.sku} · {balance.variant.product.name} ·{" "}
                      {formatQty(balance.availableQty)} available
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm font-medium text-ink-700">
                <span>Quantity</span>
                <input
                  name="quantity"
                  inputMode="decimal"
                  placeholder="0"
                  className={inputClass}
                  required
                />
              </label>
              <button
                type="submit"
                className="min-h-11 rounded-xl border border-slate-300 px-4 text-sm font-semibold text-ink-700 hover:border-brand-300 hover:text-brand-700"
              >
                Add component
              </button>
            </form>
          ) : null}
        </div>
      </section>

      <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold">Journal entries</h2>
          <p className="text-xs text-ink-500">DR 1130 work in progress / CR 1100 inventory</p>
        </div>
        {journalEntries.length === 0 ? (
          <p className="mt-3 rounded-xl bg-slate-50 px-3 py-4 text-sm text-ink-500">
            Nothing posted yet. Issuing components and completing or cancelling the job post here.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100">
            {journalEntries.map((entry) => (
              <li key={entry.id} className="py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <Link
                    href={`/accounting/journals/${entry.id}`}
                    className="font-mono text-xs text-brand-700 hover:underline"
                  >
                    {entry.entryNumber}
                  </Link>
                  <span className="text-xs text-ink-500">
                    {dateLabel.format(entry.entryDate)} · {entry.status.toLowerCase()}
                  </span>
                </div>
                <p className="mt-1 text-sm text-ink-700">{entry.description}</p>
                <ul className="mt-1 space-y-0.5">
                  {entry.lines.map((line) => (
                    <li key={line.id} className="flex justify-between gap-3 text-xs text-ink-500">
                      <span className="font-mono">
                        {line.account.code} {line.account.name}
                      </span>
                      <span className="tabular-nums">
                        {line.debit.greaterThan(0)
                          ? `DR ৳${formatMoney(line.debit)}`
                          : `CR ৳${formatMoney(line.credit)}`}
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
        <h2 className="text-base font-semibold">Status history</h2>
        <ol className="mt-3 space-y-3">
          {job.statusHistory.map((row) => (
            <li key={row.id} className="border-l-2 border-slate-200 pl-3">
              <p className="text-sm font-medium">
                {row.fromStatus
                  ? `${PRODUCTION_STATUS_LABELS[row.fromStatus]} → `
                  : ""}
                {PRODUCTION_STATUS_LABELS[row.toStatus]}
              </p>
              <p className="text-xs text-ink-500">
                {dateTime.format(row.createdAt)}
                {row.changedBy ? ` · ${row.changedBy.fullName}` : ""}
                {row.note ? ` · ${row.note}` : ""}
              </p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
