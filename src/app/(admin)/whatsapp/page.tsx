import type { Metadata } from "next";
import Link from "next/link";
import {
  markWhatsappReadAction,
  resolveWhatsappConversationAction,
  sendWhatsappReplyAction,
} from "@/app/actions/whatsapp";
import { hasPermission } from "@/lib/auth/permissions";
import { requirePagePermission } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { formatBdMobile } from "@/lib/crm/phone";
import { whatsappSettings } from "@/lib/adapters/whatsapp";
import { isWindowOpen } from "@/lib/whatsapp/service";
import { formatMoney } from "@/lib/inventory/format";

export const metadata: Metadata = {
  title: "WhatsApp inbox",
  robots: { index: false, follow: false },
};

const when = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Dhaka",
});

const STYLE: Record<string, string> = {
  OPEN: "bg-brand-50 text-brand-700 ring-brand-200",
  PENDING: "bg-amber-50 text-amber-800 ring-amber-200",
  HANDOVER: "bg-sky-50 text-sky-800 ring-sky-200",
  RESOLVED: "bg-slate-100 text-ink-600 ring-slate-200",
  CLOSED: "bg-slate-100 text-ink-500 ring-slate-200",
};

const MESSAGE_STATUS: Record<string, string> = {
  QUEUED: "queued",
  SENT: "sent",
  DELIVERED: "delivered",
  READ: "read",
  FAILED: "failed",
  SKIPPED: "skipped",
  RECEIVED: "received",
};

type Search = { c?: string; ok?: string; error?: string };

