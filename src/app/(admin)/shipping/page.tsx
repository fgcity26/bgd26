import type { Metadata } from "next";
import Link from "next/link";
import { ShippingNav } from "@/components/shipping/shipping-nav";
import { hasPermission } from "@/lib/auth/permissions";
import { requirePagePermission } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/inventory/format";
import { SHIPMENT_STATUS_LABELS } from "@/lib/shipping/service";

export const metadata: Metadata = {
  title: "Shipments",
  robots: { index: false, follow: false },
};

const dateTime = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Dhaka",
});

const STATUSES = [
  "PENDING",
  "BOOKED",
  "PICKED_UP",
  "IN_TRANSIT",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "RETURNED",
  "CANCELLED",
  "FAILED",
] as const;

function statusStyle(status: string): string {
  if (status === "DELIVERED") return "bg-brand-50 text-brand-700 ring-brand-200";
  if (status === "CANCELLED" || status === "FAILED" || status === "RETURNED") {
    return "bg-red-50 text-red-800 ring-red-200";
  }
  if (status === "PENDING") return "bg-slate-100 text-ink-700 ring-slate-200";
  return "bg-amber-50 text-amber-800 ring-amber-200";
}

export default async function ShipmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  const session = await requirePagePermission("shipment.read");
  const canWrite = hasPermission(session, "shipment.write");
  const { status, q } = await searchParams;
  const activeStatus = STATUSES.includes(status as (typeof STATUSES)[number])
    ? (status as (typeof STATUSES)[number])
    : null;
  const search = q?.trim() ?? "";

  const [shipments, counts, readyCount, openCod] = await Promise.all([
    prisma.shipment.findMany({
      where: {
        ...(activeStatus ? { status: activeStatus } : {}),
        ...(search
          ? {
              OR: [
                { shipmentNumber: { contains: search, mode: "insensitive" } },
                { trackingNumber: { contains: search, mode: "insensitive" } },
                { recipientName: { contains: search, mode: "insensitive" } },
                { recipientMobile: { contains: search } },
                { order: { orderNumber: { contains: search, mode: "insensitive" } } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        shipmentNumber: true,
        status: true,
        trackingNumber: true,
        codAmount: true,
        recipientName: true,
        recipientMobile: true,
        createdAt: true,
        deliveredAt: true,
        order: { select: { id: true, orderNumber: true } },
        courier: { select: { name: true } },
      },
    }),
    prisma.shipment.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.order.count({ where: { status: "READY_TO_SHIP" } }),
    prisma.shipment.aggregate({
      where: {
        status: { notIn: ["DELIVERED", "CANCELLED", "RETURNED", "FAILED"] },
      },
      _sum: { codAmount: true },
    }),
  ]);

  const byStatus = new Map(counts.map((row) => [row.status, row._count._all]));
  const open = counts
    .filter((row) => !["DELIVERED", "CANCELLED", "RETURNED", "FAILED"].includes(row.status))
    .reduce((sum, row) => sum + row._count._all, 0);

  return (
    <div className="space-y-5">
      <header className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Shipments</h1>
            <p className="mt-1 text-sm text-ink-500">
              কুরিয়ারে দেওয়া চালান, ট্র্যাকিং ও ক্যাশ অন ডেলিভারির হিসাব।
            </p>
          </div>
          {canWrite ? (
            <Link
              href="/shipping/new"
              className="inline-flex min-h-10 items-center rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700"
            >
              Book a shipment
            </Link>
          ) : null}
        </div>
        <ShippingNav />
      </header>

      <section className="grid gap-3 sm:grid-cols-4">
        <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Open</p>
          <p className="mt-1 text-2xl font-semibold">{open}</p>
        </div>
        <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Delivered</p>
          <p className="mt-1 text-2xl font-semibold">{byStatus.get("DELIVERED") ?? 0}</p>
        </div>
        <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">
            Ready to ship
          </p>
          <p className="mt-1 text-2xl font-semibold">{readyCount}</p>
        </div>
        <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">
            COD in transit
          </p>
          <p className="mt-1 text-2xl font-semibold">
            ৳{formatMoney(openCod._sum.codAmount ?? 0)}
          </p>
        </div>
      </section>

      <form className="flex flex-wrap items-end gap-2" method="get">
        <label className="block text-xs font-medium text-ink-700">
          Search
          <input
            name="q"
            defaultValue={search}
            placeholder="Shipment, tracking, order or mobile"
            className="mt-1 block min-h-10 w-64 rounded-xl border border-slate-300 bg-white px-3 text-sm"
          />
        </label>
        <label className="block text-xs font-medium text-ink-700">
          Status
          <select
            name="status"
            defaultValue={activeStatus ?? ""}
            className="mt-1 block min-h-10 rounded-xl border border-slate-300 bg-white px-3 text-sm"
          >
            <option value="">All</option>
            {STATUSES.map((value) => (
              <option key={value} value={value}>
                {SHIPMENT_STATUS_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="min-h-10 rounded-xl bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700"
        >
          Filter
        </button>
        {activeStatus || search ? (
          <Link href="/shipping" className="min-h-10 px-3 text-sm leading-10 text-ink-500 hover:text-brand-700">
            Clear
          </Link>
        ) : null}
      </form>

      <section className="overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200">
        {shipments.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-ink-500">
            No shipment matches this view.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {shipments.map((shipment) => (
              <li key={shipment.id} className="px-4 py-3">
                <Link href={`/shipping/${shipment.id}`} className="flex flex-wrap items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink-900">
                      {shipment.shipmentNumber}
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${statusStyle(shipment.status)}`}
                      >
                        {SHIPMENT_STATUS_LABELS[shipment.status]}
                      </span>
                    </p>
                    <p className="mt-0.5 truncate text-xs text-ink-500">
                      {shipment.order.orderNumber} · {shipment.recipientName} ·{" "}
                      {shipment.recipientMobile}
                      {shipment.trackingNumber ? ` · ${shipment.trackingNumber}` : ""}
                    </p>
                  </div>
                  <div className="text-right text-xs text-ink-500">
                    <p className="font-medium text-ink-700">
                      {shipment.codAmount.greaterThan(0)
                        ? `COD ৳${formatMoney(shipment.codAmount)}`
                        : "No COD"}
                    </p>
                    <p>
                      {shipment.courier?.name ?? "Manual"} ·{" "}
                      {dateTime.format(shipment.deliveredAt ?? shipment.createdAt)}
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
