import { getCartCount } from "@/lib/storefront/cart";

/**
 * Cart badge endpoint.
 *
 * Catalogue pages stay cacheable because the header asks this route for the
 * count instead of reading the cart cookie during the page render.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const count = await getCartCount();
  return Response.json(
    { count },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
