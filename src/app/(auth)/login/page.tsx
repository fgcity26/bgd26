import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getStaffSession } from "@/lib/auth/session";
import { isSignedOutNotice } from "@/lib/auth/sign-out";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Staff sign-in for the bgd26 business console.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; signedOut?: string }>;
}) {
  const { next, signedOut } = await searchParams;
  const justSignedOut = isSignedOutNotice(signedOut);

  const session = await getStaffSession();
  // After a sign-out the form is always shown. Otherwise a surviving cookie
  // would bounce the visitor to `/dashboard`, which looks like the sign-out
  // failed.
  if (session && !justSignedOut) {
    redirect(session.user.mustChangePassword ? "/account/password" : "/dashboard");
  }

  return (
    <section className="w-full">
      <h1 className="text-2xl font-bold tracking-tight">Staff sign in</h1>
      <p className="mt-1 text-sm text-ink-500">
        ক্যাশিয়ার, ম্যানেজার বা মালিক—আপনার অ্যাকাউন্টে প্রবেশ করুন।
      </p>

      {justSignedOut ? (
        <p
          role="status"
          className="mt-4 rounded-xl border border-brand-200 bg-brand-50 px-3 py-2 text-sm text-brand-800"
        >
          You have signed out. · আপনি প্রস্থান করেছেন।
        </p>
      ) : null}

      <LoginForm next={next} />

      <p className="mt-6 text-xs leading-relaxed text-ink-500">
        Shared counter device? Always sign out when you leave the till. Sessions end
        automatically after 7 days.
      </p>
    </section>
  );
}
