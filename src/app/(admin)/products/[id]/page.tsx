import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  archiveProductAction,
  archiveVariantAction,
  setProductPublishedAction,
} from "@/app/actions/products";
import {
  removeProductMediaAction,
  setPrimaryProductMediaAction,
} from "@/app/actions/media";
import { ProductForm } from "@/components/catalog/product-form";
import { MediaUploadForm } from "@/components/catalog/media-upload-form";
import { VariantForm } from "@/components/catalog/variant-form";
import { hasPermission } from "@/lib/auth/permissions";
import { requirePagePermission } from "@/lib/auth/session";
import { canViewCostPrices, toProductView } from "@/lib/catalog/dto";
import { prisma } from "@/lib/db";

export const metadata: Metadata = {
  title: "Product",
  robots: { index: false, follow: false },
};

const dateFormat = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Dhaka",
});

function statusStyle(status: string): string {
  if (status === "ACTIVE") return "bg-brand-50 text-brand-700 ring-brand-200";
  if (status === "ARCHIVED") return "bg-slate-100 text-ink-500 ring-slate-200";
  return "bg-amber-50 text-amber-800 ring-amber-200";
}

function bytesLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requirePagePermission("product.read");
  const { id } = await params;

  const product = await prisma.product.findUnique({
    where: { id },
    include: {
      category: {
        select: { id: true, name: true, nameBn: true, slug: true, vatPercentage: true },
      },
      brand: { select: { id: true, name: true, slug: true } },
      variants: true,
      media: { include: { mediaAsset: true } },
    },
  });

  if (!product) notFound();

  const canViewCost = canViewCostPrices(session);
  const canWrite = hasPermission(session, "product.write");
  const canPublish = hasPermission(session, "product.publish");
  const canArchive = hasPermission(session, "product.delete");
  const view = toProductView(product, { canViewCost });
  const archived = view.status === "ARCHIVED" || view.archivedAt !== null;

  const [categories, brands] = canWrite && !archived
    ? await Promise.all([
        prisma.category.findMany({
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
          select: { id: true, name: true, nameBn: true },
        }),
        prisma.brand.findMany({
          where: { isActive: true },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        }),
      ])
    : [[], []];

  return (
    <div className="space-y-5">
      <header className="space-y-3">
        <Link href="/products" className="text-sm font-medium text-brand-700 hover:underline">
          ← Products
        </Link>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight">{view.name}</h1>
              <span className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${statusStyle(view.status)}`}>
                {view.status}
                {view.isPublished ? " · live" : " · not live"}
              </span>
            </div>
            {view.nameBn ? <p className="mt-1 text-sm text-ink-500">{view.nameBn}</p> : null}
            <p className="mt-1 text-xs text-ink-500">
              {view.category.name} · {view.sku ?? "No SKU"} · updated {dateFormat.format(view.updatedAt)}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {canPublish && !archived ? (
              <form action={setProductPublishedAction}>
                <input type="hidden" name="id" value={view.id} />
                <input type="hidden" name="publish" value={view.isPublished ? "false" : "true"} />
                <button
                  type="submit"
                  className="min-h-11 rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700"
                >
                  {view.isPublished ? "Unpublish" : "Publish"}
                </button>
              </form>
            ) : null}
            {canArchive && !archived ? (
              <form action={archiveProductAction}>
                <input type="hidden" name="id" value={view.id} />
                <button
                  type="submit"
                  className="min-h-11 rounded-xl border border-red-300 px-4 text-sm font-semibold text-red-700 hover:bg-red-50"
                >
                  Archive
                </button>
              </form>
            ) : null}
          </div>
        </div>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Selling price</p>
          <p className="mt-1 text-lg font-semibold">৳{view.basePrice}</p>
          <p className="mt-1 text-xs text-ink-500">
            Includes {view.category.vatPercentage}% VAT
          </p>
        </div>
        <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Compare at</p>
          <p className="mt-1 text-lg font-semibold">
            {view.compareAtPrice ? `৳${view.compareAtPrice}` : "—"}
          </p>
          <p className="mt-1 text-xs text-ink-500">Shown struck through on the storefront</p>
        </div>
        <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Type</p>
          <p className="mt-1 text-lg font-semibold">{view.productType}</p>
          <p className="mt-1 text-xs text-ink-500">{view.variants.length} variant(s)</p>
        </div>
        {canViewCost ? (
          <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
            <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Cost price</p>
            <p className="mt-1 text-lg font-semibold">
              {view.costPrice ? `৳${view.costPrice}` : "Not set"}
            </p>
            <p className="mt-1 text-xs text-ink-500">Visible to accounts/reports roles only</p>
          </div>
        ) : null}
      </section>

      <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold">Gallery</h2>
          <p className="text-xs text-ink-500">
            {view.media.length} image(s) · original bytes · SHA-256 verified
          </p>
        </div>

        {view.media.length === 0 ? (
          <p className="mt-3 rounded-xl bg-slate-50 px-3 py-4 text-sm text-ink-500">
            No images yet. Upload the photographer&apos;s original files — nothing is resized.
          </p>
        ) : (
          <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {view.media.map((image) => (
              <li key={image.productMediaId} className="overflow-hidden rounded-xl ring-1 ring-slate-200">
                <div className="grid aspect-[4/3] place-items-center bg-slate-100">
                  {/* Zero-transform rule: plain <img>, no optimizer, explicit dimensions. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={image.url}
                    alt={image.altText ?? view.name}
                    width={image.width ?? 800}
                    height={image.height ?? 600}
                    loading="lazy"
                    decoding="async"
                    className="max-h-full w-auto max-w-full object-contain"
                  />
                </div>
                <div className="space-y-2 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    {image.isPrimary ? (
                      <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700 ring-1 ring-brand-200">
                        Primary
                      </span>
                    ) : null}
                    <span className="text-xs text-ink-500">
                      {image.width && image.height ? `${image.width}×${image.height} · ` : ""}
                      {bytesLabel(image.byteSize)}
                    </span>
                  </div>
                  <p className="break-all font-mono text-[10px] text-ink-500">
                    sha256 {image.sha256.slice(0, 16)}…
                  </p>
                  {canWrite && !archived ? (
                    <div className="flex flex-wrap gap-2">
                      {!image.isPrimary ? (
                        <form action={setPrimaryProductMediaAction}>
                          <input type="hidden" name="id" value={image.productMediaId} />
                          <input type="hidden" name="productId" value={view.id} />
                          <button
                            type="submit"
                            className="min-h-9 rounded-lg border border-slate-300 px-3 text-xs font-medium text-ink-700 hover:border-brand-300"
                          >
                            Make primary
                          </button>
                        </form>
                      ) : null}
                      <form action={removeProductMediaAction}>
                        <input type="hidden" name="id" value={image.productMediaId} />
                        <input type="hidden" name="productId" value={view.id} />
                        <button
                          type="submit"
                          className="min-h-9 rounded-lg border border-red-200 px-3 text-xs font-medium text-red-700 hover:bg-red-50"
                        >
                          Remove
                        </button>
                      </form>
                    </div>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}

        {canWrite && !archived ? (
          <div className="mt-4 border-t border-slate-200 pt-4">
            <MediaUploadForm productId={view.id} variants={view.variants} />
          </div>
        ) : null}
      </section>

      <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
        <h2 className="text-base font-semibold">Variants</h2>
        <ul className="mt-3 divide-y divide-slate-100">
          {view.variants.map((variant) => (
            <li key={variant.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink-900">
                  {variant.name}
                  {variant.isDefault ? (
                    <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-ink-500">
                      default
                    </span>
                  ) : null}
                </p>
                <p className="text-xs text-ink-500">
                  {variant.sku} · {variant.fulfillmentType} · ৳{variant.price}
                  {canViewCost && variant.costPrice ? ` · cost ৳${variant.costPrice}` : ""}
                  {variant.status !== "ACTIVE" ? ` · ${variant.status}` : ""}
                </p>
              </div>
              {canWrite && !archived && !variant.isDefault && variant.status === "ACTIVE" ? (
                <form action={archiveVariantAction}>
                  <input type="hidden" name="id" value={variant.id} />
                  <input type="hidden" name="productId" value={view.id} />
                  <button
                    type="submit"
                    className="min-h-9 rounded-lg border border-slate-300 px-3 text-xs font-medium text-ink-700 hover:border-red-300 hover:text-red-700"
                  >
                    Archive
                  </button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>

        {canWrite && !archived ? (
          <div className="mt-4 border-t border-slate-200 pt-4">
            <h3 className="text-sm font-semibold text-ink-700">Add a variant</h3>
            <div className="mt-3">
              <VariantForm productId={view.id} canViewCost={canViewCost} />
            </div>
          </div>
        ) : null}
      </section>

      {view.shortDescription || view.description || view.descriptionBn ? (
        <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <h2 className="text-base font-semibold">Copy</h2>
          {view.shortDescription ? (
            <p className="mt-2 text-sm text-ink-700">{view.shortDescription}</p>
          ) : null}
          {view.description ? (
            <p className="mt-2 whitespace-pre-line text-sm text-ink-700">{view.description}</p>
          ) : null}
          {view.descriptionBn ? (
            <p className="mt-2 whitespace-pre-line text-sm text-ink-700">{view.descriptionBn}</p>
          ) : null}
        </section>
      ) : null}

      {canWrite && !archived ? (
        <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <h2 className="text-base font-semibold">Edit product</h2>
          <div className="mt-3">
            <ProductForm
              mode="edit"
              product={view}
              categories={categories}
              brands={brands}
              canViewCost={canViewCost}
            />
          </div>
        </section>
      ) : null}
    </div>
  );
}
