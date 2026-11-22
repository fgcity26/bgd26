import { prisma } from "@/lib/db";

/**
 * Product rating aggregate.
 *
 * `products.ratingAverage` / `ratingCount` are denormalised so the storefront
 * can sort without joining reviews. They are recomputed from APPROVED reviews
 * only, every time moderation changes a status. Hidden, pending and rejected
 * reviews never affect the score.
 */
export async function recomputeProductRating(
  productId: string,
): Promise<{ average: number; count: number }> {
  const aggregate = await prisma.productReview.aggregate({
    where: { productId, status: "APPROVED" },
    _avg: { rating: true },
    _count: { _all: true },
  });

  const average = aggregate._avg.rating ?? 0;
  const count = aggregate._count._all;

  await prisma.product.update({
    where: { id: productId },
    data: {
      ratingAverage: average.toFixed(2),
      ratingCount: count,
    },
  });

  return { average, count };
}
