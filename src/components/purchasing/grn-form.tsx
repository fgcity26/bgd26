"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  createGrnAction,
  type PurchasingFormState,
} from "@/app/actions/purchasing";
import type { WarehouseOption } from "@/components/inventory/opening-stock-form";

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

export type OutstandingLine = {
  id: string;
  description: string;
  quantity: string;
  receivedQty: string;
  unitCost: string;
  outstanding: string;
};

function money(value: number): string {
  return moneyFormat.format(Number.isFinite(value) ? value : 0);
}

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
      {pending ? "Saving…" : "Save draft goods receipt"}
    </button>
  );
}

type Entry = {
  quantity: string;
  unitCost: string;
  condition: "GOOD" | "DAMAGED" | "QUARANTINED";
  batchNumber: string;
  expiryDate: string;
};

export function GrnForm({
  purchaseOrderId,
  poNumber,
  defaultWarehouseId,
  warehouses,
  lines,
}: {
  purchaseOrderId: string;
  poNumber: string;
  defaultWarehouseId: string;
  warehouses: WarehouseOption[];
  lines: OutstandingLine[];
}) {
  const [state, formAction] = useActionState<PurchasingFormState, FormData>(
    createGrnAction,
    {},
  );

  const [entries, setEntries] = useState<Record<string, Entry>>(() =>
    Object.fromEntries(
      lines.map((line) => [
        line.id,
        {
          quantity: "",
          unitCost: line.unitCost,
          condition: "GOOD" as const,
          batchNumber: "",
          expiryDate: "",
        },
      ]),
    ),
  );

  const update = (id: string, patch: Partial<Entry>) => {
    setEntries((current) => ({ ...current, [id]: { ...current[id], ...patch } }));
  };

  const total = lines.reduce((sum, line) => {
    const entry = entries[line.id];
    if (!entry) return sum;
    return sum + toNumber(entry.quantity) * toNumber(entry.unitCost);
  }, 0);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="purchaseOrderId" value={purchaseOrderId} />

      {state.error ? (
        <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-200">
          {state.error}
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl bg-white px-3 py-2 text-sm ring-1 ring-slate-200">
          <p className="text-xs text-ink-500">Purchase order</p>
          <p className="font-semibold text-ink-900">{poNumber}</p>
        </div>
        <label className={labelClass}>
          <span>
            Receiving warehouse{" "}
            <span className="text-xs font-normal text-ink-500">গুদাম</span>
          </span>
          <select
            name="warehouseId"
            defaultValue={defaultWarehouseId}
            className={inputClass}
          >
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
          Received lines <span className="text-xs font-normal text-ink-500">গৃহীত আইটেম</span>
        </legend>

        {lines.map((line, index) => {
          const entry = entries[line.id];
          if (!entry) return null;
          return (
            <div
              key={line.id}
              className="space-y-3 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200"
            >
              <input type="hidden" name="purchaseItemId" value={line.id} />

              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs text-ink-500">Line {index + 1}</p>
                  <p className="text-sm font-medium text-ink-900">{line.description}</p>
                </div>
                <p className="text-xs text-ink-500">
                  Ordered {qtyFormat.format(toNumber(line.quantity))} · received{" "}
                  {qtyFormat.format(toNumber(line.receivedQty))} · outstanding{" "}
                  <span className="font-semibold text-ink-700">
                    {qtyFormat.format(toNumber(line.outstanding))}
                  </span>
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <label className="block text-sm font-medium text-ink-700">
                  <span className="text-xs text-ink-500">Received now</span>
                  <input
                    name="quantity"
                    value={entry.quantity}
                    onChange={(event) => update(line.id, { quantity: event.target.value })}
                    inputMode="decimal"
                    placeholder={qtyFormat.format(toNumber(line.outstanding))}
                    className={inputClass}
                  />
                </label>
                <label className="block text-sm font-medium text-ink-700">
                  <span className="text-xs text-ink-500">Landed unit cost (৳)</span>
                  <input
                    name="unitCost"
                    value={entry.unitCost}
                    onChange={(event) => update(line.id, { unitCost: event.target.value })}
                    inputMode="decimal"
                    className={inputClass}
                  />
                </label>
                <label className="block text-sm font-medium text-ink-700">
                  <span className="text-xs text-ink-500">Condition</span>
                  <select
                    name="condition"
                    value={entry.condition}
                    onChange={(event) =>
                      update(line.id, {
                        condition: event.target.value as Entry["condition"],
                      })
                    }
                    className={inputClass}
                  >
                    <option value="GOOD">Good</option>
                    <option value="DAMAGED">Damaged</option>
                    <option value="QUARANTINED">Quarantined</option>
                  </select>
                </label>
                <label className="block text-sm font-medium text-ink-700">
                  <span className="text-xs text-ink-500">Batch number</span>
                  <input
                    name="batchNumber"
                    value={entry.batchNumber}
                    onChange={(event) => update(line.id, { batchNumber: event.target.value })}
                    maxLength={60}
                    className={inputClass}
                  />
                </label>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm font-medium text-ink-700">
                  <span className="text-xs text-ink-500">Expiry date</span>
                  <input
                    name="expiryDate"
                    type="date"
                    value={entry.expiryDate}
                    onChange={(event) => update(line.id, { expiryDate: event.target.value })}
                    className={inputClass}
                  />
                </label>
                <p className="self-end text-right text-xs text-ink-500">
                  Line value ৳{money(toNumber(entry.quantity) * toNumber(entry.unitCost))}
                </p>
              </div>

              {entry.condition !== "GOOD" ? (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800 ring-1 ring-amber-200">
                  {entry.condition === "DAMAGED"
                    ? "Damaged units are received into damaged stock: physical stock rises, available stock does not."
                    : "Quarantined units are held: physical stock rises, available stock does not."}
                </p>
              ) : null}
            </div>
          );
        })}
      </fieldset>

      <label className={labelClass}>
        <span>
          Notes <span className="text-xs font-normal text-ink-500">নোট</span>
        </span>
        <textarea
          name="notes"
          rows={2}
          maxLength={500}
          placeholder="Truck arrived with two cartons short; counted with the supplier's driver."
          className={`${inputClass} py-2`}
        />
      </label>

      <div className="rounded-xl bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800 ring-1 ring-amber-200">
        Enter the landed cost per unit — the ordered cost plus freight, duty or handling for this
        delivery. That value enters the moving average when a manager posts the receipt. Leave a
        quantity blank to receive nothing on that line.
        <span className="mt-1 block">
          পরিবহন ও শুল্কসহ প্রতি ইউনিটের প্রকৃত খরচ দিন। ম্যানেজার পোস্ট করলে স্টক ও গড় খরচ হালনাগাদ
          হবে।
        </span>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <SubmitButton />
        <p className="text-sm font-medium text-ink-700">
          Receipt value ৳{money(total)}
        </p>
      </div>
    </form>
  );
}
