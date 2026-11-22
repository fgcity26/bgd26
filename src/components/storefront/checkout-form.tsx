"use client";

import { useActionState, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { placeOrderAction } from "@/app/actions/storefront";
import type { StorefrontActionState } from "@/lib/storefront/action-state";
import type { CartView } from "@/lib/storefront/cart";
import type { DeliveryZoneView } from "@/lib/storefront/checkout";
import { formatMoney } from "@/lib/inventory/format";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="min-h-12 w-full rounded-xl bg-brand-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:bg-slate-300"
    >
      {pending ? "Placing order…" : "Place order"}
    </button>
  );
}

const PAYMENT_OPTIONS = [
  { value: "COD", label: "Cash on delivery", note: "Pay the courier when the parcel arrives." },
  {
    value: "BKASH",
    label: "bKash",
    note: "Send the total to our bKash number, then enter the transaction id.",
  },
  {
    value: "NAGAD",
    label: "Nagad",
    note: "Send the total to our Nagad number, then enter the transaction id.",
  },
] as const;

export function CheckoutForm({
  cart,
  zones,
  idempotencyKey,
  account = null,
  addresses = [],
  loyalty = null,
}: {
  cart: CartView;
  zones: DeliveryZoneView[];
  idempotencyKey: string;
  account?: { fullName: string; mobile: string } | null;
  addresses?: Array<{
    id: string;
    label: string | null;
    recipientName: string;
    mobileNormalized: string;
    division: string;
    district: string;
    upazila: string;
    area: string | null;
    addressLine: string;
    postcode: string | null;
    isDefault: boolean;
  }>;
  loyalty?: { balance: number; maxPoints: number } | null;
}) {
  const [state, formAction] = useActionState<StorefrontActionState, FormData>(
    placeOrderAction,
    {},
  );
  const savedAddress = addresses.find((entry) => entry.isDefault) ?? addresses[0] ?? null;
  const [zoneId, setZoneId] = useState(() => {
    if (savedAddress) {
      const match = zones.find(
        (entry) =>
          entry.division === savedAddress.division && entry.district === savedAddress.district,
      );
      if (match) return match.id;
    }
    return zones[0]?.id ?? "";
  });
  const [paymentMethod, setPaymentMethod] = useState<string>("COD");
  const [pointsInput, setPointsInput] = useState("0");
  const zone = zones.find((entry) => entry.id === zoneId) ?? zones[0];

  const maxPoints = loyalty?.maxPoints ?? 0;
  const points = Math.min(maxPoints, Math.max(0, Math.trunc(Number(pointsInput) || 0)));

  const totals = useMemo(() => {
    const merchandise = Number(cart.subtotal) + Number(cart.vatTotal);
    const couponDiscount = Number(cart.couponDiscount);
    const freeShippingCoupon = cart.coupon?.freeShipping === true;
    const threshold = zone?.freeShippingThreshold ? Number(zone.freeShippingThreshold) : null;
    const freeByThreshold = threshold !== null && merchandise >= threshold;
    const delivery =
      freeShippingCoupon || freeByThreshold ? 0 : Number(zone?.charge ?? 0);
    return {
      merchandise,
      couponDiscount,
      delivery,
      total: Math.max(0, merchandise - couponDiscount + delivery - points),
    };
  }, [cart.subtotal, cart.vatTotal, cart.couponDiscount, cart.coupon, zone, points]);

  function applySavedAddress(value: string) {
    const address = addresses.find((entry) => entry.id === value);
    if (!address) return;
    const form = document.querySelector<HTMLFormElement>("form[data-checkout]");
    const set = (name: string, next: string) => {
      const element = form?.elements.namedItem(name);
      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
        element.value = next;
      }
    };
    set("recipientName", address.recipientName);
    set("recipientMobile", address.mobileNormalized);
    set(
      "address",
      [address.addressLine, address.area, address.upazila, address.district]
        .filter((part): part is string => Boolean(part && part.trim()))
        .join(", "),
    );
    const match =
      zones.find(
        (entry) => entry.division === address.division && entry.district === address.district,
      ) ?? zones.find((entry) => entry.district === address.district);
    if (match) setZoneId(match.id);
  }

  const groups = useMemo(() => {
    const map = new Map<string, DeliveryZoneView[]>();
    for (const entry of zones) {
      const key = `${entry.division} · ${entry.district}`;
      const list = map.get(key) ?? [];
      list.push(entry);
      map.set(key, list);
    }
    return [...map.entries()];
  }, [zones]);

  return (
    <form action={formAction} data-checkout className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <input type="hidden" name="division" value={zone?.division ?? ""} />
      <input type="hidden" name="district" value={zone?.district ?? ""} />
      {cart.coupon ? <input type="hidden" name="couponCode" value={cart.coupon.code} /> : null}

      <div className="space-y-6">
        <section className="rounded-2xl border border-slate-200 p-4 sm:p-5">
          <h2 className="text-base font-semibold">Contact</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-ink-700">Full name</span>
              <input
                name="customerName"
                required
                minLength={2}
                autoComplete="name"
                defaultValue={account?.fullName ?? ""}
                className="min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-ink-700">Mobile</span>
              <input
                name="customerMobile"
                required
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="01XXXXXXXXX"
                defaultValue={account?.mobile ?? ""}
                readOnly={Boolean(account)}
                className={`min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm ${
                  account ? "bg-slate-50 text-ink-500" : ""
                }`}
              />
              {account ? (
                <span className="mt-1 block text-xs text-ink-500">
                  Ordering as {account.mobile}. Sign out to use another number.
                </span>
              ) : null}
            </label>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 p-4 sm:p-5">
          <h2 className="text-base font-semibold">Delivery</h2>
          <div className="mt-3 grid gap-3">
            {addresses.length > 0 ? (
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-ink-700">Saved address</span>
                <select
                  defaultValue={savedAddress?.id ?? ""}
                  onChange={(event) => applySavedAddress(event.target.value)}
                  className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm"
                >
                  <option value="">Choose a saved address…</option>
                  {addresses.map((address) => (
                    <option key={address.id} value={address.id}>
                      {address.label ?? "Address"} · {address.recipientName} · {address.district}
                    </option>
                  ))}
                </select>
                <span className="mt-1 block text-xs text-ink-500">
                  Picking one fills the recipient and address below.
                </span>
              </label>
            ) : null}

            <label className="block text-sm">
              <span className="mb-1 block font-medium text-ink-700">Delivery area</span>
              <select
                name="deliveryZoneId"
                required
                value={zoneId}
                onChange={(event) => setZoneId(event.target.value)}
                className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm"
              >
                {groups.map(([label, entries]) => (
                  <optgroup key={label} label={label}>
                    {entries.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.name} · ৳{formatMoney(entry.charge)} · {entry.estimatedDaysMin}–
                        {entry.estimatedDaysMax} days
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>

            <label className="block text-sm">
              <span className="mb-1 block font-medium text-ink-700">Full address</span>
              <textarea
                name="address"
                required
                minLength={6}
                rows={3}
                autoComplete="street-address"
                placeholder="House, road, area, landmark"
                defaultValue={
                  savedAddress
                    ? [savedAddress.addressLine, savedAddress.area, savedAddress.upazila]
                        .filter((part): part is string => Boolean(part && part.trim()))
                        .join(", ")
                    : ""
                }
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
              />
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-ink-700">
                  Recipient name <span className="text-ink-500">(optional)</span>
                </span>
                <input
                  name="recipientName"
                  autoComplete="name"
                  defaultValue={savedAddress?.recipientName ?? account?.fullName ?? ""}
                  className="min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm"
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-ink-700">
                  Recipient mobile <span className="text-ink-500">(optional)</span>
                </span>
                <input
                  name="recipientMobile"
                  type="tel"
                  inputMode="tel"
                  defaultValue={savedAddress?.mobileNormalized ?? account?.mobile ?? ""}
                  className="min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm"
                />
              </label>
            </div>

            <label className="block text-sm">
              <span className="mb-1 block font-medium text-ink-700">
                Order note <span className="text-ink-500">(optional)</span>
              </span>
              <textarea
                name="note"
                rows={2}
                placeholder="Delivery instruction, gift message, etc."
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 p-4 sm:p-5">
          <h2 className="text-base font-semibold">Payment</h2>
          <div className="mt-3 space-y-2">
            {PAYMENT_OPTIONS.map((option) => (
              <label
                key={option.value}
                className={`flex cursor-pointer gap-3 rounded-xl border p-3 text-sm transition-colors ${
                  paymentMethod === option.value
                    ? "border-brand-400 bg-brand-50"
                    : "border-slate-200"
                }`}
              >
                <input
                  type="radio"
                  name="paymentMethod"
                  value={option.value}
                  checked={paymentMethod === option.value}
                  onChange={() => setPaymentMethod(option.value)}
                  className="mt-1"
                />
                <span>
                  <span className="block font-medium text-ink-900">{option.label}</span>
                  <span className="mt-0.5 block text-xs text-ink-500">{option.note}</span>
                </span>
              </label>
            ))}
          </div>

          {paymentMethod !== "COD" ? (
            <label className="mt-3 block text-sm">
              <span className="mb-1 block font-medium text-ink-700">Transaction id</span>
              <input
                name="paymentReference"
                required
                minLength={6}
                autoComplete="off"
                className="min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm"
              />
              <span className="mt-1 block text-xs text-ink-500">
                The order is confirmed after we verify the transaction.
              </span>
            </label>
          ) : null}
        </section>
      </div>

      <aside className="h-fit rounded-2xl border border-slate-200 bg-slate-50 p-4 lg:sticky lg:top-24">
        <h2 className="text-base font-semibold">Order summary</h2>
        <ul className="mt-3 space-y-2 text-sm">
          {cart.lines.map((line) => (
            <li key={line.itemId} className="flex justify-between gap-3">
              <span className="min-w-0">
                <span className="block truncate font-medium text-ink-700">{line.productName}</span>
                <span className="text-xs text-ink-500">
                  {line.variantName} × {line.quantity}
                </span>
              </span>
              <span className="shrink-0">৳{formatMoney(line.lineTotal)}</span>
            </li>
          ))}
        </ul>

        <dl className="mt-4 space-y-1.5 border-t border-slate-200 pt-3 text-sm">
          <div className="flex justify-between">
            <dt className="text-ink-500">Merchandise</dt>
            <dd>৳{formatMoney(totals.merchandise)}</dd>
          </div>
          {totals.couponDiscount > 0 ? (
            <div className="flex justify-between text-brand-700">
              <dt>Coupon {cart.coupon?.code}</dt>
              <dd>−৳{formatMoney(totals.couponDiscount)}</dd>
            </div>
          ) : null}
          <div className="flex justify-between">
            <dt className="text-ink-500">Delivery</dt>
            <dd>{totals.delivery === 0 ? "Free" : `৳${formatMoney(totals.delivery)}`}</dd>
          </div>
          {points > 0 ? (
            <div className="flex justify-between text-brand-700">
              <dt>Loyalty points ({points})</dt>
              <dd>−৳{formatMoney(points)}</dd>
            </div>
          ) : null}
          <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-semibold">
            <dt>Total</dt>
            <dd>৳{formatMoney(totals.total)}</dd>
          </div>
        </dl>

        {loyalty && loyalty.balance > 0 ? (
          <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3">
            <p className="text-sm font-medium text-ink-800">
              Loyalty points · {loyalty.balance}
            </p>
            {maxPoints > 0 ? (
              <>
                <label className="mt-2 block text-xs font-medium text-ink-600">
                  Spend points on this order (up to {maxPoints})
                  <input
                    name="loyaltyRedeemPoints"
                    type="number"
                    min={0}
                    max={maxPoints}
                    step={1}
                    value={pointsInput}
                    onChange={(event) =>
                      setPointsInput(
                        String(
                          Math.min(
                            maxPoints,
                            Math.max(0, Math.trunc(Number(event.target.value) || 0)),
                          ),
                        ),
                      )
                    }
                    className="mt-1 min-h-10 w-full rounded-lg border border-slate-300 px-3 text-sm"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => setPointsInput(String(maxPoints))}
                  className="mt-2 text-xs font-medium text-brand-700 hover:underline"
                >
                  Use the maximum {maxPoints} points
                </button>
                <p className="mt-1 text-[11px] text-ink-500">
                  One point is ৳1. Points can cover at most 20% of merchandise.
                </p>
              </>
            ) : (
              <p className="mt-1 text-xs text-ink-500">
                Points cannot be used on this order. One point is ৳1 and the 20% cap
                depends on the merchandise total.
              </p>
            )}
          </div>
        ) : null}

        {state.error ? (
          <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {state.error}
          </p>
        ) : null}

        <div className="mt-4">
          <SubmitButton />
        </div>
        <p className="mt-2 text-xs text-ink-500">
          By placing the order you agree to our delivery and return policy.
        </p>
      </aside>
    </form>
  );
}
