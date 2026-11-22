"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  createPurchaseReturnAction,
  type PurchasingFormState,
} from "@/app/actions/purchasing";
import { SUPPLIER_METHOD_LABELS } from "@/components/purchasing/payment-form";

const inputClass =
  "mt-1 block w-full min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm text-ink-900 shadow-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100";

const labelClass = "block text-sm font-medium text-ink-700";

const moneyFormat = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const qtyFormat = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 3,
});

export type ReturnableLine = {
  id: string;
  sku: string;
  description: string;
  received: string;
  returned: string;
  returnable: string;
  unitCost: string;
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
      {pending ? "Saving…" : "Save draft return"}
    </button>
  );
}

export function ReturnForm({
  grnId,
  grnNumber,
  supplierName,
  lines,
  methods,
}: {
  grnId: string;
  grnNumber: string;
  supplierName: string;
  lines: ReturnableLine[];
  methods: readonly string[];
}) {
  const [state, formAction] = useActionState<PurchasingFormState, FormData>(
    createPurchaseReturnAction,
    {},
  );
  const [quantities, setQuantities] = useState<Record<string, string>>(() =>
    Object.fromEntries(lines.map((line) => [line.id, ""])),
  );

  const total = lines.reduce((sum, line) => {
    const quantity = toNumber(quantities[line.id] ?? "");
    return sum + quantity * toNumber(line.unitCost);
  }, 0);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="grnId" value={grnId} />

      {state.error ? (
        <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-200">
          {state.error}
        </p>
      ) : null}

      <div className="rounded-xl bg-white px-3 py-2 text-sm ring-1 ring-slate-200">
        <p className="text-xs text-ink-500">Returning against</p>
        <p className="font-semibold text-ink-900">
          {grnNumber} · {supplierName}
        </p>
      </div>

      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold text-ink-700">
          Lines going back <span className="text-xs font-normal text-ink-500">ফেরত আইটেম</span>
        </legend>

        {lines.map((line, index) => {
          const entered = toNumber(quantities[line.id] ?? "");
          const over = entered > toNumber(line.returnable);
          return (
            <div
              key={line.id}
              className="space-y-3 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200"
            >
              <input type="hidden" name="goodsReceivedItemId" value={line.id} />

              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs text-ink-500">Line {index + 1} · {line.sku}</p>
                  <p className="text-sm font-medium text-ink-900">{line.description}</p>
                </div>
                <p className="text-xs text-ink-500">
                  Received {qtyFormat.format(toNumber(line.received))} · returned{" "}
                  {qtyFormat.format(toNumber(line.returned))} · returnable{" "}
                  <span className="font-semibold text-ink-700">
                    {qtyFormat.format(toNumber(line.returnable))}
                  </span>
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm font-medium text-ink-700">
                  <span className="text-xs text-ink-500">Quantity to return</span>
                  <input
                    name="quantity"
                    value={quantities[line.id] ?? ""}
                    onChange={(event) =>
                      setQuantities((current) => ({
                        ...current,
                        [line.id]: event.target.value,
                      }))
                    }
                    inputMode="decimal"
                    placeholder={qtyFormat.format(toNumber(line.returnable))}
                    aria-invalid={over}
                    className={`${inputClass} ${over ? "border-red-400" : ""}`}
                  />
                </label>
                <p className="self-end text-right text-xs text-ink-500">
                  Book value ৳{moneyFormat.format(entered * toNumber(line.unitCost))}
                </p>
              </div>
              {over ? (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800 ring-1 ring-red-200">
                  Only {qtyFormat.format(toNumber(line.returnable))} can still be returned.
                </p>
              ) : null}
            </div>
          );
        })}
      </fieldset>

      <label className={labelClass}>
        <span>
          Why is it going back? <span className="text-xs font-normal text-ink-500">কারণ</span>
        </span>
        <input
          name="reason"
          maxLength={300}
          placeholder="Wrong item, damaged, expired…"
          className={inputClass}
          required
        />
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className={labelClass}>
          <span>
            Supplier refund <span className="text-xs font-normal text-ink-500">ফেরত</span>
          </span>
          <select name="refundMethod" defaultValue="" className={inputClass}>
            <option value="">No money yet — credit note only</option>
            {methods.map((method) => (
              <option key={method} value={method}>
                {SUPPLIER_METHOD_LABELS[method] ?? method}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          <span>
            Refund reference <span className="text-xs font-normal text-ink-500">রেফারেন্স</span>
          </span>
          <input name="refundReference" maxLength={80} className={inputClass} />
        </label>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-slate-200">
        <p className="text-xs text-ink-600">
          Estimated credit at goods-receipt cost. The posted value is the stock
          ledger&apos;s average cost when the return is approved.
        </p>
        <p className="text-sm font-semibold tabular-nums">৳{moneyFormat.format(total)}</p>
      </div>

      <SubmitButton />
    </form>
  );
}
