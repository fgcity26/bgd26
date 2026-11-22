"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  addTrackingEventAction,
  cancelShipmentAction,
  createCourierAction,
  createShipmentAction,
  postCodRemittanceAction,
  updateCourierAction,
  type ShippingFormState,
} from "@/app/actions/shipping";
import { formatMoney } from "@/lib/inventory/format";

const input =
  "mt-1 block min-h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-ink-900 shadow-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100";
const label = "block text-xs font-medium text-ink-700";

function Submit({
  idle,
  busy,
  tone = "brand",
  full = false,
}: {
  idle: string;
  busy: string;
  tone?: "brand" | "danger";
  full?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={`min-h-10 rounded-xl px-4 text-sm font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
        tone === "danger" ? "bg-red-600 hover:bg-red-700" : "bg-brand-600 hover:bg-brand-700"
      } ${full ? "w-full" : ""}`}
    >
      {pending ? busy : idle}
    </button>
  );
}

function Message({ state }: { state: ShippingFormState }) {
  if (state.error) {
    return (
      <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
        {state.error}
      </p>
    );
  }
  if (state.success) {
    return (
      <p role="status" className="rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-700">
        {state.success}
      </p>
    );
  }
  return null;
}

const PROVIDERS = [
  { value: "MANUAL", label: "Manual / own delivery" },
  { value: "PATHAO", label: "Pathao" },
  { value: "STEADFAST", label: "Steadfast" },
  { value: "REDX", label: "RedX" },
  { value: "DROPSHIP_SUPPLIER", label: "Dropship supplier" },
] as const;

