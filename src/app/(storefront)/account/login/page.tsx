import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CustomerSignInForm } from "@/components/storefront/account-auth-forms";
import { getCustomerSession, safeCustomerNext } from "@/lib/customer-auth/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false, follow: false },
};

export default async function CustomerLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  const next = safeCustomerNext(params.next);
  const customer = await getCustomerSession();
  if (customer) redirect(next);

  return (
    <div className="mx-auto max-w-md space-y-5">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Sign in</h2>
        <p className="mt-1 text-sm text-ink-500">
          Use the mobile number from your order. Saved addresses and loyalty points are waiting.
        </p>
      </div>

      <div className="rounded-2xl border border-slate-200 p-5">
        <CustomerSignInForm next={next} />
      </div>

      <p className="text-sm text-ink-600">
        New here?{" "}
        <Link
          href={`/account/register?next=${encodeURIComponent(next)}`}
          className="font-medium text-brand-700 hover:underline"
        >
          Create an account
        </Link>
      </p>
      <p className="text-xs text-ink-500">
        Forgot your password? Message the shop on WhatsApp with your mobile number. We reset it
        after checking your last order.
      </p>
    </div>
  );
}
