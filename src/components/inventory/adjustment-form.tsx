"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  createAdjustmentAction,
  type InventoryFormState,
} from "@/app/actions/inventory";
import type { VariantOption, WarehouseOption } from "./opening-stock-form";

const inputClass =
  "mt-1 block w-full min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm text-ink-900 shadow-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100";

const labelClass = "block text-sm font-medium text-ink-700";

const TYPES = [
  { value: "INCREASE", label: "Increase (found stock)", hint: "Adds sellable stock at the cost you enter." },
  { value: "DECREASE", label: "Decrease (missing stock)", hint: "Removes sellable stock at the moving average cost." },
  { value: "DAMAGE", label: "Damage", hint: "Physical stock stays; damaged increases and available falls." },
  { value: "QUARANTINE", label: "Quarantine", hint: "Physical stock stays; quarantined increases and available falls." },
  { value: "WRITE_OFF", label: "Write off", hint: "Removes damaged units first, then sellable units." },
] as const;

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="min-h-11 rounded-xl bg-brand-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Saving…" : "Save draft adjustment"}
    </button>
  );
}

export function AdjustmentForm({
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
    createAdjustmentAction,
    {},
  );
  const [type, setType] = useState<string>("DECREASE");
  const selected = TYPES.find((option) => option.value === type) ?? TYPES[0];

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

      <div className="grid gap-4 sm:grid-cols-3">
        <label className={labelClass}>
          <span>
            Type <span className="text-xs font-normal text-ink-500">ধরন</span>
          </span>
          <select
            name="adjustmentType"
            value={type}
            onChange={(event) => setType(event.target.value)}
            className={inputClass}
          >
            {TYPES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
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
            Unit cost (৳){" "}
            <span className="text-xs font-normal text-ink-500">
              {type === "INCREASE" ? "required" : "not used"}
            </span>
          </span>
          <input
            name="unitCost"
            required={type === "INCREASE"}
            disabled={type !== "INCREASE"}
            inputMode="decimal"
            placeholder="0.0000"
            className={`${inputClass} disabled:bg-slate-100 disabled:text-ink-500`}
          />
        </label>
      </div>

      <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs leading-relaxed text-ink-700 ring-1 ring-slate-200">
        {selected.hint}
      </p>

      <label className={labelClass}>
        <span>
          Reason <span className="text-xs font-normal text-ink-500">কারণ</span>
        </span>
        <textarea
          name="reason"
          required
          rows={2}
          minLength={3}
          maxLength={500}
          placeholder="Physical count on 16 Nov found two broken units."
          className={`${inputClass} py-2`}
        />
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton />
        <p className="text-xs text-ink-500">
          A draft changes nothing. A manager with <code>inventory.approve</code> posts it, and
          posting writes the ledger.
        </p>
      </div>
    </form>
  );
}
