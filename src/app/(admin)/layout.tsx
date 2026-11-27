import Link from "next/link";
import { redirect } from "next/navigation";
import { logoutAction } from "@/app/actions/account";
import { hasAnyPermission } from "@/lib/auth/permissions";
import { getStaffSession } from "@/lib/auth/session";
import { AdminNav, type NavItem } from "./admin-nav";

/**
 * The staff console shell.
 *
 * The layout redirects anonymous visitors, and every page below calls
 * `requireStaff()` itself. That split is deliberate: React renders a layout and
 * its page in parallel, so a redirect thrown from the layout would abort a page
 * query mid-flight. Page-level guards also mean a new page cannot forget one
 * silently. Navigation is filtered by permission, but that is UX only — the
 * server checks again in each page and action.
 */
const NAV: Array<NavItem & { anyOf?: string[] }> = [
  { href: "/dashboard", label: "Dashboard", labelBn: "ড্যাশবোর্ড" },
  {
    href: "/pos",
    label: "POS till",
    labelBn: "কাউন্টার",
    anyOf: ["pos.read"],
  },
  {
    href: "/orders",
    label: "Orders",
    labelBn: "অর্ডার",
    anyOf: ["order.read"],
  },
  {
    href: "/assistant",
    label: "Assistant",
    labelBn: "সহায়ক",
    anyOf: ["ai.read"],
  },
  {
    href: "/whatsapp",
    label: "WhatsApp",
    labelBn: "হোয়াটসঅ্যাপ",
    anyOf: ["whatsapp.read"],
  },
  {
    href: "/payments",
    label: "Payments",
    labelBn: "পেমেন্ট",
    anyOf: ["payment.read"],
  },
  {
    href: "/shipping",
    label: "Shipping",
    labelBn: "চালান",
    anyOf: ["shipment.read"],
  },
  {
    href: "/accounting",
    label: "Accounting",
    labelBn: "হিসাব",
    anyOf: ["account.read"],
  },
  {
    href: "/products",
    label: "Products",
    labelBn: "পণ্য",
    anyOf: ["product.read"],
  },
  {
    href: "/categories",
    label: "Categories",
    labelBn: "শ্রেণি",
    anyOf: ["product.read"],
  },
  {
    href: "/inventory",
    label: "Inventory",
    labelBn: "স্টক",
    anyOf: ["inventory.read"],
  },
  {
    href: "/purchases",
    label: "Purchases",
    labelBn: "ক্রয়",
    anyOf: ["purchase.read"],
  },
  {
    href: "/production",
    label: "Production",
    labelBn: "উৎপাদন",
    anyOf: ["production.read"],
  },
  {
    href: "/customers",
    label: "Customers",
    labelBn: "ক্রেতা",
    anyOf: ["customer.read"],
  },
  {
    href: "/loyalty",
    label: "Loyalty",
    labelBn: "লয়্যালটি",
    anyOf: ["customer.read"],
  },
  {
    href: "/reviews",
    label: "Reviews",
    labelBn: "রিভিউ",
    anyOf: ["review.read"],
  },
  {
    href: "/pages",
    label: "Pages",
    labelBn: "পাতা",
    anyOf: ["content.read"],
  },
  {
    href: "/storefront",
    label: "Front page",
    labelBn: "প্রথম পাতা",
    anyOf: ["content.read"],
  },
  {
    href: "/newsletter",
    label: "Newsletter",
    labelBn: "নিউজলেটার",
    anyOf: ["newsletter.read"],
  },
  { href: "/profile", label: "My profile", labelBn: "প্রোফাইল" },
  // New entries appear here as each module lands, each with the permission that
  // reveals it. Dead links are never shipped.
];

export default async function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await getStaffSession();
  if (!session) redirect("/login");

  const items: NavItem[] = NAV.filter(
    (item) => !item.anyOf || hasAnyPermission(session, item.anyOf),
  ).map(({ href, label, labelBn }) => ({ href, label, labelBn }));

  return (
    <div className="min-h-dvh bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link href="/dashboard" className="flex items-center gap-2">
            <span
              aria-hidden
              className="grid size-9 place-items-center rounded-xl bg-brand-600 text-sm font-bold text-white"
            >
              b
            </span>
            <span className="text-base font-semibold tracking-tight">bgd26</span>
          </Link>

          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium leading-tight">{session.user.fullName}</p>
              <p className="text-xs text-ink-500">{session.roles.join(" · ")}</p>
            </div>
            <form action={logoutAction}>
              <button
                type="submit"
                className="min-h-9 rounded-lg border border-slate-300 px-3 text-xs font-medium text-ink-700 transition-colors hover:border-brand-300 hover:text-brand-700"
              >
                Sign out · প্রস্থান
              </button>
            </form>
          </div>
        </div>

        <div className="mx-auto w-full max-w-6xl px-2 pb-2 sm:px-4 md:hidden">
          <AdminNav items={items} />
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-6xl gap-6 px-4 py-5 sm:px-6">
        <aside className="hidden w-56 shrink-0 md:block">
          <AdminNav items={items} />
        </aside>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
