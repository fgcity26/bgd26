"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { trackOrderAction } from "@/app/actions/storefront";
import type { StorefrontActionState } from "@/lib/storefront/action-state";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="min-h-11 w-full rounded-xl bg-brand-600 px-5 text-sm font-semibold text-white hover:bg-brand-700 disabled:bg-slate-300"
    >
      {pending ? "Looking up…" : "Find my order"}
    </button>
  );
}

export function TrackForm() {
  const [state, formAction] = useActionState<StorefrontActionState, FormData>(
    trackOrderAction,
    {},
  );

  return (
    <form action={formAction} className="space-y-3">
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-ink-700">Order number</span>
        <input
          name="orderNumber"
          required
          autoComplete="off"
          placeholder="SO-20261119-ABC123"
          className="min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm"
        />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-ink-700">Mobile used at checkout</span>
        <input
          name="mobile"
          required
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="01XXXXXXXXX"
          className="min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm"
        />
      </label>
      {state.error ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      ) : null}
      <SubmitButton />
    </form>
  );
}
