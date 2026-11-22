import type { Metadata } from "next";
import Link from "next/link";
import { requireStaff } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "No access",
  robots: { index: false, follow: false },
};

export default async function ForbiddenPage() {
  const session = await requireStaff();

  return (
    <div className="mx-auto max-w-lg space-y-4 rounded-2xl bg-white p-6 ring-1 ring-slate-200">
      <h1 className="text-2xl font-bold tracking-tight">No access · অনুমতি নেই</h1>
      <p className="text-sm leading-relaxed text-ink-700">
        Your account does not have permission for that page. Ask the owner to review your
        role if you need it.
      </p>
      <p className="text-sm leading-relaxed text-ink-500">
        আপনার অ্যাকাউন্টে এই অংশে প্রবেশের অনুমতি নেই। প্রয়োজন হলে মালিকের সাথে কথা বলুন।
      </p>
      <p className="text-xs text-ink-500">
        Signed in as {session.user.email} · {session.roles.join(", ") || "no role"}
      </p>
      <Link
        href="/dashboard"
        className="inline-flex min-h-11 items-center rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700"
      >
        Back to dashboard · ড্যাশবোর্ড
      </Link>
    </div>
  );
}
