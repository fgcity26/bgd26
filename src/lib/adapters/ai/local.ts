import type { AiAdapter, AiChatInput, AiModelMessage, AiTurn } from "./types";

/**
 * Deterministic local adapter.
 *
 * This is not a language model and it does not pretend to be one. It maps a
 * small set of clear requests to the same allow-listed tools a live model uses,
 * then formats the tool result. That keeps the assistant useful with no API
 * key, and it means the draft path is exercised end to end before a provider is
 * connected. Anything outside the small intent set gets an honest handover.
 */

const ORDER_NUMBER =
  /\b(?:SO|ORD|INV|PAY|PO|GRN)-[A-Z0-9]{4,}(?:-[A-Z0-9]+)*\b/i;

const DELIVERY_WORDS =
  /delivery|shipping|courier|ডেলিভারি|চালান|শিপিং|কুরিয়ার|ডেলিভারি চার্জ/i;

const DRAFT_WORDS = /^(?:draft|ai draft|ড্রাফট)\b/i;

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "at",
  "can",
  "do",
  "does",
  "for",
  "from",
  "how",
  "i",
  "in",
  "is",
  "it",
  "me",
  "my",
  "of",
  "on",
  "or",
  "please",
  "price",
  "stock",
  "the",
  "to",
  "what",
  "where",
  "which",
  "with",
  "you",
  "আছে",
  "কত",
  "কি",
  "কী",
  "এর",
  "এই",
  "একটি",
  "ও",
  "দাম",
  "স্টক",
  "কুরিয়ার",
  "ডেলিভারি",
  "চার্জ",
  "পণ্য",
  "আমাকে",
  "দেখাও",
  "বলো",
]);

function lastUserText(messages: AiModelMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "user") return message.content.trim();
  }
  return "";
}

function isBangla(text: string): boolean {
  return /[\u0980-\u09FF]/.test(text);
}

function queryTerms(text: string): string {
  return text
    .replace(ORDER_NUMBER, " ")
    .replace(/[^\p{L}\p{M}\p{N}._-]+/gu, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 2 && !STOPWORDS.has(word.toLowerCase()))
    .slice(0, 8)
    .join(" ")
    .trim();
}

type DraftArgs = {
  customerName: string;
  customerMobile: string;
  items: Array<{ sku: string; quantity: number }>;
  zone?: string;
  address?: string;
  note?: string;
};

function parseDraft(text: string): DraftArgs | null {
  const mobile = text.match(/(?:\+?88)?0?1[3-9]\d{8}/)?.[0];
  if (!mobile) return null;

  const itemsPart =
    text.match(/items?\s*[:=]\s*([^;|]+)/i)?.[1] ??
    text.replace(/^.*?(?:draft|ড্রাফট)/i, "");
  const items: Array<{ sku: string; quantity: number }> = [];
  for (const match of itemsPart.matchAll(/([A-Za-z0-9_.-]{2,})\s*[x×*]\s*(\d{1,3}(?:\.\d{1,3})?)/gi)) {
    const quantity = Number(match[2]);
    if (match[1] && Number.isFinite(quantity) && quantity > 0) {
      items.push({ sku: match[1], quantity });
    }
  }
  if (items.length === 0) return null;

  const pick = (name: string): string | undefined => {
    const match = text.match(new RegExp(`${name}\\s*[:=]\\s*([^;|]+)`, "i"));
    return match?.[1]?.trim() || undefined;
  };

  return {
    customerName: pick("name") ?? pick("customer") ?? "Customer",
    customerMobile: mobile,
    items,
    zone: pick("zone") ?? pick("district"),
    address: pick("address"),
    note: pick("note"),
  };
}

