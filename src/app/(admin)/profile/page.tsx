import type { Metadata } from "next";
import { logoutAction } from "@/app/actions/account";
import { requireStaff } from "@/lib/auth/session";
import { PasswordForm } from "@/components/account/password-form";
import { PinForm } from "@/components/account/pin-form";

export const metadata: Metadata = {
  title: "My profile",
  robots: { index: false, follow: false },
};

const dateTime = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Dhaka",
});

export default async function ProfilePage() {
  const session = await requireStaff();
  const hasPin = session.user.managerPinHash !== null;

  const facts = [
    { label: "Full name", labelBn: "নাম", value: session.user.fullName },
    { label: "Email", labelBn: "ইমেইল", value: session.user.email },
    {
      label: "Phone",
      labelBn: "মোবাইল",
      value: session.user.phone ?? "Not set",
    },
    {
      label: "Roles",
      labelBn: "ভূমিকা",
      value: session.roles.join(", ") || "No role assigned",
    },
    {
      label: "Last sign-in",
      labelBn: "সর্বশেষ প্রবেশ",
      value: session.user.lastLoginAt ? dateTime.format(session.user.lastLoginAt) : "First sign-in",
    },
  ];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">My profile</h1>
        <p className="mt-1 text-sm text-ink-500">
          আপনার অ্যাকাউন্ট, পাসওয়ার্ড ও ম্যানেজার পিন।
        </p>
      </header>

      <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
        <h2 className="text-base font-semibold">Account</h2>
        <dl className="mt-3 divide-y divide-slate-100">
          {facts.map((fact) => (
            <div key={fact.label} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
              <dt className="text-sm text-ink-500">
                {fact.label} · {fact.labelBn}
              </dt>
              <dd className="text-sm font-medium text-ink-900">{fact.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
        <h2 className="text-base font-semibold">Password</h2>
        <p className="mt-1 text-sm text-ink-700">
          Changing your password signs out nothing else — this device stays signed in.
        </p>
        <PasswordForm forced={false} />
      </section>

      <section id="pin" className="scroll-mt-20 rounded-2xl bg-white p-4 ring-1 ring-slate-200">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold">Manager PIN</h2>
          <span
            className={[
              "rounded-full px-2.5 py-1 text-xs font-medium ring-1",
              hasPin
                ? "bg-brand-50 text-brand-700 ring-brand-200"
                : "bg-amber-50 text-amber-800 ring-amber-200",
            ].join(" ")}
          >
            {hasPin ? "Set" : "Not set"}
          </span>
        </div>
        <p className="mt-1 text-sm leading-relaxed text-ink-700">
          Used at the counter to approve discounts above 5 %, walk-in cash sales and
          manual payment verification. Six digits, never shared between staff.
        </p>
        <p className="mt-1 text-sm leading-relaxed text-ink-500">
          ৳৫%-এর বেশি ছাড়, ওয়াক-ইন নগদ বিক্রয় ও পেমেন্ট যাচাইয়ের জন্য এই পিন লাগে।
        </p>
        <PinForm hasPin={hasPin} />
      </section>

      <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
        <h2 className="text-base font-semibold">Session</h2>
        <p className="mt-1 text-sm text-ink-700">
          Signed in with {session.token.provider === "supabase" ? "Supabase Auth" : "a local account"}.
          This session ends automatically after 7 days.
        </p>
        <form action={logoutAction} className="mt-3">
          <button
            type="submit"
            className="min-h-11 rounded-xl border border-slate-300 px-4 text-sm font-semibold text-ink-700 transition-colors hover:border-red-300 hover:text-red-700"
          >
            Sign out · প্রস্থান করুন
          </button>
        </form>
      </section>
    </div>
  );
}
