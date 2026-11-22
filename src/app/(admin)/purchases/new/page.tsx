import type { Metadata } from "next";
import Link from "next/link";
import { PurchaseNav } from "@/components/purchasing/purchasing-nav";
import { PurchaseOrderForm } from "@/components/purchasing/purchase-order-form";
import { requirePagePermission } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

export const metadata: Metadata = {
  title: "New purchase order",
  robots: { index: false, follow: false },
};

export default async function NewPurchaseOrderPage() {
  await requirePagePermission("purchase.write");

  const [suppliers, warehouses, variants] = await Promise.all([
    prisma.supplier.findMany({
      where: { status: "ACTIVE" },
      orderBy: { name: "asc" },
      select: { id: true, code: true, name: true },
    }),
    prisma.warehouse.findMany({
      where: { isActive: true },
      orderBy: [{ isDefault: "desc" }, { code: "asc" }],
      select: { id: true, code: true, name: true },
    }),
    prisma.productVariant.findMany({
      where: {
        fulfillmentType: "STOCKED",
        status: "ACTIVE",
        product: { status: "ACTIVE" },
      },
      orderBy: [{ product: { name: "asc" } }, { name: "asc" }],
      take: 500,
      select: {
        id: true,
        sku: true,
        name: true,
        product: { select: { name: true } },
      },
    }),
  ]);

  return (
    <div className="space-y-5">
      <header className="space-y-3">
        <Link href="/purchases" className="text-sm font-medium text-brand-700 hover:underline">
          ← Purchase orders
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">New purchase order</h1>
          <p className="mt-1 text-sm text-ink-500">
            ড্রাফট অর্ডার তৈরি করুন। পরে পাঠিয়ে মাল গ্রহণ করবেন।
          </p>
        </div>
        <PurchaseNav />
      </header>

      {suppliers.length === 0 || warehouses.length === 0 ? (
        <div className="rounded-2xl bg-amber-50 p-4 text-sm leading-relaxed text-amber-900 ring-1 ring-amber-200">
          <p className="font-semibold">Add a supplier and an active warehouse first.</p>
          <p className="mt-1">
            A purchase order needs an active supplier and a warehouse to receive into.{" "}
            <Link href="/suppliers/new" className="font-medium underline">
              Add a supplier
            </Link>
            {" · "}
            <Link href="/inventory/warehouses" className="font-medium underline">
              Manage warehouses
            </Link>
          </p>
        </div>
      ) : variants.length === 0 ? (
        <div className="rounded-2xl bg-amber-50 p-4 text-sm leading-relaxed text-amber-900 ring-1 ring-amber-200">
          <p className="font-semibold">No stocked variants are available.</p>
          <p className="mt-1">
            Only active variants with the STOCKED fulfilment type can be ordered.{" "}
            <Link href="/products/new" className="font-medium underline">
              Add a product
            </Link>
          </p>
        </div>
      ) : (
        <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <PurchaseOrderForm
            suppliers={suppliers}
            warehouses={warehouses}
            variants={variants.map((variant) => ({
              id: variant.id,
              sku: variant.sku,
              label: `${variant.product.name} · ${variant.name}`,
            }))}
          />
        </section>
      )}
    </div>
  );
}
