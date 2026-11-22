import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { setPageStatusAction } from "@/app/actions/pages";
import { PageForm } from "@/components/cms/page-form";
import { hasPermission } from "@/lib/auth/permissions";
import { requirePagePermission } from "@/lib/auth/session";
import { renderMarkdownToHtml } from "@/lib/cms/markdown";
import { prisma } from "@/lib/db";

export const metadata: Metadata = {
  title: "Page",
  robots: { index: false, follow: false },
};

const dateTime = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Dhaka",
});

function statusStyle(status: string): string {
  if (status === "PUBLISHED") return "bg-brand-50 text-brand-700 ring-brand-200";
  if (status === "DRAFT") return "bg-amber-50 text-amber-800 ring-amber-200";
  return "bg-slate-100 text-ink-500 ring-slate-200";
}

export default async function PageDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requirePagePermission("content.read");
  const { id } = await params;

  const page = await prisma.sitePage.findUnique({
    where: { id },
    include: { author: { select: { fullName: true } } },
  });
  if (!page) notFound();

  const canWrite = hasPermission(session, "content.write");
  const canPublish = hasPermission(session, "content.publish");
  const canArchive = hasPermission(session, "content.delete");
  const isArchived = page.status === "ARCHIVED";

  return (
    <div className="space-y-5">
      <header className="space-y-3">
        <Link href="/pages" className="text-sm font-medium text-brand-700 hover:underline">
          ← Pages
        </Link>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight">{page.title}</h1>
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${statusStyle(page.status)}`}
              >
                {page.status}
              </span>
            </div>
            {page.titleBn ? <p className="mt-1 text-sm text-ink-500">{page.titleBn}</p> : null}
            <p className="mt-1 text-xs text-ink-500">
              /p/{page.slug} · {page.pageType} · {page.author?.fullName ?? "Unknown author"}
            </p>
            <p className="mt-1 text-xs text-ink-500">
              Created {dateTime.format(page.createdAt)} · updated{" "}
              {dateTime.format(page.updatedAt)}
              {page.publishedAt ? ` · published ${dateTime.format(page.publishedAt)}` : ""}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {page.status === "PUBLISHED" ? (
              <Link
                href={`/p/${page.slug}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-11 items-center rounded-xl border border-slate-300 px-4 text-sm font-semibold text-ink-700 hover:border-brand-300 hover:text-brand-700"
              >
                View public page
              </Link>
            ) : null}

            {canPublish && !isArchived && page.status !== "PUBLISHED" ? (
              <form action={setPageStatusAction}>
                <input type="hidden" name="id" value={page.id} />
                <input type="hidden" name="action" value="publish" />
                <button
                  type="submit"
                  className="min-h-11 rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700"
                >
                  Publish
                </button>
              </form>
            ) : null}

            {canPublish && page.status === "PUBLISHED" ? (
              <form action={setPageStatusAction}>
                <input type="hidden" name="id" value={page.id} />
                <input type="hidden" name="action" value="unpublish" />
                <button
                  type="submit"
                  className="min-h-11 rounded-xl border border-slate-300 px-4 text-sm font-semibold text-ink-700 hover:border-amber-300 hover:text-amber-800"
                >
                  Unpublish
                </button>
              </form>
            ) : null}

            {canArchive && !isArchived ? (
              <form action={setPageStatusAction}>
                <input type="hidden" name="id" value={page.id} />
                <input type="hidden" name="action" value="archive" />
                <button
                  type="submit"
                  className="min-h-11 rounded-xl border border-red-200 px-4 text-sm font-semibold text-red-700 hover:bg-red-50"
                >
                  Archive
                </button>
              </form>
            ) : null}
          </div>
        </div>
      </header>

      {isArchived ? (
        <p className="rounded-2xl bg-slate-100 px-4 py-3 text-sm text-ink-700 ring-1 ring-slate-200">
          This page is archived and no longer public. Its slug is kept so old links can be
          redirected later.
        </p>
      ) : null}

      {page.excerpt ? (
        <p className="rounded-2xl bg-white px-4 py-3 text-sm text-ink-700 ring-1 ring-slate-200">
          {page.excerpt}
        </p>
      ) : null}

      <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
        <h2 className="text-base font-semibold">Preview</h2>
        <p className="mt-1 text-xs text-ink-500">
          Rendered with the same safe Markdown renderer as the public page.
        </p>
        <div className="mt-3 grid gap-4 lg:grid-cols-2">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-ink-500">English</p>
            <div
              className="prose-bgd26 mt-2 text-[15px] leading-relaxed text-ink-700"
              // Input is escaped by renderMarkdownToHtml before tags are added.
              dangerouslySetInnerHTML={{ __html: renderMarkdownToHtml(page.body) }}
            />
          </div>
          {page.bodyBn ? (
            <div lang="bn">
              <p className="text-xs font-medium uppercase tracking-wide text-ink-500">বাংলা</p>
              <div
                className="prose-bgd26 mt-2 text-[15px] leading-relaxed text-ink-700"
                dangerouslySetInnerHTML={{ __html: renderMarkdownToHtml(page.bodyBn) }}
              />
            </div>
          ) : null}
        </div>
      </section>

      {canWrite && !isArchived ? (
        <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <h2 className="text-base font-semibold">Edit page</h2>
          <div className="mt-3">
            <PageForm
              mode="edit"
              page={{
                id: page.id,
                title: page.title,
                titleBn: page.titleBn,
                slug: page.slug,
                pageType: page.pageType,
                excerpt: page.excerpt,
                body: page.body,
                bodyBn: page.bodyBn,
                seoTitle: page.seoTitle,
                seoDescription: page.seoDescription,
                showInHeader: page.showInHeader,
                showInFooter: page.showInFooter,
                sortOrder: page.sortOrder,
              }}
            />
          </div>
        </section>
      ) : null}
    </div>
  );
}
