"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  removeCartItemAction,
  updateCartItemAction,
} from "@/app/actions/storefront";
import type { StorefrontActionState } from "@/lib/storefront/action-state";

export function CartLineControls({
  itemId,
  quantity,
  maxQuantity,
}: {
  itemId: string;
  quantity: number;
  maxQuantity: number | null;
}) {
  const router = useRouter();
  const [updateState, updateAction] = useActionState<StorefrontActionState, FormData>(
    updateCartItemAction,
    {},
  );
  const [removeState, removeAction] = useActionState<StorefrontActionState, FormData>(
    removeCartItemAction,
    {},
  );

  useEffect(() => {
    if (!updateState.ok && !removeState.ok) return;
    window.dispatchEvent(new Event("bgd26:cart"));
    router.refresh();
  }, [updateState.ok, removeState.ok, router]);

  const max = maxQuantity ?? 99;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <form action={updateAction} className="flex items-center gap-2">
        <input type="hidden" name="itemId" value={itemId} />
        <label className="sr-only" htmlFor={`qty-${itemId}`}>
          Quantity
        </label>
        <input
          id={`qty-${itemId}`}
          type="number"
          name="quantity"
          min={1}
          max={max}
          defaultValue={quantity}
          inputMode="numeric"
          className="min-h-9 w-16 rounded-lg border border-slate-300 px-2 text-sm"
        />
        <button
          type="submit"
          className="min-h-9 rounded-lg border border-slate-300 px-3 text-xs font-medium text-ink-700 hover:border-brand-400 hover:text-brand-700"
        >
          Update
        </button>
      </form>
      <form action={removeAction}>
        <input type="hidden" name="itemId" value={itemId} />
        <button
          type="submit"
          className="min-h-9 rounded-lg px-3 text-xs font-medium text-red-700 hover:bg-red-50"
        >
          Remove
        </button>
      </form>
      {updateState.error || removeState.error ? (
        <p role="alert" className="w-full text-xs text-red-700">
          {updateState.error || removeState.error}
        </p>
      ) : null}
    </div>
  );
}
