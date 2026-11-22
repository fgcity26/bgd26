import { randomBytes } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { money, type Numeric } from "@/lib/inventory/decimal";
import { computeSaleTotals } from "@/lib/orders/totals";
import { defaultWarehouse } from "./catalog";
import { readCartToken, writeCartToken } from "./cart-cookie";
import { normalizeCouponCode, quoteCoupon, type CouponQuote } from "./coupons";
import { StorefrontError } from "./errors";

/**
 * Guest cart.
 *
 * Prices are always re-read from the catalogue; the `unitPrice` stored on a
 * cart line is a display snapshot, never the amount charged. A cart is a soft
 * hold only — stock is consumed when the order is placed, not while browsing.
 */

export type CartLineView = {
  itemId: string;
  variantId: string;
  productSlug: string;
  productName: string;
  variantName: string;
  sku: string;
  imageUrl: string | null;
  unitPrice: string;
  quantity: number;
  lineTotal: string;
  available: boolean;
  maxQuantity: number | null;
};

export type CartView = {
  token: string;
  itemCount: number;
  merchandiseTotal: string;
  subtotal: string;
  vatTotal: string;
  couponDiscount: string;
  deliveryCharge: string;
  grandTotal: string;
  coupon: {
    code: string;
    name: string;
    type: string;
    discount: string;
    freeShipping: boolean;
  } | null;
  couponNotice: string | null;
  lines: CartLineView[];
};

const CART_EXPIRY_DAYS = 30;
const MAX_LINE_QUANTITY = 99;

