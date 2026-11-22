import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  approvePurchaseReturnAction,
  cancelPurchaseReturnAction,
  completePurchaseReturnAction,
} from "@/app/actions/purchasing";
import { PurchaseNav } from "@/components/purchasing/purchasing-nav";
import { SUPPLIER_METHOD_LABELS } from "@/components/purchasing/payment-form";
import { hasPermission } from "@/lib/auth/permissions";
import { requirePagePermission } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { formatCost, formatMoney, formatQty } from "@/lib/inventory/format";

export const metadata: Metadata = {
  title: "Purchase return",
  robots: { index: false, follow: false },
};

const dateTime = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Dhaka",
});

const STATUS_STYLE: Record<string, string> = {
  DRAFT: "bg-slate-100 text-ink-700 ring-slate-200",
  APPROVED: "bg-amber-50 text-amber-800 ring-amber-200",
  COMPLETED: "bg-brand-50 text-brand-700 ring-brand-200",
  CANCELLED: "bg-slate-100 text-ink-500 ring-slate-200",
};

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Draft · stock still in",
  APPROVED: "Approved · stock out, no refund yet",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

type StoredLine = {
  goodsReceivedItemId: string;
  variantId: string;
  sku: string;
  description: string;
  quantity: string;
  unitCost: string;
};

function storedLines(value: unknown): StoredLine[] {
  if (!Array.isArray(value)) return [];
  return value as StoredLine[];
}

