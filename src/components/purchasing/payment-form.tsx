"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  recordPurchasePaymentAction,
  type PurchasingFormState,
} from "@/app/actions/purchasing";

const inputClass =
  "mt-1 block w-full min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm text-ink-900 shadow-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100";

const labelClass = "block text-sm font-medium text-ink-700";

const moneyFormat = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export type SupplierOption = {
  id: string;
  name: string;
  code: string;
  outstanding: string;
};

export const SUPPLIER_METHOD_LABELS: Record<string, string> = {
  CASH: "Cash · নগদ",
  BKASH: "bKash · বিকাশ",
  NAGAD: "Nagad · নগদ",
  BANK_TRANSFER: "Bank transfer · ব্যাংক",
  CHEQUE: "Cheque · চেক",
  CARD: "Card · কার্ড",
};

function toNumber(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="min-h-11 rounded-xl bg-brand-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Recording…" : "Record payment"}
    </button>
  );
}

export function PaymentForm({
  suppliers,
  today,
  methods,
}: {
  suppliers: SupplierOption[];
  today: string;
  methods: readonly string[];
}) {
  const [state, formAction] = useActionState<PurchasingFormState, FormData>(
    recordPurchasePaymentAction,
    {},
  );
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? "");
  const [amount, setAmount] = useState("");

  const selected = suppliers.find((supplier) => supplier.id === supplierId);

  return (
    <form action={formAction} className="space-y-4">
      {state.error ? (
        <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-200">
          {state.error}
        </p>
      ) : null}

      <label className={labelClass}>
        <span>
          Supplier <span className="text-xs font-normal text-ink-500">সরবরাহকারী</span>
        </span>
        <select
          name="supplierId"
          value={supplierId}
          onChange={(event) => {
            const next = event.target.value;
            setSupplierId(next);
            const supplier = suppliers.find((row) => row.id === next);
            if (supplier && !amount) setAmount(supplier.outstanding);
          }}
          className={inputClass}
          required
        >
          {suppliers.length === 0 ? <option value="">No supplier with a balance</option> : null}
          {suppliers.map((supplier) => (
            <option key={supplier.id} value={supplier.id}>
              {supplier.name} ({supplier.code}) · owes ৳{moneyFormat.format(toNumber(supplier.outstanding))}
            </option>
          ))}
        </select>
      </label>

      {selected ? (
        <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-ink-600 ring-1 ring-slate-200">
          Outstanding with {selected.name}:{" "}
          <span className="font-semibold text-ink-900">
            ৳{moneyFormat.format(toNumber(selected.outstanding))}
          </span>
          . A payment can never be larger than this.
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <label className={labelClass}>
          <span>
            Amount (৳) <span className="text-xs font-normal text-ink-500">টাকা</span>
          </span>
          <input
            name="amount"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            inputMode="decimal"
            placeholder="0.00"
            className={inputClass}
            required
          />
        </label>
        <label className={labelClass}>
          <span>
            Paid from <span className="text-xs font-normal text-ink-500">যেভাবে</span>
          </span>
          <select name="method" defaultValue="CASH" className={inputClass}>
            {methods.map((method) => (
              <option key={method} value={method}>
                {SUPPLIER_METHOD_LABELS[method] ?? method}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          <span>
            Payment date <span className="text-xs font-normal text-ink-500">তারিখ</span>
          </span>
          <input
            type="date"
            name="paidAt"
            defaultValue={today}
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          <span>
            Reference <span className="text-xs font-normal text-ink-500">রেফারেন্স</span>
          </span>
          <input
            name="reference"
            maxLength={80}
            placeholder="Cheque no, bKash TrxID"
            className={inputClass}
          />
        </label>
      </div>

      <label className={labelClass}>
        <span>
          Note <span className="text-xs font-normal text-ink-500">নোট</span>
        </span>
        <input name="note" maxLength={300} className={inputClass} />
      </label>

      <SubmitButton />
    </form>
  );
}
