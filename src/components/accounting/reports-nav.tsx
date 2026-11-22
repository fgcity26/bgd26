"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/accounting/reports", label: "Profit & loss", labelBn: "লাভ-ক্ষতি" },
  {
    href: "/accounting/reports/balance-sheet",
    label: "Balance sheet",
    labelBn: "উদ্বৃত্তপত্র",
  },
  {
    href: "/accounting/reports/cash-flow",
    label: "Cash flow",
    labelBn: "নগদ প্রবাহ",
  },
] as const;

export function ReportsNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Financial statements" className="overflow-x-auto">
      <ul className="flex gap-1">
        {ITEMS.map((item) => {
          const active = pathname === item.href;
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
