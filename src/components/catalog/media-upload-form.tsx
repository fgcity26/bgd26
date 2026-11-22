"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { uploadProductMediaAction, type MediaFormState } from "@/app/actions/media";

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
      {pending ? "Uploading…" : "Upload originals"}
    </button>
  );
}

export function MediaUploadForm({
  productId,
  variants,
}: {
  productId: string;
  variants: Array<{ id: string; name: string; sku: string }>;
}) {
  const [state, formAction] = useActionState<MediaFormState, FormData>(
    uploadProductMediaAction,
    {},
  );

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

      <label className="block text-sm font-medium text-ink-700">
        <span>
          Images <span className="text-xs font-normal text-ink-500">ছবি</span>
        </span>
        <input
          type="file"
          name="files"
          accept="image/jpeg,image/png,image/webp,image/avif"
          multiple
          required
          className="mt-1 block w-full rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-sm text-ink-700 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-600 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white"
        />
        <span className="mt-1 block text-xs font-normal text-ink-500">
          JPEG, PNG, WebP or AVIF · up to 20 MB each · SVG is rejected. Bytes are stored
          exactly as uploaded — never resized, cropped or recompressed.
        </span>
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm font-medium text-ink-700">
          <span>
            Alt text <span className="text-xs font-normal text-ink-500">বিকল্প লেখা</span>
          </span>
          <input name="altText" maxLength={300} className={inputClass} />
        </label>
        <label className="block text-sm font-medium text-ink-700">
          <span>
            Variant <span className="text-xs font-normal text-ink-500">ভ্যারিয়েন্ট</span>
          </span>
          <select name="variantId" defaultValue="" className={inputClass}>
            <option value="">All variants</option>
            {variants.map((variant) => (
              <option key={variant.id} value={variant.id}>
                {variant.name} · {variant.sku}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton />
        <label className="flex min-h-11 items-center gap-2 text-sm text-ink-700">
          <input type="checkbox" name="isPrimary" className="size-4" />
          Make primary
        </label>
      </div>
    </form>
  );
}
