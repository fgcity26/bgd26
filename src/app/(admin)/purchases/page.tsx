import type { Metadata } from "next";
import Link from "next/link";
import { Prisma } from "@/generated/prisma/client";
import { PurchaseNav } from "@/components/purchasing/purchasing-nav";
import { hasPermission } from "@/lib/auth/permissions";
import { requirePagePermission } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/inventory/format";

export const metadata: Metadata = {
  title: "Purchase orders",
  robots: { index: false, follow: false },
};

const PAGE_SIZE = 25;

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "DRAFT", label: "Draft" },
  { value: "SENT", label: "Sent" },
  { value: "PARTIALLY_RECEIVED", label: "Partially received" },
  { value: "RECEIVED", label: "Received" },
  { value: "CLOSED", label: "Closed" },
  { value: "CANCELLED", label: "Cancelled" },
] as const;

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
  if (status === "RECEIVED") return "bg-brand-50 text-brand-700 ring-brand-200";
  if (status === "PARTIALLY_RECEIVED") return "bg-brand-50 text-brand-700 ring-brand-200";
  if (status === "SENT") return "bg-amber-50 text-amber-800 ring-amber-200";
  if (status === "CANCELLED") return "bg-slate-100 text-ink-500 ring-slate-200";
  if (status === "CLOSED") return "bg-slate-100 text-ink-500 ring-slate-200";
  return "bg-slate-100 text-ink-700 ring-slate-200";
}

export default async function PurchasesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; supplier?: string; page?: string }>;
}) {
  const session = await requirePagePermission("purchase.read");
  const canWrite = hasPermission(session, "purchase.write");

  const params = await searchParams;
  const query = params.q?.trim() ?? "";
  const status = STATUS_OPTIONS.some((option) => option.value === params.status)
    ? (params.status ?? "")
    : "";
  const page = Math.max(1, Number(params.page) || 1);

  const suppliers = await prisma.supplier.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, code: true },
  });
  const supplierId = suppliers.some((supplier) => supplier.id === params.supplier)
    ? (params.supplier ?? "")
    : "";

  const where: Prisma.PurchaseOrderWhereInput = {
    // Dropship orders have their own screen and lifecycle.
    poType: "STANDARD",
    ...(status ? { status: status as Prisma.EnumPurchaseOrderStatusFilter } : {}),
    ...(supplierId ? { supplierId } : {}),
    ...(query
      ? {
          OR: [
            { poNumber: { contains: query, mode: "insensitive" } },
            { notes: { contains: query, mode: "insensitive" } },
            { supplier: { name: { contains: query, mode: "insensitive" } } },
            { supplier: { code: { contains: query, mode: "insensitive" } } },
            {
              items: {
                some: {
                  variant: {
                    OR: [
                      { sku: { contains: query, mode: "insensitive" } },
                      { name: { contains: query, mode: "insensitive" } },
                      { product: { name: { contains: query, mode: "insensitive" } } },
                    ],
                  },
                },
              },
            },
          ],
        }
      : {}),
  };

  const [total, orders] = await Promise.all([
    prisma.purchaseOrder.count({ where }),
    prisma.purchaseOrder.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        supplier: { select: { code: true, name: true } },
        warehouse: { select: { code: true } },
        _count: { select: { items: true, grns: true } },
      },
    }),
  ]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const linkFor = (nextPage: number) => {
    const search = new URLSearchParams();
    if (query) search.set("q", query);
    if (status) search.set("status", status);
    if (supplierId) search.set("supplier", supplierId);
    if (nextPage > 1) search.set("page", String(nextPage));
    const suffix = search.toString();
    return suffix ? `/purchases?${suffix}` : "/purchases";
  };

  return (
    <div className="space-y-5">
      <header className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Purchase orders</h1>
            <p className="mt-1 text-sm text-ink-500">
              সরবরাহকারীকে দেওয়া অর্ডার। মাল গ্রহণের আগে কোনো স্টক বদলায় না।
            </p>
          </div>
          {canWrite ? (
            <Link
              href="/purchases/new"
              className="inline-flex min-h-11 items-center rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700"
            >
              New order · নতুন
            </Link>
          ) : null}
        </div>
        <PurchaseNav />
      </header>

      <form
        method="get"
        className="grid gap-2 rounded-2xl bg-white p-3 ring-1 ring-slate-200 sm:grid-cols-2 lg:grid-cols-[1fr_auto_auto_auto]"
      >
        <input
          name="q"
          defaultValue={query}
          placeholder="Search document, supplier, SKU or product"
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
        <select
          name="supplier"
          defaultValue={supplierId}
          className="min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm"
        >
          <option value="">All suppliers</option>
          {suppliers.map((supplier) => (
            <option key={supplier.id} value={supplier.id}>
              {supplier.code} · {supplier.name}
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
        {total} order{total === 1 ? "" : "s"} · page {page} of {pages}
      </p>

      {orders.length === 0 ? (
        <div className="rounded-2xl bg-white p-6 text-center ring-1 ring-slate-200">
          <p className="text-sm font-medium text-ink-700">No purchase orders match these filters.</p>
          <p className="mt-1 text-sm text-ink-500">
            Raise an order, send it, then receive the goods into a warehouse.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {orders.map((order) => (
            <li key={order.id} className="rounded-2xl bg-white ring-1 ring-slate-200">
              <Link
                href={`/purchases/${order.id}`}
                className="block p-3 transition-colors hover:bg-brand-50/40"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink-900">{order.poNumber}</p>
                    <p className="mt-1 truncate text-xs text-ink-500">
                      {order.supplier.code} · {order.supplier.name}
                      {order.warehouse ? ` → ${order.warehouse.code}` : ""}
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${statusStyle(order.status)}`}
                  >
                    {order.status.replaceAll("_", " ")}
                  </span>
                </div>
                <p className="mt-2 text-xs text-ink-700">
                  {order._count.items} line{order._count.items === 1 ? "" : "s"} · ৳
                  {formatMoney(order.grandTotal)} · {order._count.grns} receipt
                  {order._count.grns === 1 ? "" : "s"}
                </p>
                <p className="mt-1 text-xs text-ink-500">
                  {dateTime.format(order.createdAt)}
                  {order.expectedAt ? ` · expected ${dateOnly.format(order.expectedAt)}` : ""}
                </p>
              </Link>
            </li>
          ))}
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
