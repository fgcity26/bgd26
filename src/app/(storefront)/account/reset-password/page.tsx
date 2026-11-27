import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ResetPasswordForm } from "@/components/storefront/password-reset-forms";
import { getCustomerSession } from "@/lib/customer-auth/session";
import { tryNormalizeBdMobile } from "@/lib/crm/phone";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Reset password",
  robots: { index: false, follow: false },
};

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ mobile?: string; sent?: string }>;
}) {
  const customer = await getCustomerSession();
  if (customer) redirect("/account");

  const params = await searchParams;
  const mobile = tryNormalizeBdMobile(params.mobile ?? "") ?? "";
  const sent = params.sent === "1";

  return (
    <div className="mx-auto max-w-md space-y-5">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Set a new password</h2>
        <p className="mt-1 text-sm text-ink-500">
          Enter the six-digit code from WhatsApp and choose a new password.
        </p>
      </div>

      {sent ? (
        <p
          role="status"
          className="rounded-xl border border-brand-200 bg-brand-50 px-3 py-2 text-sm text-brand-800"
        >
          If that number has an account, a code is on its way on WhatsApp. It expires in 10
          minutes.
        </p>
      ) : (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Request a code first.{" "}
          <Link href="/account/forgot-password" className="font-semibold underline">
            Send a code
          </Link>
        </p>
      )}

      <div className="rounded-2xl border border-slate-200 p-5">
        <ResetPasswordForm mobile={mobile} />
      </div>

      <p className="text-sm text-ink-600">
        Did not get a code?{" "}
        <Link
          href="/account/forgot-password"
          className="font-medium text-brand-700 hover:underline"
        >
          Request another
        </Link>{" "}
        after a minute.
      </p>
      <p className="text-sm text-ink-600">
        <Link href="/account/login" className="font-medium text-brand-700 hover:underline">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
