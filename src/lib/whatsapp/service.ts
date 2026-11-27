import { Prisma, type WaNotificationEvent } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { tryNormalizeBdMobile } from "@/lib/crm/phone";
import { maskMobile } from "@/lib/ai/audit";
import {
  getWhatsAppAdapter,
  retryDelaySeconds,
  retryPolicy,
  whatsappSettings,
  WhatsAppError,
  type WhatsAppAdapter,
} from "@/lib/adapters/whatsapp";
import {
  buildVariables,
  EVENT_SETTING,
  renderTemplate,
  type AutomaticEvent,
} from "./templates";

/**
 * WhatsApp notifications, consent and delivery receipts.
 *
 * Two rules shape this file:
 *
 * 1. A notification is never allowed to break a sale, a shipment or a refund.
 *    Callers enqueue *after* the business transaction commits, and a send
 *    failure stays in the durable queue instead of bubbling up.
 * 2. Nothing is sent without consent and a stored template. A skipped row is
 *    written so the console can explain the silence rather than hide it.
 */

type SettingRow = {
  autoSend: boolean;
  orderConfirmation: boolean;
  orderShipped: boolean;
  refundCompleted: boolean;
  paymentReminder: boolean;
  reviewRequest: boolean;
};

const DEFAULT_SETTINGS: SettingRow = {
  autoSend: true,
  orderConfirmation: true,
  orderShipped: true,
  refundCompleted: true,
  paymentReminder: false,
  reviewRequest: false,
};

export type QueueResult = {
  messageId: string | null;
  status: "QUEUED" | "SKIPPED" | "DUPLICATE";
  reason?: string;
};

export async function getSetting(): Promise<SettingRow> {
  const row = await prisma.whatsappSetting.findUnique({ where: { id: "default" } });
  if (!row) return DEFAULT_SETTINGS;
  return {
    autoSend: row.autoSend,
    orderConfirmation: row.orderConfirmation,
    orderShipped: row.orderShipped,
    refundCompleted: row.refundCompleted,
    paymentReminder: row.paymentReminder,
    reviewRequest: row.reviewRequest,
  };
}

export async function saveSetting(
  input: Partial<SettingRow>,
  actorUserId: string,
): Promise<void> {
  await prisma.whatsappSetting.upsert({
    where: { id: "default" },
    update: { ...input, updatedByUserId: actorUserId },
    create: { id: "default", ...input, updatedByUserId: actorUserId },
  });
}

/**
 * Queue the notification for one order event and, when auto-send is on, try to
 * deliver it immediately. Delivery failure is recorded on the row and retried
 * by the worker.
 */
export async function queueOrderNotification(input: {
  event: AutomaticEvent;
  orderId: string;
  actorUserId?: string | null;
}): Promise<QueueResult> {
  const order = await prisma.order.findUnique({
    where: { id: input.orderId },
    select: {
      id: true,
      orderNumber: true,
      grandTotal: true,
      dueAmount: true,
      customerId: true,
      customer: {
        select: { id: true, fullName: true, mobileNormalized: true },
      },
      shipments: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          trackingNumber: true,
          courier: { select: { name: true } },
        },
      },
    },
  });
  if (!order) throw new WhatsAppError("That order no longer exists.", { code: "NO_ORDER" });

  const settings = await getSetting();
  const enabled = settings[EVENT_SETTING[input.event]];
  if (!enabled) {
    return writeSkipped(input.event, order.id, null, order.customer, "This notification is turned off.");
  }

  const consent = await prisma.whatsappConsent.findUnique({
    where: {
      customerId_phoneNumberNormalized: {
        customerId: order.customerId,
        phoneNumberNormalized: order.customer.mobileNormalized,
      },
    },
    select: { status: true },
  });
  if (!consent || consent.status !== "OPTED_IN") {
    return writeSkipped(
      input.event,
      order.id,
      null,
      order.customer,
      consent
        ? "The customer opted out of WhatsApp messages."
        : "No WhatsApp consent on file for this customer.",
    );
  }

  const live = whatsappSettings().live;
  const template = await pickTemplate(input.event, live);
  if (!template) {
    return writeSkipped(
      input.event,
      order.id,
      null,
      order.customer,
      live
        ? "No APPROVED template for this event. Register Meta's approved wording first."
        : "No template is registered for this event.",
    );
  }

  const variables = buildVariables(input.event, {
    customerName: order.customer.fullName,
    orderNumber: order.orderNumber,
    total: order.grandTotal.toFixed(2),
    dueAmount: order.dueAmount.toFixed(2),
    courier: order.shipments[0]?.courier?.name ?? null,
    trackingNumber: order.shipments[0]?.trackingNumber ?? null,
  });

  const message = await createMessage({
    customer: order.customer,
    event: input.event,
    dedupeKey: `${input.event}:${order.id}`,
    relatedOrderId: order.id,
    template,
    variables,
  });
  if (message.status === "QUEUED" && message.messageId) {
    await tryAutoSend(message.messageId, settings);
  }
  return message;
}

