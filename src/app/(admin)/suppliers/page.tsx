import type { Metadata } from "next";
import Link from "next/link";
import { Prisma } from "@/generated/prisma/client";
import { PurchaseNav } from "@/components/purchasing/purchasing-nav";
import { hasPermission } from "@/lib/auth/permissions";
import { requirePagePermission } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

export const metadata: Metadata = {
  title: "Suppliers",
  robots: { index: false, follow: false },
};

const PAGE_SIZE = 25;

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "ACTIVE", label: "Active" },
  { value: "INACTIVE", label: "Inactive" },
  { value: "BLACKLISTED", label: "Blacklisted" },
] as const;

function statusStyle(status: string): string {
  if (status === "ACTIVE") return "bg-brand-50 text-brand-700 ring-brand-200";
  if (status === "BLACKLISTED") return "bg-red-50 text-red-700 ring-red-200";
  return "bg-slate-100 text-ink-500 ring-slate-200";
}

export default async function SuppliersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
}) {
  const session = await requirePagePermission("purchase.read");
  const canWrite = hasPermission(session, "purchase.write");

  const params = await searchParams;
  const query = params.q?.trim() ?? "";
  const status = STATUS_OPTIONS.some((option) => option.value === params.status)
    ? (params.status ?? "")
    : "";
  const page = Math.max(1, Number(params.page) || 1);

  const where: Prisma.SupplierWhereInput = {
    ...(status ? { status: status as Prisma.EnumSupplierStatusFilter } : {}),
    ...(query
      ? {
          OR: [
            { name: { contains: query, mode: "insensitive" } },
            { nameBn: { contains: query, mode: "insensitive" } },
            { code: { contains: query, mode: "insensitive" } },
            { contactPerson: { contains: query, mode: "insensitive" } },
            { mobileNormalized: { contains: query } },
            { email: { contains: query, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [total, suppliers] = await Promise.all([
    prisma.supplier.count({ where }),
    prisma.supplier.findMany({
      where,
      orderBy: [{ status: "asc" }, { name: "asc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { _count: { select: { purchaseOrders: true } } },
    }),
  ]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const linkFor = (nextPage: number) => {
    const search = new URLSearchParams();
    if (query) search.set("q", query);
    if (status) search.set("status", status);
    if (nextPage > 1) search.set("page", String(nextPage));
    const suffix = search.toString();
    return suffix ? `/suppliers?${suffix}` : "/suppliers";
  };

  return (
    <div className="space-y-5">
      <header className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Suppliers</h1>
            <p className="mt-1 text-sm text-ink-500">
              পণ্যের সরবরাহকারী, যোগাযোগ ও ক্রয়ের শর্ত। সরবরাহকারী কখনও মুছে ফেলা হয় না।
            </p>
          </div>
          {canWrite ? (
            <Link
              href="/suppliers/new"
              className="inline-flex min-h-11 items-center rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700"
            >
              New supplier · নতুন
            </Link>
          ) : null}
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
          placeholder="Search name, code, contact or mobile"
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
        {total} supplier{total === 1 ? "" : "s"} · page {page} of {pages}
      </p>

      {suppliers.length === 0 ? (
        <div className="rounded-2xl bg-white p-6 text-center ring-1 ring-slate-200">
          <p className="text-sm font-medium text-ink-700">No suppliers match these filters.</p>
          <p className="mt-1 text-sm text-ink-500">
            Add a supplier before raising a purchase order.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {suppliers.map((supplier) => (
            <li key={supplier.id} className="rounded-2xl bg-white ring-1 ring-slate-200">
              <Link
                href={`/suppliers/${supplier.id}`}
                className="block p-3 transition-colors hover:bg-brand-50/40"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink-900">
                      {supplier.name}
                    </p>
                    <p className="truncate text-xs text-ink-500">
                      {supplier.code}
                      {supplier.nameBn ? ` · ${supplier.nameBn}` : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    {supplier.isDropshipVendor ? (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-ink-500">
                        dropship
                      </span>
                    ) : null}
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${statusStyle(supplier.status)}`}
                    >
                      {supplier.status.toLowerCase()}
                    </span>
                  </div>
                </div>
                <p className="mt-2 text-xs text-ink-500">
                  {supplier.contactPerson ? `${supplier.contactPerson} · ` : ""}
                  {supplier.mobileNormalized ?? "no mobile"}
                  {supplier.email ? ` · ${supplier.email}` : ""}
                </p>
                <p className="mt-1 text-xs text-ink-500">
                  {supplier._count.purchaseOrders} order
                  {supplier._count.purchaseOrders === 1 ? "" : "s"} · terms{" "}
                  {supplier.paymentTermsDays} day{supplier.paymentTermsDays === 1 ? "" : "s"} · lead{" "}
                  {supplier.leadTimeDays} day{supplier.leadTimeDays === 1 ? "" : "s"}
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
