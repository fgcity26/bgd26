/**
 * AI assistant configuration.
 *
 * Every value is read at call time, never at module load, so a build never
 * needs an AI key and a test can change one flag without restarting the app.
 * The assistant is usable with no provider: `local` is a deterministic rules
 * engine that still answers from live database tools.
 */

export type AiSettings = {
  enabled: boolean;
  draftOrdersEnabled: boolean;
  requestedProvider: string;
  provider: "local" | "openai";
  model: string;
  live: boolean;
  notice: string | null;
  maxOutputTokens: number;
  timeoutMs: number;
  maxToolRounds: number;
  maxToolCallsPerTurn: number;
  requestsPerHour: number;
  maxDraftsPerHour: number;
  monthlyTokenBudget: number;
};

function flag(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  return !["0", "false", "no", "off", "disabled"].includes(raw);
}

function integer(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

export function aiSettings(): AiSettings {
  const requestedProvider = process.env.AI_PROVIDER?.trim().toLowerCase() || "local";
  const apiKey = process.env.AI_API_KEY?.trim() ?? "";
  const openaiRequested = requestedProvider === "openai";
  const canUseOpenAi = openaiRequested && apiKey.length > 0;
  const provider: "local" | "openai" = canUseOpenAi ? "openai" : "local";

  let notice: string | null = null;
  if (openaiRequested && !apiKey) {
    notice =
      "AI_PROVIDER=openai but AI_API_KEY is missing, so the local rules engine is running. Set the key to use a live model.";
  } else if (!openaiRequested && requestedProvider !== "local") {
    notice = `Unknown AI_PROVIDER "${requestedProvider}"; the local rules engine is running.`;
  }

  return {
    enabled: flag("AI_ENABLED", true) && flag("FEATURE_AI_ASSISTANT", true),
    draftOrdersEnabled: flag("AI_DRAFT_ORDERS_ENABLED", true),
    requestedProvider,
    provider,
    model:
      provider === "openai"
        ? process.env.AI_MODEL?.trim() || "gpt-4.1-mini"
        : "bgd26-rules-v1",
    live: provider === "openai",
    notice,
    maxOutputTokens: integer("AI_MAX_OUTPUT_TOKENS", 1200, 64, 4096),
    timeoutMs: integer("AI_REQUEST_TIMEOUT_MS", 20_000, 1_000, 60_000),
    maxToolRounds: integer("AI_MAX_TOOL_ROUNDS", 4, 1, 8),
    maxToolCallsPerTurn: integer("AI_MAX_TOOL_CALLS_PER_TURN", 5, 1, 10),
    requestsPerHour: integer("AI_REQUESTS_PER_HOUR", 60, 1, 2_000),
    maxDraftsPerHour: integer("AI_MAX_DRAFTS_PER_HOUR", 10, 1, 500),
    monthlyTokenBudget: integer("AI_MONTHLY_TOKEN_BUDGET", 0, 0, 1_000_000_000),
  };
}

export function aiBaseUrl(): string {
  const raw = process.env.AI_BASE_URL?.trim() || "https://api.openai.com/v1";
  return raw.replace(/\/+$/, "");
}