export async function queueRefundNotification(input: {
  refundId: string;
  actorUserId?: string | null;
}): Promise<QueueResult> {
  const refund = await prisma.refund.findUnique({
    where: { id: input.refundId },
    select: {
      id: true,
      refundNumber: true,
      totalAmount: true,
      method: true,
      customerId: true,
      order: { select: { id: true, orderNumber: true } },
      customer: { select: { id: true, fullName: true, mobileNormalized: true } },
    },
  });
  if (!refund) {
    throw new WhatsAppError("That refund no longer exists.", { code: "NO_REFUND" });
  }

  const settings = await getSetting();
  if (!settings.refundCompleted) {
    return writeSkipped(
      "REFUND_COMPLETED",
      refund.order.id,
      refund.id,
      refund.customer,
      "This notification is turned off.",
    );
  }

  const consent = await prisma.whatsappConsent.findUnique({
    where: {
      customerId_phoneNumberNormalized: {
        customerId: refund.customerId,
        phoneNumberNormalized: refund.customer.mobileNormalized,
      },
    },
    select: { status: true },
  });
  if (!consent || consent.status !== "OPTED_IN") {
    return writeSkipped(
      "REFUND_COMPLETED",
      refund.order.id,
      refund.id,
      refund.customer,
      consent
        ? "The customer opted out of WhatsApp messages."
        : "No WhatsApp consent on file for this customer.",
    );
  }

  const live = whatsappSettings().live;
  const template = await pickTemplate("REFUND_COMPLETED", live);
  if (!template) {
    return writeSkipped(
      "REFUND_COMPLETED",
      refund.order.id,
      refund.id,
      refund.customer,
      live
        ? "No APPROVED template for this event. Register Meta's approved wording first."
        : "No template is registered for this event.",
    );
  }

  const variables = buildVariables("REFUND_COMPLETED", {
    customerName: refund.customer.fullName,
    orderNumber: refund.order.orderNumber,
    amount: refund.totalAmount.toFixed(2),
    method: refund.method.replaceAll("_", " "),
  });

  const message = await createMessage({
    customer: refund.customer,
    event: "REFUND_COMPLETED",
    dedupeKey: `REFUND_COMPLETED:${refund.id}`,
    relatedOrderId: refund.order.id,
    relatedRefundId: refund.id,
    template,
    variables,
  });
  if (message.status === "QUEUED" && message.messageId) {
    await tryAutoSend(message.messageId, settings);
  }
  return message;
}

/* -------------------------------------------------------------------------- */
/* Queue write                                                                */
/* -------------------------------------------------------------------------- */

type TemplateRow = {
  id: string;
  name: string;
  language: string;
  bodyText: string;
  headerText: string | null;
  footerText: string | null;
};

type CustomerRow = { id: string; fullName: string; mobileNormalized: string };

async function pickTemplate(
  event: AutomaticEvent,
  live: boolean,
): Promise<TemplateRow | null> {
  const rows = await prisma.whatsappTemplate.findMany({
    where: { event, ...(live ? { status: "APPROVED" } : {}) },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    select: {
      id: true,
      name: true,
      language: true,
      bodyText: true,
      headerText: true,
      footerText: true,
    },
  });
  return rows.find((row) => row.language === "bn") ?? rows[0] ?? null;
}

