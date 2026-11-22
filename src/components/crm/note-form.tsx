"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  addCustomerNoteAction,
  type CustomerFormState,
} from "@/app/actions/customers";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="min-h-11 rounded-xl bg-brand-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Saving…" : "Add note"}
    </button>
  );
}

export function NoteForm({ customerId }: { customerId: string }) {
  const [state, formAction] = useActionState<CustomerFormState, FormData>(
    addCustomerNoteAction,
    {},
  );

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="customerId" value={customerId} />

      {state.error ? (
        <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-200">
          {state.error}
        </p>
      ) : null}
      {state.success ? (
        <p className="rounded-xl bg-brand-50 px-3 py-2 text-sm text-brand-800 ring-1 ring-brand-200">
          {state.success}
        </p>
      ) : null}

      <label className="block text-sm font-medium text-ink-700">
        <span>
          Note <span className="text-xs font-normal text-ink-500">নোট</span>
        </span>
        <textarea
          name="note"
          required
          rows={2}
          maxLength={2000}
          placeholder="Called about the engraving proof; prefers WhatsApp."
          className="mt-1 block w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-ink-900 shadow-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
        />
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton />
        <label className="flex min-h-11 items-center gap-2 text-sm text-ink-700">
          <input type="checkbox" name="isPinned" className="size-4" />
          Pin to the top
        </label>
      </div>
    </form>
  );
}
