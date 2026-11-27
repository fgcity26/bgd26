import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ForgotPasswordForm } from "@/components/storefront/password-reset-forms";
import { getCustomerSession } from "@/lib/customer-auth/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Forgot password",
  robots: { index: false, follow: false },
};

export default async function ForgotPasswordPage() {
  const customer = await getCustomerSession();
  if (customer) redirect("/account");

  return (
    <div className="mx-auto max-w-md space-y-5">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Forgot password</h2>
        <p className="mt-1 text-sm text-ink-500">
          Enter the mobile number on your account. If it has an account, we send a six-digit code
          on WhatsApp.
        </p>
      </div>

      <div className="rounded-2xl border border-slate-200 p-5">
        <ForgotPasswordForm />
      </div>

      <p className="text-sm text-ink-600">
        Remembered it?{" "}
        <Link href="/account/login" className="font-medium text-brand-700 hover:underline">
          Sign in
        </Link>
      </p>
      <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-ink-500">
        For your safety the screen never says whether a number has an account. If no code arrives,
        check the number, wait a minute and try again — or message the shop on WhatsApp.
      </p>
    </div>
  );
}
