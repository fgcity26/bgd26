"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import { createSaleAction } from "@/app/actions/orders";

/**
 * The counter till.
 *
 * Everything the cashier sees is a preview: the server re-prices the sale from
 * the catalogue before it stores anything. Two things are deliberately local —
 * the catalogue cache (so search survives a dropped connection) and the sale
 * queue (so an offline sale is never lost and never rejected). A manager PIN is
 * never written to disk; only an online sale can carry one.
 */

export type PosDeviceOption = {
  id: string;
  code: string;
  name: string;
  storeName: string;
  warehouseId: string;
  warehouseCode: string;
};

export type PosShiftOption = {
  id: string;
  shiftNumber: string;
  deviceId: string;
  openingFloat: string;
};

export type PosVariant = {
  variantId: string;
  sku: string;
  barcode: string | null;
  name: string;
  productName: string;
  price: string;
  vatPercentage: string;
  fulfillmentType: string;
  available: string;
};

type CartLine = PosVariant & { quantity: number };

type PaymentLine = {
  key: number;
  method: string;
  amount: string;
  reference: string;
};

type QueuedSale = {
  uuid: string;
  queuedAt: string;
  payload: string;
};

const CATALOG_KEY = "bgd26.pos.catalog.v1";
const QUEUE_KEY = "bgd26.pos.queue.v1";
const QUEUE_EVENT = "bgd26-pos-queue";

const METHODS = [
  { value: "CASH", label: "Cash · নগদ" },
  { value: "BKASH", label: "bKash" },
  { value: "NAGAD", label: "Nagad" },
  { value: "CARD", label: "Card" },
  { value: "BANK_TRANSFER", label: "Bank transfer" },
] as const;

const moneyFormat = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function toNumber(value: string | number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: number): string {
  return moneyFormat.format(Number.isFinite(value) ? value : 0);
}

function computeTotals(
  lines: CartLine[],
  discountInput: string,
  deliveryInput: string,
  loyaltyPointsInput: string,
) {
  const grosses = lines.map((line) => round2(toNumber(line.price) * line.quantity));
  const grossTotal = round2(grosses.reduce((sum, gross) => sum + gross, 0));
  const discount = Math.min(Math.max(toNumber(discountInput), 0), grossTotal);
  const delivery = Math.max(toNumber(deliveryInput), 0);
  const loyalty = Math.max(Math.floor(toNumber(loyaltyPointsInput)), 0);

  const shares: number[] = [];
  let allocated = 0;
  grosses.forEach((gross, index) => {
    if (index === grosses.length - 1) {
      shares.push(round2(discount - allocated));
      return;
    }
    const share = grossTotal === 0 ? 0 : round2((gross * discount) / grossTotal);
    shares.push(share);
    allocated = round2(allocated + share);
  });

  let subtotal = 0;
  let vatTotal = 0;
  const lineTotals = lines.map((line, index) => {
    const gross = grosses[index];
    const netGross = round2(gross - shares[index]);
    const rate = toNumber(line.vatPercentage);
    const vat = round2((gross * rate) / (100 + rate));
    subtotal = round2(subtotal + (gross - vat));
    vatTotal = round2(vatTotal + vat);
    return { gross, discount: shares[index], netGross, vat };
  });

  const grandTotal = round2(subtotal + vatTotal - discount + delivery - loyalty);
  return {
    lines: lineTotals,
    grossTotal,
    subtotal,
    vatTotal,
    discount,
    delivery,
    loyalty,
    grandTotal,
    discountRate: grossTotal === 0 ? 0 : discount / grossTotal,
  };
}

