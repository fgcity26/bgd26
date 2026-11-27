import type { WhatsAppProvider, WhatsAppSettings } from "./types";

/**
 * Which WhatsApp sidecar is active.
 *
 * `cloud` needs the phone number id and an access token; without them the app
 * falls back to the local simulator and the console says exactly what is
 * missing. Secrets are read here and never returned to the browser — the
 * settings object only carries non-secret display values.
 */
export function whatsappSettings(): WhatsAppSettings {
  const enabled = process.env.FEATURE_WHATSAPP?.trim().toLowerCase() !== "false";
  const configuredProvider =
    process.env.WHATSAPP_PROVIDER?.trim().toLowerCase() === "cloud"
      ? "cloud"
      : process.env.WHATSAPP_PROVIDER?.trim().toLowerCase() === "local"
        ? "local"
        : null;

  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim() || null;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN?.trim() || null;
  const appSecret = process.env.WHATSAPP_APP_SECRET?.trim() || null;
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN?.trim() || null;

  const requested: WhatsAppProvider =
    configuredProvider ?? (phoneNumberId && accessToken ? "cloud" : "local");

  const missing: string[] = [];
  if (requested === "cloud") {
    if (!phoneNumberId) missing.push("WHATSAPP_PHONE_NUMBER_ID");
    if (!accessToken) missing.push("WHATSAPP_ACCESS_TOKEN");
    if (!appSecret) missing.push("WHATSAPP_APP_SECRET");
    if (!verifyToken) missing.push("WHATSAPP_VERIFY_TOKEN");
  }

  const live = enabled && requested === "cloud" && missing.length === 0;

  let notice: string | null = null;
  if (!enabled) {
    notice = "WhatsApp is switched off (FEATURE_WHATSAPP=false). Messages stay queued.";
  } else if (requested === "cloud" && missing.length > 0) {
    notice = `Cloud API requested but ${missing.join(", ")} ${
      missing.length === 1 ? "is" : "are"
    } missing. The local simulator is active; nothing leaves the server.`;
  } else if (!live && requested === "cloud") {
    notice = "Cloud API is not ready; the local simulator is active.";
  }

  return {
    enabled,
    requested,
    provider: live ? "cloud" : "local",
    live,
    businessNumber: process.env.WHATSAPP_BUSINESS_NUMBER?.trim() || null,
    graphVersion: process.env.WHATSAPP_GRAPH_API_VERSION?.trim() || "v21.0",
    phoneNumberId,
    missing,
    notice,
  };
}

export function cloudTimeoutMs(): number {
  const parsed = Number(process.env.WHATSAPP_SEND_TIMEOUT_MS ?? 15_000);
  return Number.isFinite(parsed) && parsed >= 1_000 ? Math.min(parsed, 60_000) : 15_000;
}

export function retryPolicy(): {
  maxAttempts: number;
  baseSeconds: number;
  maxSeconds: number;
} {
  const maxAttempts = Number(process.env.WHATSAPP_MAX_ATTEMPTS ?? 5);
  const baseSeconds = Number(process.env.WHATSAPP_RETRY_BASE_SECONDS ?? 60);
  const maxSeconds = Number(process.env.WHATSAPP_RETRY_MAX_SECONDS ?? 3_600);
  return {
    maxAttempts:
      Number.isInteger(maxAttempts) && maxAttempts >= 1 && maxAttempts <= 20
        ? maxAttempts
        : 5,
    baseSeconds:
      Number.isFinite(baseSeconds) && baseSeconds >= 5 ? baseSeconds : 60,
    maxSeconds:
      Number.isFinite(maxSeconds) && maxSeconds >= 30 ? maxSeconds : 3_600,
  };
}

/** Exponential backoff with a ceiling: 1×, 2×, 4×, 8× … base seconds. */
export function retryDelaySeconds(attempt: number, baseSeconds: number, maxSeconds: number): number {
  const exponent = Math.max(0, attempt - 1);
  return Math.min(maxSeconds, baseSeconds * 2 ** Math.min(exponent, 20));
}
