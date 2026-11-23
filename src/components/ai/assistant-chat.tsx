"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { askAssistantAction } from "@/app/actions/assistant";
import type { AssistantReply } from "@/lib/adapters/ai/types";

type ChatMessage = { role: "user" | "assistant"; content: string };

const TOOL_LABELS: Record<string, string> = {
  search_products: "Product lookup",
  get_order_status: "Order lookup",
  quote_delivery: "Delivery quote",
  create_draft_order: "Draft order",
};

const SUGGESTIONS = [
  "চালের দাম কত?",
  "Dhaka delivery charge?",
  "Show order SO-",
];

export function AssistantChat({ greeting }: { greeting: string }) {
  const keyRef = useRef<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [last, setLast] = useState<AssistantReply | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function send(raw: string) {
    const content = raw.trim();
    if (!content || pending) return;
    if (!keyRef.current) {
      keyRef.current =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID().replaceAll("-", "")
          : `chat${Date.now()}`;
    }
    const next: ChatMessage[] = [...messages, { role: "user" as const, content }].slice(-20);
    setMessages(next);
    setInput("");
    setError(null);
    startTransition(async () => {
      try {
        const result = await askAssistantAction({
          conversationKey: keyRef.current!,
          messages: next,
        });
        setMessages((current) =>
          [...current, { role: "assistant" as const, content: result.reply }].slice(-20),
        );
        setLast(result);
      } catch {
        setError("The assistant request failed. Please try again or ask a colleague.");
      }
    });
  }

  return (
    <div className="space-y-3">
      <div className="rounded-2xl bg-white ring-1 ring-slate-200">
        <div className="max-h-[28rem] space-y-3 overflow-y-auto p-4">
          <div className="max-w-[92%] rounded-2xl bg-slate-50 px-3 py-2 text-sm leading-relaxed text-ink-700 ring-1 ring-slate-200">
            {greeting}
          </div>
          {messages.map((message, index) =>
            message.role === "user" ? (
              <div key={`${index}-u`} className="ml-auto max-w-[92%] rounded-2xl bg-brand-600 px-3 py-2 text-sm leading-relaxed text-white">
                {message.content}
              </div>
            ) : (
              <div
                key={`${index}-a`}
                className="max-w-[92%] whitespace-pre-line rounded-2xl bg-slate-50 px-3 py-2 text-sm leading-relaxed text-ink-700 ring-1 ring-slate-200"
              >
                {message.content}
              </div>
            ),
          )}
          {pending ? (
            <p className="text-xs text-ink-500">Checking the live data… · তথ্য দেখা হচ্ছে…</p>
          ) : null}
        </div>

        {last?.tools.length ? (
          <div className="flex flex-wrap gap-2 border-t border-slate-100 px-3 py-2">
            {last.tools.map((tool, index) => (
              <span
                key={`${tool.name}-${index}`}
                className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${
                  tool.status === "SUCCESS"
                    ? "bg-brand-50 text-brand-700 ring-brand-200"
                    : tool.status === "BLOCKED"
                      ? "bg-amber-50 text-amber-800 ring-amber-200"
                      : "bg-red-50 text-red-700 ring-red-200"
                }`}
                title={tool.detail ?? undefined}
              >
                {TOOL_LABELS[tool.name] ?? tool.name} · {tool.status.toLowerCase()}
              </span>
            ))}
          </div>
        ) : null}

        {last?.draft ? (
          <div className="border-t border-slate-100 px-3 py-2 text-sm">
            <p className="font-medium text-ink-900">
              Draft {last.draft.orderNumber} · ৳{last.draft.grandTotal}
            </p>
            <Link
              href={`/orders/${last.draft.id}`}
              className="mt-1 inline-flex min-h-9 items-center rounded-lg bg-brand-600 px-3 text-xs font-semibold text-white hover:bg-brand-700"
            >
              Review draft
            </Link>
          </div>
        ) : null}

        {error ? (
          <p className="border-t border-red-100 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
        ) : null}

        <form
          className="flex items-end gap-2 border-t border-slate-100 p-3"
          onSubmit={(event) => {
            event.preventDefault();
            send(input);
          }}
        >
          <label className="sr-only" htmlFor="assistant-message">
            Message · বার্তা
          </label>
          <textarea
            id="assistant-message"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                send(input);
              }
            }}
            rows={2}
            maxLength={2_000}
            placeholder="Ask about stock, delivery or an order… · স্টক, ডেলিভারি বা অর্ডার জিজ্ঞাসা করুন…"
            className="min-h-11 flex-1 resize-none rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
          />
          <button
            type="submit"
            disabled={pending || input.trim().length === 0}
            className="min-h-11 rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? "…" : "Send"}
          </button>
        </form>
      </div>

      <div className="flex flex-wrap gap-2">
        {SUGGESTIONS.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            onClick={() => send(suggestion)}
            disabled={pending}
            className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-ink-700 hover:border-brand-300 hover:text-brand-700 disabled:opacity-60"
          >
            {suggestion}
          </button>
        ))}
      </div>
    </div>
  );
}
