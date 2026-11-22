import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AddToCartForm } from "@/components/storefront/add-to-cart-form";
import { ProductCard } from "@/components/storefront/product-card";
import { formatMoney } from "@/lib/inventory/format";
import { getPublicProduct, listPublicProducts } from "@/lib/storefront/catalog";

export const revalidate = 120;

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const product = await getPublicProduct(slug);
  if (!product) return { title: "Product not found", robots: { index: false, follow: false } };

  const image = product.media[0]?.url;
  return {
    title: product.name,
    description: product.shortDescription ?? product.description?.slice(0, 160) ?? undefined,
    alternates: { canonical: `/product/${product.slug}` },
    openGraph: {
      title: product.name,
      description: product.shortDescription ?? undefined,
      type: "website",
      images: image ? [{ url: image }] : undefined,
    },
  };
}

export default async function ProductPage({ params }: Params) {
  const { slug } = await params;
  const product = await getPublicProduct(slug);
  if (!product) notFound();

  const related = await listPublicProducts({ category: product.category.slug, pageSize: 5 });
  const relatedProducts = related.products.filter((entry) => entry.id !== product.id).slice(0, 4);
  const onSale =
    product.compareAtPrice !== null && Number(product.compareAtPrice) > Number(product.price);

  return (
    <div className="space-y-10">
      <nav className="text-sm text-ink-500">
        <Link href="/" className="hover:text-brand-700">
          Home
        </Link>
        <span className="mx-1.5">/</span>
        <Link href="/shop" className="hover:text-brand-700">
          Shop
        </Link>
        <span className="mx-1.5">/</span>
        <Link
          href={`/shop?category=${encodeURIComponent(product.category.slug)}`}
          className="hover:text-brand-700"
        >
          {product.category.name}
        </Link>
      </nav>

      <div className="grid gap-6 lg:grid-cols-2 lg:gap-10">
        <div className="space-y-3">
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-100">
            {product.media[0] ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={product.media[0].url}
                alt={product.media[0].alt || product.name}
                width={product.media[0].width ?? 900}
                height={product.media[0].height ?? 900}
                className="aspect-square w-full object-cover"
              />
            ) : (
              <div className="grid aspect-square place-items-center text-6xl font-bold text-slate-300">
                {product.name.slice(0, 1)}
              </div>
            )}
          </div>
          {product.media.length > 1 ? (
            <div className="grid grid-cols-4 gap-2">
              {product.media.slice(1, 5).map((image) => (
                <div
                  key={image.url}
                  className="overflow-hidden rounded-xl border border-slate-200 bg-slate-100"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={image.url}
                    alt={image.alt || product.name}
                    width={image.width ?? 300}
                    height={image.height ?? 300}
                    loading="lazy"
                    className="aspect-square w-full object-cover"
                  />
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/shop?category=${encodeURIComponent(product.category.slug)}`}
              className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-ink-700 hover:bg-brand-50 hover:text-brand-700"
            >
              {product.category.name}
            </Link>
            {product.isCustomizable ? (
              <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800">
                Customizable
              </span>
            ) : null}
          </div>

          <h1 className="mt-3 text-2xl font-bold tracking-tight sm:text-3xl">{product.name}</h1>
          {product.nameBn ? (
            <p lang="bn" className="mt-1 text-base text-ink-500">
              {product.nameBn}
            </p>
          ) : null}

          {product.ratingCount > 0 ? (
            <p className="mt-2 text-sm text-ink-500">
              ★ {Number(product.ratingAverage).toFixed(1)} · {product.ratingCount} review
              {product.ratingCount === 1 ? "" : "s"}
            </p>
          ) : null}

          <div className="mt-4 flex items-baseline gap-3">
            <span className="text-2xl font-bold text-brand-700">
              ৳{formatMoney(product.price)}
            </span>
            {onSale ? (
              <span className="text-base text-slate-400 line-through">
                ৳{formatMoney(product.compareAtPrice)}
              </span>
            ) : null}
            <span className="text-xs text-ink-500">incl. VAT</span>
          </div>

          <p className="mt-2 text-sm">
            {product.available ? (
              <span className="font-medium text-brand-700">In stock</span>
            ) : (
              <span className="font-medium text-red-700">Out of stock</span>
            )}
            {product.brand ? (
              <span className="text-ink-500"> · {product.brand.name}</span>
            ) : null}
          </p>

          {product.shortDescription ? (
            <p className="mt-4 text-sm leading-relaxed text-ink-700">{product.shortDescription}</p>
          ) : null}

          <div className="mt-5 rounded-2xl border border-slate-200 p-4">
            <AddToCartForm
              productName={product.name}
              variants={product.variants.map((variant) => ({
                id: variant.id,
                name: variant.name,
                price: variant.price,
                available: variant.available,
                maxQuantity: variant.fulfillmentType === "STOCKED" ? variant.availableQty : null,
              }))}
            />
          </div>

          <ul className="mt-5 space-y-2 text-sm text-ink-700">
            <li>Cash on delivery across Bangladesh.</li>
            <li>bKash and Nagad accepted; verified before dispatch.</li>
            <li>Delivery charge depends on your district and is shown at checkout.</li>
          </ul>
        </div>
      </div>

      {product.description || product.descriptionBn ? (
        <section className="max-w-3xl border-t border-slate-200 pt-6">
          <h2 className="text-lg font-semibold">Product details</h2>
          {product.description ? (
            <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-ink-700">
              {product.description}
            </p>
          ) : null}
          {product.descriptionBn ? (
            <p
              lang="bn"
              className="mt-4 whitespace-pre-line border-t border-slate-100 pt-4 text-sm leading-relaxed text-ink-700"
            >
              {product.descriptionBn}
            </p>
          ) : null}
        </section>
      ) : null}

      {relatedProducts.length > 0 ? (
        <section className="border-t border-slate-200 pt-6">
          <h2 className="text-lg font-semibold">More in {product.category.name}</h2>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {relatedProducts.map((entry) => (
              <ProductCard key={entry.id} product={entry} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
