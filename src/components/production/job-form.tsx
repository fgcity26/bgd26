"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  createProductionJobAction,
  type ProductionFormState,
} from "@/app/actions/production";

const inputClass =
  "mt-1 block w-full min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm text-ink-900 shadow-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100";

const labelClass = "block text-sm font-medium text-ink-700";

const qtyFormat = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 3,
});

export type ComponentOption = {
  id: string;
  sku: string;
  name: string;
  available: string;
};

type Row = { key: number; variantId: string; quantity: string };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="min-h-11 rounded-xl bg-brand-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Creating…" : "Create production job"}
    </button>
  );
}

export function JobForm({
  orderItemId,
  orderNumber,
  productName,
  variantName,
  sku,
  quantity,
  components,
  today,
}: {
  orderItemId: string;
  orderNumber: string;
  productName: string;
  variantName: string | null;
  sku: string;
  quantity: string;
  components: ComponentOption[];
  today: string;
}) {
  const [state, formAction] = useActionState<ProductionFormState, FormData>(
    createProductionJobAction,
    {},
  );
  const [rows, setRows] = useState<Row[]>([{ key: 0, variantId: "", quantity: "" }]);
  const [nextKey, setNextKey] = useState(1);

  const addRow = () => {
    setRows((current) => [...current, { key: nextKey, variantId: "", quantity: "" }]);
    setNextKey((key) => key + 1);
  };

  const update = (key: number, patch: Partial<Row>) => {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  };

  const remove = (key: number) => {
    setRows((current) => (current.length === 1 ? current : current.filter((row) => row.key !== key)));
  };

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="orderItemId" value={orderItemId} />

      {state.error ? (
        <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-200">
          {state.error}
        </p>
      ) : null}

      <div className="rounded-xl bg-white px-3 py-2 text-sm ring-1 ring-slate-200">
        <p className="text-xs text-ink-500">Producing</p>
        <p className="font-semibold text-ink-900">
          {productName}
          {variantName ? ` · ${variantName}` : ""}
        </p>
        <p className="text-xs text-ink-500">
          {orderNumber} · {sku} · {qtyFormat.format(Number(quantity))} unit(s)
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className={labelClass}>
          <span>
            Priority <span className="text-xs font-normal text-ink-500">গুরুত্ব</span>
          </span>
          <select name="priority" defaultValue="NORMAL" className={inputClass}>
            <option value="LOW">Low</option>
            <option value="NORMAL">Normal</option>
            <option value="HIGH">High</option>
            <option value="URGENT">Urgent</option>
          </select>
        </label>
        <label className={labelClass}>
          <span>
            Due date <span className="text-xs font-normal text-ink-500">সময়সীমা</span>
          </span>
          <input type="date" name="dueAt" defaultValue={today} className={inputClass} />
        </label>
      </div>

      <label className={labelClass}>
        <span>
          Engraving text <span className="text-xs font-normal text-ink-500">খোদাই লেখা</span>
        </span>
        <input
          name="engravingText"
          maxLength={200}
          placeholder="Name, date or short message"
          className={inputClass}
        />
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className={labelClass}>
          <span>
            Font <span className="text-xs font-normal text-ink-500">ফন্ট</span>
          </span>
          <input name="fontName" maxLength={80} className={inputClass} />
        </label>
        <label className={labelClass}>
          <span>
            Placement / instructions{" "}
            <span className="text-xs font-normal text-ink-500">নির্দেশনা</span>
          </span>
          <input name="instructions" maxLength={500} className={inputClass} />
        </label>
      </div>

      <label className={labelClass}>
        <span>
          Design notes <span className="text-xs font-normal text-ink-500">ডিজাইন নোট</span>
        </span>
        <textarea
          name="designNotes"
          rows={3}
          maxLength={1000}
          className={`${inputClass} py-2`}
        />
      </label>

      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold text-ink-700">
          Components to issue <span className="text-xs font-normal text-ink-500">উপকরণ</span>
        </legend>
        <p className="text-xs leading-relaxed text-ink-500">
          Optional. Components are taken from stock at average cost when production starts, and
          the value sits in work in progress until the job is completed.
        </p>

        {rows.map((row, index) => {
          const selected = components.find((component) => component.id === row.variantId);
          return (
            <div key={row.key} className="grid gap-3 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200 sm:grid-cols-[2fr_1fr_auto]">
              <label className="block text-sm font-medium text-ink-700">
                <span className="text-xs text-ink-500">Component {index + 1}</span>
                <select
                  name="variantId"
                  value={row.variantId}
                  onChange={(event) => update(row.key, { variantId: event.target.value })}
                  className={inputClass}
                >
                  <option value="">No component</option>
                  {components.map((component) => (
                    <option key={component.id} value={component.id}>
                      {component.sku} · {component.name} · {qtyFormat.format(Number(component.available))} available
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm font-medium text-ink-700">
                <span className="text-xs text-ink-500">Quantity</span>
                <input
                  name="quantity"
                  value={row.quantity}
                  onChange={(event) => update(row.key, { quantity: event.target.value })}
                  inputMode="decimal"
                  placeholder="0"
                  className={inputClass}
                />
              </label>
              <div className="flex items-end">
                <button
                  type="button"
                  onClick={() => remove(row.key)}
                  disabled={rows.length === 1}
                  className="min-h-11 rounded-xl border border-slate-300 px-3 text-xs font-semibold text-ink-700 hover:border-red-300 hover:text-red-700 disabled:opacity-40"
                >
                  Remove
                </button>
              </div>
              {selected ? (
                <p className="text-xs text-ink-500 sm:col-span-3">
                  {selected.name} · {qtyFormat.format(Number(selected.available))} available now
                </p>
              ) : null}
            </div>
          );
        })}

        <button
          type="button"
          onClick={addRow}
          className="min-h-10 rounded-xl border border-slate-300 px-3 text-xs font-semibold text-ink-700 hover:border-brand-300 hover:text-brand-700"
        >
          Add component
        </button>
      </fieldset>

      <SubmitButton />
    </form>
  );
}
