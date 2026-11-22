import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { setWarehouseActiveAction } from "@/app/actions/inventory";
import { InventoryNav } from "@/components/inventory/inventory-nav";
import { WarehouseForm } from "@/components/inventory/warehouse-form";
import { hasPermission } from "@/lib/auth/permissions";
import { requirePagePermission } from "@/lib/auth/session";
import { canViewCostPrices } from "@/lib/catalog/dto";
import { prisma } from "@/lib/db";
import { formatMoney, formatQty } from "@/lib/inventory/format";

export const metadata: Metadata = {
  title: "Warehouse",
  robots: { index: false, follow: false },
};

export default async function WarehouseDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await requirePagePermission("inventory.read");
  const { id } = await params;
  const { error } = await searchParams;
  const canWrite = hasPermission(session, "inventory.write");
  const canViewCost = canViewCostPrices(session);

  const warehouse = await prisma.warehouse.findUnique({
    where: { id },
    include: {
      inventoryBalances: {
        orderBy: { lastMovementAt: "desc" },
        take: 20,
        include: {
          variant: {
            select: {
              id: true,
              name: true,
              sku: true,
              product: { select: { name: true } },
            },
          },
        },
      },
      _count: { select: { inventoryBalances: true, stores: true, transfersFrom: true, transfersTo: true } },
    },
  });

  if (!warehouse) notFound();

  const totals = warehouse.inventoryBalances.reduce(
    (sum, balance) => ({
      physical: sum.physical + Number(balance.physicalQty.toString()),
      available: sum.available + Number(balance.availableQty.toString()),
      value: sum.value + Number(balance.physicalQty.mul(balance.avcoUnitCost).toString()),
    }),
    { physical: 0, available: 0, value: 0 },
  );

  return (
    <div className="space-y-5">
      <header className="space-y-3">
        <Link
          href="/inventory/warehouses"
          className="text-sm font-medium text-brand-700 hover:underline"
        >
          ← Warehouses
        </Link>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight">{warehouse.name}</h1>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-ink-700">
                {warehouse.code}
              </span>
              {warehouse.isDefault ? (
                <span className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700 ring-1 ring-brand-200">
                  Default
                </span>
              ) : null}
              <span
                className={[
                  "rounded-full px-2.5 py-1 text-xs font-medium ring-1",
                  warehouse.isActive
                    ? "bg-brand-50 text-brand-700 ring-brand-200"
                    : "bg-slate-100 text-ink-500 ring-slate-200",
                ].join(" ")}
              >
                {warehouse.isActive ? "Active" : "Inactive"}
              </span>
            </div>
            <p className="mt-1 text-sm text-ink-500">
              {warehouse.type}
              {warehouse.division || warehouse.district
                ? ` · ${[warehouse.district, warehouse.division].filter(Boolean).join(", ")}`
                : ""}
            </p>
            {warehouse.nameBn ? <p className="mt-1 text-sm text-ink-500">{warehouse.nameBn}</p> : null}
            {warehouse.address ? (
              <p className="mt-1 text-sm text-ink-700">{warehouse.address}</p>
            ) : null}
          </div>

          {canWrite ? (
            <form action={setWarehouseActiveAction}>
              <input type="hidden" name="id" value={warehouse.id} />
              <input type="hidden" name="active" value={warehouse.isActive ? "false" : "true"} />
              <button
                type="submit"
                className={[
                  "min-h-11 rounded-xl border px-4 text-sm font-semibold",
                  warehouse.isActive
                    ? "border-red-300 text-red-700 hover:bg-red-50"
                    : "border-brand-300 text-brand-700 hover:bg-brand-50",
                ].join(" ")}
              >
                {warehouse.isActive ? "Deactivate" : "Activate"}
              </button>
            </form>
          ) : null}
        </div>

        <InventoryNav />
      </header>

      {error ? (
        <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-red-200">
          {error}
        </p>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Stock rows</p>
          <p className="mt-1 text-lg font-semibold">{warehouse._count.inventoryBalances}</p>
        </div>
        <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Physical units</p>
          <p className="mt-1 text-lg font-semibold">{formatQty(totals.physical)}</p>
        </div>
        <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Available units</p>
          <p className="mt-1 text-lg font-semibold text-brand-700">{formatQty(totals.available)}</p>
        </div>
        {canViewCost ? (
          <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
            <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Stock value</p>
            <p className="mt-1 text-lg font-semibold">৳{formatMoney(totals.value)}</p>
          </div>
        ) : null}
      </section>

      <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
        <h2 className="text-base font-semibold">Recent stock rows</h2>
        {warehouse.inventoryBalances.length === 0 ? (
          <p className="mt-3 rounded-xl bg-slate-50 px-3 py-4 text-sm text-ink-500">
            No stock in this warehouse yet.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100">
            {warehouse.inventoryBalances.map((balance) => (
              <li key={balance.id} className="py-2">
                <Link
                  href={`/inventory/${balance.variant.id}`}
                  className="flex flex-wrap items-baseline justify-between gap-2 text-sm hover:text-brand-700"
                >
                  <span className="min-w-0 truncate">
                    <span className="font-medium text-ink-900">{balance.variant.product.name}</span>
                    <span className="text-ink-500">
                      {" "}
                      · {balance.variant.name} · {balance.variant.sku}
                    </span>
                  </span>
                  <span className="text-xs text-ink-500">
                    physical {formatQty(balance.physicalQty)} · available{" "}
                    {formatQty(balance.availableQty)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {canWrite ? (
        <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <h2 className="text-base font-semibold">Edit warehouse</h2>
          <div className="mt-4">
            <WarehouseForm
              mode="edit"
              warehouse={{
                id: warehouse.id,
                code: warehouse.code,
                name: warehouse.name,
                nameBn: warehouse.nameBn,
                type: warehouse.type,
                division: warehouse.division,
                district: warehouse.district,
                address: warehouse.address,
                isDefault: warehouse.isDefault,
                isActive: warehouse.isActive,
              }}
            />
          </div>
        </section>
      ) : null}
    </div>
  );
}
