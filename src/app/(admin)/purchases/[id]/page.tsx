import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  cancelPurchaseOrderAction,
  closePurchaseOrderAction,
  sendPurchaseOrderAction,
} from "@/app/actions/purchasing";
import { PurchaseNav } from "@/components/purchasing/purchasing-nav";
import { PurchaseOrderForm } from "@/components/purchasing/purchase-order-form";
import { hasPermission } from "@/lib/auth/permissions";
import { requirePagePermission } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { formatCost, formatMoney, formatQty } from "@/lib/inventory/format";

export const metadata: Metadata = {
  title: "Purchase order",
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

const isoDate = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: "Asia/Dhaka",
});

function statusStyle(status: string): string {
  if (status === "RECEIVED" || status === "PARTIALLY_RECEIVED") {
    return "bg-brand-50 text-brand-700 ring-brand-200";
  }
  if (status === "SENT") return "bg-amber-50 text-amber-800 ring-amber-200";
  if (status === "CANCELLED" || status === "CLOSED") {
    return "bg-slate-100 text-ink-500 ring-slate-200";
  }
  return "bg-slate-100 text-ink-700 ring-slate-200";
}

function grnStatusStyle(status: string): string {
  if (status === "POSTED") return "bg-brand-50 text-brand-700 ring-brand-200";
  if (status === "CANCELLED") return "bg-slate-100 text-ink-500 ring-slate-200";
  return "bg-slate-100 text-ink-700 ring-slate-200";
}