async function conversationFor(customer: CustomerRow) {
  return prisma.whatsappConversation.upsert({
    where: { waConversationId: `wa:${customer.mobileNormalized}` },
    update: {
      customerId: customer.id,
      customerName: customer.fullName,
    },
    create: {
      waConversationId: `wa:${customer.mobileNormalized}`,
      phoneNumberNormalized: customer.mobileNormalized,
      customerId: customer.id,
      customerName: customer.fullName,
      status: "OPEN",
    },
    select: { id: true },
  });
}

async function createMessage(input: {
  customer: CustomerRow;
  event: AutomaticEvent;
  dedupeKey: string;
  relatedOrderId: string;
  relatedRefundId?: string;
  template: TemplateRow;
  variables: string[];
}): Promise<QueueResult> {
  const conversation = await conversationFor(input.customer);

  try {
    const row = await prisma.whatsappMessage.create({
      data: {
        conversationId: conversation.id,
        direction: "OUTBOUND",
        messageType: "TEMPLATE",
        body: renderTemplate(input.template.bodyText, input.variables),
        status: "QUEUED",
        recipient: input.customer.mobileNormalized,
        event: input.event,
        templateId: input.template.id,
        templateName: input.template.name,
        templateLanguage: input.template.language,
        templateVariables: input.variables,
        dedupeKey: input.dedupeKey,
        relatedOrderId: input.relatedOrderId,
        relatedRefundId: input.relatedRefundId ?? null,
        nextAttemptAt: new Date(),
        maxAttempts: retryPolicy().maxAttempts,
      },
      select: { id: true, status: true },
    });
    return { messageId: row.id, status: "QUEUED" };
  } catch (error) {
    if (isUniqueViolation(error)) {
      const existing = await prisma.whatsappMessage.findUnique({
        where: { dedupeKey: input.dedupeKey },
        select: { id: true },
      });
      return { messageId: existing?.id ?? null, status: "DUPLICATE" };
    }
    throw error;
  }
}

async function writeSkipped(
  event: WaNotificationEvent,
  orderId: string,
  refundId: string | null,
  customer: CustomerRow,
  reason: string,
): Promise<QueueResult> {
  const dedupeKey = `${event}:${refundId ?? orderId}:skipped`;
  const conversation = await conversationFor(customer);
  try {
    const row = await prisma.whatsappMessage.create({
      data: {
        conversationId: conversation.id,
        direction: "OUTBOUND",
        messageType: "TEMPLATE",
        status: "SKIPPED",
        recipient: customer.mobileNormalized,
        event,
        dedupeKey,
        relatedOrderId: orderId,
        relatedRefundId: refundId,
        errorCode: "SKIPPED",
        errorMessage: reason,
      },
      select: { id: true },
    });
    return { messageId: row.id, status: "SKIPPED", reason };
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { messageId: null, status: "DUPLICATE", reason };
    }
    throw error;
  }
}

/* -------------------------------------------------------------------------- */
/* Dispatch                                                                   */
/* -------------------------------------------------------------------------- */

export type DispatchResult = {
  messageId: string;
  status: "SENT" | "QUEUED" | "FAILED" | "SKIPPED";
  error?: string;
};

export type DispatchSummary = {
  attempted: number;
  sent: number;
  queued: number;
  failed: number;
  skipped: number;
};

const STALE_LOCK_MS = 5 * 60 * 1000;

async function tryAutoSend(messageId: string, settings: SettingRow): Promise<void> {
  if (!settings.autoSend || !whatsappSettings().enabled) return;
  try {
    await dispatchMessage(messageId);
  } catch (error) {
    // A send must never escape into the caller. The row is already durable.
    console.error("[whatsapp] auto-send failed", messageId, error);
  }
}

export async function dispatchMessage(
  messageId: string,
  adapter: WhatsAppAdapter = getWhatsAppAdapter(),
): Promise<DispatchResult> {
  // FEATURE_WHATSAPP=false means nothing leaves the server, including a row
  // already queued before the switch was flipped.
  if (!whatsappSettings().enabled) {
    return { messageId, status: "QUEUED", error: "WhatsApp is switched off." };
  }
  const message = await claimMessage(messageId);
  if (!message) return { messageId, status: "QUEUED", error: "Not ready to send." };
  return deliver(message, adapter);
}

