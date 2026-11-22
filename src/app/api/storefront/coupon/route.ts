import { getCartView } from "@/lib/storefront/cart";
import { quoteCoupon } from "@/lib/storefront/coupons";
import { StorefrontError } from "@/lib/storefront/errors";

/**
 * Preview a coupon without attaching it to the cart. The checkout page uses
 * this to show the saving before the shopper submits the order; the real
 * validation and redemption happen again inside the checkout transaction.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Send a JSON body." }, { status: 400 });
  }

  const code =
    typeof body === "object" && body !== null && "code" in body
      ? String((body as { code: unknown }).code ?? "")
      : "";

  const cart = await getCartView();
  if (!cart || cart.lines.length === 0) {
    return Response.json({ error: "Your cart is empty." }, { status: 400 });
  }

  try {
    const quote = await quoteCoupon({
      code,
      gross: Number(cart.subtotal) + Number(cart.vatTotal),
    });
    return Response.json({
      ok: true,
      code: quote.code,
      name: quote.name,
      discount: quote.discount.toFixed(2),
      freeShipping: quote.freeShipping,
    });
  } catch (error) {
    if (error instanceof StorefrontError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
