"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/accounting", label: "Trial balance", labelBn: "জের" },
  { href: "/accounting/reports", label: "Reports", labelBn: "প্রতিবেদন" },
  { href: "/accounting/accounts", label: "Accounts", labelBn: "হিসাব" },
  { href: "/accounting/journals", label: "Journals", labelBn: "জার্নাল" },
  { href: "/accounting/expenses", label: "Expenses", labelBn: "খরচ" },
] as const;

export function AccountingNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Accounting sections" className="overflow-x-auto">
      <ul className="flex gap-1">
        {ITEMS.map((item) => {
          const active =
            item.href === "/accounting"
              ? pathname === "/accounting"
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
