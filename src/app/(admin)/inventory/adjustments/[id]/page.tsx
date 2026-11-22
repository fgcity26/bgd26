import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  postAdjustmentAction,
  voidAdjustmentAction,
} from "@/app/actions/inventory";
import { InventoryNav } from "@/components/inventory/inventory-nav";
import { hasPermission } from "@/lib/auth/permissions";
import { requirePagePermission } from "@/lib/auth/session";
import { canViewCostPrices } from "@/lib/catalog/dto";
import { prisma } from "@/lib/db";
import { formatCost, formatMoney, formatQty } from "@/lib/inventory/format";

export const metadata: Metadata = {
  title: "Adjustment",
  robots: { index: false, follow: false },
};

const dateTime = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Dhaka",
});

function statusStyle(status: string): string {
  if (status === "POSTED") return "bg-brand-50 text-brand-700 ring-brand-200";
  if (status === "VOID") return "bg-slate-100 text-ink-500 ring-slate-200";
  return "bg-amber-50 text-amber-800 ring-amber-200";
}

export default async function AdjustmentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await requirePagePermission("inventory.read");
  const { id } = await params;
  const { error } = await searchParams;
  const canApprove = hasPermission(session, "inventory.approve");
  const canViewCost = canViewCostPrices(session);

  const adjustment = await prisma.stockAdjustment.findUnique({
    where: { id },
    include: {
      warehouse: { select: { id: true, code: true, name: true, isActive: true } },
      variant: {
        select: {
          id: true,
          sku: true,
          name: true,
          product: { select: { id: true, name: true } },
        },
      },
      createdBy: { select: { fullName: true } },
      approvedBy: { select: { fullName: true } },
      journalEntry: { select: { id: true, entryNumber: true, status: true } },
    },
  });

  if (!adjustment) notFound();

  const ledger = await prisma.stockLedger.findMany({
    where: { referenceType: "stock_adjustment", referenceId: adjustment.id },
    orderBy: { createdAt: "asc" },
    include: {
      warehouse: { select: { code: true } },
      createdBy: { select: { fullName: true } },
    },
  });

  const opening = adjustment.adjustmentNumber.startsWith("OPEN-");
  const draft = adjustment.status === "DRAFT";

  return (
    <div className="space-y-5">
      <header className="space-y-3">
        <Link
          href="/inventory/adjustments"
          className="text-sm font-medium text-brand-700 hover:underline"
        >
          ← Adjustments
        </Link>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight">{adjustment.adjustmentNumber}</h1>
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${statusStyle(adjustment.status)}`}
              >
                {adjustment.status}
              </span>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-ink-700">
                {opening ? "Opening stock" : adjustment.adjustmentType.replaceAll("_", " ")}
              </span>
            </div>
            <p className="mt-1 text-sm text-ink-500">
              {adjustment.variant.product.name} · {adjustment.variant.name} ·{" "}
              {adjustment.variant.sku} · {adjustment.warehouse.code}
            </p>
            <p className="mt-1 text-xs text-ink-500">
              Created {dateTime.format(adjustment.createdAt)}
              {adjustment.createdBy ? ` by ${adjustment.createdBy.fullName}` : ""}
              {adjustment.postedAt
                ? ` · posted ${dateTime.format(adjustment.postedAt)}`
                : ""}
              {adjustment.approvedBy ? ` by ${adjustment.approvedBy.fullName}` : ""}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {draft && canApprove ? (
              <>
                <form action={postAdjustmentAction}>
                  <input type="hidden" name="id" value={adjustment.id} />
                  <button
                    type="submit"
                    className="min-h-11 rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700"
                  >
                    Post adjustment
                  </button>
                </form>
                <form action={voidAdjustmentAction}>
                  <input type="hidden" name="id" value={adjustment.id} />
                  <button
                    type="submit"
                    className="min-h-11 rounded-xl border border-slate-300 px-4 text-sm font-semibold text-ink-700 hover:border-red-300 hover:text-red-700"
                  >
                    Void draft
                  </button>
                </form>
              </>
            ) : null}
          </div>
        </div>

        <InventoryNav />
      </header>

      {error ? (
        <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-red-200">
          {error}
        </p>
      ) : null}

      {draft ? (
        <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm leading-relaxed text-amber-800 ring-1 ring-amber-200">
          This is a draft and has not changed stock.
          {canApprove
            ? " Posting applies the movement and appends the ledger row."
            : " A manager with inventory.approve must post it."}
        </p>
      ) : adjustment.status === "POSTED" ? (
        <p className="rounded-2xl bg-slate-100 px-4 py-3 text-sm leading-relaxed text-ink-700 ring-1 ring-slate-200">
          Posted. The ledger row is append-only; a correction is a new adjustment, never an edit.
        </p>
      ) : (
        <p className="rounded-2xl bg-slate-100 px-4 py-3 text-sm leading-relaxed text-ink-700 ring-1 ring-slate-200">
          This draft was voided and never changed stock.
        </p>
      )}

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Quantity</p>
          <p className="mt-1 text-lg font-semibold">{formatQty(adjustment.quantity)}</p>
          <p className="mt-1 text-xs text-ink-500">{adjustment.adjustmentType.replaceAll("_", " ")}</p>
        </div>
        <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Warehouse</p>
          <p className="mt-1 text-lg font-semibold">{adjustment.warehouse.code}</p>
          <p className="mt-1 text-xs text-ink-500">{adjustment.warehouse.name}</p>
        </div>
        {canViewCost ? (
          <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
            <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Unit cost</p>
            <p className="mt-1 text-lg font-semibold">
              {adjustment.unitCost ? `৳${formatCost(adjustment.unitCost)}` : "AVCO at posting"}
            </p>
            <p className="mt-1 text-xs text-ink-500">Increase entries set this cost</p>
          </div>
        ) : null}
        <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Document</p>
          <p className="mt-1 text-lg font-semibold">{opening ? "Opening" : "Adjustment"}</p>
          <p className="mt-1 text-xs text-ink-500">
            {adjustment.journalEntry
              ? `Journal ${adjustment.journalEntry.entryNumber} · ${adjustment.journalEntry.status}`
              : "No journal linked yet"}
          </p>
        </div>
      </section>

      <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
        <h2 className="text-base font-semibold">Reason</h2>
        <p className="mt-2 whitespace-pre-line text-sm text-ink-700">{adjustment.reason}</p>
        <p className="mt-3 text-xs text-ink-500">
          Variant{" "}
          <Link
            href={`/inventory/${adjustment.variant.id}`}
            className="font-medium text-brand-700 hover:underline"
          >
            {adjustment.variant.sku} · open stock detail
          </Link>
        </p>
      </section>

      <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold">Ledger rows from this document</h2>
          <p className="text-xs text-ink-500">{ledger.length} row(s) · append-only</p>
        </div>

        {ledger.length === 0 ? (
          <p className="mt-3 rounded-xl bg-slate-50 px-3 py-4 text-sm text-ink-500">
            No ledger rows yet. Posting writes them.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100">
            {ledger.map((entry) => (
              <li key={entry.id} className="py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm font-medium text-ink-900">
                    {entry.movementType} · {formatQty(entry.quantity)} units
                  </span>
                  <span className="text-xs text-ink-500">
                    {dateTime.format(entry.createdAt)}
                    {entry.createdBy ? ` · ${entry.createdBy.fullName}` : ""}
                  </span>
                </div>
                <p className="mt-1 text-xs text-ink-500">
                  {entry.warehouse.code} · balance after {formatQty(entry.balanceAfterQty)}
                  {canViewCost
                    ? ` · ৳${formatCost(entry.unitCost)}/unit · ৳${formatMoney(entry.totalValue)}`
                    : ""}
                </p>
                {entry.note ? (
                  <p className="mt-1 whitespace-pre-line text-xs text-ink-700">{entry.note}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
