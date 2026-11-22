import type { Metadata } from "next";
import Link from "next/link";
import { requirePagePermission } from "@/lib/auth/session";
import { PageForm } from "@/components/cms/page-form";

export const metadata: Metadata = {
  title: "New page",
  robots: { index: false, follow: false },
};

export default async function NewPagePage() {
  await requirePagePermission("content.write");

  return (
    <div className="space-y-5">
      <header>
        <Link href="/pages" className="text-sm font-medium text-brand-700 hover:underline">
          ← Pages
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">New page</h1>
        <p className="mt-1 text-sm text-ink-500">
          নতুন পাতা লিখুন। প্রথমে খসড়া হিসেবে সেভ হবে; প্রকাশ করতে আলাদা অনুমতি লাগবে।
        </p>
      </header>

      <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
        <PageForm mode="create" />
      </section>
    </div>
  );
}
