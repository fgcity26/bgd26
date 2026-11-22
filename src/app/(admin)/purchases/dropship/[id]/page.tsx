import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  cancelDropshipOrderAction,
  confirmDropshipOrderAction,
  deliverDropshipOrderAction,
  sendDropshipOrderAction,
  shipDropshipOrderAction,
} from "@/app/actions/dropship";
import { PurchaseNav } from "@/components/purchasing/purchasing-nav";
import { hasPermission } from "@/lib/auth/permissions";
import { requirePagePermission } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { DROPSHIP_STATUS_LABELS } from "@/lib/dropship/service";
import { formatCost, formatMoney, formatQty } from "@/lib/inventory/format";
import { supplierPayable } from "@/lib/purchasing/settlement";

export const metadata: Metadata = {
  title: "Dropship order",
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
  if (status === "DELIVERED") return "bg-brand-50 text-brand-700 ring-brand-200";
  if (status === "SHIPPED") return "bg-emerald-50 text-emerald-800 ring-emerald-200";
  if (status === "CONFIRMED") return "bg-sky-50 text-sky-800 ring-sky-200";
  if (status === "SENT") return "bg-amber-50 text-amber-800 ring-amber-200";
  if (status === "CANCELLED") return "bg-red-50 text-red-700 ring-red-200";
  return "bg-slate-100 text-ink-700 ring-slate-200";
}

const inputClass =
  "mt-1 block w-full min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm text-ink-900 shadow-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100";

