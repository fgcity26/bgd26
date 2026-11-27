import { createHash } from "node:crypto";
import { verifyHmacSha256 } from "./signature";
import type {
  SendResult,
  TemplateSendInput,
  TextSendInput,
  WhatsAppAdapter,
} from "./types";

/**
 * Offline WhatsApp simulator.
 *
 * It stores nothing itself — the notification service already persists every
 * message — and returns a deterministic id derived from the idempotency key so
 * a repeated call is visible as a duplicate instead of silently succeeding
 * twice. Signatures are checked with the same HMAC code the live adapter uses,
 * so webhook tests exercise the real path.
 */
export const localWhatsappAdapter: WhatsAppAdapter = {
  provider: "local",
  live: false,

  async sendTemplate(input: TemplateSendInput): Promise<SendResult> {
    return { waMessageId: localId("tpl", input.idempotencyKey) };
  },

  async sendText(input: TextSendInput): Promise<SendResult> {
    return { waMessageId: localId("txt", input.idempotencyKey) };
  },

  verifySignature(input: { rawBody: string; signatureHeader: string | null }): boolean {
    const secret =
      process.env.WHATSAPP_APP_SECRET?.trim() ||
      process.env.WHATSAPP_VERIFY_TOKEN?.trim() ||
      "";
    if (secret) {
      return verifyHmacSha256(input.rawBody, input.signatureHeader, secret);
    }
    // With no secret configured, a signature of "local" is accepted only
    // outside production. A deployed site must never take unsigned webhooks.
    return (
      process.env.NODE_ENV !== "production" &&
      input.signatureHeader?.trim().toLowerCase() === "local"
    );
  },
};

function localId(kind: string, idempotencyKey: string): string {
  const digest = createHash("sha256")
    .update(`${kind}:${idempotencyKey}`)
    .digest("hex")
    .slice(0, 24);
  return `local_${digest}`;
}
