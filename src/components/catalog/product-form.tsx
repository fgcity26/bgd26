"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { createProductAction, updateProductAction } from "@/app/actions/products";
import type { ProductView } from "@/lib/catalog/dto";

type Option = { id: string; name: string; nameBn?: string };

const inputClass =
  "mt-1 block w-full min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm text-ink-900 shadow-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100";

const labelClass = "block text-sm font-medium text-ink-700";

function Field({
  label,
  labelBn,
  hint,
  children,
}: {
  label: string;
  labelBn?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={labelClass}>
      <span>
        {label}
        {labelBn ? <span className="ml-1 text-xs font-normal text-ink-500">{labelBn}</span> : null}
      </span>
      {children}
      {hint ? <span className="mt-1 block text-xs font-normal text-ink-500">{hint}</span> : null}
    </label>
  );
}

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

export function ProductForm({
  mode,
  categories,
  brands,
  canViewCost,
  product,
}: {
  mode: "create" | "edit";
  categories: Option[];
  brands: Option[];
  canViewCost: boolean;
  product?: ProductView;
}) {
  const action = mode === "create" ? createProductAction : updateProductAction;
  const [state, formAction] = useActionState(action, {});

  return (
    <form action={formAction} className="space-y-4">
      {mode === "edit" && product ? (
        <>
          <input type="hidden" name="id" value={product.id} />
          <input type="hidden" name="currentName" value={product.name} />
        </>
      ) : null}

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
        <Field label="Product name" labelBn="পণ্যের নাম">
          <input
            name="name"
            required
            maxLength={200}
            defaultValue={product?.name ?? ""}
            className={inputClass}
          />
        </Field>
        <Field label="Name in Bangla" labelBn="বাংলা নাম">
          <input
            name="nameBn"
            maxLength={200}
            defaultValue={product?.nameBn ?? ""}
            className={inputClass}
          />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Category" labelBn="শ্রেণি">
          <select name="categoryId" required defaultValue={product?.category.id ?? ""} className={inputClass}>
            <option value="" disabled>
              Choose a category
            </option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
                {category.nameBn ? ` · ${category.nameBn}` : ""}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Brand" labelBn="ব্র্যান্ড" hint="Optional">
          <select name="brandId" defaultValue={product?.brand?.id ?? ""} className={inputClass}>
            <option value="">No brand</option>
            {brands.map((brand) => (
              <option key={brand.id} value={brand.id}>
                {brand.name}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="SKU"
          labelBn="এসকেইউ"
          hint={mode === "create" ? "Leave blank to generate one." : "Applies to the default variant."}
        >
          <input name="sku" maxLength={60} defaultValue={product?.sku ?? ""} className={inputClass} />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Selling price (৳, VAT inclusive)" labelBn="বিক্রয়মূল্য">
          <input
            name="basePrice"
            required
            inputMode="decimal"
            placeholder="0.00"
            defaultValue={product?.basePrice ?? ""}
            className={inputClass}
          />
        </Field>
        <Field label="Compare-at price (৳)" labelBn="আগের দাম" hint="Optional; shown struck through.">
          <input
            name="compareAtPrice"
            inputMode="decimal"
            placeholder="0.00"
            defaultValue={product?.compareAtPrice ?? ""}
            className={inputClass}
          />
        </Field>
        {canViewCost ? (
          <Field
            label="Cost price (৳)"
            labelBn="ক্রয়মূল্য"
            hint="Visible to accountants and reporters only. Blank clears it."
          >
            <input
              name="costPrice"
              inputMode="decimal"
              placeholder="0.0000"
              defaultValue={product?.costPrice ?? ""}
              className={inputClass}
            />
          </Field>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Product type" labelBn="পণ্যের ধরন">
          <select name="productType" defaultValue={product?.productType ?? "STOCKED"} className={inputClass}>
            <option value="STOCKED">Stocked — normal inventory</option>
            <option value="NON_STOCK">Non-stock — no inventory</option>
            <option value="SERVICE">Service</option>
            <option value="BUNDLE">Bundle</option>
            <option value="CUSTOM_MADE">Custom made / engraving</option>
          </select>
        </Field>
        <Field label="Tags" labelBn="ট্যাগ" hint="Comma separated, for search.">
          <input
            name="tags"
            maxLength={500}
            defaultValue={product?.tags.join(", ") ?? ""}
            className={inputClass}
          />
        </Field>
      </div>

      <Field label="Short description" labelBn="সংক্ষিপ্ত বিবরণ">
        <textarea
          name="shortDescription"
          rows={2}
          maxLength={500}
          defaultValue={product?.shortDescription ?? ""}
          className={inputClass}
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Description (English)" labelBn="বিবরণ">
          <textarea
            name="description"
            rows={5}
            maxLength={5000}
            defaultValue={product?.description ?? ""}
            className={inputClass}
          />
        </Field>
        <Field label="Description (Bangla)" labelBn="বাংলা বিবরণ">
          <textarea
            name="descriptionBn"
            rows={5}
            maxLength={5000}
            defaultValue={product?.descriptionBn ?? ""}
            className={inputClass}
          />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <Field label="Weight (g)" labelBn="ওজন">
          <input
            name="weightGrams"
            inputMode="numeric"
            defaultValue={product?.weightGrams ?? ""}
            className={inputClass}
          />
        </Field>
        <Field label="Warranty (months)" labelBn="ওয়ারেন্টি">
          <input
            name="warrantyMonths"
            inputMode="numeric"
            defaultValue={product?.warrantyMonths ?? ""}
            className={inputClass}
          />
        </Field>
        <Field label="Minimum order qty" labelBn="সর্বনিম্ন পরিমাণ">
          <input
            name="minOrderQty"
            inputMode="numeric"
            defaultValue={product?.minOrderQty ?? 1}
            className={inputClass}
          />
        </Field>
        <Field label="Advance %" labelBn="অগ্রিম %" hint="Custom-made orders.">
          <input
            name="advancePercentage"
            inputMode="decimal"
            defaultValue={product?.advancePercentage ?? "50"}
            className={inputClass}
          />
        </Field>
      </div>

      <fieldset className="grid gap-3 rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200 sm:grid-cols-2">
        <legend className="px-1 text-sm font-semibold text-ink-700">Options</legend>
        <label className="flex min-h-11 items-center gap-2 text-sm text-ink-700">
          <input type="checkbox" name="isFeatured" defaultChecked={product?.isFeatured} className="size-4" />
          Featured product
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm text-ink-700">
          <input
            type="checkbox"
            name="isCustomizable"
            defaultChecked={product?.isCustomizable}
            className="size-4"
          />
          Customisable (engraving / personalisation)
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm text-ink-700">
          <input
            type="checkbox"
            name="requiresDesignApproval"
            defaultChecked={product?.requiresDesignApproval}
            className="size-4"
          />
          Design must be approved before production
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm text-ink-700">
          <input
            type="checkbox"
            name="isDropshipEnabled"
            defaultChecked={product?.isDropshipEnabled}
            className="size-4"
          />
          Dropshipping allowed
        </label>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="SEO title" labelBn="এসইও শিরোনাম">
          <input
            name="seoTitle"
            maxLength={200}
            defaultValue={product?.seoTitle ?? ""}
            className={inputClass}
          />
        </Field>
        <Field label="SEO description" labelBn="এসইও বিবরণ">
          <input
            name="seoDescription"
            maxLength={400}
            defaultValue={product?.seoDescription ?? ""}
            className={inputClass}
          />
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 pt-4">
        <SubmitButton label={mode === "create" ? "Create product" : "Save changes"} />
        <p className="text-xs text-ink-500">
          {mode === "create"
            ? "Saved as a draft. Publishing is a separate permission."
            : "Images are stored byte-for-byte; nothing is resized or recompressed."}
        </p>
      </div>
    </form>
  );
}
