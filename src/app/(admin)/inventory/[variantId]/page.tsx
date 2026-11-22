import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Prisma } from "@/generated/prisma/client";
import { InventoryNav } from "@/components/inventory/inventory-nav";
import { hasPermission } from "@/lib/auth/permissions";
import { requirePagePermission } from "@/lib/auth/session";
import { canViewCostPrices } from "@/lib/catalog/dto";
import { prisma } from "@/lib/db";
import { formatCost, formatMoney, formatQty } from "@/lib/inventory/format";

export const metadata: Metadata = {
  title: "Stock detail",
  robots: { index: false, follow: false },
};

const dateTime = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Dhaka",
});

function movementStyle(type: string): string {
  if (type.includes("IN") || type === "OPENING_BALANCE" || type === "PURCHASE_RECEIPT") {
    return "bg-brand-50 text-brand-700 ring-brand-200";
  }
  if (type === "DAMAGE" || type === "WRITE_OFF") return "bg-red-50 text-red-700 ring-red-200";
  if (type === "QUARANTINE") return "bg-amber-50 text-amber-800 ring-amber-200";
  return "bg-slate-100 text-ink-700 ring-slate-200";
}

function signedQty(value: Prisma.Decimal): string {
  const text = formatQty(value);
  return value.greaterThan(0) ? `+${text}` : text;
}

