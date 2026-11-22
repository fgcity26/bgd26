import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PurchaseNav } from "@/components/purchasing/purchasing-nav";
import { ReturnForm, type ReturnableLine } from "@/components/purchasing/return-form";
import { requirePagePermission } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { money } from "@/lib/inventory/decimal";
import { formatMoney } from "@/lib/inventory/format";
import { SUPPLIER_PAYMENT_METHODS, returnableGrns } from "@/lib/purchasing/settlement";

export const metadata: Metadata = {
  title: "New purchase return",
  robots: { index: false, follow: false },
};

const dateLabel = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeZone: "Asia/Dhaka",
});

export default async function NewPurchaseReturnPage({
  searchParams,
}: {
  searchParams: Promise<{ grnId?: string }>;
}) {
  await requirePagePermission("purchase.write");
  const { grnId } = await searchParams;

  if (!grnId) {
    const grns = await returnableGrns();
    return (
      <div className="space-y-5">
        <header className="space-y-3">
          <Link
            href="/purchases/returns"
            className="text-sm font-medium text-brand-700 hover:underline"
          >
            ← Purchase returns
          </Link>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">
              Choose a goods receipt · মাল গ্রহণ বাছুন
            </h1>
            <p className="mt-1 text-sm text-ink-600">
              A return always points at a posted receipt, so the quantity and cost come from
              what actually arrived.
            </p>
          </div>
          <PurchaseNav />
        </header>

        <section className="overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200">
          <h2 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold">
            Receipts with units still returnable
          </h2>
          {grns.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-ink-500">
              No posted goods receipt has anything left to return.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {grns.map((grn) => {
                const returnable = grn.items.reduce(
                  (sum, item) =>
                    item.quantityReceived.greaterThan(item.returnedQty)
                      ? sum.add(
                          item.quantityReceived.sub(item.returnedQty).mul(item.unitCost),
                        )
                      : sum,
                  money(0),
                );
                return (
                  <li key={grn.id} className="px-4 py-3">
                    <Link
                      href={`/purchases/returns/new?grnId=${grn.id}`}
                      className="flex flex-wrap items-baseline justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <p className="font-mono text-xs text-brand-700">{grn.grnNumber}</p>
                        <p className="text-sm font-medium">{grn.supplier.name}</p>
                        <p className="text-xs text-ink-500">
                          {grn.postedAt ? dateLabel.format(grn.postedAt) : "posted"} · value ৳
                          {formatMoney(grn.totalValue)}
                        </p>
                      </div>
                      <p className="text-xs text-ink-500">
                        up to ৳{formatMoney(returnable)} returnable
                      </p>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    );
  }

  const grn = await prisma.goodsReceivedNote.findUnique({
    where: { id: grnId },
    select: {
      id: true,
      grnNumber: true,
      status: true,
      supplier: { select: { name: true } },
      items: {
        orderBy: { id: "asc" },
        select: {
          id: true,
          quantityReceived: true,
          returnedQty: true,
          unitCost: true,
          variant: {
            select: { sku: true, name: true, product: { select: { name: true } } },
          },
        },
      },
    },
  });

  if (!grn || grn.status !== "POSTED") notFound();

  const lines: ReturnableLine[] = grn.items
    .filter((item) => item.quantityReceived.greaterThan(item.returnedQty))
    .map((item) => ({
      id: item.id,
      sku: item.variant.sku,
      description: `${item.variant.product.name} · ${item.variant.name}`,
      received: item.quantityReceived.toString(),
      returned: item.returnedQty.toString(),
      returnable: item.quantityReceived.sub(item.returnedQty).toString(),
      unitCost: item.unitCost.toString(),
    }));

  return (
    <div className="space-y-5">
      <header className="space-y-3">
        <Link
          href={`/purchases/grn/${grn.id}`}
          className="text-sm font-medium text-brand-700 hover:underline"
        >
          ← {grn.grnNumber}
        </Link>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            New purchase return · ফেরত
          </h1>
          <p className="mt-1 text-sm text-ink-600">
            Enter what is going back. Saving creates a draft; a manager approves it, which is
            when stock leaves and the supplier is debited.
          </p>
        </div>
        <PurchaseNav />
      </header>

      {lines.length === 0 ? (
        <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-800 ring-1 ring-amber-200">
          Every unit on this receipt has already been returned.
        </p>
      ) : (
        <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <ReturnForm
            grnId={grn.id}
            grnNumber={grn.grnNumber}
            supplierName={grn.supplier.name}
            lines={lines}
            methods={SUPPLIER_PAYMENT_METHODS}
          />
        </section>
      )}
    </div>
  );
}