function formatMoney(value: unknown): string {
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value ?? "—");
  return number.toLocaleString("en-BD", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function productAnswer(data: Record<string, unknown>, bangla: boolean): string {
  const products = Array.isArray(data.products) ? data.products : [];
  if (products.length === 0) {
    return bangla
      ? "এই নাম বা SKU-তে কোনো প্রকাশিত পণ্য পাওয়া যায়নি। একটু ছোট নাম বা SKU দিয়ে আবার চেষ্টা করুন।"
      : "No published product matched that name or SKU. Try a shorter name or a SKU.";
  }
  const lines = products.slice(0, 6).map((raw) => {
    const product = raw as {
      name?: string;
      nameBn?: string;
      variants?: Array<{
        sku?: string;
        price?: string;
        availableQty?: number | null;
        fulfillmentType?: string;
      }>;
    };
    const variants = product.variants ?? [];
    const variant = variants[0];
    const stock =
      variant?.availableQty === null || variant?.availableQty === undefined
        ? variant?.fulfillmentType ?? ""
        : `${variant.availableQty}`;
    const label = bangla ? product.nameBn || product.name : product.name;
    return `• ${label} — ৳${formatMoney(variant?.price)}${variant?.sku ? ` · ${variant.sku}` : ""}${
      stock ? ` · ${bangla ? "স্টক" : "stock"} ${stock}` : ""
    }`;
  });
  return `${bangla ? "পণ্য পাওয়া গেছে" : "Products found"}:\n${lines.join("\n")}`;
}

function orderAnswer(data: Record<string, unknown>, bangla: boolean): string {
  const order = data.order as
    | {
        orderNumber?: string;
        status?: string;
        paymentStatus?: string;
        grandTotal?: string;
        placedAt?: string;
        recipientName?: string;
        mobileMasked?: string;
        items?: Array<{ name?: string; quantity?: string }>;
        shipments?: Array<{ status?: string; trackingNumber?: string | null }>;
      }
    | undefined;
  if (!order) {
    return bangla ? "ওই নম্বরের কোনো অর্ডার পাওয়া যায়নি।" : "No order matched that number.";
  }
  const items = (order.items ?? [])
    .map((item) => `${item.name ?? "item"} × ${item.quantity ?? "1"}`)
    .join(", ");
  const tracking = (order.shipments ?? [])
    .filter((shipment) => shipment.trackingNumber)
    .map((shipment) => `${shipment.status ?? ""} · ${shipment.trackingNumber}`)
    .join("; ");
  const head = bangla
    ? `${order.orderNumber}: অবস্থা ${order.status}, পেমেন্ট ${order.paymentStatus}, মোট ৳${formatMoney(order.grandTotal)}।`
    : `${order.orderNumber}: ${order.status}, payment ${order.paymentStatus}, total ৳${formatMoney(order.grandTotal)}.`;
  const detail = [
    items ? (bangla ? `পণ্য: ${items}` : `Items: ${items}`) : null,
    order.recipientName
      ? bangla
        ? `গ্রাহক: ${order.recipientName} (${order.mobileMasked ?? "—"})`
        : `Customer: ${order.recipientName} (${order.mobileMasked ?? "—"})`
      : null,
    tracking ? (bangla ? `ট্র্যাকিং: ${tracking}` : `Tracking: ${tracking}`) : null,
  ]
    .filter(Boolean)
    .join(" ");
  return `${head}${detail ? `\n${detail}` : ""}`;
}

function deliveryAnswer(data: Record<string, unknown>, bangla: boolean): string {
  const zones = Array.isArray(data.zones) ? data.zones : [];
  if (zones.length === 0) {
    return bangla
      ? "এই জেলার ডেলিভারি জোন পাওয়া যায়নি। দোকান থেকে নিশ্চিত করে নিন।"
      : "No delivery zone matched that district. Please confirm with the shop.";
  }
  const lines = zones.slice(0, 5).map((raw) => {
    const zone = raw as {
      name?: string;
      charge?: string;
      effectiveCharge?: string;
      estimatedDaysMin?: number;
      estimatedDaysMax?: number;
      freeShippingThreshold?: string | null;
      isFree?: boolean;
    };
    const charge = zone.isFree ? "৳0.00 (free)" : `৳${formatMoney(zone.effectiveCharge ?? zone.charge)}`;
    return `• ${zone.name} — ${charge} · ${zone.estimatedDaysMin ?? 1}–${
      zone.estimatedDaysMax ?? 3
    } ${bangla ? "দিন" : "days"}${
      zone.freeShippingThreshold
        ? ` · ${bangla ? "ফ্রি" : "free"} ≥ ৳${formatMoney(zone.freeShippingThreshold)}`
        : ""
    }`;
  });
  return `${bangla ? "ডেলিভারি চার্জ" : "Delivery charges"}:\n${lines.join("\n")}`;
}

function draftAnswer(data: Record<string, unknown>, bangla: boolean): string {
  const draft = data.draft as
    | {
        orderNumber?: string;
        grandTotal?: string;
        itemCount?: number;
        url?: string;
      }
    | undefined;
  if (!draft) {
    return bangla ? "ড্রাফট তৈরি করা যায়নি।" : "The draft could not be created.";
  }
  return bangla
    ? `ড্রাফট অর্ডার ${draft.orderNumber} তৈরি হয়েছে — ${draft.itemCount ?? 0}টি লাইন, মোট ৳${formatMoney(
        draft.grandTotal,
      )}। এটি শুধু ড্রাফট: স্টক আটকায়নি, টাকা পোস্ট হয়নি। পর্যালোচনা করে বিক্রয়ে রূপান্তর করুন।`
    : `Draft order ${draft.orderNumber} created — ${draft.itemCount ?? 0} line(s), total ৳${formatMoney(
        draft.grandTotal,
      )}. It is a draft only: no stock is reserved and no money is posted. Review it and convert it to a sale.`;
}

function toolAnswer(content: string, name: string, bangla: boolean): string {
  let parsed: { ok?: boolean; data?: Record<string, unknown>; error?: string };
  try {
    parsed = JSON.parse(content) as typeof parsed;
  } catch {
    return bangla ? "টুলের ফল পড়া যায়নি।" : "The tool result could not be read.";
  }
  if (parsed.ok === false || parsed.error) {
    return bangla
      ? `দুঃখিত, এটি করা যায়নি: ${parsed.error ?? "অজানা কারণ"}। প্রয়োজনে দোকানের একজন সহকর্মী সাহায্য করবেন।`
      : `Sorry, that could not be done: ${parsed.error ?? "unknown reason"}. A member of staff can help.`;
  }
  const data = parsed.data ?? {};
  if (name === "search_products") return productAnswer(data, bangla);
  if (name === "get_order_status") return orderAnswer(data, bangla);
  if (name === "quote_delivery") return deliveryAnswer(data, bangla);
  if (name === "create_draft_order") return draftAnswer(data, bangla);
  return bangla ? "কাজটি সম্পন্ন হয়েছে।" : "Done.";
}

function help(bangla: boolean): string {
  return bangla
    ? "আমি পণ্যের দাম ও স্টক, ডেলিভারি চার্জ এবং অর্ডারের অবস্থা জানাতে পারি। ড্রাফট অর্ডারও তৈরি করতে পারি—কিন্তু কোনো টাকা, স্টক বা হিসাব বদলাতে পারি না।\n\nউদাহরণ: `draft name=Rahim mobile=01712345678 items=SKU-1 x2 zone=Dhaka`"
    : "I can look up product prices and stock, delivery charges and order status. I can create a draft order, but I cannot move money, stock or the books.\n\nExample: `draft name=Rahim mobile=01712345678 items=SKU-1 x2 zone=Dhaka`";
}

export const localAiAdapter: AiAdapter = {
  provider: "local",
  model: "bgd26-rules-v1",
  live: false,

  async chat(input: AiChatInput): Promise<AiTurn> {
    const messages = input.messages;
    const last = messages[messages.length - 1];

    // Second pass: the runner has executed the tool and appended the result.
    if (last?.role === "tool") {
      let assistantIndex = -1;
      for (let index = messages.length - 2; index >= 0; index -= 1) {
        const candidate = messages[index];
        if (candidate?.role === "assistant" && candidate.toolCalls?.length) {
          assistantIndex = index;
          break;
        }
      }
      const userText = lastUserText(messages);
      const bangla = isBangla(userText);
      const results = messages
        .slice(assistantIndex + 1)
        .filter((message): message is Extract<AiModelMessage, { role: "tool" }> => {
          return message.role === "tool";
        });
      const answers = results.map((result) => toolAnswer(result.content, result.name, bangla));
      return {
        content: answers.join("\n\n") || help(bangla),
        toolCalls: [],
      };
    }

    const text = lastUserText(messages);
    const bangla = isBangla(text);
    if (!text) return { content: help(bangla), toolCalls: [] };

    const orderNumber = text.match(ORDER_NUMBER)?.[0];
    if (orderNumber) {
      return {
        content: "",
        toolCalls: [
          {
            id: `local-${Date.now()}`,
            name: "get_order_status",
            arguments: { orderNumber },
          },
        ],
      };
    }

    if (DRAFT_WORDS.test(text)) {
      const args = parseDraft(text);
      if (!args) {
        return {
          content: bangla
            ? "ড্রাফটের জন্য নাম, মোবাইল, পণ্যের SKU ও পরিমাণ দরকার। উদাহরণ: `draft name=Rahim mobile=01712345678 items=SKU-1 x2 zone=Dhaka`"
            : "A draft needs a name, mobile, item SKUs and quantities. Example: `draft name=Rahim mobile=01712345678 items=SKU-1 x2 zone=Dhaka`",
          toolCalls: [],
        };
      }
      return {
        content: "",
        toolCalls: [
          {
            id: `local-${Date.now()}`,
            name: "create_draft_order",
            arguments: args,
          },
        ],
      };
    }

    if (DELIVERY_WORDS.test(text)) {
      return {
        content: "",
        toolCalls: [
          {
            id: `local-${Date.now()}`,
            name: "quote_delivery",
            arguments: { query: text },
          },
        ],
      };
    }

    const query = queryTerms(text);
    if (!query) return { content: help(bangla), toolCalls: [] };

    return {
      content: "",
      toolCalls: [
        {
          id: `local-${Date.now()}`,
          name: "search_products",
          arguments: { query, limit: 5 },
        },
      ],
    };
  },
};
