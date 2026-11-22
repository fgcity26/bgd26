"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  addRevisionAction,
  requestChangesAction,
  type ProductionFormState,
} from "@/app/actions/production";

const inputClass =
  "mt-1 block w-full min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm text-ink-900 shadow-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100";

const labelClass = "block text-sm font-medium text-ink-700";

function SubmitButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="min-h-11 rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? pendingLabel : label}
    </button>
  );
}

export function RevisionForm({ jobId }: { jobId: string }) {
  const [state, formAction] = useActionState<ProductionFormState, FormData>(
    addRevisionAction,
    {},
  );

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="jobId" value={jobId} />
      {state.error ? (
        <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-200">
          {state.error}
        </p>
      ) : null}
      <label className={labelClass}>
        <span>
          What changed? <span className="text-xs font-normal text-ink-500">পরিবর্তন</span>
        </span>
        <input
          name="description"
          maxLength={1000}
          placeholder="Second proof: wider spacing"
          className={inputClass}
        />
      </label>
      <label className={labelClass}>
        <span>
          Preview link <span className="text-xs font-normal text-ink-500">প্রিভিউ</span>
        </span>
        <input
          name="previewUrl"
          maxLength={500}
          placeholder="https://…"
          className={inputClass}
        />
      </label>
      <SubmitButton label="Add revision" pendingLabel="Saving…" />
    </form>
  );
}

export function ChangesForm({ jobId }: { jobId: string }) {
  const [state, formAction] = useActionState<ProductionFormState, FormData>(
    requestChangesAction,
    {},
  );

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="jobId" value={jobId} />
      {state.error ? (
        <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-200">
          {state.error}
        </p>
      ) : null}
      <label className={labelClass}>
        <span>
          What needs to change? <span className="text-xs font-normal text-ink-500">কী বদলাতে হবে</span>
        </span>
        <input
          name="note"
          maxLength={300}
          placeholder="Move the date lower and use the serif font"
          className={inputClass}
          required
        />
      </label>
      <SubmitButton label="Send back for changes" pendingLabel="Saving…" />
    </form>
  );
}