export default async function PurchaseReturnDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await requirePagePermission("purchase.read");
  const { id } = await params;
  const { error } = await searchParams;
  const canApprove = hasPermission(session, "purchase.approve");

  const record = await prisma.purchaseReturn.findUnique({
    where: { id },
    include: {
      supplier: { select: { id: true, code: true, name: true } },
      warehouse: { select: { id: true, code: true, name: true } },
      grn: { select: { id: true, grnNumber: true } },
      purchaseOrder: { select: { id: true, poNumber: true } },
      journalEntry: { select: { id: true, entryNumber: true } },
      createdBy: { select: { fullName: true } },
    },
  });

  if (!record) notFound();

  const lines = storedLines(record.lines);

  return (
    <div className="space-y-5">
      <header className="space-y-3">
        <Link
          href="/purchases/returns"
          className="text-sm font-medium text-brand-700 hover:underline"
        >
          ← Purchase returns
        </Link>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight">{record.returnNumber}</h1>
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${
                  STATUS_STYLE[record.status] ?? STATUS_STYLE.DRAFT
                }`}
              >
                {STATUS_LABEL[record.status] ?? record.status}
              </span>
            </div>
            <p className="mt-1 text-sm text-ink-500">
              <Link href={`/suppliers/${record.supplier.id}`} className="hover:underline">
                {record.supplier.code} · {record.supplier.name}
              </Link>{" "}
              → {record.warehouse.code} · {record.warehouse.name}
            </p>
            <p className="mt-1 text-xs text-ink-500">
              {record.grn ? (
                <>
                  Against{" "}
                  <Link href={`/purchases/grn/${record.grn.id}`} className="hover:underline">
                    {record.grn.grnNumber}
                  </Link>{" "}
                  ·{" "}
                </>
              ) : null}
              Order{" "}
              <Link href={`/purchases/${record.purchaseOrder.id}`} className="hover:underline">
                {record.purchaseOrder.poNumber}
              </Link>{" "}
              · raised {dateTime.format(record.createdAt)}
              {record.createdBy ? ` · ${record.createdBy.fullName}` : ""}
            </p>
          </div>

          {canApprove ? (
            <div className="flex flex-wrap gap-2">
              {record.status === "DRAFT" ? (
                <>
                  <form action={approvePurchaseReturnAction}>
                    <input type="hidden" name="id" value={record.id} />
                    <button
                      type="submit"
                      className="min-h-11 rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700"
                    >
                      Approve &amp; take stock out
                    </button>
                  </form>
                  <form action={cancelPurchaseReturnAction}>
                    <input type="hidden" name="id" value={record.id} />
                    <button
                      type="submit"
                      className="min-h-11 rounded-xl border border-slate-300 px-4 text-sm font-semibold text-ink-700 hover:border-red-300 hover:text-red-700"
                    >
                      Cancel draft
                    </button>
                  </form>
                </>
              ) : null}
              {record.status === "APPROVED" ? (
                <form action={completePurchaseReturnAction}>
                  <input type="hidden" name="id" value={record.id} />
                  <button
                    type="submit"
                    className="min-h-11 rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700"
                  >
                    {record.refundMethod ? "Complete & record refund" : "Complete return"}
                  </button>
                </form>
              ) : null}
            </div>
          ) : null}
        </div>

        <PurchaseNav />
      </header>

      {error ? (
        <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-red-200">
          {error}
        </p>
      ) : null}

      {record.status === "DRAFT" ? (
        <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm leading-relaxed text-amber-800 ring-1 ring-amber-200">
          Draft. Nothing has moved yet, and the value below is only an estimate at the
          goods-receipt cost. Approving removes the stock at the current average cost and reduces
          the supplier payable by the value the stock ledger actually releases.
        </p>
      ) : record.status === "APPROVED" ? (
        <p className="rounded-2xl bg-brand-50 px-4 py-3 text-sm leading-relaxed text-brand-800 ring-1 ring-brand-200">
          Approved. Stock has left the warehouse and the supplier&apos;s payable is reduced.{" "}
          {record.refundMethod
            ? "Completing the return records the refund the supplier sent."
            : "No refund was promised, so the supplier simply carries a credit until the next invoice."}
        </p>
      ) : record.status === "COMPLETED" ? (
        <p className="rounded-2xl bg-brand-50 px-4 py-3 text-sm leading-relaxed text-brand-800 ring-1 ring-brand-200">
          Completed
          {record.completedAt ? ` ${dateTime.format(record.completedAt)}` : ""}.
          {record.refundMethod
            ? " The supplier refund is posted to the ledger."
            : " No cash moved; the payable was reduced only."}
        </p>
      ) : (
        <p className="rounded-2xl bg-slate-100 px-4 py-3 text-sm leading-relaxed text-ink-700 ring-1 ring-slate-200">
          Cancelled. No stock moved and no journal was posted.
        </p>
      )}

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">
            {record.status === "DRAFT" ? "Estimated credit" : "Posted credit"}
          </p>
          <p className="mt-1 text-lg font-semibold">৳{formatMoney(record.totalValue)}</p>
          <p className="mt-1 text-xs text-ink-500">
            {record.status === "DRAFT" ? "At receipt cost" : "Stock-ledger value"}
          </p>
        </div>
        <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Units</p>
          <p className="mt-1 text-lg font-semibold">
            {formatQty(
              lines.reduce((sum, line) => sum + Number(line.quantity || 0), 0),
            )}
          </p>
          <p className="mt-1 text-xs text-ink-500">
            {lines.length} line{lines.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Refund</p>
          <p className="mt-1 text-sm font-semibold">
            {record.refundMethod
              ? (SUPPLIER_METHOD_LABELS[record.refundMethod] ?? record.refundMethod)
              : "Credit note only"}
          </p>
          <p className="mt-1 text-xs text-ink-500">
            {record.refundReference ?? "no reference"}
          </p>
        </div>
        <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Journal</p>
          <p className="mt-1 text-sm font-semibold">
            {record.journalEntry?.entryNumber ?? "not posted"}
          </p>
          <p className="mt-1 text-xs text-ink-500">DR payable / CR inventory</p>
        </div>
      </section>

      <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
        <h2 className="text-base font-semibold">Reason</h2>
        <p className="mt-2 whitespace-pre-line text-sm text-ink-700">{record.reason}</p>
      </section>

      <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
        <h2 className="text-base font-semibold">Lines going back</h2>
        {lines.length === 0 ? (
          <p className="mt-3 rounded-xl bg-slate-50 px-3 py-4 text-sm text-ink-500">
            This return has no stored lines.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100">
            {lines.map((line) => (
              <li key={line.goodsReceivedItemId} className="py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="min-w-0">
                    <Link
                      href={`/inventory/${line.variantId}`}
                      className="text-sm font-medium text-brand-700 hover:underline"
                    >
                      {line.description}
                    </Link>
                    <p className="mt-1 text-xs text-ink-500">{line.sku}</p>
                  </div>
                  <p className="text-sm font-semibold text-ink-900">
                    {formatQty(line.quantity)} units
                  </p>
                </div>
                <p className="mt-1 text-xs text-ink-500">
                  ৳{formatCost(line.unitCost)}/unit · ৳
                  {formatMoney(Number(line.quantity || 0) * Number(line.unitCost || 0))}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
