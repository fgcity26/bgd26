import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  CancelShipmentForm,
  TrackingEventForm,
} from "@/components/shipping/shipping-forms";
import { ShippingNav } from "@/components/shipping/shipping-nav";
import { hasPermission } from "@/lib/auth/permissions";
import { requirePagePermission } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/inventory/format";
import { SHIPMENT_STATUS_LABELS } from "@/lib/shipping/service";

export const metadata: Metadata = {
  title: "Shipment",
  robots: { index: false, follow: false },
};

const dateTime = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Dhaka",
});

function statusStyle(status: string): string {
  if (status === "DELIVERED") return "bg-brand-50 text-brand-700 ring-brand-200";
  if (status === "CANCELLED" || status === "FAILED" || status === "RETURNED") {
    return "bg-red-50 text-red-800 ring-red-200";
  }
  if (status === "PENDING") return "bg-slate-100 text-ink-700 ring-slate-200";
  return "bg-amber-50 text-amber-800 ring-amber-200";
}

function addressText(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const address = value as Record<string, unknown>;
  return [address.address, address.upazila, address.district, address.division]
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .join(", ");
}

export default async function ShipmentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requirePagePermission("shipment.read");
  const canWrite = hasPermission(session, "shipment.write");
  const canApprove = hasPermission(session, "shipment.approve");
  const { id } = await params;

  const shipment = await prisma.shipment.findUnique({
    where: { id },
    select: {
      id: true,
      shipmentNumber: true,
      status: true,
      trackingNumber: true,
      consignmentId: true,
      recipientName: true,
      recipientMobile: true,
      deliveryAddress: true,
      codAmount: true,
      deliveryCharge: true,
      shippedAt: true,
      deliveredAt: true,
      expectedAt: true,
      createdAt: true,
      order: {
        select: {
          id: true,
          orderNumber: true,
          status: true,
          paymentStatus: true,
          grandTotal: true,
          paidAmount: true,
          dueAmount: true,
        },
      },
      courier: { select: { id: true, name: true, provider: true } },
      warehouse: { select: { name: true } },
      createdBy: { select: { fullName: true } },
      trackingEvents: {
        orderBy: { eventAt: "asc" },
        select: {
          id: true,
          status: true,
          message: true,
          location: true,
          eventAt: true,
        },
      },
    },
  });
  if (!shipment) notFound();

  const closed = ["CANCELLED", "RETURNED", "FAILED"].includes(shipment.status);
  const cancellable = ["PENDING", "BOOKED"].includes(shipment.status);
  const address = addressText(shipment.deliveryAddress);

  return (
    <div className="space-y-5">
      <header className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-ink-500">
              Shipment
            </p>
            <h1 className="text-2xl font-bold tracking-tight">{shipment.shipmentNumber}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-500">
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${statusStyle(shipment.status)}`}
              >
                {SHIPMENT_STATUS_LABELS[shipment.status]}
              </span>
              <Link
                href={`/orders/${shipment.order.id}`}
                className="font-medium text-brand-700 hover:underline"
              >
                {shipment.order.orderNumber}
              </Link>
              · {shipment.courier?.name ?? "Manual delivery"}
            </p>
          </div>
          <Link
            href="/shipping"
            className="min-h-10 rounded-xl border border-slate-300 px-4 text-sm font-medium leading-10 text-ink-700 hover:border-brand-300 hover:text-brand-700"
          >
            All shipments
          </Link>
        </div>
        <ShippingNav />
      </header>

      <section className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-4">
          <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
            <h2 className="text-sm font-semibold">Consignment</h2>
            <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs text-ink-500">Recipient</dt>
                <dd className="font-medium">{shipment.recipientName}</dd>
                <dd className="text-ink-500">{shipment.recipientMobile}</dd>
              </div>
              <div>
                <dt className="text-xs text-ink-500">Courier</dt>
                <dd className="font-medium">{shipment.courier?.name ?? "Manual delivery"}</dd>
                <dd className="text-ink-500">
                  {shipment.trackingNumber ?? "No tracking number yet"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-ink-500">Cash on delivery</dt>
                <dd className="font-medium">৳{formatMoney(shipment.codAmount)}</dd>
                <dd className="text-ink-500">
                  Order due ৳{formatMoney(shipment.order.dueAmount)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-ink-500">Delivery charge</dt>
                <dd className="font-medium">৳{formatMoney(shipment.deliveryCharge)}</dd>
              </div>
              <div>
                <dt className="text-xs text-ink-500">Expected</dt>
                <dd className="font-medium">
                  {shipment.expectedAt ? dateTime.format(shipment.expectedAt) : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-ink-500">Warehouse</dt>
                <dd className="font-medium">{shipment.warehouse?.name ?? "—"}</dd>
              </div>
            </dl>
            {address ? (
              <p className="mt-3 border-t border-slate-100 pt-3 text-sm text-ink-700">
                {address}
              </p>
            ) : null}
            <p className="mt-3 text-xs text-ink-500">
              Booked by {shipment.createdBy?.fullName ?? "staff"} ·{" "}
              {dateTime.format(shipment.createdAt)}
              {shipment.shippedAt ? ` · shipped ${dateTime.format(shipment.shippedAt)}` : ""}
              {shipment.deliveredAt
                ? ` · delivered ${dateTime.format(shipment.deliveredAt)}`
                : ""}
            </p>
          </div>

          <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
            <h2 className="text-sm font-semibold">Tracking</h2>
            <ol className="mt-3 space-y-3">
              {shipment.trackingEvents.map((event) => (
                <li key={event.id} className="flex gap-3">
                  <span
                    aria-hidden
                    className={`mt-1 size-2.5 shrink-0 rounded-full ${
                      event.status === "DELIVERED"
                        ? "bg-brand-500"
                        : event.status === "CANCELLED" ||
                            event.status === "FAILED" ||
                            event.status === "RETURNED"
                          ? "bg-red-500"
                          : "bg-amber-500"
                    }`}
                  />
                  <div>
                    <p className="text-sm font-medium">
                      {SHIPMENT_STATUS_LABELS[event.status]}
                      {event.location ? ` · ${event.location}` : ""}
                    </p>
                    <p className="text-xs text-ink-500">
                      {dateTime.format(event.eventAt)}
                      {event.message ? ` · ${event.message}` : ""}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>

        <div className="space-y-4">
          {canWrite && !closed ? (
            <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
              <h2 className="text-sm font-semibold">Add a tracking event</h2>
              <p className="mt-1 text-xs text-ink-500">
                A pickup or transit event marks the order shipped; delivered marks it
                delivered.
              </p>
              <div className="mt-3">
                <TrackingEventForm shipmentId={shipment.id} />
              </div>
            </div>
          ) : null}

          {canApprove && cancellable ? (
            <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
              <h2 className="text-sm font-semibold">Cancel this booking</h2>
              <p className="mt-1 text-xs text-ink-500">
                Only before pickup. The order stays ready to ship so it can be booked
                again.
              </p>
              <div className="mt-3">
                <CancelShipmentForm shipmentId={shipment.id} />
              </div>
            </div>
          ) : null}

          <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200">
            <h2 className="text-sm font-semibold">Money</h2>
            <p className="mt-2 text-sm text-ink-700">
              COD is collected by the courier. Verify the payment in{" "}
              <Link href="/payments" className="font-medium text-brand-700 hover:underline">
                Payments
              </Link>{" "}
              when the courier reports delivery, then clear it with a{" "}
              <Link
                href="/shipping/remittances"
                className="font-medium text-brand-700 hover:underline"
              >
                COD remittance
              </Link>
              .
            </p>
            <p className="mt-2 text-xs text-ink-500">
              Order payment status: {shipment.order.paymentStatus.replaceAll("_", " ").toLowerCase()} ·
              paid ৳{formatMoney(shipment.order.paidAmount)} of ৳
              {formatMoney(shipment.order.grandTotal)}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
