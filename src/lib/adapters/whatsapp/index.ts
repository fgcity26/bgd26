import { whatsappSettings } from "./config";
import { cloudWhatsappAdapter } from "./cloud";
import { localWhatsappAdapter } from "./local";
import type { WhatsAppAdapter, WhatsAppSettings } from "./types";

/**
 * Pick the WhatsApp transport.
 *
 * The local simulator is the default outside a configured cloud account; a
 * requested cloud provider with missing credentials falls back visibly instead
 * of throwing at send time. The notification service still persists every
 * message, so switching providers never loses queue state.
 */
export function getWhatsAppAdapter(settings: WhatsAppSettings = whatsappSettings()): WhatsAppAdapter {
  return settings.provider === "cloud" ? cloudWhatsappAdapter : localWhatsappAdapter;
}

export {
  cloudTimeoutMs,
  retryDelaySeconds,
  retryPolicy,
  whatsappSettings,
} from "./config";
export { WhatsAppError } from "./types";
export type {
  SendResult,
  TemplateSendInput,
  TextSendInput,
  WhatsAppAdapter,
  WhatsAppProvider,
  WhatsAppSettings,
} from "./types";
