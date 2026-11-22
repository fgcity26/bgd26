import type { Metadata } from "next";
import Link from "next/link";
import { Prisma } from "@/generated/prisma/client";
import { InventoryNav } from "@/components/inventory/inventory-nav";
import { ADJUSTMENT_TYPES } from "@/lib/inventory/service";
import { hasPermission } from "@/lib/auth/permissions";
import { requirePagePermission } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { formatQty } from "@/lib/inventory/format";

export const metadata: Metadata = {
  title: "Stock adjustments",
  robots: { index: false, follow: false },
};

const PAGE_SIZE = 25;

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "DRAFT", label: "Draft" },
  { value: "POSTED", label: "Posted" },
  { value: "VOID", label: "Void" },
] as const;

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

export default async function AdjustmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; type?: string; warehouse?: string; page?: string }>;
}) {
  const session = await requirePagePermission("inventory.read");
  const canWrite = hasPermission(session, "inventory.write");

  const params = await searchParams;
  const query = params.q?.trim() ?? "";
  const status = STATUS_OPTIONS.some((option) => option.value === params.status)
    ? (params.status ?? "")
    : "";
  const type = (ADJUSTMENT_TYPES as readonly string[]).includes(params.type ?? "")
    ? (params.type ?? "")
    : "";
  const page = Math.max(1, Number(params.page) || 1);

  const warehouses = await prisma.warehouse.findMany({
    orderBy: { code: "asc" },
    select: { id: true, code: true, name: true },
  });
  const warehouseId = warehouses.some((warehouse) => warehouse.id === params.warehouse)
    ? (params.warehouse ?? "")
    : "";

  const where: Prisma.StockAdjustmentWhereInput = {
    ...(status ? { status: status as Prisma.EnumAdjustmentStatusFilter } : {}),
    ...(type ? { adjustmentType: type as Prisma.EnumAdjustmentTypeFilter } : {}),
    ...(warehouseId ? { warehouseId } : {}),
    ...(query
      ? {
          OR: [
            { adjustmentNumber: { contains: query, mode: "insensitive" } },
            { reason: { contains: query, mode: "insensitive" } },
            {
              variant: {
                OR: [
                  { sku: { contains: query, mode: "insensitive" } },
                  { name: { contains: query, mode: "insensitive" } },
                  { product: { name: { contains: query, mode: "insensitive" } } },
                ],
              },
            },
          ],
        }
      : {}),
  };

  const [total, adjustments] = await Promise.all([
    prisma.stockAdjustment.count({ where }),
    prisma.stockAdjustment.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        warehouse: { select: { code: true, name: true } },
        variant: {
          select: {
            id: true,
            sku: true,
            name: true,
            product: { select: { name: true } },
          },
        },
        createdBy: { select: { fullName: true } },
      },
    }),
  ]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const linkFor = (nextPage: number) => {
    const search = new URLSearchParams();
    if (query) search.set("q", query);
    if (status) search.set("status", status);
    if (type) search.set("type", type);
    if (warehouseId) search.set("warehouse", warehouseId);
    if (nextPage > 1) search.set("page", String(nextPage));
    const suffix = search.toString();
    return suffix ? `/inventory/adjustments?${suffix}` : "/inventory/adjustments";
  };

  return (
    <div className="space-y-5">
      <header className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Stock adjustments</h1>
            <p className="mt-1 text-sm text-ink-500">
              ঘাটতি, ক্ষতি, কোয়ারেন্টাইন ও রাইট-অফ। ড্রাফট কিছু বদলায় না; অনুমোদনের পর লেজারে লেখা হয়।
            </p>
          </div>
          {canWrite ? (
            <Link
              href="/inventory/adjustments/new"
              className="inline-flex min-h-11 items-center rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700"
            >
              New adjustment · সংশোধন
            </Link>
          ) : null}
        </div>
        <InventoryNav />
      </header>

      <form
        method="get"
        className="grid gap-2 rounded-2xl bg-white p-3 ring-1 ring-slate-200 sm:grid-cols-2 lg:grid-cols-[1fr_auto_auto_auto_auto]"
      >
        <input
          name="q"
          defaultValue={query}
          placeholder="Search document, reason, SKU or product"
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
          name="type"
          defaultValue={type}
          className="min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm"
        >
          <option value="">All types</option>
          {ADJUSTMENT_TYPES.map((option) => (
            <option key={option} value={option}>
              {option.replaceAll("_", " ")}
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
        {total} adjustment{total === 1 ? "" : "s"} · page {page} of {pages}
      </p>

      {adjustments.length === 0 ? (
        <div className="rounded-2xl bg-white p-6 text-center ring-1 ring-slate-200">
          <p className="text-sm font-medium text-ink-700">No adjustments match these filters.</p>
          <p className="mt-1 text-sm text-ink-500">
            Draft an adjustment when a physical count disagrees with the system.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {adjustments.map((adjustment) => (
            <li key={adjustment.id} className="rounded-2xl bg-white ring-1 ring-slate-200">
              <Link
                href={`/inventory/adjustments/${adjustment.id}`}
                className="block p-3 transition-colors hover:bg-brand-50/40"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink-900">
                      {adjustment.adjustmentNumber}
                      <span className="ml-2 text-xs font-normal text-ink-500">
                        {adjustment.adjustmentType.replaceAll("_", " ")}
                      </span>
                    </p>
                    <p className="mt-1 truncate text-xs text-ink-500">
                      {adjustment.variant.product.name} · {adjustment.variant.name} ·{" "}
                      {adjustment.variant.sku} · {adjustment.warehouse.code}
                    </p>
                    <p className="mt-1 line-clamp-2 text-xs text-ink-700">{adjustment.reason}</p>
                  </div>
                  <div className="text-right">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${statusStyle(adjustment.status)}`}
                    >
                      {adjustment.status}
                    </span>
                    <p className="mt-1 text-xs text-ink-500">
                      {formatQty(adjustment.quantity)} units
                    </p>
                  </div>
                </div>
                <p className="mt-2 text-xs text-ink-500">
                  {dateTime.format(adjustment.createdAt)}
                  {adjustment.createdBy ? ` · ${adjustment.createdBy.fullName}` : ""}
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
