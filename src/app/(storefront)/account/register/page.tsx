import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CustomerRegisterForm } from "@/components/storefront/account-auth-forms";
import { getCustomerSession, safeCustomerNext } from "@/lib/customer-auth/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Create an account",
  robots: { index: false, follow: false },
};

export default async function CustomerRegisterPage({
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
        <h2 className="text-2xl font-bold tracking-tight">Create an account</h2>
        <p className="mt-1 text-sm text-ink-500">
          Keep your orders, addresses and points in one place. Your mobile number is your login.
        </p>
      </div>

      <div className="rounded-2xl border border-slate-200 p-5">
        <CustomerRegisterForm next={next} />
      </div>

      <p className="text-sm text-ink-600">
        Already have an account?{" "}
        <Link
          href={`/account/login?next=${encodeURIComponent(next)}`}
          className="font-medium text-brand-700 hover:underline"
        >
          Sign in
        </Link>
      </p>
      <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-ink-500">
        If you ordered as a guest with this mobile, enter one order number so we know the number
        is yours. Without that proof someone else could claim your history.
      </p>
    </div>
  );
}
