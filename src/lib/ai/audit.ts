import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";

/**
 * AI audit helpers.
 *
 * Every tool call is written to `ai_action_logs`, including blocked and failed
 * calls. Phone numbers are masked before anything is stored, because the audit
 * trail is readable by staff who do not need a customer's full number. The raw
 * prompt is never stored: the conversation row keeps only counters.
 */

const MOBILE_PATTERN = /(?:\+?88)?01[3-9]\d{8}/g;

export function maskMobile(value: string): string {
  return value.replace(MOBILE_PATTERN, (match) => {
    if (match.length < 7) return "***";
    return `${match.slice(0, 5)}${"*".repeat(Math.max(0, match.length - 7))}${match.slice(-2)}`;
  });
}

function redact(value: unknown, depth = 0): unknown {
  if (depth > 5) return "[deep]";
  if (typeof value === "string") {
    const masked = maskMobile(value);
    return masked.length > 2_000 ? `${masked.slice(0, 2_000)}…` : masked;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((entry) => redact(entry, depth + 1));
  }
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(source).slice(0, 40)) {
      if (/password|secret|token|authorization/i.test(key)) {
        result[key] = "[redacted]";
      } else {
        result[key] = redact(entry, depth + 1);
      }
    }
    return result;
  }
  return value;
}

export function redactForLog(value: unknown): Prisma.InputJsonValue {
  return redact(value) as Prisma.InputJsonValue;
}

export async function writeActionLog(
  input: {
    conversationLogId?: string | null;
    toolName: string;
    input: unknown;
    output?: unknown;
    status: "SUCCESS" | "ERROR" | "BLOCKED";
    riskLevel: "READ" | "DRAFT";
    relatedOrderId?: string | null;
    actorUserId?: string | null;
    durationMs?: number | null;
    errorMessage?: string | null;
  },
  tx: Prisma.TransactionClient = prisma,
): Promise<void> {
  await tx.aiActionLog.create({
    data: {
      conversationLogId: input.conversationLogId ?? null,
      toolName: input.toolName,
      input: redactForLog(input.input),
      output: input.output === undefined ? undefined : redactForLog(input.output),
      status: input.status,
      riskLevel: input.riskLevel,
      relatedOrderId: input.relatedOrderId ?? null,
      actorUserId: input.actorUserId ?? null,
      durationMs: input.durationMs ?? null,
      errorMessage: input.errorMessage ? maskMobile(input.errorMessage).slice(0, 1_000) : null,
    },
  });
}
