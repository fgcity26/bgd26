import type { Metadata } from "next";
import Link from "next/link";
import { requirePagePermission } from "@/lib/auth/session";
import { ReviewForm } from "@/components/crm/review-form";
import { prisma } from "@/lib/db";

export const metadata: Metadata = {
  title: "Record a review",
  robots: { index: false, follow: false },
};

export default async function NewReviewPage() {
  await requirePagePermission("review.write");

  const [products, customers] = await Promise.all([
    prisma.product.findMany({
      where: { archivedAt: null, status: { not: "ARCHIVED" } },
      orderBy: { name: "asc" },
      take: 300,
      select: { id: true, name: true },
    }),
    prisma.customer.findMany({
      where: { deletedAt: null, status: "ACTIVE", isWalkInCash: false },
      orderBy: { fullName: "asc" },
      take: 300,
      select: { id: true, fullName: true, mobileNormalized: true },
    }),
  ]);

  return (
    <div className="space-y-5">
      <header>
        <Link href="/reviews" className="text-sm font-medium text-brand-700 hover:underline">
          ← Reviews
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">Record a review</h1>
        <p className="mt-1 text-sm text-ink-500">
          ফোন বা হোয়াটসঅ্যাপে পাওয়া মতামত লিখুন। অনুমোদনের আগে এটি প্রকাশ্যে যাবে না।
        </p>
      </header>

      {products.length === 0 || customers.length === 0 ? (
        <div className="rounded-2xl bg-amber-50 p-4 ring-1 ring-amber-200">
          <p className="text-sm font-semibold text-amber-900">
            {products.length === 0 ? "Create a product first" : "Create a customer first"}
          </p>
          <p className="mt-1 text-sm text-amber-800">
            A review needs both a product and the customer who gave it.
          </p>
          <Link
            href={products.length === 0 ? "/products/new" : "/customers/new"}
            className="mt-3 inline-flex min-h-11 items-center rounded-xl bg-amber-600 px-4 text-sm font-semibold text-white hover:bg-amber-700"
          >
            {products.length === 0 ? "New product" : "New customer"}
          </Link>
        </div>
      ) : (
        <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <ReviewForm products={products} customers={customers} />
        </section>
      )}
    </div>
  );
}
