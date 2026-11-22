import type { Metadata } from "next";
import Link from "next/link";
import { PosNav } from "@/components/pos/pos-nav";
import { PosTerminal } from "@/components/pos/pos-terminal";
import { hasPermission } from "@/lib/auth/permissions";
import { requirePagePermission } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

export const metadata: Metadata = {
  title: "POS till",
  robots: { index: false, follow: false },
};

export default async function PosPage() {
  const session = await requirePagePermission("pos.read");
  const canWrite = hasPermission(session, "pos.write");
  const canApprove = hasPermission(session, "pos.approve");

  const [devices, shifts] = await Promise.all([
    prisma.posDevice.findMany({
      where: { status: "ACTIVE" },
      orderBy: { code: "asc" },
      select: {
        id: true,
        code: true,
        name: true,
        warehouseId: true,
        store: { select: { name: true } },
        warehouse: { select: { code: true } },
      },
    }),
    prisma.posShift.findMany({
      where: { status: "OPEN" },
      orderBy: { openedAt: "desc" },
      select: { id: true, shiftNumber: true, deviceId: true, openingFloat: true },
    }),
  ]);

  return (
    <div className="space-y-5">
      <header className="space-y-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Counter till</h1>
          <p className="mt-1 text-sm text-ink-500">
            দোকানের কাউন্টার। দাম, ভ্যাট ও মোট সার্ভারে আবার হিসাব হয় — অনলাইন বা অফলাইন।
          </p>
        </div>
        <PosNav />
      </header>

      {devices.length === 0 ? (
        <div className="rounded-2xl bg-white p-5 text-sm text-ink-600 shadow-sm ring-1 ring-slate-200">
          <p className="font-medium text-ink-800">No POS device is registered yet.</p>
          <p className="mt-1">
            Register the counter first, then open a shift and start selling.
          </p>
          {canApprove ? (
            <Link
              href="/pos/devices"
              className="mt-3 inline-flex min-h-11 items-center rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700"
            >
              Register a device
            </Link>
          ) : (
            <p className="mt-2 text-xs text-ink-500">
              Ask a manager to register the counter in Devices.
            </p>
          )}
        </div>
      ) : !canWrite ? (
        <div className="rounded-2xl bg-white p-5 text-sm text-ink-600 shadow-sm ring-1 ring-slate-200">
          You can view the till, but selling needs the <code>pos.write</code> permission.
        </div>
      ) : (
        <PosTerminal
          devices={devices.map((device) => ({
            id: device.id,
            code: device.code,
            name: device.name,
            storeName: device.store.name,
            warehouseId: device.warehouseId,
            warehouseCode: device.warehouse.code,
          }))}
          shifts={shifts.map((shift) => ({
            id: shift.id,
            shiftNumber: shift.shiftNumber,
            deviceId: shift.deviceId,
            openingFloat: shift.openingFloat.toString(),
          }))}
        />
      )}
    </div>
  );
}
