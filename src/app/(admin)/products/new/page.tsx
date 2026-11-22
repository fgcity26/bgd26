import type { Metadata } from "next";
import Link from "next/link";
import { requirePagePermission } from "@/lib/auth/session";
import { canViewCostPrices } from "@/lib/catalog/dto";
import { prisma } from "@/lib/db";
import { ProductForm } from "@/components/catalog/product-form";

export const metadata: Metadata = {
  title: "New product",
  robots: { index: false, follow: false },
};

export default async function NewProductPage() {
  const session = await requirePagePermission("product.write");
  const canViewCost = canViewCostPrices(session);

  const [categories, brands] = await Promise.all([
    prisma.category.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, nameBn: true },
    }),
    prisma.brand.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  return (
    <div className="space-y-5">
      <header>
        <Link href="/products" className="text-sm font-medium text-brand-700 hover:underline">
          ← Products
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">New product</h1>
        <p className="mt-1 text-sm text-ink-500">
          নতুন পণ্য যোগ করুন। প্রথমে ড্রাফট হিসেবে সেভ হবে, পরে প্রকাশ করবেন।
        </p>
      </header>

      {categories.length === 0 ? (
        <div className="rounded-2xl bg-amber-50 p-4 ring-1 ring-amber-200">
          <p className="text-sm font-semibold text-amber-900">Create a category first</p>
          <p className="mt-1 text-sm text-amber-800">
            Every product belongs to a category, because the category carries its VAT rate.
          </p>
          <Link
            href="/categories"
            className="mt-3 inline-flex min-h-11 items-center rounded-xl bg-amber-600 px-4 text-sm font-semibold text-white hover:bg-amber-700"
          >
            Go to categories · শ্রেণি
          </Link>
        </div>
      ) : (
        <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <ProductForm
            mode="create"
            categories={categories}
            brands={brands}
            canViewCost={canViewCost}
          />
        </section>
      )}
    </div>
  );
}
