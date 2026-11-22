import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { signOrderAccessToken, verifyOrderAccessToken } from "@/lib/auth/token";
import { tryNormalizeBdMobile } from "@/lib/crm/phone";
import { money } from "@/lib/inventory/decimal";
import { createSale } from "@/lib/orders/service";
import { computeSaleTotals } from "@/lib/orders/totals";
import { defaultWarehouse } from "./catalog";
import { lockCoupon, normalizeCouponCode, quoteCoupon, recordCouponRedemption } from "./coupons";
import { StorefrontError } from "./errors";

/**
 * Guest online checkout.
 *
 * The order is created by the same `createSale` engine as the POS, so stock,
 * journals, payments and loyalty behave identically. What is different:
 *  - the customer has no login; the mobile number identifies them;
 *  - cash-on-delivery and manual bKash/Nagad create a payment that waits in
 *    `PENDING_VERIFICATION`, exactly like an offline digital payment;
 *  - stock leaves the default warehouse when the order is confirmed (soft
 *    reservations are a later module);
 *  - a coupon is locked and redeemed inside the same transaction.
 */

export const STOREFRONT_PAYMENT_METHODS = ["COD", "BKASH", "NAGAD"] as const;
export type StorefrontPaymentMethod = (typeof STOREFRONT_PAYMENT_METHODS)[number];

export type DeliveryZoneView = {
  id: string;
  name: string;
  division: string;
  district: string;
  charge: string;
  freeShippingThreshold: string | null;
  estimatedDaysMin: number;
  estimatedDaysMax: number;
};

export async function listDeliveryZones(): Promise<DeliveryZoneView[]> {
  const zones = await prisma.deliveryZone.findMany({
    where: { isActive: true },
    orderBy: [{ division: "asc" }, { district: "asc" }, { charge: "asc" }],
    select: {
      id: true,
      name: true,
      division: true,
      district: true,
      charge: true,
      freeShippingThreshold: true,
      estimatedDaysMin: true,
      estimatedDaysMax: true,
    },
  });
  return zones.map((zone) => ({
    id: zone.id,
    name: zone.name,
    division: zone.division,
    district: zone.district,
    charge: money(zone.charge).toFixed(2),
    freeShippingThreshold:
      zone.freeShippingThreshold === null
        ? null
        : money(zone.freeShippingThreshold).toFixed(2),
    estimatedDaysMin: zone.estimatedDaysMin,
    estimatedDaysMax: zone.estimatedDaysMax,
  }));
}

export type OnlineOrderInput = {
  customerName: string;
  customerMobile: string;
  recipientName?: string;
  recipientMobile?: string;
  address: string;
  division: string;
  district: string;
  upazila?: string;
  deliveryZoneId: string;
  paymentMethod: StorefrontPaymentMethod;
  paymentReference?: string;
  note?: string;
  couponCode?: string;
  idempotencyKey?: string;
  /** Set only from a signed-in storefront session. */
  customerId?: string | null;
  /** Points the signed-in customer chose to spend on this order. */
  loyaltyRedeemPoints?: number | null;
};

export type OnlineOrderResult = {
  orderId: string;
  orderNumber: string;
  token: string;
  grandTotal: string;
  paymentStatus: string;
  duplicate: boolean;
};

const STOREFRONT_ACTOR_EMAIL = "storefront@bgd26.local";

async function storefrontActorId(tx: Prisma.TransactionClient): Promise<string> {
  const user = await tx.user.upsert({
    where: { email: STOREFRONT_ACTOR_EMAIL },
    update: {},
    create: {
      email: STOREFRONT_ACTOR_EMAIL,
      fullName: "Online storefront",
      status: "INACTIVE",
      locale: "bn",
    },
    select: { id: true },
  });
  return user.id;
}

async function resolveGuestCustomer(
  tx: Prisma.TransactionClient,
  mobileRaw: string,
  name: string,
): Promise<{ id: string; mobile: string }> {
  const normalized = tryNormalizeBdMobile(mobileRaw);
  if (!normalized) throw new StorefrontError("Enter a valid Bangladeshi mobile number.");
  if (normalized === "+8800000000000") {
    throw new StorefrontError("Enter your own mobile number, not the walk-in number.");
  }

  const existing = await tx.customer.findUnique({
    where: { mobileNormalized: normalized },
    select: { id: true, mobileNormalized: true },
  });
  if (existing) return { id: existing.id, mobile: existing.mobileNormalized };

  const created = await tx.customer.create({
    data: {
      mobileNormalized: normalized,
      mobileRaw,
      fullName: name,
      customerType: "RETAIL",
    },
    select: { id: true, mobileNormalized: true },
  });
  return { id: created.id, mobile: created.mobileNormalized };
}

