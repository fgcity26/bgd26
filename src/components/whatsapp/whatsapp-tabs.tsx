"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/whatsapp", label: "Inbox", labelBn: "ইনবক্স" },
  { href: "/whatsapp/queue", label: "Queue", labelBn: "সারি" },
  { href: "/whatsapp/templates", label: "Templates", labelBn: "টেমপ্লেট" },
  { href: "/whatsapp/consents", label: "Consent", labelBn: "সম্মতি" },
];

export function WhatsappTabs() {
  const pathname = usePathname();
  return (
    <nav aria-label="WhatsApp sections" className="flex gap-1 overflow-x-auto rounded-xl bg-slate-100 p-1">
      {TABS.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              active
                ? "bg-white text-ink-900 shadow-sm ring-1 ring-slate-200"
                : "text-ink-600 hover:text-ink-900"
            }`}
          >
            {tab.label} · {tab.labelBn}
          </Link>
        );
      })}
    </nav>
  );
}
