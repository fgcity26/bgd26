"use client";

import { useFormStatus } from "react-dom";
import { cancelOrderAction, setOrderStatusAction } from "@/app/actions/orders";

const inputClass =
  "mt-1 block w-full min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm text-ink-900 shadow-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100";
const labelClass = "block text-sm font-medium text-ink-700";

function Submit({ idle, busy, tone = "brand" }: { idle: string; busy: string; tone?: "brand" | "danger" }) {
  const { pending } = useFormStatus();
  const classes =
    tone === "danger"
      ? "bg-red-600 hover:bg-red-700"
      : "bg-brand-600 hover:bg-brand-700";
  return (
    <button
      type="submit"
      disabled={pending}
      className={`min-h-11 rounded-xl px-4 text-sm font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${classes}`}
    >
      {pending ? busy : idle}
    </button>
  );
}

export function OrderStatusForm({
  orderId,
  allowed,
}: {
  orderId: string;
  allowed: Array<{ value: string; label: string }>;
}) {
  if (allowed.length === 0) {
    return <p className="text-sm text-ink-500">This order has reached its final state.</p>;
  }
  return (
    <form action={setOrderStatusAction} className="space-y-3">
      <input type="hidden" name="id" value={orderId} />
      <label className={labelClass}>
        <span>Move to</span>
        <select name="status" required className={inputClass}>
          {allowed.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label className={labelClass}>
        <span>Note (optional)</span>
        <input name="note" maxLength={300} className={inputClass} />
      </label>
      <Submit idle="Update status" busy="Updating…" />
    </form>
  );
}

export function CancelOrderForm({ orderId }: { orderId: string }) {
  return (
    <form action={cancelOrderAction} className="space-y-3">
      <input type="hidden" name="id" value={orderId} />
      <label className={labelClass}>
        <span>Reason for cancelling</span>
        <input name="reason" required minLength={3} maxLength={300} className={inputClass} />
      </label>
      <p className="text-xs text-ink-500">
        Stock sold from this order returns to the warehouse at its sale-time cost. The ledger
        row is never edited.
      </p>
      <Submit idle="Cancel order" busy="Cancelling…" tone="danger" />
    </form>
  );
}
