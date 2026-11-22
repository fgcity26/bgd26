"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  registerCustomerAction,
  signInCustomerAction,
} from "@/app/actions/customer-account";
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

export function CustomerSignInForm({ next }: { next: string }) {
  const [state, formAction] = useActionState<CustomerActionState, FormData>(
    signInCustomerAction,
    {},
  );

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="next" value={next} />
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
      </label>
      <label className="block text-sm font-medium text-ink-700">
        Password
        <input
          name="password"
          required
          type="password"
          autoComplete="current-password"
          className={inputClass}
        />
      </label>
      <Problem state={state} />
      <Submit label="Sign in" pendingLabel="Signing in…" />
    </form>
  );
}

export function CustomerRegisterForm({ next }: { next: string }) {
  const [state, formAction] = useActionState<CustomerActionState, FormData>(
    registerCustomerAction,
    {},
  );

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="next" value={next} />
      <label className="block text-sm font-medium text-ink-700">
        Full name
        <input name="fullName" required minLength={2} autoComplete="name" className={inputClass} />
      </label>
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
      </label>
      <label className="block text-sm font-medium text-ink-700">
        Email <span className="font-normal text-ink-500">(optional)</span>
        <input name="email" type="email" autoComplete="email" className={inputClass} />
      </label>
      <label className="block text-sm font-medium text-ink-700">
        Order number <span className="font-normal text-ink-500">(only if you ordered before)</span>
        <input name="orderNumber" placeholder="ORD-…" className={inputClass} />
        <span className="mt-1 block text-xs font-normal text-ink-500">
          A guest order on this mobile proves the number is yours. We ask for one order number
          only when this number already has orders.
        </span>
      </label>
      <label className="block text-sm font-medium text-ink-700">
        Password
        <input
          name="password"
          required
          type="password"
          autoComplete="new-password"
          className={inputClass}
        />
      </label>
      <label className="block text-sm font-medium text-ink-700">
        Confirm password
        <input
          name="confirmPassword"
          required
          type="password"
          autoComplete="new-password"
          className={inputClass}
        />
      </label>
      <Problem state={state} />
      <Submit label="Create account" pendingLabel="Creating…" />
    </form>
  );
}
