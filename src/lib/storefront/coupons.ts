import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { money, type Numeric } from "@/lib/inventory/decimal";
import { StorefrontError } from "./errors";

/**
 * Online coupons.
 *
 * A coupon is quoted against gross merchandise (`subtotal + VAT`, the price the
 * shopper sees), then capped by `maxDiscount` and the remaining order value.
 * The quote is repeated inside the checkout transaction with the coupon row
 * locked, so two shoppers cannot spend the last redemption at the same time.
 *
 * FREE_SHIPPING discounts the delivery charge rather than the merchandise.
 */

export type CouponTypeName = "PERCENTAGE" | "FIXED_AMOUNT" | "FREE_SHIPPING";

export type CouponQuote = {
  couponId: string;
  code: string;
  name: string;
  description: string | null;
  type: CouponTypeName;
  /** Taka off the merchandise. Free shipping returns 0 here. */
  discount: Prisma.Decimal;
  freeShipping: boolean;
  minOrderValue: Prisma.Decimal;
};

export function normalizeCouponCode(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, "");
}

type CouponRow = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  type: CouponTypeName;
  value: Prisma.Decimal;
  minOrderValue: Prisma.Decimal;
  maxDiscount: Prisma.Decimal | null;
  usageLimit: number | null;
  usageLimitPerCustomer: number;
  usedCount: number;
  startsAt: Date | null;
  endsAt: Date | null;
  isActive: boolean;
  appliesToChannels: string[];
};

function isLive(coupon: CouponRow, now: Date): boolean {
  if (!coupon.isActive) return false;
  if (!coupon.appliesToChannels.includes("ONLINE")) return false;
  if (coupon.startsAt && coupon.startsAt > now) return false;
  if (coupon.endsAt && coupon.endsAt <= now) return false;
  if (coupon.usageLimit !== null && coupon.usedCount >= coupon.usageLimit) return false;
  return true;
}

export async function quoteCoupon(
  input: {
    code: string;
    /** Gross merchandise: subtotal + VAT, before any discount. */
    gross: Numeric;
    /** Used only by a free-shipping coupon. */
    deliveryCharge?: Numeric;
    customerId?: string | null;
  },
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<CouponQuote> {
  const code = normalizeCouponCode(input.code);
  if (!code) throw new StorefrontError("Enter a coupon code.");

  const coupon = (await client.coupon.findUnique({
    where: { code },
    select: {
      id: true,
      code: true,
      name: true,
      description: true,
      type: true,
      value: true,
      minOrderValue: true,
      maxDiscount: true,
      usageLimit: true,
      usageLimitPerCustomer: true,
      usedCount: true,
      startsAt: true,
      endsAt: true,
      isActive: true,
      appliesToChannels: true,
    },
  })) as CouponRow | null;

  if (!coupon || !isLive(coupon, new Date())) {
    throw new StorefrontError("That coupon is not available.");
  }

  const gross = money(input.gross);
  if (gross.lessThan(0)) throw new StorefrontError("The order value is invalid.");
  if (gross.lessThan(coupon.minOrderValue)) {
    throw new StorefrontError(
      `This coupon needs an order of at least ৳${money(coupon.minOrderValue).toFixed(2)}.`,
    );
  }

  if (coupon.usageLimitPerCustomer > 0 && input.customerId) {
    const used = await client.couponRedemption.count({
      where: { couponId: coupon.id, customerId: input.customerId },
    });
    if (used >= coupon.usageLimitPerCustomer) {
      throw new StorefrontError("You have already used this coupon.");
    }
  }

  let discount = money(0);
  let freeShipping = false;

  if (coupon.type === "PERCENTAGE") {
    discount = money(gross.mul(coupon.value).div(100));
  } else if (coupon.type === "FIXED_AMOUNT") {
    discount = money(coupon.value);
  } else {
    freeShipping = true;
    discount = money(input.deliveryCharge ?? 0);
  }

  if (coupon.maxDiscount !== null && discount.greaterThan(coupon.maxDiscount)) {
    discount = money(coupon.maxDiscount);
  }
  // Never discount more than the merchandise itself. Delivery is priced
  // separately, so a coupon cannot create a negative merchandise total.
  if (discount.greaterThan(gross)) discount = gross;

  return {
    couponId: coupon.id,
    code: coupon.code,
    name: coupon.name,
    description: coupon.description,
    type: coupon.type,
    discount,
    freeShipping,
    minOrderValue: money(coupon.minOrderValue),
  };
}

/**
 * Lock a coupon by code for the duration of the checkout transaction.
 * Returns the id so the order can point at it.
 */
export async function lockCoupon(
  tx: Prisma.TransactionClient,
  code: string,
): Promise<string> {
  const normalized = normalizeCouponCode(code);
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "coupons" WHERE "code" = ${normalized} FOR UPDATE
  `;
  const id = rows[0]?.id;
  if (!id) throw new StorefrontError("That coupon is not available.");
  return id;
}

/** Record the redemption and increment the global counter atomically. */
export async function recordCouponRedemption(
  tx: Prisma.TransactionClient,
  input: {
    couponId: string;
    orderId: string;
    customerId: string;
    discountAmount: Numeric;
  },
): Promise<void> {
  await tx.couponRedemption.create({
    data: {
      couponId: input.couponId,
      orderId: input.orderId,
      customerId: input.customerId,
      discountAmount: money(input.discountAmount),
    },
  });
  await tx.coupon.update({
    where: { id: input.couponId },
    data: { usedCount: { increment: 1 } },
  });
}
