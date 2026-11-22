import type { Metadata } from "next";
import Link from "next/link";
import { InventoryNav } from "@/components/inventory/inventory-nav";
import { AdjustmentForm } from "@/components/inventory/adjustment-form";
import { requirePagePermission } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

export const metadata: Metadata = {
  title: "New adjustment",
  robots: { index: false, follow: false },
};

export default async function NewAdjustmentPage({
  searchParams,
}: {
  searchParams: Promise<{ variantId?: string; warehouseId?: string }>;
}) {
  await requirePagePermission("inventory.write");
  const params = await searchParams;

  const [warehouses, variants] = await Promise.all([
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
        <Link
          href="/inventory/adjustments"
          className="text-sm font-medium text-brand-700 hover:underline"
        >
          ← Adjustments
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">New stock adjustment</h1>
          <p className="mt-1 text-sm text-ink-500">
            ড্রাফট সংরক্ষণ করুন; ম্যানেজার অনুমোদন করলে স্টক ও লেজার পরিবর্তন হবে।
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
      ) : variantOptions.length === 0 ? (
        <div className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-800 ring-1 ring-amber-200">
          No stocked variants exist yet.{" "}
          <Link href="/products/new" className="font-semibold underline">
            Create a product
          </Link>{" "}
          with a stocked variant first.
        </div>
      ) : (
        <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <AdjustmentForm
            warehouses={warehouses}
            variants={variantOptions}
            defaultWarehouseId={defaultWarehouseId}
            defaultVariantId={defaultVariantId}
          />
        </section>
      )}
    </div>
  );
}
