import Link from "next/link";
import { CartBadge } from "@/components/storefront/cart-badge";

/**
 * Public storefront shell. No session is read here, so the catalogue can be
 * cached; the only personalised element (the cart badge) asks an API route.
 */
export default function StorefrontLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="min-h-dvh bg-white">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link href="/" className="flex items-center gap-2">
            <span
              aria-hidden
              className="grid size-9 place-items-center rounded-xl bg-brand-600 text-sm font-bold text-white"
            >
              b
            </span>
            <span className="text-lg font-semibold tracking-tight">bgd26</span>
          </Link>

          <nav className="order-3 flex w-full items-center gap-1 text-sm font-medium text-ink-700 sm:order-2 sm:w-auto">
            <Link
              href="/shop"
              className="rounded-lg px-3 py-2 transition-colors hover:bg-brand-50 hover:text-brand-700"
            >
              Shop
            </Link>
            <Link
              href="/track"
              className="rounded-lg px-3 py-2 transition-colors hover:bg-brand-50 hover:text-brand-700"
            >
              Track order
            </Link>
            <Link
              href="/account"
              className="rounded-lg px-3 py-2 transition-colors hover:bg-brand-50 hover:text-brand-700"
            >
              Account
            </Link>
          </nav>

          <div className="order-2 sm:order-3">
            <CartBadge />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 pb-16 pt-6 sm:px-6">{children}</main>

      <footer className="border-t border-slate-200 bg-slate-50">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 py-8 text-sm text-ink-500 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div>
            <p className="font-medium text-ink-700">bgd26 · বাংলাদেশের ব্যবসার এক ছাদের নিচে</p>
            <p className="mt-1 text-xs">
              Cash on delivery across Bangladesh. bKash and Nagad are verified before dispatch.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-4 text-xs">
            <Link href="/shop" className="hover:text-brand-700">
              Shop
            </Link>
            <Link href="/track" className="hover:text-brand-700">
              Track order
            </Link>
            <Link href="/account" className="hover:text-brand-700">
              Account
            </Link>
            {/*
             * Staff console entry point. The storefront is a separate shell from
             * the admin app, so without this link there is no way to reach
             * `/login` from the public site.
             */}
            <Link
              href="/login"
              className="rounded-lg border border-slate-300 px-3 py-1.5 font-medium text-ink-700 transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700"
            >
              Staff sign in · স্টাফ লগইন
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
