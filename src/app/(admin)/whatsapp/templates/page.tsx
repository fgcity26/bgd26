import type { Metadata } from "next";
import { saveWhatsappTemplateAction } from "@/app/actions/whatsapp";
import { hasPermission } from "@/lib/auth/permissions";
import { requirePagePermission } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { EVENT_LABELS } from "@/lib/whatsapp/templates";
import { whatsappSettings } from "@/lib/adapters/whatsapp";

export const metadata: Metadata = {
  title: "WhatsApp templates",
  robots: { index: false, follow: false },
};

const when = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Dhaka",
});

const STATUS_STYLE: Record<string, string> = {
  APPROVED: "bg-brand-50 text-brand-700 ring-brand-200",
  PENDING: "bg-amber-50 text-amber-800 ring-amber-200",
  REJECTED: "bg-red-50 text-red-700 ring-red-200",
  PAUSED: "bg-slate-100 text-ink-600 ring-slate-200",
};

const EVENTS = [
  "ORDER_CONFIRMED",
  "ORDER_SHIPPED",
  "REFUND_COMPLETED",
  "PAYMENT_REMINDER",
  "REVIEW_REQUEST",
  "MANUAL",
] as const;

type Search = { ok?: string; error?: string };

export default async function WhatsappTemplatesPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const session = await requirePagePermission("whatsapp.read");
  const params = await searchParams;
  const canWrite = hasPermission(session, "whatsapp.write");
  const settings = whatsappSettings();

  const templates = await prisma.whatsappTemplate.findMany({
    orderBy: [{ event: "asc" }, { language: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      language: true,
      category: true,
      status: true,
      event: true,
      bodyText: true,
      headerText: true,
      footerText: true,
      metaTemplateId: true,
      updatedAt: true,
    },
  });

  // Which automatic events have no APPROVED template in any language. Live
  // Cloud sends need one; the local simulator can still render a PENDING row.
  const approvedEvents = new Set(
    templates.filter((t) => t.status === "APPROVED" && t.event).map((t) => t.event),
  );
  const missing = (
    Object.keys(EVENT_LABELS) as Array<keyof typeof EVENT_LABELS>
  ).filter((event) => !approvedEvents.has(event));

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
        <p className="text-sm font-semibold">
          {settings.live ? "Live Cloud API" : "Local simulator"}
          <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-ink-600 ring-1 ring-slate-200">
            {templates.length} template(s)
          </span>
        </p>
        <p className="mt-1 text-xs text-ink-500">
          A template is sent by its Meta <em>name + language</em>. Only an{" "}
          <strong>APPROVED</strong> template can be sent live; the simulator renders any status so
          you can test the wording.
        </p>
        {missing.length > 0 ? (
          <p className="mt-2 rounded-lg bg-amber-50 px-2 py-1 text-xs text-amber-800 ring-1 ring-amber-200">
            No approved template yet for: {missing.map((event) => EVENT_LABELS[event]).join(", ")}.
            Live sends for those events are skipped until Meta approves one.
          </p>
        ) : (
          <p className="mt-2 rounded-lg bg-brand-50 px-2 py-1 text-xs text-brand-800 ring-1 ring-brand-200">
            Every automatic event has an approved template.
          </p>
        )}
      </section>

      {canWrite ? (
        <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <h2 className="text-sm font-semibold">Add or update · টেমপ্লেট</h2>
          <p className="mt-1 text-xs text-ink-500">
            Copy the exact body Meta approved, keeping the <code>{"{{1}}"}</code> placeholders in
            the same order. Saving an existing name + language updates it in place.
          </p>
          <form action={saveWhatsappTemplateAction} className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-medium text-ink-700">
              Meta template name
              <input
                name="name"
                required
                maxLength={120}
                pattern="[a-z0-9_]+"
                placeholder="order_confirmation"
                className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-400"
              />
            </label>
            <label className="text-xs font-medium text-ink-700">
              Language
              <input
                name="language"
                required
                defaultValue="bn"
                maxLength={10}
                className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-400"
              />
            </label>
            <label className="text-xs font-medium text-ink-700">
              Category
              <select
                name="category"
                defaultValue="UTILITY"
                className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-400"
              >
                <option value="UTILITY">Utility</option>
                <option value="MARKETING">Marketing</option>
                <option value="AUTHENTICATION">Authentication</option>
              </select>
            </label>
            <label className="text-xs font-medium text-ink-700">
              Status
              <select
                name="status"
                defaultValue="PENDING"
                className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-400"
              >
                <option value="PENDING">Pending</option>
                <option value="APPROVED">Approved</option>
                <option value="REJECTED">Rejected</option>
                <option value="PAUSED">Paused</option>
              </select>
            </label>
            <label className="text-xs font-medium text-ink-700">
              Event
              <select
                name="event"
                defaultValue="ORDER_CONFIRMED"
                className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-400"
              >
                {EVENTS.map((event) => (
                  <option key={event} value={event}>
                    {event === "MANUAL" ? "Manual only" : EVENT_LABELS[event]}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-medium text-ink-700">
              Header (optional)
              <input
                name="headerText"
                maxLength={200}
                className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-400"
              />
            </label>
            <label className="text-xs font-medium text-ink-700 sm:col-span-2">
              Body
              <textarea
                name="bodyText"
                required
                rows={3}
                maxLength={4000}
                placeholder="আসসালামু আলাইকুম {{1}}, আপনার অর্ডার {{2}} নিশ্চিত হয়েছে।"
                className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-400"
              />
            </label>
            <label className="text-xs font-medium text-ink-700 sm:col-span-2">
              Footer (optional)
              <input
                name="footerText"
                maxLength={200}
                defaultValue="bgd26.com"
                className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-400"
              />
            </label>
            <div className="sm:col-span-2">
              <button className="min-h-9 rounded-lg bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700">
                Save template
              </button>
            </div>
          </form>
        </section>
      ) : (
        <p className="rounded-2xl bg-slate-100 p-3 text-sm text-ink-600 ring-1 ring-slate-200">
          You can read templates. Adding or editing needs `whatsapp.write`.
        </p>
      )}

      <section className="overflow-x-auto rounded-2xl bg-white ring-1 ring-slate-200">
        <table className="min-w-full text-left text-xs">
          <thead className="bg-slate-50 text-ink-500">
            <tr>
              <th className="px-3 py-2 font-medium">Template</th>
              <th className="px-3 py-2 font-medium">Event</th>
              <th className="px-3 py-2 font-medium">Category</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Body</th>
              <th className="px-3 py-2 font-medium">Updated</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {templates.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-sm text-ink-500">
                  No templates yet. Add Meta&apos;s approved wording above.
                </td>
              </tr>
            ) : (
              templates.map((template) => (
                <tr key={template.id} className="align-top">
                  <td className="px-3 py-2">
                    <span className="block font-medium text-ink-900">{template.name}</span>
                    <span className="block text-[11px] text-ink-500">
                      {template.language}
                      {template.metaTemplateId ? ` · ${template.metaTemplateId}` : ""}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-ink-600">
                    {template.event
                      ? template.event === "MANUAL"
                        ? "Manual only"
                        : EVENT_LABELS[template.event]
                      : "—"}
                  </td>
                  <td className="px-3 py-2 text-ink-600">
                    {template.category.toLowerCase()}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-[10px] ring-1 ${
                        STATUS_STYLE[template.status] ?? STATUS_STYLE.PENDING
                      }`}
                    >
                      {template.status.toLowerCase()}
                    </span>
                  </td>
                  <td className="max-w-[26rem] px-3 py-2">
                    {template.headerText ? (
                      <span className="block font-medium text-ink-700">{template.headerText}</span>
                    ) : null}
                    <span className="block whitespace-pre-wrap break-words text-ink-700">
                      {template.bodyText}
                    </span>
                    {template.footerText ? (
                      <span className="mt-0.5 block text-[11px] text-ink-400">
                        {template.footerText}
                      </span>
                    ) : null}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-ink-500">
                    {when.format(template.updatedAt)}
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
