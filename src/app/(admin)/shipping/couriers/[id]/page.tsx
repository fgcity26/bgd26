import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CourierForm } from "@/components/shipping/shipping-forms";
import { ShippingNav } from "@/components/shipping/shipping-nav";
import { getCourierAdapter } from "@/lib/adapters/couriers/registry";
import { requirePagePermission } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

export const metadata: Metadata = {
  title: "Courier",
  robots: { index: false, follow: false },
};

export default async function CourierPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePagePermission("shipment.write");
  const { id } = await params;

  const courier = await prisma.courier.findUnique({
    where: { id },
    select: {
      id: true,
      code: true,
      name: true,
      provider: true,
      apiBaseUrl: true,
      credentialEnvPrefix: true,
      supportsCod: true,
      supportsDropship: true,
      isActive: true,
      _count: { select: { shipments: true } },
    },
  });
  if (!courier) notFound();

  const adapter = getCourierAdapter(courier.provider);

  return (
    <div className="space-y-5">
      <header className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-ink-500">
              Courier · {courier._count.shipments} shipment
              {courier._count.shipments === 1 ? "" : "s"}
            </p>
            <h1 className="text-2xl font-bold tracking-tight">{courier.name}</h1>
          </div>
          <Link
            href="/shipping/couriers"
            className="min-h-10 rounded-xl border border-slate-300 px-4 text-sm font-medium leading-10 text-ink-700 hover:border-brand-300 hover:text-brand-700"
          >
            All couriers
          </Link>
        </div>
        <ShippingNav />
      </header>

      <div
        className={`rounded-2xl px-4 py-3 text-sm ring-1 ${
          adapter.isConfigured()
            ? "bg-brand-50 text-brand-800 ring-brand-200"
            : "bg-amber-50 text-amber-900 ring-amber-200"
        }`}
      >
        {adapter.isConfigured()
          ? "This courier can book shipments through its adapter."
          : "This courier records consignments manually: enter the tracking number when you book. The provider API adapter is not wired yet."}
      </div>

      <section className="max-w-2xl rounded-2xl bg-white p-4 ring-1 ring-slate-200 sm:p-5">
        <CourierForm courier={courier} />
      </section>
    </div>
  );
}
