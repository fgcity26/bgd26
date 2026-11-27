"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  requestPasswordResetAction,
  resetCustomerPasswordAction,
} from "@/app/actions/customer-password-reset";
import type { CustomerActionState } from "@/lib/customer-auth/action-state";

const inputClass =
  "mt-1 block w-full min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100";

function Submit({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="min-h-12 w-full rounded-xl bg-brand-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:bg-slate-300"
    >
      {pending ? pendingLabel : label}
    </button>
  );
}

function Problem({ state }: { state: CustomerActionState }) {
  if (!state.error) return null;
  return (
    <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
      {state.error}
    </p>
  );
}

export function ForgotPasswordForm() {
  const [state, formAction] = useActionState<CustomerActionState, FormData>(
    requestPasswordResetAction,
    {},
  );

  return (
    <form action={formAction} className="space-y-3">
      <label className="block text-sm font-medium text-ink-700">
        Mobile number
        <input
          name="mobile"
          required
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="01XXXXXXXXX"
          className={inputClass}
        />
        <span className="mt-1 block text-xs font-normal text-ink-500">
          Use the number from your orders. The code is sent on WhatsApp.
        </span>
      </label>
      <Problem state={state} />
      <Submit label="Send code" pendingLabel="Sending…" />
    </form>
  );
}

export function ResetPasswordForm({ mobile }: { mobile: string }) {
  const [state, formAction] = useActionState<CustomerActionState, FormData>(
    resetCustomerPasswordAction,
    {},
  );

  return (
    <form action={formAction} className="space-y-3">
      <label className="block text-sm font-medium text-ink-700">
        Mobile number
        <input
          name="mobile"
          required
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          defaultValue={mobile}
          className={inputClass}
        />
      </label>
      <label className="block text-sm font-medium text-ink-700">
        Six-digit code
        <input
          name="code"
          required
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          placeholder="000000"
          className={`${inputClass} tracking-[0.35em]`}
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
      <p className="text-xs text-ink-500">
        At least 10 characters, with a letter and a number. The code expires in 10 minutes and
        works once.
      </p>
      <Problem state={state} />
      <Submit label="Set new password" pendingLabel="Saving…" />
    </form>
  );
}
