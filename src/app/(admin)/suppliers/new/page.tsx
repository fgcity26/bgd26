import type { Metadata } from "next";
import Link from "next/link";
import { SupplierForm } from "@/components/purchasing/supplier-form";
import { PurchaseNav } from "@/components/purchasing/purchasing-nav";
import { requirePagePermission } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "New supplier",
  robots: { index: false, follow: false },
};

export default async function NewSupplierPage() {
  await requirePagePermission("purchase.write");

  return (
    <div className="space-y-5">
      <header className="space-y-3">
        <Link href="/suppliers" className="text-sm font-medium text-brand-700 hover:underline">
          ← Suppliers
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">New supplier</h1>
          <p className="mt-1 text-sm text-ink-500">
            নতুন সরবরাহকারী যোগ করুন। কোড খালি রাখলে সিস্টেম তৈরি করবে।
          </p>
        </div>
        <PurchaseNav />
      </header>

      <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
        <SupplierForm />
      </section>
    </div>
  );
}
