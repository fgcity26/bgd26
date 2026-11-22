import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { renderMarkdownToHtml } from "@/lib/cms/markdown";
import { prisma } from "@/lib/db";

/**
 * Public CMS page.
 *
 * Only PUBLISHED pages are visible. The Markdown renderer escapes all content
 * before emitting its own tags, so stored HTML cannot execute. Drafts and
 * archived pages return 404, which is also what the verification script checks.
 */
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

async function publishedPage(slug: string) {
  return prisma.sitePage.findFirst({
    where: { slug, status: "PUBLISHED" },
    select: {
      slug: true,
      title: true,
      titleBn: true,
      excerpt: true,
      body: true,
      bodyBn: true,
      seoTitle: true,
      seoDescription: true,
      publishedAt: true,
      updatedAt: true,
    },
  });
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const page = await publishedPage(slug);
  if (!page) return { title: "Page not found", robots: { index: false, follow: false } };

  return {
    title: page.seoTitle || page.title,
    description: page.seoDescription || page.excerpt || undefined,
    alternates: { canonical: `/p/${page.slug}` },
    openGraph: {
      title: page.seoTitle || page.title,
      description: page.seoDescription || page.excerpt || undefined,
      type: "article",
    },
  };
}

const dateFormat = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "long",
  timeZone: "Asia/Dhaka",
});

export default async function PublicPage({ params }: Params) {
  const { slug } = await params;
  const page = await publishedPage(slug);
  if (!page) notFound();

  return (
    <div className="min-h-dvh bg-white">
      <header className="border-b border-slate-200">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link href="/" className="flex items-center gap-2">
            <span
              aria-hidden
              className="grid size-9 place-items-center rounded-xl bg-brand-600 text-sm font-bold text-white"
            >
              b
            </span>
            <span className="text-base font-semibold tracking-tight">bgd26</span>
          </Link>
          <span className="text-xs text-ink-500">
            {page.publishedAt ? `Published ${dateFormat.format(page.publishedAt)}` : "Published"}
          </span>
        </div>
      </header>

      <article className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
        <h1 className="text-3xl font-bold tracking-tight">{page.title}</h1>
        {page.titleBn ? <p className="mt-1 text-lg text-ink-500">{page.titleBn}</p> : null}
        {page.excerpt ? <p className="mt-3 text-sm text-ink-500">{page.excerpt}</p> : null}

        <div
          className="prose-bgd26 mt-6 space-y-4 text-[15px] leading-relaxed text-ink-700"
          // Input is escaped by renderMarkdownToHtml before tags are added.
          dangerouslySetInnerHTML={{ __html: renderMarkdownToHtml(page.body) }}
        />

        {page.bodyBn ? (
          <section className="mt-10 border-t border-slate-200 pt-6" lang="bn">
            <div
              className="prose-bgd26 space-y-4 text-[15px] leading-relaxed text-ink-700"
              dangerouslySetInnerHTML={{ __html: renderMarkdownToHtml(page.bodyBn) }}
            />
          </section>
        ) : null}

        <p className="mt-10 text-xs text-ink-500">
          Last updated {dateFormat.format(page.updatedAt)}
        </p>
      </article>
    </div>
  );
}
