"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type NavItem = {
  href: string;
  label: string;
  labelBn: string;
};

export function AdminNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();

  return (
    <ul className="flex gap-1 overflow-x-auto md:flex-col md:gap-1 md:overflow-visible">
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <li key={item.href} className="shrink-0 md:shrink">
            <Link
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={[
                "flex min-h-11 items-center rounded-xl px-3 text-sm font-medium transition-colors",
                active
                  ? "bg-brand-600 text-white"
                  : "text-ink-700 hover:bg-brand-50 hover:text-brand-700",
              ].join(" ")}
            >
              <span>{item.label}</span>
              <span className="ml-2 text-xs opacity-70">{item.labelBn}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
