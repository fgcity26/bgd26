"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  createPurchaseOrderAction,
  updatePurchaseOrderAction,
  type PurchasingFormState,
} from "@/app/actions/purchasing";
import type { VariantOption, WarehouseOption } from "@/components/inventory/opening-stock-form";

const inputClass =
  "mt-1 block w-full min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm text-ink-900 shadow-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100";

const labelClass = "block text-sm font-medium text-ink-700";

const moneyFormat = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export type PurchaseOrderDefaults = {
  id?: string;
  poNumber?: string;
  supplierId?: string;
  warehouseId?: string | null;
  expectedAt?: string;
  discountTotal?: string;
  shippingTotal?: string;
  notes?: string | null;
  lines?: Array<{
    variantId: string;
    quantity: string;
    unitCost: string;
    taxAmount: string;
  }>;
};

type Line = {
  key: number;
  variantId: string;
  quantity: string;
  unitCost: string;
  taxAmount: string;
};

function money(value: number): string {
  return moneyFormat.format(Number.isFinite(value) ? value : 0);
}

function toNumber(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function SubmitButton({ editing }: { editing: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="min-h-11 rounded-xl bg-brand-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Saving…" : editing ? "Save draft order" : "Create draft order"}
    </button>
  );
}

export function PurchaseOrderForm({
  suppliers,
  warehouses,
  variants,
  order,
}: {
  suppliers: Array<{ id: string; code: string; name: string }>;
  warehouses: WarehouseOption[];
  variants: VariantOption[];
  order?: PurchaseOrderDefaults;
}) {
  const editing = Boolean(order?.id);
  const [state, formAction] = useActionState<PurchasingFormState, FormData>(
    editing ? updatePurchaseOrderAction : createPurchaseOrderAction,
    {},
  );

  const [lines, setLines] = useState<Line[]>(
    order?.lines?.length
      ? order.lines.map((line, index) => ({ key: index + 1, ...line }))
      : [{ key: 1, variantId: "", quantity: "1", unitCost: "", taxAmount: "" }],
  );
  const [nextKey, setNextKey] = useState((order?.lines?.length ?? 1) + 1);
  const [discount, setDiscount] = useState(order?.discountTotal ?? "0");
  const [shipping, setShipping] = useState(order?.shippingTotal ?? "0");

  const updateLine = (key: number, patch: Partial<Line>) => {
    setLines((current) =>
      current.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    );
  };

  const addLine = () => {
    setLines((current) => [
      ...current,
      { key: nextKey, variantId: "", quantity: "1", unitCost: "", taxAmount: "" },
    ]);
    setNextKey((value) => value + 1);
  };

  const removeLine = (key: number) => {
    setLines((current) =>
      current.length === 1 ? current : current.filter((line) => line.key !== key),
    );
  };

  const subtotal = lines.reduce(
    (sum, line) => sum + toNumber(line.quantity) * toNumber(line.unitCost),
    0,
  );
  const taxTotal = lines.reduce((sum, line) => sum + toNumber(line.taxAmount), 0);
  const grandTotal = subtotal + taxTotal - toNumber(discount) + toNumber(shipping);

  return (
    <form action={formAction} className="space-y-4">
      {order?.id ? <input type="hidden" name="id" value={order.id} /> : null}

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
            Supplier <span className="text-xs font-normal text-ink-500">সরবরাহকারী</span>
          </span>
          <select
            name="supplierId"
            required
            defaultValue={order?.supplierId ?? suppliers[0]?.id ?? ""}
            className={inputClass}
          >
            <option value="">Choose a supplier…</option>
            {suppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.code} · {supplier.name}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          <span>
            Receiving warehouse{" "}
            <span className="text-xs font-normal text-ink-500">গুদাম</span>
          </span>
          <select
            name="warehouseId"
            required
            defaultValue={order?.warehouseId ?? warehouses[0]?.id ?? ""}
            className={inputClass}
          >
            {warehouses.map((warehouse) => (
              <option key={warehouse.id} value={warehouse.id}>
                {warehouse.code} · {warehouse.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className={labelClass}>
        <span>
          Expected date <span className="text-xs font-normal text-ink-500">প্রত্যাশিত তারিখ</span>
        </span>
        <input
          name="expectedAt"
          type="date"
          defaultValue={order?.expectedAt ?? ""}
          className={inputClass}
        />
      </label>

      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold text-ink-700">
          Lines <span className="text-xs font-normal text-ink-500">আইটেম</span>
        </legend>

        {lines.map((line, index) => (
          <div
            key={line.key}
            className="grid gap-3 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200 sm:grid-cols-2 lg:grid-cols-[1fr_100px_120px_110px_auto]"
          >
            <label className="block text-sm font-medium text-ink-700 sm:col-span-2 lg:col-span-1">
              <span className="text-xs text-ink-500">Line {index + 1} · variant</span>
              <select
                name="variantId"
                value={line.variantId}
                onChange={(event) => updateLine(line.key, { variantId: event.target.value })}
                className={inputClass}
              >
                <option value="">Choose a variant…</option>
                {variants.map((variant) => (
                  <option key={variant.id} value={variant.id}>
                    {variant.sku} · {variant.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm font-medium text-ink-700">
              <span className="text-xs text-ink-500">Quantity</span>
              <input
                name="quantity"
                value={line.quantity}
                onChange={(event) => updateLine(line.key, { quantity: event.target.value })}
                inputMode="decimal"
                className={inputClass}
              />
            </label>
            <label className="block text-sm font-medium text-ink-700">
              <span className="text-xs text-ink-500">Unit cost (৳)</span>
              <input
                name="unitCost"
                value={line.unitCost}
                onChange={(event) => updateLine(line.key, { unitCost: event.target.value })}
                inputMode="decimal"
                placeholder="0.0000"
                className={inputClass}
              />
            </label>
            <label className="block text-sm font-medium text-ink-700">
              <span className="text-xs text-ink-500">Tax (৳)</span>
              <input
                name="taxAmount"
                value={line.taxAmount}
                onChange={(event) => updateLine(line.key, { taxAmount: event.target.value })}
                inputMode="decimal"
                placeholder="0.00"
                className={inputClass}
              />
            </label>
            <div className="flex items-end">
              <button
                type="button"
                onClick={() => removeLine(line.key)}
                disabled={lines.length === 1}
                className="min-h-11 rounded-xl border border-slate-300 px-3 text-xs font-medium text-ink-700 hover:border-red-300 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Remove
              </button>
            </div>
            <p className="text-right text-xs text-ink-500 sm:col-span-2 lg:col-span-5">
              Line total ৳{money(toNumber(line.quantity) * toNumber(line.unitCost))}
            </p>
          </div>
        ))}

        <button
          type="button"
          onClick={addLine}
          className="min-h-11 rounded-xl border border-slate-300 px-4 text-sm font-semibold text-ink-700 hover:border-brand-300 hover:text-brand-700"
        >
          + Add line
        </button>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className={labelClass}>
          <span>
            Discount (৳) <span className="text-xs font-normal text-ink-500">ছাড়</span>
          </span>
          <input
            name="discountTotal"
            value={discount}
            onChange={(event) => setDiscount(event.target.value)}
            inputMode="decimal"
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          <span>
            Shipping (৳) <span className="text-xs font-normal text-ink-500">পরিবহন</span>
          </span>
          <input
            name="shippingTotal"
            value={shipping}
            onChange={(event) => setShipping(event.target.value)}
            inputMode="decimal"
            className={inputClass}
          />
        </label>
      </div>

      <dl className="space-y-1 rounded-xl bg-white p-3 text-sm ring-1 ring-slate-200">
        <div className="flex justify-between">
          <dt className="text-ink-500">Subtotal</dt>
          <dd className="font-medium">৳{money(subtotal)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-ink-500">Tax</dt>
          <dd className="font-medium">৳{money(taxTotal)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-ink-500">Discount</dt>
          <dd className="font-medium">−৳{money(toNumber(discount))}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-ink-500">Shipping</dt>
          <dd className="font-medium">৳{money(toNumber(shipping))}</dd>
        </div>
        <div className="flex justify-between border-t border-slate-200 pt-1 text-base font-semibold">
          <dt>Grand total</dt>
          <dd>৳{money(grandTotal)}</dd>
        </div>
      </dl>

      <label className={labelClass}>
        <span>
          Notes <span className="text-xs font-normal text-ink-500">নোট</span>
        </span>
        <textarea
          name="notes"
          rows={2}
          maxLength={500}
          defaultValue={order?.notes ?? ""}
          placeholder="Deliver to the Uttara shop before noon."
          className={`${inputClass} py-2`}
        />
      </label>

      <div className="rounded-xl bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800 ring-1 ring-amber-200">
        A draft order does not commit anything. Sending it marks the order as placed; stock only
        changes when a goods receipt is posted.
        <span className="mt-1 block">
          ড্রাফট অর্ডার কিছু বদলায় না। পাঠালে অর্ডার হয়; মাল গ্রহণ পোস্ট করলে স্টক বদলায়।
        </span>
      </div>

      <SubmitButton editing={editing} />
    </form>
  );
}
