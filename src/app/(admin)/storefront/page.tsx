import type { Metadata } from "next";
import Link from "next/link";
import { HomeContentForm } from "@/components/cms/home-content-form";
import { hasPermission } from "@/lib/auth/permissions";
import { requirePagePermission } from "@/lib/auth/session";
import { getHomeContent } from "@/lib/storefront/home-content";

export const metadata: Metadata = {
  title: "Front page",
  robots: { index: false, follow: false },
};

// The editor always shows what is stored, never a cached copy.
export const dynamic = "force-dynamic";

/**
 * The front-page editor.
 *
 * Deliberately narrow: the banner copy, its two buttons and the trust chips.
 * Everything else on the home page is derived from the catalogue, so this screen
 * cannot hide a product or invent a category.
 */
export default async function FrontPageEditor() {
  const session = await requirePagePermission("content.read");
  const canWrite = hasPermission(session, "content.write");
  const content = await getHomeContent();

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Front page</h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-500">
            প্রথম পাতার ব্যানার, দুটি বাটন ও সুবিধার কথাগুলো এখান থেকে বদলান। পণ্য,
            ক্যাটাগরি ও নতুন পণ্যের তালিকা নিজে থেকেই বসে।
          </p>
        </div>
        <Link
          href="/"
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-10 items-center rounded-xl border border-slate-300 px-4 text-sm font-medium text-ink-700 hover:border-brand-300 hover:text-brand-700"
        >
          Open the shop ↗
        </Link>
      </header>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
        <HomeContentForm content={content} canWrite={canWrite} />
      </section>

      <section className="rounded-2xl border border-dashed border-slate-300 p-4 text-sm text-ink-600">
        <p className="font-medium text-ink-900">What stays automatic</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>
            <span className="font-medium">Categories</span> — shown when at least one
            published product uses them.
          </li>
          <li>
            <span className="font-medium">Featured</span> — products with “Featured”
            ticked in the product form, in catalogue order.
          </li>
          <li>
            <span className="font-medium">New arrivals</span> — the four newest published
            products.
          </li>
        </ul>
        <p className="mt-3">
          To change those, edit the products themselves under{" "}
          <Link href="/products" className="font-medium text-brand-700 hover:underline">
            Products
          </Link>
          . Archived or unpublished products disappear from the shop immediately, which is
          the point: the front page can never advertise something you no longer sell.
        </p>
      </section>
    </div>
  );
}
