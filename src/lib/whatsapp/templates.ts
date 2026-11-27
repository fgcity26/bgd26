import type { WaNotificationEvent } from "@/generated/prisma/client";

/** The events the shop sends automatically. MANUAL is a staff-initiated reply. */
export type AutomaticEvent = Exclude<WaNotificationEvent, "MANUAL">;

export type NotificationData = {
  customerName: string;
  orderNumber?: string;
  refundNumber?: string;
  total?: string;
  amount?: string;
  courier?: string | null;
  trackingNumber?: string | null;
  method?: string | null;
  dueAmount?: string;
  link?: string;
};

/**
 * Positional template parameters. The order matters: Meta matches `{{1}}`,
 * `{{2}}` … to this array, so the registry body and this function must be
 * changed together. The defaults shipped with the app follow the same order.
 */
export function buildVariables(event: AutomaticEvent, data: NotificationData): string[] {
  const name = data.customerName.trim() || "কাস্টমার";
  switch (event) {
    case "ORDER_CONFIRMED":
      return [name, data.orderNumber ?? "", data.total ?? ""];
    case "ORDER_SHIPPED":
      return [
        name,
        data.orderNumber ?? "",
        data.courier?.trim() || "আমাদের ডেলিভারি",
        data.trackingNumber?.trim() || "—",
      ];
    case "REFUND_COMPLETED":
      return [
        name,
        data.orderNumber ?? "",
        data.amount ?? "",
        data.method ?? "আগের মাধ্যমে",
      ];
    case "PAYMENT_REMINDER":
      return [name, data.orderNumber ?? "", data.dueAmount ?? data.total ?? ""];
    case "REVIEW_REQUEST":
      return [name, data.orderNumber ?? "", data.link ?? ""];
  }
}

/** Replace `{{1}}` style placeholders for the on-screen preview. */
export function renderTemplate(body: string, variables: string[]): string {
  return body.replace(/\{\{\s*(\d+)\s*\}\}/g, (match, index: string) => {
    const value = variables[Number(index) - 1];
    return value === undefined ? match : value;
  });
}

/** Which setting switch controls an event. */
export const EVENT_SETTING: Record<
  AutomaticEvent,
  "orderConfirmation" | "orderShipped" | "refundCompleted" | "paymentReminder" | "reviewRequest"
> = {
  ORDER_CONFIRMED: "orderConfirmation",
  ORDER_SHIPPED: "orderShipped",
  REFUND_COMPLETED: "refundCompleted",
  PAYMENT_REMINDER: "paymentReminder",
  REVIEW_REQUEST: "reviewRequest",
};

export const EVENT_LABELS: Record<AutomaticEvent, string> = {
  ORDER_CONFIRMED: "Order confirmed",
  ORDER_SHIPPED: "Order shipped",
  REFUND_COMPLETED: "Refund completed",
  PAYMENT_REMINDER: "Payment reminder",
  REVIEW_REQUEST: "Review request",
};

/**
 * Templates shipped in the migration so the module is usable before the owner
 * registers Meta's exact wording. They are PENDING until the owner copies the
 * approved text and marks them APPROVED.
 */
export const DEFAULT_TEMPLATES: Array<{
  name: string;
  language: string;
  category: "UTILITY" | "MARKETING";
  event: AutomaticEvent;
  bodyText: string;
  headerText: string | null;
  footerText: string | null;
}> = [
  {
    name: "order_confirmation",
    language: "bn",
    category: "UTILITY",
    event: "ORDER_CONFIRMED",
    headerText: null,
    bodyText:
      "আসসালামু আলাইকুম {{1}}, আপনার অর্ডার {{2}} নিশ্চিত হয়েছে। মোট {{3}} টাকা। ধন্যবাদ — bgd26।",
    footerText: "bgd26.com",
  },
  {
    name: "order_shipped",
    language: "bn",
    category: "UTILITY",
    event: "ORDER_SHIPPED",
    headerText: null,
    bodyText:
      "আপনার অর্ডার {{1}} পাঠানো হয়েছে। কুরিয়ার {{2}}, ট্র্যাকিং নম্বর {{3}}।",
    footerText: "bgd26.com",
  },
  {
    name: "refund_completed",
    language: "bn",
    category: "UTILITY",
    event: "REFUND_COMPLETED",
    headerText: null,
    bodyText:
      "আপনার অর্ডার {{1}}-এর {{3}} টাকার রিফান্ড সম্পন্ন হয়েছে। মাধ্যম: {{4}}। ধন্যবাদ।",
    footerText: "bgd26.com",
  },
  {
    name: "payment_reminder",
    language: "bn",
    category: "UTILITY",
    event: "PAYMENT_REMINDER",
    headerText: null,
    bodyText:
      "আসসালামু আলাইকুম {{1}}, অর্ডার {{2}}-এর বাকি {{3}} টাকা পরিশোধ করুন। ধন্যবাদ।",
    footerText: "bgd26.com",
  },
  {
    name: "review_request",
    language: "bn",
    category: "MARKETING",
    event: "REVIEW_REQUEST",
    headerText: null,
    bodyText: "ধন্যবাদ {{1}}! আপনার অর্ডার {{2}} কেমন লেগেছে জানান: {{3}}",
    footerText: "bgd26.com",
  },
];
