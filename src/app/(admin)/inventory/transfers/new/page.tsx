import type { Metadata } from "next";
import Link from "next/link";
import { InventoryNav } from "@/components/inventory/inventory-nav";
import { TransferForm } from "@/components/inventory/transfer-form";
import { requirePagePermission } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

export const metadata: Metadata = {
  title: "New transfer",
  robots: { index: false, follow: false },
};

export default async function NewTransferPage() {
  await requirePagePermission("inventory.write");

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

  return (
    <div className="space-y-5">
      <header className="space-y-3">
        <Link
          href="/inventory/transfers"
          className="text-sm font-medium text-brand-700 hover:underline"
        >
          ← Transfers
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">New stock transfer</h1>
          <p className="mt-1 text-sm text-ink-500">
            ড্রাফট তৈরি করুন, তারপর পাঠান ও গ্রহণ করুন। দুই ধাপে স্টক সরানো হয়।
          </p>
        </div>
        <InventoryNav />
      </header>

      {warehouses.length < 2 ? (
        <div className="rounded-2xl bg-amber-50 p-4 text-sm leading-relaxed text-amber-800 ring-1 ring-amber-200">
          A transfer needs two active warehouses.{" "}
          <Link href="/inventory/warehouses" className="font-semibold underline">
            Create another warehouse
          </Link>{" "}
          first.
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
          <TransferForm warehouses={warehouses} variants={variantOptions} />
        </section>
      )}
    </div>
  );
}