export default async function WhatsappInboxPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const session = await requirePagePermission("whatsapp.read");
  const params = await searchParams;
  const canWrite = hasPermission(session, "whatsapp.write");
  const settings = whatsappSettings();

  const [conversations, dueCount, approvedTemplates] = await Promise.all([
    prisma.whatsappConversation.findMany({
      orderBy: [{ lastMessageAt: "desc" }, { createdAt: "desc" }],
      take: 40,
      select: {
        id: true,
        customerName: true,
        phoneNumberNormalized: true,
        status: true,
        unreadCount: true,
        windowExpiresAt: true,
        lastMessageAt: true,
      },
    }),
    prisma.whatsappMessage.count({
      where: { status: "QUEUED", nextAttemptAt: { lte: new Date() } },
    }),
    prisma.whatsappTemplate.count({ where: { status: "APPROVED" } }),
  ]);

  const selectedId = params.c || conversations[0]?.id || null;
  const selected = selectedId
    ? await prisma.whatsappConversation.findUnique({
        where: { id: selectedId },
        select: {
          id: true,
          customerId: true,
          customerName: true,
          phoneNumberNormalized: true,
          status: true,
          windowExpiresAt: true,
          lastInboundAt: true,
          unreadCount: true,
        },
      })
    : null;

  const [messages, customer, consent, orders] = await Promise.all([
    selected
      ? prisma.whatsappMessage.findMany({
          where: { conversationId: selected.id },
          orderBy: { createdAt: "desc" },
          take: 60,
          select: {
            id: true,
            direction: true,
            messageType: true,
            body: true,
            status: true,
            errorMessage: true,
            createdAt: true,
            sentAt: true,
            event: true,
            templateName: true,
          },
        })
      : Promise.resolve([]),
    selected?.customerId
      ? prisma.customer.findUnique({
          where: { id: selected.customerId },
          select: {
            id: true,
            fullName: true,
            mobileNormalized: true,
            loyaltyPointsBalance: true,
            totalOrders: true,
            lifetimeValue: true,
            lastOrderAt: true,
          },
        })
      : Promise.resolve(null),
    selected?.customerId
      ? prisma.whatsappConsent.findFirst({
          where: { customerId: selected.customerId },
          orderBy: { updatedAt: "desc" },
          select: { status: true, source: true, optedInAt: true, optedOutAt: true },
        })
      : Promise.resolve(null),
    selected?.customerId
      ? prisma.order.findMany({
          where: { customerId: selected.customerId },
          orderBy: { placedAt: "desc" },
          take: 3,
          select: { id: true, orderNumber: true, status: true, grandTotal: true, placedAt: true },
        })
      : Promise.resolve([]),
  ]);

  const windowOpen = isWindowOpen(selected?.windowExpiresAt ?? null);
  const thread = [...messages].reverse();

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

      <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold">
              {settings.live ? "Cloud API live" : "Local simulator"}
              <span
                className={`ml-2 rounded-full px-2 py-0.5 text-[11px] ring-1 ${
                  settings.live
                    ? "bg-brand-50 text-brand-700 ring-brand-200"
                    : "bg-amber-50 text-amber-800 ring-amber-200"
                }`}
              >
                {settings.provider}
              </span>
            </p>
            <p className="mt-1 text-xs text-ink-500">
              {settings.businessNumber
                ? `Business number ${settings.businessNumber}`
                : "Business number not set"}
              {" · "}
              {approvedTemplates} approved template(s)
              {" · "}
              {dueCount} due in the queue
            </p>
          </div>
          <Link
            href="/whatsapp/queue"
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-ink-700 hover:border-brand-300 hover:text-brand-700"
          >
            Queue & settings →
          </Link>
        </div>
        {settings.notice ? (
          <p className="mt-2 rounded-lg bg-amber-50 px-2 py-1 text-xs text-amber-800 ring-1 ring-amber-200">
            {settings.notice}
          </p>
        ) : null}
        {settings.live ? (
          <p className="mt-2 rounded-lg bg-sky-50 px-2 py-1 text-xs text-sky-800 ring-1 ring-sky-200">
            A reply is only allowed inside Meta&apos;s 24-hour customer-service window.
            Outside it, send an approved template from the Templates tab.
          </p>
        ) : null}
      </section>

      <div className="grid gap-4 lg:grid-cols-[20rem_1fr]">
        <section className="rounded-2xl bg-white p-2 ring-1 ring-slate-200">
          <p className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-ink-500">
            Conversations · কথোপকথন
          </p>
          {conversations.length === 0 ? (
            <p className="p-3 text-sm text-ink-500">
              No conversations yet. They appear when a customer messages the business number.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {conversations.map((entry) => {
                const active = entry.id === selectedId;
                return (
                  <li key={entry.id}>
                    <Link
                      href={`/whatsapp?c=${entry.id}`}
                      className={`block rounded-lg px-2 py-2 ${
                        active ? "bg-brand-50 ring-1 ring-brand-200" : "hover:bg-slate-50"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium">
                          {entry.customerName || formatBdMobile(entry.phoneNumberNormalized)}
                        </span>
                        {entry.unreadCount > 0 ? (
                          <span className="rounded-full bg-brand-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                            {entry.unreadCount}
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-0.5 flex items-center justify-between gap-2 text-[11px] text-ink-500">
                        <span>{formatBdMobile(entry.phoneNumberNormalized)}</span>
                        <span>{entry.lastMessageAt ? when.format(entry.lastMessageAt) : "—"}</span>
                      </div>
                      <div className="mt-1 flex items-center gap-1">
                        <span
                          className={`rounded-full px-1.5 py-0.5 text-[10px] ring-1 ${
                            STYLE[entry.status] ?? STYLE.OPEN
                          }`}
                        >
                          {entry.status.toLowerCase()}
                        </span>
                        <span
                          className={`rounded-full px-1.5 py-0.5 text-[10px] ring-1 ${
                            isWindowOpen(entry.windowExpiresAt)
                              ? "bg-brand-50 text-brand-700 ring-brand-200"
                              : "bg-slate-100 text-ink-500 ring-slate-200"
                          }`}
                        >
                          {isWindowOpen(entry.windowExpiresAt) ? "window open" : "window closed"}
                        </span>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="space-y-3">
          {!selected ? (
            <div className="rounded-2xl bg-white p-6 text-sm text-ink-500 ring-1 ring-slate-200">
              Select a conversation to read the thread.
            </div>
          ) : (
            <>
              <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-base font-semibold">
                      {selected.customerName || formatBdMobile(selected.phoneNumberNormalized)}
                    </p>
                    <p className="text-xs text-ink-500">
                      {formatBdMobile(selected.phoneNumberNormalized)}
                      {customer ? ` · ${customer.totalOrders} order(s) · ৳${formatMoney(customer.lifetimeValue)} lifetime` : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] ring-1 ${
                        STYLE[selected.status] ?? STYLE.OPEN
                      }`}
                    >
                      {selected.status.toLowerCase()}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] ring-1 ${
                        consent?.status === "OPTED_IN"
                          ? "bg-brand-50 text-brand-700 ring-brand-200"
                          : consent?.status === "OPTED_OUT"
                            ? "bg-red-50 text-red-700 ring-red-200"
                            : "bg-slate-100 text-ink-600 ring-slate-200"
                      }`}
                    >
                      {consent?.status === "OPTED_IN"
                        ? "opted in"
                        : consent?.status === "OPTED_OUT"
                          ? "opted out"
                          : "no consent"}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] ring-1 ${
                        windowOpen
                          ? "bg-sky-50 text-sky-800 ring-sky-200"
                          : "bg-slate-100 text-ink-500 ring-slate-200"
                      }`}
                    >
                      {windowOpen
                        ? `window until ${when.format(selected.windowExpiresAt!)}`
                        : "24h window closed"}
                    </span>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {selected.unreadCount > 0 ? (
                    <form action={markWhatsappReadAction}>
                      <input type="hidden" name="conversationId" value={selected.id} />
                      <button className="min-h-8 rounded-lg border border-slate-300 px-2 text-[11px] font-medium hover:border-brand-300">
                        Mark read
                      </button>
                    </form>
                  ) : null}
                  {canWrite && selected.status !== "RESOLVED" ? (
                    <form action={resolveWhatsappConversationAction}>
                      <input type="hidden" name="conversationId" value={selected.id} />
                      <input type="hidden" name="status" value="RESOLVED" />
                      <button className="min-h-8 rounded-lg border border-slate-300 px-2 text-[11px] font-medium hover:border-brand-300">
                        Mark resolved
                      </button>
                    </form>
                  ) : null}
                  {canWrite && selected.status === "RESOLVED" ? (
                    <form action={resolveWhatsappConversationAction}>
                      <input type="hidden" name="conversationId" value={selected.id} />
                      <input type="hidden" name="status" value="OPEN" />
                      <button className="min-h-8 rounded-lg border border-slate-300 px-2 text-[11px] font-medium hover:border-brand-300">
                        Reopen
                      </button>
                    </form>
                  ) : null}
                  {customer ? (
                    <Link
                      href={`/customers/${customer.id}`}
                      className="min-h-8 rounded-lg border border-slate-300 px-2 py-1 text-[11px] font-medium hover:border-brand-300"
                    >
                      Customer card →
                    </Link>
                  ) : null}
                </div>
                {orders.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                    {orders.map((order) => (
                      <Link
                        key={order.id}
                        href={`/orders/${order.id}`}
                        className="rounded-lg bg-slate-100 px-2 py-1 text-ink-700 hover:bg-slate-200"
                      >
                        {order.orderNumber} · {order.status.toLowerCase()} · ৳{formatMoney(order.grandTotal)}
                      </Link>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="max-h-[55vh] space-y-2 overflow-y-auto rounded-2xl bg-slate-50 p-3 ring-1 ring-slate-200">
                {thread.length === 0 ? (
                  <p className="text-sm text-ink-500">No messages stored yet.</p>
                ) : (
                  thread.map((message) => {
                    const outbound = message.direction === "OUTBOUND";
                    return (
                      <div
                        key={message.id}
                        className={`flex ${outbound ? "justify-end" : "justify-start"}`}
                      >
                        <div
                          className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ring-1 ${
                            outbound
                              ? "bg-brand-50 text-ink-900 ring-brand-200"
                              : "bg-white text-ink-900 ring-slate-200"
                          }`}
                        >
                          <p className="whitespace-pre-wrap break-words">{message.body || "—"}</p>
                          <p className="mt-1 text-[10px] text-ink-500">
                            {outbound ? "sent" : "received"} · {when.format(message.createdAt)}
                            {outbound
                              ? ` · ${MESSAGE_STATUS[message.status] ?? message.status.toLowerCase()}`
                              : ""}
                            {message.templateName ? ` · ${message.templateName}` : ""}
                          </p>
                          {message.errorMessage ? (
                            <p className="mt-1 text-[10px] text-red-700">{message.errorMessage}</p>
                          ) : null}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {canWrite ? (
                windowOpen ? (
                  <form
                    action={sendWhatsappReplyAction}
                    className="rounded-2xl bg-white p-3 ring-1 ring-slate-200"
                  >
                    <input type="hidden" name="conversationId" value={selected.id} />
                    <label className="text-xs font-medium text-ink-700" htmlFor="wa-reply">
                      Reply · উত্তর
                    </label>
                    <textarea
                      id="wa-reply"
                      name="body"
                      required
                      maxLength={4096}
                      rows={3}
                      placeholder="Write a reply. It is sent as a normal WhatsApp message."
                      className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-400"
                    />
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <p className="text-[11px] text-ink-500">
                        Replying moves this conversation to human handover.
                      </p>
                      <button className="min-h-9 rounded-lg bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700">
                        Send · পাঠান
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="rounded-2xl bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200">
                    The 24-hour window is closed, so a free-text reply cannot be sent.
                    Only an approved template is allowed.{" "}
                    <Link href="/whatsapp/templates" className="font-semibold underline">
                      Open templates →
                    </Link>
                  </div>
                )
              ) : (
                <p className="rounded-2xl bg-slate-100 p-3 text-sm text-ink-600 ring-1 ring-slate-200">
                  You can read this inbox. Replying needs `whatsapp.write`.
                </p>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
