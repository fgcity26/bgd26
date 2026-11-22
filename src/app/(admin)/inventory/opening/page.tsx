import type { Metadata } from "next";
import Link from "next/link";
import { InventoryNav } from "@/components/inventory/inventory-nav";
import { OpeningStockForm } from "@/components/inventory/opening-stock-form";
import { requirePagePermission } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { formatCost, formatMoney, formatQty } from "@/lib/inventory/format";

export const metadata: Metadata = {
  title: "Opening stock",
  robots: { index: false, follow: false },
};

const dateTime = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Dhaka",
});

export default async function OpeningStockPage({
  searchParams,
}: {
  searchParams: Promise<{ variantId?: string; warehouseId?: string }>;
}) {
  await requirePagePermission("inventory.approve");
  const params = await searchParams;

  const [warehouses, variants, recent] = await Promise.all([
    prisma.warehouse.findMany({
      where: { isActive: true },
      orderBy: [{ isDefault: "desc" }, { code: "asc" }],
      select: { id: true, code: true, name: true },
    }),
    prisma.productVariant.findMany({
      where: { fulfillmentType: "STOCKED" },
      orderBy: { sku: "asc" },
      take: 500,
      select: {
        id: true,
        sku: true,
        name: true,
        product: { select: { name: true } },
      },
    }),
    prisma.stockLedger.findMany({
      where: { movementType: "OPENING_BALANCE" },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: {
        warehouse: { select: { code: true, name: true } },
        variant: {
          select: { sku: true, name: true, product: { select: { name: true } } },
        },
        createdBy: { select: { fullName: true } },
      },
    }),
  ]);

  const variantOptions = variants.map((variant) => ({
    id: variant.id,
    sku: variant.sku,
    label: `${variant.product.name} — ${variant.name}`,
  }));

  const defaultVariantId = variantOptions.some((option) => option.id === params.variantId)
    ? (params.variantId ?? "")
    : "";
  const defaultWarehouseId = warehouses.some((warehouse) => warehouse.id === params.warehouseId)
    ? (params.warehouseId ?? "")
    : "";

  return (
    <div className="space-y-5">
      <header className="space-y-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Opening stock</h1>
          <p className="mt-1 text-sm text-ink-500">
            প্রথম স্টক এন্ট্রি। এটি AVCO নির্ধারণ করে এবং লেজারে স্থায়ীভাবে লেখা হয়।
          </p>
        </div>
        <InventoryNav />
      </header>

      {warehouses.length === 0 ? (
        <div className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-800 ring-1 ring-amber-200">
          Create and activate a warehouse first.{" "}
          <Link href="/inventory/warehouses" className="font-semibold underline">
            Go to warehouses
          </Link>
          .
        </div>
      ) : variants.length === 0 ? (
        <div className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-800 ring-1 ring-amber-200">
          No stocked variants exist yet.{" "}
          <Link href="/products/new" className="font-semibold underline">
            Create a product
          </Link>{" "}
          with a stocked variant first.
        </div>
      ) : (
        <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <h2 className="text-base font-semibold">Post opening stock</h2>
          <p className="mt-1 text-sm text-ink-500">
            Use the physical count and the landed cost per unit. The entry posts immediately and
            cannot be edited; a mistake is corrected with an adjustment.
          </p>
          <div className="mt-4">
            <OpeningStockForm
              warehouses={warehouses}
              variants={variantOptions}
              defaultWarehouseId={defaultWarehouseId}
              defaultVariantId={defaultVariantId}
            />
          </div>
        </section>
      )}

      <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold">Recent opening entries</h2>
          <p className="text-xs text-ink-500">Last 20 · ledger rows are never edited</p>
        </div>

        {recent.length === 0 ? (
          <p className="mt-3 rounded-xl bg-slate-50 px-3 py-4 text-sm text-ink-500">
            No opening stock has been posted yet.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100">
            {recent.map((entry) => (
              <li key={entry.id} className="py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink-900">
                      {entry.variant.product.name} · {entry.variant.name}
                    </p>
                    <p className="mt-1 text-xs text-ink-500">
                      {entry.variant.sku} · {entry.warehouse.code} ·{" "}
                      {dateTime.format(entry.createdAt)}
                      {entry.createdBy ? ` · ${entry.createdBy.fullName}` : ""}
                    </p>
                  </div>
                  <div className="text-right text-sm">
                    <p className="font-semibold text-brand-700">+{formatQty(entry.quantity)}</p>
                    <p className="text-xs text-ink-500">
                      ৳{formatCost(entry.unitCost)}/unit · ৳{formatMoney(entry.totalValue)}
                    </p>
                  </div>
                </div>
                {entry.referenceType === "stock_adjustment" ? (
                  <Link
                    href={`/inventory/adjustments/${entry.referenceId}`}
                    className="mt-1 inline-block text-xs font-medium text-brand-700 hover:underline"
                  >
                    Open document →
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
