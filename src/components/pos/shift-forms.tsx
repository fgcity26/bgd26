"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  cashMovementAction,
  closeShiftAction,
  openShiftAction,
  type OrderFormState,
} from "@/app/actions/orders";

const inputClass =
  "mt-1 block w-full min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm text-ink-900 shadow-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100";
const labelClass = "block text-sm font-medium text-ink-700";

function Submit({ idle, busy }: { idle: string; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="min-h-11 rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? busy : idle}
    </button>
  );
}

function Messages({ state }: { state: OrderFormState }) {
  return (
    <>
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
    </>
  );
}

export function OpenShiftForm({
  devices,
}: {
  devices: Array<{ id: string; code: string; name: string }>;
}) {
  const [state, formAction] = useActionState<OrderFormState, FormData>(openShiftAction, {});
  return (
    <form action={formAction} className="space-y-3">
      <Messages state={state} />
      <label className={labelClass}>
        <span>Device</span>
        <select name="deviceId" required className={inputClass}>
          {devices.map((device) => (
            <option key={device.id} value={device.id}>
              {device.code} · {device.name}
            </option>
          ))}
        </select>
      </label>
      <label className={labelClass}>
        <span>Opening float ৳</span>
        <input
          name="openingFloat"
          required
          inputMode="decimal"
          defaultValue="0.00"
          className={inputClass}
        />
      </label>
      <label className={labelClass}>
        <span>Notes (optional)</span>
        <input name="notes" maxLength={300} className={inputClass} />
      </label>
      <Submit idle="Open shift" busy="Opening…" />
    </form>
  );
}

export function CloseShiftForm({
  shiftId,
  expectedCash,
}: {
  shiftId: string;
  expectedCash: string;
}) {
  const [state, formAction] = useActionState<OrderFormState, FormData>(closeShiftAction, {});
  return (
    <form action={formAction} className="space-y-3">
      <Messages state={state} />
      <input type="hidden" name="shiftId" value={shiftId} />
      <p className="text-sm text-ink-600">
        Expected cash <span className="font-semibold">৳{expectedCash}</span>
      </p>
      <label className={labelClass}>
        <span>Counted cash ৳</span>
        <input
          name="countedCash"
          required
          inputMode="decimal"
          defaultValue={expectedCash}
          className={inputClass}
        />
      </label>
      <label className={labelClass}>
        <span>Notes (optional)</span>
        <input name="notes" maxLength={300} className={inputClass} />
      </label>
      <Submit idle="Close shift" busy="Closing…" />
    </form>
  );
}

export function CashMovementForm({ shiftId }: { shiftId: string }) {
  const [state, formAction] = useActionState<OrderFormState, FormData>(cashMovementAction, {});
  return (
    <form action={formAction} className="space-y-3">
      <Messages state={state} />
      <input type="hidden" name="shiftId" value={shiftId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelClass}>
          <span>Type</span>
          <select name="type" className={inputClass} defaultValue="CASH_DROP">
            <option value="CASH_IN">Cash in</option>
            <option value="CASH_OUT">Cash out</option>
            <option value="CASH_DROP">Cash drop to safe</option>
          </select>
        </label>
        <label className={labelClass}>
          <span>Amount ৳</span>
          <input name="amount" required inputMode="decimal" className={inputClass} />
        </label>
      </div>
      <label className={labelClass}>
        <span>Reason</span>
        <input name="reason" required maxLength={300} className={inputClass} />
      </label>
      <Submit idle="Record movement" busy="Recording…" />
    </form>
  );
}
