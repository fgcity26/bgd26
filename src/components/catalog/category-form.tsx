"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  createCategoryAction,
  updateCategoryAction,
  type CategoryFormState,
} from "@/app/actions/categories";

const inputClass =
  "mt-1 block w-full min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm text-ink-900 shadow-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100";

const labelClass = "block text-sm font-medium text-ink-700";

type CategoryValues = {
  id: string;
  name: string;
  nameBn: string;
  code: string | null;
  slug: string;
  description: string | null;
  vatPercentage: string;
  parentId: string | null;
  sortOrder: number;
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

export function CategoryForm({
  mode,
  categories,
  category,
}: {
  mode: "create" | "edit";
  categories: Array<{ id: string; name: string }>;
  category?: CategoryValues;
}) {
  const action = mode === "create" ? createCategoryAction : updateCategoryAction;
  const [state, formAction] = useActionState<CategoryFormState, FormData>(action, {});

  return (
    <form action={formAction} className="space-y-4">
      {mode === "edit" && category ? <input type="hidden" name="id" value={category.id} /> : null}

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
          <input name="name" required maxLength={120} defaultValue={category?.name ?? ""} className={inputClass} />
        </label>
        <label className={labelClass}>
          <span>
            Bangla name <span className="text-xs font-normal text-ink-500">বাংলা নাম</span>
          </span>
          <input name="nameBn" required maxLength={120} defaultValue={category?.nameBn ?? ""} className={inputClass} />
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <label className={labelClass}>
          <span>
            Code <span className="text-xs font-normal text-ink-500">কোড</span>
          </span>
          <input name="code" maxLength={20} defaultValue={category?.code ?? ""} className={inputClass} />
        </label>
        <label className={labelClass}>
          <span>
            Slug <span className="text-xs font-normal text-ink-500">ইউআরএল</span>
          </span>
          <input name="slug" maxLength={120} defaultValue={category?.slug ?? ""} className={inputClass} />
        </label>
        <label className={labelClass}>
          <span>
            VAT % <span className="text-xs font-normal text-ink-500">ভ্যাট</span>
          </span>
          <input
            name="vatPercentage"
            required
            inputMode="decimal"
            defaultValue={category?.vatPercentage ?? "15.00"}
            className={inputClass}
          />
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className={labelClass}>
          <span>
            Parent category <span className="text-xs font-normal text-ink-500">মূল শ্রেণি</span>
          </span>
          <select name="parentId" defaultValue={category?.parentId ?? ""} className={inputClass}>
            <option value="">No parent</option>
            {categories
              .filter((option) => option.id !== category?.id)
              .map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
          </select>
        </label>
        <label className={labelClass}>
          <span>
            Sort order <span className="text-xs font-normal text-ink-500">ক্রম</span>
          </span>
          <input
            name="sortOrder"
            inputMode="numeric"
            defaultValue={category?.sortOrder ?? 0}
            className={inputClass}
          />
        </label>
      </div>

      <label className={labelClass}>
        <span>
          Description <span className="text-xs font-normal text-ink-500">বিবরণ</span>
        </span>
        <textarea
          name="description"
          rows={2}
          maxLength={1000}
          defaultValue={category?.description ?? ""}
          className={inputClass}
        />
      </label>

      <div className="flex items-center gap-3 border-t border-slate-200 pt-4">
        <SubmitButton label={mode === "create" ? "Add category" : "Save category"} />
        <p className="text-xs text-ink-500">
          The VAT rate is copied onto each sale, so later changes never rewrite history.
        </p>
      </div>
    </form>
  );
}
