"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { registerDeviceAction, type OrderFormState } from "@/app/actions/orders";

const inputClass =
  "mt-1 block w-full min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm text-ink-900 shadow-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100";
const labelClass = "block text-sm font-medium text-ink-700";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="min-h-11 rounded-xl bg-brand-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Registering…" : "Register device"}
    </button>
  );
}

export function DeviceForm({
  stores,
  warehouses,
}: {
  stores: Array<{ id: string; code: string; name: string }>;
  warehouses: Array<{ id: string; code: string; name: string }>;
}) {
  const [state, formAction] = useActionState<OrderFormState, FormData>(
    registerDeviceAction,
    {},
  );
  const [fingerprint, setFingerprint] = useState("");

  return (
    <form action={formAction} className="space-y-4">
      {state.error ? (
        <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-200">
          {state.error}
        </p>
      ) : null}
      {state.success ? (
        <p className="rounded-xl bg-brand-50 px-3 py-2 text-sm text-brand-800 ring-1 ring-brand-200">
          {state.success}
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <label className={labelClass}>
          <span>Code</span>
          <input name="code" required maxLength={20} placeholder="POS-01" className={inputClass} />
        </label>
        <label className={labelClass}>
          <span>Name</span>
          <input
            name="name"
            required
            maxLength={120}
            placeholder="Front counter"
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          <span>Store</span>
          <select name="storeId" required className={inputClass}>
            {stores.map((store) => (
              <option key={store.id} value={store.id}>
                {store.code} · {store.name}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          <span>Warehouse (stock leaves from here)</span>
          <select name="warehouseId" required className={inputClass}>
            {warehouses.map((warehouse) => (
              <option key={warehouse.id} value={warehouse.id}>
                {warehouse.code} · {warehouse.name}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          <span>Device fingerprint</span>
          <div className="flex gap-2">
            <input
              name="deviceFingerprint"
              required
              maxLength={120}
              value={fingerprint}
              onChange={(event) => setFingerprint(event.target.value)}
              placeholder="Unique hardware or browser id"
              className={inputClass}
            />
            <button
              type="button"
              onClick={() => setFingerprint(crypto.randomUUID())}
              className="mt-1 shrink-0 rounded-xl border border-slate-300 px-3 text-xs font-medium"
            >
              Generate
            </button>
          </div>
        </label>
        <label className={labelClass}>
          <span>Platform (optional)</span>
          <input name="platform" maxLength={60} placeholder="Chrome / Android" className={inputClass} />
        </label>
      </div>

      <SubmitButton />
    </form>
  );
}
