import type { Metadata } from "next";
import Link from "next/link";
import { Prisma } from "@/generated/prisma/client";
import { InventoryNav } from "@/components/inventory/inventory-nav";
import { hasPermission } from "@/lib/auth/permissions";
import { requirePagePermission } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { formatQty } from "@/lib/inventory/format";

export const metadata: Metadata = {
  title: "Stock transfers",
  robots: { index: false, follow: false },
};

const PAGE_SIZE = 25;

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "DRAFT", label: "Draft" },
  { value: "IN_TRANSIT", label: "In transit" },
  { value: "RECEIVED", label: "Received" },
  { value: "CANCELLED", label: "Cancelled" },
] as const;

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

export default async function TransfersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; warehouse?: string; page?: string }>;
}) {
  const session = await requirePagePermission("inventory.read");
  const canWrite = hasPermission(session, "inventory.write");

  const params = await searchParams;
  const query = params.q?.trim() ?? "";
  const status = STATUS_OPTIONS.some((option) => option.value === params.status)
    ? (params.status ?? "")
    : "";
  const page = Math.max(1, Number(params.page) || 1);

  const warehouses = await prisma.warehouse.findMany({
    orderBy: { code: "asc" },
    select: { id: true, code: true, name: true },
  });
  const warehouseId = warehouses.some((warehouse) => warehouse.id === params.warehouse)
    ? (params.warehouse ?? "")
    : "";

  const where: Prisma.StockTransferWhereInput = {
    ...(status ? { status: status as Prisma.EnumTransferStatusFilter } : {}),
    ...(warehouseId
      ? { OR: [{ fromWarehouseId: warehouseId }, { toWarehouseId: warehouseId }] }
      : {}),
    ...(query
      ? {
          AND: [
            {
              OR: [
                { transferNumber: { contains: query, mode: "insensitive" } },
                { notes: { contains: query, mode: "insensitive" } },
                { fromWarehouse: { code: { contains: query, mode: "insensitive" } } },
                { toWarehouse: { code: { contains: query, mode: "insensitive" } } },
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
            },
          ],
        }
      : {}),
  };

  const [total, transfers] = await Promise.all([
    prisma.stockTransfer.count({ where }),
    prisma.stockTransfer.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        fromWarehouse: { select: { code: true, name: true } },
        toWarehouse: { select: { code: true, name: true } },
        requestedBy: { select: { fullName: true } },
        items: {
          select: {
            quantity: true,
            variant: {
              select: {
                sku: true,
                name: true,
                product: { select: { name: true } },
              },
            },
          },
        },
      },
    }),
  ]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const linkFor = (nextPage: number) => {
    const search = new URLSearchParams();
    if (query) search.set("q", query);
    if (status) search.set("status", status);
    if (warehouseId) search.set("warehouse", warehouseId);
    if (nextPage > 1) search.set("page", String(nextPage));
    const suffix = search.toString();
    return suffix ? `/inventory/transfers?${suffix}` : "/inventory/transfers";
  };

  return (
    <div className="space-y-5">
      <header className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Stock transfers</h1>
            <p className="mt-1 text-sm text-ink-500">
              গুদামের মধ্যে স্টক স্থানান্তর। পাঠানো ও গ্রহণ আলাদা ধাপ, তাই পথে থাকা স্টক হারায় না।
            </p>
          </div>
          {canWrite ? (
            <Link
              href="/inventory/transfers/new"
              className="inline-flex min-h-11 items-center rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700"
            >
              New transfer · স্থানান্তর
            </Link>
          ) : null}
        </div>
        <InventoryNav />
      </header>

      <form
        method="get"
        className="grid gap-2 rounded-2xl bg-white p-3 ring-1 ring-slate-200 sm:grid-cols-2 lg:grid-cols-[1fr_auto_auto_auto]"
      >
        <input
          name="q"
          defaultValue={query}
          placeholder="Search document, warehouse, SKU or product"
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
          name="warehouse"
          defaultValue={warehouseId}
          className="min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm"
        >
          <option value="">All warehouses</option>
          {warehouses.map((warehouse) => (
            <option key={warehouse.id} value={warehouse.id}>
              {warehouse.code}
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
        {total} transfer{total === 1 ? "" : "s"} · page {page} of {pages}
      </p>

      {transfers.length === 0 ? (
        <div className="rounded-2xl bg-white p-6 text-center ring-1 ring-slate-200">
          <p className="text-sm font-medium text-ink-700">No transfers match these filters.</p>
          <p className="mt-1 text-sm text-ink-500">
            Move stock between warehouses when a shop needs replenishment.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {transfers.map((transfer) => {
            const units = transfer.items.reduce(
              (sum, item) => sum + Number(item.quantity.toString()),
              0,
            );
            return (
              <li key={transfer.id} className="rounded-2xl bg-white ring-1 ring-slate-200">
                <Link
                  href={`/inventory/transfers/${transfer.id}`}
                  className="block p-3 transition-colors hover:bg-brand-50/40"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-ink-900">
                        {transfer.transferNumber}
                      </p>
                      <p className="mt-1 text-xs text-ink-500">
                        {transfer.fromWarehouse.code} → {transfer.toWarehouse.code} ·{" "}
                        {transfer.items.length} line
                        {transfer.items.length === 1 ? "" : "s"} · {formatQty(units)} units
                      </p>
                      {transfer.items.length > 0 ? (
                        <p className="mt-1 truncate text-xs text-ink-700">
                          {transfer.items
                            .slice(0, 3)
                            .map(
                              (item) =>
                                `${item.variant.sku} ${item.variant.product.name} ${formatQty(item.quantity)}`,
                            )
                            .join(" · ")}
                          {transfer.items.length > 3 ? " …" : ""}
                        </p>
                      ) : null}
                    </div>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${statusStyle(transfer.status)}`}
                    >
                      {transfer.status.replaceAll("_", " ")}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-ink-500">
                    {dateTime.format(transfer.createdAt)}
                    {transfer.requestedBy ? ` · ${transfer.requestedBy.fullName}` : ""}
                  </p>
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
