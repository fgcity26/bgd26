import type { Metadata } from "next";
import Link from "next/link";
import { Prisma } from "@/generated/prisma/client";
import { hasPermission } from "@/lib/auth/permissions";
import { requirePagePermission } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

export const metadata: Metadata = {
  title: "Pages",
  robots: { index: false, follow: false },
};

const STATUS_OPTIONS = ["ALL", "DRAFT", "PUBLISHED", "ARCHIVED"] as const;
const TYPE_OPTIONS = ["ALL", "STATIC", "POLICY", "FAQ", "LANDING", "BLOG"] as const;

const dateFormat = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeZone: "Asia/Dhaka",
});

function statusStyle(status: string): string {
  if (status === "PUBLISHED") return "bg-brand-50 text-brand-700 ring-brand-200";
  if (status === "DRAFT") return "bg-amber-50 text-amber-800 ring-amber-200";
  return "bg-slate-100 text-ink-500 ring-slate-200";
}

export default async function PagesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; type?: string }>;
}) {
  const session = await requirePagePermission("content.read");
  const canWrite = hasPermission(session, "content.write");

  const params = await searchParams;
  const status = STATUS_OPTIONS.includes(params.status as (typeof STATUS_OPTIONS)[number])
    ? (params.status as (typeof STATUS_OPTIONS)[number])
    : "ALL";
  const type = TYPE_OPTIONS.includes(params.type as (typeof TYPE_OPTIONS)[number])
    ? (params.type as (typeof TYPE_OPTIONS)[number])
    : "ALL";

  const where: Prisma.SitePageWhereInput = {
    ...(status === "ALL" ? {} : { status: status as Prisma.EnumSitePageStatusFilter }),
    ...(type === "ALL" ? {} : { pageType: type as Prisma.EnumSitePageTypeFilter }),
  };

  const [total, pages] = await Promise.all([
    prisma.sitePage.count({ where }),
    prisma.sitePage.findMany({
      where,
      orderBy: [{ sortOrder: "asc" }, { updatedAt: "desc" }],
      take: 200,
      select: {
        id: true,
        slug: true,
        title: true,
        titleBn: true,
        pageType: true,
        status: true,
        showInHeader: true,
        showInFooter: true,
        publishedAt: true,
        updatedAt: true,
        author: { select: { fullName: true } },
      },
    }),
  ]);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Pages</h1>
          <p className="mt-1 text-sm text-ink-500">
            নীতি, সহায়তা ও ব্লগ পাতা। খসড়া আগে, প্রকাশ আলাদা অনুমতিতে।
          </p>
        </div>
        {canWrite ? (
          <Link
            href="/pages/new"
            className="inline-flex min-h-11 items-center rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700"
          >
            New page · নতুন পাতা
          </Link>
        ) : null}
      </header>

      <form
        method="get"
        className="grid gap-2 rounded-2xl bg-white p-3 ring-1 ring-slate-200 sm:grid-cols-[auto_auto_auto]"
      >
        <select
          name="status"
          defaultValue={status}
          className="min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm"
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option === "ALL" ? "All statuses" : option}
            </option>
          ))}
        </select>
        <select
          name="type"
          defaultValue={type}
          className="min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm"
        >
          {TYPE_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option === "ALL" ? "All types" : option}
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
        {total} page{total === 1 ? "" : "s"}
        {pages.length === 200 ? " (showing the first 200)" : ""}
      </p>

      {pages.length === 0 ? (
        <div className="rounded-2xl bg-white p-6 text-center ring-1 ring-slate-200">
          <p className="text-sm font-medium text-ink-700">No pages yet.</p>
          <p className="mt-1 text-sm text-ink-500">প্রথম পাতাটি তৈরি করুন।</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {pages.map((page) => (
            <li key={page.id} className="rounded-2xl bg-white ring-1 ring-slate-200">
              <Link
                href={`/pages/${page.id}`}
                className="block p-3 transition-colors hover:bg-brand-50/40"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink-900">{page.title}</p>
                    {page.titleBn ? (
                      <p className="truncate text-xs text-ink-500">{page.titleBn}</p>
                    ) : null}
                    <p className="mt-1 text-xs text-ink-500">
                      /p/{page.slug} · {page.pageType}
                      {page.showInHeader ? " · header" : ""}
                      {page.showInFooter ? " · footer" : ""}
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${statusStyle(page.status)}`}
                  >
                    {page.status}
                  </span>
                </div>
                <p className="mt-1 text-xs text-ink-500">
                  {page.author?.fullName ?? "Unknown author"} · updated{" "}
                  {dateFormat.format(page.updatedAt)}
                  {page.publishedAt ? ` · published ${dateFormat.format(page.publishedAt)}` : ""}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
