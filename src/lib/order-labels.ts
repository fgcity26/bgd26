/** Human labels shared by the storefront account pages. */
export const ORDER_STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  PENDING_PAYMENT: "Waiting for payment",
  CONFIRMED: "Confirmed",
  PROCESSING: "Processing",
  READY_TO_SHIP: "Ready to ship",
  SHIPPED: "Shipped",
  DELIVERED: "Delivered",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  RETURNED: "Returned",
  REFUNDED: "Refunded",
  ON_HOLD: "On hold",
};

export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  UNPAID: "Unpaid",
  PARTIALLY_PAID: "Partly paid",
  PENDING_VERIFICATION: "Verifying payment",
  PAID: "Paid",
  PARTIALLY_REFUNDED: "Partly refunded",
  REFUNDED: "Refunded",
  FAILED: "Payment failed",
};

export const FULFILLMENT_LABELS: Record<string, string> = {
  UNFULFILLED: "Not fulfilled",
  PENDING_DROPSHIP: "With the supplier",
  PARTIALLY_FULFILLED: "Partly fulfilled",
  FULFILLED: "Fulfilled",
  RETURNED: "Returned",
};

export const SHIPMENT_STATUS_LABELS: Record<string, string> = {
  PENDING: "Pending",
  BOOKED: "Booked",
  PICKED_UP: "Picked up",
  IN_TRANSIT: "In transit",
  OUT_FOR_DELIVERY: "Out for delivery",
  DELIVERED: "Delivered",
  RETURNED: "Returned",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
};

const TONE: Record<string, string> = {
  CONFIRMED: "bg-sky-50 text-sky-800 ring-sky-200",
  PROCESSING: "bg-sky-50 text-sky-800 ring-sky-200",
  READY_TO_SHIP: "bg-amber-50 text-amber-800 ring-amber-200",
  SHIPPED: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  DELIVERED: "bg-brand-50 text-brand-700 ring-brand-200",
  COMPLETED: "bg-brand-50 text-brand-700 ring-brand-200",
  CANCELLED: "bg-red-50 text-red-700 ring-red-200",
  RETURNED: "bg-red-50 text-red-700 ring-red-200",
  REFUNDED: "bg-red-50 text-red-700 ring-red-200",
  ON_HOLD: "bg-amber-50 text-amber-800 ring-amber-200",
  PAID: "bg-brand-50 text-brand-700 ring-brand-200",
  PENDING_VERIFICATION: "bg-amber-50 text-amber-800 ring-amber-200",
  UNPAID: "bg-slate-100 text-ink-700 ring-slate-200",
  PARTIALLY_PAID: "bg-amber-50 text-amber-800 ring-amber-200",
  FAILED: "bg-red-50 text-red-700 ring-red-200",
};

export function statusTone(status: string): string {
  return TONE[status] ?? "bg-slate-100 text-ink-700 ring-slate-200";
}
