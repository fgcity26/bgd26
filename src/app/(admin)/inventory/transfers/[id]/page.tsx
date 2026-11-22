import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  cancelTransferAction,
  receiveTransferAction,
  sendTransferAction,
} from "@/app/actions/inventory";
import { InventoryNav } from "@/components/inventory/inventory-nav";
import { hasPermission } from "@/lib/auth/permissions";
import { requirePagePermission } from "@/lib/auth/session";
import { canViewCostPrices } from "@/lib/catalog/dto";
import { prisma } from "@/lib/db";
import { formatCost, formatMoney, formatQty } from "@/lib/inventory/format";

export const metadata: Metadata = {
  title: "Transfer",
  robots: { index: false, follow: false },
};

const dateTime = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Dhaka",
});

function statusStyle(status: string): string {
  if (status === "RECEIVED") return "bg-brand-50 text-brand-700 ring-brand-200";
  if (status === "IN_TRANSIT") return "bg-amber-50 text-amber-800 ring-amber-200";
  if (status === "CANCELLED") return "bg-slate-100 text-ink-500 ring-slate-200";
  return "bg-slate-100 text-ink-700 ring-slate-200";
}

export default async function TransferDetailPage({
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

  const transfer = await prisma.stockTransfer.findUnique({
    where: { id },
    include: {
      fromWarehouse: { select: { id: true, code: true, name: true } },
      toWarehouse: { select: { id: true, code: true, name: true } },
      requestedBy: { select: { fullName: true } },
      approvedBy: { select: { fullName: true } },
      items: {
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

  if (!transfer) notFound();

  const ledger = await prisma.stockLedger.findMany({
    where: { referenceType: "stock_transfer", referenceId: transfer.id },
    orderBy: { createdAt: "asc" },
    include: {
      warehouse: { select: { code: true } },
      createdBy: { select: { fullName: true } },
    },
  });

  const units = transfer.items.reduce((sum, item) => sum + Number(item.quantity.toString()), 0);
  const value = transfer.items.reduce(
    (sum, item) => sum + Number(item.totalCost.toString()),
    0,
  );

  return (
    <div className="space-y-5">
      <header className="space-y-3">
        <Link
          href="/inventory/transfers"
          className="text-sm font-medium text-brand-700 hover:underline"
        >
          ← Transfers
        </Link>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight">{transfer.transferNumber}</h1>
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${statusStyle(transfer.status)}`}
              >
                {transfer.status.replaceAll("_", " ")}
              </span>
            </div>
            <p className="mt-1 text-sm text-ink-500">
              {transfer.fromWarehouse.code} · {transfer.fromWarehouse.name} →{" "}
              {transfer.toWarehouse.code} · {transfer.toWarehouse.name}
            </p>
            <p className="mt-1 text-xs text-ink-500">
              Created {dateTime.format(transfer.createdAt)}
              {transfer.requestedBy ? ` by ${transfer.requestedBy.fullName}` : ""}
              {transfer.shippedAt ? ` · sent ${dateTime.format(transfer.shippedAt)}` : ""}
              {transfer.receivedAt ? ` · received ${dateTime.format(transfer.receivedAt)}` : ""}
              {transfer.approvedBy ? ` · ${transfer.approvedBy.fullName}` : ""}
            </p>
          </div>

          {canApprove ? (
            <div className="flex flex-wrap gap-2">
              {transfer.status === "DRAFT" ? (
                <>
                  <form action={sendTransferAction}>
                    <input type="hidden" name="id" value={transfer.id} />
                    <button
                      type="submit"
                      className="min-h-11 rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700"
                    >
                      Send transfer
                    </button>
                  </form>
                  <form action={cancelTransferAction}>
                    <input type="hidden" name="id" value={transfer.id} />
                    <button
                      type="submit"
                      className="min-h-11 rounded-xl border border-slate-300 px-4 text-sm font-semibold text-ink-700 hover:border-red-300 hover:text-red-700"
                    >
                      Cancel draft
                    </button>
                  </form>
                </>
              ) : null}
              {transfer.status === "IN_TRANSIT" ? (
                <>
                  <form action={receiveTransferAction}>
                    <input type="hidden" name="id" value={transfer.id} />
                    <button
                      type="submit"
                      className="min-h-11 rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700"
                    >
                      Receive transfer
                    </button>
                  </form>
                  <form action={cancelTransferAction}>
                    <input type="hidden" name="id" value={transfer.id} />
                    <button
                      type="submit"
                      className="min-h-11 rounded-xl border border-red-300 px-4 text-sm font-semibold text-red-700 hover:bg-red-50"
                    >
                      Cancel and return
                    </button>
                  </form>
                </>
              ) : null}
            </div>
          ) : null}
        </div>

        <InventoryNav />
      </header>

      {error ? (
        <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-red-200">
          {error}
        </p>
      ) : null}

      {transfer.status === "DRAFT" ? (
        <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm leading-relaxed text-amber-800 ring-1 ring-amber-200">
          Draft. Stock has not moved yet. Sending posts the stock out of{" "}
          {transfer.fromWarehouse.code}.
        </p>
      ) : transfer.status === "IN_TRANSIT" ? (
        <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm leading-relaxed text-amber-800 ring-1 ring-amber-200">
          In transit. The stock left {transfer.fromWarehouse.code} and has not arrived at{" "}
          {transfer.toWarehouse.code}. Receiving posts it in; cancelling returns it to the source.
        </p>
      ) : transfer.status === "RECEIVED" ? (
        <p className="rounded-2xl bg-slate-100 px-4 py-3 text-sm leading-relaxed text-ink-700 ring-1 ring-slate-200">
          Received. Both ledger legs are posted and immutable.
        </p>
      ) : (
        <p className="rounded-2xl bg-slate-100 px-4 py-3 text-sm leading-relaxed text-ink-700 ring-1 ring-slate-200">
          Cancelled.{" "}
          {transfer.shippedAt
            ? "Stock that had left the source was returned by a compensating ledger movement."
            : "No stock moved."}
        </p>
      )}

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Lines</p>
          <p className="mt-1 text-lg font-semibold">{transfer.items.length}</p>
          <p className="mt-1 text-xs text-ink-500">{formatQty(units)} units</p>
        </div>
        <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">From</p>
          <p className="mt-1 text-lg font-semibold">{transfer.fromWarehouse.code}</p>
          <p className="mt-1 text-xs text-ink-500">{transfer.fromWarehouse.name}</p>
        </div>
        <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">To</p>
          <p className="mt-1 text-lg font-semibold">{transfer.toWarehouse.code}</p>
          <p className="mt-1 text-xs text-ink-500">{transfer.toWarehouse.name}</p>
        </div>
        {canViewCost ? (
          <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
            <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Value</p>
            <p className="mt-1 text-lg font-semibold">৳{formatMoney(value)}</p>
            <p className="mt-1 text-xs text-ink-500">At source AVCO</p>
          </div>
        ) : null}
      </section>

      <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
        <h2 className="text-base font-semibold">Lines</h2>
        <ul className="mt-3 divide-y divide-slate-100">
          {transfer.items.map((item) => (
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
                <div className="text-right text-sm">
                  <p className="font-semibold text-ink-900">{formatQty(item.quantity)} units</p>
                  <p className="text-xs text-ink-500">
                    received {formatQty(item.receivedQty)}
                    {canViewCost
                      ? ` · ৳${formatCost(item.sourceUnitCost)}/unit · ৳${formatMoney(item.totalCost)}`
                      : ""}
                  </p>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {transfer.notes ? (
        <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <h2 className="text-base font-semibold">Notes</h2>
          <p className="mt-2 whitespace-pre-line text-sm text-ink-700">{transfer.notes}</p>
        </section>
      ) : null}

      <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold">Ledger rows from this transfer</h2>
          <p className="text-xs text-ink-500">{ledger.length} row(s) · append-only</p>
        </div>

        {ledger.length === 0 ? (
          <p className="mt-3 rounded-xl bg-slate-50 px-3 py-4 text-sm text-ink-500">
            No ledger rows yet. Sending and receiving write them.
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
                  balance after {formatQty(entry.balanceAfterQty)}
                  {canViewCost
                    ? ` · ৳${formatCost(entry.unitCost)}/unit · ৳${formatMoney(entry.totalValue)}`
                    : ""}
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
