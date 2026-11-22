"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  addCustomerAddressAction,
  type CustomerFormState,
} from "@/app/actions/customers";

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
      {pending ? "Adding…" : "Add address"}
    </button>
  );
}

export function AddressForm({
  customerId,
  defaultMobile,
}: {
  customerId: string;
  defaultMobile: string;
}) {
  const [state, formAction] = useActionState<CustomerFormState, FormData>(
    addCustomerAddressAction,
    {},
  );

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="customerId" value={customerId} />

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

      <div className="grid gap-3 sm:grid-cols-3">
        <label className={labelClass}>
          <span>Label</span>
          <input name="label" maxLength={40} placeholder="Home" className={inputClass} />
        </label>
        <label className={labelClass}>
          <span>
            Recipient <span className="text-xs font-normal text-ink-500">প্রাপক</span>
          </span>
          <input name="recipientName" required maxLength={160} className={inputClass} />
        </label>
        <label className={labelClass}>
          <span>Mobile</span>
          <input
            name="mobile"
            required
            inputMode="tel"
            defaultValue={defaultMobile}
            className={inputClass}
          />
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className={labelClass}>
          <span>
            Division <span className="text-xs font-normal text-ink-500">বিভাগ</span>
          </span>
          <input name="division" required maxLength={60} placeholder="Dhaka" className={inputClass} />
        </label>
        <label className={labelClass}>
          <span>
            District <span className="text-xs font-normal text-ink-500">জেলা</span>
          </span>
          <input name="district" required maxLength={60} placeholder="Dhaka" className={inputClass} />
        </label>
        <label className={labelClass}>
          <span>
            Upazila <span className="text-xs font-normal text-ink-500">উপজেলা</span>
          </span>
          <input name="upazila" required maxLength={60} placeholder="Mirpur" className={inputClass} />
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr]">
        <label className={labelClass}>
          <span>Area</span>
          <input name="area" maxLength={120} placeholder="Block C" className={inputClass} />
        </label>
        <label className={labelClass}>
          <span>Postcode</span>
          <input name="postcode" maxLength={12} inputMode="numeric" className={inputClass} />
        </label>
        <label className={labelClass}>
          <span>Type</span>
          <select name="addressType" defaultValue="SHIPPING" className={inputClass}>
            <option value="SHIPPING">Shipping</option>
            <option value="BILLING">Billing</option>
            <option value="BOTH">Both</option>
          </select>
        </label>
      </div>

      <label className={labelClass}>
        <span>
          Street address <span className="text-xs font-normal text-ink-500">ঠিকানা</span>
        </span>
        <textarea
          name="addressLine"
          required
          rows={2}
          maxLength={300}
          placeholder="House 12, Road 4"
          className={inputClass}
        />
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton />
        <label className="flex min-h-11 items-center gap-2 text-sm text-ink-700">
          <input type="checkbox" name="isDefault" className="size-4" />
          Make this the default address
        </label>
      </div>
    </form>
  );
}
