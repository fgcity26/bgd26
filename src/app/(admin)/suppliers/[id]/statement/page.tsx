import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PurchaseNav } from "@/components/purchasing/purchasing-nav";
import { requirePagePermission } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/inventory/format";
import { supplierPayable, supplierStatement } from "@/lib/purchasing/settlement";

export const metadata: Metadata = {
  title: "Supplier statement",
  robots: { index: false, follow: false },
};

const dateLabel = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeZone: "Asia/Dhaka",
});

export default async function SupplierStatementPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePagePermission("purchase.read");
  const { id } = await params;

  const supplier = await prisma.supplier.findUnique({
    where: { id },
    select: { id: true, code: true, name: true, nameBn: true, status: true },
  });
  if (!supplier) notFound();

  const [rows, payable] = await Promise.all([
    supplierStatement(supplier.id),
    supplierPayable(supplier.id),
  ]);

  return (
    <div className="space-y-5">
      <header className="space-y-3">
        <Link
          href={`/suppliers/${supplier.id}`}
          className="text-sm font-medium text-brand-700 hover:underline"
        >
          ← {supplier.name}
        </Link>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            Supplier statement · সরবরাহকারী হিসাব
          </h1>
          <p className="mt-1 text-sm text-ink-600">
            {supplier.code} · {supplier.name}
            {supplier.nameBn ? ` · ${supplier.nameBn}` : ""}. Every posted entry that touched this
            supplier&apos;s payable, oldest first. A credit is goods received on account; a debit is
            a payment or a return.
          </p>
        </div>
        <PurchaseNav />
      </header>

      <section className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">
            Received on credit
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">
            ৳{formatMoney(payable.invoiced)}
          </p>
        </div>
        <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">
            Paid or returned
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">
            ৳{formatMoney(payable.settled)}
          </p>
        </div>
        <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">
            {payable.outstanding.lessThan(0) ? "Credit with supplier" : "Still owed"}
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">
            ৳{formatMoney(payable.outstanding.abs())}
          </p>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-semibold">Payable movements</h2>
          <p className="text-xs text-ink-500">{rows.length} entr{rows.length === 1 ? "y" : "ies"}</p>
        </div>

        {rows.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-ink-500">
            Nothing has been received on credit from this supplier yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Date</th>
                  <th className="px-4 py-2 font-medium">Entry</th>
                  <th className="px-4 py-2 font-medium">Description</th>
                  <th className="px-4 py-2 text-right font-medium">Debit</th>
                  <th className="px-4 py-2 text-right font-medium">Credit</th>
                  <th className="px-4 py-2 text-right font-medium">Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td className="whitespace-nowrap px-4 py-2 text-ink-600">
                      {dateLabel.format(row.entryDate)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 font-mono text-xs text-ink-500">
                      {row.entryNumber}
                    </td>
                    <td className="px-4 py-2 text-ink-700">{row.description}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums">
                      {row.debit.greaterThan(0) ? `৳${formatMoney(row.debit)}` : "—"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums">
                      {row.credit.greaterThan(0) ? `৳${formatMoney(row.credit)}` : "—"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-right font-medium tabular-nums">
                      ৳{formatMoney(row.balance)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-slate-200 bg-slate-50 font-semibold">
                <tr>
                  <td className="px-4 py-2" colSpan={3}>
                    Closing balance
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    ৳{formatMoney(payable.settled)}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    ৳{formatMoney(payable.invoiced)}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    ৳{formatMoney(payable.outstanding)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>

      <p className="text-xs leading-relaxed text-ink-500">
        This statement is read from the posted journal on account{" "}
        <span className="font-mono">1300 Accounts Payable</span>, filtered to this supplier. It
        cannot drift from the ledger because there is no second copy of the balance.
      </p>
    </div>
  );
}
