import type { Metadata } from "next";
import Link from "next/link";
import {
  dispatchWhatsappQueueAction,
  requeueWhatsappFailuresAction,
  saveWhatsappSettingsAction,
} from "@/app/actions/whatsapp";
import { hasPermission } from "@/lib/auth/permissions";
import { requirePagePermission } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { whatsappSettings, retryPolicy } from "@/lib/adapters/whatsapp";
import { getSetting, maskedRecipient } from "@/lib/whatsapp/service";
import { EVENT_LABELS } from "@/lib/whatsapp/templates";
import { formatBdMobile } from "@/lib/crm/phone";

export const metadata: Metadata = {
  title: "WhatsApp queue",
  robots: { index: false, follow: false },
};

const when = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Dhaka",
});

const STATUS_STYLE: Record<string, string> = {
  QUEUED: "bg-amber-50 text-amber-800 ring-amber-200",
  SENT: "bg-brand-50 text-brand-700 ring-brand-200",
  DELIVERED: "bg-sky-50 text-sky-800 ring-sky-200",
  READ: "bg-sky-50 text-sky-800 ring-sky-200",
  FAILED: "bg-red-50 text-red-700 ring-red-200",
  SKIPPED: "bg-slate-100 text-ink-600 ring-slate-200",
  RECEIVED: "bg-white text-ink-700 ring-slate-200",
};

type Search = { ok?: string; error?: string };

