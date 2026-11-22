import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";

/**
 * POS search.
 *
 * The counter needs an answer in well under 50 ms on a warm connection, so the
 * query only touches indexed columns (SKU, barcode) plus a bounded `contains`
 * scan, and it never joins media, reviews or cost prices. Cost price is
 * deliberately absent: a cashier response must not leak margin.
 */
export type PosVariant = {
  variantId: string;
  sku: string;
  barcode: string | null;
  name: string;
  productName: string;
  price: string;
  vatPercentage: string;
  fulfillmentType: string;
  /** Sellable quantity in the requested warehouse (or everywhere). */
  available: string;
};

type VariantRow = {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  price: Prisma.Decimal;
  fulfillmentType: string;
  product: { name: string; category: { vatPercentage: Prisma.Decimal } };
  inventoryBalances: Array<{ availableQty: Prisma.Decimal }>;
};

function toPosVariant(row: VariantRow): PosVariant {
  const available = row.inventoryBalances.reduce(
    (sum, balance) => sum.add(balance.availableQty),
    new Prisma.Decimal(0),
  );
  return {
    variantId: row.id,
    sku: row.sku,
    barcode: row.barcode,
    name: row.name,
    productName: row.product.name,
    price: row.price.toString(),
    vatPercentage: row.product.category.vatPercentage.toString(),
    fulfillmentType: row.fulfillmentType,
    available: available.toString(),
  };
}

function variantSelect(warehouseId?: string | null) {
  return {
    id: true,
    sku: true,
    barcode: true,
    name: true,
    price: true,
    fulfillmentType: true,
    product: { select: { name: true, category: { select: { vatPercentage: true } } } },
    inventoryBalances: {
      ...(warehouseId ? { where: { warehouseId } } : {}),
      select: { availableQty: true },
    },
  } as const;
}

function whereFor(query: string): Prisma.ProductVariantWhereInput {
  return {
    status: "ACTIVE",
    product: { status: "ACTIVE" },
    ...(query
      ? {
          OR: [
            { sku: { contains: query, mode: "insensitive" } },
            { barcode: { contains: query, mode: "insensitive" } },
            { name: { contains: query, mode: "insensitive" } },
            { product: { name: { contains: query, mode: "insensitive" } } },
          ],
        }
      : {}),
  };
}

export async function searchPosVariants(input: {
  query: string;
  warehouseId?: string | null;
  limit?: number;
}): Promise<PosVariant[]> {
  const query = input.query.trim();
  const rows = await prisma.productVariant.findMany({
    where: whereFor(query),
    orderBy: [{ sku: "asc" }],
    take: Math.min(Math.max(input.limit ?? 20, 1), 50),
    select: variantSelect(input.warehouseId),
  });
  return (rows as VariantRow[]).map(toPosVariant);
}

/**
 * A bounded catalogue snapshot for the offline cache. The device stores it and
 * searches locally when the network is gone; prices are only a hint until the
 * server prices the sale again.
 */
export async function posCatalog(input: {
  warehouseId?: string | null;
  limit?: number;
}): Promise<PosVariant[]> {
  const rows = await prisma.productVariant.findMany({
    where: whereFor(""),
    orderBy: [{ sku: "asc" }],
    take: Math.min(Math.max(input.limit ?? 500, 1), 1000),
    select: variantSelect(input.warehouseId),
  });
  return (rows as VariantRow[]).map(toPosVariant);
}
