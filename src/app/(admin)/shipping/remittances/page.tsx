import type { Metadata } from "next";
import Link from "next/link";
import { RemittanceForm } from "@/components/shipping/shipping-forms";
import { ShippingNav } from "@/components/shipping/shipping-nav";
import { hasPermission } from "@/lib/auth/permissions";
import { requirePagePermission } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/inventory/format";

export const metadata: Metadata = {
  title: "COD remittance",
  robots: { index: false, follow: false },
};

const date = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeZone: "Asia/Dhaka",
});

export default async function RemittancesPage() {
  const session = await requirePagePermission("shipment.read");
  const canApprove = hasPermission(session, "shipment.approve");

  const [couriers, verifiedCod, remittances] = await Promise.all([
    prisma.courier.findMany({
      where: { isActive: true, supportsCod: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.payment.aggregate({
      where: { method: "COD", status: "PAID" },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    prisma.journalEntry.findMany({
      where: { referenceType: "cod_remittance", status: "POSTED" },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        entryNumber: true,
        entryDate: true,
        description: true,
        totalDebit: true,
        createdBy: { select: { fullName: true } },
      },
    }),
  ]);

  const remitted = remittances.reduce(
    (sum, entry) => sum + Number(entry.totalDebit),
    0,
  );

  return (
    <div className="space-y-5">
      <header className="space-y-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">COD remittance</h1>
          <p className="mt-1 text-sm text-ink-500">
            কুরিয়ার যে নগদ টাকা ফেরত দেয়, তা কুরিয়ার সিওডি খাতা থেকে ব্যাংক বা
            ড্রয়ারে নেওয়া হয়।
          </p>
        </div>
        <ShippingNav />
      </header>

      <section className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">
            Verified COD
          </p>
          <p className="mt-1 text-2xl font-semibold">
            ৳{formatMoney(verifiedCod._sum.amount ?? 0)}
          </p>
          <p className="mt-1 text-xs text-ink-500">
            {verifiedCod._count._all} payment{verifiedCod._count._all === 1 ? "" : "s"}
          </p>
        </div>
        <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">
            Remitted (recent)
          </p>
          <p className="mt-1 text-2xl font-semibold">৳{formatMoney(remitted)}</p>
          <p className="mt-1 text-xs text-ink-500">
            Last {remittances.length} remittance{remittances.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">
            Still with courier
          </p>
          <p className="mt-1 text-2xl font-semibold">
            ৳{formatMoney(Math.max(0, Number(verifiedCod._sum.amount ?? 0) - remitted))}
          </p>
          <p className="mt-1 text-xs text-ink-500">Verified but not yet paid over</p>
        </div>
      </section>

      {canApprove ? (
        <section className="max-w-2xl rounded-2xl bg-white p-4 ring-1 ring-slate-200 sm:p-5">
          <h2 className="text-base font-semibold">Record a remittance</h2>
          <p className="mt-1 text-sm text-ink-500">
            Verify the individual COD payments in{" "}
            <Link href="/payments" className="font-medium text-brand-700 hover:underline">
              Payments
            </Link>{" "}
            first. This entry debits cash or bank and credits 1060 Courier COD Clearing.
          </p>
          <div className="mt-4">
            <RemittanceForm couriers={couriers} />
          </div>
        </section>
      ) : (
        <p className="rounded-xl bg-slate-100 px-4 py-3 text-sm text-ink-700">
          Recording a remittance needs <code>shipment.approve</code>.
        </p>
      )}

      <section className="overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200">
        <h2 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold">
          Recent remittances
        </h2>
        {remittances.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-ink-500">
            No COD remittance has been recorded yet.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {remittances.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink-900">
                    {entry.description}
                  </p>
                  <p className="text-xs text-ink-500">
                    {entry.entryNumber} · {date.format(entry.entryDate)} ·{" "}
                    {entry.createdBy?.fullName ?? "system"}
                  </p>
                </div>
                <Link
                  href={`/accounting/journals/${entry.id}`}
                  className="text-sm font-semibold text-brand-700 hover:underline"
                >
                  ৳{formatMoney(entry.totalDebit)}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
