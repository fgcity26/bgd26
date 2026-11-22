import type { Metadata } from "next";
import Link from "next/link";
import { ProductCard } from "@/components/storefront/product-card";
import { getStorefrontHome } from "@/lib/storefront/catalog";

export const revalidate = 120;

export const metadata: Metadata = {
  title: "bgd26 — Shop online, pay cash on delivery",
  description:
    "Shop gadgets, custom gifts, home essentials and more. Cash on delivery across Bangladesh, with bKash and Nagad verification.",
  alternates: { canonical: "/" },
};

export default async function StorefrontHome() {
  const { categories, featured, latest } = await getStorefrontHome();
  const highlighted = featured.length > 0 ? featured : latest;

  return (
    <div className="space-y-10">
      <section className="overflow-hidden rounded-3xl bg-brand-700 text-white">
        <div className="grid gap-6 px-5 py-8 sm:px-8 sm:py-12 lg:grid-cols-[1.2fr_0.8fr] lg:items-center">
          <div>
            <p className="text-sm font-medium text-brand-200">বাংলাদেশে ডেলিভারি</p>
            <h1 className="mt-2 text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
              Everyday things, delivered to your door.
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-brand-100">
              Order online and pay cash when the parcel arrives. bKash and Nagad are also
              accepted — every transaction is checked before dispatch.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <Link
                href="/shop"
                className="inline-flex min-h-11 items-center rounded-xl bg-white px-5 text-sm font-semibold text-brand-800 hover:bg-brand-50"
              >
                Start shopping
              </Link>
              <Link
                href="/track"
                className="inline-flex min-h-11 items-center rounded-xl border border-brand-300 px-5 text-sm font-semibold text-white hover:bg-brand-600"
              >
                Track an order
              </Link>
            </div>
          </div>
          <ul className="grid gap-2 text-sm text-brand-100 sm:grid-cols-2 lg:grid-cols-1">
            <li className="rounded-xl bg-brand-800/60 px-3 py-2">Cash on delivery</li>
            <li className="rounded-xl bg-brand-800/60 px-3 py-2">bKash · Nagad</li>
            <li className="rounded-xl bg-brand-800/60 px-3 py-2">Dhaka and all divisions</li>
            <li className="rounded-xl bg-brand-800/60 px-3 py-2">Order updates by mobile</li>
          </ul>
        </div>
      </section>

      {categories.length > 0 ? (
        <section>
          <div className="flex items-end justify-between gap-3">
            <h2 className="text-xl font-semibold tracking-tight">Shop by category</h2>
            <Link href="/shop" className="text-sm font-medium text-brand-700 hover:underline">
              View all
            </Link>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {categories.map((category) => (
              <Link
                key={category.slug}
                href={`/shop?category=${encodeURIComponent(category.slug)}`}
                className="rounded-2xl border border-slate-200 p-3 transition-colors hover:border-brand-300 hover:bg-brand-50"
              >
                <p className="text-sm font-medium text-ink-900">{category.name}</p>
                <p lang="bn" className="mt-0.5 text-xs text-ink-500">
                  {category.nameBn}
                </p>
                <p className="mt-2 text-xs text-ink-500">{category.productCount} items</p>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <section>
        <div className="flex items-end justify-between gap-3">
          <h2 className="text-xl font-semibold tracking-tight">
            {featured.length > 0 ? "Featured" : "New arrivals"}
          </h2>
          <Link href="/shop" className="text-sm font-medium text-brand-700 hover:underline">
            See everything
          </Link>
        </div>
        {highlighted.length === 0 ? (
          <p className="mt-4 rounded-2xl border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-ink-500">
            Products are being added. Please check back soon.
          </p>
        ) : (
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {highlighted.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        )}
      </section>

      {latest.length > 0 && featured.length > 0 ? (
        <section>
          <div className="flex items-end justify-between gap-3">
            <h2 className="text-xl font-semibold tracking-tight">New arrivals</h2>
            <Link href="/shop?sort=newest" className="text-sm font-medium text-brand-700 hover:underline">
              More new items
            </Link>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {latest.slice(0, 4).map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
