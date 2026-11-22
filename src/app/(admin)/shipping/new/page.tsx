import type { Metadata } from "next";
import Link from "next/link";
import { ShipmentForm } from "@/components/shipping/shipping-forms";
import { ShippingNav } from "@/components/shipping/shipping-nav";
import { requirePagePermission } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { shippableOrders } from "@/lib/shipping/service";

export const metadata: Metadata = {
  title: "Book a shipment",
  robots: { index: false, follow: false },
};

export default async function NewShipmentPage({
  searchParams,
}: {
  searchParams: Promise<{ orderId?: string }>;
}) {
  await requirePagePermission("shipment.write");
  const { orderId } = await searchParams;

  const [orders, couriers] = await Promise.all([
    shippableOrders(),
    prisma.courier.findMany({
      where: { isActive: true },
      orderBy: [{ provider: "asc" }, { name: "asc" }],
      select: { id: true, name: true, provider: true, supportsCod: true },
    }),
  ]);

  return (
    <div className="space-y-5">
      <header className="space-y-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Book a shipment</h1>
          <p className="mt-1 text-sm text-ink-500">
            শুধু &ldquo;ready to ship&rdquo; অর্ডার কুরিয়ারে দেওয়া যায়।
          </p>
        </div>
        <ShippingNav />
      </header>

      <section className="max-w-2xl rounded-2xl bg-white p-4 ring-1 ring-slate-200 sm:p-5">
        <ShipmentForm
          orders={orders.map((order) => ({
            id: order.id,
            orderNumber: order.orderNumber,
            recipientName: order.recipientName,
            recipientMobile: order.recipientMobile,
            grandTotal: order.grandTotal.toFixed(2),
            dueAmount: order.dueAmount.toFixed(2),
            paymentStatus: order.paymentStatus,
            zone: order.deliveryZone?.name ?? null,
          }))}
          couriers={couriers.map((courier) => ({
            id: courier.id,
            name: courier.name,
            provider: courier.provider,
            supportsCod: courier.supportsCod,
          }))}
          defaultOrderId={orderId}
        />
      </section>

      <p className="text-sm text-ink-500">
        The courier list is managed on{" "}
        <Link href="/shipping/couriers" className="font-medium text-brand-700 hover:underline">
          Couriers
        </Link>
        . Pathao, Steadfast and RedX need their API adapter before they can book
        automatically; until then use a manual courier and paste the tracking number.
      </p>
    </div>
  );
}
