"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { createDraftOrderAction, type DraftFormState } from "@/app/actions/assistant";

const inputClass =
  "mt-1 block w-full min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm text-ink-900 shadow-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100";
const labelClass = "block text-sm font-medium text-ink-700";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="min-h-11 rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Creating draft…" : "Create draft"}
    </button>
  );
}

export function DraftOrderForm({
  zones,
}: {
  zones: Array<{ id: string; name: string; district: string; charge: string }>;
}) {
  const [state, action] = useActionState<DraftFormState, FormData>(
    createDraftOrderAction,
    {},
  );
  const [items, setItems] = useState("");

  return (
    <form action={action} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelClass}>
          <span>Customer name</span>
          <input name="customerName" required minLength={2} maxLength={120} className={inputClass} />
        </label>
        <label className={labelClass}>
          <span>Mobile</span>
          <input
            name="customerMobile"
            required
            inputMode="tel"
            placeholder="01712345678"
            className={inputClass}
          />
        </label>
      </div>

      <label className={labelClass}>
        <span>Items — one per line, SKU x quantity</span>
        <textarea
          name="items"
          required
          rows={3}
          value={items}
          onChange={(event) => setItems(event.target.value)}
          placeholder={"SKU-ABC x 2\nSKU-XYZ x 1"}
          className={`${inputClass} resize-y font-mono text-xs`}
        />
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelClass}>
          <span>Delivery zone</span>
          <select name="deliveryZoneId" required className={inputClass}>
            <option value="">Choose a zone</option>
            {zones.map((zone) => (
              <option key={zone.id} value={zone.id}>
                {zone.name} · {zone.district} · ৳{zone.charge}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          <span>Address (optional)</span>
          <input name="address" maxLength={300} placeholder="House, road, area" className={inputClass} />
        </label>
      </div>

      <label className={labelClass}>
        <span>Note (optional)</span>
        <input name="note" maxLength={300} className={inputClass} />
      </label>

      <p className="text-xs leading-relaxed text-ink-500">
        This creates a <strong>DRAFT</strong> only: no stock is reserved, no payment is taken
        and no journal is posted. Prices and VAT are read from the catalogue on the server.
      </p>

      {state.error ? (
        <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-200">
          {state.error}
        </p>
      ) : null}
      {state.success && state.draft ? (
        <div className="rounded-xl bg-brand-50 px-3 py-2 text-sm text-brand-800 ring-1 ring-brand-200">
          <p>{state.success}</p>
          <Link href={`/orders/${state.draft.id}`} className="mt-1 inline-block font-semibold underline">
            Open {state.draft.orderNumber} · ৳{state.draft.grandTotal}
          </Link>
        </div>
      ) : null}

      <SubmitButton />
    </form>
  );
}
