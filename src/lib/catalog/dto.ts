import type { Prisma } from "@/generated/prisma/client";
import { hasAnyPermission } from "@/lib/auth/permissions";

/**
 * Cost-price visibility.
 *
 * Cost prices are commercially sensitive. A DTO serializer — not a UI condition
 * — removes them, so a forgotten `select` can never leak them to a cashier or
 * stock keeper. Accountants and reporters may see them.
 */
export const COST_VISIBILITY_PERMISSIONS = ["account.read", "report.read"] as const;

export function canViewCostPrices(session: {
  permissions: ReadonlySet<string>;
}): boolean {
  return hasAnyPermission(session, COST_VISIBILITY_PERMISSIONS);
}

export type ProductWithRelations = Prisma.ProductGetPayload<{
  include: {
    category: { select: { id: true; name: true; nameBn: true; slug: true; vatPercentage: true } };
    brand: { select: { id: true; name: true; slug: true } };
    variants: true;
    media: { include: { mediaAsset: true } };
  };
}>;

export type MediaView = {
  productMediaId: string;
  mediaAssetId: string;
  role: string;
  sortOrder: number;
  isPrimary: boolean;
  altText: string | null;
  url: string;
  mimeType: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  sha256: string;
};

export type VariantView = {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  price: string;
  compareAtPrice: string | null;
  costPrice?: string;
  dropshipCost?: string | null;
  fulfillmentType: string;
  isDefault: boolean;
  status: string;
  attributes: unknown;
  weightGrams: number | null;
};

export type ProductView = {
  id: string;
  name: string;
  nameBn: string | null;
  slug: string;
  sku: string | null;
  shortDescription: string | null;
  description: string | null;
  descriptionBn: string | null;
  productType: string;
  status: string;
  basePrice: string;
  compareAtPrice: string | null;
  costPrice?: string | null;
  tags: string[];
  weightGrams: number | null;
  warrantyMonths: number | null;
  minOrderQty: number;
  isFeatured: boolean;
  isPublished: boolean;
  isCustomizable: boolean;
  requiresDesignApproval: boolean;
  advancePercentage: string;
  isDropshipEnabled: boolean;
  seoTitle: string | null;
  seoDescription: string | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  category: { id: string; name: string; nameBn: string; slug: string; vatPercentage: string };
  brand: { id: string; name: string; slug: string } | null;
  variants: VariantView[];
  media: MediaView[];
};

export function mediaUrl(storageKey: string): string {
  return `/media/${storageKey}`;
}

/**
 * Serialise a product for the admin UI. Cost fields exist only when the caller
 * is allowed to see them; otherwise the keys are absent entirely.
 */
export function toProductView(
  product: ProductWithRelations,
  options: { canViewCost: boolean },
): ProductView {
  const media: MediaView[] = [...product.media]
    .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.sortOrder - b.sortOrder)
    .map((row) => ({
      productMediaId: row.id,
      mediaAssetId: row.mediaAsset.id,
      role: row.role,
      sortOrder: row.sortOrder,
      isPrimary: row.isPrimary,
      altText: row.mediaAsset.altText,
      url: mediaUrl(row.mediaAsset.storageKey),
      mimeType: row.mediaAsset.mimeType,
      byteSize: row.mediaAsset.byteSize,
      width: row.mediaAsset.width,
      height: row.mediaAsset.height,
      sha256: row.mediaAsset.sha256Checksum,
    }));

  const variants: VariantView[] = [...product.variants]
    .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name))
    .map((variant) => ({
      id: variant.id,
      name: variant.name,
      sku: variant.sku,
      barcode: variant.barcode,
      price: variant.price.toString(),
      compareAtPrice: variant.compareAtPrice?.toString() ?? null,
      ...(options.canViewCost
        ? {
            costPrice: variant.costPrice.toString(),
            dropshipCost: variant.dropshipCost?.toString() ?? null,
          }
        : {}),
      fulfillmentType: variant.fulfillmentType,
      isDefault: variant.isDefault,
      status: variant.status,
      attributes: variant.attributes,
      weightGrams: variant.weightGrams,
    }));

  return {
    id: product.id,
    name: product.name,
    nameBn: product.nameBn,
    slug: product.slug,
    sku: product.sku,
    shortDescription: product.shortDescription,
    description: product.description,
    descriptionBn: product.descriptionBn,
    productType: product.productType,
    status: product.status,
    basePrice: product.basePrice.toString(),
    compareAtPrice: product.compareAtPrice?.toString() ?? null,
    ...(options.canViewCost ? { costPrice: product.costPrice?.toString() ?? null } : {}),
    tags: product.tags,
    weightGrams: product.weightGrams,
    warrantyMonths: product.warrantyMonths,
    minOrderQty: product.minOrderQty,
    isFeatured: product.isFeatured,
    isPublished: product.isPublished,
    isCustomizable: product.isCustomizable,
    requiresDesignApproval: product.requiresDesignApproval,
    advancePercentage: product.advancePercentage.toString(),
    isDropshipEnabled: product.isDropshipEnabled,
    seoTitle: product.seoTitle,
    seoDescription: product.seoDescription,
    archivedAt: product.archivedAt,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
    category: {
      id: product.category.id,
      name: product.category.name,
      nameBn: product.category.nameBn,
      slug: product.category.slug,
      vatPercentage: product.category.vatPercentage.toString(),
    },
    brand: product.brand
      ? { id: product.brand.id, name: product.brand.name, slug: product.brand.slug }
      : null,
    variants,
    media,
  };
}
