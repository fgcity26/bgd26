"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { audit } from "@/lib/auth/audit";
import { requestMeta } from "@/lib/auth/request-meta";
import { requirePermission } from "@/lib/auth/session";
import {
  dispatchQueue,
  markConversationRead,
  recordConsent,
  retryFailedMessages,
  saveSetting,
  sendStaffReply,
  setConversationStatus,
} from "@/lib/whatsapp/service";
import { prisma } from "@/lib/db";

/**
 * WhatsApp console actions.
 *
 * Every action re-checks `whatsapp.write` on the server, validates with Zod,
 * writes an audit row and redirects with a readable result. Sending is always
 * queued first; a provider failure is reported, never thrown at the browser.
 */

const checkbox = (formData: FormData, name: string) => formData.get(name) === "on";

const templateSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Give the template Meta's exact name.")
    .max(120)
    .regex(/^[a-z0-9_]+$/, "Template names use lowercase letters, numbers and underscores."),
  language: z.string().trim().min(2).max(10).default("bn"),
  category: z.enum(["MARKETING", "UTILITY", "AUTHENTICATION"]),
  status: z.enum(["PENDING", "APPROVED", "REJECTED", "PAUSED"]),
  event: z.enum([
    "ORDER_CONFIRMED",
    "ORDER_SHIPPED",
    "REFUND_COMPLETED",
    "PAYMENT_REMINDER",
    "REVIEW_REQUEST",
    "MANUAL",
  ]),
  bodyText: z.string().trim().min(1, "The template body is required.").max(4_000),
  headerText: z.string().trim().max(200).optional(),
  footerText: z.string().trim().max(200).optional(),
});

export async function saveWhatsappSettingsAction(formData: FormData): Promise<void> {
  const session = await requirePermission("whatsapp.write");
  try {
    await saveSetting(
      {
        autoSend: checkbox(formData, "autoSend"),
        orderConfirmation: checkbox(formData, "orderConfirmation"),
        orderShipped: checkbox(formData, "orderShipped"),
        refundCompleted: checkbox(formData, "refundCompleted"),
        paymentReminder: checkbox(formData, "paymentReminder"),
        reviewRequest: checkbox(formData, "reviewRequest"),
      },
      session.user.id,
    );
    const meta = await requestMeta();
    await audit({
      actorUserId: session.user.id,
      action: "whatsapp.settings.saved",
      entityType: "whatsapp",
      ...meta,
    });
  } catch (error) {
    redirect(`/whatsapp/queue?error=${encodeURIComponent(explain(error))}`);
  }
  revalidatePath("/whatsapp/queue");
  redirect("/whatsapp/queue?ok=Settings+saved");
}

export async function sendWhatsappReplyAction(formData: FormData): Promise<void> {
  const session = await requirePermission("whatsapp.write");
  const conversationId = String(formData.get("conversationId") ?? "").trim();
  const body = String(formData.get("body") ?? "");
  if (!conversationId) redirect("/whatsapp?error=Choose+a+conversation");

  try {
    const result = await sendStaffReply({
      conversationId,
      body,
      actorUserId: session.user.id,
    });
    const meta = await requestMeta();
    await audit({
      actorUserId: session.user.id,
      action: "whatsapp.message.sent",
      entityType: "whatsapp_conversation",
      entityId: conversationId,
      metadata: { messageId: result.messageId, status: result.status },
      ...meta,
    });
    revalidatePath("/whatsapp");
    redirect(
      `/whatsapp?c=${encodeURIComponent(conversationId)}&ok=${encodeURIComponent(
        result.status === "SENT" ? "Message sent" : "Queued for retry",
      )}`,
    );
  } catch (error) {
    revalidatePath("/whatsapp");
    redirect(
      `/whatsapp?c=${encodeURIComponent(conversationId)}&error=${encodeURIComponent(
        explain(error),
      )}`,
    );
  }
}

export async function dispatchWhatsappQueueAction(): Promise<void> {
  const session = await requirePermission("whatsapp.write");
  try {
    const summary = await dispatchQueue({ limit: 20 });
    const meta = await requestMeta();
    await audit({
      actorUserId: session.user.id,
      action: "whatsapp.queue.dispatched",
      entityType: "whatsapp",
      metadata: { ...summary },
      ...meta,
    });
    revalidatePath("/whatsapp");
    revalidatePath("/whatsapp/queue");
    redirect(
      `/whatsapp/queue?ok=${encodeURIComponent(
        `${summary.sent} sent, ${summary.queued} waiting, ${summary.failed} failed`,
      )}`,
    );
  } catch (error) {
    redirect(`/whatsapp/queue?error=${encodeURIComponent(explain(error))}`);
  }
}