export async function dispatchQueue(input?: {
  limit?: number;
  adapter?: WhatsAppAdapter;
}): Promise<DispatchSummary> {
  const limit = Math.min(Math.max(input?.limit ?? 20, 1), 100);
  const adapter = input?.adapter ?? getWhatsAppAdapter();
  const summary: DispatchSummary = {
    attempted: 0,
    sent: 0,
    queued: 0,
    failed: 0,
    skipped: 0,
  };
  if (!whatsappSettings().enabled) return summary;

  for (let index = 0; index < limit; index += 1) {
    const next = await claimNext();
    if (!next) break;
    summary.attempted += 1;
    const result = await deliver(next, adapter);
    if (result.status === "SENT") summary.sent += 1;
    else if (result.status === "FAILED") summary.failed += 1;
    else if (result.status === "SKIPPED") summary.skipped += 1;
    else summary.queued += 1;
  }
  return summary;
}

type ClaimedMessage = {
  id: string;
  direction: "INBOUND" | "OUTBOUND";
  messageType: string;
  body: string | null;
  recipient: string | null;
  status: string;
  event: WaNotificationEvent;
  templateName: string | null;
  templateLanguage: string | null;
  templateVariables: unknown;
  templateId: string | null;
  conversationId: string;
  attemptCount: number;
  maxAttempts: number;
  errorCode: string | null;
};

const CLAIM_SELECT = {
  id: true,
  direction: true,
  messageType: true,
  body: true,
  recipient: true,
  status: true,
  event: true,
  templateName: true,
  templateLanguage: true,
  templateVariables: true,
  templateId: true,
  conversationId: true,
  attemptCount: true,
  maxAttempts: true,
  errorCode: true,
} as const;

async function claimMessage(messageId: string): Promise<ClaimedMessage | null> {
  const now = new Date();
  const stale = new Date(now.getTime() - STALE_LOCK_MS);
  const current = await prisma.whatsappMessage.findUnique({
    where: { id: messageId },
    select: { ...CLAIM_SELECT, nextAttemptAt: true, lockedAt: true },
  });
  if (!current || current.status !== "QUEUED") return null;
  if (current.nextAttemptAt && current.nextAttemptAt.getTime() > now.getTime()) return null;
  if (current.lockedAt && current.lockedAt.getTime() > stale.getTime()) return null;

  if (current.attemptCount >= current.maxAttempts) {
    await markFailed(messageId, "Too many attempts.", "MAX_ATTEMPTS");
    return null;
  }

  const claimed = await prisma.whatsappMessage.updateMany({
    where: {
      id: messageId,
      status: "QUEUED",
      OR: [{ lockedAt: null }, { lockedAt: { lt: stale } }],
    },
    data: {
      lockedAt: now,
      lastAttemptAt: now,
      attemptCount: { increment: 1 },
    },
  });
  if (claimed.count === 0) return null;

  const row = await prisma.whatsappMessage.findUnique({
    where: { id: messageId },
    select: CLAIM_SELECT,
  });
  return (row as ClaimedMessage | null) ?? null;
}

async function claimNext(): Promise<ClaimedMessage | null> {
  const now = new Date();
  const stale = new Date(now.getTime() - STALE_LOCK_MS);
  const candidates = await prisma.whatsappMessage.findMany({
    where: {
      status: "QUEUED",
      OR: [{ lockedAt: null }, { lockedAt: { lt: stale } }],
      AND: [{ OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] }],
    },
    orderBy: [{ nextAttemptAt: "asc" }, { createdAt: "asc" }],
    take: 10,
    select: { id: true },
  });

  for (const candidate of candidates) {
    const claimed = await claimMessage(candidate.id);
    if (claimed) return claimed;
  }
  return null;
}

