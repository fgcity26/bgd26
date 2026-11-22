"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { readCartToken, clearCartToken } from "@/lib/storefront/cart-cookie";
import {
  addToCart,
  applyCoupon,
  clearCoupon,
  removeCartItem,
  updateCartItem,
} from "@/lib/storefront/cart";
import {
  issueOrderAccessToken,
  placeOnlineOrder,
  type StorefrontPaymentMethod,
} from "@/lib/storefront/checkout";
import { StorefrontError } from "@/lib/storefront/errors";
import type { StorefrontActionState } from "@/lib/storefront/action-state";
import { getCustomerSession } from "@/lib/customer-auth/session";

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function explain(error: unknown): StorefrontActionState {
  if (error instanceof StorefrontError) return { error: error.message };
  if (
    error instanceof Error &&
    ["OrdersError", "LoyaltyError", "AccountingError"].includes(error.name)
  ) {
    return { error: error.message };
  }
  throw error;
}

export async function addToCartAction(
  _previous: StorefrontActionState,
  formData: FormData,
): Promise<StorefrontActionState> {
  try {
    const quantity = Number(text(formData, "quantity") || "1");
    await addToCart(text(formData, "variantId"), quantity);
    revalidatePath("/cart");
    revalidatePath("/checkout");
    return { ok: "Added to your cart." };
  } catch (error) {
    return explain(error);
  }
}

export async function updateCartItemAction(
  _previous: StorefrontActionState,
  formData: FormData,
): Promise<StorefrontActionState> {
  try {
    await updateCartItem(text(formData, "itemId"), Number(text(formData, "quantity") || "1"));
    revalidatePath("/cart");
    revalidatePath("/checkout");
    return { ok: "Cart updated." };
  } catch (error) {
    return explain(error);
  }
}

export async function removeCartItemAction(
  _previous: StorefrontActionState,
  formData: FormData,
): Promise<StorefrontActionState> {
  try {
    await removeCartItem(text(formData, "itemId"));
    revalidatePath("/cart");
    revalidatePath("/checkout");
    return { ok: "Item removed." };
  } catch (error) {
    return explain(error);
  }
}

export async function applyCouponAction(
  _previous: StorefrontActionState,
  formData: FormData,
): Promise<StorefrontActionState> {
  try {
    await applyCoupon(text(formData, "code"));
    revalidatePath("/cart");
    revalidatePath("/checkout");
    return { ok: "Coupon applied." };
  } catch (error) {
    return explain(error);
  }
}

export async function clearCouponAction(
  _previous: StorefrontActionState,
  _formData: FormData,
): Promise<StorefrontActionState> {
  void _previous;
  void _formData;
  try {
    await clearCoupon();
    revalidatePath("/cart");
    revalidatePath("/checkout");
    return { ok: "Coupon removed." };
  } catch (error) {
    return explain(error);
  }
}

export async function placeOrderAction(
  _previous: StorefrontActionState,
  formData: FormData,
): Promise<StorefrontActionState> {
  let destination: string;
  try {
    const method = text(formData, "paymentMethod") as StorefrontPaymentMethod;
    const customer = await getCustomerSession();
    const result = await placeOnlineOrder(
      {
        customerName: text(formData, "customerName"),
        customerMobile: text(formData, "customerMobile"),
        recipientName: text(formData, "recipientName"),
        recipientMobile: text(formData, "recipientMobile"),
        address: text(formData, "address"),
        division: text(formData, "division"),
        district: text(formData, "district"),
        upazila: text(formData, "upazila"),
        deliveryZoneId: text(formData, "deliveryZoneId"),
        paymentMethod: method,
        paymentReference: text(formData, "paymentReference"),
        note: text(formData, "note"),
        couponCode: text(formData, "couponCode"),
        idempotencyKey: text(formData, "idempotencyKey") || randomUUID(),
        customerId: customer?.id ?? null,
        loyaltyRedeemPoints: Number(text(formData, "loyaltyRedeemPoints") || "0"),
      },
      await readCartToken(),
    );
    destination = `/order/${encodeURIComponent(result.orderNumber)}?t=${encodeURIComponent(result.token)}`;
  } catch (error) {
    return explain(error);
  }

  await clearCartToken();
  revalidatePath("/cart");
  redirect(destination);
}

export async function trackOrderAction(
  _previous: StorefrontActionState,
  formData: FormData,
): Promise<StorefrontActionState> {
  try {
    const result = await issueOrderAccessToken(
      text(formData, "orderNumber"),
      text(formData, "mobile"),
    );
    if (!result) {
      return { error: "No online order matches that order number and mobile." };
    }
    redirect(
      `/order/${encodeURIComponent(result.orderNumber)}?t=${encodeURIComponent(result.token)}`,
    );
  } catch (error) {
    if (error instanceof StorefrontError) return { error: error.message };
    throw error;
  }
}
