import type { Metadata } from "next";
import Link from "next/link";
import { CartLineControls } from "@/components/storefront/cart-line-controls";
import { CouponForm } from "@/components/storefront/coupon-form";
import { formatMoney } from "@/lib/inventory/format";
import { getCartView } from "@/lib/storefront/cart";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your cart",
  robots: { index: false, follow: false },
};

export default async function CartPage() {
  const cart = await getCartView();

  if (!cart || cart.lines.length === 0) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl border border-dashed border-slate-300 px-6 py-14 text-center">
        <h1 className="text-xl font-semibold">Your cart is empty</h1>
        <p className="mt-2 text-sm text-ink-500">Add something you like and come back here.</p>
        <Link
          href="/shop"
          className="mt-5 inline-flex min-h-11 items-center rounded-xl bg-brand-600 px-5 text-sm font-semibold text-white hover:bg-brand-700"
        >
          Browse products
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Your cart</h1>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <section className="space-y-3">
          {cart.lines.map((line) => (
            <article
              key={line.itemId}
              className="flex gap-3 rounded-2xl border border-slate-200 p-3 sm:p-4"
            >
              <Link
                href={`/product/${line.productSlug}`}
                className="size-20 shrink-0 overflow-hidden rounded-xl bg-slate-100 sm:size-24"
              >
                {line.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={line.imageUrl}
                    alt={line.productName}
                    width={200}
                    height={200}
                    className="size-full object-cover"
                  />
                ) : (
                  <span className="grid size-full place-items-center text-2xl font-bold text-slate-300">
                    {line.productName.slice(0, 1)}
                  </span>
                )}
              </Link>

              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link
                      href={`/product/${line.productSlug}`}
                      className="block truncate text-sm font-medium text-ink-900 hover:text-brand-700"
                    >
                      {line.productName}
                    </Link>
                    <p className="text-xs text-ink-500">{line.variantName}</p>
                    <p className="mt-1 text-xs text-ink-500">
                      ৳{formatMoney(line.unitPrice)} each
                    </p>
                  </div>
                  <p className="shrink-0 text-sm font-semibold">৳{formatMoney(line.lineTotal)}</p>
                </div>

                {!line.available ? (
                  <p className="mt-2 rounded-lg bg-red-50 px-2 py-1 text-xs text-red-700">
                    This option is out of stock. Remove it or choose another option.
                  </p>
                ) : null}

                <div className="mt-3">
                  <CartLineControls
                    itemId={line.itemId}
                    quantity={line.quantity}
                    maxQuantity={line.maxQuantity}
                  />
                </div>
              </div>
            </article>
          ))}

          <Link href="/shop" className="inline-flex text-sm font-medium text-brand-700 hover:underline">
            ← Continue shopping
          </Link>
        </section>

        <aside className="h-fit space-y-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 lg:sticky lg:top-24">
          <CouponForm appliedCode={cart.coupon?.code ?? null} notice={cart.couponNotice} />

          <dl className="space-y-1.5 border-t border-slate-200 pt-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-ink-500">Merchandise</dt>
              <dd>৳{formatMoney(cart.merchandiseTotal)}</dd>
            </div>
            {Number(cart.couponDiscount) > 0 ? (
              <div className="flex justify-between text-brand-700">
                <dt>Coupon {cart.coupon?.code}</dt>
                <dd>−৳{formatMoney(cart.couponDiscount)}</dd>
              </div>
            ) : null}
            {cart.coupon?.freeShipping ? (
              <div className="flex justify-between text-brand-700">
                <dt>Free delivery</dt>
                <dd>Applied at checkout</dd>
              </div>
            ) : null}
            <div className="flex justify-between">
              <dt className="text-ink-500">Delivery</dt>
              <dd className="text-ink-500">Calculated at checkout</dd>
            </div>
            <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-semibold">
              <dt>Total</dt>
              <dd>৳{formatMoney(cart.grandTotal)}</dd>
            </div>
          </dl>

          <Link
            href="/checkout"
            className="flex min-h-12 items-center justify-center rounded-xl bg-brand-600 px-5 text-sm font-semibold text-white hover:bg-brand-700"
          >
            Go to checkout
          </Link>
          <p className="text-xs text-ink-500">
            Delivery is added at checkout based on your district.
          </p>
        </aside>
      </div>
    </div>
  );
}
