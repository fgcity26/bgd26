"use client";

import { useFormStatus } from "react-dom";
import { convertAiDraftAction } from "@/app/actions/assistant";

const inputClass =
  "mt-1 block w-full min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm text-ink-900 shadow-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100";
const labelClass = "block text-sm font-medium text-ink-700";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="min-h-11 rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Converting…" : "Convert to sale"}
    </button>
  );
}

export function DraftConversionForm({ draftOrderId }: { draftOrderId: string }) {
  return (
    <form action={convertAiDraftAction} className="space-y-3">
      <input type="hidden" name="draftOrderId" value={draftOrderId} />
      <label className={labelClass}>
        <span>Payment method</span>
        <select name="paymentMethod" required defaultValue="COD" className={inputClass}>
          <option value="COD">Cash on delivery</option>
          <option value="BKASH">bKash (manual verification)</option>
          <option value="NAGAD">Nagad (manual verification)</option>
        </select>
      </label>
      <label className={labelClass}>
        <span>Transaction reference (optional)</span>
        <input name="reference" maxLength={120} className={inputClass} />
      </label>
      <p className="text-xs leading-relaxed text-ink-500">
        The sale is re-priced from the live catalogue, stock is reserved and the journal is
        posted. bKash and Nagad wait for a manager&apos;s verification.
      </p>
      <Submit />
    </form>
  );
}
