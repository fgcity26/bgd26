"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  createCustomerAction,
  updateCustomerAction,
  type CustomerFormState,
} from "@/app/actions/customers";

const inputClass =
  "mt-1 block w-full min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm text-ink-900 shadow-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100";

const labelClass = "block text-sm font-medium text-ink-700";

export type CustomerValues = {
  id: string;
  fullName: string;
  mobileRaw: string | null;
  mobileNormalized: string;
  email: string | null;
  customerType: string;
  tags: string[];
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

export function CustomerForm({
  mode,
  customer,
}: {
  mode: "create" | "edit";
  customer?: CustomerValues;
}) {
  const action = mode === "create" ? createCustomerAction : updateCustomerAction;
  const [state, formAction] = useActionState<CustomerFormState, FormData>(action, {});

  return (
    <form action={formAction} className="space-y-4">
      {mode === "edit" && customer ? <input type="hidden" name="id" value={customer.id} /> : null}

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
            Full name <span className="text-xs font-normal text-ink-500">পুরো নাম</span>
          </span>
          <input
            name="fullName"
            required
            maxLength={160}
            defaultValue={customer?.fullName ?? ""}
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          <span>
            Mobile <span className="text-xs font-normal text-ink-500">মোবাইল</span>
          </span>
          <input
            name="mobile"
            required
            inputMode="tel"
            placeholder="01712-345678"
            defaultValue={customer?.mobileRaw ?? customer?.mobileNormalized ?? ""}
            className={inputClass}
          />
          <span className="mt-1 block text-xs font-normal text-ink-500">
            Stored once as +8801XXXXXXXXX; duplicates are refused.
          </span>
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className={labelClass}>
          <span>
            Email <span className="text-xs font-normal text-ink-500">ইমেইল</span>
          </span>
          <input
            name="email"
            type="email"
            maxLength={200}
            defaultValue={customer?.email ?? ""}
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          <span>
            Customer type <span className="text-xs font-normal text-ink-500">ধরন</span>
          </span>
          <select
            name="customerType"
            defaultValue={customer?.customerType ?? "RETAIL"}
            className={inputClass}
          >
            <option value="RETAIL">Retail</option>
            <option value="WHOLESALE">Wholesale</option>
            <option value="DROPSHIP_PARTNER">Dropship partner</option>
            <option value="WALK_IN_CASH">Walk-in cash</option>
          </select>
        </label>
      </div>

      <label className={labelClass}>
        <span>
          Tags <span className="text-xs font-normal text-ink-500">ট্যাগ</span>
        </span>
        <input
          name="tags"
          maxLength={600}
          placeholder="vip, dhaka, wholesale"
          defaultValue={customer?.tags.join(", ") ?? ""}
          className={inputClass}
        />
        <span className="mt-1 block text-xs font-normal text-ink-500">
          Comma separated. Useful for segments and follow-up.
        </span>
      </label>

      <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 pt-4">
        <SubmitButton label={mode === "create" ? "Create customer" : "Save changes"} />
        <p className="text-xs text-ink-500">
          Customers are never hard-deleted; orders and payments keep their history.
        </p>
      </div>
    </form>
  );
}
