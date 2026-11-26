import type { Metadata } from "next";
import Link from "next/link";
import { storageProvider } from "@/lib/adapters/storage";
import { BannerSlotsForm } from "@/components/cms/banner-slots-form";
import { BrandForm } from "@/components/cms/brand-form";
import { HomeContentForm } from "@/components/cms/home-content-form";
import { hasPermission } from "@/lib/auth/permissions";
import { requirePagePermission } from "@/lib/auth/session";
import { getBannerSlots } from "@/lib/storefront/banners";
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
 * Three narrow forms instead of a page builder: the shop logo, the first
 * carousel slide, and the five banners that follow it. Everything else on the
 * home page is derived from the catalogue, so this screen cannot hide a product
 * or invent a category.
 */
export default async function FrontPageEditor() {
  const session = await requirePagePermission("content.read");
  const canWrite = hasPermission(session, "content.write");
  const [content, banners] = await Promise.all([getHomeContent(), getBannerSlots()]);

  // Production uploads straight to Supabase Storage; local development posts to
  // a server action instead, so the editor works without cloud credentials.
  const directUpload = storageProvider() === "supabase";

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Front page</h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-500">
            লোগো, প্রথম ব্যানার ও বাকি পাঁচটি ব্যানার এখান থেকে বদলান। ছয়টি ব্যানার ১০
            সেকেন্ড পর পর ঘুরবে, প্রতিটির উচ্চতা পূর্ণ পর্দার এক-পঞ্চমাংশ। পণ্য, ক্যাটাগরি
            ও নতুন পণ্যের তালিকা নিজে থেকেই বসে।
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
        <h2 className="text-lg font-semibold tracking-tight">Logo and shop name</h2>
        <p className="mt-1 text-sm text-ink-500">
          শপের হেডারে সব পেজে দেখানো হবে। ছবি না দিলে সবুজ অক্ষরের ব্যাজ ব্যবহৃত হবে।
        </p>
        <div className="mt-4">
          <BrandForm
            logoAssetId={content.logoAssetId}
            logoUrl={content.logo?.url ?? null}
            logoText={content.logoText}
            directUpload={directUpload}
            canWrite={canWrite}
          />
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
        <h2 className="text-lg font-semibold tracking-tight">Banner 1 · hero</h2>
        <p className="mt-1 text-sm text-ink-500">
          প্রথম ব্যানারের শিরোনাম, বর্ণনা, দুটি বাটন ও ঐচ্ছিক ছবি। এটি ক্যারোসেলের প্রথম
          স্লাইড।
        </p>
        <div className="mt-4">
          <HomeContentForm content={content} directUpload={directUpload} canWrite={canWrite} />
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
        <h2 className="text-lg font-semibold tracking-tight">Banners 2–6</h2>
        <p className="mt-1 text-sm text-ink-500">
          বাকি পাঁচটি স্লাইড। ছবি, শিরোনাম, ছোট বর্ণনা ও একটি বাটন দিতে পারবেন; খালি স্লট
          বাদ পড়বে।
        </p>
        <div className="mt-4">
          <BannerSlotsForm
            banners={banners}
            directUpload={directUpload}
            canWrite={canWrite}
          />
        </div>
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
          . Archived or unpublished products disappear from the shop immediately, which
          is the point: the front page can never advertise something you no longer sell.
        </p>
      </section>
    </div>
  );
}
