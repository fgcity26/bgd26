"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

const ITEMS = [
  { status: "", label: "All jobs", labelBn: "সব কাজ" },
  { status: "design", label: "Design", labelBn: "ডিজাইন" },
  { status: "production", label: "Production", labelBn: "উৎপাদন" },
  { status: "ready", label: "Ready", labelBn: "প্রস্তুত" },
  { status: "done", label: "Done", labelBn: "সম্পন্ন" },
] as const;

export function ProductionNav() {
  const pathname = usePathname();
  const params = useSearchParams();
  const current = pathname === "/production" ? (params.get("status") ?? "") : "";

  return (
    <nav aria-label="Production sections" className="overflow-x-auto">
      <ul className="flex gap-1">
        {ITEMS.map((item) => {
          const active = current === item.status;
          const href = item.status ? `/production?status=${item.status}` : "/production";
          return (
            <li key={item.label} className="shrink-0">
              <Link
                href={href}
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