export default async function WhatsappQueuePage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const session = await requirePagePermission("whatsapp.read");
  const params = await searchParams;
  const canWrite = hasPermission(session, "whatsapp.write");
  const settings = whatsappSettings();
  const policy = retryPolicy();
  const saved = await getSetting();

  const [counts, rows] = await Promise.all([
    prisma.whatsappMessage.groupBy({
      by: ["status"],
      where: { direction: "OUTBOUND" },
      _count: { _all: true },
    }),
    prisma.whatsappMessage.findMany({
      where: { direction: "OUTBOUND" },
      orderBy: { createdAt: "desc" },
      take: 40,
      select: {
        id: true,
        status: true,
        event: true,
        recipient: true,
        templateName: true,
        attemptCount: true,
        maxAttempts: true,
        nextAttemptAt: true,
        createdAt: true,
        errorCode: true,
        errorMessage: true,
        relatedOrder: { select: { id: true, orderNumber: true } },
        conversation: { select: { id: true, customerName: true, phoneNumberNormalized: true } },
      },
    }),
  ]);

  const countFor = (status: string) =>
    counts.find((entry) => entry.status === status)?._count._all ?? 0;

  const webhookReady = Boolean(
    process.env.WHATSAPP_VERIFY_TOKEN?.trim() && process.env.WHATSAPP_APP_SECRET?.trim(),
  );
  const workerReady = Boolean(
    process.env.WHATSAPP_WORKER_SECRET?.trim() || process.env.CRON_SECRET?.trim(),
  );

  return (
    <div className="space-y-4">
      {params.ok ? (
        <p className="rounded-xl bg-brand-50 px-3 py-2 text-sm text-brand-800 ring-1 ring-brand-200">
          {params.ok}
        </p>
      ) : null}
      {params.error ? (
        <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200">
          {params.error}
        </p>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Queued", value: countFor("QUEUED"), tone: "text-amber-700" },
          { label: "Sent", value: countFor("SENT") + countFor("DELIVERED") + countFor("READ"), tone: "text-brand-700" },
          { label: "Failed", value: countFor("FAILED"), tone: "text-red-700" },
          { label: "Skipped", value: countFor("SKIPPED"), tone: "text-ink-600" },
        ].map((card) => (
          <div key={card.label} className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
            <p className="text-xs uppercase tracking-wide text-ink-500">{card.label}</p>
            <p className={`mt-1 text-2xl font-bold ${card.tone}`}>{card.value}</p>
          </div>
        ))}
      </section>

      <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold">
              Provider: {settings.provider} · {settings.live ? "live Cloud API" : "simulator"}
            </p>
            <p className="mt-1 text-xs text-ink-500">
              Webhook {webhookReady ? "ready" : "not configured"} · worker{" "}
              {workerReady ? "protected by a secret" : "open in development only"} · retry{" "}
              {policy.maxAttempts} attempts, {policy.baseSeconds}s base
            </p>
          </div>
          {canWrite ? (
            <div className="flex flex-wrap gap-2">
              <form action={dispatchWhatsappQueueAction}>
                <button className="min-h-9 rounded-lg bg-brand-600 px-3 text-sm font-semibold text-white hover:bg-brand-700">
                  Send queued now
                </button>
              </form>
              <form action={requeueWhatsappFailuresAction}>
                <button className="min-h-9 rounded-lg border border-slate-300 px-3 text-sm font-medium hover:border-brand-300">
                  Requeue failed
                </button>
              </form>
            </div>
          ) : null}
        </div>
        {settings.notice ? (
          <p className="mt-2 rounded-lg bg-amber-50 px-2 py-1 text-xs text-amber-800 ring-1 ring-amber-200">
            {settings.notice}
          </p>
        ) : null}
        <p className="mt-2 text-[11px] text-ink-500">
          A daily Vercel cron drains due retries at 10:00 Dhaka. Every order event also tries
          once immediately, so the cron is a safety net. On Pro the schedule can run every few
          minutes.
        </p>
      </section>

      <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
        <h2 className="text-sm font-semibold">Automatic notifications · স্বয়ংক্রিয় বার্তা</h2>
        <p className="mt-1 text-xs text-ink-500">
          Turn an event off to stop new messages. Existing queued rows are unaffected.
        </p>
        <form action={saveWhatsappSettingsAction} className="mt-3 space-y-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="autoSend" defaultChecked={saved.autoSend} className="size-4" />
            Send immediately after the event (otherwise wait for the worker)
          </label>
          <div className="grid gap-2 sm:grid-cols-2">
            {(
              [
                ["orderConfirmation", "Order confirmed", saved.orderConfirmation],
                ["orderShipped", "Order shipped", saved.orderShipped],
                ["refundCompleted", "Refund completed", saved.refundCompleted],
                ["paymentReminder", "Payment reminder", saved.paymentReminder],
                ["reviewRequest", "Review request", saved.reviewRequest],
              ] as const
            ).map(([name, label, value]) => (
              <label key={name} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name={name} defaultChecked={value} className="size-4" />
                {label}
              </label>
            ))}
          </div>
          {canWrite ? (
            <button className="min-h-9 rounded-lg bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700">
              Save settings
            </button>
          ) : (
            <p className="text-xs text-ink-500">Saving needs `whatsapp.write`.</p>
          )}
        </form>
      </section>

      <section className="overflow-x-auto rounded-2xl bg-white ring-1 ring-slate-200">
        <table className="min-w-full text-left text-xs">
          <thead className="bg-slate-50 text-ink-500">
            <tr>
              <th className="px-3 py-2 font-medium">When</th>
              <th className="px-3 py-2 font-medium">Event</th>
              <th className="px-3 py-2 font-medium">Recipient</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Tries</th>
              <th className="px-3 py-2 font-medium">Next try</th>
              <th className="px-3 py-2 font-medium">Detail</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-4 text-sm text-ink-500">
                  Nothing queued yet. Confirming or shipping an online order creates a message.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="align-top">
                  <td className="whitespace-nowrap px-3 py-2 text-ink-500">{when.format(row.createdAt)}</td>
                  <td className="px-3 py-2">
                    {row.event === "MANUAL" ? "Manual reply" : EVENT_LABELS[row.event]}
                    {row.relatedOrder ? (
                      <Link
                        href={`/orders/${row.relatedOrder.id}`}
                        className="mt-0.5 block text-[11px] text-brand-700 hover:underline"
                      >
                        {row.relatedOrder.orderNumber}
                      </Link>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    <span className="block">{maskedRecipient(row.recipient)}</span>
                    <span className="block text-[11px] text-ink-500">
                      {row.conversation.customerName || formatBdMobile(row.conversation.phoneNumberNormalized)}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-[10px] ring-1 ${
                        STATUS_STYLE[row.status] ?? STATUS_STYLE.QUEUED
                      }`}
                    >
                      {row.status.toLowerCase()}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-ink-600">
                    {row.attemptCount}/{row.maxAttempts}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-ink-500">
                    {row.nextAttemptAt ? when.format(row.nextAttemptAt) : "—"}
                  </td>
                  <td className="max-w-[22rem] px-3 py-2">
                    {row.errorMessage ? (
                      <span className="block text-red-700">
                        {row.errorCode ? `${row.errorCode}: ` : ""}
                        {row.errorMessage}
                      </span>
                    ) : row.templateName ? (
                      <span className="text-ink-500">{row.templateName}</span>
                    ) : (
                      <span className="text-ink-400">—</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
