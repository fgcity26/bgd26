"use client";

import { useActionState } from "react";
import { loginAction, type LoginState } from "./actions";

const initial: LoginState = {};

export function LoginForm({ next }: { next?: string }) {
  const [state, formAction, pending] = useActionState(loginAction, initial);

  return (
    <form action={formAction} className="mt-6 space-y-4" noValidate>
      <input type="hidden" name="next" value={next ?? "/dashboard"} />

      <div>
        <label htmlFor="email" className="block text-sm font-medium text-ink-700">
          Email · ইমেইল
        </label>
        <input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="username"
          required
          defaultValue={state.email}
          className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-base text-ink-900 placeholder:text-ink-500/70 focus:border-brand-600 focus:outline-none"
          placeholder="owner@bgd26.com"
        />
      </div>

      <div>
        <label htmlFor="password" className="block text-sm font-medium text-ink-700">
          Password · পাসওয়ার্ড
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-base text-ink-900 focus:border-brand-600 focus:outline-none"
        />
      </div>

      {state.error ? (
        <p
          role="alert"
          className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200"
        >
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="min-h-11 w-full rounded-xl bg-brand-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Signing in…" : "Sign in · প্রবেশ করুন"}
      </button>
    </form>
  );
}