export async function requeueWhatsappFailuresAction(): Promise<void> {
  const session = await requirePermission("whatsapp.write");
  try {
    const count = await retryFailedMessages(50);
    await dispatchQueue({ limit: 20 });
    const meta = await requestMeta();
    await audit({
      actorUserId: session.user.id,
      action: "whatsapp.queue.requeued",
      entityType: "whatsapp",
      metadata: { count },
      ...meta,
    });
    revalidatePath("/whatsapp/queue");
    redirect(`/whatsapp/queue?ok=${encodeURIComponent(`${count} failed message(s) requeued`)}`);
  } catch (error) {
    redirect(`/whatsapp/queue?error=${encodeURIComponent(explain(error))}`);
  }
}

export async function saveWhatsappTemplateAction(formData: FormData): Promise<void> {
  const session = await requirePermission("whatsapp.write");
  const parsed = templateSchema.safeParse({
    name: formData.get("name"),
    language: formData.get("language") || "bn",
    category: formData.get("category"),
    status: formData.get("status"),
    event: formData.get("event"),
    bodyText: formData.get("bodyText"),
    headerText: formData.get("headerText") || undefined,
    footerText: formData.get("footerText") || undefined,
  });
  if (!parsed.success) {
    redirect(
      `/whatsapp/templates?error=${encodeURIComponent(
        parsed.error.issues[0]?.message ?? "Check the template fields.",
      )}`,
    );
  }

  try {
    const data = parsed.data;
    await prisma.whatsappTemplate.upsert({
      where: { name_language: { name: data.name, language: data.language } },
      update: {
        category: data.category,
        status: data.status,
        event: data.event,
        bodyText: data.bodyText,
        headerText: data.headerText ?? null,
        footerText: data.footerText ?? null,
      },
      create: {
        name: data.name,
        language: data.language,
        category: data.category,
        status: data.status,
        event: data.event,
        bodyText: data.bodyText,
        headerText: data.headerText ?? null,
        footerText: data.footerText ?? null,
        variables: [],
      },
    });
    const meta = await requestMeta();
    await audit({
      actorUserId: session.user.id,
      action: "whatsapp.template.saved",
      entityType: "whatsapp_template",
      entityId: `${data.name}:${data.language}`,
      metadata: { status: data.status, event: data.event },
      ...meta,
    });
  } catch (error) {
    redirect(`/whatsapp/templates?error=${encodeURIComponent(explain(error))}`);
  }
  revalidatePath("/whatsapp/templates");
  redirect("/whatsapp/templates?ok=Template+saved");
}

export async function recordWhatsappConsentAction(formData: FormData): Promise<void> {
  const session = await requirePermission("whatsapp.write");
  const mobile = String(formData.get("mobile") ?? "");
  const status = formData.get("status") === "OPTED_OUT" ? "OPTED_OUT" : "OPTED_IN";
  const source = String(formData.get("source") ?? "staff");
  try {
    const result = await recordConsent({ mobile, status, source });
    const meta = await requestMeta();
    await audit({
      actorUserId: session.user.id,
      action: "whatsapp.consent.recorded",
      entityType: "customer",
      entityId: result.customerId,
      metadata: { status, source },
      ...meta,
    });
  } catch (error) {
    redirect(`/whatsapp/consents?error=${encodeURIComponent(explain(error))}`);
  }
  revalidatePath("/whatsapp/consents");
  redirect("/whatsapp/consents?ok=Consent+saved");
}

export async function markWhatsappReadAction(formData: FormData): Promise<void> {
  await requirePermission("whatsapp.read");
  const conversationId = String(formData.get("conversationId") ?? "").trim();
  if (conversationId) await markConversationRead(conversationId);
  revalidatePath("/whatsapp");
  redirect(`/whatsapp?c=${encodeURIComponent(conversationId)}`);
}

export async function resolveWhatsappConversationAction(formData: FormData): Promise<void> {
  await requirePermission("whatsapp.write");
  const conversationId = String(formData.get("conversationId") ?? "").trim();
  const status = formData.get("status") === "OPEN" ? "OPEN" : "RESOLVED";
  if (conversationId) await setConversationStatus(conversationId, status);
  revalidatePath("/whatsapp");
  redirect(`/whatsapp?c=${encodeURIComponent(conversationId)}&ok=Conversation+updated`);
}

function explain(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}
