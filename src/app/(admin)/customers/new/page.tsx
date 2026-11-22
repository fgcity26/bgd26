import type { Metadata } from "next";
import Link from "next/link";
import { requirePagePermission } from "@/lib/auth/session";
import { CustomerForm } from "@/components/crm/customer-form";

export const metadata: Metadata = {
  title: "New customer",
  robots: { index: false, follow: false },
};

export default async function NewCustomerPage() {
  await requirePagePermission("customer.write");

  return (
    <div className="space-y-5">
      <header>
        <Link href="/customers" className="text-sm font-medium text-brand-700 hover:underline">
          ← Customers
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">New customer</h1>
        <p className="mt-1 text-sm text-ink-500">
          নতুন ক্রেতা যোগ করুন। মোবাইল নম্বর একবারই সংরক্ষিত হবে—ডুপ্লিকেট তৈরি হবে না।
        </p>
      </header>

      <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
        <CustomerForm mode="create" />
      </section>
    </div>
  );
}
