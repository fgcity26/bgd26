import type { Metadata } from "next";
import { TrackForm } from "@/components/storefront/track-form";

export const metadata: Metadata = {
  title: "Track your order",
  description: "Enter your order number and mobile number to see the latest delivery status.",
  alternates: { canonical: "/track" },
};

export default function TrackPage() {
  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Track your order</h1>
        <p className="mt-2 text-sm text-ink-500">
          Use the order number from your confirmation and the mobile number you entered at
          checkout. We do not show order details to anyone else.
        </p>
      </div>

      <div className="rounded-2xl border border-slate-200 p-5">
        <TrackForm />
      </div>

      <p className="text-sm text-ink-500">
        Lost your order number? Message us on WhatsApp with the mobile number you used at checkout.
      </p>
    </div>
  );
}
