"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { createVariantAction, type ProductFormState } from "@/app/actions/products";

const inputClass =
  "mt-1 block w-full min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm text-ink-900 shadow-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="min-h-11 rounded-xl bg-brand-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Adding…" : "Add variant"}
    </button>
  );
}

export function VariantForm({
  productId,
  canViewCost,
}: {
  productId: string;
  canViewCost: boolean;
}) {
  const [state, formAction] = useActionState<ProductFormState, FormData>(createVariantAction, {});

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="productId" value={productId} />

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

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm font-medium text-ink-700">
          <span>
            Variant name <span className="text-xs font-normal text-ink-500">নাম</span>
          </span>
          <input name="name" required maxLength={120} placeholder="Large / Black" className={inputClass} />
        </label>
        <label className="block text-sm font-medium text-ink-700">
          <span>
            SKU <span className="text-xs font-normal text-ink-500">এসকেইউ</span>
          </span>
          <input name="sku" required maxLength={60} className={inputClass} />
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block text-sm font-medium text-ink-700">
          <span>Price (৳)</span>
          <input name="price" required inputMode="decimal" placeholder="0.00" className={inputClass} />
        </label>
        <label className="block text-sm font-medium text-ink-700">
          <span>Compare-at (৳)</span>
          <input name="compareAtPrice" inputMode="decimal" placeholder="0.00" className={inputClass} />
        </label>
        {canViewCost ? (
          <label className="block text-sm font-medium text-ink-700">
            <span>Cost (৳)</span>
            <input name="costPrice" inputMode="decimal" placeholder="0.0000" className={inputClass} />
          </label>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block text-sm font-medium text-ink-700">
          <span>Fulfilment</span>
          <select name="fulfillmentType" defaultValue="STOCKED" className={inputClass}>
            <option value="STOCKED">Stocked</option>
            <option value="DROPSHIP">Dropship</option>
            <option value="NON_STOCK">Non-stock</option>
            <option value="SERVICE">Service</option>
          </select>
        </label>
        <label className="block text-sm font-medium text-ink-700">
          <span>Barcode</span>
          <input name="barcode" maxLength={60} className={inputClass} />
        </label>
        <label className="block text-sm font-medium text-ink-700">
          <span>Weight (g)</span>
          <input name="weightGrams" inputMode="numeric" className={inputClass} />
        </label>
      </div>

      <label className="block text-sm font-medium text-ink-700">
        <span>
          Attributes (JSON) <span className="text-xs font-normal text-ink-500">বৈশিষ্ট্য</span>
        </span>
        <input
          name="attributes"
          maxLength={1000}
          placeholder='{"size":"L","colour":"Black"}'
          className={inputClass}
        />
      </label>

      <SubmitButton />
    </form>
  );
}