function expiryFromNow(): Date {
  return new Date(Date.now() + CART_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
}

function moneyString(value: unknown): string {
  return money(String(value)).toFixed(2);
}

async function loadCart(token: string, warehouseId: string) {
  return prisma.cart.findUnique({
    where: { token },
    include: {
      coupon: {
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
      },
      items: {
        orderBy: { createdAt: "asc" },
        include: {
          variant: {
            select: {
              id: true,
              sku: true,
              name: true,
              price: true,
              status: true,
              fulfillmentType: true,
              inventoryBalances: {
                where: { warehouseId },
                select: { availableQty: true },
              },
              product: {
                select: {
                  name: true,
                  slug: true,
                  status: true,
                  isPublished: true,
                  category: { select: { vatPercentage: true } },
                  media: {
                    where: { isPrimary: true, mediaAsset: { visibility: "PUBLIC" } },
                    take: 1,
                    select: { mediaAsset: { select: { storageKey: true } } },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
}

type LoadedCart = NonNullable<Awaited<ReturnType<typeof loadCart>>>;

function variantAvailable(variant: LoadedCart["items"][number]["variant"]): {
  available: boolean;
  maxQuantity: number | null;
} {
  if (variant.fulfillmentType !== "STOCKED") {
    return { available: true, maxQuantity: null };
  }
  const availableQty = variant.inventoryBalances.reduce(
    (sum, balance) => sum + Number(balance.availableQty),
    0,
  );
  return {
    available: availableQty > 0,
    maxQuantity: Math.max(0, Math.floor(availableQty)),
  };
}

async function buildView(
  cart: LoadedCart,
): Promise<{ view: CartView; couponId: string | null; quote: CouponQuote | null }> {
  const lines: CartLineView[] = [];
  const priced: Array<{ quantity: Numeric; unitPrice: Numeric; vatPercentage: Numeric }> = [];

  for (const item of cart.items) {
    const variant = item.variant;
    const stock = variantAvailable(variant);
    const lineTotal = money(variant.price.mul(item.quantity));
    lines.push({
      itemId: item.id,
      variantId: variant.id,
      productSlug: variant.product.slug,
      productName: variant.product.name,
      variantName: variant.name,
      sku: variant.sku,
      imageUrl: variant.product.media[0]
        ? `/media/${variant.product.media[0].mediaAsset.storageKey}`
        : null,
      unitPrice: moneyString(variant.price),
      quantity: Number(item.quantity),
      lineTotal: lineTotal.toFixed(2),
      available: stock.available,
      maxQuantity: stock.maxQuantity,
    });
    priced.push({
      quantity: item.quantity,
      unitPrice: variant.price,
      vatPercentage: variant.product.category.vatPercentage,
    });
  }

  let coupon: CartView["coupon"] = null;
  let couponNotice: string | null = null;
  let couponId: string | null = null;
  let quote: CouponQuote | null = null;
  let couponDiscount = money(0);

  if (cart.items.length > 0) {
    const base = computeSaleTotals(priced, 0, 0);
    if (cart.coupon) {
      try {
        quote = await quoteCoupon(
          {
            code: cart.coupon.code,
            gross: base.subtotal.add(base.vatTotal),
            customerId: cart.customerId,
          },
          prisma,
        );
        couponId = quote.couponId;
        couponDiscount = quote.discount;
        coupon = {
          code: quote.code,
          name: quote.name,
          type: quote.type,
          discount: quote.discount.toFixed(2),
          freeShipping: quote.freeShipping,
        };
      } catch (error) {
        if (!(error instanceof StorefrontError)) throw error;
        couponNotice = error.message;
      }
    }

    const totals = computeSaleTotals(priced, couponDiscount, 0);
    return {
      view: {
        token: cart.token,
        itemCount: lines.reduce((sum, line) => sum + line.quantity, 0),
        merchandiseTotal: totals.subtotal.add(totals.vatTotal).toFixed(2),
        subtotal: totals.subtotal.toFixed(2),
        vatTotal: totals.vatTotal.toFixed(2),
        couponDiscount: totals.discountTotal.toFixed(2),
        deliveryCharge: "0.00",
        grandTotal: totals.grandTotal.toFixed(2),
        coupon,
        couponNotice,
        lines,
      },
      couponId,
      quote,
    };
  }

  return {
    view: {
      token: cart.token,
      itemCount: 0,
      merchandiseTotal: "0.00",
      subtotal: "0.00",
      vatTotal: "0.00",
      couponDiscount: "0.00",
      deliveryCharge: "0.00",
      grandTotal: "0.00",
      coupon: null,
      couponNotice: null,
      lines,
    },
    couponId: null,
    quote: null,
  };
}

async function persistTotals(
  tx: Prisma.TransactionClient,
  cartId: string,
  view: CartView,
  couponId: string | null,
): Promise<void> {
  await tx.cart.update({
    where: { id: cartId },
    data: {
      couponId,
      subtotal: view.subtotal,
      discountTotal: view.couponDiscount,
      vatTotal: view.vatTotal,
      deliveryCharge: view.deliveryCharge,
      grandTotal: view.grandTotal,
      expiresAt: expiryFromNow(),
    },
  });
}

async function requireWarehouseId(): Promise<string> {
  const warehouse = await defaultWarehouse();
  if (!warehouse) {
    throw new StorefrontError("The shop is not ready yet. Please try again later.");
  }
  return warehouse.id;
}

/** Read the current cart without creating one. Used by pages. */
export async function getCartView(): Promise<CartView | null> {
  const token = await readCartToken();
  if (!token) return null;
  const warehouseId = await requireWarehouseId();
  const cart = await loadCart(token, warehouseId);
  if (!cart || cart.status !== "ACTIVE") return null;
  const { view } = await buildView(cart);
  return view;
}

/** Cart count for the header badge. */
export async function getCartCount(): Promise<number> {
  const token = await readCartToken();
  if (!token) return 0;
  const cart = await prisma.cart.findUnique({
    where: { token },
    select: { status: true, items: { select: { quantity: true } } },
  });
  if (!cart || cart.status !== "ACTIVE") return 0;
  return cart.items.reduce((sum, item) => sum + Number(item.quantity), 0);
}

async function getOrCreateCart(): Promise<{ id: string; token: string }> {
  const existingToken = await readCartToken();
  if (existingToken) {
    const existing = await prisma.cart.findUnique({
      where: { token: existingToken },
      select: { id: true, token: true, status: true, expiresAt: true },
    });
    if (existing && existing.status === "ACTIVE") {
      if (!existing.expiresAt || existing.expiresAt > new Date()) {
        return { id: existing.id, token: existing.token };
      }
      await prisma.cart.update({
        where: { id: existing.id },
        data: { status: "EXPIRED" },
      });
    }
  }

  const token = randomBytes(24).toString("base64url");
  const cart = await prisma.cart.create({
    data: {
      token,
      channel: "ONLINE",
      status: "ACTIVE",
      expiresAt: expiryFromNow(),
    },
    select: { id: true, token: true },
  });
  await writeCartToken(cart.token);
  return cart;
}

async function currentCart(): Promise<{ id: string; token: string }> {
  return getOrCreateCart();
}

async function reloadAndPersist(cartId: string, token: string): Promise<CartView> {
  const warehouseId = await requireWarehouseId();
  return prisma.$transaction(async (tx) => {
    const cart = await tx.cart.findUnique({
      where: { id: cartId },
      include: {
        coupon: {
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
        },
        items: {
          orderBy: { createdAt: "asc" },
          include: {
            variant: {
              select: {
                id: true,
                sku: true,
                name: true,
                price: true,
                status: true,
                fulfillmentType: true,
                inventoryBalances: {
                  where: { warehouseId },
                  select: { availableQty: true },
                },
                product: {
                  select: {
                    name: true,
                    slug: true,
                    status: true,
                    isPublished: true,
                    category: { select: { vatPercentage: true } },
                    media: {
                      where: { isPrimary: true, mediaAsset: { visibility: "PUBLIC" } },
                      take: 1,
                      select: { mediaAsset: { select: { storageKey: true } } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!cart || cart.token !== token) throw new StorefrontError("Your cart has expired.");
    const { view, couponId } = await buildView(cart);
    await persistTotals(tx, cart.id, view, couponId);
    return view;
  });
}

async function assertPurchasableVariant(
  variantId: string,
  requestedQuantity: number,
): Promise<{ maxQuantity: number | null }> {
  if (!Number.isFinite(requestedQuantity) || requestedQuantity <= 0) {
    throw new StorefrontError("Choose a quantity greater than zero.");
  }
  const warehouseId = await requireWarehouseId();
  const variant = await prisma.productVariant.findUnique({
    where: { id: variantId },
    select: {
      id: true,
      status: true,
      fulfillmentType: true,
      inventoryBalances: {
        where: { warehouseId },
        select: { availableQty: true },
      },
      product: { select: { status: true, isPublished: true, archivedAt: true } },
    },
  });
  if (
    !variant ||
    variant.status !== "ACTIVE" ||
    variant.product.status !== "ACTIVE" ||
    !variant.product.isPublished ||
    variant.product.archivedAt
  ) {
    throw new StorefrontError("That item is no longer available.");
  }
  if (variant.fulfillmentType !== "STOCKED") return { maxQuantity: null };

  const availableQty = Math.floor(
    variant.inventoryBalances.reduce((sum, balance) => sum + Number(balance.availableQty), 0),
  );
  if (availableQty <= 0) throw new StorefrontError("That item is out of stock.");
  if (requestedQuantity > availableQty) {
    throw new StorefrontError(`Only ${availableQty} left in stock.`);
  }
  return { maxQuantity: availableQty };
}

export async function addToCart(variantId: string, quantity = 1): Promise<CartView> {
  const wanted = Math.trunc(quantity);
  if (wanted < 1 || wanted > MAX_LINE_QUANTITY) {
    throw new StorefrontError(`Choose between 1 and ${MAX_LINE_QUANTITY} items.`);
  }
  const cart = await currentCart();
  const existing = await prisma.cartItem.findUnique({
    where: { cartId_variantId: { cartId: cart.id, variantId } },
    select: { id: true, quantity: true },
  });
  const nextQuantity = Math.trunc(Number(existing?.quantity ?? 0)) + wanted;
  if (nextQuantity > MAX_LINE_QUANTITY) {
    throw new StorefrontError(`You can buy at most ${MAX_LINE_QUANTITY} of one item.`);
  }
  await assertPurchasableVariant(variantId, nextQuantity);

  if (existing) {
    await prisma.cartItem.update({
      where: { id: existing.id },
      data: { quantity: nextQuantity },
    });
  } else {
    const variant = await prisma.productVariant.findUniqueOrThrow({
      where: { id: variantId },
      select: { price: true },
    });
    await prisma.cartItem.create({
      data: {
        cartId: cart.id,
        variantId,
        quantity: nextQuantity,
        unitPrice: variant.price,
      },
    });
  }

  return reloadAndPersist(cart.id, cart.token);
}

export async function updateCartItem(itemId: string, quantity: number): Promise<CartView> {
  const cart = await currentCart();
  const item = await prisma.cartItem.findUnique({
    where: { id: itemId },
    select: { id: true, cartId: true, variantId: true },
  });
  if (!item || item.cartId !== cart.id) {
    throw new StorefrontError("That cart line no longer exists.");
  }

  const wanted = Math.trunc(quantity);
  if (wanted <= 0) return removeCartItem(itemId);
  if (wanted > MAX_LINE_QUANTITY) {
    throw new StorefrontError(`You can buy at most ${MAX_LINE_QUANTITY} of one item.`);
  }
  await assertPurchasableVariant(item.variantId, wanted);
  await prisma.cartItem.update({ where: { id: item.id }, data: { quantity: wanted } });
  return reloadAndPersist(cart.id, cart.token);
}

export async function removeCartItem(itemId: string): Promise<CartView> {
  const cart = await currentCart();
  const item = await prisma.cartItem.findUnique({
    where: { id: itemId },
    select: { id: true, cartId: true },
  });
  if (!item || item.cartId !== cart.id) {
    throw new StorefrontError("That cart line no longer exists.");
  }
  await prisma.cartItem.delete({ where: { id: item.id } });
  return reloadAndPersist(cart.id, cart.token);
}

export async function applyCoupon(code: string): Promise<CartView> {
  const cart = await currentCart();
  const warehouseId = await requireWarehouseId();
  const loaded = await loadCart(cart.token, warehouseId);
  if (!loaded || loaded.items.length === 0) {
    throw new StorefrontError("Add an item before applying a coupon.");
  }

  const priced = loaded.items.map((item) => ({
    quantity: item.quantity,
    unitPrice: item.variant.price,
    vatPercentage: item.variant.product.category.vatPercentage,
  }));
  const base = computeSaleTotals(priced, 0, 0);
  const quote = await quoteCoupon({
    code: normalizeCouponCode(code),
    gross: base.subtotal.add(base.vatTotal),
    customerId: loaded.customerId,
  });

  await prisma.cart.update({
    where: { id: cart.id },
    data: { couponId: quote.couponId },
  });
  return reloadAndPersist(cart.id, cart.token);
}

export async function clearCoupon(): Promise<CartView> {
  const cart = await currentCart();
  await prisma.cart.update({ where: { id: cart.id }, data: { couponId: null } });
  return reloadAndPersist(cart.id, cart.token);
}

/** Recompute and persist an existing cart inside a caller's transaction. */
export async function recomputeCart(
  tx: Prisma.TransactionClient,
  cartId: string,
): Promise<{ view: CartView; couponId: string | null; quote: CouponQuote | null }> {
  const warehouseId = await requireWarehouseId();
  const cart = await tx.cart.findUnique({
    where: { id: cartId },
    include: {
      coupon: {
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
      },
      items: {
        orderBy: { createdAt: "asc" },
        include: {
          variant: {
            select: {
              id: true,
              sku: true,
              name: true,
              price: true,
              status: true,
              fulfillmentType: true,
              inventoryBalances: {
                where: { warehouseId },
                select: { availableQty: true },
              },
              product: {
                select: {
                  name: true,
                  slug: true,
                  status: true,
                  isPublished: true,
                  category: { select: { vatPercentage: true } },
                  media: {
                    where: { isPrimary: true, mediaAsset: { visibility: "PUBLIC" } },
                    take: 1,
                    select: { mediaAsset: { select: { storageKey: true } } },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!cart) throw new StorefrontError("Your cart has expired.");
  const built = await buildView(cart);
  await persistTotals(tx, cart.id, built.view, built.couponId);
  return built;
}

export { CART_EXPIRY_DAYS, MAX_LINE_QUANTITY };
