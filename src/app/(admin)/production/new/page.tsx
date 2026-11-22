import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProductionNav } from "@/components/production/production-nav";
import { JobForm, type ComponentOption } from "@/components/production/job-form";
import { dhakaToday } from "@/lib/accounting/report-dates";
import { requirePagePermission } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { formatQty } from "@/lib/inventory/format";
import { producibleOrderItems } from "@/lib/production/service";

export const metadata: Metadata = {
  title: "New production job",
  robots: { index: false, follow: false },
};

const dateLabel = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeZone: "Asia/Dhaka",
});

export default async function NewProductionJobPage({
  searchParams,
}: {
  searchParams: Promise<{ orderItemId?: string }>;
}) {
  await requirePagePermission("production.write");
  const { orderItemId } = await searchParams;

  if (!orderItemId) {
    const items = await producibleOrderItems();

    return (
      <div className="space-y-5">
        <header className="space-y-3">
          <Link href="/production" className="text-sm font-medium text-brand-700 hover:underline">
            ← Production
          </Link>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">
              Choose an order line · অর্ডার লাইন বাছুন
            </h1>
            <p className="mt-1 text-sm text-ink-600">
              Confirmed, processing and ready-to-ship orders with no live production job. Dropship
              lines are made by the supplier and do not appear here.
            </p>
          </div>
          <ProductionNav />
        </header>

        <section className="overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200">
          <h2 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold">
            Lines that can go into production
          </h2>
          {items.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-ink-500">
              No eligible order line. Confirm an order first, or finish the job already open on it.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {items.map((item) => (
                <li key={item.id} className="px-4 py-3">
                  <Link
                    href={`/production/new?orderItemId=${item.id}`}
                    className="flex flex-wrap items-start justify-between gap-2 hover:bg-slate-50"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        {item.productNameSnapshot}
                        {item.variantNameSnapshot ? ` · ${item.variantNameSnapshot}` : ""}
                      </p>
                      <p className="text-xs text-ink-500">
                        {item.order.orderNumber} · {item.skuSnapshot} ·{" "}
                        {formatQty(item.quantity)} unit(s) · {item.order.recipientName} ·{" "}
                        {dateLabel.format(item.order.placedAt)}
                      </p>
                    </div>
                    <div className="text-right text-xs text-ink-500">
                      <p>{item.order.status.toLowerCase()}</p>
                      {item.productionRequired ? <p>already marked for production</p> : null}
                      {item.customizationRequired ? <p>customization on file</p> : null}
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

  const item = await prisma.orderItem.findUnique({
    where: { id: orderItemId },
    select: {
      id: true,
      variantId: true,
      quantity: true,
      fulfillmentType: true,
      productNameSnapshot: true,
      variantNameSnapshot: true,
      skuSnapshot: true,
      order: {
        select: {
          orderNumber: true,
          status: true,
          warehouseId: true,
        },
      },
    },
  });
  if (!item) notFound();

  const warehouseId =
    item.order.warehouseId ??
    (
      await prisma.warehouse.findFirst({
        where: { isActive: true },
        orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
        select: { id: true },
      })
    )?.id;
  if (!warehouseId) notFound();

  const balances = await prisma.inventoryBalance.findMany({
    where: {
      warehouseId,
      availableQty: { gt: 0 },
      variantId: { not: item.variantId ?? undefined },
      variant: { fulfillmentType: "STOCKED", status: "ACTIVE" },
    },
    orderBy: { variant: { sku: "asc" } },
    take: 100,
    select: {
      availableQty: true,
      variant: { select: { id: true, sku: true, name: true, product: { select: { name: true } } } },
    },
  });

  const components: ComponentOption[] = balances.map((balance) => ({
    id: balance.variant.id,
    sku: balance.variant.sku,
    name: `${balance.variant.product.name} · ${balance.variant.name}`,
    available: balance.availableQty.toString(),
  }));

  return (
    <div className="space-y-5">
      <header className="space-y-3">
        <Link
          href="/production/new"
          className="text-sm font-medium text-brand-700 hover:underline"
        >
          ← Choose another line
        </Link>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            New production job · নতুন উৎপাদন কাজ
          </h1>
          <p className="mt-1 text-sm text-ink-600">
            The job starts in design. Add a revision, send it for approval, then issue components
            and move it through production.
          </p>
        </div>
        <ProductionNav />
      </header>

      {["DROPSHIP"].includes(item.fulfillmentType) ? (
        <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-800 ring-1 ring-amber-200">
          A dropship line is produced by the supplier, not here.
        </p>
      ) : (
        <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <JobForm
            orderItemId={item.id}
            orderNumber={item.order.orderNumber}
            productName={item.productNameSnapshot}
            variantName={item.variantNameSnapshot}
            sku={item.skuSnapshot}
            quantity={item.quantity.toString()}
            components={components}
            today={dhakaToday()}
          />
        </section>
      )}
    </div>
  );
}
