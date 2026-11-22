"use client";

import { useFormStatus } from "react-dom";
import { requestRefundAction } from "@/app/actions/orders";

const inputClass =
  "mt-1 block w-full min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm text-ink-900 shadow-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100";
const labelClass = "block text-sm font-medium text-ink-700";

const moneyFormat = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export type RefundableItem = {
  id: string;
  label: string;
  sku: string;
  quantity: string;
  refundedQty: string;
  remaining: string;
  unitPrice: string;
  lineTotal: string;
};

const METHODS = [
  { value: "CASH", label: "Cash" },
  { value: "BKASH", label: "bKash" },
  { value: "NAGAD", label: "Nagad" },
  { value: "CARD", label: "Card" },
  { value: "BANK_TRANSFER", label: "Bank transfer" },
] as const;

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="min-h-11 rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Requesting…" : "Request refund"}
    </button>
  );
}

export function RefundForm({
  orderId,
  items,
  payments,
}: {
  orderId: string;
  items: RefundableItem[];
  payments: Array<{ id: string; label: string }>;
}) {
  const refundable = items.filter((item) => Number(item.remaining) > 0);

  if (refundable.length === 0) {
    return <p className="text-sm text-ink-500">Every item on this order has been refunded.</p>;
  }

  return (
    <form action={requestRefundAction} className="space-y-3">
      <input type="hidden" name="orderId" value={orderId} />

      <ul className="space-y-2">
        {refundable.map((item) => (
          <li key={item.id} className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
            <input type="hidden" name="orderItemId" value={item.id} />
            <p className="text-sm font-medium">
              {item.label} <span className="text-xs text-ink-500">({item.sku})</span>
            </p>
            <p className="text-xs text-ink-500">
              Sold {item.quantity} · already refunded {item.refundedQty} · left {item.remaining} ·
              ৳{moneyFormat.format(Number(item.lineTotal))}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <label className="text-xs font-medium text-ink-600">
                Refund qty
                <input
                  name="quantity"
                  inputMode="decimal"
                  defaultValue="0"
                  className="ml-2 min-h-9 w-24 rounded-lg border border-slate-300 px-2 text-right text-sm"
                />
              </label>
              <label className="flex items-center gap-2 text-xs text-ink-600">
                <input type="checkbox" name="restock" value={item.id} defaultChecked />
                Restock this item
              </label>
            </div>
          </li>
        ))}
      </ul>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelClass}>
          <span>Refund via</span>
          <select name="method" className={inputClass} defaultValue="CASH">
            {METHODS.map((method) => (
              <option key={method.value} value={method.value}>
                {method.label}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          <span>Original payment (optional)</span>
          <select name="paymentId" className={inputClass} defaultValue="">
            <option value="">Not linked</option>
            {payments.map((payment) => (
              <option key={payment.id} value={payment.id}>
                {payment.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className={labelClass}>
        <span>Reason</span>
        <input name="reason" required minLength={3} maxLength={300} className={inputClass} />
      </label>
      <label className={labelClass}>
        <span>Internal notes (optional)</span>
        <input name="notes" maxLength={500} className={inputClass} />
      </label>
      <p className="text-xs text-ink-500">
        A refund is requested first. A manager approves it (which restocks what you ticked), then
        completes the payout. Stock only moves on approval.
      </p>
      <Submit />
    </form>
  );
}