export default async function DropshipOrderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await requirePagePermission("purchase.read");
  const canApprove = hasPermission(session, "purchase.approve");
  const { id } = await params;
  const { error } = await searchParams;

  const po = await prisma.purchaseOrder.findUnique({
    where: { id },
    include: {
      supplier: {
        select: {
          id: true,
          code: true,
          name: true,
          mobileNormalized: true,
          email: true,
          isDropshipVendor: true,
        },
      },
      order: {
        select: {
          id: true,
          orderNumber: true,
          status: true,
          paymentStatus: true,
          fulfillmentStatus: true,
          recipientName: true,
          recipientMobile: true,
          shippingAddress: true,
          dueAmount: true,
          customerNote: true,
        },
      },
      items: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          description: true,
          quantity: true,
          unitCost: true,
          lineTotal: true,
          variant: { select: { sku: true, name: true } },
          orderItem: { select: { id: true, skuSnapshot: true } },
        },
      },
    },
  });

  if (!po || po.poType !== "DROPSHIP") notFound();

  const [couriers, journals, payable, shipment] = await Promise.all([
    prisma.courier.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, provider: true },
    }),
    prisma.journalEntry.findMany({
      where: { referenceType: "purchase_order", referenceId: po.id },
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
    supplierPayable(po.supplierId),
    po.order
      ? prisma.shipment.findFirst({
          where: {
            orderId: po.order.id,
            supplierId: po.supplierId,
            shipmentType: "DROPSHIP_DIRECT",
          },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            shipmentNumber: true,
            status: true,
            trackingNumber: true,
            shippedAt: true,
            deliveredAt: true,
            courier: { select: { name: true } },
            trackingEvents: {
              orderBy: { eventAt: "desc" },
              select: { id: true, status: true, message: true, eventAt: true },
            },
          },
        })
      : Promise.resolve(null),
  ]);

  const due = formatMoney(po.order?.dueAmount ?? 0);
  const prepaid = Number(po.order?.dueAmount ?? 0) <= 0;
  const address =
    po.order?.shippingAddress && typeof po.order.shippingAddress === "object"
      ? (po.order.shippingAddress as Record<string, unknown>)
      : null;
  const addressText = address
    ? [address.line1, address.area, address.district, address.division]
        .filter((part) => typeof part === "string" && part.trim())
        .join(", ")
    : "";

  return (
    <div className="space-y-5">
      <header className="space-y-3">
        <Link
          href="/purchases/dropship"
          className="text-sm font-medium text-brand-700 hover:underline"
        >
          ← Dropship orders
        </Link>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-mono text-xl font-semibold tracking-tight">{po.poNumber}</h1>
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${statusStyle(po.status)}`}
              >
                {DROPSHIP_STATUS_LABELS[po.status] ?? po.status}
              </span>
              {po.supplier.isDropshipVendor ? (
                <span className="rounded-full bg-violet-50 px-2.5 py-1 text-xs font-medium text-violet-800 ring-1 ring-violet-200">
                  dropship vendor
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-sm text-ink-600">
              {po.supplier.code} · {po.supplier.name}
            </p>
            <p className="mt-1 text-xs text-ink-500">
              {po.order ? (
                <>
                  Sale{" "}
                  <Link href={`/orders/${po.order.id}`} className="hover:underline">
                    {po.order.orderNumber}
                  </Link>{" "}
                  · {po.order.recipientName} · {po.order.recipientMobile}
                </>
              ) : (
                "No linked sale"
              )}
            </p>
            <p className="mt-1 text-xs text-ink-500">
              Raised {dateTime.format(po.createdAt)}
              {po.sentAt ? ` · sent ${dateOnly.format(po.sentAt)}` : ""}
              {po.confirmedAt ? ` · confirmed ${dateOnly.format(po.confirmedAt)}` : ""}
              {po.shippedAt ? ` · shipped ${dateOnly.format(po.shippedAt)}` : ""}
              {po.deliveredAt ? ` · delivered ${dateOnly.format(po.deliveredAt)}` : ""}
            </p>
          </div>

          <div className="text-right">
            <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Supplier cost</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">৳{formatMoney(po.grandTotal)}</p>
            <p className="mt-1 text-xs text-ink-500">
              payable ৳{formatMoney(payable.outstanding)}
            </p>
          </div>
        </div>

        <PurchaseNav />
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
        The supplier ships straight to the customer; nothing enters a warehouse. The cost is
        recognised when the supplier ships, and the payable is settled on the supplier&apos;s
        statement.
      </p>

      {!prepaid && ["DRAFT", "SENT", "CONFIRMED"].includes(po.status) ? (
        <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-200">
          ৳{due} is still due on this sale. Dropship is prepaid only — collect the balance before
          the supplier ships.
        </p>
      ) : null}

      {po.status === "CANCELLED" ? (
        <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-red-200">
          Cancelled{po.cancelReason ? `: ${po.cancelReason}` : "."} Nothing was posted to cost of
          goods sold.
        </p>
      ) : null}

      {canApprove ? (
        <section className="space-y-4 rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-base font-semibold">Next step</h2>
            <p className="text-xs text-ink-500">পরবর্তী ধাপ</p>
          </div>

          {po.status === "DRAFT" ? (
            <div className="flex flex-wrap gap-2">
              <form action={sendDropshipOrderAction}>
                <input type="hidden" name="id" value={po.id} />
                <button
                  type="submit"
                  className="min-h-11 rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700"
                >
                  Send to supplier
                </button>
              </form>
              <CancelForm id={po.id} />
            </div>
          ) : null}

          {po.status === "SENT" ? (
            <div className="space-y-3">
              <form action={confirmDropshipOrderAction} className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="id" value={po.id} />
                <label className="min-w-48 flex-1 text-sm font-medium text-ink-700">
                  <span>
                    Supplier reference <span className="text-xs font-normal text-ink-500">ঐচ্ছিক</span>
                  </span>
                  <input name="note" maxLength={300} className={inputClass} />
                </label>
                <button
                  type="submit"
                  className="min-h-11 rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700"
                >
                  Supplier confirmed
                </button>
              </form>
              <CancelForm id={po.id} />
            </div>
          ) : null}

          {po.status === "CONFIRMED" ? (
            <div className="space-y-3">
              <form action={shipDropshipOrderAction} className="grid gap-3 sm:grid-cols-2">
                <input type="hidden" name="id" value={po.id} />
                <label className="block text-sm font-medium text-ink-700">
                  <span>
                    Tracking number <span className="text-xs font-normal text-ink-500">ঐচ্ছিক</span>
                  </span>
                  <input name="trackingNumber" maxLength={80} className={inputClass} />
                </label>
                <label className="block text-sm font-medium text-ink-700">
                  <span>Courier</span>
                  <select name="courierId" className={inputClass}>
                    <option value="">Supplier&apos;s own courier</option>
                    {couriers.map((courier) => (
                      <option key={courier.id} value={courier.id}>
                        {courier.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm font-medium text-ink-700 sm:col-span-2">
                  <span>Note</span>
                  <input name="note" maxLength={300} className={inputClass} />
                </label>
                <div className="sm:col-span-2">
                  <button
                    type="submit"
                    disabled={!prepaid}
                    className="min-h-11 rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Mark shipped by supplier
                  </button>
                  <p className="mt-1 text-xs text-ink-500">
                    Posts DR 5010 cost of goods sold / CR 1300 supplier payable and moves the sale
                    to shipped.
                  </p>
                </div>
              </form>
              <CancelForm id={po.id} />
            </div>
          ) : null}

          {po.status === "SHIPPED" ? (
            <form action={deliverDropshipOrderAction} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="id" value={po.id} />
              <label className="min-w-48 flex-1 text-sm font-medium text-ink-700">
                <span>
                  Delivery note <span className="text-xs font-normal text-ink-500">ঐচ্ছিক</span>
                </span>
                <input name="note" maxLength={300} className={inputClass} />
              </label>
              <button
                type="submit"
                className="min-h-11 rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700"
              >
                Mark delivered
              </button>
            </form>
          ) : null}

          {["DELIVERED", "CANCELLED"].includes(po.status) ? (
            <p className="text-sm text-ink-500">
              {po.status === "DELIVERED"
                ? "Delivered. The sale is fulfilled and the supplier payable stays open until settlement."
                : "Cancelled. No further action."}
            </p>
          ) : null}
        </section>
      ) : (
        <p className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-ink-600 ring-1 ring-slate-200">
          You can read this order but not move it. Sending, confirming, shipping, delivering and
          cancelling need <span className="font-mono">purchase.approve</span>.
        </p>
      )}

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <h2 className="text-base font-semibold">Ship to</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-ink-500">Recipient</dt>
              <dd>{po.order?.recipientName ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-ink-500">Mobile</dt>
              <dd className="font-mono">{po.order?.recipientMobile ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-ink-500">Address</dt>
              <dd className="text-ink-700">{addressText || "No address recorded"}</dd>
            </div>
            {po.order?.customerNote ? (
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-ink-500">
                  Customer note
                </dt>
                <dd className="whitespace-pre-line text-ink-700">{po.order.customerNote}</dd>
              </div>
            ) : null}
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-ink-500">Supplier</dt>
              <dd>
                {po.supplier.name}
                {po.supplier.mobileNormalized ? (
                  <span className="ml-2 font-mono text-xs text-ink-500">
                    {po.supplier.mobileNormalized}
                  </span>
                ) : null}
              </dd>
            </div>
          </dl>
          {po.notes ? (
            <p className="mt-3 whitespace-pre-line rounded-xl bg-slate-50 px-3 py-2 text-xs text-ink-600">
              {po.notes}
            </p>
          ) : null}
        </div>

        <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-base font-semibold">Supplier lines</h2>
            <p className="text-xs text-ink-500">
              ৳{formatMoney(po.grandTotal)} at supplier cost
            </p>
          </div>
          <ul className="mt-3 divide-y divide-slate-100">
            {po.items.map((item) => (
              <li key={item.id} className="py-3">
                <p className="text-sm font-medium text-ink-800">{item.description}</p>
                <p className="mt-1 flex flex-wrap justify-between gap-2 text-xs text-ink-500">
                  <span>
                    {formatQty(item.quantity)} × ৳{formatCost(item.unitCost)}
                  </span>
                  <span className="tabular-nums">৳{formatMoney(item.lineTotal)}</span>
                </p>
                {item.orderItem ? (
                  <p className="mt-1 text-[11px] text-ink-500">
                    sale line {item.orderItem.skuSnapshot}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-ink-500">
            Supplier payable now ৳{formatMoney(payable.outstanding)} ·{" "}
            <Link href={`/suppliers/${po.supplierId}/statement`} className="text-brand-700 hover:underline">
              statement
            </Link>
          </p>
        </div>
      </section>

      <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold">Direct shipment</h2>
          {shipment ? (
            <p className="text-xs text-ink-500">
              {shipment.shipmentNumber} · {shipment.status.toLowerCase().replaceAll("_", " ")}
            </p>
          ) : (
            <p className="text-xs text-ink-500">not shipped yet</p>
          )}
        </div>

        {!shipment ? (
          <p className="mt-3 rounded-xl bg-slate-50 px-3 py-4 text-sm text-ink-500">
            No shipment yet. Marking the supplier order shipped creates one with no warehouse.
          </p>
        ) : (
          <div className="mt-3 space-y-3">
            <p className="text-sm text-ink-700">
              {shipment.courier?.name ?? "Supplier's own courier"}
              {shipment.trackingNumber ? (
                <span className="ml-2 font-mono text-xs">{shipment.trackingNumber}</span>
              ) : null}
            </p>
            <ul className="space-y-2">
              {shipment.trackingEvents.map((event) => (
                <li key={event.id} className="border-l-2 border-slate-200 pl-3">
                  <p className="text-sm font-medium">
                    {event.status.toLowerCase().replaceAll("_", " ")}
                  </p>
                  <p className="text-xs text-ink-500">
                    {dateTime.format(event.eventAt)}
                    {event.message ? ` · ${event.message}` : ""}
                  </p>
                </li>
              ))}
            </ul>
            <Link
              href="/shipments"
              className="inline-block text-xs font-medium text-brand-700 hover:underline"
            >
              Open shipments →
            </Link>
          </div>
        )}
      </section>

      <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold">Journal entries</h2>
          <p className="text-xs text-ink-500">DR 5010 dropship cost / CR 1300 payable</p>
        </div>
        {journals.length === 0 ? (
          <p className="mt-3 rounded-xl bg-slate-50 px-3 py-4 text-sm text-ink-500">
            Nothing posted yet. Shipping the supplier order recognises the cost.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100">
            {journals.map((entry) => (
              <li key={entry.id} className="py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <Link
                    href={`/accounting/journals/${entry.id}`}
                    className="font-mono text-xs text-brand-700 hover:underline"
                  >
                    {entry.entryNumber}
                  </Link>
                  <span className="text-xs text-ink-500">
                    {dateOnly.format(entry.entryDate)} · {entry.status.toLowerCase()}
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
    </div>
  );
}

function CancelForm({ id }: { id: string }) {
  return (
    <form action={cancelDropshipOrderAction} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="id" value={id} />
      <label className="min-w-48 text-sm font-medium text-ink-700">
        <span>
          Cancel reason <span className="text-xs font-normal text-ink-500">কারণ</span>
        </span>
        <input name="reason" maxLength={300} className={inputClass} />
      </label>
      <button
        type="submit"
        className="min-h-11 rounded-xl border border-slate-300 px-4 text-sm font-semibold text-ink-700 hover:border-red-300 hover:text-red-700"
      >
        Cancel order
      </button>
    </form>
  );
}
