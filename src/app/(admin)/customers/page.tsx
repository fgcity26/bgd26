import type { Metadata } from "next";
import Link from "next/link";
import { Prisma } from "@/generated/prisma/client";
import { hasPermission } from "@/lib/auth/permissions";
import { requirePagePermission } from "@/lib/auth/session";
import { formatBdMobile } from "@/lib/crm/phone";
import { prisma } from "@/lib/db";

export const metadata: Metadata = {
  title: "Customers",
  robots: { index: false, follow: false },
};

const PAGE_SIZE = 25;

const STATUS_OPTIONS = [
  { value: "", label: "Active customers" },
  { value: "BLOCKED", label: "Blocked" },
  { value: "ALL", label: "All (including deleted)" },
] as const;

const dateFormat = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeZone: "Asia/Dhaka",
});

function statusStyle(status: string): string {
  if (status === "ACTIVE") return "bg-brand-50 text-brand-700 ring-brand-200";
  if (status === "MERGED") return "bg-slate-100 text-ink-500 ring-slate-200";
  return "bg-red-50 text-red-700 ring-red-200";
}

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
}) {
  const session = await requirePagePermission("customer.read");
  const canWrite = hasPermission(session, "customer.write");

  const params = await searchParams;
  const query = params.q?.trim() ?? "";
  const status = STATUS_OPTIONS.some((option) => option.value === params.status)
    ? (params.status ?? "")
    : "";
  const page = Math.max(1, Number(params.page) || 1);

  const where: Prisma.CustomerWhereInput = {
    ...(status === "ALL" ? {} : status ? { status: status as Prisma.EnumCustomerStatusFilter } : { status: "ACTIVE" }),
    ...(status === "ALL" ? {} : { deletedAt: null }),
    ...(query
      ? {
          OR: [
            { fullName: { contains: query, mode: "insensitive" } },
            { mobileNormalized: { contains: query.replace(/\D/g, "") } },
            { mobileRaw: { contains: query, mode: "insensitive" } },
            { email: { contains: query, mode: "insensitive" } },
            { tags: { has: query } },
          ],
        }
      : {}),
  };

  const [total, customers] = await Promise.all([
    prisma.customer.count({ where }),
    prisma.customer.findMany({
      where,
      orderBy: [{ lastOrderAt: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        fullName: true,
        mobileNormalized: true,
        mobileRaw: true,
        email: true,
        customerType: true,
        status: true,
        tags: true,
        loyaltyPointsBalance: true,
        lifetimeValue: true,
        totalOrders: true,
        lastOrderAt: true,
        createdAt: true,
        deletedAt: true,
        _count: { select: { addresses: true } },
      },
    }),
  ]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const linkFor = (nextPage: number) => {
    const search = new URLSearchParams();
    if (query) search.set("q", query);
    if (status) search.set("status", status);
    if (nextPage > 1) search.set("page", String(nextPage));
    const suffix = search.toString();
    return suffix ? `/customers?${suffix}` : "/customers";
  };

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Customers</h1>
          <p className="mt-1 text-sm text-ink-500">
            ক্রেতার তালিকা, মোবাইল, ঠিকানা ও পয়েন্ট। মোবাইল নম্বর একটাই পরিচয়।
          </p>
        </div>
        {canWrite ? (
          <Link
            href="/customers/new"
            className="inline-flex min-h-11 items-center rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700"
          >
            New customer · নতুন ক্রেতা
          </Link>
        ) : null}
      </header>

      <form
        method="get"
        className="grid gap-2 rounded-2xl bg-white p-3 ring-1 ring-slate-200 sm:grid-cols-[1fr_auto_auto]"
      >
        <input
          name="q"
          defaultValue={query}
          placeholder="Search name, mobile, email or tag"
          className="min-h-11 rounded-xl border border-slate-300 px-3 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
        />
        <select
          name="status"
          defaultValue={status}
          className="min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm"
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
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
        {total} customer{total === 1 ? "" : "s"} · page {page} of {pages}
      </p>

      {customers.length === 0 ? (
        <div className="rounded-2xl bg-white p-6 text-center ring-1 ring-slate-200">
          <p className="text-sm font-medium text-ink-700">No customers match these filters.</p>
          <p className="mt-1 text-sm text-ink-500">নতুন ক্রেতা যোগ করুন বা ফিল্টার বদলান।</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {customers.map((customer) => (
            <li key={customer.id} className="rounded-2xl bg-white ring-1 ring-slate-200">
              <Link
                href={`/customers/${customer.id}`}
                className="block p-3 transition-colors hover:bg-brand-50/40"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink-900">
                      {customer.fullName}
                      {customer.deletedAt ? (
                        <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-normal text-ink-500">
                          deleted
                        </span>
                      ) : null}
                    </p>
                    <p className="text-xs text-ink-500">
                      {formatBdMobile(customer.mobileNormalized)}
                      {customer.email ? ` · ${customer.email}` : ""}
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${statusStyle(customer.status)}`}
                  >
                    {customer.status}
                  </span>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-500">
                  <span>{customer.customerType}</span>
                  <span>
                    {customer.totalOrders} order{customer.totalOrders === 1 ? "" : "s"}
                  </span>
                  <span>LTV ৳{customer.lifetimeValue.toString()}</span>
                  <span>{customer.loyaltyPointsBalance} points</span>
                  <span>
                    {customer._count.addresses} address
                    {customer._count.addresses === 1 ? "" : "es"}
                  </span>
                  <span>
                    {customer.lastOrderAt
                      ? `last order ${dateFormat.format(customer.lastOrderAt)}`
                      : `added ${dateFormat.format(customer.createdAt)}`}
                  </span>
                </div>

                {customer.tags.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {customer.tags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-ink-700"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}

      {pages > 1 ? (
        <nav className="flex items-center justify-between gap-3" aria-label="Pagination">
          {page > 1 ? (
            <Link
              href={linkFor(page - 1)}
              className="inline-flex min-h-11 items-center rounded-xl border border-slate-300 px-4 text-sm font-medium text-ink-700 hover:border-brand-300"
            >
              Previous
            </Link>
          ) : (
            <span />
          )}
          {page < pages ? (
            <Link
              href={linkFor(page + 1)}
              className="inline-flex min-h-11 items-center rounded-xl border border-slate-300 px-4 text-sm font-medium text-ink-700 hover:border-brand-300"
            >
              Next
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </div>
  );
}