async function deliver(
  message: ClaimedMessage,
  adapter: WhatsAppAdapter,
): Promise<DispatchResult> {
  try {
    if (message.direction !== "OUTBOUND") {
      throw new WhatsAppError("Only outbound messages can be sent.", {
        code: "NOT_OUTBOUND",
      });
    }

    let waMessageId: string;
    if (message.messageType === "TEMPLATE") {
      if (!message.templateName || !message.templateLanguage || !message.recipient) {
        throw new WhatsAppError("The queued template is missing its name or recipient.", {
          code: "INCOMPLETE_TEMPLATE",
        });
      }
      if (adapter.live && message.templateId) {
        const template = await prisma.whatsappTemplate.findUnique({
          where: { id: message.templateId },
          select: { status: true },
        });
        if (template?.status !== "APPROVED") {
          throw new WhatsAppError(
            "The template is not APPROVED in the registry, so the Cloud API cannot send it.",
            { code: "TEMPLATE_NOT_APPROVED" },
          );
        }
      }
      const variables = Array.isArray(message.templateVariables)
        ? message.templateVariables.map((entry) => String(entry))
        : [];
      const result = await adapter.sendTemplate({
        to: message.recipient,
        templateName: message.templateName,
        language: message.templateLanguage,
        variables,
        idempotencyKey: message.id,
      });
      waMessageId = result.waMessageId;
    } else if (message.messageType === "TEXT") {
      if (!message.recipient || !message.body?.trim()) {
        throw new WhatsAppError("The queued text is missing its recipient or body.", {
          code: "INCOMPLETE_TEXT",
        });
      }
      const result = await adapter.sendText({
        to: message.recipient,
        body: message.body,
        idempotencyKey: message.id,
      });
      waMessageId = result.waMessageId;
    } else {
      throw new WhatsAppError("This message type cannot be sent from the console.", {
        code: "UNSUPPORTED_TYPE",
      });
    }

    await prisma.whatsappMessage.update({
      where: { id: message.id },
      data: {
        status: "SENT",
        waMessageId,
        sentAt: new Date(),
        lockedAt: null,
        nextAttemptAt: null,
        errorCode: null,
        errorMessage: null,
      },
    });
    await prisma.whatsappConversation.update({
      where: { id: message.conversationId },
      data: { lastMessageAt: new Date() },
    });
    return { messageId: message.id, status: "SENT" };
  } catch (error) {
    const failure =
      error instanceof WhatsAppError
        ? error
        : new WhatsAppError(
            error instanceof Error ? error.message : "The message could not be sent.",
            { code: "UNKNOWN", retryable: true },
          );

    const retryable = failure.retryable;
    const exhausted = message.attemptCount >= message.maxAttempts;
    if (!retryable || exhausted) {
      await markFailed(
        message.id,
        failure.message,
        failure.code,
        exhausted && retryable ? "MAX_ATTEMPTS" : failure.code,
      );
      return { messageId: message.id, status: "FAILED", error: failure.message };
    }

    const policy = retryPolicy();
    const delay = retryDelaySeconds(message.attemptCount, policy.baseSeconds, policy.maxSeconds);
    await prisma.whatsappMessage.update({
      where: { id: message.id },
      data: {
        status: "QUEUED",
        lockedAt: null,
        nextAttemptAt: new Date(Date.now() + delay * 1000),
        errorCode: failure.code,
        errorMessage: failure.message.slice(0, 500),
      },
    });
    return { messageId: message.id, status: "QUEUED", error: failure.message };
  }
}

async function markFailed(
  id: string,
  message: string,
  code: string,
  finalCode?: string,
): Promise<void> {
  await prisma.whatsappMessage.update({
    where: { id },
    data: {
      status: "FAILED",
      lockedAt: null,
      nextAttemptAt: null,
      errorCode: (finalCode ?? code).slice(0, 40),
      errorMessage: message.slice(0, 500),
    },
  });
}

/** Put failed rows back in the queue, resetting the attempt budget. */
export async function retryFailedMessages(limit = 50): Promise<number> {
  const rows = await prisma.whatsappMessage.findMany({
    where: { status: "FAILED" },
    orderBy: { createdAt: "asc" },
    take: Math.min(Math.max(limit, 1), 200),
    select: { id: true },
  });
  if (rows.length === 0) return 0;
  await prisma.whatsappMessage.updateMany({
    where: { id: { in: rows.map((row) => row.id) } },
    data: {
      status: "QUEUED",
      attemptCount: 0,
      lockedAt: null,
      nextAttemptAt: new Date(),
      errorCode: null,
      errorMessage: null,
    },
  });
  return rows.length;
}

