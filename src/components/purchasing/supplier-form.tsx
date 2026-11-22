"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  createSupplierAction,
  updateSupplierAction,
  type PurchasingFormState,
} from "@/app/actions/purchasing";

const inputClass =
  "mt-1 block w-full min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm text-ink-900 shadow-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100";

const labelClass = "block text-sm font-medium text-ink-700";

export type SupplierDefaults = {
  id?: string;
  code?: string;
  name?: string;
  nameBn?: string | null;
  contactPerson?: string | null;
  mobile?: string | null;
  email?: string | null;
  address?: string | null;
  division?: string | null;
  district?: string | null;
  paymentTermsDays?: number;
  leadTimeDays?: number;
  isDropshipVendor?: boolean;
  status?: "ACTIVE" | "INACTIVE" | "BLACKLISTED";
  notes?: string | null;
};

function SubmitButton({ editing }: { editing: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="min-h-11 rounded-xl bg-brand-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Saving…" : editing ? "Save supplier" : "Create supplier"}
    </button>
  );
}

export function SupplierForm({ supplier }: { supplier?: SupplierDefaults }) {
  const editing = Boolean(supplier?.id);
  const [state, formAction] = useActionState<PurchasingFormState, FormData>(
    editing ? updateSupplierAction : createSupplierAction,
    {},
  );

  return (
    <form action={formAction} className="space-y-4">
      {supplier?.id ? <input type="hidden" name="id" value={supplier.id} /> : null}
      <input type="hidden" name="status" value={supplier?.status ?? "ACTIVE"} />

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
            Name <span className="text-xs font-normal text-ink-500">নাম</span>
          </span>
          <input
            name="name"
            required
            minLength={2}
            maxLength={120}
            defaultValue={supplier?.name ?? ""}
            placeholder="Dhaka Engraving Supplies"
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          <span>
            Name in Bangla{" "}
            <span className="text-xs font-normal text-ink-500">বাংলা নাম</span>
          </span>
          <input
            name="nameBn"
            maxLength={120}
            defaultValue={supplier?.nameBn ?? ""}
            placeholder="ঢাকা এনগ্রেভিং সাপ্লাইজ"
            className={inputClass}
          />
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className={labelClass}>
          <span>
            Supplier code <span className="text-xs font-normal text-ink-500">কোড</span>
          </span>
          <input
            name="code"
            maxLength={30}
            defaultValue={supplier?.code ?? ""}
            placeholder="Leave blank to generate"
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          <span>
            Contact person{" "}
            <span className="text-xs font-normal text-ink-500">যোগাযোগ</span>
          </span>
          <input
            name="contactPerson"
            maxLength={120}
            defaultValue={supplier?.contactPerson ?? ""}
            placeholder="Rahim Uddin"
            className={inputClass}
          />
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className={labelClass}>
          <span>
            Mobile <span className="text-xs font-normal text-ink-500">মোবাইল</span>
          </span>
          <input
            name="mobile"
            inputMode="tel"
            maxLength={30}
            defaultValue={supplier?.mobile ?? ""}
            placeholder="01712-345678"
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          <span>
            Email <span className="text-xs font-normal text-ink-500">ইমেইল</span>
          </span>
          <input
            name="email"
            type="email"
            maxLength={160}
            defaultValue={supplier?.email ?? ""}
            placeholder="orders@supplier.com"
            className={inputClass}
          />
        </label>
      </div>

      <label className={labelClass}>
        <span>
          Address <span className="text-xs font-normal text-ink-500">ঠিকানা</span>
        </span>
        <textarea
          name="address"
          rows={2}
          maxLength={300}
          defaultValue={supplier?.address ?? ""}
          placeholder="Shop 12, Nawabpur Road"
          className={`${inputClass} py-2`}
        />
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className={labelClass}>
          <span>
            Division <span className="text-xs font-normal text-ink-500">বিভাগ</span>
          </span>
          <input
            name="division"
            maxLength={60}
            defaultValue={supplier?.division ?? ""}
            placeholder="Dhaka"
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          <span>
            District <span className="text-xs font-normal text-ink-500">জেলা</span>
          </span>
          <input
            name="district"
            maxLength={60}
            defaultValue={supplier?.district ?? ""}
            placeholder="Dhaka"
            className={inputClass}
          />
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <label className={labelClass}>
          <span>
            Payment terms (days){" "}
            <span className="text-xs font-normal text-ink-500">শর্ত</span>
          </span>
          <input
            name="paymentTermsDays"
            type="number"
            min={0}
            max={365}
            defaultValue={supplier?.paymentTermsDays ?? 0}
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          <span>
            Lead time (days) <span className="text-xs font-normal text-ink-500">সময়</span>
          </span>
          <input
            name="leadTimeDays"
            type="number"
            min={0}
            max={365}
            defaultValue={supplier?.leadTimeDays ?? 0}
            className={inputClass}
          />
        </label>
        <label className="flex items-end gap-2 pb-2 text-sm font-medium text-ink-700">
          <input
            type="checkbox"
            name="isDropshipVendor"
            defaultChecked={supplier?.isDropshipVendor ?? false}
            className="size-5 rounded border-slate-300"
          />
          <span>
            Dropship vendor{" "}
            <span className="block text-xs font-normal text-ink-500">সরাসরি পাঠায়</span>
          </span>
        </label>
      </div>

      <label className={labelClass}>
        <span>
          Notes <span className="text-xs font-normal text-ink-500">নোট</span>
        </span>
        <textarea
          name="notes"
          rows={3}
          maxLength={1000}
          defaultValue={supplier?.notes ?? ""}
          placeholder="Delivers on Sundays; invoice due within 15 days."
          className={`${inputClass} py-2`}
        />
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton editing={editing} />
        <p className="text-xs text-ink-500">
          Suppliers are never deleted. Set the status to inactive or blacklisted instead.
        </p>
      </div>
    </form>
  );
}
