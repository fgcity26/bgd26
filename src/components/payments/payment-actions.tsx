"use client";

import { useFormStatus } from "react-dom";
import { rejectPaymentAction, verifyPaymentAction } from "@/app/actions/orders";

const inputClass =
  "mt-1 block w-full min-h-10 rounded-xl border border-slate-300 bg-white px-3 text-sm text-ink-900 shadow-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100";

function Submit({ idle, busy, tone = "brand" }: { idle: string; busy: string; tone?: "brand" | "danger" }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={`min-h-10 rounded-xl px-3 text-xs font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
        tone === "danger" ? "bg-red-600 hover:bg-red-700" : "bg-brand-600 hover:bg-brand-700"
      }`}
    >
      {pending ? busy : idle}
    </button>
  );
}

export function VerifyPaymentForm({ paymentId }: { paymentId: string }) {
  return (
    <form action={verifyPaymentAction} className="space-y-2">
      <input type="hidden" name="id" value={paymentId} />
      <input
        name="reference"
        placeholder="bKash / Nagad transaction id"
        className={inputClass}
        maxLength={120}
      />
      <input name="note" placeholder="Note (optional)" className={inputClass} maxLength={300} />
      <Submit idle="Verify payment" busy="Verifying…" />
    </form>
  );
}

export function RejectPaymentForm({ paymentId }: { paymentId: string }) {
  return (
    <form action={rejectPaymentAction} className="space-y-2">
      <input type="hidden" name="id" value={paymentId} />
      <input
        name="reason"
        required
        minLength={3}
        maxLength={300}
        placeholder="Why is this payment rejected?"
        className={inputClass}
      />
      <Submit idle="Reject" busy="Rejecting…" tone="danger" />
    </form>
  );
}
