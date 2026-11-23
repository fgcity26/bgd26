"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { audit } from "@/lib/auth/audit";
import { requestMeta } from "@/lib/auth/request-meta";
import { requirePermission } from "@/lib/auth/session";
import { runAssistant } from "@/lib/ai/service";
import {
  convertAiDraft,
  runTool,
  type AiDraftPaymentMethod,
} from "@/lib/ai/tools";
import type { AssistantReply } from "@/lib/adapters/ai/types";
import { writeActionLog } from "@/lib/ai/audit";

/**
 * Assistant actions.
 *
 * The chat action never trusts the browser's history beyond text: the server
 * re-builds the conversation for the actor, re-checks `ai.read` and runs only
 * allow-listed tools. Draft and conversion actions re-check `ai.write` (and
 * `order.write` for a sale) independently of whether the button was rendered.
 */

const askSchema = z.object({
  conversationKey: z.string().trim().min(8).max(80),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().trim().min(1).max(2_000),
      }),
    )
    .min(1)
    .max(20),
});

export async function askAssistantAction(input: {
  conversationKey: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
}): Promise<AssistantReply> {
  const session = await requirePermission("ai.read");
  const parsed = askSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      reply: "The message was too long or malformed. Please shorten it and try again.",
      tools: [],
      handover: false,
      error: "Invalid request",
    };
  }

  return runAssistant({
    actorUserId: session.user.id,
    conversationKey: parsed.data.conversationKey,
    messages: parsed.data.messages,
    permissions: session.permissions,
  });
}

export type DraftFormState = {
  error?: string;
  success?: string;
  draft?: { id: string; orderNumber: string; grandTotal: string };
};

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function parseItemLines(raw: string): Array<{ sku: string; quantity: number }> {
  const items: Array<{ sku: string; quantity: number }> = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/^(.+?)\s*(?:[x×*]|,|:)\s*(\d{1,3}(?:\.\d{1,3})?)$/i);
    if (!match) {
      throw new Error(
        `Could not read "${trimmed}". Use one line per item: SKU x 2.`,
      );
    }
    const quantity = Number(match[2]);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error(`The quantity for ${match[1]} must be greater than zero.`);
    }
    items.push({ sku: match[1].trim(), quantity });
  }
  if (items.length === 0) throw new Error("Add at least one item: SKU x 2.");
  if (items.length > 20) throw new Error("A draft can have at most 20 item lines.");
  return items;
}

export async function createDraftOrderAction(
  _previous: DraftFormState,
  formData: FormData,
): Promise<DraftFormState> {
  const session = await requirePermission("ai.write");

  let items: Array<{ sku: string; quantity: number }>;
  try {
    items = parseItemLines(text(formData, "items"));
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Check the item lines." };
  }

  const input = {
    customerName: text(formData, "customerName"),
    customerMobile: text(formData, "customerMobile"),
    items,
    deliveryZoneId: text(formData, "deliveryZoneId") || undefined,
    address: text(formData, "address") || undefined,
    note: text(formData, "note") || undefined,
  };

  const result = await runTool("create_draft_order", input, {
    actorUserId: session.user.id,
    permissions: session.permissions,
  });

  if (!result.ok) {
    return { error: result.error ?? "The draft could not be created." };
  }

  const draft = (result.data as { draft?: DraftFormState["draft"] } | undefined)?.draft;
  if (!draft) return { error: "The draft was created but its number was not returned." };

  await audit({
    actorUserId: session.user.id,
    action: "ai.draft_order.created",
    entityType: "order",
    entityId: draft.id,
    metadata: { orderNumber: draft.orderNumber, manualForm: true },
    ...(await requestMeta()),
  });
  revalidatePath("/assistant");
  revalidatePath("/orders");

  return {
    success: `Draft ${draft.orderNumber} created. No stock reserved; review it before converting.`,
    draft,
  };
}

const convertSchema = z.object({
  draftOrderId: z.string().trim().min(1),
  paymentMethod: z.enum(["COD", "BKASH", "NAGAD"]),
  reference: z.string().trim().max(120).optional(),
});

export async function convertAiDraftAction(formData: FormData): Promise<void> {
  const session = await requirePermission("ai.write");
  await requirePermission("order.write");

  const parsed = convertSchema.safeParse({
    draftOrderId: text(formData, "draftOrderId"),
    paymentMethod: text(formData, "paymentMethod"),
    reference: text(formData, "reference") || undefined,
  });
  const draftOrderId = text(formData, "draftOrderId");
  if (!parsed.success) {
    redirect(
      `/orders/${draftOrderId}?error=${encodeURIComponent(
        parsed.error.issues[0]?.message ?? "Choose a payment method.",
      )}`,
    );
  }

  try {
    const result = await convertAiDraft({
      draftOrderId: parsed.data.draftOrderId,
      paymentMethod: parsed.data.paymentMethod as AiDraftPaymentMethod,
      reference: parsed.data.reference ?? null,
      actorUserId: session.user.id,
    });

    await writeActionLog({
      toolName: "convert_draft_order",
      input: {
        draftOrderId: result.draftOrderNumber,
        paymentMethod: parsed.data.paymentMethod,
      },
      output: { orderNumber: result.orderNumber },
      status: "SUCCESS",
      riskLevel: "DRAFT",
      relatedOrderId: result.orderId,
      actorUserId: session.user.id,
    });
    await audit({
      actorUserId: session.user.id,
      action: "ai.draft_order.converted",
      entityType: "order",
      entityId: result.orderId,
      metadata: {
        draftOrderNumber: result.draftOrderNumber,
        orderNumber: result.orderNumber,
        paymentMethod: parsed.data.paymentMethod,
      },
      ...(await requestMeta()),
    });

    revalidatePath("/assistant");
    revalidatePath("/orders");
    revalidatePath(`/orders/${parsed.data.draftOrderId}`);
    redirect(`/orders/${result.orderId}?ok=1`);
  } catch (error) {
    redirect(
      `/orders/${parsed.data.draftOrderId}?error=${encodeURIComponent(
        error instanceof Error ? error.message : "The draft could not be converted.",
      )}`,
    );
  }
}
