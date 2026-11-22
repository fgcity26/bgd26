"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

/**
 * The cart count is fetched client-side so catalogue pages never read the cart
 * cookie during rendering and can stay cached. `bgd26:cart` is dispatched by
 * the add/update actions so the badge refreshes immediately.
 */
export function CartBadge() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await fetch("/api/storefront/cart-count", {
          cache: "no-store",
        });
        if (!response.ok) return;
        const data = (await response.json()) as { count?: number };
        if (active) setCount(typeof data.count === "number" ? data.count : 0);
      } catch {
        // A badge failure must never break the page.
      }
    };
    void load();
    const refresh = () => void load();
    window.addEventListener("bgd26:cart", refresh);
    return () => {
      active = false;
      window.removeEventListener("bgd26:cart", refresh);
    };
  }, []);

  return (
    <Link
      href="/cart"
      className="relative inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-300 px-3 text-sm font-medium text-ink-700 transition-colors hover:border-brand-400 hover:text-brand-700"
    >
      Cart
      <span className="grid min-w-6 place-items-center rounded-full bg-brand-600 px-1.5 py-0.5 text-xs font-semibold text-white">
        {count}
      </span>
    </Link>
  );
}
