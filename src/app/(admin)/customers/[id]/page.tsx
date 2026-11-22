import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  deleteCustomerNoteAction,
  removeCustomerAddressAction,
  setCustomerBlockedAction,
  setDefaultAddressAction,
  softDeleteCustomerAction,
} from "@/app/actions/customers";
import { AddressForm } from "@/components/crm/address-form";
import { CustomerForm } from "@/components/crm/customer-form";
import { NoteForm } from "@/components/crm/note-form";
import { hasPermission } from "@/lib/auth/permissions";
import { requirePagePermission } from "@/lib/auth/session";
import { formatBdMobile } from "@/lib/crm/phone";
import { prisma } from "@/lib/db";

export const metadata: Metadata = {
  title: "Customer",
  robots: { index: false, follow: false },
};

const dateTime = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Dhaka",
});

function statusStyle(status: string): string {
  if (status === "ACTIVE") return "bg-brand-50 text-brand-700 ring-brand-200";
  if (status === "MERGED") return "bg-slate-100 text-ink-500 ring-slate-200";
  return "bg-red-50 text-red-700 ring-red-200";
}

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requirePagePermission("customer.read");
  const { id } = await params;

  const customer = await prisma.customer.findUnique({
    where: { id },
    include: {
      addresses: {
        where: { deletedAt: null },
        orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
      },
      notes: {
        orderBy: [{ isPinned: "desc" }, { createdAt: "desc" }],
        take: 30,
        include: { author: { select: { fullName: true } } },
      },
      mobileHistory: {
        orderBy: { createdAt: "desc" },
        take: 10,
        include: { changedBy: { select: { fullName: true } } },
      },
      _count: { select: { orders: true, reviews: true } },
    },
  });

  if (!customer) notFound();

  const canWrite = hasPermission(session, "customer.write");
  const canDelete = hasPermission(session, "customer.delete");
  const deleted = customer.deletedAt !== null;
  const editable = canWrite && !deleted && !customer.isWalkInCash;

  return (
    <div className="space-y-5">
      <header className="space-y-3">
        <Link href="/customers" className="text-sm font-medium text-brand-700 hover:underline">
          ← Customers
        </Link>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight">{customer.fullName}</h1>
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${statusStyle(customer.status)}`}
              >
                {customer.status}
                {deleted ? " · deleted" : ""}
              </span>
            </div>
            <p className="mt-1 text-sm text-ink-500">
              {formatBdMobile(customer.mobileNormalized)}
              {customer.email ? ` · ${customer.email}` : ""}
            </p>
            <p className="mt-1 text-xs text-ink-500">
              {customer.customerType}
              {customer.isWalkInCash ? " · system walk-in customer" : ""} · added{" "}
              {dateTime.format(customer.createdAt)}
            </p>
            {customer.tags.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1">
                {customer.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-ink-700"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-2">
            {canWrite && !customer.isWalkInCash && !deleted ? (
              <form action={setCustomerBlockedAction}>
                <input type="hidden" name="id" value={customer.id} />
                <input
                  type="hidden"
                  name="blocked"
                  value={customer.status === "BLOCKED" ? "false" : "true"}
                />
                <button
                  type="submit"
                  className="min-h-11 rounded-xl border border-slate-300 px-4 text-sm font-semibold text-ink-700 hover:border-brand-300"
                >
                  {customer.status === "BLOCKED" ? "Unblock" : "Block"}
                </button>
              </form>
            ) : null}
            {canDelete && !customer.isWalkInCash && !deleted ? (
              <form action={softDeleteCustomerAction}>
                <input type="hidden" name="id" value={customer.id} />
                <button
                  type="submit"
                  className="min-h-11 rounded-xl border border-red-300 px-4 text-sm font-semibold text-red-700 hover:bg-red-50"
                >
                  Delete (soft)
                </button>
              </form>
            ) : null}
          </div>
        </div>
      </header>

      {deleted ? (
        <p className="rounded-2xl bg-slate-100 px-4 py-3 text-sm text-ink-700 ring-1 ring-slate-200">
          This customer is soft-deleted. Orders, payments and journals keep their history, and
          the row is never removed.
        </p>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Orders</p>
          <p className="mt-1 text-lg font-semibold">{customer.totalOrders}</p>
          <p className="mt-1 text-xs text-ink-500">{customer._count.orders} linked rows</p>
        </div>
        <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Lifetime value</p>
          <p className="mt-1 text-lg font-semibold">৳{customer.lifetimeValue.toString()}</p>
          <p className="mt-1 text-xs text-ink-500">
            {customer.lastOrderAt
              ? `Last order ${dateTime.format(customer.lastOrderAt)}`
              : "No orders yet"}
          </p>
        </div>
        <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Loyalty</p>
          <p className="mt-1 text-lg font-semibold">{customer.loyaltyPointsBalance} points</p>
          <p className="mt-1 text-xs text-ink-500">
            ৳1 each ·{" "}
            <Link href={`/loyalty/${customer.id}`} className="text-brand-700 hover:underline">
              open ledger
            </Link>
          </p>
        </div>
        <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Activity</p>
          <p className="mt-1 text-lg font-semibold">{customer._count.reviews} reviews</p>
          <p className="mt-1 text-xs text-ink-500">
            {customer.addresses.length} saved address{customer.addresses.length === 1 ? "" : "es"}
          </p>
        </div>
      </section>

      <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
        <h2 className="text-base font-semibold">Addresses</h2>
        {customer.addresses.length === 0 ? (
          <p className="mt-3 rounded-xl bg-slate-50 px-3 py-4 text-sm text-ink-500">
            No addresses yet. Courier dispatch needs one.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {customer.addresses.map((address) => (
              <li key={address.id} className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 text-sm">
                    <p className="font-medium text-ink-900">
                      {address.recipientName}
                      {address.isDefault ? (
                        <span className="ml-2 rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700 ring-1 ring-brand-200">
                          Default
                        </span>
                      ) : null}
                      <span className="ml-2 text-xs font-normal text-ink-500">
                        {address.label ?? "Home"} · {address.addressType}
                      </span>
                    </p>
                    <p className="mt-1 text-xs text-ink-500">
                      {formatBdMobile(address.mobileNormalized)}
                    </p>
                    <p className="mt-1 text-sm text-ink-700">
                      {address.addressLine}, {address.area ? `${address.area}, ` : ""}
                      {address.upazila}, {address.district}, {address.division}
                      {address.postcode ? ` ${address.postcode}` : ""}
                    </p>
                  </div>

                  {editable ? (
                    <div className="flex flex-wrap gap-2">
                      {!address.isDefault ? (
                        <form action={setDefaultAddressAction}>
                          <input type="hidden" name="id" value={address.id} />
                          <input type="hidden" name="customerId" value={customer.id} />
                          <button
                            type="submit"
                            className="min-h-9 rounded-lg border border-slate-300 px-3 text-xs font-medium text-ink-700 hover:border-brand-300"
                          >
                            Make default
                          </button>
                        </form>
                      ) : null}
                      <form action={removeCustomerAddressAction}>
                        <input type="hidden" name="id" value={address.id} />
                        <input type="hidden" name="customerId" value={customer.id} />
                        <button
                          type="submit"
                          className="min-h-9 rounded-lg border border-red-200 px-3 text-xs font-medium text-red-700 hover:bg-red-50"
                        >
                          Remove
                        </button>
                      </form>
                    </div>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}

        {editable ? (
          <div className="mt-4 border-t border-slate-200 pt-4">
            <h3 className="text-sm font-semibold text-ink-700">Add an address</h3>
            <div className="mt-3">
              <AddressForm
                customerId={customer.id}
                defaultMobile={customer.mobileRaw ?? customer.mobileNormalized}
              />
            </div>
          </div>
        ) : null}
      </section>

      <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
        <h2 className="text-base font-semibold">Notes</h2>
        {customer.notes.length === 0 ? (
          <p className="mt-3 rounded-xl bg-slate-50 px-3 py-4 text-sm text-ink-500">
            No notes yet. Record preferences, call outcomes or delivery instructions.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {customer.notes.map((note) => (
              <li key={note.id} className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="whitespace-pre-line text-sm text-ink-700">{note.note}</p>
                  {editable ? (
                    <form action={deleteCustomerNoteAction}>
                      <input type="hidden" name="id" value={note.id} />
                      <input type="hidden" name="customerId" value={customer.id} />
                      <button
                        type="submit"
                        className="min-h-9 rounded-lg border border-slate-300 px-3 text-xs font-medium text-ink-700 hover:border-red-300 hover:text-red-700"
                      >
                        Delete
                      </button>
                    </form>
                  ) : null}
                </div>
                <p className="mt-1 text-xs text-ink-500">
                  {note.isPinned ? "Pinned · " : ""}
                  {note.author?.fullName ?? "System"} · {dateTime.format(note.createdAt)}
                </p>
              </li>
            ))}
          </ul>
        )}

        {editable ? (
          <div className="mt-4 border-t border-slate-200 pt-4">
            <NoteForm customerId={customer.id} />
          </div>
        ) : null}
      </section>

      {customer.mobileHistory.length > 0 ? (
        <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <h2 className="text-base font-semibold">Mobile number history</h2>
          <ul className="mt-3 divide-y divide-slate-100">
            {customer.mobileHistory.map((change) => (
              <li key={change.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-sm">
                <span className="text-ink-700">
                  {formatBdMobile(change.oldMobile)} → {formatBdMobile(change.newMobile)}
                </span>
                <span className="text-xs text-ink-500">
                  {change.changedBy?.fullName ?? "System"} · {dateTime.format(change.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {editable ? (
        <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <h2 className="text-base font-semibold">Edit customer</h2>
          <div className="mt-3">
            <CustomerForm
              mode="edit"
              customer={{
                id: customer.id,
                fullName: customer.fullName,
                mobileRaw: customer.mobileRaw,
                mobileNormalized: customer.mobileNormalized,
                email: customer.email,
                customerType: customer.customerType,
                tags: customer.tags,
              }}
            />
          </div>
        </section>
      ) : null}
    </div>
  );
}
