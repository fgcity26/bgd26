import type { Metadata } from "next";
import { DeviceForm } from "@/components/pos/device-form";
import { PosNav } from "@/components/pos/pos-nav";
import { hasPermission } from "@/lib/auth/permissions";
import { requirePagePermission } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

export const metadata: Metadata = {
  title: "POS devices",
  robots: { index: false, follow: false },
};

const dateTime = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Dhaka",
});

export default async function PosDevicesPage() {
  const session = await requirePagePermission("pos.read");
  const canApprove = hasPermission(session, "pos.approve");

  const [devices, stores, warehouses] = await Promise.all([
    prisma.posDevice.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        code: true,
        name: true,
        platform: true,
        status: true,
        lastSeenAt: true,
        createdAt: true,
        store: { select: { name: true } },
        warehouse: { select: { code: true, name: true } },
        _count: { select: { shifts: true, orders: true } },
      },
    }),
    prisma.store.findMany({
      where: { isActive: true },
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true },
    }),
    prisma.warehouse.findMany({
      where: { isActive: true },
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true },
    }),
  ]);

  return (
    <div className="space-y-5">
      <header className="space-y-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">POS devices</h1>
          <p className="mt-1 text-sm text-ink-500">
            প্রতিটি কাউন্টার একটি ডিভাইস। স্টক কোন গুদাম থেকে কমবে তা এখানেই ঠিক হয়।
          </p>
        </div>
        <PosNav />
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <h2 className="text-sm font-semibold">Registered devices</h2>
          {devices.length === 0 ? (
            <p className="mt-3 text-sm text-ink-500">No device yet.</p>
          ) : (
            <ul className="mt-3 divide-y divide-slate-100">
              {devices.map((device) => (
                <li key={device.id} className="py-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold">
                        {device.code} · {device.name}
                      </p>
                      <p className="text-xs text-ink-500">
                        {device.store.name} · stock from {device.warehouse.code} ·{" "}
                        {device.platform ?? "unknown platform"}
                      </p>
                      <p className="text-xs text-ink-500">
                        {device._count.shifts} shifts · {device._count.orders} sales · registered{" "}
                        {dateTime.format(device.createdAt)}
                      </p>
                    </div>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${
                        device.status === "ACTIVE"
                          ? "bg-brand-50 text-brand-700 ring-brand-200"
                          : "bg-slate-100 text-ink-500 ring-slate-200"
                      }`}
                    >
                      {device.status}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <h2 className="text-sm font-semibold">Register a device</h2>
          {canApprove ? (
            <div className="mt-3">
              <DeviceForm stores={stores} warehouses={warehouses} />
            </div>
          ) : (
            <p className="mt-3 text-sm text-ink-500">
              A manager with <code>pos.approve</code> registers devices.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
