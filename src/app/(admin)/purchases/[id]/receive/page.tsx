import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PurchaseNav } from "@/components/purchasing/purchasing-nav";
import { GrnForm } from "@/components/purchasing/grn-form";
import { requirePagePermission } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { outstandingLines } from "@/lib/purchasing/service";

export const metadata: Metadata = {
  title: "Receive goods",
  robots: { index: false, follow: false },
};

export default async function ReceiveGoodsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePagePermission("purchase.write");
  const { id } = await params;

  const order = await prisma.purchaseOrder.findUnique({
    where: { id },
    include: {
      supplier: { select: { name: true } },
      warehouse: { select: { id: true, code: true, name: true } },
      _count: { select: { items: true } },
    },
  });

  if (!order) notFound();

  const receivable = ["SENT", "PARTIALLY_RECEIVED"].includes(order.status);
  const lines = receivable ? await outstandingLines(order.id) : [];
  const openLines = lines.filter((line) => line.outstanding.greaterThan(0));

  const warehouses = await prisma.warehouse.findMany({
    where: { isActive: true },
    orderBy: [{ isDefault: "desc" }, { code: "asc" }],
    select: { id: true, code: true, name: true },
  });

  return (
    <div className="space-y-5">
      <header className="space-y-3">
        <Link
          href={`/purchases/${order.id}`}
          className="text-sm font-medium text-brand-700 hover:underline"
        >
          ← {order.poNumber}
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Receive goods</h1>
          <p className="mt-1 text-sm text-ink-500">
            {order.supplier.name} · {order.poNumber} · মাল গ্রহণ
          </p>
        </div>
        <PurchaseNav />
      </header>

      {!receivable ? (
        <div className="rounded-2xl bg-amber-50 p-4 text-sm leading-relaxed text-amber-900 ring-1 ring-amber-200">
          <p className="font-semibold">
            {order.status === "DRAFT"
              ? "Send the order before receiving goods."
              : order.status === "RECEIVED"
                ? "Everything on this order has been received."
                : order.status === "CLOSED"
                  ? "This order is closed."
                  : "This order is cancelled."}
          </p>
          <p className="mt-1">
            Only a sent or partially received order can be received.{" "}
            <Link href={`/purchases/${order.id}`} className="font-medium underline">
              Back to the order
            </Link>
          </p>
        </div>
      ) : openLines.length === 0 ? (
        <div className="rounded-2xl bg-amber-50 p-4 text-sm leading-relaxed text-amber-900 ring-1 ring-amber-200">
          <p className="font-semibold">No outstanding quantity remains.</p>
          <p className="mt-1">
            Every line is either received or already on a draft goods receipt. Cancel or post that
            receipt first.
          </p>
        </div>
      ) : !order.warehouse ? (
        <div className="rounded-2xl bg-amber-50 p-4 text-sm leading-relaxed text-amber-900 ring-1 ring-amber-200">
          <p className="font-semibold">This order has no receiving warehouse.</p>
          <p className="mt-1">Choose a warehouse on the order before receiving.</p>
        </div>
      ) : warehouses.length === 0 ? (
        <div className="rounded-2xl bg-amber-50 p-4 text-sm leading-relaxed text-amber-900 ring-1 ring-amber-200">
          <p className="font-semibold">No active warehouse is available.</p>
          <p className="mt-1">Activate a warehouse before receiving stock.</p>
        </div>
      ) : (
        <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <GrnForm
            purchaseOrderId={order.id}
            poNumber={order.poNumber}
            defaultWarehouseId={order.warehouse.id}
            warehouses={warehouses}
            lines={openLines.map((line) => ({
              id: line.id,
              description: line.description,
              quantity: line.quantity.toString(),
              receivedQty: line.receivedQty.toString(),
              unitCost: line.unitCost.toString(),
              outstanding: line.outstanding.toString(),
            }))}
          />
        </section>
      )}
    </div>
  );
}
