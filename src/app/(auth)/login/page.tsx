import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getStaffSession } from "@/lib/auth/session";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Staff sign-in for the bgd26 business console.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const session = await getStaffSession();
  if (session) {
    redirect(session.user.mustChangePassword ? "/account/password" : "/dashboard");
  }

  const { next } = await searchParams;

  return (
    <section className="w-full">
      <h1 className="text-2xl font-bold tracking-tight">Staff sign in</h1>
      <p className="mt-1 text-sm text-ink-500">
        ক্যাশিয়ার, ম্যানেজার বা মালিক—আপনার অ্যাকাউন্টে প্রবেশ করুন।
      </p>

      <LoginForm next={next} />

      <p className="mt-6 text-xs leading-relaxed text-ink-500">
        Shared counter device? Always sign out when you leave the till. Sessions end
        automatically after 7 days.
      </p>
    </section>
  );
}
