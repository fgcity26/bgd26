import { cloudTimeoutMs, whatsappSettings } from "./config";
import { verifyHmacSha256 } from "./signature";
import {
  WhatsAppError,
  type SendResult,
  type TemplateSendInput,
  type TextSendInput,
  type WhatsAppAdapter,
} from "./types";

/**
 * Meta WhatsApp Business Cloud API adapter.
 *
 * Every call is a single HTTPS request to the Graph API. No SDK, no unofficial
 * library. Failures are classified so the queue knows whether to retry: 429 and
 * 5xx are transient; a bad number, an unapproved template or a revoked token is
 * not and should stop wasting attempts.
 */
export const cloudWhatsappAdapter: WhatsAppAdapter = {
  provider: "cloud",
  live: true,

  async sendTemplate(input: TemplateSendInput): Promise<SendResult> {
    return send({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: graphNumber(input.to),
      type: "template",
      template: {
        name: input.templateName,
        language: { code: input.language },
        components: templateComponents(input),
      },
    });
  },

  async sendText(input: TextSendInput): Promise<SendResult> {
    if (!input.body.trim()) {
      throw new WhatsAppError("A WhatsApp text cannot be empty.", {
        code: "EMPTY_MESSAGE",
      });
    }
    return send({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: graphNumber(input.to),
      type: "text",
      text: { preview_url: false, body: input.body.slice(0, 4096) },
    });
  },

  verifySignature(input: { rawBody: string; signatureHeader: string | null }): boolean {
    const secret = process.env.WHATSAPP_APP_SECRET?.trim() || "";
    if (!secret) return false;
    return verifyHmacSha256(input.rawBody, input.signatureHeader, secret);
  },
};

type GraphBody = Record<string, unknown>;

async function send(body: GraphBody): Promise<SendResult> {
  const settings = whatsappSettings();
  if (!settings.live) {
    throw new WhatsAppError(
      "The Cloud API is not configured. Add the phone number id, access token, app secret and verify token.",
      { code: "NOT_CONFIGURED" },
    );
  }

  const url = `https://graph.facebook.com/${settings.graphVersion}/${settings.phoneNumberId}/messages`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN?.trim() ?? ""}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(cloudTimeoutMs()),
    });
  } catch (error) {
    const aborted = error instanceof Error && error.name === "TimeoutError";
    throw new WhatsAppError(
      aborted
        ? "Meta did not answer in time."
        : "Could not reach the WhatsApp Cloud API.",
      {
        code: aborted ? "TIMEOUT" : "NETWORK",
        retryable: true,
        detail: error instanceof Error ? error.message : String(error),
      },
    );
  }

  const payload = (await response.json().catch(() => null)) as
    | {
        messages?: Array<{ id?: string }>;
        error?: {
          message?: string;
          code?: number;
          error_subcode?: number;
          type?: string;
          fbtrace_id?: string;
        };
      }
    | null;

  if (!response.ok) {
    const detail = payload?.error?.message ?? response.statusText;
    const code = payload?.error?.code
      ? `META_${payload.error.code}`
      : `HTTP_${response.status}`;
    throw new WhatsAppError(
      `WhatsApp rejected the message: ${detail}`,
      {
        code,
        httpStatus: response.status,
        retryable: response.status === 429 || response.status >= 500,
        detail: payload?.error?.fbtrace_id
          ? `trace ${payload.error.fbtrace_id}`
          : null,
      },
    );
  }

  const id = payload?.messages?.[0]?.id;
  if (!id) {
    throw new WhatsAppError("WhatsApp accepted the request but returned no message id.", {
      code: "NO_MESSAGE_ID",
      retryable: true,
    });
  }
  return { waMessageId: id };
}

function templateComponents(
  input: TemplateSendInput,
): Array<Record<string, unknown>> | undefined {
  const components: Array<Record<string, unknown>> = [];
  if (input.variables.length > 0) {
    components.push({
      type: "body",
      parameters: input.variables.map((text) => ({
        type: "text",
        text: text.slice(0, 1024),
      })),
    });
  }
  // Authentication templates with a "Copy code" button expect the code again
  // in a coupon_code parameter. Reusing {{1}} keeps the two in lockstep.
  if (input.copyCodeButton && input.variables[0]) {
    components.push({
      type: "button",
      sub_type: "copy_code",
      index: "0",
      parameters: [{ type: "coupon_code", coupon_code: input.variables[0].slice(0, 15) }],
    });
  }
  return components.length > 0 ? components : undefined;
}

/** Meta expects a bare international number, without the leading plus. */
function graphNumber(to: string): string {
  return to.replace(/^\+/, "").replace(/[^\d]/g, "");
}