export default async function InventoryDetailPage({
  params,
}: {
  params: Promise<{ variantId: string }>;
}) {
  const session = await requirePagePermission("inventory.read");
  const { variantId } = await params;
  const canWrite = hasPermission(session, "inventory.write");
  const canApprove = hasPermission(session, "inventory.approve");
  const canViewCost = canViewCostPrices(session);

  const variant = await prisma.productVariant.findUnique({
    where: { id: variantId },
    include: {
      product: { select: { id: true, name: true, nameBn: true, slug: true, status: true } },
      inventoryBalances: {
        include: {
          warehouse: {
            select: { id: true, code: true, name: true, isActive: true, isDefault: true },
          },
        },
      },
      stockLedgerEntries: {
        orderBy: { createdAt: "desc" },
        take: 50,
        include: {
          warehouse: { select: { code: true, name: true } },
          createdBy: { select: { fullName: true } },
        },
      },
      adjustments: {
        orderBy: { createdAt: "desc" },
        take: 10,
        include: {
          warehouse: { select: { code: true } },
          createdBy: { select: { fullName: true } },
        },
      },
    },
  });

  if (!variant) notFound();

  const balances = [...variant.inventoryBalances].sort((a, b) =>
    a.warehouse.code.localeCompare(b.warehouse.code),
  );

  const totals = balances.reduce(
    (sum, balance) => ({
      physical: sum.physical.add(balance.physicalQty),
      available: sum.available.add(balance.availableQty),
      reserved: sum.reserved.add(balance.reservedQty),
      damaged: sum.damaged.add(balance.damagedQty),
      quarantined: sum.quarantined.add(balance.quarantinedQty),
      value: sum.value.add(balance.physicalQty.mul(balance.avcoUnitCost)),
    }),
    {
      physical: new Prisma.Decimal(0),
      available: new Prisma.Decimal(0),
      reserved: new Prisma.Decimal(0),
      damaged: new Prisma.Decimal(0),
      quarantined: new Prisma.Decimal(0),
      value: new Prisma.Decimal(0),
    },
  );

  const stocked = variant.fulfillmentType === "STOCKED";
  const firstWarehouse = balances.find((balance) => balance.warehouse.isActive)?.warehouse.id ?? "";

  return (
    <div className="space-y-5">
      <header className="space-y-3">
        <Link href="/inventory" className="text-sm font-medium text-brand-700 hover:underline">
          ← Inventory
        </Link>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight">{variant.product.name}</h1>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-ink-700">
                {variant.fulfillmentType}
              </span>
            </div>
            <p className="mt-1 text-sm text-ink-500">
              {variant.name} · {variant.sku}
              {variant.barcode ? ` · ${variant.barcode}` : ""}
            </p>
            <p className="mt-1 text-xs text-ink-500">
              {variant.product.status} ·{" "}
              <Link href={`/products/${variant.product.id}`} className="text-brand-700 hover:underline">
                open product
              </Link>
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {canWrite ? (
              <Link
                href={`/inventory/adjustments/new?variantId=${variant.id}${
                  firstWarehouse ? `&warehouseId=${firstWarehouse}` : ""
                }`}
                className="inline-flex min-h-11 items-center rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700"
              >
                Adjust stock · সংশোধন
              </Link>
            ) : null}
            {canApprove ? (
              <Link
                href={`/inventory/opening?variantId=${variant.id}`}
                className="inline-flex min-h-11 items-center rounded-xl border border-slate-300 px-4 text-sm font-semibold text-ink-700 hover:border-brand-300 hover:text-brand-700"
              >
                Opening stock
              </Link>
            ) : null}
          </div>
        </div>

        <InventoryNav />
      </header>

      {!stocked ? (
        <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm leading-relaxed text-amber-800 ring-1 ring-amber-200">
          This variant is <strong>{variant.fulfillmentType}</strong>. It does not use inventory
          balances or the stock ledger; orders still post revenue and cost through accounting.
        </p>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Physical</p>
          <p className="mt-1 text-lg font-semibold">{formatQty(totals.physical)}</p>
          <p className="mt-1 text-xs text-ink-500">Everything on hand, including holds</p>
        </div>
        <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Available</p>
          <p className="mt-1 text-lg font-semibold text-brand-700">{formatQty(totals.available)}</p>
          <p className="mt-1 text-xs text-ink-500">Sellable now</p>
        </div>
        <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Held</p>
          <p className="mt-1 text-lg font-semibold">
            {formatQty(totals.reserved.add(totals.damaged).add(totals.quarantined))}
          </p>
          <p className="mt-1 text-xs text-ink-500">
            {formatQty(totals.reserved)} reserved · {formatQty(totals.damaged)} damaged ·{" "}
            {formatQty(totals.quarantined)} quarantine
          </p>
        </div>
        {canViewCost ? (
          <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
            <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Stock value</p>
            <p className="mt-1 text-lg font-semibold">৳{formatMoney(totals.value)}</p>
            <p className="mt-1 text-xs text-ink-500">Physical × AVCO, all warehouses</p>
          </div>
        ) : null}
      </section>

      <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
        <h2 className="text-base font-semibold">Balances by warehouse</h2>
        {balances.length === 0 ? (
          <p className="mt-3 rounded-xl bg-slate-50 px-3 py-4 text-sm text-ink-500">
            No balance yet. Post opening stock or a purchase receipt to start the ledger.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {balances.map((balance) => (
              <li key={balance.id} className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink-900">
                      {balance.warehouse.code} · {balance.warehouse.name}
                      {balance.warehouse.isDefault ? (
                        <span className="ml-2 rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700 ring-1 ring-brand-200">
                          Default
                        </span>
                      ) : null}
                      {!balance.warehouse.isActive ? (
                        <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-ink-500">
                          inactive
                        </span>
                      ) : null}
                    </p>
                    <p className="mt-1 text-xs text-ink-500">
                      Last movement{" "}
                      {balance.lastMovementAt ? dateTime.format(balance.lastMovementAt) : "—"}
                    </p>
                  </div>
                  {canWrite && balance.warehouse.isActive ? (
                    <Link
                      href={`/inventory/adjustments/new?variantId=${variant.id}&warehouseId=${balance.warehouse.id}`}
                      className="inline-flex min-h-9 items-center rounded-lg border border-slate-300 px-3 text-xs font-medium text-ink-700 hover:border-brand-300 hover:text-brand-700"
                    >
                      Adjust here
                    </Link>
                  ) : null}
                </div>

                <dl className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3 lg:grid-cols-6">
                  <div>
                    <dt className="text-ink-500">Physical</dt>
                    <dd className="font-semibold text-ink-900">{formatQty(balance.physicalQty)}</dd>
                  </div>
                  <div>
                    <dt className="text-ink-500">Available</dt>
                    <dd className="font-semibold text-brand-700">
                      {formatQty(balance.availableQty)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-ink-500">Reserved</dt>
                    <dd className="font-medium text-ink-700">{formatQty(balance.reservedQty)}</dd>
                  </div>
                  <div>
                    <dt className="text-ink-500">Damaged</dt>
                    <dd className="font-medium text-ink-700">{formatQty(balance.damagedQty)}</dd>
                  </div>
                  <div>
                    <dt className="text-ink-500">Quarantine</dt>
                    <dd className="font-medium text-ink-700">
                      {formatQty(balance.quarantinedQty)}
                    </dd>
                  </div>
                  {canViewCost ? (
                    <div>
                      <dt className="text-ink-500">AVCO / value</dt>
                      <dd className="font-medium text-ink-700">
                        ৳{formatCost(balance.avcoUnitCost)} · ৳
                        {formatMoney(balance.physicalQty.mul(balance.avcoUnitCost))}
                      </dd>
                    </div>
                  ) : null}
                </dl>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold">Stock ledger</h2>
          <p className="text-xs text-ink-500">Last 50 movements · append-only</p>
        </div>

        {variant.stockLedgerEntries.length === 0 ? (
          <p className="mt-3 rounded-xl bg-slate-50 px-3 py-4 text-sm text-ink-500">
            No movements yet. Every posting appends a row; nothing is edited or deleted.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100">
            {variant.stockLedgerEntries.map((entry) => (
              <li key={entry.id} className="py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${movementStyle(entry.movementType)}`}
                      >
                        {entry.movementType}
                      </span>
                      <span className="text-sm font-semibold text-ink-900">
                        {signedQty(entry.quantity)}
                      </span>
                      <span className="text-xs text-ink-500">
                        {entry.warehouse.code}
                        {canViewCost
                          ? ` · ৳${formatCost(entry.unitCost)}/unit · ৳${formatMoney(entry.totalValue)}`
                          : ""}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-ink-500">
                      balance after {formatQty(entry.balanceAfterQty)} ·{" "}
                      {entry.referenceType.replaceAll("_", " ")} ·{" "}
                      {dateTime.format(entry.createdAt)}
                      {entry.createdBy ? ` · ${entry.createdBy.fullName}` : ""}
                    </p>
                    {entry.note ? (
                      <p className="mt-1 whitespace-pre-line text-xs text-ink-700">{entry.note}</p>
                    ) : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold">Recent adjustment documents</h2>
          <Link href="/inventory/adjustments" className="text-sm font-medium text-brand-700 hover:underline">
            All adjustments →
          </Link>
        </div>

        {variant.adjustments.length === 0 ? (
          <p className="mt-3 rounded-xl bg-slate-50 px-3 py-4 text-sm text-ink-500">
            No adjustments for this variant yet.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100">
            {variant.adjustments.map((adjustment) => (
              <li
                key={adjustment.id}
                className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-sm"
              >
                <div>
                  <Link
                    href={`/inventory/adjustments/${adjustment.id}`}
                    className="font-medium text-brand-700 hover:underline"
                  >
                    {adjustment.adjustmentNumber}
                  </Link>
                  <span className="ml-2 text-xs text-ink-500">
                    {adjustment.adjustmentType} · {formatQty(adjustment.quantity)} ·{" "}
                    {adjustment.warehouse.code}
                  </span>
                </div>
                <span className="text-xs text-ink-500">
                  {adjustment.status} · {dateTime.format(adjustment.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
