import type { Metadata } from "next";
import Link from "next/link";
import { InventoryNav } from "@/components/inventory/inventory-nav";
import { WarehouseForm } from "@/components/inventory/warehouse-form";
import { hasPermission } from "@/lib/auth/permissions";
import { requirePagePermission } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

export const metadata: Metadata = {
  title: "Warehouses",
  robots: { index: false, follow: false },
};

export default async function WarehousesPage() {
  const session = await requirePagePermission("inventory.read");
  const canWrite = hasPermission(session, "inventory.write");

  const warehouses = await prisma.warehouse.findMany({
    orderBy: [{ isDefault: "desc" }, { code: "asc" }],
    include: {
      _count: { select: { inventoryBalances: true, stores: true } },
    },
  });

  return (
    <div className="space-y-5">
      <header className="space-y-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Warehouses</h1>
          <p className="mt-1 text-sm text-ink-500">
            গুদাম, আউটলেট ও ড্রপশিপ লোকেশন। স্টক সবসময় একটি গুদামের সাথে যুক্ত।
          </p>
        </div>
        <InventoryNav />
      </header>

      {warehouses.length === 0 ? (
        <div className="rounded-2xl bg-white p-6 text-center ring-1 ring-slate-200">
          <p className="text-sm font-medium text-ink-700">No warehouses yet.</p>
          <p className="mt-1 text-sm text-ink-500">
            Create the main warehouse before posting opening stock.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {warehouses.map((warehouse) => (
            <li key={warehouse.id} className="rounded-2xl bg-white ring-1 ring-slate-200">
              <Link
                href={`/inventory/warehouses/${warehouse.id}`}
                className="block p-3 transition-colors hover:bg-brand-50/40"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink-900">
                      {warehouse.code} · {warehouse.name}
                      {warehouse.isDefault ? (
                        <span className="ml-2 rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700 ring-1 ring-brand-200">
                          Default
                        </span>
                      ) : null}
                      {!warehouse.isActive ? (
                        <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-ink-500">
                          Inactive
                        </span>
                      ) : null}
                    </p>
                    <p className="mt-1 text-xs text-ink-500">
                      {warehouse.type}
                      {warehouse.division || warehouse.district
                        ? ` · ${[warehouse.district, warehouse.division].filter(Boolean).join(", ")}`
                        : ""}
                    </p>
                  </div>
                  <p className="text-xs text-ink-500">
                    {warehouse._count.inventoryBalances} stock row
                    {warehouse._count.inventoryBalances === 1 ? "" : "s"} ·{" "}
                    {warehouse._count.stores} store
                    {warehouse._count.stores === 1 ? "" : "s"}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {canWrite ? (
        <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <h2 className="text-base font-semibold">Add a warehouse</h2>
          <p className="mt-1 text-sm text-ink-500">
            A second warehouse is enough to transfer stock between locations.
          </p>
          <div className="mt-4">
            <WarehouseForm mode="create" />
          </div>
        </section>
      ) : (
        <p className="rounded-2xl bg-slate-100 px-4 py-3 text-sm text-ink-700 ring-1 ring-slate-200">
          You can view warehouses, but creating or changing one needs{" "}
          <code>inventory.write</code>.
        </p>
      )}
    </div>
  );
}
