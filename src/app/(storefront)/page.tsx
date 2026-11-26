import type { Metadata } from "next";
import Link from "next/link";
import { HomeBanners } from "@/components/storefront/home-banners";
import { ProductCard } from "@/components/storefront/product-card";
import { getStorefrontHome } from "@/lib/storefront/catalog";
import { buildCarouselSlides, getActiveBanners } from "@/lib/storefront/banners";
import { getHomeContent } from "@/lib/storefront/home-content";

export const revalidate = 120;

export const metadata: Metadata = {
  title: "bgd26 — Shop online, pay cash on delivery",
  description:
    "Shop gadgets, custom gifts, home essentials and more. Cash on delivery across Bangladesh, with bKash and Nagad verification.",
  alternates: { canonical: "/" },
};

export default async function StorefrontHome() {
  const [{ categories, featured, latest }, content, banners] = await Promise.all([
    getStorefrontHome(),
    getHomeContent(),
    getActiveBanners(),
  ]);
  const highlighted = featured.length > 0 ? featured : latest;
  const slides = buildCarouselSlides(content, banners, content.heroImage);

  return (
    <div className="space-y-10">
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

      {/* Products first, story last: on a phone the catalogue is one thumb away.
          Up to six banner slides rotate here; the copy of slide one and the
          extra banners are edited at /storefront. */}
      <HomeBanners slides={slides} bullets={content.bullets} />
    </div>
  );
}
