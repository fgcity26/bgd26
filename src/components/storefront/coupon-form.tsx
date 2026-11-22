"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { applyCouponAction, clearCouponAction } from "@/app/actions/storefront";
import type { StorefrontActionState } from "@/lib/storefront/action-state";

export function CouponForm({
  appliedCode,
  notice,
}: {
  appliedCode: string | null;
  notice: string | null;
}) {
  const router = useRouter();
  const [applyState, applyAction] = useActionState<StorefrontActionState, FormData>(
    applyCouponAction,
    {},
  );
  const [clearState, clearAction] = useActionState<StorefrontActionState, FormData>(
    clearCouponAction,
    {},
  );

  useEffect(() => {
    if (!applyState.ok && !clearState.ok) return;
    router.refresh();
  }, [applyState.ok, clearState.ok, router]);

  if (appliedCode) {
    return (
      <div className="rounded-xl border border-brand-200 bg-brand-50 px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium text-brand-800">
            Coupon <span className="font-mono">{appliedCode}</span> applied
          </p>
          <form action={clearAction}>
            <button
              type="submit"
              className="min-h-8 rounded-lg px-2 text-xs font-medium text-brand-800 hover:bg-brand-100"
            >
              Remove
            </button>
          </form>
        </div>
        {notice ? <p className="mt-1 text-xs text-amber-800">{notice}</p> : null}
        {clearState.error ? (
          <p role="alert" className="mt-1 text-xs text-red-700">
            {clearState.error}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <form action={applyAction} className="space-y-2">
      <label htmlFor="coupon-code" className="block text-sm font-medium text-ink-700">
        Coupon code
      </label>
      <div className="flex gap-2">
        <input
          id="coupon-code"
          name="code"
          required
          autoComplete="off"
          placeholder="e.g. EID500"
          className="min-h-10 min-w-0 flex-1 rounded-xl border border-slate-300 px-3 text-sm uppercase"
        />
        <button
          type="submit"
          className="min-h-10 rounded-xl border border-brand-600 px-4 text-sm font-medium text-brand-700 hover:bg-brand-50"
        >
          Apply
        </button>
      </div>
      {notice ? <p className="text-xs text-amber-800">{notice}</p> : null}
      {applyState.error ? (
        <p role="alert" className="text-xs text-red-700">
          {applyState.error}
        </p>
      ) : null}
      {applyState.ok ? <p className="text-xs text-brand-700">{applyState.ok}</p> : null}
    </form>
  );
}
