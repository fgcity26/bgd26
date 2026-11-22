import { NextResponse } from "next/server";
import { hasPermission } from "@/lib/auth/permissions";
import { getStaffSession } from "@/lib/auth/session";
import { tryNormalizeBdMobile } from "@/lib/crm/phone";
import { prisma } from "@/lib/db";
import {
  LOYALTY,
  maxRedeemablePoints,
  netMerchandise,
} from "@/lib/loyalty/service";

export const dynamic = "force-dynamic";

/**
 * Loyalty preview for the till.
 *
 * Returns the customer's live balance and the most points this sale may spend.
 * The numbers are a preview only: `createSale` re-reads the balance and
 * re-applies the 20 % cap inside the sale transaction.
 */
export async function GET(request: Request) {
  const session = await getStaffSession();
  if (!session) {
    return NextResponse.json({ error: "Sign in to use the till." }, { status: 401 });
  }
  if (!hasPermission(session, "pos.read")) {
    return NextResponse.json({ error: "You cannot use the till." }, { status: 403 });
  }

  const url = new URL(request.url);
  const mobile = tryNormalizeBdMobile(url.searchParams.get("mobile")?.trim() ?? "");
  if (!mobile) {
    return NextResponse.json(
      { customer: null, maxPoints: 0 },
      { headers: { "cache-control": "no-store" } },
    );
  }

  const subtotal = Number(url.searchParams.get("subtotal") ?? 0);
  const discount = Number(url.searchParams.get("discount") ?? 0);
  if (!Number.isFinite(subtotal) || !Number.isFinite(discount)) {
    return NextResponse.json({ error: "Invalid sale totals." }, { status: 400 });
  }

  const customer = await prisma.customer.findUnique({
    where: { mobileNormalized: mobile },
    select: {
      id: true,
      fullName: true,
      mobileNormalized: true,
      loyaltyPointsBalance: true,
      isWalkInCash: true,
      status: true,
      deletedAt: true,
    },
  });

  if (!customer || customer.deletedAt || customer.isWalkInCash) {
    return NextResponse.json(
      { customer: null, maxPoints: 0 },
      { headers: { "cache-control": "no-store" } },
    );
  }

  const cap = maxRedeemablePoints(netMerchandise(subtotal, discount));
  const maxPoints =
    customer.status === "BLOCKED" ? 0 : Math.min(customer.loyaltyPointsBalance, cap);

  return NextResponse.json(
    {
      customer: {
        id: customer.id,
        name: customer.fullName,
        mobile: customer.mobileNormalized,
        balance: customer.loyaltyPointsBalance,
        blocked: customer.status === "BLOCKED",
      },
      maxPoints,
      config: {
        takaPerPoint: LOYALTY.takaPerPoint,
        pointValue: LOYALTY.pointValue,
        redemptionCap: LOYALTY.redemptionCap,
        expiryMonths: LOYALTY.expiryMonths,
      },
    },
    { headers: { "cache-control": "no-store" } },
  );
}