export default async function PurchaseOrderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await requirePagePermission("purchase.read");
  const { id } = await params;
  const { error } = await searchParams;
  const canWrite = hasPermission(session, "purchase.write");
  const canApprove = hasPermission(session, "purchase.approve");

  const order = await prisma.purchaseOrder.findUnique({
    where: { id },
    include: {
      supplier: { select: { id: true, code: true, name: true, status: true } },
      warehouse: { select: { id: true, code: true, name: true } },
      approvedBy: { select: { fullName: true } },
      items: {
        orderBy: { createdAt: "asc" },
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
      grns: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          grnNumber: true,
          status: true,
          totalValue: true,
          receivedAt: true,
          postedAt: true,
          warehouse: { select: { code: true } },
        },
      },
    },
  });

  if (!order) notFound();
  // Dropship orders are driven by their own screen and never received into stock.
  if (order.poType === "DROPSHIP") redirect(`/purchases/dropship/${order.id}`);

  const editable = order.status === "DRAFT" && canWrite;
  const receivable =
    canWrite && ["SENT", "PARTIALLY_RECEIVED"].includes(order.status) && order.warehouse;

  const [suppliers, warehouses, variants] = editable
    ? await Promise.all([
        prisma.supplier.findMany({
          where: { OR: [{ status: "ACTIVE" }, { id: order.supplierId }] },
          orderBy: { name: "asc" },
          select: { id: true, code: true, name: true },
        }),
        prisma.warehouse.findMany({
          where: { isActive: true },
          orderBy: [{ isDefault: "desc" }, { code: "asc" }],
          select: { id: true, code: true, name: true },
        }),
        prisma.productVariant.findMany({
          where: { fulfillmentType: "STOCKED" },
          orderBy: [{ product: { name: "asc" } }, { name: "asc" }],
          take: 500,
          select: {
            id: true,
            sku: true,
            name: true,
            product: { select: { name: true } },
          },
        }),
      ])
    : [[], [], []];

  const unitsOrdered = order.items.reduce(
    (sum, item) => sum + Number(item.quantity.toString()),
    0,
  );
  const unitsReceived = order.items.reduce(
    (sum, item) => sum + Number(item.receivedQty.toString()),
    0,
  );

  return (
    <div className="space-y-5">
      <header className="space-y-3">
        <Link href="/purchases" className="text-sm font-medium text-brand-700 hover:underline">
          ← Purchase orders
        </Link>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight">{order.poNumber}</h1>
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${statusStyle(order.status)}`}
              >
                {order.status.replaceAll("_", " ")}
              </span>
            </div>
            <p className="mt-1 text-sm text-ink-500">
              <Link href={`/suppliers/${order.supplier.id}`} className="hover:underline">
                {order.supplier.code} · {order.supplier.name}
              </Link>
              {order.warehouse ? ` → ${order.warehouse.code} · ${order.warehouse.name}` : ""}
            </p>
            <p className="mt-1 text-xs text-ink-500">
              Created {dateTime.format(order.createdAt)}
              {order.sentAt ? ` · sent ${dateTime.format(order.sentAt)}` : ""}
              {order.expectedAt ? ` · expected ${dateOnly.format(order.expectedAt)}` : ""}
              {order.approvedBy ? ` · ${order.approvedBy.fullName}` : ""}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {receivable ? (
              <Link
                href={`/purchases/${order.id}/receive`}
                className="inline-flex min-h-11 items-center rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700"
              >
                Receive goods · মাল গ্রহণ
              </Link>
            ) : null}
            {canApprove && order.status === "DRAFT" ? (
              <>
                <form action={sendPurchaseOrderAction}>
                  <input type="hidden" name="id" value={order.id} />
                  <button
                    type="submit"
                    className="min-h-11 rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700"
                  >
                    Send order
                  </button>
                </form>
                <form action={cancelPurchaseOrderAction}>
                  <input type="hidden" name="id" value={order.id} />
                  <button
                    type="submit"
                    className="min-h-11 rounded-xl border border-slate-300 px-4 text-sm font-semibold text-ink-700 hover:border-red-300 hover:text-red-700"
                  >
                    Cancel draft
                  </button>
                </form>
              </>
            ) : null}
            {canApprove && order.status === "SENT" ? (
              <form action={cancelPurchaseOrderAction}>
                <input type="hidden" name="id" value={order.id} />
                <button
                  type="submit"
                  className="min-h-11 rounded-xl border border-slate-300 px-4 text-sm font-semibold text-ink-700 hover:border-red-300 hover:text-red-700"
                >
                  Cancel order
                </button>
              </form>
            ) : null}
            {canApprove &&
            ["SENT", "PARTIALLY_RECEIVED", "RECEIVED"].includes(order.status) ? (
              <form action={closePurchaseOrderAction}>
                <input type="hidden" name="id" value={order.id} />
                <button
                  type="submit"
                  className="min-h-11 rounded-xl border border-slate-300 px-4 text-sm font-semibold text-ink-700 hover:border-brand-300 hover:text-brand-700"
                >
                  Close order
                </button>
              </form>
            ) : null}
          </div>
        </div>

        <PurchaseNav />
      </header>

      {error ? (
        <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-red-200">
          {error}
        </p>
      ) : null}

      {order.status === "DRAFT" ? (
        <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm leading-relaxed text-amber-800 ring-1 ring-amber-200">
          Draft. Nothing has been committed. Send the order when it is agreed with the supplier;
          stock only changes when a goods receipt is posted.
        </p>
      ) : order.status === "SENT" ? (
        <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm leading-relaxed text-amber-800 ring-1 ring-amber-200">
          Sent. Waiting for delivery. Receiving the goods creates a draft goods receipt, which a
          manager then posts to move stock.
        </p>
      ) : order.status === "PARTIALLY_RECEIVED" ? (
        <p className="rounded-2xl bg-brand-50 px-4 py-3 text-sm leading-relaxed text-brand-800 ring-1 ring-brand-200">
          Partially received. Some lines are still outstanding; receive again when the rest arrives.
        </p>
      ) : order.status === "RECEIVED" ? (
        <p className="rounded-2xl bg-slate-100 px-4 py-3 text-sm leading-relaxed text-ink-700 ring-1 ring-slate-200">
          Fully received. The posted goods receipts are immutable.
        </p>
      ) : order.status === "CLOSED" ? (
        <p className="rounded-2xl bg-slate-100 px-4 py-3 text-sm leading-relaxed text-ink-700 ring-1 ring-slate-200">
          Closed. No further receipts are expected. Outstanding quantities were abandoned, not
          received.
        </p>
      ) : (
        <p className="rounded-2xl bg-slate-100 px-4 py-3 text-sm leading-relaxed text-ink-700 ring-1 ring-slate-200">
          Cancelled. No stock moved.
        </p>
      )}

      {order.supplier.status !== "ACTIVE" ? (
        <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm leading-relaxed text-amber-800 ring-1 ring-amber-200">
          This supplier is {order.supplier.status.toLowerCase()}. Reactivate it before sending a new
          order.
        </p>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Ordered</p>
          <p className="mt-1 text-lg font-semibold">{formatQty(unitsOrdered)}</p>
          <p className="mt-1 text-xs text-ink-500">
            {order.items.length} line{order.items.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Received</p>
          <p className="mt-1 text-lg font-semibold">{formatQty(unitsReceived)}</p>
          <p className="mt-1 text-xs text-ink-500">
            {formatQty(unitsOrdered - unitsReceived)} outstanding
          </p>
        </div>
        <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Grand total</p>
          <p className="mt-1 text-lg font-semibold">৳{formatMoney(order.grandTotal)}</p>
          <p className="mt-1 text-xs text-ink-500">
            Subtotal ৳{formatMoney(order.subtotal)} · tax ৳{formatMoney(order.taxTotal)}
          </p>
        </div>
        <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Receipts</p>
          <p className="mt-1 text-lg font-semibold">{order.grns.length}</p>
          <p className="mt-1 text-xs text-ink-500">
            {order.grns.filter((grn) => grn.status === "POSTED").length} posted
          </p>
        </div>
      </section>

      <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
        <h2 className="text-base font-semibold">Lines</h2>
        <ul className="mt-3 divide-y divide-slate-100">
          {order.items.map((item) => {
            const outstanding = Number(item.quantity.sub(item.receivedQty).toString());
            return (
              <li key={item.id} className="py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="min-w-0">
                    {item.variant ? (
                      <Link
                        href={`/inventory/${item.variant.id}`}
                        className="text-sm font-medium text-brand-700 hover:underline"
                      >
                        {item.variant.product.name} · {item.variant.name}
                      </Link>
                    ) : (
                      <p className="text-sm font-medium text-ink-900">{item.description}</p>
                    )}
                    <p className="mt-1 text-xs text-ink-500">
                      {item.variant?.sku ?? item.description}
                    </p>
                  </div>
                  <div className="text-right text-sm">
                    <p className="font-semibold text-ink-900">
                      {formatQty(item.quantity)} ordered · {formatQty(item.receivedQty)} received
                    </p>
                    <p className="text-xs text-ink-500">
                      {outstanding > 0 ? `${formatQty(outstanding)} outstanding · ` : ""}৳
                      {formatCost(item.unitCost)}/unit · ৳{formatMoney(item.lineTotal)}
                    </p>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
        <dl className="mt-4 space-y-1 border-t border-slate-200 pt-3 text-sm">
          <div className="flex justify-between">
            <dt className="text-ink-500">Subtotal</dt>
            <dd className="font-medium">৳{formatMoney(order.subtotal)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-ink-500">Tax</dt>
            <dd className="font-medium">৳{formatMoney(order.taxTotal)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-ink-500">Discount</dt>
            <dd className="font-medium">−৳{formatMoney(order.discountTotal)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-ink-500">Shipping</dt>
            <dd className="font-medium">৳{formatMoney(order.shippingTotal)}</dd>
          </div>
          <div className="flex justify-between border-t border-slate-200 pt-1 text-base font-semibold">
            <dt>Grand total</dt>
            <dd>৳{formatMoney(order.grandTotal)}</dd>
          </div>
        </dl>
      </section>

      <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold">Goods receipts</h2>
          <Link href="/purchases/grn" className="text-xs font-medium text-brand-700 hover:underline">
            All receipts
          </Link>
        </div>
        {order.grns.length === 0 ? (
          <p className="mt-3 rounded-xl bg-slate-50 px-3 py-4 text-sm text-ink-500">
            Nothing received yet.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100">
            {order.grns.map((grn) => (
              <li key={grn.id} className="py-3">
                <Link
                  href={`/purchases/grn/${grn.id}`}
                  className="flex flex-wrap items-baseline justify-between gap-2"
                >
                  <span className="text-sm font-medium text-brand-700 hover:underline">
                    {grn.grnNumber}
                  </span>
                  <span className="flex items-center gap-2 text-xs text-ink-500">
                    <span
                      className={`rounded-full px-2 py-0.5 font-medium ring-1 ${grnStatusStyle(grn.status)}`}
                    >
                      {grn.status.toLowerCase()}
                    </span>
                    {grn.warehouse.code} · ৳{formatMoney(grn.totalValue)}
                  </span>
                </Link>
                <p className="mt-1 text-xs text-ink-500">
                  Received {dateTime.format(grn.receivedAt)}
                  {grn.postedAt ? ` · posted ${dateTime.format(grn.postedAt)}` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {order.notes ? (
        <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <h2 className="text-base font-semibold">Notes</h2>
          <p className="mt-2 whitespace-pre-line text-sm text-ink-700">{order.notes}</p>
        </section>
      ) : null}

      {editable ? (
        <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <h2 className="text-base font-semibold">Edit draft order</h2>
          <p className="mt-1 text-xs text-ink-500">
            Only a draft can be edited. Saving replaces the lines.
          </p>
          <div className="mt-4">
            <PurchaseOrderForm
              suppliers={suppliers}
              warehouses={warehouses}
              variants={variants.map((variant) => ({
                id: variant.id,
                sku: variant.sku,
                label: `${variant.product.name} · ${variant.name}`,
              }))}
              order={{
                id: order.id,
                poNumber: order.poNumber,
                supplierId: order.supplierId,
                warehouseId: order.warehouseId,
                expectedAt: order.expectedAt ? isoDate.format(order.expectedAt) : "",
                discountTotal: order.discountTotal.toString(),
                shippingTotal: order.shippingTotal.toString(),
                notes: order.notes,
                lines: order.items
                  .filter((item) => item.variantId)
                  .map((item) => ({
                    variantId: item.variantId as string,
                    quantity: item.quantity.toString(),
                    unitCost: item.unitCost.toString(),
                    taxAmount: item.taxAmount.toString(),
                  })),
              }}
            />
          </div>
        </section>
      ) : null}
    </div>
  );
}
