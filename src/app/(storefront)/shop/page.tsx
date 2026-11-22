import type { Metadata } from "next";
import Link from "next/link";
import { ProductCard } from "@/components/storefront/product-card";
import { listPublicCategories, listPublicProducts } from "@/lib/storefront/catalog";

export const metadata: Metadata = {
  title: "Shop",
  description: "Browse every product available for delivery across Bangladesh.",
  alternates: { canonical: "/shop" },
};

type SearchParams = {
  category?: string;
  q?: string;
  sort?: string;
  page?: string;
};

const SORTS = [
  { value: "newest", label: "Newest" },
  { value: "featured", label: "Featured" },
  { value: "price-asc", label: "Price: low to high" },
  { value: "price-desc", label: "Price: high to low" },
] as const;

function queryString(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") continue;
    search.set(key, String(value));
  }
  const value = search.toString();
  return value ? `?${value}` : "";
}

export default async function ShopPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const category = params.category?.trim() || "";
  const search = params.q?.trim() || "";
  const sort = SORTS.some((entry) => entry.value === params.sort)
    ? (params.sort as (typeof SORTS)[number]["value"])
    : "newest";
  const page = Math.max(1, Number(params.page ?? "1") || 1);

  const [categories, result] = await Promise.all([
    listPublicCategories(),
    listPublicProducts({ category, search, sort, page }),
  ]);

  const activeCategory = categories.find((entry) => entry.slug === category);

  return (
    <div className="space-y-6">
      <nav className="text-sm text-ink-500">
        <Link href="/" className="hover:text-brand-700">
          Home
        </Link>
        <span className="mx-1.5">/</span>
        <span className="text-ink-700">{activeCategory ? activeCategory.name : "Shop"}</span>
      </nav>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {activeCategory ? activeCategory.name : "All products"}
          </h1>
          <p className="mt-1 text-sm text-ink-500">
            {result.total} item{result.total === 1 ? "" : "s"}
            {search ? ` matching “${search}”` : ""}
          </p>
        </div>

        <form className="flex flex-wrap items-end gap-2" method="get">
          <label className="block text-sm">
            <span className="mb-1 block text-xs font-medium text-ink-500">Search</span>
            <input
              name="q"
              defaultValue={search}
              placeholder="Product name"
              className="min-h-10 w-44 rounded-xl border border-slate-300 px-3 text-sm"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-xs font-medium text-ink-500">Category</span>
            <select
              name="category"
              defaultValue={category}
              className="min-h-10 rounded-xl border border-slate-300 bg-white px-3 text-sm"
            >
              <option value="">All</option>
              {categories.map((entry) => (
                <option key={entry.slug} value={entry.slug}>
                  {entry.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-xs font-medium text-ink-500">Sort</span>
            <select
              name="sort"
              defaultValue={sort}
              className="min-h-10 rounded-xl border border-slate-300 bg-white px-3 text-sm"
            >
              {SORTS.map((entry) => (
                <option key={entry.value} value={entry.value}>
                  {entry.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            className="min-h-10 rounded-xl bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700"
          >
            Filter
          </button>
        </form>
      </div>

      <div className="flex flex-wrap gap-2">
        <Link
          href={`/shop${queryString({ q: search, sort })}`}
          className={`rounded-full px-3 py-1.5 text-sm font-medium ${
            category ? "bg-slate-100 text-ink-700" : "bg-brand-600 text-white"
          }`}
        >
          All
        </Link>
        {categories.map((entry) => (
          <Link
            key={entry.slug}
            href={`/shop${queryString({ category: entry.slug, q: search, sort })}`}
            className={`rounded-full px-3 py-1.5 text-sm font-medium ${
              entry.slug === category ? "bg-brand-600 text-white" : "bg-slate-100 text-ink-700"
            }`}
          >
            {entry.name}
          </Link>
        ))}
      </div>

      {result.products.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-14 text-center">
          <p className="text-sm font-medium text-ink-700">No products found.</p>
          <p className="mt-1 text-sm text-ink-500">Try another category or search term.</p>
          <Link
            href="/shop"
            className="mt-4 inline-flex min-h-10 items-center rounded-xl border border-slate-300 px-4 text-sm font-medium text-ink-700 hover:border-brand-300 hover:text-brand-700"
          >
            Clear filters
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {result.products.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      )}

      {result.pages > 1 ? (
        <nav className="flex items-center justify-center gap-2 pt-2" aria-label="Pagination">
          {result.page > 1 ? (
            <Link
              href={`/shop${queryString({ category, q: search, sort, page: result.page - 1 })}`}
              className="min-h-10 rounded-xl border border-slate-300 px-4 text-sm font-medium leading-10 text-ink-700 hover:border-brand-300"
            >
              Previous
            </Link>
          ) : null}
          <span className="px-2 text-sm text-ink-500">
            Page {result.page} of {result.pages}
          </span>
          {result.page < result.pages ? (
            <Link
              href={`/shop${queryString({ category, q: search, sort, page: result.page + 1 })}`}
              className="min-h-10 rounded-xl border border-slate-300 px-4 text-sm font-medium leading-10 text-ink-700 hover:border-brand-300"
            >
              Next
            </Link>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}
