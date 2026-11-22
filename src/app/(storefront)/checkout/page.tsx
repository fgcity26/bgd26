import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckoutForm } from "@/components/storefront/checkout-form";
import { getCartView } from "@/lib/storefront/cart";
import { listDeliveryZones } from "@/lib/storefront/checkout";
import { getCustomerSession } from "@/lib/customer-auth/session";
import { listCustomerAddresses } from "@/lib/customer-auth/addresses";
import { maxRedeemablePoints, netMerchandise } from "@/lib/loyalty/service";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Checkout",
  robots: { index: false, follow: false },
};

export default async function CheckoutPage() {
  const cart = await getCartView();
  if (!cart || cart.lines.length === 0) redirect("/cart");

  const [zones, customer] = await Promise.all([listDeliveryZones(), getCustomerSession()]);
  const addresses = customer ? await listCustomerAddresses(customer.id) : [];
  const maxPoints = customer
    ? Math.min(
        customer.loyaltyPointsBalance,
        maxRedeemablePoints(netMerchandise(cart.subtotal, 0)),
      )
    : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Checkout</h1>
          <p className="mt-1 text-sm text-ink-500">
            {customer
              ? `Signed in as ${customer.fullName}. Your saved addresses and points are ready.`
              : "One page. No account needed. We only ask for what the courier needs."}
          </p>
        </div>
        <Link href="/cart" className="text-sm font-medium text-brand-700 hover:underline">
          ← Back to cart
        </Link>
      </div>

      {!customer ? (
        <p className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-ink-600">
          Have an account?{" "}
          <Link
            href="/account/login?next=%2Fcheckout"
            className="font-medium text-brand-700 hover:underline"
          >
            Sign in
          </Link>{" "}
          to use saved addresses and spend loyalty points.
        </p>
      ) : null}

      {zones.length === 0 ? (
        <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-6 text-sm text-amber-900">
          Delivery areas are not configured yet. Please try again later.
        </p>
      ) : (
        <CheckoutForm
          cart={cart}
          zones={zones}
          idempotencyKey={randomUUID()}
          account={customer ? { fullName: customer.fullName, mobile: customer.mobileNormalized } : null}
          addresses={addresses}
          loyalty={customer ? { balance: customer.loyaltyPointsBalance, maxPoints } : null}
        />
      )}
    </div>
  );
}
