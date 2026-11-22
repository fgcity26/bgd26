"use client";

import { useActionState } from "react";
import { changePinAction, type FormState } from "@/app/actions/account";

const initial: FormState = {};

export function PinForm({ hasPin }: { hasPin: boolean }) {
  const [state, formAction, pending] = useActionState(changePinAction, initial);

  return (
    <form action={formAction} className="mt-6 space-y-4">
      <div>
        <label htmlFor="pin-current-password" className="block text-sm font-medium text-ink-700">
          Current password · বর্তমান পাসওয়ার্ড
        </label>
        <input
          id="pin-current-password"
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
          className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-base focus:border-brand-600 focus:outline-none"
        />
        <p className="mt-1 text-xs text-ink-500">
          Required so a borrowed browser cannot set a new PIN.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="newPin" className="block text-sm font-medium text-ink-700">
            {hasPin ? "New PIN" : "PIN"} · ৬ সংখ্যা
          </label>
          <input
            id="newPin"
            name="newPin"
            type="password"
            inputMode="numeric"
            pattern="\d{6}"
            maxLength={6}
            autoComplete="off"
            required
            className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-base tracking-[0.4em] focus:border-brand-600 focus:outline-none"
          />
        </div>
        <div>
          <label htmlFor="confirmPin" className="block text-sm font-medium text-ink-700">
            Confirm PIN · নিশ্চিত করুন
          </label>
          <input
            id="confirmPin"
            name="confirmPin"
            type="password"
            inputMode="numeric"
            pattern="\d{6}"
            maxLength={6}
            autoComplete="off"
            required
            className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-base tracking-[0.4em] focus:border-brand-600 focus:outline-none"
          />
        </div>
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
        {pending ? "Saving…" : hasPin ? "Change PIN · পিন বদলান" : "Set PIN · পিন সংরক্ষণ"}
      </button>
    </form>
  );
}
