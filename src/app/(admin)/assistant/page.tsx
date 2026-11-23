import type { Metadata } from "next";
import Link from "next/link";
import { AssistantChat } from "@/components/ai/assistant-chat";
import { DraftOrderForm } from "@/components/ai/draft-order-form";
import { hasPermission } from "@/lib/auth/permissions";
import { requirePagePermission } from "@/lib/auth/session";
import { aiSettings } from "@/lib/ai/config";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/inventory/format";

export const metadata: Metadata = {
  title: "Assistant",
  robots: { index: false, follow: false },
};

const dateTime = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Dhaka",
});

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  CANCELLED: "Cancelled",
};

export default async function AssistantPage() {
  const session = await requirePagePermission("ai.read");
  const settings = aiSettings();
  const canWrite = hasPermission(session, "ai.write");

  const [zones, drafts, recent] = await Promise.all([
    canWrite
      ? prisma.deliveryZone.findMany({
          where: { isActive: true },
          orderBy: [{ division: "asc" }, { district: "asc" }],
          select: { id: true, name: true, district: true, charge: true },
        })
      : Promise.resolve([]),
    prisma.order.findMany({
      where: { aiDraft: true },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: {
        id: true,
        orderNumber: true,
        status: true,
        grandTotal: true,
        createdAt: true,
        recipientName: true,
        customer: { select: { fullName: true } },
      },
    }),
    prisma.aiActionLog.findMany({
      where: {
        actorUserId: session.user.id,
        toolName: { not: "assistant.turn" },
      },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        toolName: true,
        status: true,
        riskLevel: true,
        createdAt: true,
        relatedOrderId: true,
      },
    }),
  ]);

  const greeting =
    settings.provider === "openai"
      ? `I can look up live products, stock, delivery and orders, and create a draft order for review. I never take payment or move stock.\nআমি পণ্য, স্টক, ডেলিভারি ও অর্ডারের তথ্য দেখতে পারি এবং পর্যালোচনার জন্য ড্রাফট অর্ডার তৈরি করতে পারি। টাকা বা স্টক আমি বদলাতে পারি না।`
      : `I am the local rules assistant. I answer product, stock, delivery and order questions from the database, and I can create a draft order. I never guess a price and never take payment or move stock.\nআমি লোকাল সহায়ক। ডেটাবেস থেকেই পণ্য, স্টক, ডেলিভারি ও অর্ডারের উত্তর দিই, আর ড্রাফট অর্ডার তৈরি করতে পারি। দাম আন্দাজ করি না, টাকা বা স্টক বদলাই না।`;

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Assistant · সহায়ক</h1>
        <p className="mt-1 text-sm text-ink-500">
          Read-only lookups plus a non-reserving draft order. Every tool call is logged.
        </p>
      </header>

      <section
        className={`rounded-2xl p-4 ring-1 ${
          settings.enabled
            ? "bg-white ring-slate-200"
            : "bg-amber-50 ring-amber-200"
        }`}
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-sm font-semibold">
              {settings.enabled ? "Assistant online" : "Assistant disabled"}
            </p>
            <p className="mt-1 text-xs text-ink-500">
              Provider: {settings.provider} · model {settings.model} ·{" "}
              {settings.live ? "live model" : "deterministic rules, no API key needed"}
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-[11px] font-medium">
            <span className="rounded-full bg-slate-100 px-2 py-1 text-ink-700 ring-1 ring-slate-200">
              read + draft only
            </span>
            <span
              className={`rounded-full px-2 py-1 ring-1 ${
                settings.draftOrdersEnabled
                  ? "bg-brand-50 text-brand-700 ring-brand-200"
                  : "bg-amber-50 text-amber-800 ring-amber-200"
              }`}
            >
              drafts {settings.draftOrdersEnabled ? "on" : "off"}
            </span>
          </div>
        </div>
        {settings.notice ? (
          <p className="mt-2 rounded-lg bg-amber-50 px-2 py-1 text-xs text-amber-800 ring-1 ring-amber-200">
            {settings.notice}
          </p>
        ) : null}
        <p className="mt-2 text-xs leading-relaxed text-ink-500">
          The assistant cannot take payment, refund, discount, adjust stock or post a journal.
          A draft reserves nothing; converting it re-prices every line and runs the normal sale.
        </p>
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-4">
          {settings.enabled ? (
            <AssistantChat greeting={greeting} />
          ) : (
            <section className="rounded-2xl bg-white p-6 text-center ring-1 ring-slate-200">
              <p className="text-sm font-medium text-ink-700">The assistant is switched off.</p>
              <p className="mt-1 text-sm text-ink-500">
                Set <code>AI_ENABLED=true</code> to turn it back on. The rest of the shop is
                unaffected either way.
              </p>
            </section>
          )}

          {canWrite && settings.draftOrdersEnabled ? (
            <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
              <h2 className="text-base font-semibold">Create a draft order</h2>
              <p className="mt-1 text-xs text-ink-500">
                Use this when the local rules engine cannot read a chat command. The same tool
                and the same audit log run behind it.
              </p>
              <div className="mt-3">
                <DraftOrderForm
                  zones={zones.map((zone) => ({
                    id: zone.id,
                    name: zone.name,
                    district: zone.district,
                    charge: formatMoney(zone.charge),
                  }))}
                />
              </div>
            </section>
          ) : null}
        </div>

        <aside className="space-y-4">
          <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
            <h2 className="text-sm font-semibold">Recent drafts · ড্রাফট</h2>
            {drafts.length === 0 ? (
              <p className="mt-2 text-sm text-ink-500">No assistant draft yet.</p>
            ) : (
              <ul className="mt-2 divide-y divide-slate-100">
                {drafts.map((draft) => (
                  <li key={draft.id} className="py-2">
                    <Link
                      href={`/orders/${draft.id}`}
                      className="text-sm font-medium text-brand-700 hover:underline"
                    >
                      {draft.orderNumber}
                    </Link>
                    <p className="text-xs text-ink-500">
                      {draft.customer.fullName} · ৳{formatMoney(draft.grandTotal)} ·{" "}
                      {STATUS_LABELS[draft.status] ?? draft.status}
                    </p>
                    <p className="text-[11px] text-ink-500">{dateTime.format(draft.createdAt)}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
            <h2 className="text-sm font-semibold">Your recent tool calls</h2>
            {recent.length === 0 ? (
              <p className="mt-2 text-sm text-ink-500">Nothing logged yet.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {recent.map((entry) => (
                  <li key={entry.id} className="text-xs">
                    <span className="font-medium text-ink-700">{entry.toolName}</span>
                    <span
                      className={`ml-1 rounded-full px-1.5 py-0.5 ring-1 ${
                        entry.status === "SUCCESS"
                          ? "bg-brand-50 text-brand-700 ring-brand-200"
                          : entry.status === "BLOCKED"
                            ? "bg-amber-50 text-amber-800 ring-amber-200"
                            : "bg-red-50 text-red-700 ring-red-200"
                      }`}
                    >
                      {entry.status.toLowerCase()}
                    </span>
                    <span className="block text-ink-500">
                      {entry.riskLevel.toLowerCase()} · {dateTime.format(entry.createdAt)}
                      {entry.relatedOrderId ? (
                        <>
                          {" · "}
                          <Link href={`/orders/${entry.relatedOrderId}`} className="underline">
                            order
                          </Link>
                        </>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-2xl bg-slate-50 p-4 text-xs leading-relaxed text-ink-600 ring-1 ring-slate-200">
            <p className="font-semibold text-ink-800">Guardrails · সুরক্ষা</p>
            <ul className="mt-2 list-disc space-y-1 pl-4">
              <li>Tools are allow-listed and re-check permissions server-side.</li>
              <li>Prices, VAT, stock and delivery fees come from the database.</li>
              <li>Drafts reserve no stock and post no journal.</li>
              <li>Every call is in <code>ai_action_logs</code>, with mobile numbers masked.</li>
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}
