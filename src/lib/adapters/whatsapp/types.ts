/**
 * WhatsApp adapter port.
 *
 * Only the official Meta WhatsApp Business Cloud API is implemented. The port
 * keeps the vendor out of the domain code: the notification service decides
 * *who* and *what*, the adapter only turns that into a Graph API call and
 * verifies webhook signatures. A local adapter simulates the same contract so
 * development and tests need no Meta account.
 */

export type WhatsAppProvider = "local" | "cloud";

export type TemplateSendInput = {
  /** E.164 with the leading plus, e.g. +8801XXXXXXXXX. */
  to: string;
  templateName: string;
  language: string;
  /** Positional body parameters, in order: {{1}}, {{2}}, ... */
  variables: string[];
  /**
   * Authentication templates may carry a "Copy code" button. Meta then wants
   * the code again in a button component; the first body variable is reused.
   */
  copyCodeButton?: boolean;
  /** Stable key for the local simulator and call-site deduplication. */
  idempotencyKey: string;
};

export type TextSendInput = {
  to: string;
  body: string;
  idempotencyKey: string;
};

export type SendResult = {
  waMessageId: string;
};

export class WhatsAppError extends Error {
  readonly code: string;
  readonly httpStatus: number | null;
  readonly retryable: boolean;
  readonly detail: string | null;

  constructor(
    message: string,
    options: {
      code?: string;
      httpStatus?: number | null;
      retryable?: boolean;
      detail?: string | null;
    } = {},
  ) {
    super(message);
    this.name = "WhatsAppError";
    this.code = options.code ?? "WHATSAPP_ERROR";
    this.httpStatus = options.httpStatus ?? null;
    this.retryable = options.retryable ?? false;
    this.detail = options.detail ?? null;
  }
}

export interface WhatsAppAdapter {
  readonly provider: WhatsAppProvider;
  /** False for the simulator, true for the Graph API. */
  readonly live: boolean;
  sendTemplate(input: TemplateSendInput): Promise<SendResult>;
  sendText(input: TextSendInput): Promise<SendResult>;
  /** Constant-time HMAC check of `X-Hub-Signature-256` over the raw body. */
  verifySignature(input: { rawBody: string; signatureHeader: string | null }): boolean;
}

export type WhatsAppSettings = {
  enabled: boolean;
  requested: WhatsAppProvider;
  provider: WhatsAppProvider;
  live: boolean;
  businessNumber: string | null;
  graphVersion: string;
  phoneNumberId: string | null;
  /** Which required cloud values are missing; empty when live is possible. */
  missing: string[];
  notice: string | null;
};
