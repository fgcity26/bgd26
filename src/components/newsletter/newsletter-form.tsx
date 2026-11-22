"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  subscribeNewsletterAction,
  type NewsletterFormState,
} from "@/app/actions/newsletter";

const inputClass =
  "mt-1 block w-full min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm text-ink-900 shadow-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100";

const labelClass = "block text-sm font-medium text-ink-700";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="min-h-11 rounded-xl bg-brand-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Adding…" : "Queue confirmation"}
    </button>
  );
}

export function NewsletterForm() {
  const [state, formAction] = useActionState<NewsletterFormState, FormData>(
    subscribeNewsletterAction,
    {},
  );

  return (
    <form action={formAction} className="space-y-3">
      {state.error ? (
        <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-200">
          {state.error}
        </p>
      ) : null}
      {state.success ? (
        <div className="rounded-xl bg-brand-50 px-3 py-2 text-sm text-brand-800 ring-1 ring-brand-200">
          <p>{state.success}</p>
          {state.confirmUrl ? (
            <p className="mt-2 break-all font-mono text-xs">
              <a href={state.confirmUrl} className="underline">
                {state.confirmUrl}
              </a>
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-[2fr_1fr_auto] sm:items-end">
        <label className={labelClass}>
          <span>
            Email <span className="text-xs font-normal text-ink-500">ইমেইল</span>
          </span>
          <input
            name="email"
            type="email"
            required
            maxLength={254}
            placeholder="customer@example.com"
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          <span>Source</span>
          <select name="source" defaultValue="admin" className={inputClass}>
            <option value="admin">Staff console</option>
            <option value="counter">Counter</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="phone">Phone</option>
          </select>
        </label>
        <SubmitButton />
      </div>

      <label className="flex min-h-11 items-start gap-2 text-sm text-ink-700">
        <input type="checkbox" name="consent" required className="mt-3 size-4" />
        <span>
          The customer agreed to receive news and offers.
          <span className="mt-0.5 block text-xs text-ink-500">
            They still must open the confirmation link; nothing is sent before that.
          </span>
        </span>
      </label>
    </form>
  );
}
