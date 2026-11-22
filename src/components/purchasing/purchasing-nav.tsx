"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/purchases", label: "Orders", labelBn: "অর্ডার" },
  { href: "/purchases/dropship", label: "Dropship", labelBn: "ড্রপশিপ" },
  { href: "/purchases/grn", label: "Goods received", labelBn: "মাল গ্রহণ" },
  { href: "/purchases/payments", label: "Payments", labelBn: "পরিশোধ" },
  { href: "/purchases/returns", label: "Returns", labelBn: "ফেরত" },
  { href: "/suppliers", label: "Suppliers", labelBn: "সরবরাহকারী" },
] as const;

export function PurchaseNav() {
  const pathname = usePathname();

  const isOrderSection = (path: string) =>
    path === "/purchases" ||
    (path.startsWith("/purchases/") &&
      !path.startsWith("/purchases/dropship") &&
      !path.startsWith("/purchases/grn") &&
      !path.startsWith("/purchases/payments") &&
      !path.startsWith("/purchases/returns"));

  return (
    <nav aria-label="Purchasing sections" className="overflow-x-auto">
      <ul className="flex gap-1">
        {ITEMS.map((item) => {
          const active =
            item.href === "/purchases"
              ? isOrderSection(pathname)
              : pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <li key={item.href} className="shrink-0">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={[
                  "flex min-h-10 items-center rounded-xl px-3 text-xs font-medium transition-colors sm:text-sm",
                  active
                    ? "bg-brand-600 text-white"
                    : "bg-white text-ink-700 ring-1 ring-slate-200 hover:bg-brand-50 hover:text-brand-700",
                ].join(" ")}
              >
                <span>{item.label}</span>
                <span className="ml-2 text-[11px] opacity-70">{item.labelBn}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
