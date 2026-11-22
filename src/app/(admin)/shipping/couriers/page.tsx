import type { Metadata } from "next";
import Link from "next/link";
import { CourierForm } from "@/components/shipping/shipping-forms";
import { ShippingNav } from "@/components/shipping/shipping-nav";
import { getCourierAdapter } from "@/lib/adapters/couriers/registry";
import { hasPermission } from "@/lib/auth/permissions";
import { requirePagePermission } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

export const metadata: Metadata = {
  title: "Couriers",
  robots: { index: false, follow: false },
};

export default async function CouriersPage() {
  const session = await requirePagePermission("shipment.read");
  const canWrite = hasPermission(session, "shipment.write");

  const couriers = await prisma.courier.findMany({
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    select: {
      id: true,
      code: true,
      name: true,
      provider: true,
      supportsCod: true,
      supportsDropship: true,
      isActive: true,
      _count: { select: { shipments: true } },
    },
  });

  return (
    <div className="space-y-5">
      <header className="space-y-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Couriers</h1>
          <p className="mt-1 text-sm text-ink-500">
            কে পার্সেল বহন করে, কে ক্যাশ নেয় আর কোনটির এপিআই তৈরি।
          </p>
        </div>
        <ShippingNav />
      </header>

      <section className="overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200">
        <ul className="divide-y divide-slate-100">
          {couriers.map((courier) => {
            const adapter = getCourierAdapter(courier.provider);
            return (
              <li key={courier.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink-900">
                    <Link href={`/shipping/couriers/${courier.id}`} className="hover:text-brand-700">
                      {courier.name}
                    </Link>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-ink-700">
                      {courier.code}
                    </span>
                    {!courier.isActive ? (
                      <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700 ring-1 ring-red-200">
                        Inactive
                      </span>
                    ) : null}
                  </p>
                  <p className="mt-0.5 text-xs text-ink-500">
                    {courier.provider.replaceAll("_", " ").toLowerCase()} ·{" "}
                    {courier._count.shipments} shipment
                    {courier._count.shipments === 1 ? "" : "s"}
                    {courier.supportsCod ? " · collects COD" : ""}
                    {courier.supportsDropship ? " · dropship" : ""}
                  </p>
                </div>
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${
                    adapter.isConfigured()
                      ? "bg-brand-50 text-brand-700 ring-brand-200"
                      : "bg-amber-50 text-amber-800 ring-amber-200"
                  }`}
                >
                  {adapter.isConfigured() ? "Adapter ready" : "Manual entry only"}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      {canWrite ? (
        <section className="max-w-2xl rounded-2xl bg-white p-4 ring-1 ring-slate-200 sm:p-5">
          <h2 className="text-base font-semibold">Add a courier</h2>
          <p className="mt-1 text-sm text-ink-500">
            A manual courier is usable immediately. Provider adapters need their API
            credentials before they can book automatically.
          </p>
          <div className="mt-4">
            <CourierForm />
          </div>
        </section>
      ) : null}
    </div>
  );
}