/* -------------------------------------------------------------------------- */
/* Inbox                                                                      */
/* -------------------------------------------------------------------------- */

/** The 24-hour customer-service window, refreshed by every inbound message. */
export function isWindowOpen(windowExpiresAt: Date | null, now = new Date()): boolean {
  return Boolean(windowExpiresAt && windowExpiresAt.getTime() > now.getTime());
}

export async function sendStaffReply(input: {
  conversationId: string;
  body: string;
  actorUserId: string;
}): Promise<DispatchResult> {
  const body = input.body.trim();
  if (!body) throw new WhatsAppError("Write a message first.", { code: "EMPTY_MESSAGE" });
  if (body.length > 4_096) {
    throw new WhatsAppError("A WhatsApp message can hold at most 4,096 characters.", {
      code: "TOO_LONG",
    });
  }

  const conversation = await prisma.whatsappConversation.findUnique({
    where: { id: input.conversationId },
    select: {
      id: true,
      phoneNumberNormalized: true,
      customerId: true,
      windowExpiresAt: true,
    },
  });
  if (!conversation) throw new WhatsAppError("That conversation no longer exists.", { code: "NO_CONVERSATION" });
  if (!isWindowOpen(conversation.windowExpiresAt)) {
    throw new WhatsAppError(
      "The 24-hour window has closed. Only an approved template can be sent now; record the template in the Templates tab.",
      { code: "WINDOW_CLOSED" },
    );
  }

  const message = await prisma.whatsappMessage.create({
    data: {
      conversationId: conversation.id,
      direction: "OUTBOUND",
      messageType: "TEXT",
      body,
      status: "QUEUED",
      recipient: conversation.phoneNumberNormalized,
      event: "MANUAL",
      nextAttemptAt: new Date(),
      maxAttempts: retryPolicy().maxAttempts,
      sentByUserId: input.actorUserId,
    },
    select: { id: true },
  });

  await prisma.whatsappConversation.update({
    where: { id: conversation.id },
    data: { status: "HANDOVER", lastMessageAt: new Date() },
  });

  return dispatchMessage(message.id);
}

export async function markConversationRead(conversationId: string): Promise<void> {
  await prisma.whatsappConversation.update({
    where: { id: conversationId },
    data: { unreadCount: 0 },
  });
}

export async function setConversationStatus(
  conversationId: string,
  status: "OPEN" | "PENDING" | "RESOLVED" | "HANDOVER" | "CLOSED",
): Promise<void> {
  await prisma.whatsappConversation.update({
    where: { id: conversationId },
    data: { status },
  });
}

export async function recordConsent(input: {
  mobile: string;
  status: "OPTED_IN" | "OPTED_OUT";
  source?: string | null;
}): Promise<{ customerId: string; phone: string }> {
  const phone = tryNormalizeBdMobile(input.mobile);
  if (!phone) {
    throw new WhatsAppError("Enter a valid Bangladeshi mobile number.", { code: "BAD_MOBILE" });
  }
  const customer = await prisma.customer.findUnique({
    where: { mobileNormalized: phone },
    select: { id: true },
  });
  if (!customer) {
    throw new WhatsAppError("No customer has that mobile number yet.", { code: "NO_CUSTOMER" });
  }

  const now = new Date();
  const source = (input.source?.trim() || "staff").slice(0, 60);
  await prisma.whatsappConsent.upsert({
    where: {
      customerId_phoneNumberNormalized: {
        customerId: customer.id,
        phoneNumberNormalized: phone,
      },
    },
    update: {
      status: input.status,
      source,
      optedInAt: input.status === "OPTED_IN" ? now : undefined,
      optedOutAt: input.status === "OPTED_OUT" ? now : undefined,
    },
    create: {
      customerId: customer.id,
      phoneNumberNormalized: phone,
      status: input.status,
      source,
      optedInAt: input.status === "OPTED_IN" ? now : null,
      optedOutAt: input.status === "OPTED_OUT" ? now : null,
    },
  });
  return { customerId: customer.id, phone };
}

