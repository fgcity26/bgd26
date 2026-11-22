import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { money } from "@/lib/inventory/decimal";

/**
 * A customer's own order history.
 *
 * Every query filters on `customerId`, never on a mobile number from the URL, so
 * one account can never read another account's orders. Guests keep using the
 * signed order link; this is the signed-in view.
 */
export async function listCustomerOrders(
  customerId: string,
  take = 50,
  outer?: Prisma.TransactionClient,
) {
  return (outer ?? prisma).order.findMany({
    where: { customerId },
    orderBy: { placedAt: "desc" },
    take,
    select: {
      id: true,
      orderNumber: true,
      status: true,
      paymentStatus: true,
      fulfillmentStatus: true,
      grandTotal: true,
      placedAt: true,
      loyaltyEarnedPoints: true,
      loyaltyRedeemedPoints: true,
      coupon: { select: { code: true } },
      _count: { select: { items: true } },
      items: {
        take: 1,
        orderBy: { createdAt: "asc" },
        select: { productNameSnapshot: true },
      },
    },
  });
}

export async function customerOrderDetail(
  customerId: string,
  orderId: string,
  outer?: Prisma.TransactionClient,
) {
  const order = await (outer ?? prisma).order.findFirst({
    where: { id: orderId, customerId },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      paymentStatus: true,
      fulfillmentStatus: true,
      placedAt: true,
      recipientName: true,
      recipientMobile: true,
      shippingAddress: true,
      customerNote: true,
      subtotal: true,
      discountTotal: true,
      couponDiscount: true,
      vatTotal: true,
      deliveryCharge: true,
      loyaltyRedeemedPoints: true,
      loyaltyDiscount: true,
      loyaltyEarnedPoints: true,
      grandTotal: true,
      paidAmount: true,
      dueAmount: true,
      coupon: { select: { code: true } },
      deliveryZone: {
        select: { name: true, estimatedDaysMin: true, estimatedDaysMax: true },
      },
      items: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
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
        select: { method: true, status: true, amount: true, notes: true, createdAt: true },
      },
      shipments: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          shipmentNumber: true,
          status: true,
          trackingNumber: true,
          courier: { select: { name: true } },
          shippedAt: true,
          deliveredAt: true,
          trackingEvents: {
            orderBy: { eventAt: "desc" },
            take: 8,
            select: { id: true, status: true, message: true, eventAt: true },
          },
        },
      },
      statusHistory: {
        orderBy: { createdAt: "asc" },
        select: { field: true, toValue: true, note: true, createdAt: true },
      },
    },
  });
  if (!order) return null;

  return {
    ...order,
    subtotal: money(order.subtotal).toFixed(2),
    discountTotal: money(order.discountTotal).toFixed(2),
    couponDiscount: money(order.couponDiscount).toFixed(2),
    vatTotal: money(order.vatTotal).toFixed(2),
    deliveryCharge: money(order.deliveryCharge).toFixed(2),
    loyaltyDiscount: money(order.loyaltyDiscount).toFixed(2),
    grandTotal: money(order.grandTotal).toFixed(2),
    paidAmount: money(order.paidAmount).toFixed(2),
    dueAmount: money(order.dueAmount).toFixed(2),
    items: order.items.map((item) => ({
      ...item,
      unitPrice: money(item.unitPrice).toFixed(2),
      lineTotal: money(item.lineTotal).toFixed(2),
      quantity: Number(item.quantity),
      imageUrl: item.product?.media[0]
        ? `/media/${item.product.media[0].mediaAsset.storageKey}`
        : null,
    })),
    payments: order.payments.map((payment) => ({
      ...payment,
      amount: money(payment.amount).toFixed(2),
    })),
  };
}

export type CustomerOrderDetail = NonNullable<Awaited<ReturnType<typeof customerOrderDetail>>>;
