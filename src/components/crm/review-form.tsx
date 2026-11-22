"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { createReviewAction, type ReviewFormState } from "@/app/actions/reviews";

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
      {pending ? "Saving…" : "Save review"}
    </button>
  );
}

export function ReviewForm({
  products,
  customers,
}: {
  products: Array<{ id: string; name: string }>;
  customers: Array<{ id: string; fullName: string; mobileNormalized: string }>;
}) {
  const [state, formAction] = useActionState<ReviewFormState, FormData>(
    createReviewAction,
    {},
  );

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
          <span>
            Product <span className="text-xs font-normal text-ink-500">পণ্য</span>
          </span>
          <select name="productId" required defaultValue="" className={inputClass}>
            <option value="" disabled>
              Choose a product
            </option>
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          <span>
            Customer <span className="text-xs font-normal text-ink-500">ক্রেতা</span>
          </span>
          <select name="customerId" required defaultValue="" className={inputClass}>
            <option value="" disabled>
              Choose a customer
            </option>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.fullName} · {customer.mobileNormalized}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-[auto_1fr]">
        <label className={labelClass}>
          <span>
            Rating <span className="text-xs font-normal text-ink-500">রেটিং</span>
          </span>
          <select name="rating" required defaultValue="5" className={inputClass}>
            {[5, 4, 3, 2, 1].map((value) => (
              <option key={value} value={value}>
                {value} star{value === 1 ? "" : "s"}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          <span>
            Title <span className="text-xs font-normal text-ink-500">শিরোনাম</span>
          </span>
          <input name="title" maxLength={160} className={inputClass} />
        </label>
      </div>

      <label className={labelClass}>
        <span>
          Review <span className="text-xs font-normal text-ink-500">মতামত</span>
        </span>
        <textarea
          name="body"
          required
          rows={4}
          maxLength={4000}
          placeholder="What did the customer say?"
          className={inputClass}
        />
      </label>

      <label className={labelClass}>
        <span>
          Photos <span className="text-xs font-normal text-ink-500">ছবি</span>
        </span>
        <input
          type="file"
          name="photos"
          accept="image/jpeg,image/png,image/webp,image/avif"
          multiple
          className="mt-1 block w-full rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-sm text-ink-700 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-600 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white"
        />
        <span className="mt-1 block text-xs font-normal text-ink-500">
          Up to five originals. Stored byte-for-byte and checked by SHA-256.
        </span>
      </label>

      <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 pt-4">
        <SubmitButton />
        <p className="text-xs text-ink-500">
          New reviews are PENDING. Nothing appears publicly until a moderator approves it.
        </p>
      </div>
    </form>
  );
}