export function CourierForm({
  courier,
}: {
  courier?: {
    id: string;
    code: string;
    name: string;
    provider: string;
    apiBaseUrl: string | null;
    credentialEnvPrefix: string | null;
    supportsCod: boolean;
    supportsDropship: boolean;
    isActive: boolean;
  };
}) {
  const [state, action] = useActionState<ShippingFormState, FormData>(
    courier ? updateCourierAction : createCourierAction,
    {},
  );

  return (
    <form action={action} className="space-y-4">
      {courier ? <input type="hidden" name="id" value={courier.id} /> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={label}>
          Code
          <input
            name="code"
            required
            minLength={2}
            maxLength={30}
            defaultValue={courier?.code ?? ""}
            placeholder="PATHAO"
            className={input}
          />
        </label>
        <label className={label}>
          Name
          <input
            name="name"
            required
            minLength={2}
            maxLength={120}
            defaultValue={courier?.name ?? ""}
            placeholder="Pathao Courier"
            className={input}
          />
        </label>
        <label className={label}>
          Provider
          <select
            name="provider"
            defaultValue={courier?.provider ?? "MANUAL"}
            className={input}
          >
            {PROVIDERS.map((provider) => (
              <option key={provider.value} value={provider.value}>
                {provider.label}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          Credential env prefix
          <input
            name="credentialEnvPrefix"
            maxLength={60}
            defaultValue={courier?.credentialEnvPrefix ?? ""}
            placeholder="PATHAO_"
            className={input}
          />
          <span className="mt-1 block text-[11px] font-normal text-ink-500">
            The prefix of the environment variables that hold this courier&apos;s keys.
            Never paste a secret here.
          </span>
        </label>
        <label className={`${label} sm:col-span-2`}>
          API base URL
          <input
            name="apiBaseUrl"
            maxLength={300}
            defaultValue={courier?.apiBaseUrl ?? ""}
            placeholder="https://api.pathao.com"
            className={input}
          />
        </label>
      </div>

      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" name="supportsCod" defaultChecked={courier?.supportsCod ?? true} />
          Collects cash on delivery
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            name="supportsDropship"
            defaultChecked={courier?.supportsDropship ?? false}
          />
          Handles dropship parcels
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="isActive" defaultChecked={courier?.isActive ?? true} />
          Active
        </label>
      </div>

      <Message state={state} />
      <Submit idle={courier ? "Save courier" : "Add courier"} busy="Saving…" />
    </form>
  );
}

export function ShipmentForm({
  orders,
  couriers,
  defaultOrderId,
}: {
  orders: Array<{
    id: string;
    orderNumber: string;
    recipientName: string;
    recipientMobile: string;
    grandTotal: string;
    dueAmount: string;
    paymentStatus: string;
    zone: string | null;
  }>;
  couriers: Array<{ id: string; name: string; provider: string; supportsCod: boolean }>;
  defaultOrderId?: string;
}) {
  const [state, action] = useActionState<ShippingFormState, FormData>(
    createShipmentAction,
    {},
  );

  if (orders.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-ink-500">
        No order is ready to ship. Move an order to <strong>Ready to ship</strong> first.
      </p>
    );
  }

  return (
    <form action={action} className="space-y-4">
      <label className={label}>
        Order
        <select
          name="orderId"
          required
          defaultValue={defaultOrderId ?? orders[0]?.id ?? ""}
          className={input}
        >
          {orders.map((order) => (
            <option key={order.id} value={order.id}>
              {order.orderNumber} · {order.recipientName} · ৳{formatMoney(order.dueAmount)} due
              {order.zone ? ` · ${order.zone}` : ""}
            </option>
          ))}
        </select>
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className={label}>
          Courier
          <select name="courierId" defaultValue={couriers[0]?.id ?? ""} className={input}>
            <option value="">Manual (no courier record)</option>
            {couriers.map((courier) => (
              <option key={courier.id} value={courier.id}>
                {courier.name}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          Tracking number
          <input
            name="trackingNumber"
            maxLength={80}
            placeholder="Optional for manual delivery"
            className={input}
          />
        </label>
      </div>

      <label className={label}>
        Note
        <input name="note" maxLength={300} placeholder="Pickup instruction (optional)" className={input} />
      </label>

      <p className="text-xs text-ink-500">
        Booking does not mark the order shipped. A pickup or transit event does, and a
        delivery event moves it to delivered.
      </p>

      <Message state={state} />
      <Submit idle="Book shipment" busy="Booking…" />
    </form>
  );
}

const EVENT_STATUSES = [
  { value: "BOOKED", label: "Booked / re-booked" },
  { value: "PICKED_UP", label: "Picked up" },
  { value: "IN_TRANSIT", label: "In transit" },
  { value: "OUT_FOR_DELIVERY", label: "Out for delivery" },
  { value: "DELIVERED", label: "Delivered" },
  { value: "RETURNED", label: "Returned to shop" },
  { value: "FAILED", label: "Delivery failed" },
] as const;

export function TrackingEventForm({ shipmentId }: { shipmentId: string }) {
  const [state, action] = useActionState<ShippingFormState, FormData>(
    addTrackingEventAction,
    {},
  );

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="shipmentId" value={shipmentId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={label}>
          Event
          <select name="status" defaultValue="IN_TRANSIT" className={input}>
            {EVENT_STATUSES.map((event) => (
              <option key={event.value} value={event.value}>
                {event.label}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          Location
          <input name="location" maxLength={120} placeholder="Dhaka hub" className={input} />
        </label>
      </div>
      <label className={label}>
        Message
        <input name="message" maxLength={300} placeholder="Optional note" className={input} />
      </label>
      <Message state={state} />
      <Submit idle="Record event" busy="Recording…" />
    </form>
  );
}

export function CancelShipmentForm({ shipmentId }: { shipmentId: string }) {
  const [state, action] = useActionState<ShippingFormState, FormData>(
    cancelShipmentAction,
    {},
  );

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="id" value={shipmentId} />
      <label className={label}>
        Cancellation reason
        <input
          name="reason"
          required
          minLength={3}
          maxLength={300}
          placeholder="Why is this booking cancelled?"
          className={input}
        />
      </label>
      <Message state={state} />
      <Submit idle="Cancel shipment" busy="Cancelling…" tone="danger" />
    </form>
  );
}

export function RemittanceForm({
  couriers,
}: {
  couriers: Array<{ id: string; name: string }>;
}) {
  const [state, action] = useActionState<ShippingFormState, FormData>(
    postCodRemittanceAction,
    {},
  );

  if (couriers.length === 0) {
    return (
      <p className="text-sm text-ink-500">
        Add a courier that collects cash on delivery before recording a remittance.
      </p>
    );
  }

  return (
    <form action={action} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={label}>
          Courier
          <select name="courierId" required className={input}>
            {couriers.map((courier) => (
              <option key={courier.id} value={courier.id}>
                {courier.name}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          Amount received
          <input
            name="amount"
            required
            inputMode="decimal"
            placeholder="12500.00"
            className={input}
          />
        </label>
        <label className={label}>
          Paid into
          <select name="destination" defaultValue="BANK" className={input}>
            <option value="BANK">Bank account</option>
            <option value="CASH">Cash drawer</option>
          </select>
        </label>
        <label className={label}>
          Received date
          <input name="receivedAt" type="date" className={input} />
        </label>
        <label className={label}>
          Courier reference
          <input name="reference" maxLength={120} placeholder="Payout advice / batch no." className={input} />
        </label>
        <label className={label}>
          Note
          <input name="note" maxLength={200} placeholder="Optional" className={input} />
        </label>
      </div>
      <p className="text-xs text-ink-500">
        This clears the Courier COD Clearing account (1060) against cash or bank. Verify
        each COD payment first; the remittance itself is a separate money movement.
      </p>
      <Message state={state} />
      <Submit idle="Post remittance" busy="Posting…" />
    </form>
  );
}
