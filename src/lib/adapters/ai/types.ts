/**
 * AI adapter port.
 *
 * The assistant is deliberately not coupled to a vendor. A provider receives a
 * bounded message list plus the allow-listed tool definitions, and returns one
 * turn: either prose, or one or more tool calls. The runner executes the tools,
 * appends their results and asks again. The model never gets SQL, credentials
 * or direct database access.
 */

export type AiChatRole = "user" | "assistant";

export type AiChatMessage = {
  role: AiChatRole;
  content: string;
};

export type AiToolCall = {
  id: string;
  name: string;
  /** Validated by the tool's Zod schema before anything runs. */
  arguments: unknown;
};

export type AiModelMessage =
  | {
      role: "system" | "user" | "assistant";
      content: string;
      toolCalls?: AiToolCall[];
    }
  | {
      role: "tool";
      toolCallId: string;
      name: string;
      content: string;
    };

export type AiUsage = {
  inputTokens: number;
  outputTokens: number;
};

export type AiTurn = {
  content: string;
  toolCalls: AiToolCall[];
  usage?: AiUsage;
};

export type AiToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type AiChatInput = {
  messages: AiModelMessage[];
  tools: AiToolDefinition[];
  signal?: AbortSignal;
};

export interface AiAdapter {
  readonly provider: "local" | "openai";
  readonly model: string;
  /** False for the deterministic rules engine, true for a live LLM. */
  readonly live: boolean;
  chat(input: AiChatInput): Promise<AiTurn>;
}

export type AiToolTrace = {
  name: string;
  status: "SUCCESS" | "ERROR" | "BLOCKED";
  detail?: string;
};

export type AssistantDraft = {
  id: string;
  orderNumber: string;
  grandTotal: string;
};

export type AssistantReply = {
  ok: boolean;
  reply: string;
  tools: AiToolTrace[];
  draft?: AssistantDraft | null;
  handover: boolean;
  error?: string;
};
