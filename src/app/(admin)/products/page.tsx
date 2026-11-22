import type { Metadata } from "next";
import Link from "next/link";
import { Prisma } from "@/generated/prisma/client";
import { hasPermission } from "@/lib/auth/permissions";
import { requirePagePermission } from "@/lib/auth/session";
import { canViewCostPrices } from "@/lib/catalog/dto";
import { prisma } from "@/lib/db";

export const metadata: Metadata = {
  title: "Products",
  robots: { index: false, follow: false },
};

const PAGE_SIZE = 20;

const STATUS_OPTIONS = [
  { value: "", label: "All (not archived)" },
  { value: "ACTIVE", label: "Active" },
  { value: "DRAFT", label: "Draft" },
  { value: "ARCHIVED", label: "Archived" },
] as const;

const dateFormat = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeZone: "Asia/Dhaka",
});

function statusStyle(status: string): string {
  if (status === "ACTIVE") return "bg-brand-50 text-brand-700 ring-brand-200";
  if (status === "ARCHIVED") return "bg-slate-100 text-ink-500 ring-slate-200";
  return "bg-amber-50 text-amber-800 ring-amber-200";
}

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; category?: string; page?: string }>;
}) {
  const session = await requirePagePermission("product.read");
  const canWrite = hasPermission(session, "product.write");
  const canViewCost = canViewCostPrices(session);

  const params = await searchParams;
  const query = params.q?.trim() ?? "";
  const status = STATUS_OPTIONS.some((option) => option.value === params.status)
    ? (params.status ?? "")
    : "";
  const categoryId = params.category ?? "";
  const page = Math.max(1, Number(params.page) || 1);

  const where: Prisma.ProductWhereInput = {
    ...(status ? { status: status as Prisma.EnumProductStatusFilter } : { status: { not: "ARCHIVED" } }),
    ...(categoryId ? { categoryId } : {}),
    ...(query
      ? {
          OR: [
            { name: { contains: query, mode: "insensitive" } },
            { nameBn: { contains: query, mode: "insensitive" } },
            { sku: { contains: query, mode: "insensitive" } },
            { slug: { contains: query, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [total, products, categories] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        name: true,
        nameBn: true,
        sku: true,
        status: true,
        isPublished: true,
        basePrice: true,
        costPrice: true,
        updatedAt: true,
        category: { select: { id: true, name: true, nameBn: true, vatPercentage: true } },
        _count: { select: { variants: true } },
        media: {
          where: { isPrimary: true },
          take: 1,
          select: {
            mediaAsset: {
              select: { storageKey: true, mimeType: true, width: true, height: true, altText: true },
            },
          },
        },
      },
    }),
    prisma.category.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true },
    }),
  ]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const linkFor = (nextPage: number) => {
    const search = new URLSearchParams();
    if (query) search.set("q", query);
    if (status) search.set("status", status);
    if (categoryId) search.set("category", categoryId);
    if (nextPage > 1) search.set("page", String(nextPage));
    const suffix = search.toString();
    return suffix ? `/products?${suffix}` : "/products";
  };

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Products</h1>
          <p className="mt-1 text-sm text-ink-500">
            পণ্যের তালিকা, দাম, ভ্যাট ও ছবি। ছবি কোনোভাবে পরিবর্তন করা হয় না।
          </p>
        </div>
        {canWrite ? (
          <Link
            href="/products/new"
            className="inline-flex min-h-11 items-center rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700"
          >
            New product · নতুন পণ্য
          </Link>
        ) : null}
      </header>

      <form method="get" className="grid gap-2 rounded-2xl bg-white p-3 ring-1 ring-slate-200 sm:grid-cols-[1fr_auto_auto_auto]">
        <input
          name="q"
          defaultValue={query}
          placeholder="Search name, Bangla name or SKU"
          className="min-h-11 rounded-xl border border-slate-300 px-3 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
        />
        <select
          name="status"
          defaultValue={status}
          className="min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm"
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <select
          name="category"
          defaultValue={categoryId}
          className="min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm"
        >
          <option value="">All categories</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="min-h-11 rounded-xl border border-slate-300 px-4 text-sm font-semibold text-ink-700 hover:border-brand-300 hover:text-brand-700"
        >
          Filter
        </button>
      </form>

      <p className="text-xs text-ink-500">
        {total} product{total === 1 ? "" : "s"} · page {page} of {pages}
      </p>

      {products.length === 0 ? (
        <div className="rounded-2xl bg-white p-6 text-center ring-1 ring-slate-200">
          <p className="text-sm font-medium text-ink-700">No products match these filters.</p>
          <p className="mt-1 text-sm text-ink-500">ফিল্টার বদলে আবার চেষ্টা করুন।</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {products.map((product) => {
            const image = product.media[0]?.mediaAsset;
            return (
              <li key={product.id} className="rounded-2xl bg-white ring-1 ring-slate-200">
                <Link
                  href={`/products/${product.id}`}
                  className="flex gap-3 p-3 transition-colors hover:bg-brand-50/40"
                >
                  <div className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-xl bg-slate-100">
                    {image ? (
                      // Originals are served untouched; explicit dimensions avoid layout shift.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={`/media/${image.storageKey}`}
                        alt={image.altText ?? product.name}
                        width={image.width ?? 160}
                        height={image.height ?? 160}
                        loading="lazy"
                        decoding="async"
                        className="size-full object-cover"
                      />
                    ) : (
                      <span className="text-xs text-ink-500">No image</span>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-ink-900">{product.name}</p>
                        {product.nameBn ? (
                          <p className="truncate text-xs text-ink-500">{product.nameBn}</p>
                        ) : null}
                      </div>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${statusStyle(product.status)}`}
                      >
                        {product.status}
                        {product.isPublished ? " · live" : ""}
                      </span>
                    </div>

                    <p className="mt-1 truncate text-xs text-ink-500">
                      {product.category.name}
                      {product.sku ? ` · ${product.sku}` : ""}
                      {` · ${product._count.variants} variant${product._count.variants === 1 ? "" : "s"}`}
                    </p>

                    <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <span className="text-sm font-semibold text-ink-900">৳{product.basePrice.toString()}</span>
                      <span className="text-xs text-ink-500">
                        incl. {product.category.vatPercentage.toString()}% VAT
                      </span>
                      {canViewCost && product.costPrice ? (
                        <span className="text-xs text-ink-500">
                          cost ৳{product.costPrice.toString()}
                        </span>
                      ) : null}
                      <span className="text-xs text-ink-500">
                        updated {dateFormat.format(product.updatedAt)}
                      </span>
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {pages > 1 ? (
        <nav className="flex items-center justify-between gap-3" aria-label="Pagination">
          {page > 1 ? (
            <Link
              href={linkFor(page - 1)}
              className="inline-flex min-h-11 items-center rounded-xl border border-slate-300 px-4 text-sm font-medium text-ink-700 hover:border-brand-300"
            >
              Previous
            </Link>
          ) : (
            <span />
          )}
          {page < pages ? (
            <Link
              href={linkFor(page + 1)}
              className="inline-flex min-h-11 items-center rounded-xl border border-slate-300 px-4 text-sm font-medium text-ink-700 hover:border-brand-300"
            >
              Next
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </div>
  );
}
