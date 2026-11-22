import type { Metadata } from "next";
import Link from "next/link";
import { Prisma } from "@/generated/prisma/client";
import { InventoryNav } from "@/components/inventory/inventory-nav";
import { hasPermission } from "@/lib/auth/permissions";
import { requirePagePermission } from "@/lib/auth/session";
import { canViewCostPrices } from "@/lib/catalog/dto";
import { prisma } from "@/lib/db";
import { formatCost, formatMoney, formatQty } from "@/lib/inventory/format";

export const metadata: Metadata = {
  title: "Inventory",
  robots: { index: false, follow: false },
};

const PAGE_SIZE = 25;

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; warehouse?: string; page?: string }>;
}) {
  const session = await requirePagePermission("inventory.read");
  const canWrite = hasPermission(session, "inventory.write");
  const canApprove = hasPermission(session, "inventory.approve");
  const canViewCost = canViewCostPrices(session);

  const params = await searchParams;
  const query = params.q?.trim() ?? "";
  const page = Math.max(1, Number(params.page) || 1);

  const warehouses = await prisma.warehouse.findMany({
    orderBy: [{ isDefault: "desc" }, { code: "asc" }],
    select: { id: true, code: true, name: true, isActive: true },
  });

  const warehouseId = warehouses.some((warehouse) => warehouse.id === params.warehouse)
    ? (params.warehouse ?? "")
    : "";

  const where: Prisma.InventoryBalanceWhereInput = {
    ...(warehouseId ? { warehouseId } : {}),
    ...(query
      ? {
          variant: {
            OR: [
              { sku: { contains: query, mode: "insensitive" } },
              { name: { contains: query, mode: "insensitive" } },
              { barcode: { contains: query, mode: "insensitive" } },
              { product: { name: { contains: query, mode: "insensitive" } } },
            ],
          },
        }
      : {}),
  };

  const [total, balances, summaryRows] = await Promise.all([
    prisma.inventoryBalance.count({ where }),
    prisma.inventoryBalance.findMany({
      where,
      orderBy: [{ lastMovementAt: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        variant: {
          select: {
            id: true,
            name: true,
            sku: true,
            fulfillmentType: true,
            product: { select: { id: true, name: true } },
          },
        },
        warehouse: { select: { id: true, code: true, name: true } },
      },
    }),
    prisma.$queryRaw<
      Array<{ rows: number; available: string; value: string; out: number }>
    >`
      SELECT
        COUNT(*)::int AS "rows",
        COALESCE(SUM("availableQty"), 0)::text AS "available",
        COALESCE(SUM("physicalQty" * "avcoUnitCost"), 0)::text AS "value",
        COUNT(*) FILTER (WHERE "availableQty" <= 0 AND "physicalQty" > 0)::int AS "out"
      FROM "inventory_balances"
      ${warehouseId ? Prisma.sql`WHERE "warehouseId" = ${warehouseId}` : Prisma.empty}
    `,
  ]);

  const summary = summaryRows[0] ?? { rows: 0, available: "0", value: "0", out: 0 };
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const linkFor = (nextPage: number) => {
    const search = new URLSearchParams();
    if (query) search.set("q", query);
    if (warehouseId) search.set("warehouse", warehouseId);
    if (nextPage > 1) search.set("page", String(nextPage));
    const suffix = search.toString();
    return suffix ? `/inventory?${suffix}` : "/inventory";
  };

  return (
    <div className="space-y-5">
      <header className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Inventory</h1>
            <p className="mt-1 text-sm text-ink-500">
              গুদামভিত্তিক স্টক, চলমান গড় খরচ (AVCO) ও অপরিবর্তনীয় স্টক লেজার।
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {canApprove ? (
              <Link
                href="/inventory/opening"
                className="inline-flex min-h-11 items-center rounded-xl border border-slate-300 px-4 text-sm font-semibold text-ink-700 hover:border-brand-300 hover:text-brand-700"
              >
                Opening stock · ওপেনিং
              </Link>
            ) : null}
            {canWrite ? (
              <>
                <Link
                  href="/inventory/adjustments/new"
                  className="inline-flex min-h-11 items-center rounded-xl border border-slate-300 px-4 text-sm font-semibold text-ink-700 hover:border-brand-300 hover:text-brand-700"
                >
                  Adjust · সংশোধন
                </Link>
                <Link
                  href="/inventory/transfers/new"
                  className="inline-flex min-h-11 items-center rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700"
                >
                  Transfer · স্থানান্তর
                </Link>
              </>
            ) : null}
          </div>
        </div>

        <InventoryNav />
      </header>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Stock rows</p>
          <p className="mt-1 text-lg font-semibold">{summary.rows}</p>
          <p className="mt-1 text-xs text-ink-500">Variant × warehouse balances</p>
        </div>
        <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Available units</p>
          <p className="mt-1 text-lg font-semibold">{formatQty(summary.available)}</p>
          <p className="mt-1 text-xs text-ink-500">Sellable after reservations and holds</p>
        </div>
        {canViewCost ? (
          <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
            <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Stock value</p>
            <p className="mt-1 text-lg font-semibold">৳{formatMoney(summary.value)}</p>
            <p className="mt-1 text-xs text-ink-500">Physical quantity × AVCO</p>
          </div>
        ) : null}
        <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Out of stock</p>
          <p className="mt-1 text-lg font-semibold">{summary.out}</p>
          <p className="mt-1 text-xs text-ink-500">Rows with stock on hand but none available</p>
        </div>
      </section>

      <form
        method="get"
        className="grid gap-2 rounded-2xl bg-white p-3 ring-1 ring-slate-200 sm:grid-cols-[1fr_auto_auto]"
      >
        <input
          name="q"
          defaultValue={query}
          placeholder="Search SKU, barcode, variant or product"
          className="min-h-11 rounded-xl border border-slate-300 px-3 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
        />
        <select
          name="warehouse"
          defaultValue={warehouseId}
          className="min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm"
        >
          <option value="">All warehouses</option>
          {warehouses.map((warehouse) => (
            <option key={warehouse.id} value={warehouse.id}>
              {warehouse.code} · {warehouse.name}
              {warehouse.isActive ? "" : " (inactive)"}
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
        {total} stock row{total === 1 ? "" : "s"} · page {page} of {pages}
        {query ? ` · matching “${query}”` : ""}
      </p>

      {balances.length === 0 ? (
        <div className="rounded-2xl bg-white p-6 text-center ring-1 ring-slate-200">
          <p className="text-sm font-medium text-ink-700">No stock balances match these filters.</p>
          <p className="mt-1 text-sm text-ink-500">
            Stock appears here after opening stock, a purchase receipt or an adjustment.
          </p>
          <p className="mt-1 text-sm text-ink-500">
            ওপেনিং স্টক বা অ্যাডজাস্টমেন্ট পোস্ট করলে এখানে দেখা যাবে।
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {balances.map((balance) => {
            const value = Number(balance.physicalQty.toString()) *
              Number(balance.avcoUnitCost.toString());
            const out = Number(balance.availableQty.toString()) <= 0;
            return (
              <li key={balance.id} className="rounded-2xl bg-white ring-1 ring-slate-200">
                <Link
                  href={`/inventory/${balance.variant.id}`}
                  className="block p-3 transition-colors hover:bg-brand-50/40"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-ink-900">
                        {balance.variant.product.name}
                      </p>
                      <p className="truncate text-xs text-ink-500">
                        {balance.variant.name} · {balance.variant.sku}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-1">
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-ink-700">
                        {balance.warehouse.code}
                      </span>
                      {out ? (
                        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-amber-200">
                          none available
                        </span>
                      ) : null}
                      {balance.variant.fulfillmentType !== "STOCKED" ? (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-ink-500">
                          {balance.variant.fulfillmentType}
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <dl className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3 lg:grid-cols-6">
                    <div>
                      <dt className="text-ink-500">Physical</dt>
                      <dd className="font-semibold text-ink-900">
                        {formatQty(balance.physicalQty)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-ink-500">Available</dt>
                      <dd className="font-semibold text-brand-700">
                        {formatQty(balance.availableQty)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-ink-500">Reserved</dt>
                      <dd className="font-medium text-ink-700">{formatQty(balance.reservedQty)}</dd>
                    </div>
                    <div>
                      <dt className="text-ink-500">Damaged</dt>
                      <dd className="font-medium text-ink-700">{formatQty(balance.damagedQty)}</dd>
                    </div>
                    <div>
                      <dt className="text-ink-500">Quarantine</dt>
                      <dd className="font-medium text-ink-700">
                        {formatQty(balance.quarantinedQty)}
                      </dd>
                    </div>
                    {canViewCost ? (
                      <div>
                        <dt className="text-ink-500">AVCO / value</dt>
                        <dd className="font-medium text-ink-700">
                          ৳{formatCost(balance.avcoUnitCost)} · ৳{formatMoney(value)}
                        </dd>
                      </div>
                    ) : null}
                  </dl>
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
