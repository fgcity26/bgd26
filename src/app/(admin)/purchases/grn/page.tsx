import type { Metadata } from "next";
import Link from "next/link";
import { Prisma } from "@/generated/prisma/client";
import { PurchaseNav } from "@/components/purchasing/purchasing-nav";
import { requirePagePermission } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/inventory/format";

export const metadata: Metadata = {
  title: "Goods received",
  robots: { index: false, follow: false },
};

const PAGE_SIZE = 25;

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "DRAFT", label: "Draft" },
  { value: "POSTED", label: "Posted" },
  { value: "CANCELLED", label: "Cancelled" },
] as const;

const dateTime = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Dhaka",
});

function statusStyle(status: string): string {
  if (status === "POSTED") return "bg-brand-50 text-brand-700 ring-brand-200";
  if (status === "CANCELLED") return "bg-slate-100 text-ink-500 ring-slate-200";
  return "bg-slate-100 text-ink-700 ring-slate-200";
}

export default async function GoodsReceivedPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
}) {
  await requirePagePermission("purchase.read");

  const params = await searchParams;
  const query = params.q?.trim() ?? "";
  const status = STATUS_OPTIONS.some((option) => option.value === params.status)
    ? (params.status ?? "")
    : "";
  const page = Math.max(1, Number(params.page) || 1);

  const where: Prisma.GoodsReceivedNoteWhereInput = {
    ...(status ? { status: status as Prisma.EnumGRNStatusFilter } : {}),
    ...(query
      ? {
          OR: [
            { grnNumber: { contains: query, mode: "insensitive" } },
            { notes: { contains: query, mode: "insensitive" } },
            { purchaseOrder: { poNumber: { contains: query, mode: "insensitive" } } },
            { supplier: { name: { contains: query, mode: "insensitive" } } },
            { supplier: { code: { contains: query, mode: "insensitive" } } },
            {
              items: {
                some: {
                  variant: {
                    OR: [
                      { sku: { contains: query, mode: "insensitive" } },
                      { name: { contains: query, mode: "insensitive" } },
                      { product: { name: { contains: query, mode: "insensitive" } } },
                    ],
                  },
                },
              },
            },
          ],
        }
      : {}),
  };

  const [total, receipts] = await Promise.all([
    prisma.goodsReceivedNote.count({ where }),
    prisma.goodsReceivedNote.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        supplier: { select: { code: true, name: true } },
        warehouse: { select: { code: true } },
        purchaseOrder: { select: { id: true, poNumber: true } },
        _count: { select: { items: true } },
      },
    }),
  ]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const linkFor = (nextPage: number) => {
    const search = new URLSearchParams();
    if (query) search.set("q", query);
    if (status) search.set("status", status);
    if (nextPage > 1) search.set("page", String(nextPage));
    const suffix = search.toString();
    return suffix ? `/purchases/grn?${suffix}` : "/purchases/grn";
  };

  return (
    <div className="space-y-5">
      <header className="space-y-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Goods received</h1>
          <p className="mt-1 text-sm text-ink-500">
            মাল গ্রহণের নোট (GRN)। পোস্ট করলে স্টক ও গড় খরচ হালনাগাদ হয়; পোস্ট করা নোট বদলায় না।
          </p>
        </div>
        <PurchaseNav />
      </header>

      <form
        method="get"
        className="grid gap-2 rounded-2xl bg-white p-3 ring-1 ring-slate-200 sm:grid-cols-[1fr_auto_auto]"
      >
        <input
          name="q"
          defaultValue={query}
          placeholder="Search GRN, order, supplier, SKU or product"
          className="min-h-11 rounded-xl border border-slate-300 px-3 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
        />
        <select
          name="status"
          defaultValue={status}
          className="min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm"
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="min-h-11 rounded-xl border border-slate-300 px-4 text-sm font-semibold text-ink-700 hover:border-brand-300 hover:text-brand-700"
        >
          Filter
        </button>
      </form>

      <p className="text-xs text-ink-500">
        {total} receipt{total === 1 ? "" : "s"} · page {page} of {pages}
      </p>

      {receipts.length === 0 ? (
        <div className="rounded-2xl bg-white p-6 text-center ring-1 ring-slate-200">
          <p className="text-sm font-medium text-ink-700">No goods receipts match these filters.</p>
          <p className="mt-1 text-sm text-ink-500">
            Receive a sent purchase order to create a goods receipt.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {receipts.map((receipt) => (
            <li key={receipt.id} className="rounded-2xl bg-white ring-1 ring-slate-200">
              <Link
                href={`/purchases/grn/${receipt.id}`}
                className="block p-3 transition-colors hover:bg-brand-50/40"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink-900">{receipt.grnNumber}</p>
                    <p className="mt-1 truncate text-xs text-ink-500">
                      {receipt.supplier.code} · {receipt.supplier.name} → {receipt.warehouse.code}
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${statusStyle(receipt.status)}`}
                  >
                    {receipt.status.toLowerCase()}
                  </span>
                </div>
                <p className="mt-2 text-xs text-ink-700">
                  {receipt.purchaseOrder.poNumber} · {receipt._count.items} line
                  {receipt._count.items === 1 ? "" : "s"} · ৳{formatMoney(receipt.totalValue)}
                </p>
                <p className="mt-1 text-xs text-ink-500">
                  Received {dateTime.format(receipt.receivedAt)}
                  {receipt.postedAt ? ` · posted ${dateTime.format(receipt.postedAt)}` : ""}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {pages > 1 ? (
        <nav className="flex items-center justify-between gap-3" aria-label="Pagination">
          {page > 1 ? (
            <Link
              href={linkFor(page - 1)}
              className="inline-flex min-h-11 items-center rounded-xl border border-slate-300 px-4 text-sm font-medium text-ink-700 hover:border-brand-300"
            >
              Previous
            </Link>
          ) : (
            <span />
          )}
          {page < pages ? (
            <Link
              href={linkFor(page + 1)}
              className="inline-flex min-h-11 items-center rounded-xl border border-slate-300 px-4 text-sm font-medium text-ink-700 hover:border-brand-300"
            >
              Next
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </div>
  );
}
