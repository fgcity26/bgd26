import type { Metadata } from "next";
import {
  changeCustomerPasswordAction,
  updateProfileAction,
} from "@/app/actions/customer-account";
import { requireCustomer } from "@/lib/customer-auth/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your profile",
  robots: { index: false, follow: false },
};

const inputClass =
  "mt-1 block w-full min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100";

export default async function CustomerProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  const customer = await requireCustomer("/account/profile");
  const params = await searchParams;

  return (
    <div className="space-y-5">
      {params.error ? (
        <p role="alert" className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-red-200">
          {params.error}
        </p>
      ) : null}
      {params.ok ? (
        <p className="rounded-2xl bg-brand-50 px-4 py-3 text-sm text-brand-800 ring-1 ring-brand-200">
          {params.ok}
        </p>
      ) : null}

      <section className="rounded-2xl border border-slate-200 p-4">
        <h2 className="text-base font-semibold">Your details</h2>
        <p className="mt-1 text-sm text-ink-500">
          The mobile number is your login and cannot be changed here. Message the shop if you need a
          new number.
        </p>
        <form action={updateProfileAction} className="mt-3 space-y-3">
          <label className="block text-sm font-medium text-ink-700">
            Full name
            <input
              name="fullName"
              required
              minLength={2}
              defaultValue={customer.fullName}
              autoComplete="name"
              className={inputClass}
            />
          </label>
          <label className="block text-sm font-medium text-ink-700">
            Email <span className="font-normal text-ink-500">(optional)</span>
            <input
              name="email"
              type="email"
              defaultValue={customer.email ?? ""}
              autoComplete="email"
              className={inputClass}
            />
          </label>
          <label className="block text-sm font-medium text-ink-700">
            Mobile
            <input
              value={customer.mobileNormalized}
              readOnly
              className={`${inputClass} bg-slate-50 text-ink-500`}
            />
          </label>
          <button
            type="submit"
            className="min-h-11 rounded-xl bg-brand-600 px-5 text-sm font-semibold text-white hover:bg-brand-700"
          >
            Save details
          </button>
        </form>
      </section>

      <section className="rounded-2xl border border-slate-200 p-4">
        <h2 className="text-base font-semibold">Change password</h2>
        <p className="mt-1 text-sm text-ink-500">
          Use at least 10 characters with a letter and a number.
        </p>
        <form action={changeCustomerPasswordAction} className="mt-3 space-y-3">
          <label className="block text-sm font-medium text-ink-700">
            Current password
            <input
              name="currentPassword"
              required
              type="password"
              autoComplete="current-password"
              className={inputClass}
            />
          </label>
          <label className="block text-sm font-medium text-ink-700">
            New password
            <input
              name="newPassword"
              required
              type="password"
              autoComplete="new-password"
              className={inputClass}
            />
          </label>
          <label className="block text-sm font-medium text-ink-700">
            Confirm new password
            <input
              name="confirmPassword"
              required
              type="password"
              autoComplete="new-password"
              className={inputClass}
            />
          </label>
          <button
            type="submit"
            className="min-h-11 rounded-xl border border-slate-300 px-5 text-sm font-semibold text-ink-700 hover:border-brand-300 hover:text-brand-700"
          >
            Change password
          </button>
        </form>
      </section>

      <p className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-ink-500">
        Signed in since {customer.lastLoginAt ? customer.lastLoginAt.toISOString().slice(0, 10) : "—"}.
        Account created {customer.accountClaimedAt ? customer.accountClaimedAt.toISOString().slice(0, 10) : "—"}.
      </p>
    </div>
  );
}