function clean(value: string | undefined, max = 200): string {
  return (value ?? "").trim().slice(0, max);
}

/**
 * Which mobile owns a checkout.
 *
 * A signed-in customer always orders against the account's own mobile, whatever
 * the form posts, so loyalty and order history cannot land on another number. A
 * guest's typed number is normalised and must be a valid Bangladeshi mobile.
 */
export function checkoutMobile(
  accountMobile: string | null | undefined,
  typedMobile: string,
): string | null {
  return accountMobile ?? tryNormalizeBdMobile(typedMobile);
}

export async function placeOnlineOrder(
  input: OnlineOrderInput,
  cartToken: string | null,
): Promise<OnlineOrderResult> {
  if (!cartToken) throw new StorefrontError("Your cart is empty.");
  if (!STOREFRONT_PAYMENT_METHODS.includes(input.paymentMethod)) {
    throw new StorefrontError("Choose a payment method.");
  }

  const account = input.customerId
    ? await prisma.customer.findFirst({
        where: { id: input.customerId, deletedAt: null, status: "ACTIVE" },
        select: { id: true, fullName: true, mobileNormalized: true },
      })
    : null;
  if (input.customerId && !account) {
    throw new StorefrontError("Your account is not available. Please sign in again.");
  }

  const customerName = clean(input.customerName, 120) || account?.fullName || "";
  const address = clean(input.address, 400);
  const division = clean(input.division, 60);
  const district = clean(input.district, 60);
  const upazila = clean(input.upazila, 60);
  if (customerName.length < 2) throw new StorefrontError("Enter your full name.");
  if (address.length < 6) throw new StorefrontError("Enter your delivery address.");
  if (!division || !district) throw new StorefrontError("Choose your division and district.");

  // A signed-in customer always orders against their own number, whatever the
  // form says, so points and order history cannot land on another customer.
  const mobile = checkoutMobile(account?.mobileNormalized, input.customerMobile);
  if (!mobile) throw new StorefrontError("Enter a valid Bangladeshi mobile number.");

  const recipientName = clean(input.recipientName, 120) || customerName;
  const recipientMobile = tryNormalizeBdMobile(input.recipientMobile ?? "") ?? mobile;

  const reference = clean(input.paymentReference, 80);
  if (input.paymentMethod !== "COD" && reference.length < 6) {
    throw new StorefrontError("Enter the bKash/Nagad transaction id.");
  }

  const warehouse = await defaultWarehouse();
  if (!warehouse) throw new StorefrontError("The shop is not ready yet. Please try again later.");

  const zone = await prisma.deliveryZone.findFirst({
    where: { id: input.deliveryZoneId, isActive: true },
    select: {
      id: true,
      name: true,
      division: true,
      district: true,
      charge: true,
      freeShippingThreshold: true,
      estimatedDaysMin: true,
      estimatedDaysMax: true,
    },
  });
  if (!zone) throw new StorefrontError("Choose a delivery area.");
  if (zone.division !== division || zone.district !== district) {
    throw new StorefrontError("The delivery area does not match your district.");
  }

  return prisma.$transaction(
    async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "carts" WHERE "token" = ${cartToken} FOR UPDATE
      `;
      const cartId = locked[0]?.id;
      if (!cartId) throw new StorefrontError("Your cart has expired. Please add the items again.");

      const cart = await tx.cart.findUnique({
        where: { id: cartId },
        include: {
          coupon: { select: { code: true } },
          items: {
            include: {
              variant: {
                select: {
                  id: true,
                  price: true,
                  status: true,
                  product: {
                    select: {
                      status: true,
                      isPublished: true,
                      archivedAt: true,
                      category: { select: { vatPercentage: true } },
                    },
                  },
                },
              },
            },
          },
        },
      });
      if (!cart || cart.status !== "ACTIVE") {
        throw new StorefrontError("Your cart has expired. Please add the items again.");
      }
      if (cart.items.length === 0) throw new StorefrontError("Your cart is empty.");

      for (const item of cart.items) {
        if (
          item.variant.status !== "ACTIVE" ||
          item.variant.product.status !== "ACTIVE" ||
          !item.variant.product.isPublished ||
          item.variant.product.archivedAt
        ) {
          throw new StorefrontError("One of the items is no longer available. Please remove it.");
        }
      }

      const customer = await resolveGuestCustomer(tx, mobile, customerName);
      const actorUserId = await storefrontActorId(tx);

      const priced = cart.items.map((item) => ({
        quantity: item.quantity,
        unitPrice: item.variant.price,
        vatPercentage: item.variant.product.category.vatPercentage,
      }));
      const base = computeSaleTotals(priced, 0, zone.charge);
      const gross = base.subtotal.add(base.vatTotal);

      let deliveryCharge = money(zone.charge);
      if (zone.freeShippingThreshold !== null && gross.greaterThanOrEqualTo(zone.freeShippingThreshold)) {
        deliveryCharge = money(0);
      }

      const requestedCode =
        normalizeCouponCode(input.couponCode ?? "") || normalizeCouponCode(cart.coupon?.code ?? "");

      let couponId: string | null = null;
      let couponDiscount = money(0);
      let redemptionAmount = money(0);

      if (requestedCode) {
        couponId = await lockCoupon(tx, requestedCode);
        const quote = await quoteCoupon(
          {
            code: requestedCode,
            gross,
            deliveryCharge,
            customerId: customer.id,
          },
          tx,
        );
        couponDiscount = quote.freeShipping ? money(0) : quote.discount;
        redemptionAmount = quote.discount;
        if (quote.freeShipping) deliveryCharge = money(0);
      }

      const shippingAddress: Prisma.InputJsonValue = {
        name: recipientName,
        mobile: recipientMobile,
        address,
        division,
        district,
        ...(upazila ? { upazila } : {}),
        zone: zone.name,
      };

      const sale = await createSale(
        {
          source: "WEB",
          warehouseId: warehouse.id,
          customerName,
          customerMobile: mobile,
          recipientName,
          recipientMobile,
          shippingAddress,
          lines: cart.items.map((item) => ({
            variantId: item.variant.id,
            quantity: item.quantity,
          })),
          discountTotal: 0,
          deliveryCharge,
          deliveryZoneId: zone.id,
          coupon:
            couponId !== null
              ? { id: couponId, code: requestedCode, discount: couponDiscount }
              : null,
          payments:
            input.paymentMethod === "COD"
              ? [{ method: "COD" }]
              : [{ method: input.paymentMethod, reference }],
          note: clean(input.note, 500) || null,
          loyaltyRedeemPoints: account
            ? Math.max(0, Math.trunc(Number(input.loyaltyRedeemPoints ?? 0)))
            : 0,
          clientTransactionUuid: input.idempotencyKey ?? null,
          actorUserId,
        },
        tx,
      );

      if (!sale.duplicate && couponId !== null) {
        await recordCouponRedemption(tx, {
          couponId,
          orderId: sale.orderId,
          customerId: sale.customerId,
          discountAmount: redemptionAmount,
        });
      }

      if (!sale.duplicate) {
        await tx.cart.update({
          where: { id: cart.id },
          data: {
            status: "CONVERTED",
            customerId: sale.customerId,
            couponId,
            deliveryCharge,
            grandTotal: sale.grandTotal,
          },
        });
      }

      return {
        orderId: sale.orderId,
        orderNumber: sale.orderNumber,
        token: signOrderAccessToken({
          orderId: sale.orderId,
          orderNumber: sale.orderNumber,
          mobile: customer.mobile,
        }),
        grandTotal: sale.grandTotal.toFixed(2),
        paymentStatus: sale.grandTotal.isZero() ? "PAID" : "PENDING_VERIFICATION",
        duplicate: sale.duplicate,
      };
    },
    { maxWait: 5_000, timeout: 20_000 },
  );
}

/* -------------------------------------------------------------------------- */
/* Order access                                                               */
/* -------------------------------------------------------------------------- */

export type PublicOrder = {
  orderNumber: string;
  status: string;
  paymentStatus: string;
  fulfillmentStatus: string;
  placedAt: string;
  recipientName: string;
  recipientMobile: string;
  shippingAddress: Record<string, unknown> | null;
  subtotal: string;
  discountTotal: string;
  couponDiscount: string;
  vatTotal: string;
  deliveryCharge: string;
  grandTotal: string;
  paidAmount: string;
  dueAmount: string;
  customerNote: string | null;
  couponCode: string | null;
  deliveryZone: string | null;
  items: Array<{
    name: string;
    variantName: string | null;
    sku: string;
    quantity: number;
    unitPrice: string;
    lineTotal: string;
    imageUrl: string | null;
  }>;
  payments: Array<{ method: string; status: string; amount: string; reference: string | null }>;
  timeline: Array<{ field: string; value: string; note: string | null; at: string }>;
};

export async function getOrderForGuest(
  orderNumber: string,
  token: string | null,
): Promise<PublicOrder | null> {
  if (!token) return null;
  const access = verifyOrderAccessToken(token);
  if (!access || access.orderNumber !== orderNumber) return null;

  const order = await prisma.order.findFirst({
    where: { id: access.orderId, orderNumber, channel: "ONLINE" },
    select: {
      orderNumber: true,
      status: true,
      paymentStatus: true,
      fulfillmentStatus: true,
      placedAt: true,
      recipientName: true,
      recipientMobile: true,
      shippingAddress: true,
      subtotal: true,
      discountTotal: true,
      couponDiscount: true,
      vatTotal: true,
      deliveryCharge: true,
      grandTotal: true,
      paidAmount: true,
      dueAmount: true,
      customerNote: true,
      coupon: { select: { code: true } },
      deliveryZone: { select: { name: true, estimatedDaysMin: true, estimatedDaysMax: true } },
      items: {
        select: {
          productNameSnapshot: true,
          variantNameSnapshot: true,
          skuSnapshot: true,
          quantity: true,
          unitPrice: true,
          lineTotal: true,
          product: {
            select: {
              media: {
                where: { isPrimary: true, mediaAsset: { visibility: "PUBLIC" } },
                take: 1,
                select: { mediaAsset: { select: { storageKey: true } } },
              },
            },
          },
        },
      },
      payments: {
        orderBy: { createdAt: "asc" },
        select: { method: true, status: true, amount: true, notes: true },
      },
      statusHistory: {
        orderBy: { createdAt: "asc" },
        select: { field: true, toValue: true, note: true, createdAt: true },
      },
    },
  });
  if (!order) return null;

  return {
    orderNumber: order.orderNumber,
    status: order.status,
    paymentStatus: order.paymentStatus,
    fulfillmentStatus: order.fulfillmentStatus,
    placedAt: order.placedAt.toISOString(),
    recipientName: order.recipientName,
    recipientMobile: order.recipientMobile,
    shippingAddress:
      order.shippingAddress && typeof order.shippingAddress === "object"
        ? (order.shippingAddress as Record<string, unknown>)
        : null,
    subtotal: money(order.subtotal).toFixed(2),
    discountTotal: money(order.discountTotal).toFixed(2),
    couponDiscount: money(order.couponDiscount).toFixed(2),
    vatTotal: money(order.vatTotal).toFixed(2),
    deliveryCharge: money(order.deliveryCharge).toFixed(2),
    grandTotal: money(order.grandTotal).toFixed(2),
    paidAmount: money(order.paidAmount).toFixed(2),
    dueAmount: money(order.dueAmount).toFixed(2),
    customerNote: order.customerNote,
    couponCode: order.coupon?.code ?? null,
    deliveryZone: order.deliveryZone
      ? `${order.deliveryZone.name} · ${order.deliveryZone.estimatedDaysMin}–${order.deliveryZone.estimatedDaysMax} days`
      : null,
    items: order.items.map((item) => ({
      name: item.productNameSnapshot,
      variantName: item.variantNameSnapshot,
      sku: item.skuSnapshot,
      quantity: Number(item.quantity),
      unitPrice: money(item.unitPrice).toFixed(2),
      lineTotal: money(item.lineTotal).toFixed(2),
      imageUrl: item.product?.media[0]
        ? `/media/${item.product.media[0].mediaAsset.storageKey}`
        : null,
    })),
    payments: order.payments.map((payment) => ({
      method: payment.method,
      status: payment.status,
      amount: money(payment.amount).toFixed(2),
      reference: payment.notes,
    })),
    timeline: order.statusHistory.map((entry) => ({
      field: entry.field,
      value: entry.toValue,
      note: entry.note,
      at: entry.createdAt.toISOString(),
    })),
  };
}

/** Prove ownership with order number + mobile, then issue a fresh link. */
export async function issueOrderAccessToken(
  orderNumber: string,
  mobile: string,
): Promise<{ token: string; orderNumber: string } | null> {
  const normalized = tryNormalizeBdMobile(mobile);
  if (!normalized) return null;

  const order = await prisma.order.findFirst({
    where: {
      orderNumber: orderNumber.trim(),
      channel: "ONLINE",
      OR: [{ recipientMobile: normalized }, { customer: { mobileNormalized: normalized } }],
    },
    select: { id: true, orderNumber: true, recipientMobile: true },
  });
  if (!order) return null;

  return {
    token: signOrderAccessToken({
      orderId: order.id,
      orderNumber: order.orderNumber,
      mobile: normalized,
    }),
    orderNumber: order.orderNumber,
  };
}
