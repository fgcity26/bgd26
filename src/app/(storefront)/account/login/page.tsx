import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CustomerSignInForm } from "@/components/storefront/account-auth-forms";
import { isSignedOutNotice } from "@/lib/auth/sign-out";
import { getCustomerSession, safeCustomerNext } from "@/lib/customer-auth/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false, follow: false },
};

export default async function CustomerLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; signedOut?: string }>;
}) {
  const params = await searchParams;
  const next = safeCustomerNext(params.next);
  const justSignedOut = isSignedOutNotice(params.signedOut);
  const customer = await getCustomerSession();
  // After a sign-out the form is always shown, even if a stale cookie survives.
  if (customer && !justSignedOut) redirect(next);

  return (
    <div className="mx-auto max-w-md space-y-5">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Sign in</h2>
        <p className="mt-1 text-sm text-ink-500">
          Use the mobile number from your order. Saved addresses and loyalty points are waiting.
        </p>
        {justSignedOut ? (
          <p
            role="status"
            className="mt-3 rounded-xl border border-brand-200 bg-brand-50 px-3 py-2 text-sm text-brand-800"
          >
            You have signed out. · আপনি প্রস্থান করেছেন।
          </p>
        ) : null}
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
      <p className="text-sm text-ink-600">
        Forgot your password?{" "}
        <Link
          href="/account/forgot-password"
          className="font-medium text-brand-700 hover:underline"
        >
          Reset it with a WhatsApp code
        </Link>
      </p>
      <p className="text-xs text-ink-500">
        The code goes to the mobile number on your account. It expires in 10 minutes.
      </p>
    </div>
  );
}
