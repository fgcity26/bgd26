"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  postOpeningStockAction,
  type InventoryFormState,
} from "@/app/actions/inventory";

const inputClass =
  "mt-1 block w-full min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm text-ink-900 shadow-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100";

const labelClass = "block text-sm font-medium text-ink-700";

export type WarehouseOption = { id: string; code: string; name: string };
export type VariantOption = { id: string; sku: string; label: string };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="min-h-11 rounded-xl bg-brand-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Posting…" : "Post opening stock"}
    </button>
  );
}

export function OpeningStockForm({
  warehouses,
  variants,
  defaultWarehouseId,
  defaultVariantId,
}: {
  warehouses: WarehouseOption[];
  variants: VariantOption[];
  defaultWarehouseId?: string;
  defaultVariantId?: string;
}) {
  const [state, formAction] = useActionState<InventoryFormState, FormData>(
    postOpeningStockAction,
    {},
  );

  return (
    <form action={formAction} className="space-y-4">
      {state.error ? (
        <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-200">
          {state.error}
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <label className={labelClass}>
          <span>
            Warehouse <span className="text-xs font-normal text-ink-500">গুদাম</span>
          </span>
          <select
            name="warehouseId"
            required
            defaultValue={defaultWarehouseId ?? warehouses[0]?.id ?? ""}
            className={inputClass}
          >
            {warehouses.map((warehouse) => (
              <option key={warehouse.id} value={warehouse.id}>
                {warehouse.code} · {warehouse.name}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          <span>
            Variant <span className="text-xs font-normal text-ink-500">ভ্যারিয়েন্ট</span>
          </span>
          <select
            name="variantId"
            required
            defaultValue={defaultVariantId ?? variants[0]?.id ?? ""}
            className={inputClass}
          >
            {variants.map((variant) => (
              <option key={variant.id} value={variant.id}>
                {variant.sku} · {variant.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className={labelClass}>
          <span>
            Quantity <span className="text-xs font-normal text-ink-500">পরিমাণ</span>
          </span>
          <input
            name="quantity"
            required
            inputMode="decimal"
            placeholder="0.000"
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          <span>
            Unit cost (৳) <span className="text-xs font-normal text-ink-500">একক খরচ</span>
          </span>
          <input
            name="unitCost"
            required
            inputMode="decimal"
            placeholder="0.0000"
            className={inputClass}
          />
        </label>
      </div>

      <label className={labelClass}>
        <span>
          Note <span className="text-xs font-normal text-ink-500">নোট</span>
        </span>
        <input
          name="note"
          maxLength={500}
          placeholder="Counted at handover from the old register"
          className={inputClass}
        />
      </label>

      <div className="rounded-xl bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800 ring-1 ring-amber-200">
        Opening stock can be posted once per variant and warehouse. It sets the moving average
        cost and writes an append-only ledger row. Later corrections use an adjustment.
        <span className="mt-1 block">
          একবারই ওপেনিং স্টক দেওয়া যায়; পরে সংশোধন করতে অ্যাডজাস্টমেন্ট ব্যবহার করুন।
        </span>
      </div>

      <SubmitButton />
    </form>
  );
}
