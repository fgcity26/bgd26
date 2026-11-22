import { cache } from "react";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { verifyCustomerSessionToken } from "@/lib/auth/token";
import { readCustomerCookie } from "./cookies";

export type CustomerUser = {
  id: string;
  fullName: string;
  mobileNormalized: string;
  mobileRaw: string | null;
  email: string | null;
  loyaltyPointsBalance: number;
  totalOrders: number;
  lastLoginAt: Date | null;
  accountClaimedAt: Date | null;
};

/**
 * Resolve the signed-in storefront customer once per request.
 *
 * The cookie is only a claim; the database decides whether the account still
 * exists and is usable. A blocked or soft-deleted customer loses access
 * immediately even while the cookie is valid.
 */
export const getCustomerSession = cache(async (): Promise<CustomerUser | null> => {
  const token = await readCustomerCookie();
  if (!token) return null;

  const payload = verifyCustomerSessionToken(token);
  if (!payload) return null;

  const customer = await prisma.customer.findFirst({
    where: { id: payload.customerId, deletedAt: null },
    select: {
      id: true,
      fullName: true,
      mobileNormalized: true,
      mobileRaw: true,
      email: true,
      loyaltyPointsBalance: true,
      totalOrders: true,
      lastLoginAt: true,
      accountClaimedAt: true,
      status: true,
    },
  });
  if (!customer || customer.status !== "ACTIVE") return null;

  return {
    id: customer.id,
    fullName: customer.fullName,
    mobileNormalized: customer.mobileNormalized,
    mobileRaw: customer.mobileRaw,
    email: customer.email,
    loyaltyPointsBalance: customer.loyaltyPointsBalance,
    totalOrders: customer.totalOrders,
    lastLoginAt: customer.lastLoginAt,
    accountClaimedAt: customer.accountClaimedAt,
  };
});

/** Only a same-site path may be used as a post-login destination. */
export function safeCustomerNext(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/account";
  if (value.startsWith("/account/login") || value.startsWith("/account/register")) {
    return "/account";
  }
  return value;
}

export async function requireCustomer(next?: string): Promise<CustomerUser> {
  const customer = await getCustomerSession();
  if (!customer) {
    const target = next ? `?next=${encodeURIComponent(safeCustomerNext(next))}` : "";
    redirect(`/account/login${target}`);
  }
  return customer;
}