/**
 * Record the transactional opt-in that comes with an online order. An explicit
 * opt-out always wins; this never flips an OPTED_OUT row back on.
 */
export async function recordOrderConsent(customerId: string, mobile: string, source: string) {
  try {
    await prisma.whatsappConsent.create({
      data: {
        customerId,
        phoneNumberNormalized: mobile,
        status: "OPTED_IN",
        source: source.slice(0, 60),
        optedInAt: new Date(),
      },
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
  }
}

/* -------------------------------------------------------------------------- */
/* Webhook                                                                    */
/* -------------------------------------------------------------------------- */

export type WebhookResult = {
  messages: number;
  statuses: number;
  duplicates: number;
  optOuts: number;
};

type WebhookPayload = {
  object?: string;
  entry?: Array<{
    id?: string;
    changes?: Array<{
      field?: string;
      value?: {
        metadata?: { phone_number_id?: string };
        contacts?: Array<{
          wa_id?: string;
          profile?: { name?: string };
        }>;
        messages?: InboundMessage[];
        statuses?: StatusUpdate[];
      };
    }>;
  }>;
};

type InboundMessage = {
  id?: string;
  from?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  button?: { text?: string };
  interactive?: { button_reply?: { title?: string } };
  image?: { id?: string; mime_type?: string };
  document?: { id?: string; filename?: string };
  audio?: { id?: string };
  video?: { id?: string };
  location?: { latitude?: number; longitude?: number };
};

type StatusUpdate = {
  id?: string;
  status?: string;
  timestamp?: string;
  recipient_id?: string;
  errors?: Array<{ code?: number; title?: string; message?: string }>;
};

const TYPE_MAP: Record<string, "TEXT" | "IMAGE" | "DOCUMENT" | "AUDIO" | "VIDEO" | "LOCATION" | "STICKER" | "INTERACTIVE" | "TEMPLATE"> = {
  text: "TEXT",
  image: "IMAGE",
  document: "DOCUMENT",
  audio: "AUDIO",
  video: "VIDEO",
  location: "LOCATION",
  sticker: "STICKER",
  interactive: "INTERACTIVE",
  button: "INTERACTIVE",
};

const OPT_OUT_WORDS = new Set(["STOP", "UNSUBSCRIBE", "বন্ধ", "বন্ধ করুন"]);
const OPT_IN_WORDS = new Set(["START", "YES", "UNSTOP", "শুরু", "চালু"]);

const STATUS_RANK: Record<string, number> = {
  QUEUED: 0,
  SENT: 1,
  DELIVERED: 2,
  READ: 3,
  SKIPPED: 0,
  RECEIVED: 0,
  FAILED: 0,
};

export async function handleWebhook(input: {
  rawBody: string;
  signatureHeader: string | null;
}): Promise<WebhookResult> {
  const settings = whatsappSettings();
  if (!settings.enabled) {
    throw new WebhookError("WhatsApp is disabled.", 503);
  }

  const adapter = getWhatsAppAdapter(settings);
  if (!adapter.verifySignature(input)) {
    throw new WebhookError("Invalid webhook signature.", 401);
  }

  let payload: WebhookPayload;
  try {
    payload = JSON.parse(input.rawBody) as WebhookPayload;
  } catch {
    throw new WebhookError("The webhook body is not JSON.", 400);
  }
  if (payload.object !== "whatsapp_business_account") {
    return { messages: 0, statuses: 0, duplicates: 0, optOuts: 0 };
  }

  const result: WebhookResult = { messages: 0, statuses: 0, duplicates: 0, optOuts: 0 };

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field && change.field !== "messages") continue;
      const value = change.value;
      if (!value) continue;
      if (
        settings.phoneNumberId &&
        value.metadata?.phone_number_id &&
        value.metadata.phone_number_id !== settings.phoneNumberId
      ) {
        continue;
      }

      for (const message of value.messages ?? []) {
        const handled = await storeInbound(message, value.contacts?.[0]?.profile?.name ?? null);
        if (handled === "duplicate") result.duplicates += 1;
        else if (handled === "optout") {
          result.messages += 1;
          result.optOuts += 1;
        } else if (handled === "stored") result.messages += 1;
      }

      for (const status of value.statuses ?? []) {
        if (await storeStatus(status)) result.statuses += 1;
      }
    }
  }

  return result;
}

