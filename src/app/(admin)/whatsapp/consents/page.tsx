import type { Metadata } from "next";
import Link from "next/link";
import { recordWhatsappConsentAction } from "@/app/actions/whatsapp";
import { hasPermission } from "@/lib/auth/permissions";
import { requirePagePermission } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { formatBdMobile } from "@/lib/crm/phone";

export const metadata: Metadata = {
  title: "WhatsApp consent",
  robots: { index: false, follow: false },
};

const when = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Dhaka",
});

const STATUS_STYLE: Record<string, string> = {
  OPTED_IN: "bg-brand-50 text-brand-700 ring-brand-200",
  OPTED_OUT: "bg-red-50 text-red-700 ring-red-200",
};

type Search = { q?: string; ok?: string; error?: string };

export default async function WhatsappConsentsPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const session = await requirePagePermission("whatsapp.read");
  const params = await searchParams;
  const canWrite = hasPermission(session, "whatsapp.write");
  const q = (params.q ?? "").trim();

  const where = q
    ? {
        OR: [
          { phoneNumberNormalized: { contains: q.replace(/\D/g, "") } },
          { customer: { fullName: { contains: q, mode: "insensitive" as const } } },
        ],
      }
    : {};

  const [consents, counts, customers] = await Promise.all([
    prisma.whatsappConsent.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take: 60,
      select: {
        id: true,
        status: true,
        source: true,
        optedInAt: true,
        optedOutAt: true,
        updatedAt: true,
        phoneNumberNormalized: true,
        customer: {
          select: { id: true, fullName: true, mobileNormalized: true, totalOrders: true },
        },
      },
    }),
    prisma.whatsappConsent.groupBy({
      by: ["status"],
      _count: { _all: true },
    }),
    prisma.customer.count({ where: { deletedAt: null, isWalkInCash: false } }),
  ]);

  const countFor = (status: string) =>
    counts.find((entry) => entry.status === status)?._count._all ?? 0;
  const withConsent = counts.reduce((sum, entry) => sum + entry._count._all, 0);

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

      <section className="grid gap-3 sm:grid-cols-3">
        {[
          { label: "Opted in", value: countFor("OPTED_IN"), tone: "text-brand-700" },
          { label: "Opted out", value: countFor("OPTED_OUT"), tone: "text-red-700" },
          {
            label: "No consent on file",
            value: Math.max(customers - withConsent, 0),
            tone: "text-ink-600",
          },
        ].map((card) => (
          <div key={card.label} className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
            <p className="text-xs uppercase tracking-wide text-ink-500">{card.label}</p>
            <p className={`mt-1 text-2xl font-bold ${card.tone}`}>{card.value}</p>
          </div>
        ))}
      </section>

      <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
        <h2 className="text-sm font-semibold">Record consent · সম্মতি</h2>
        <p className="mt-1 text-xs text-ink-500">
          Only order updates are sent automatically, and only to an opted-in number. An online
          checkout records consent for you; POS and admin orders need it recorded here. An explicit
          opt-out always wins and is never overwritten by a later order.
        </p>

        <form action={recordWhatsappConsentAction} className="mt-3 grid gap-3 sm:grid-cols-3">
          <label className="text-xs font-medium text-ink-700">
            Customer mobile
            <input
              name="mobile"
              required
              inputMode="tel"
              placeholder="01712345678"
              className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-400"
            />
          </label>
          <label className="text-xs font-medium text-ink-700">
            Decision
            <select
              name="status"
              defaultValue="OPTED_IN"
              className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-400"
            >
              <option value="OPTED_IN">Opted in</option>
              <option value="OPTED_OUT">Opted out</option>
            </select>
          </label>
          <label className="text-xs font-medium text-ink-700">
            Source
            <input
              name="source"
              maxLength={60}
              defaultValue="staff"
              placeholder="phone_call, shop_visit, staff"
              className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-400"
            />
          </label>
          <div className="sm:col-span-3">
            {canWrite ? (
              <button className="min-h-9 rounded-lg bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700">
                Save consent
              </button>
            ) : (
              <p className="text-xs text-ink-500">Recording consent needs `whatsapp.write`.</p>
            )}
          </div>
        </form>
        {canWrite ? (
          <p className="mt-2 text-[11px] text-ink-500">
            The customer must already exist — find or create them in{" "}
            <Link href="/customers" className="font-medium text-brand-700 hover:underline">
              Customers
            </Link>
            . A STOP reply from WhatsApp opts them out automatically.
          </p>
        ) : null}
      </section>

      <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
        <form className="flex flex-wrap items-end gap-2">
          <label className="text-xs font-medium text-ink-700">
            Search
            <input
              name="q"
              defaultValue={q}
              placeholder="Mobile or customer name"
              className="mt-1 w-56 rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-400"
            />
          </label>
          <button className="min-h-9 rounded-lg border border-slate-300 px-3 text-sm font-medium hover:border-brand-300">
            Filter
          </button>
          {q ? (
            <Link
              href="/whatsapp/consents"
              className="min-h-9 rounded-lg px-3 py-2 text-sm text-ink-500 hover:text-ink-900"
            >
              Clear
            </Link>
          ) : null}
        </form>
      </section>

      <section className="overflow-x-auto rounded-2xl bg-white ring-1 ring-slate-200">
        <table className="min-w-full text-left text-xs">
          <thead className="bg-slate-50 text-ink-500">
            <tr>
              <th className="px-3 py-2 font-medium">Customer</th>
              <th className="px-3 py-2 font-medium">Number</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Source</th>
              <th className="px-3 py-2 font-medium">In / out</th>
              <th className="px-3 py-2 font-medium">Updated</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {consents.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-sm text-ink-500">
                  {q ? "No consent records match that search." : "No consent recorded yet."}
                </td>
              </tr>
            ) : (
              consents.map((entry) => (
                <tr key={entry.id} className="align-top">
                  <td className="px-3 py-2">
                    <Link
                      href={`/customers/${entry.customer.id}`}
                      className="font-medium text-brand-700 hover:underline"
                    >
                      {entry.customer.fullName}
                    </Link>
                    <span className="block text-[11px] text-ink-500">
                      {entry.customer.totalOrders} order(s)
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-ink-700">
                    {formatBdMobile(entry.phoneNumberNormalized)}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-[10px] ring-1 ${
                        STATUS_STYLE[entry.status] ?? STATUS_STYLE.OPTED_IN
                      }`}
                    >
                      {entry.status === "OPTED_IN" ? "opted in" : "opted out"}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-ink-600">
                    {entry.source ? entry.source.replaceAll("_", " ") : "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-ink-500">
                    {entry.optedInAt ? `in ${when.format(entry.optedInAt)}` : null}
                    {entry.optedInAt && entry.optedOutAt ? <br /> : null}
                    {entry.optedOutAt ? `out ${when.format(entry.optedOutAt)}` : null}
                    {!entry.optedInAt && !entry.optedOutAt ? "—" : null}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-ink-500">
                    {when.format(entry.updatedAt)}
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