function readQueue(): QueuedSale[] {
  try {
    const raw = window.localStorage.getItem(QUEUE_KEY);
    const parsed = raw ? (JSON.parse(raw) as QueuedSale[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeQueue(items: QueuedSale[]): void {
  window.localStorage.setItem(QUEUE_KEY, JSON.stringify(items));
  window.dispatchEvent(new Event(QUEUE_EVENT));
}

function subscribeQueue(callback: () => void): () => void {
  window.addEventListener(QUEUE_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(QUEUE_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

function subscribeOnline(callback: () => void): () => void {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

function readCatalog(): PosVariant[] {
  try {
    const raw = window.localStorage.getItem(CATALOG_KEY);
    const parsed = raw ? (JSON.parse(raw) as { variants?: PosVariant[] }) : null;
    return Array.isArray(parsed?.variants) ? parsed.variants : [];
  } catch {
    return [];
  }
}

function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `pos-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function PosTerminal({
  devices,
  shifts,
  defaultDeviceId,
}: {
  devices: PosDeviceOption[];
  shifts: PosShiftOption[];
  defaultDeviceId?: string;
}) {
  const [deviceId, setDeviceId] = useState(defaultDeviceId ?? devices[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PosVariant[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customerMobile, setCustomerMobile] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [loyaltyPoints, setLoyaltyPoints] = useState("");
  const [loyaltyInfo, setLoyaltyInfo] = useState<{
    id: string;
    name: string;
    balance: number;
    blocked: boolean;
  } | null>(null);
  const [loyaltyLoading, setLoyaltyLoading] = useState(false);
  const [discount, setDiscount] = useState("");
  const [delivery, setDelivery] = useState("");
  const [managerPin, setManagerPin] = useState("");
  const [payments, setPayments] = useState<PaymentLine[]>([
    { key: 1, method: "CASH", amount: "", reference: "" },
  ]);
  const [nextPaymentKey, setNextPaymentKey] = useState(2);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<{
    orderNumber: string;
    grandTotal: string;
    offline: boolean;
    duplicate: boolean;
    approvalDeferred: boolean;
  } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const queued = useSyncExternalStore(
    subscribeQueue,
    () => readQueue().length,
    () => 0,
  );
  const online = useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
  const [pending, startTransition] = useTransition();
  const searchRef = useRef<HTMLInputElement>(null);

  const device = devices.find((item) => item.id === deviceId) ?? null;
  const shift = shifts.find((item) => item.deviceId === deviceId) ?? null;
  const baseTotals = useMemo(
    () => computeTotals(cart, discount, delivery, "0"),
    [cart, discount, delivery],
  );
  const maxLoyaltyPoints = loyaltyInfo
    ? Math.max(
        0,
        Math.min(
          loyaltyInfo.balance,
          Math.floor(Math.max(0, baseTotals.subtotal - baseTotals.discount) * 0.2),
        ),
      )
    : 0;
  const loyaltyPointsValue = Math.max(
    0,
    Math.min(Math.floor(toNumber(loyaltyPoints)), maxLoyaltyPoints),
  );
  const totals = useMemo(
    () => computeTotals(cart, discount, delivery, String(loyaltyPointsValue)),
    [cart, discount, delivery, loyaltyPointsValue],
  );
  const paid = round2(
    payments.reduce((sum, payment) => sum + toNumber(payment.amount), 0),
  );
  const due = round2(totals.grandTotal - paid);
  const needsPin = customerMobile.trim().length === 0 || totals.discountRate > 0.05;

  // Cache a bounded catalogue so local search keeps working offline.
  useEffect(() => {
    if (!device) return;
    let cancelled = false;
    fetch(`/api/pos/catalog?warehouse=${encodeURIComponent(device.warehouseId)}`, {
      cache: "no-store",
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { variants?: PosVariant[] } | null) => {
        if (cancelled || !data?.variants) return;
        window.localStorage.setItem(
          CATALOG_KEY,
          JSON.stringify({ savedAt: new Date().toISOString(), variants: data.variants }),
        );
      })
      .catch(() => {
        // Offline: keep whatever snapshot is already on the device.
      });
    return () => {
      cancelled = true;
    };
  }, [device]);

  // Live points preview. Offline the till keeps selling; it simply cannot
  // redeem, and the sale earns points when it syncs and is paid.
  useEffect(() => {
    const mobile = customerMobile.trim();
    if (!online || mobile.replace(/\D/g, "").length < 11) {
      const clear = window.setTimeout(() => {
        setLoyaltyInfo(null);
        setLoyaltyPoints("");
      }, 0);
      return () => window.clearTimeout(clear);
    }
    let cancelled = false;
    const handle = window.setTimeout(() => {
      setLoyaltyLoading(true);
      const params = new URLSearchParams({
        mobile,
        subtotal: String(totals.subtotal),
        discount: String(totals.discount),
      });
      fetch(`/api/pos/loyalty?${params.toString()}`, { cache: "no-store" })
        .then((response) => (response.ok ? response.json() : null))
        .then(
          (
            data:
              | {
                  customer?: {
                    id: string;
                    name: string;
                    balance: number;
                    blocked: boolean;
                  } | null;
                }
              | null,
          ) => {
            if (cancelled) return;
            setLoyaltyInfo(data?.customer ?? null);
            if (!data?.customer) setLoyaltyPoints("");
          },
        )
        .catch(() => {
          if (!cancelled) setLoyaltyInfo(null);
        })
        .finally(() => {
          if (!cancelled) setLoyaltyLoading(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [customerMobile, online, totals.subtotal, totals.discount]);

  const search = useCallback(
    async (value: string) => {      if (!device) return;
      const trimmed = value.trim();
      if (!trimmed) {
        setResults([]);
        setSearchError("");
        return;
      }
      setSearching(true);
      setSearchError("");
      try {
        const response = await fetch(
          `/api/pos/search?q=${encodeURIComponent(trimmed)}&warehouse=${encodeURIComponent(device.warehouseId)}`,
          { cache: "no-store" },
        );
        if (!response.ok) throw new Error("search failed");
        const data = (await response.json()) as { variants: PosVariant[] };
        setResults(data.variants);
      } catch {
        const needle = trimmed.toLowerCase();
        const local = readCatalog()
          .filter(
            (variant) =>
              variant.sku.toLowerCase().includes(needle) ||
              (variant.barcode ?? "").toLowerCase().includes(needle) ||
              variant.name.toLowerCase().includes(needle) ||
              variant.productName.toLowerCase().includes(needle),
          )
          .slice(0, 20);
        setResults(local);
        setSearchError(
          local.length > 0
            ? "Offline: showing the saved catalogue."
            : "Offline and not in the saved catalogue.",
        );
      } finally {
        setSearching(false);
      }
    },
    [device],
  );

  useEffect(() => {
    const handle = window.setTimeout(() => {
      void search(query);
    }, 180);
    return () => window.clearTimeout(handle);
  }, [query, search]);

  const addVariant = (variant: PosVariant) => {
    setReceipt(null);
    setCart((current) => {
      const existing = current.find((line) => line.variantId === variant.variantId);
      if (existing) {
        return current.map((line) =>
          line.variantId === variant.variantId
            ? { ...line, quantity: round2(line.quantity + 1) }
            : line,
        );
      }
      return [...current, { ...variant, quantity: 1 }];
    });
    setQuery("");
    setResults([]);
    searchRef.current?.focus();
  };

  const changeQuantity = (variantId: string, next: number) => {
    setCart((current) =>
      current
        .map((line) =>
          line.variantId === variantId ? { ...line, quantity: Math.max(0, round2(next)) } : line,
        )
        .filter((line) => line.quantity > 0),
    );
  };

  const removeLine = (variantId: string) => {
    setCart((current) => current.filter((line) => line.variantId !== variantId));
  };

  const addPayment = () => {
    setPayments((current) => [
      ...current,
      { key: nextPaymentKey, method: "CASH", amount: "", reference: "" },
    ]);
    setNextPaymentKey((value) => value + 1);
  };

  const updatePayment = (key: number, patch: Partial<PaymentLine>) => {
    setPayments((current) =>
      current.map((payment) => (payment.key === key ? { ...payment, ...patch } : payment)),
    );
  };

  const removePayment = (key: number) => {
    setPayments((current) =>
      current.length === 1 ? current : current.filter((payment) => payment.key !== key),
    );
  };

  const resetSale = () => {
    setCart([]);
    setCustomerMobile("");
    setCustomerName("");
    setLoyaltyPoints("");
    setLoyaltyInfo(null);
    setDiscount("");
    setDelivery("");
    setManagerPin("");
    setPayments([{ key: nextPaymentKey, method: "CASH", amount: "", reference: "" }]);
    setNextPaymentKey((value) => value + 1);
    setQuery("");
    setResults([]);
  };

  const buildPayload = (saleUuid: string, source: "POS_ONLINE" | "POS_OFFLINE") => {
    if (!device) throw new Error("Choose a POS device first.");
    if (cart.length === 0) throw new Error("Add at least one item.");
    if (payments.length === 0) throw new Error("Add at least one payment.");
    const usable = payments.filter((payment) => toNumber(payment.amount) > 0);
    if (usable.length === 0) throw new Error("Enter the amount received.");
    const redeemPoints = source === "POS_ONLINE" ? loyaltyPointsValue : 0;
    if (redeemPoints > maxLoyaltyPoints) {
      throw new Error(`This sale can redeem at most ${maxLoyaltyPoints} points.`);
    }
    return {
      source,
      deviceId: device.id,
      shiftId: shift?.id ?? null,
      customerMobile: customerMobile.trim() || null,
      customerName: customerName.trim() || null,
      lines: cart.map((line) => ({
        variantId: line.variantId,
        quantity: String(line.quantity),
      })),
      discountTotal: discount.trim() || "0",
      loyaltyRedeemPoints: redeemPoints,
      payments: usable.map((payment) => ({
        method: payment.method,
        amount: payment.amount,
        reference: payment.reference.trim() || null,
      })),
      managerPin: source === "POS_ONLINE" ? managerPin.trim() || null : null,
      clientTransactionUuid: saleUuid,
      offlineCreatedAt: source === "POS_OFFLINE" ? new Date().toISOString() : null,
    };
  };

  // A PIN never leaves the browser session: a queued sale is stored without it
  // and flagged for manager review when it is replayed.
  const queuedPayload = (payload: ReturnType<typeof buildPayload>) => ({
    ...payload,
    source: "POS_OFFLINE" as const,
    managerPin: null,
    loyaltyRedeemPoints: 0,
    offlineCreatedAt: payload.offlineCreatedAt ?? new Date().toISOString(),
  });

  const enqueue = (payload: string) => {
    const items = readQueue();
    items.push({ uuid: uuid(), queuedAt: new Date().toISOString(), payload });
    writeQueue(items);
  };

  const submit = () => {
    setError("");
    setReceipt(null);
    if (cart.length === 0) {
      setError("Add at least one item.");
      return;
    }
    if (needsPin && !managerPin.trim() && online) {
      setError(
        customerMobile.trim()
          ? "A discount above 5 % needs a manager PIN."
          : "A walk-in cash sale needs a manager PIN.",
      );
      return;
    }

    const saleUuid = uuid();
    const offline = !navigator.onLine;
    let payload: ReturnType<typeof buildPayload>;
    try {
      payload = buildPayload(saleUuid, offline ? "POS_OFFLINE" : "POS_ONLINE");
    } catch (buildError) {
      setError(buildError instanceof Error ? buildError.message : "Check the sale.");
      return;
    }

    if (offline) {
      enqueue(JSON.stringify(payload));
      setReceipt({
        orderNumber: "Saved on this device",
        grandTotal: totals.grandTotal.toFixed(2),
        offline: true,
        duplicate: false,
        approvalDeferred: needsPin,
      });
      resetSale();
      return;
    }

    const formData = new FormData();
    formData.set("payload", JSON.stringify(payload));

    startTransition(async () => {
      try {
        const result = await createSaleAction({}, formData);
        if (result.offline) {
          enqueue(JSON.stringify(queuedPayload(payload)));
          setReceipt({
            orderNumber: "Saved on this device",
            grandTotal: totals.grandTotal.toFixed(2),
            offline: true,
            duplicate: false,
            approvalDeferred: needsPin,
          });
          resetSale();
          return;
        }
        if (result.error || !result.sale) {
          setError(result.error ?? "The sale could not be saved.");
          return;
        }
        setReceipt({
          orderNumber: result.sale.orderNumber,
          grandTotal: result.sale.grandTotal,
          offline: false,
          duplicate: result.sale.duplicate,
          approvalDeferred: result.sale.approvalDeferred,
        });
        resetSale();
      } catch {
        // The action never reached the server. Keep the sale on the device.
        enqueue(JSON.stringify(queuedPayload(payload)));
        setReceipt({
          orderNumber: "Saved on this device",
          grandTotal: totals.grandTotal.toFixed(2),
          offline: true,
          duplicate: false,
          approvalDeferred: needsPin,
        });
        resetSale();
      }
    });
  };

  const syncQueue = () => {
    if (syncing) return;
    setSyncing(true);
    setError("");
    startTransition(async () => {
      const remaining: QueuedSale[] = [];
      let synced = 0;
      for (const item of readQueue()) {
        const formData = new FormData();
        formData.set("payload", item.payload);
        try {
          const result = await createSaleAction({}, formData);
          if (result.sale || result.offline) {
            if (result.sale) synced += 1;
            if (result.offline) remaining.push(item);
          } else {
            // A validation failure will never succeed on retry; drop it and
            // surface the reason so a manager can look at the receipt.
            setError(`${item.uuid.slice(0, 8)}… rejected: ${result.error ?? "unknown error"}`);
          }
        } catch {
          remaining.push(item);
        }
      }
      writeQueue(remaining);
      setSyncing(false);
      if (synced > 0) {
        setReceipt({
          orderNumber: `${synced} offline sale${synced === 1 ? "" : "s"} synced`,
          grandTotal: "0.00",
          offline: false,
          duplicate: false,
          approvalDeferred: false,
        });
      }
    });
  };

  const onSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const first = results[0];
    if (first) addVariant(first);
  };

  return (
    <div className="space-y-4">
      {receipt ? (
        <div
          role="status"
          className="rounded-2xl bg-brand-50 p-4 text-sm text-brand-900 ring-1 ring-brand-200"
        >
          <p className="font-semibold">
            {receipt.offline ? "Sale saved on this device" : "Sale complete"} ·{" "}
            {receipt.orderNumber}
          </p>
          <p className="mt-1">
            Total ৳{money(toNumber(receipt.grandTotal))}
            {receipt.duplicate ? " · already recorded earlier" : ""}
          </p>
          {receipt.approvalDeferred ? (
            <p className="mt-1 text-amber-800">
              A manager must review this sale: it needed approval but no PIN was available.
            </p>
          ) : null}
          {receipt.offline ? (
            <p className="mt-1">It will sync automatically when the connection returns.</p>
          ) : null}
        </div>
      ) : null}

      {!online ? (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200">
          Offline mode · sales are saved on this device and synced later.
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-4">
          <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <div className="flex flex-wrap items-end gap-3">
              <label className="block flex-1 text-sm font-medium text-ink-700">
                <span>
                  Device <span className="text-xs font-normal text-ink-500">ডিভাইস</span>
                </span>
                <select
                  value={deviceId}
                  onChange={(event) => {
                    setDeviceId(event.target.value);
                    setCart([]);
                    setPayments([{ key: nextPaymentKey, method: "CASH", amount: "", reference: "" }]);
                    setNextPaymentKey((value) => value + 1);
                  }}
                  className="mt-1 block w-full min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm"
                >
                  {devices.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.code} · {item.name} · {item.warehouseCode}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex-1 text-sm">
                {shift ? (
                  <p className="rounded-xl bg-brand-50 px-3 py-2 text-brand-800 ring-1 ring-brand-200">
                    Shift {shift.shiftNumber} is open.
                  </p>
                ) : (
                  <p className="rounded-xl bg-amber-50 px-3 py-2 text-amber-900 ring-1 ring-amber-200">
                    No open shift.{" "}
                    <Link href="/pos/shifts" className="underline">
                      Open one
                    </Link>{" "}
                    to reconcile cash.
                  </p>
                )}
              </div>
            </div>
          </section>

          <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <label className="block text-sm font-medium text-ink-700" htmlFor="pos-search">
              <span>
                Scan or search <span className="text-xs font-normal text-ink-500">খুঁজুন</span>
              </span>
            </label>
            <input
              id="pos-search"
              ref={searchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onSearchKeyDown}
              autoComplete="off"
              placeholder="SKU, barcode, product name…"
              className="mt-1 block w-full min-h-12 rounded-xl border border-slate-300 px-3 text-base outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            />
            {searching ? <p className="mt-2 text-xs text-ink-500">Searching…</p> : null}
            {searchError ? <p className="mt-2 text-xs text-amber-800">{searchError}</p> : null}

            {results.length > 0 ? (
              <ul className="mt-3 divide-y divide-slate-100">
                {results.map((variant) => (
                  <li key={variant.variantId}>
                    <button
                      type="button"
                      onClick={() => addVariant(variant)}
                      className="flex w-full items-center justify-between gap-3 py-3 text-left"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">
                          {variant.productName} · {variant.name}
                        </span>
                        <span className="block text-xs text-ink-500">
                          {variant.sku} · stock {variant.available}
                        </span>
                      </span>
                      <span className="shrink-0 text-sm font-semibold">
                        ৳{money(toNumber(variant.price))}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>

          <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Cart · ঝুড়ি</h2>
              {cart.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setCart([])}
                  className="text-xs font-medium text-ink-500 underline"
                >
                  Clear
                </button>
              ) : null}
            </div>

            {cart.length === 0 ? (
              <p className="mt-3 text-sm text-ink-500">
                The cart is empty. Search or scan an item to begin.
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-slate-100">
                {cart.map((line, index) => {
                  const totalsLine = totals.lines[index];
                  return (
                    <li key={line.variantId} className="py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            {line.productName} · {line.name}
                          </p>
                          <p className="text-xs text-ink-500">
                            {line.sku} · ৳{money(toNumber(line.price))} each
                          </p>
                        </div>
                        <p className="shrink-0 text-sm font-semibold">
                          ৳{money(totalsLine?.netGross ?? 0)}
                        </p>
                      </div>
                      <div className="mt-2 flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => changeQuantity(line.variantId, line.quantity - 1)}
                          aria-label={`Decrease ${line.sku}`}
                          className="size-9 rounded-lg border border-slate-300 text-lg leading-none"
                        >
                          −
                        </button>
                        <input
                          type="number"
                          min="0"
                          step="0.001"
                          value={line.quantity}
                          onChange={(event) =>
                            changeQuantity(line.variantId, toNumber(event.target.value))
                          }
                          aria-label={`Quantity for ${line.sku}`}
                          className="min-h-9 w-20 rounded-lg border border-slate-300 px-2 text-center text-sm"
                        />
                        <button
                          type="button"
                          onClick={() => changeQuantity(line.variantId, line.quantity + 1)}
                          aria-label={`Increase ${line.sku}`}
                          className="size-9 rounded-lg border border-slate-300 text-lg leading-none"
                        >
                          +
                        </button>
                        <button
                          type="button"
                          onClick={() => removeLine(line.variantId)}
                          className="ml-auto text-xs font-medium text-red-700 underline"
                        >
                          Remove
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>

        <aside className="space-y-4">
          <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <h2 className="text-sm font-semibold">Customer · ক্রেতা</h2>
            <label className="mt-2 block text-xs font-medium text-ink-600">
              Mobile (blank = walk-in cash)
              <input
                value={customerMobile}
                onChange={(event) => {
                  setCustomerMobile(event.target.value);
                  setLoyaltyInfo(null);
                  setLoyaltyPoints("");
                }}
                inputMode="tel"
                placeholder="01XXXXXXXXX"
                className="mt-1 block w-full min-h-11 rounded-xl border border-slate-300 px-3 text-sm"
              />
            </label>
            <label className="mt-2 block text-xs font-medium text-ink-600">
              Name (optional)
              <input
                value={customerName}
                onChange={(event) => setCustomerName(event.target.value)}
                className="mt-1 block w-full min-h-11 rounded-xl border border-slate-300 px-3 text-sm"
              />
            </label>
            {customerMobile.trim().length >= 11 ? (
              loyaltyLoading ? (
                <p className="mt-2 text-xs text-ink-500">Checking loyalty points…</p>
              ) : loyaltyInfo ? (
                <div className="mt-2 rounded-xl bg-brand-50 p-3 ring-1 ring-brand-200">
                  <p className="text-xs font-medium text-brand-900">
                    {loyaltyInfo.name} · {loyaltyInfo.balance} points
                  </p>
                  {loyaltyInfo.blocked ? (
                    <p className="mt-1 text-xs text-red-800">
                      This customer is blocked and cannot redeem points.
                    </p>
                  ) : (
                    <>
                      <label className="mt-2 block text-xs font-medium text-brand-900">
                        Redeem points (max {maxLoyaltyPoints})
                        <input
                          value={loyaltyPointsValue}
                          onChange={(event) => setLoyaltyPoints(event.target.value)}
                          inputMode="numeric"
                          disabled={!online || maxLoyaltyPoints === 0}
                          placeholder="0"
                          className="mt-1 block w-full min-h-10 rounded-xl border border-brand-200 bg-white px-3 text-sm disabled:bg-slate-100"
                        />
                      </label>
                      <p className="mt-1 text-[11px] text-brand-800">
                        1 point = ৳1 · at most 20 % of net merchandise. Offline sales cannot
                        redeem.
                      </p>
                    </>
                  )}
                </div>
              ) : online ? (
                <p className="mt-2 rounded-lg bg-slate-50 px-2 py-1 text-xs text-ink-500">
                  No loyalty account for this number yet. Points are added after the first paid
                  sale.
                </p>
              ) : (
                <p className="mt-2 rounded-lg bg-amber-50 px-2 py-1 text-xs text-amber-900">
                  Offline: this sale will earn points after it syncs, but cannot redeem.
                </p>
              )
            ) : null}
            {customerMobile.trim() ? null : (
              <p className="mt-2 rounded-lg bg-amber-50 px-2 py-1 text-xs text-amber-900">
                Walk-in sales are cash-only, paid in full, and need a manager PIN.
              </p>
            )}
          </section>

          <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <h2 className="text-sm font-semibold">Payment · পেমেন্ট</h2>
            <div className="mt-2 space-y-2">
              {payments.map((payment) => (
                <div key={payment.key} className="rounded-xl bg-slate-50 p-2 ring-1 ring-slate-200">
                  <div className="flex gap-2">
                    <select
                      value={payment.method}
                      onChange={(event) =>
                        updatePayment(payment.key, { method: event.target.value })
                      }
                      aria-label="Payment method"
                      className="min-h-10 flex-1 rounded-lg border border-slate-300 bg-white px-2 text-sm"
                    >
                      {METHODS.map((method) => (
                        <option key={method.value} value={method.value}>
                          {method.label}
                        </option>
                      ))}
                    </select>
                    <input
                      value={payment.amount}
                      onChange={(event) =>
                        updatePayment(payment.key, { amount: event.target.value })
                      }
                      inputMode="decimal"
                      placeholder="Amount"
                      aria-label="Payment amount"
                      className="min-h-10 w-24 rounded-lg border border-slate-300 px-2 text-right text-sm"
                    />
                    {payments.length > 1 ? (
                      <button
                        type="button"
                        onClick={() => removePayment(payment.key)}
                        aria-label="Remove payment"
                        className="size-10 rounded-lg border border-slate-300 text-sm"
                      >
                        ×
                      </button>
                    ) : null}
                  </div>
                  {payment.method !== "CASH" ? (
                    <input
                      value={payment.reference}
                      onChange={(event) =>
                        updatePayment(payment.key, { reference: event.target.value })
                      }
                      placeholder="Transaction id / slip"
                      aria-label="Payment reference"
                      className="mt-2 min-h-10 w-full rounded-lg border border-slate-300 px-2 text-sm"
                    />
                  ) : null}
                </div>
              ))}
            </div>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={addPayment}
                className="min-h-9 rounded-lg border border-slate-300 px-3 text-xs font-medium"
              >
                Add payment
              </button>
              <button
                type="button"
                onClick={() =>
                  setPayments((current) =>
                    current.map((payment, index) =>
                      index === 0
                        ? { ...payment, amount: totals.grandTotal.toFixed(2) }
                        : payment,
                    ),
                  )
                }
                className="min-h-9 rounded-lg border border-slate-300 px-3 text-xs font-medium"
              >
                Pay full ৳{money(totals.grandTotal)}
              </button>
            </div>
            <p className="mt-2 text-xs text-ink-500">
              Received ৳{money(paid)} · {due > 0 ? `Due ৳${money(due)}` : "Fully paid"}
            </p>
            <p className="mt-1 text-[11px] text-ink-500">
              Cash is final at the drawer. bKash, Nagad, card and bank stay pending until a
              manager verifies them.
            </p>
          </section>

          <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <h2 className="text-sm font-semibold">Totals · হিসাব</h2>
            <label className="mt-2 block text-xs font-medium text-ink-600">
              Discount ৳ (above 5 % needs a manager)
              <input
                value={discount}
                onChange={(event) => setDiscount(event.target.value)}
                inputMode="decimal"
                placeholder="0.00"
                className="mt-1 block w-full min-h-10 rounded-xl border border-slate-300 px-3 text-sm"
              />
            </label>
            <label className="mt-2 block text-xs font-medium text-ink-600">
              Delivery ৳
              <input
                value={delivery}
                onChange={(event) => setDelivery(event.target.value)}
                inputMode="decimal"
                placeholder="0.00"
                className="mt-1 block w-full min-h-10 rounded-xl border border-slate-300 px-3 text-sm"
              />
            </label>

            <dl className="mt-3 space-y-1 text-sm">
              <div className="flex justify-between">
                <dt className="text-ink-500">Subtotal (excl. VAT)</dt>
                <dd>৳{money(totals.subtotal)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-500">VAT</dt>
                <dd>৳{money(totals.vatTotal)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-500">Discount</dt>
                <dd>−৳{money(totals.discount)}</dd>
              </div>
              {totals.loyalty > 0 ? (
                <div className="flex justify-between text-brand-800">
                  <dt>Loyalty points ({Math.floor(totals.loyalty)} pts)</dt>
                  <dd>−৳{money(totals.loyalty)}</dd>
                </div>
              ) : null}
              <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-semibold">
                <dt>Total</dt>
                <dd>৳{money(totals.grandTotal)}</dd>
              </div>
            </dl>

            {needsPin ? (
              <label className="mt-3 block text-xs font-medium text-ink-600">
                Manager PIN
                <input
                  value={managerPin}
                  onChange={(event) => setManagerPin(event.target.value)}
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="6-digit PIN"
                  className="mt-1 block w-full min-h-10 rounded-xl border border-slate-300 px-3 text-sm"
                />
                <span className="mt-1 block text-[11px] font-normal text-ink-500">
                  Required for walk-in cash and for discounts above 5 %. Never stored on this
                  device.
                </span>
              </label>
            ) : null}

            {error ? (
              <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-200">
                {error}
              </p>
            ) : null}

            <button
              type="button"
              onClick={submit}
              disabled={pending || cart.length === 0}
              className="mt-3 min-h-12 w-full rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {pending ? "Saving…" : `Complete sale · ৳${money(totals.grandTotal)}`}
            </button>

            {queued > 0 ? (
              <button
                type="button"
                onClick={syncQueue}
                disabled={syncing}
                className="mt-2 min-h-10 w-full rounded-xl border border-amber-300 bg-amber-50 px-4 text-xs font-semibold text-amber-900 disabled:opacity-60"
              >
                {syncing ? "Syncing…" : `Sync ${queued} queued sale${queued === 1 ? "" : "s"}`}
              </button>
            ) : null}
          </section>
        </aside>
      </div>
    </div>
  );
}
