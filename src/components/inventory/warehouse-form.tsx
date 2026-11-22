"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  createWarehouseAction,
  updateWarehouseAction,
  type InventoryFormState,
} from "@/app/actions/inventory";

const inputClass =
  "mt-1 block w-full min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm text-ink-900 shadow-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100";

const labelClass = "block text-sm font-medium text-ink-700";

export type WarehouseValues = {
  id: string;
  code: string;
  name: string;
  nameBn: string | null;
  type: string;
  division: string | null;
  district: string | null;
  address: string | null;
  isDefault: boolean;
  isActive: boolean;
};

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="min-h-11 rounded-xl bg-brand-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Saving…" : label}
    </button>
  );
}

export function WarehouseForm({
  mode,
  warehouse,
}: {
  mode: "create" | "edit";
  warehouse?: WarehouseValues;
}) {
  const action = mode === "create" ? createWarehouseAction : updateWarehouseAction;
  const [state, formAction] = useActionState<InventoryFormState, FormData>(action, {});

  return (
    <form action={formAction} className="space-y-4">
      {mode === "edit" && warehouse ? <input type="hidden" name="id" value={warehouse.id} /> : null}

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
          <span>
            Code <span className="text-xs font-normal text-ink-500">কোড</span>
          </span>
          <input
            name="code"
            required
            maxLength={20}
            placeholder="WH-DHAKA"
            defaultValue={warehouse?.code ?? ""}
            className={inputClass}
          />
          <span className="mt-1 block text-xs font-normal text-ink-500">
            Short, unique, letters/numbers/hyphens.
          </span>
        </label>
        <label className={labelClass}>
          <span>
            Type <span className="text-xs font-normal text-ink-500">ধরন</span>
          </span>
          <select name="type" defaultValue={warehouse?.type ?? "SECONDARY"} className={inputClass}>
            <option value="MAIN">Main</option>
            <option value="SECONDARY">Secondary</option>
            <option value="TRANSIT">Transit</option>
            <option value="VIRTUAL_DROPSHIP">Virtual dropship</option>
          </select>
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className={labelClass}>
          <span>
            Name <span className="text-xs font-normal text-ink-500">নাম</span>
          </span>
          <input
            name="name"
            required
            maxLength={120}
            placeholder="Dhaka Warehouse"
            defaultValue={warehouse?.name ?? ""}
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          <span>
            Name in Bangla <span className="text-xs font-normal text-ink-500">বাংলা নাম</span>
          </span>
          <input
            name="nameBn"
            maxLength={120}
            placeholder="ঢাকা গুদাম"
            defaultValue={warehouse?.nameBn ?? ""}
            className={inputClass}
          />
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className={labelClass}>
          <span>Division</span>
          <input
            name="division"
            maxLength={60}
            placeholder="Dhaka"
            defaultValue={warehouse?.division ?? ""}
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          <span>District</span>
          <input
            name="district"
            maxLength={60}
            placeholder="Dhaka"
            defaultValue={warehouse?.district ?? ""}
            className={inputClass}
          />
        </label>
      </div>

      <label className={labelClass}>
        <span>Address</span>
        <textarea
          name="address"
          rows={2}
          maxLength={300}
          defaultValue={warehouse?.address ?? ""}
          className={`${inputClass} py-2`}
        />
      </label>

      <div className="flex flex-wrap gap-5 border-t border-slate-200 pt-4">
        <label className="flex min-h-11 items-center gap-2 text-sm text-ink-700">
          <input
            type="checkbox"
            name="isDefault"
            className="size-4"
            defaultChecked={warehouse?.isDefault ?? false}
          />
          Default warehouse
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm text-ink-700">
          <input
            type="checkbox"
            name="isActive"
            className="size-4"
            defaultChecked={warehouse?.isActive ?? true}
          />
          Active
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton label={mode === "create" ? "Create warehouse" : "Save warehouse"} />
        <p className="text-xs text-ink-500">
          A warehouse holding stock cannot be deactivated until the stock is transferred out.
        </p>
      </div>
    </form>
  );
}
