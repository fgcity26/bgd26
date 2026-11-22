import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { setSupplierStatusAction } from "@/app/actions/purchasing";
import { PurchaseNav } from "@/components/purchasing/purchasing-nav";
import { SupplierForm } from "@/components/purchasing/supplier-form";
import { hasPermission } from "@/lib/auth/permissions";
import { requirePagePermission } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/inventory/format";
import { supplierPayable } from "@/lib/purchasing/settlement";

export const metadata: Metadata = {
  title: "Supplier",
  robots: { index: false, follow: false },
};

const dateTime = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Dhaka",
});

function statusStyle(status: string): string {
  if (status === "ACTIVE") return "bg-brand-50 text-brand-700 ring-brand-200";
  if (status === "BLACKLISTED") return "bg-red-50 text-red-700 ring-red-200";
  return "bg-slate-100 text-ink-500 ring-slate-200";
}

export default async function SupplierDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await requirePagePermission("purchase.read");
  const { id } = await params;
  const { error } = await searchParams;
  const canWrite = hasPermission(session, "purchase.write");
  const canApprove = hasPermission(session, "purchase.approve");

  const supplier = await prisma.supplier.findUnique({
    where: { id },
    include: {
      purchaseOrders: {
        orderBy: { createdAt: "desc" },
        take: 10,
        select: {
          id: true,
          poNumber: true,
          status: true,
          grandTotal: true,
          createdAt: true,
          _count: { select: { items: true } },
        },
      },
      _count: { select: { purchaseOrders: true, grns: true } },
    },
  });

  if (!supplier) notFound();

  const payable = await supplierPayable(supplier.id);

  const mobile = supplier.mobileNormalized
    ? `0${supplier.mobileNormalized.slice(4)}`
    : null;

  return (
    <div className="space-y-5">
      <header className="space-y-3">
        <Link href="/suppliers" className="text-sm font-medium text-brand-700 hover:underline">
          ← Suppliers
        </Link>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight">{supplier.name}</h1>
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${statusStyle(supplier.status)}`}
              >
                {supplier.status.toLowerCase()}
              </span>
            </div>
            <p className="mt-1 text-sm text-ink-500">
              {supplier.code}
              {supplier.nameBn ? ` · ${supplier.nameBn}` : ""}
            </p>
            <p className="mt-1 text-xs text-ink-500">
              Added {dateTime.format(supplier.createdAt)} · {supplier._count.purchaseOrders} order
              {supplier._count.purchaseOrders === 1 ? "" : "s"} · {supplier._count.grns} goods
              receipt{supplier._count.grns === 1 ? "" : "s"}
            </p>
          </div>

          {canApprove ? (
            <div className="flex flex-wrap gap-2">
              {supplier.status === "ACTIVE" ? (
                <>
                  <form action={setSupplierStatusAction}>
                    <input type="hidden" name="id" value={supplier.id} />
                    <input type="hidden" name="status" value="INACTIVE" />
                    <button
                      type="submit"
                      className="min-h-11 rounded-xl border border-slate-300 px-4 text-sm font-semibold text-ink-700 hover:border-amber-300 hover:text-amber-700"
                    >
                      Deactivate
                    </button>
                  </form>
                  <form action={setSupplierStatusAction}>
                    <input type="hidden" name="id" value={supplier.id} />
                    <input type="hidden" name="status" value="BLACKLISTED" />
                    <button
                      type="submit"
                      className="min-h-11 rounded-xl border border-red-300 px-4 text-sm font-semibold text-red-700 hover:bg-red-50"
                    >
                      Blacklist
                    </button>
                  </form>
                </>
              ) : (
                <form action={setSupplierStatusAction}>
                  <input type="hidden" name="id" value={supplier.id} />
                  <input type="hidden" name="status" value="ACTIVE" />
                  <button
                    type="submit"
                    className="min-h-11 rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700"
                  >
                    Activate
                  </button>
                </form>
              )}
            </div>
          ) : null}
        </div>

        <PurchaseNav />
      </header>

      {error ? (
        <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-red-200">
          {error}
        </p>
      ) : null}

      {supplier.status !== "ACTIVE" ? (
        <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm leading-relaxed text-amber-800 ring-1 ring-amber-200">
          {supplier.status === "BLACKLISTED"
            ? "Blacklisted. New purchase orders cannot be raised for this supplier."
            : "Inactive. Reactivate the supplier before raising a purchase order."}
        </p>
      ) : null}

      <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-ink-500">
              Accounts payable · প্রদেয়
            </p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">
              ৳{formatMoney(payable.outstanding)}
            </p>
            <p className="mt-1 text-xs text-ink-500">
              ৳{formatMoney(payable.invoiced)} received on credit · ৳
              {formatMoney(payable.settled)} paid or returned
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href={`/suppliers/${supplier.id}/statement`}
              className="inline-flex min-h-11 items-center rounded-xl border border-slate-300 px-4 text-sm font-semibold text-ink-700 hover:border-brand-300 hover:text-brand-700"
            >
              Statement
            </Link>
            {canApprove && payable.outstanding.greaterThan(0) ? (
              <Link
                href="/purchases/payments/new"
                className="inline-flex min-h-11 items-center rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700"
              >
                Record payment
              </Link>
            ) : null}
          </div>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Contact</p>
          <p className="mt-1 text-sm font-semibold">{supplier.contactPerson ?? "—"}</p>
          <p className="mt-1 text-xs text-ink-500">{mobile ?? "no mobile"}</p>
        </div>
        <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Email</p>
          <p className="mt-1 break-words text-sm font-semibold">{supplier.email ?? "—"}</p>
        </div>
        <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Terms</p>
          <p className="mt-1 text-sm font-semibold">
            {supplier.paymentTermsDays} day{supplier.paymentTermsDays === 1 ? "" : "s"}
          </p>
          <p className="mt-1 text-xs text-ink-500">
            Lead time {supplier.leadTimeDays} day{supplier.leadTimeDays === 1 ? "" : "s"}
          </p>
        </div>
        <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Dropship</p>
          <p className="mt-1 text-sm font-semibold">
            {supplier.isDropshipVendor ? "Yes" : "No"}
          </p>
          <p className="mt-1 text-xs text-ink-500">Ships straight to customers</p>
        </div>
      </section>

      {supplier.address || supplier.division || supplier.district || supplier.notes ? (
        <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <h2 className="text-base font-semibold">Address & notes</h2>
          {supplier.address ? (
            <p className="mt-2 whitespace-pre-line text-sm text-ink-700">{supplier.address}</p>
          ) : null}
          {supplier.division || supplier.district ? (
            <p className="mt-1 text-xs text-ink-500">
              {[supplier.district, supplier.division].filter(Boolean).join(", ")}
            </p>
          ) : null}
          {supplier.notes ? (
            <p className="mt-2 whitespace-pre-line text-sm text-ink-700">{supplier.notes}</p>
          ) : null}
        </section>
      ) : null}

      <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold">Recent purchase orders</h2>
          <Link
            href={`/purchases?supplier=${supplier.id}`}
            className="text-xs font-medium text-brand-700 hover:underline"
          >
            View all
          </Link>
        </div>
        {supplier.purchaseOrders.length === 0 ? (
          <p className="mt-3 rounded-xl bg-slate-50 px-3 py-4 text-sm text-ink-500">
            No purchase orders yet.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100">
            {supplier.purchaseOrders.map((order) => (
              <li key={order.id} className="py-3">
                <Link
                  href={`/purchases/${order.id}`}
                  className="flex flex-wrap items-baseline justify-between gap-2"
                >
                  <span className="text-sm font-medium text-brand-700 hover:underline">
                    {order.poNumber}
                  </span>
                  <span className="text-xs text-ink-500">
                    {order.status.replaceAll("_", " ")} · {order._count.items} line
                    {order._count.items === 1 ? "" : "s"} · ৳{formatMoney(order.grandTotal)}
                  </span>
                </Link>
                <p className="mt-1 text-xs text-ink-500">{dateTime.format(order.createdAt)}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {canWrite ? (
        <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <h2 className="text-base font-semibold">Edit supplier</h2>
          <p className="mt-1 text-xs text-ink-500">
            Status changes use the buttons above and need purchase approval rights.
          </p>
          <div className="mt-4">
            <SupplierForm
              supplier={{
                id: supplier.id,
                code: supplier.code,
                name: supplier.name,
                nameBn: supplier.nameBn,
                contactPerson: supplier.contactPerson,
                mobile: supplier.mobileNormalized
                  ? `0${supplier.mobileNormalized.slice(4)}`
                  : "",
                email: supplier.email,
                address: supplier.address,
                division: supplier.division,
                district: supplier.district,
                paymentTermsDays: supplier.paymentTermsDays,
                leadTimeDays: supplier.leadTimeDays,
                isDropshipVendor: supplier.isDropshipVendor,
                status: supplier.status,
                notes: supplier.notes,
              }}
            />
          </div>
        </section>
      ) : null}
    </div>
  );
}
