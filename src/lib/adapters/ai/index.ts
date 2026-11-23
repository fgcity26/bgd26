import { aiSettings, type AiSettings } from "@/lib/ai/config";
import { localAiAdapter } from "./local";
import { openAiAdapter } from "./openai";
import type { AiAdapter } from "./types";

/**
 * Pick the assistant provider.
 *
 * `openai` is used only when it was requested *and* a key exists. Anything else
 * falls back to the deterministic local adapter, and the settings object carries
 * a notice so the console can say exactly what is running. A missing key must
 * never break the page or the shop.
 */
export function getAiAdapter(settings: AiSettings = aiSettings()): AiAdapter {
  return settings.provider === "openai" ? openAiAdapter : localAiAdapter;
}

export { AiProviderError } from "./openai";
export type {
  AiAdapter,
  AiChatMessage,
  AiModelMessage,
  AiToolCall,
  AiToolDefinition,
  AiToolTrace,
  AiTurn,
  AiUsage,
  AssistantDraft,
  AssistantReply,
} from "./types";
