import type { Metadata } from "next";
import { Prisma } from "@/generated/prisma/client";
import { setNewsletterStatusAction } from "@/app/actions/newsletter";
import { NewsletterForm } from "@/components/newsletter/newsletter-form";
import { hasPermission } from "@/lib/auth/permissions";
import { requirePagePermission } from "@/lib/auth/session";
import { confirmPath } from "@/lib/crm/newsletter";
import { prisma } from "@/lib/db";

export const metadata: Metadata = {
  title: "Newsletter",
  robots: { index: false, follow: false },
};

const STATUS_OPTIONS = ["PENDING", "SUBSCRIBED", "UNSUBSCRIBED", "BOUNCED"] as const;

const dateFormat = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeZone: "Asia/Dhaka",
});

function statusStyle(status: string): string {
  if (status === "SUBSCRIBED") return "bg-brand-50 text-brand-700 ring-brand-200";
  if (status === "PENDING") return "bg-amber-50 text-amber-800 ring-amber-200";
  if (status === "BOUNCED") return "bg-red-50 text-red-700 ring-red-200";
  return "bg-slate-100 text-ink-500 ring-slate-200";
}

export default async function NewsletterPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const session = await requirePagePermission("newsletter.read");
  const canWrite = hasPermission(session, "newsletter.write");

  const params = await searchParams;
  const status = STATUS_OPTIONS.includes(params.status as (typeof STATUS_OPTIONS)[number])
    ? (params.status as (typeof STATUS_OPTIONS)[number])
    : "PENDING";

  const where: Prisma.NewsletterSubscriberWhereInput = { status };

  const [counts, subscribers] = await Promise.all([
    prisma.newsletterSubscriber.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.newsletterSubscriber.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { customer: { select: { id: true, fullName: true } } },
    }),
  ]);

  const countByStatus = new Map(counts.map((row) => [row.status, row._count._all]));

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Newsletter</h1>
        <p className="mt-1 text-sm text-ink-500">
          ডাবল অপ্ট-ইন তালিকা। কনফার্ম লিংক না খোলা পর্যন্ত কাউকে ইমেইল যাবে না।
        </p>
      </header>

      {canWrite ? (
        <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <h2 className="text-base font-semibold">Add a subscriber</h2>
          <p className="mt-1 text-xs text-ink-500">
            Record consent, then share the confirmation link. Email delivery connects in a later
            module.
          </p>
          <div className="mt-3">
            <NewsletterForm />
          </div>
        </section>
      ) : null}

      <form
        method="get"
        className="grid gap-2 rounded-2xl bg-white p-3 ring-1 ring-slate-200 sm:grid-cols-[auto_auto]"
      >
        <select
          name="status"
          defaultValue={status}
          className="min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm"
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option} ({countByStatus.get(option) ?? 0})
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="min-h-11 rounded-xl border border-slate-300 px-4 text-sm font-semibold text-ink-700 hover:border-brand-300 hover:text-brand-700"
        >
          Filter
        </button>
      </form>

      <p className="text-xs text-ink-500">
        {subscribers.length} {status.toLowerCase()} address
        {subscribers.length === 1 ? "" : "es"}
        {subscribers.length === 200 ? " (showing the first 200)" : ""}
      </p>

      {subscribers.length === 0 ? (
        <div className="rounded-2xl bg-white p-6 text-center ring-1 ring-slate-200">
          <p className="text-sm font-medium text-ink-700">No addresses in this state.</p>
          <p className="mt-1 text-sm text-ink-500">এই অবস্থায় কোনো সাবস্ক্রাইবার নেই।</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {subscribers.map((subscriber) => (
            <li key={subscriber.id} className="rounded-2xl bg-white p-3 ring-1 ring-slate-200">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="break-all text-sm font-semibold text-ink-900">
                    {subscriber.email}
                  </p>
                  <p className="mt-1 text-xs text-ink-500">
                    {subscriber.customer ? (
                      <>
                        {subscriber.customer.fullName} ·{" "}
                      </>
                    ) : null}
                    {subscriber.source ?? "unknown source"} · added{" "}
                    {dateFormat.format(subscriber.createdAt)}
                    {subscriber.confirmedAt
                      ? ` · confirmed ${dateFormat.format(subscriber.confirmedAt)}`
                      : ""}
                  </p>
                </div>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${statusStyle(subscriber.status)}`}
                >
                  {subscriber.status}
                </span>
              </div>

              {subscriber.status === "PENDING" && subscriber.confirmToken ? (
                <p className="mt-2 break-all rounded-lg bg-slate-50 px-2 py-1 font-mono text-[11px] text-ink-700">
                  <a href={confirmPath(subscriber.confirmToken)} className="underline">
                    {confirmPath(subscriber.confirmToken)}
                  </a>
                </p>
              ) : null}

              {subscriber.consentText ? (
                <p className="mt-2 text-xs text-ink-500">Consent: {subscriber.consentText}</p>
              ) : null}

              {canWrite ? (
                <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                  {subscriber.status !== "UNSUBSCRIBED" ? (
                    <form action={setNewsletterStatusAction}>
                      <input type="hidden" name="id" value={subscriber.id} />
                      <input type="hidden" name="status" value="UNSUBSCRIBED" />
                      <button
                        type="submit"
                        className="min-h-9 rounded-lg border border-slate-300 px-3 text-xs font-medium text-ink-700 hover:border-amber-300 hover:text-amber-800"
                      >
                        Unsubscribe
                      </button>
                    </form>
                  ) : null}

                  {subscriber.status !== "BOUNCED" ? (
                    <form action={setNewsletterStatusAction}>
                      <input type="hidden" name="id" value={subscriber.id} />
                      <input type="hidden" name="status" value="BOUNCED" />
                      <button
                        type="submit"
                        className="min-h-9 rounded-lg border border-red-200 px-3 text-xs font-medium text-red-700 hover:bg-red-50"
                      >
                        Mark bounced
                      </button>
                    </form>
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
