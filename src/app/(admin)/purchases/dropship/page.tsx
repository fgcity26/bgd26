import type { Metadata } from "next";
import Link from "next/link";
import { Prisma } from "@/generated/prisma/client";
import { PurchaseNav } from "@/components/purchasing/purchasing-nav";
import { requirePagePermission } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { DROPSHIP_STATUS_LABELS } from "@/lib/dropship/service";
import { formatMoney } from "@/lib/inventory/format";

export const metadata: Metadata = {
  title: "Dropship orders",
  robots: { index: false, follow: false },
};

const PAGE_SIZE = 25;

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "DRAFT", label: "Draft" },
  { value: "SENT", label: "Sent to supplier" },
  { value: "CONFIRMED", label: "Supplier confirmed" },
  { value: "SHIPPED", label: "Shipped" },
  { value: "DELIVERED", label: "Delivered" },
  { value: "CANCELLED", label: "Cancelled" },
] as const;

const dateTime = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
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

export default async function DropshipOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
}) {
  await requirePagePermission("purchase.read");

  const params = await searchParams;
  const query = params.q?.trim() ?? "";
  const status = STATUS_OPTIONS.some((option) => option.value === params.status)
    ? (params.status ?? "")
    : "";
  const page = Math.max(1, Number(params.page) || 1);

  const where: Prisma.PurchaseOrderWhereInput = {
    poType: "DROPSHIP",
    ...(status ? { status: status as Prisma.EnumPurchaseOrderStatusFilter } : {}),
    ...(query
      ? {
          OR: [
            { poNumber: { contains: query, mode: "insensitive" } },
            { order: { orderNumber: { contains: query, mode: "insensitive" } } },
            { supplier: { name: { contains: query, mode: "insensitive" } } },
            { supplier: { code: { contains: query, mode: "insensitive" } } },
            {
              items: {
                some: {
                  description: { contains: query, mode: "insensitive" },
                },
              },
            },
          ],
        }
      : {}),
  };

  const [total, orders, grouped] = await Promise.all([
    prisma.purchaseOrder.count({ where }),
    prisma.purchaseOrder.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        supplier: { select: { code: true, name: true } },
        order: {
          select: {
            id: true,
            orderNumber: true,
            status: true,
            recipientName: true,
            recipientMobile: true,
          },
        },
        _count: { select: { items: true } },
      },
    }),
    prisma.purchaseOrder.groupBy({
      by: ["status"],
      where: { poType: "DROPSHIP" },
      _count: { _all: true },
    }),
  ]);

  // A shipment points at the sale and the supplier, not at the purchase order,
  // so match the two to show the latest direct shipment on each row.
  const saleIds = [...new Set(orders.map((order) => order.orderId).filter((id): id is string => Boolean(id)))];
  const shipments = saleIds.length
    ? await prisma.shipment.findMany({
        where: { orderId: { in: saleIds }, shipmentType: "DROPSHIP_DIRECT" },
        orderBy: { createdAt: "desc" },
        select: {
          orderId: true,
          supplierId: true,
          shipmentNumber: true,
          status: true,
          trackingNumber: true,
        },
      })
    : [];
  const shipmentBySaleAndSupplier = new Map(
    shipments.map((shipment) => [`${shipment.orderId}:${shipment.supplierId}`, shipment]),
  );

  const counts = new Map(grouped.map((row) => [row.status, row._count._all]));
  const openCount =
    (counts.get("DRAFT") ?? 0) + (counts.get("SENT") ?? 0) + (counts.get("CONFIRMED") ?? 0);
  const shippedCount = counts.get("SHIPPED") ?? 0;
  const deliveredCount = counts.get("DELIVERED") ?? 0;

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const linkFor = (nextPage: number) => {
    const search = new URLSearchParams();
    if (query) search.set("q", query);
    if (status) search.set("status", status);
    if (nextPage > 1) search.set("page", String(nextPage));
    const suffix = search.toString();
    return suffix ? `/purchases/dropship?${suffix}` : "/purchases/dropship";
  };

  return (
    <div className="space-y-5">
      <header className="space-y-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dropship orders</h1>
          <p className="mt-1 text-sm text-ink-500">
            সরবরাহকারী সরাসরি ক্রেতার কাছে পাঠায়। মাল গুদামে আসে না।
          </p>
        </div>
        <PurchaseNav />
      </header>

      <section className="grid grid-cols-3 gap-2">
        <div className="rounded-2xl bg-white p-3 ring-1 ring-slate-200">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Open</p>
          <p className="mt-1 text-xl font-semibold tabular-nums">{openCount}</p>
          <p className="mt-0.5 text-[11px] text-ink-500">draft, sent or confirmed</p>
        </div>
        <div className="rounded-2xl bg-white p-3 ring-1 ring-slate-200">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">In transit</p>
          <p className="mt-1 text-xl font-semibold tabular-nums">{shippedCount}</p>
          <p className="mt-0.5 text-[11px] text-ink-500">with the supplier&apos;s courier</p>
        </div>
        <div className="rounded-2xl bg-white p-3 ring-1 ring-slate-200">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Delivered</p>
          <p className="mt-1 text-xl font-semibold tabular-nums">{deliveredCount}</p>
          <p className="mt-0.5 text-[11px] text-ink-500">customer received</p>
        </div>
      </section>

      <form
        method="get"
        className="grid gap-2 rounded-2xl bg-white p-3 ring-1 ring-slate-200 sm:grid-cols-[1fr_auto_auto]"
      >
        <input
          name="q"
          defaultValue={query}
          placeholder="Search supplier order, sale or supplier"
          className="min-h-11 rounded-xl border border-slate-300 px-3 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
        />
        <select
          name="status"
          defaultValue={status}
          className="min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm"
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="min-h-11 rounded-xl border border-slate-300 px-4 text-sm font-semibold text-ink-700 hover:border-brand-300 hover:text-brand-700"
        >
          Filter
        </button>
      </form>

      <p className="text-xs text-ink-500">
        {total} supplier order{total === 1 ? "" : "s"} · page {page} of {pages}
      </p>

      {orders.length === 0 ? (
        <div className="rounded-2xl bg-white p-6 text-center ring-1 ring-slate-200">
          <p className="text-sm font-medium text-ink-700">No dropship orders match these filters.</p>
          <p className="mt-1 text-sm text-ink-500">
            A dropship order is raised automatically when an online sale includes a dropship
            variant.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {orders.map((order) => {
            const shipment = order.orderId
              ? shipmentBySaleAndSupplier.get(`${order.orderId}:${order.supplierId}`)
              : undefined;
            return (
              <li key={order.id} className="rounded-2xl bg-white ring-1 ring-slate-200">
                <Link
                  href={`/purchases/dropship/${order.id}`}
                  className="block p-3 transition-colors hover:bg-brand-50/40"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-ink-900">{order.poNumber}</p>
                      <p className="mt-1 truncate text-xs text-ink-500">
                        {order.supplier.code} · {order.supplier.name}
                      </p>
                    </div>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${statusStyle(order.status)}`}
                    >
                      {DROPSHIP_STATUS_LABELS[order.status] ?? order.status}
                    </span>
                  </div>

                  <p className="mt-2 text-xs text-ink-700">
                    {order.order ? (
                      <>
                        Sale {order.order.orderNumber} · {order.order.recipientName}
                      </>
                    ) : (
                      "No linked sale"
                    )}
                  </p>
                  <p className="mt-1 text-xs text-ink-500">
                    {order._count.items} line{order._count.items === 1 ? "" : "s"} · ৳
                    {formatMoney(order.grandTotal)} cost
                    {shipment
                      ? ` · ${shipment.shipmentNumber} ${shipment.status.toLowerCase().replaceAll("_", " ")}`
                      : ""}
                  </p>
                  <p className="mt-1 text-xs text-ink-500">{dateTime.format(order.createdAt)}</p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {pages > 1 ? (
        <nav className="flex items-center justify-between gap-3" aria-label="Pagination">
          {page > 1 ? (
            <Link
              href={linkFor(page - 1)}
              className="inline-flex min-h-11 items-center rounded-xl border border-slate-300 px-4 text-sm font-medium text-ink-700 hover:border-brand-300"
            >
              Previous
            </Link>
          ) : (
            <span />
          )}
          {page < pages ? (
            <Link
              href={linkFor(page + 1)}
              className="inline-flex min-h-11 items-center rounded-xl border border-slate-300 px-4 text-sm font-medium text-ink-700 hover:border-brand-300"
            >
              Next
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </div>
  );
}
