import Link from "next/link";
import { signOutCustomerAction } from "@/app/actions/customer-account";
import { getCustomerSession } from "@/lib/customer-auth/session";

const LINKS = [
  { href: "/account", label: "Overview" },
  { href: "/account/orders", label: "Orders" },
  { href: "/account/addresses", label: "Addresses" },
  { href: "/account/loyalty", label: "Points" },
  { href: "/account/profile", label: "Profile" },
] as const;

export default async function AccountLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const customer = await getCustomerSession();

  return (
    <div className="space-y-5">
      {customer ? (
        <header className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-ink-500">
                Your account
              </p>
              <h1 className="text-xl font-bold tracking-tight">{customer.fullName}</h1>
              <p className="mt-0.5 font-mono text-xs text-ink-500">
                {customer.mobileNormalized}
              </p>
            </div>
            <form action={signOutCustomerAction}>
              <button
                type="submit"
                className="min-h-10 rounded-xl border border-slate-300 px-4 text-sm font-medium text-ink-700 hover:border-brand-300 hover:text-brand-700"
              >
                Sign out
              </button>
            </form>
          </div>

          <nav aria-label="Account sections" className="overflow-x-auto">
            <ul className="flex gap-1">
              {LINKS.map((link) => (
                <li key={link.href} className="shrink-0">
                  <Link
                    href={link.href}
                    className="inline-flex min-h-10 items-center rounded-xl px-3 text-sm font-medium text-ink-700 hover:bg-brand-50 hover:text-brand-700"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </header>
      ) : null}

      {children}
    </div>
  );
}
