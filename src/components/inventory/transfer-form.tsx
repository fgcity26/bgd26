"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  createTransferAction,
  type InventoryFormState,
} from "@/app/actions/inventory";
import type { VariantOption, WarehouseOption } from "./opening-stock-form";

const inputClass =
  "mt-1 block w-full min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm text-ink-900 shadow-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100";

const labelClass = "block text-sm font-medium text-ink-700";

type Line = { key: number; variantId: string; quantity: string };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="min-h-11 rounded-xl bg-brand-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Saving…" : "Save draft transfer"}
    </button>
  );
}

export function TransferForm({
  warehouses,
  variants,
}: {
  warehouses: WarehouseOption[];
  variants: VariantOption[];
}) {
  const [state, formAction] = useActionState<InventoryFormState, FormData>(
    createTransferAction,
    {},
  );
  const [lines, setLines] = useState<Line[]>([
    { key: 1, variantId: variants[0]?.id ?? "", quantity: "1" },
  ]);
  const [nextKey, setNextKey] = useState(2);

  const fromDefault = warehouses[0]?.id ?? "";
  const toDefault = warehouses[1]?.id ?? warehouses[0]?.id ?? "";

  const updateLine = (key: number, patch: Partial<Line>) => {
    setLines((current) =>
      current.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    );
  };

  const addLine = () => {
    setLines((current) => [...current, { key: nextKey, variantId: "", quantity: "1" }]);
    setNextKey((value) => value + 1);
  };

  const removeLine = (key: number) => {
    setLines((current) =>
      current.length === 1 ? current : current.filter((line) => line.key !== key),
    );
  };

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
            From warehouse <span className="text-xs font-normal text-ink-500">যেখান থেকে</span>
          </span>
          <select name="fromWarehouseId" required defaultValue={fromDefault} className={inputClass}>
            {warehouses.map((warehouse) => (
              <option key={warehouse.id} value={warehouse.id}>
                {warehouse.code} · {warehouse.name}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          <span>
            To warehouse <span className="text-xs font-normal text-ink-500">যেখানে</span>
          </span>
          <select name="toWarehouseId" required defaultValue={toDefault} className={inputClass}>
            {warehouses.map((warehouse) => (
              <option key={warehouse.id} value={warehouse.id}>
                {warehouse.code} · {warehouse.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold text-ink-700">
          Lines <span className="text-xs font-normal text-ink-500">আইটেম</span>
        </legend>

        {lines.map((line, index) => (
          <div
            key={line.key}
            className="grid gap-3 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200 sm:grid-cols-[1fr_140px_auto]"
          >
            <label className="block text-sm font-medium text-ink-700">
              <span className="text-xs text-ink-500">Line {index + 1}</span>
              <select
                name="variantId"
                value={line.variantId}
                onChange={(event) => updateLine(line.key, { variantId: event.target.value })}
                className={inputClass}
              >
                <option value="">Choose a variant…</option>
                {variants.map((variant) => (
                  <option key={variant.id} value={variant.id}>
                    {variant.sku} · {variant.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm font-medium text-ink-700">
              <span className="text-xs text-ink-500">Quantity</span>
              <input
                name="quantity"
                value={line.quantity}
                onChange={(event) => updateLine(line.key, { quantity: event.target.value })}
                inputMode="decimal"
                className={inputClass}
              />
            </label>
            <div className="flex items-end">
              <button
                type="button"
                onClick={() => removeLine(line.key)}
                disabled={lines.length === 1}
                className="min-h-11 rounded-xl border border-slate-300 px-3 text-xs font-medium text-ink-700 hover:border-red-300 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Remove
              </button>
            </div>
          </div>
        ))}

        <button
          type="button"
          onClick={addLine}
          className="min-h-11 rounded-xl border border-slate-300 px-4 text-sm font-semibold text-ink-700 hover:border-brand-300 hover:text-brand-700"
        >
          + Add line
        </button>
      </fieldset>

      <label className={labelClass}>
        <span>
          Notes <span className="text-xs font-normal text-ink-500">নোট</span>
        </span>
        <input
          name="notes"
          maxLength={500}
          placeholder="Van leaving after the evening count"
          className={inputClass}
        />
      </label>

      <div className="rounded-xl bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800 ring-1 ring-amber-200">
        Sending posts stock out of the source. Receiving posts it into the destination at the same
        unit cost. Until the destination receives it, the stock is in transit.
        <span className="mt-1 block">
          পাঠালে স্টক বের হবে, গ্রহণ করলে গন্তব্যে ঢুকবে; ততক্ষণ স্টকটি পথে থাকে।
        </span>
      </div>

      <SubmitButton />
    </form>
  );
}
