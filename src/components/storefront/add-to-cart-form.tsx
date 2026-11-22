"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { addToCartAction } from "@/app/actions/storefront";
import type { StorefrontActionState } from "@/lib/storefront/action-state";
import { formatMoney } from "@/lib/inventory/format";

export type AddToCartVariant = {
  id: string;
  name: string;
  price: string;
  available: boolean;
  maxQuantity: number | null;
};

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={disabled || pending}
      className="min-h-11 flex-1 rounded-xl bg-brand-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-slate-300"
    >
      {pending ? "Adding…" : disabled ? "Out of stock" : "Add to cart"}
    </button>
  );
}

export function AddToCartForm({
  variants,
  productName,
}: {
  variants: AddToCartVariant[];
  productName: string;
}) {
  const router = useRouter();
  const [state, formAction] = useActionState<StorefrontActionState, FormData>(
    addToCartAction,
    {},
  );
  const [variantId, setVariantId] = useState(
    () => (variants.find((variant) => variant.available) ?? variants[0])?.id ?? "",
  );
  const selected = variants.find((variant) => variant.id === variantId) ?? variants[0];
  const max = selected?.maxQuantity ?? 99;

  useEffect(() => {
    if (!state.ok) return;
    window.dispatchEvent(new Event("bgd26:cart"));
    router.refresh();
  }, [state.ok, router]);

  if (!selected) {
    return (
      <p className="rounded-xl bg-slate-100 px-4 py-3 text-sm text-ink-500">
        This product has no variants on sale.
      </p>
    );
  }

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="variantId" value={selected.id} />

      {variants.length > 1 ? (
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink-700">Option</span>
          <select
            value={selected.id}
            onChange={(event) => setVariantId(event.target.value)}
            className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm"
          >
            {variants.map((variant) => (
              <option key={variant.id} value={variant.id} disabled={!variant.available}>
                {variant.name} · ৳{formatMoney(variant.price)}
                {variant.available ? "" : " (out of stock)"}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <div className="flex items-end gap-3">
        <label className="block w-24 text-sm">
          <span className="mb-1 block font-medium text-ink-700">Quantity</span>
          <input
            type="number"
            name="quantity"
            min={1}
            max={max}
            defaultValue={1}
            inputMode="numeric"
            className="min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm"
          />
        </label>
        <SubmitButton disabled={!selected.available} />
      </div>

      {selected.available && selected.maxQuantity !== null ? (
        <p className="text-xs text-ink-500">{selected.maxQuantity} available now</p>
      ) : null}
      {!selected.available ? (
        <p className="text-xs text-ink-500">
          This option is out of stock. Choose another option or check back soon.
        </p>
      ) : null}
      {state.error ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      ) : null}
      {state.ok ? (
        <p role="status" className="rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-700">
          {state.ok} <span className="sr-only">for {productName}</span>
        </p>
      ) : null}
    </form>
  );
}
