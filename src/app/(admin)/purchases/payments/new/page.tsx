import type { Metadata } from "next";
import Link from "next/link";
import { PurchaseNav } from "@/components/purchasing/purchasing-nav";
import { PaymentForm, type SupplierOption } from "@/components/purchasing/payment-form";
import { requirePagePermission } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { dhakaToday } from "@/lib/accounting/report-dates";
import { SUPPLIER_PAYMENT_METHODS, supplierPayables } from "@/lib/purchasing/settlement";

export const metadata: Metadata = {
  title: "Record supplier payment",
  robots: { index: false, follow: false },
};

export default async function NewSupplierPaymentPage() {
  await requirePagePermission("purchase.approve");

  const [suppliers, payables] = await Promise.all([
    prisma.supplier.findMany({
      where: { status: { not: "BLACKLISTED" } },
      orderBy: { name: "asc" },
      select: { id: true, name: true, code: true },
    }),
    supplierPayables(),
  ]);

  const options: SupplierOption[] = suppliers
    .map((supplier) => ({
      id: supplier.id,
      name: supplier.name,
      code: supplier.code,
      outstanding: (payables.get(supplier.id)?.outstanding ?? 0).toString(),
    }))
    .filter((supplier) => Number(supplier.outstanding) > 0);

  return (
    <div className="space-y-5">
      <header className="space-y-3">
        <Link
          href="/purchases/payments"
          className="text-sm font-medium text-brand-700 hover:underline"
        >
          ← Supplier payments
        </Link>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            Record a payment · পরিশোধ লিখুন
          </h1>
          <p className="mt-1 text-sm text-ink-600">
            Only a supplier with an outstanding balance is listed. The amount cannot exceed
            what is owed, and the entry posts immediately — there is no approval queue for
            money already paid out.
          </p>
        </div>
        <PurchaseNav />
      </header>

      {options.length === 0 ? (
        <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm leading-relaxed text-amber-800 ring-1 ring-amber-200">
          No supplier has an outstanding balance. Post a goods receipt first, or the goods were
          already paid for.
        </p>
      ) : (
        <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <PaymentForm
            suppliers={options}
            today={dhakaToday()}
            methods={SUPPLIER_PAYMENT_METHODS}
          />
        </section>
      )}
    </div>
  );
}