async function storeInbound(
  message: InboundMessage,
  profileName: string | null,
): Promise<"stored" | "duplicate" | "ignored" | "optout"> {
  if (!message.id || !message.from) return "ignored";
  const phone = tryNormalizeBdMobile(message.from);
  if (!phone) return "ignored";

  const type = message.type ?? "text";
  const body =
    message.text?.body ??
    message.button?.text ??
    message.interactive?.button_reply?.title ??
    labelForType(type);
  const customer = await prisma.customer.findUnique({
    where: { mobileNormalized: phone },
    select: { id: true, fullName: true },
  });

  const conversation = await prisma.whatsappConversation.upsert({
    where: { waConversationId: `wa:${phone}` },
    update: {
      customerId: customer?.id ?? undefined,
      customerName: profileName ?? customer?.fullName ?? undefined,
      lastMessageAt: new Date(),
      lastInboundAt: new Date(),
      windowExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      unreadCount: { increment: 1 },
    },
    create: {
      waConversationId: `wa:${phone}`,
      phoneNumberNormalized: phone,
      customerId: customer?.id ?? null,
      customerName: profileName ?? customer?.fullName ?? null,
      status: "OPEN",
      lastMessageAt: new Date(),
      lastInboundAt: new Date(),
      windowExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      unreadCount: 1,
    },
    select: { id: true },
  });

  try {
    await prisma.whatsappMessage.create({
      data: {
        conversationId: conversation.id,
        waMessageId: message.id,
        direction: "INBOUND",
        messageType: TYPE_MAP[type] ?? "TEXT",
        body: body.slice(0, 4_096),
        recipient: phone,
        status: "RECEIVED",
        rawPayload: message as Prisma.InputJsonValue,
      },
    });
  } catch (error) {
    if (isUniqueViolation(error)) return "duplicate";
    throw error;
  }

  const keyword = (message.text?.body ?? "").trim().toUpperCase();
  if (customer && OPT_OUT_WORDS.has(keyword)) {
    await recordConsent({ mobile: phone, status: "OPTED_OUT", source: "whatsapp_keyword" });
    return "optout";
  }
  if (customer && OPT_IN_WORDS.has(keyword)) {
    await recordConsent({ mobile: phone, status: "OPTED_IN", source: "whatsapp_keyword" });
  }
  return "stored";
}

async function storeStatus(status: StatusUpdate): Promise<boolean> {
  if (!status.id || !status.status) return false;
  const next = status.status.toUpperCase();
  if (!(next in STATUS_RANK)) return false;

  const message = await prisma.whatsappMessage.findUnique({
    where: { waMessageId: status.id },
    select: { id: true, status: true },
  });
  if (!message) return false;

  if (next === "FAILED") {
    if (message.status === "READ") return false;
    await prisma.whatsappMessage.update({
      where: { id: message.id },
      data: {
        status: "FAILED",
        errorCode: status.errors?.[0]?.code ? `META_${status.errors[0].code}` : "DELIVERY_FAILED",
        errorMessage:
          status.errors?.[0]?.message ?? status.errors?.[0]?.title ?? "Meta reported a delivery failure.",
      },
    });
    return true;
  }

  if (STATUS_RANK[next] <= (STATUS_RANK[message.status] ?? 0)) return false;
  await prisma.whatsappMessage.update({
    where: { id: message.id },
    data: { status: next as "SENT" | "DELIVERED" | "READ" },
  });
  return true;
}

export class WebhookError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "WebhookError";
    this.status = status;
  }
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function labelForType(type: string): string {
  const labels: Record<string, string> = {
    image: "[photo]",
    document: "[document]",
    audio: "[voice note]",
    video: "[video]",
    sticker: "[sticker]",
    location: "[location]",
  };
  return labels[type] ?? `[${type}]`;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
  );
}

export function maskedRecipient(value: string | null): string {
  return value ? maskMobile(value) : "—";
}

