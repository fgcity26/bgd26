import type { Metadata } from "next";
import {
  createAddressAction,
  deleteAddressAction,
  setDefaultAddressAction,
  updateAddressAction,
} from "@/app/actions/customer-account";
import { requireCustomer } from "@/lib/customer-auth/session";
import { listCustomerAddresses, type AddressView } from "@/lib/customer-auth/addresses";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your addresses",
  robots: { index: false, follow: false },
};

const inputClass =
  "mt-1 block w-full min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100";

function AddressFields({ address }: { address?: AddressView }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="block text-sm font-medium text-ink-700">
        Label
        <input
          name="label"
          defaultValue={address?.label ?? "Home"}
          maxLength={40}
          className={inputClass}
        />
      </label>
      <label className="block text-sm font-medium text-ink-700">
        Recipient name
        <input
          name="recipientName"
          required
          minLength={2}
          defaultValue={address?.recipientName ?? ""}
          className={inputClass}
        />
      </label>
      <label className="block text-sm font-medium text-ink-700">
        Mobile
        <input
          name="mobile"
          required
          type="tel"
          inputMode="tel"
          defaultValue={address?.mobileNormalized ?? ""}
          className={inputClass}
        />
      </label>
      <label className="block text-sm font-medium text-ink-700">
        Postcode <span className="font-normal text-ink-500">(optional)</span>
        <input
          name="postcode"
          defaultValue={address?.postcode ?? ""}
          maxLength={10}
          className={inputClass}
        />
      </label>
      <label className="block text-sm font-medium text-ink-700">
        Division
        <input
          name="division"
          required
          defaultValue={address?.division ?? ""}
          placeholder="Dhaka"
          className={inputClass}
        />
      </label>
      <label className="block text-sm font-medium text-ink-700">
        District
        <input
          name="district"
          required
          defaultValue={address?.district ?? ""}
          placeholder="Dhaka"
          className={inputClass}
        />
      </label>
      <label className="block text-sm font-medium text-ink-700">
        Upazila / thana
        <input
          name="upazila"
          required
          defaultValue={address?.upazila ?? ""}
          className={inputClass}
        />
      </label>
      <label className="block text-sm font-medium text-ink-700">
        Area <span className="font-normal text-ink-500">(optional)</span>
        <input name="area" defaultValue={address?.area ?? ""} className={inputClass} />
      </label>
      <label className="block text-sm font-medium text-ink-700 sm:col-span-2">
        Full address
        <textarea
          name="addressLine"
          required
          minLength={6}
          rows={2}
          defaultValue={address?.addressLine ?? ""}
          placeholder="House, road, landmark"
          className="mt-1 block w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
        />
      </label>
    </div>
  );
}

export default async function CustomerAddressesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  const customer = await requireCustomer("/account/addresses");
  const [addresses, params] = await Promise.all([
    listCustomerAddresses(customer.id),
    searchParams,
  ]);

  return (
    <div className="space-y-5">
      {params.error ? (
        <p role="alert" className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-red-200">
          {params.error}
        </p>
      ) : null}
      {params.ok ? (
        <p className="rounded-2xl bg-brand-50 px-4 py-3 text-sm text-brand-800 ring-1 ring-brand-200">
          {params.ok}
        </p>
      ) : null}

      <section className="rounded-2xl border border-slate-200 p-4">
        <h2 className="text-base font-semibold">Add an address</h2>
        <p className="mt-1 text-sm text-ink-500">
          The first address becomes your default. Checkout fills it in automatically.
        </p>
        <form action={createAddressAction} className="mt-3 space-y-3">
          <AddressFields />
          <button
            type="submit"
            className="min-h-11 rounded-xl bg-brand-600 px-5 text-sm font-semibold text-white hover:bg-brand-700"
          >
            Save address
          </button>
        </form>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold">Saved addresses</h2>
          <p className="text-xs text-ink-500">
            {addresses.length} of 20
          </p>
        </div>

        {addresses.length === 0 ? (
          <p className="rounded-2xl border border-slate-200 px-4 py-6 text-sm text-ink-500">
            No saved addresses yet. Add one above.
          </p>
        ) : (
          <ul className="space-y-2">
            {addresses.map((address) => (
              <li key={address.id} className="rounded-2xl border border-slate-200 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold">
                      {address.label ?? "Address"}
                      {address.isDefault ? (
                        <span className="ml-2 rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-700 ring-1 ring-brand-200">
                          default
                        </span>
                      ) : null}
                    </p>
                    <p className="mt-1 text-sm text-ink-700">{address.recipientName}</p>
                    <p className="text-xs text-ink-500">{address.mobileNormalized}</p>
                    <p className="mt-1 text-sm text-ink-700">
                      {[address.addressLine, address.area, address.upazila, address.district, address.division]
                        .filter((part): part is string => Boolean(part && part.trim()))
                        .join(", ")}
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {!address.isDefault ? (
                      <form action={setDefaultAddressAction}>
                        <input type="hidden" name="id" value={address.id} />
                        <button
                          type="submit"
                          className="min-h-9 rounded-lg border border-slate-300 px-3 text-xs font-medium text-ink-700 hover:border-brand-300 hover:text-brand-700"
                        >
                          Make default
                        </button>
                      </form>
                    ) : null}
                    <form action={deleteAddressAction}>
                      <input type="hidden" name="id" value={address.id} />
                      <button
                        type="submit"
                        className="min-h-9 rounded-lg border border-slate-300 px-3 text-xs font-medium text-ink-700 hover:border-red-300 hover:text-red-700"
                      >
                        Remove
                      </button>
                    </form>
                  </div>
                </div>

                <details className="mt-3">
                  <summary className="cursor-pointer text-xs font-medium text-brand-700">
                    Edit this address
                  </summary>
                  <form action={updateAddressAction} className="mt-3 space-y-3">
                    <input type="hidden" name="id" value={address.id} />
                    <AddressFields address={address} />
                    <button
                      type="submit"
                      className="min-h-10 rounded-xl border border-slate-300 px-4 text-sm font-semibold text-ink-700 hover:border-brand-300 hover:text-brand-700"
                    >
                      Save changes
                    </button>
                  </form>
                </details>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
