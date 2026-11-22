import Link from "next/link";
import { formatMoney } from "@/lib/inventory/format";
import type { StorefrontProduct } from "@/lib/storefront/catalog";

export function ProductCard({ product }: { product: StorefrontProduct }) {
  const image = product.media[0];
  const onSale =
    product.compareAtPrice !== null && Number(product.compareAtPrice) > Number(product.price);

  return (
    <Link
      href={`/product/${product.slug}`}
      className="group flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white transition-shadow hover:shadow-md"
    >
      <div className="relative aspect-square overflow-hidden bg-slate-100">
        {image ? (
          // Originals are served untouched; next/image would re-encode them.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={image.url}
            alt={image.alt || product.name}
            width={image.width ?? 600}
            height={image.height ?? 600}
            loading="lazy"
            className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="grid size-full place-items-center text-3xl font-bold text-slate-300">
            {product.name.slice(0, 1)}
          </div>
        )}
        {!product.available ? (
          <span className="absolute left-2 top-2 rounded-full bg-slate-900/80 px-2.5 py-1 text-xs font-medium text-white">
            Out of stock
          </span>
        ) : onSale ? (
          <span className="absolute left-2 top-2 rounded-full bg-accent-500 px-2.5 py-1 text-xs font-medium text-white">
            Sale
          </span>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col gap-1 p-3">
        <p className="line-clamp-2 text-sm font-medium leading-snug text-ink-900">{product.name}</p>
        {product.nameBn ? (
          <p lang="bn" className="line-clamp-1 text-xs text-ink-500">
            {product.nameBn}
          </p>
        ) : null}
        <div className="mt-auto flex items-baseline gap-2 pt-2">
          <span className="text-base font-semibold text-brand-700">
            ৳{formatMoney(product.price)}
          </span>
          {onSale ? (
            <span className="text-xs text-slate-400 line-through">
              ৳{formatMoney(product.compareAtPrice)}
            </span>
          ) : null}
        </div>
      </div>
    </Link>
  );
}
