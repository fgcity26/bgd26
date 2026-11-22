import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cancelGrnAction, postGrnAction } from "@/app/actions/purchasing";
import { PurchaseNav } from "@/components/purchasing/purchasing-nav";
import { hasPermission } from "@/lib/auth/permissions";
import { requirePagePermission } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { formatCost, formatMoney, formatQty } from "@/lib/inventory/format";

export const metadata: Metadata = {
  title: "Goods receipt",
  robots: { index: false, follow: false },
};

const dateTime = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Dhaka",
});

const dateOnly = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeZone: "Asia/Dhaka",
});

function statusStyle(status: string): string {
  if (status === "POSTED") return "bg-brand-50 text-brand-700 ring-brand-200";
  if (status === "CANCELLED") return "bg-slate-100 text-ink-500 ring-slate-200";
  return "bg-slate-100 text-ink-700 ring-slate-200";
}

function conditionStyle(condition: string): string {
  if (condition === "GOOD") return "bg-brand-50 text-brand-700 ring-brand-200";
  if (condition === "DAMAGED") return "bg-red-50 text-red-700 ring-red-200";
  return "bg-amber-50 text-amber-800 ring-amber-200";
}

export default async function GoodsReceiptDetailPage({
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

  const grn = await prisma.goodsReceivedNote.findUnique({
    where: { id },
    include: {
      supplier: { select: { id: true, code: true, name: true } },
      warehouse: { select: { id: true, code: true, name: true } },
      purchaseOrder: { select: { id: true, poNumber: true, status: true } },
      receivedBy: { select: { fullName: true } },
      items: {
        orderBy: { id: "asc" },
        include: {
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
    },
  });

  if (!grn) notFound();

  const ledger = await prisma.stockLedger.findMany({
    where: { referenceType: "goods_received_note", referenceId: grn.id },
    orderBy: { createdAt: "asc" },
    include: {
      warehouse: { select: { code: true } },
      createdBy: { select: { fullName: true } },
    },
  });

  const units = grn.items.reduce(
    (sum, item) => sum + Number(item.quantityReceived.toString()),
    0,
  );

  return (
    <div className="space-y-5">
      <header className="space-y-3">
        <Link href="/purchases/grn" className="text-sm font-medium text-brand-700 hover:underline">
          ← Goods received
        </Link>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight">{grn.grnNumber}</h1>
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${statusStyle(grn.status)}`}
              >
                {grn.status.toLowerCase()}
              </span>
            </div>
            <p className="mt-1 text-sm text-ink-500">
              <Link href={`/suppliers/${grn.supplier.id}`} className="hover:underline">
                {grn.supplier.code} · {grn.supplier.name}
              </Link>{" "}
              → {grn.warehouse.code} · {grn.warehouse.name}
            </p>
            <p className="mt-1 text-xs text-ink-500">
              Order{" "}
              <Link href={`/purchases/${grn.purchaseOrder.id}`} className="hover:underline">
                {grn.purchaseOrder.poNumber}
              </Link>{" "}
              · received {dateTime.format(grn.receivedAt)}
              {grn.postedAt ? ` · posted ${dateTime.format(grn.postedAt)}` : ""}
              {grn.receivedBy ? ` · ${grn.receivedBy.fullName}` : ""}
            </p>
          </div>

          {canApprove ? (
            <div className="flex flex-wrap gap-2">
              {grn.status === "DRAFT" ? (
                <>
                  <form action={postGrnAction}>
                    <input type="hidden" name="id" value={grn.id} />
                    <button
                      type="submit"
                      className="min-h-11 rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700"
                    >
                      Post receipt
                    </button>
                  </form>
                  <form action={cancelGrnAction}>
                    <input type="hidden" name="id" value={grn.id} />
                    <button
                      type="submit"
                      className="min-h-11 rounded-xl border border-slate-300 px-4 text-sm font-semibold text-ink-700 hover:border-red-300 hover:text-red-700"
                    >
                      Cancel draft
                    </button>
                  </form>
                </>
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

      {grn.status === "DRAFT" ? (
        <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm leading-relaxed text-amber-800 ring-1 ring-amber-200">
          Draft. Stock has not moved yet. Posting locks the receipt, appends stock ledger rows and
          updates the purchase order. A posted receipt can only be corrected with a purchase return.
        </p>
      ) : grn.status === "POSTED" ? (
        <p className="rounded-2xl bg-brand-50 px-4 py-3 text-sm leading-relaxed text-brand-800 ring-1 ring-brand-200">
          Posted. Stock and moving-average cost are updated. This receipt is immutable.
        </p>
      ) : (
        <p className="rounded-2xl bg-slate-100 px-4 py-3 text-sm leading-relaxed text-ink-700 ring-1 ring-slate-200">
          Cancelled. No stock moved.
        </p>
      )}

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Units</p>
          <p className="mt-1 text-lg font-semibold">{formatQty(units)}</p>
          <p className="mt-1 text-xs text-ink-500">
            {grn.items.length} line{grn.items.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Receipt value</p>
          <p className="mt-1 text-lg font-semibold">৳{formatMoney(grn.totalValue)}</p>
          <p className="mt-1 text-xs text-ink-500">Landed cost entering AVCO</p>
        </div>
        <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Warehouse</p>
          <p className="mt-1 text-lg font-semibold">{grn.warehouse.code}</p>
          <p className="mt-1 text-xs text-ink-500">{grn.warehouse.name}</p>
        </div>
        <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Order status</p>
          <p className="mt-1 text-lg font-semibold">
            {grn.purchaseOrder.status.replaceAll("_", " ").toLowerCase()}
          </p>
          <p className="mt-1 text-xs text-ink-500">{grn.purchaseOrder.poNumber}</p>
        </div>
      </section>

      <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
        <h2 className="text-base font-semibold">Received lines</h2>
        <ul className="mt-3 divide-y divide-slate-100">
          {grn.items.map((item) => (
            <li key={item.id} className="py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="min-w-0">
                  <Link
                    href={`/inventory/${item.variant.id}`}
                    className="text-sm font-medium text-brand-700 hover:underline"
                  >
                    {item.variant.product.name} · {item.variant.name}
                  </Link>
                  <p className="mt-1 text-xs text-ink-500">{item.variant.sku}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-right text-sm">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${conditionStyle(item.condition)}`}
                  >
                    {item.condition.toLowerCase()}
                  </span>
                  <span className="font-semibold text-ink-900">
                    {formatQty(item.quantityReceived)} units
                  </span>
                </div>
              </div>
              <p className="mt-1 text-xs text-ink-500">
                ৳{formatCost(item.unitCost)}/unit · ৳{formatMoney(item.totalCost)}
                {item.batchNumber ? ` · batch ${item.batchNumber}` : ""}
                {item.expiryDate ? ` · expires ${dateOnly.format(item.expiryDate)}` : ""}
              </p>
            </li>
          ))}
        </ul>
      </section>

      {grn.notes ? (
        <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <h2 className="text-base font-semibold">Notes</h2>
          <p className="mt-2 whitespace-pre-line text-sm text-ink-700">{grn.notes}</p>
        </section>
      ) : null}

      <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold">Stock ledger rows from this receipt</h2>
          <p className="text-xs text-ink-500">{ledger.length} row(s) · append-only</p>
        </div>

        {ledger.length === 0 ? (
          <p className="mt-3 rounded-xl bg-slate-50 px-3 py-4 text-sm text-ink-500">
            No ledger rows yet. Posting the receipt writes them.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100">
            {ledger.map((entry) => (
              <li key={entry.id} className="py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm font-medium text-ink-900">
                    {entry.movementType} · {formatQty(entry.quantity)} units · {entry.warehouse.code}
                  </span>
                  <span className="text-xs text-ink-500">
                    {dateTime.format(entry.createdAt)}
                    {entry.createdBy ? ` · ${entry.createdBy.fullName}` : ""}
                  </span>
                </div>
                <p className="mt-1 text-xs text-ink-500">
                  balance after {formatQty(entry.balanceAfterQty)} · ৳{formatCost(entry.unitCost)}/unit · ৳{formatMoney(entry.totalValue)}
                </p>
                {entry.note ? (
                  <p className="mt-1 whitespace-pre-wrap text-xs text-ink-700">{entry.note}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
