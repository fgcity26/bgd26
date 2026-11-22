"use client";

import { useActionState } from "react";
import { changePasswordAction, type FormState } from "@/app/actions/account";

const initial: FormState = {};

export function PasswordForm({ forced }: { forced: boolean }) {
  const [state, formAction, pending] = useActionState(changePasswordAction, initial);

  return (
    <form action={formAction} className="mt-6 space-y-4">
      <div>
        <label htmlFor="currentPassword" className="block text-sm font-medium text-ink-700">
          {forced ? "Temporary password · সাময়িক পাসওয়ার্ড" : "Current password · বর্তমান পাসওয়ার্ড"}
        </label>
        <input
          id="currentPassword"
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
          className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-base focus:border-brand-600 focus:outline-none"
        />
      </div>

      <div>
        <label htmlFor="newPassword" className="block text-sm font-medium text-ink-700">
          New password · নতুন পাসওয়ার্ড
        </label>
        <input
          id="newPassword"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          required
          minLength={10}
          className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-base focus:border-brand-600 focus:outline-none"
        />
        <p className="mt-1 text-xs text-ink-500">
          At least 10 characters, with a letter and a number.
        </p>
      </div>

      <div>
        <label htmlFor="confirmPassword" className="block text-sm font-medium text-ink-700">
          Confirm new password · নিশ্চিত করুন
        </label>
        <input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          minLength={10}
          className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-base focus:border-brand-600 focus:outline-none"
        />
      </div>

      {state.error ? (
        <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200">
          {state.error}
        </p>
      ) : null}

      {state.success ? (
        <p role="status" className="rounded-xl bg-brand-50 px-3 py-2 text-sm text-brand-700 ring-1 ring-brand-200">
          {state.success}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="min-h-11 w-full rounded-xl bg-brand-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
      >
        {pending ? "Saving…" : "Save new password · সংরক্ষণ করুন"}
      </button>
    </form>
  );
}
