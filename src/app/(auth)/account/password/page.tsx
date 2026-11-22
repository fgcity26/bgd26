import type { Metadata } from "next";
import Link from "next/link";
import { requireStaff } from "@/lib/auth/session";
import { PasswordForm } from "@/components/account/password-form";

export const metadata: Metadata = {
  title: "Change password",
  robots: { index: false, follow: false },
};

export default async function ChangePasswordPage() {
  const session = await requireStaff({ allowPendingPasswordChange: true });
  const forced = session.user.mustChangePassword;

  return (
    <section className="w-full">
      <h1 className="text-2xl font-bold tracking-tight">
        {forced ? "Set your own password" : "Change password"}
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-ink-700">
        {forced
          ? "This account still uses the temporary password from setup. Choose a new one to continue."
          : "Enter your current password, then choose a new one."}
      </p>
      <p className="mt-1 text-sm leading-relaxed text-ink-500">
        {forced
          ? "সেটআপের সময়ের সাময়িক পাসওয়ার্ড এখনো আছে। নতুন পাসওয়ার্ড দিলেই কাজ শুরু করতে পারবেন।"
          : "বর্তমান পাসওয়ার্ড দিয়ে নতুন পাসওয়ার্ড ঠিক করুন।"}
      </p>

      <PasswordForm forced={forced} />

      {!forced ? (
        <Link
          href="/profile"
          className="mt-6 inline-flex min-h-11 items-center text-sm font-medium text-brand-700 hover:underline"
        >
          ← Back to profile
        </Link>
      ) : null}
    </section>
  );
}
