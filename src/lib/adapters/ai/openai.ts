import { aiBaseUrl, aiSettings } from "@/lib/ai/config";
import type {
  AiAdapter,
  AiChatInput,
  AiModelMessage,
  AiToolCall,
  AiTurn,
} from "./types";

/**
 * OpenAI-compatible Chat Completions adapter.
 *
 * Only the documented JSON API is used, with tool calling. No SDK, no streaming
 * and no key in a URL. A request has a hard timeout and a bounded output, and a
 * provider failure is a normal result the runner can turn into a human
 * handover; it never reaches checkout or a money path.
 */

export class AiProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "AiProviderError";
  }
}

type OpenAiMessage =
  | { role: "system" | "user" | "assistant"; content: string }
  | {
      role: "assistant";
      content: string;
      tool_calls: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }>;
    }
  | { role: "tool"; tool_call_id: string; content: string };

function toOpenAi(message: AiModelMessage): OpenAiMessage {
  if (message.role === "tool") {
    return {
      role: "tool",
      tool_call_id: message.toolCallId,
      content: message.content,
    };
  }
  if (message.role === "assistant" && message.toolCalls?.length) {
    return {
      role: "assistant",
      content: message.content,
      tool_calls: message.toolCalls.map((call) => ({
        id: call.id,
        type: "function",
        function: {
          name: call.name,
          arguments: JSON.stringify(call.arguments ?? {}),
        },
      })),
    };
  }
  return { role: message.role, content: message.content };
}

function parseArguments(raw: unknown): unknown {
  if (typeof raw !== "string") return raw ?? {};
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return { __invalidJson: raw };
  }
}

export const openAiAdapter: AiAdapter = {
  provider: "openai",
  model: process.env.AI_MODEL?.trim() || "gpt-4.1-mini",
  live: true,

  async chat(input: AiChatInput): Promise<AiTurn> {
    const settings = aiSettings();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), settings.timeoutMs);
    const signal = input.signal
      ? AbortSignal.any([input.signal, controller.signal])
      : controller.signal;

    try {
      const response = await fetch(`${aiBaseUrl()}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${process.env.AI_API_KEY?.trim() ?? ""}`,
        },
        body: JSON.stringify({
          model: settings.model,
          messages: input.messages.map(toOpenAi),
          tools: input.tools.map((tool) => ({
            type: "function",
            function: {
              name: tool.name,
              description: tool.description,
              parameters: tool.parameters,
            },
          })),
          tool_choice: input.tools.length > 0 ? "auto" : "none",
          temperature: 0.2,
          max_tokens: settings.maxOutputTokens,
          stream: false,
        }),
        signal,
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new AiProviderError(
          `AI provider returned ${response.status}${body ? `: ${body.slice(0, 200)}` : ""}`,
          response.status,
        );
      }

      const payload = (await response.json()) as {
        choices?: Array<{
          message?: {
            content?: string | null;
            tool_calls?: Array<{
              id?: string;
              function?: { name?: string; arguments?: string };
            }>;
          };
        }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };

      const message = payload.choices?.[0]?.message;
      const toolCalls: AiToolCall[] = (message?.tool_calls ?? [])
        .map((call, index) => ({
          id: call.id || `call-${index}`,
          name: call.function?.name ?? "",
          arguments: parseArguments(call.function?.arguments),
        }))
        .filter((call) => call.name.length > 0);

      return {
        content: message?.content?.trim() ?? "",
        toolCalls,
        usage: {
          inputTokens: Math.max(0, payload.usage?.prompt_tokens ?? 0),
          outputTokens: Math.max(0, payload.usage?.completion_tokens ?? 0),
        },
      };
    } catch (error) {
      if (error instanceof AiProviderError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new AiProviderError("The AI provider timed out.");
      }
      throw new AiProviderError(
        error instanceof Error ? error.message : "The AI provider failed.",
      );
    } finally {
      clearTimeout(timer);
    }
  },
};
