import { prisma } from "@/lib/db";

/**
 * Public catalogue queries.
 *
 * The storefront never selects cost price, supplier data or internal notes.
 * Every product here is `ACTIVE` and published; drafts stay invisible even if
 * someone guesses a slug. Stock is read from the default warehouse, because
 * that is the warehouse an online order ships from.
 */

export const STOREFRONT_PAGE_SIZE = 12;

export type StorefrontMedia = {
  url: string;
  alt: string;
  width: number | null;
  height: number | null;
};

export type StorefrontVariant = {
  id: string;
  sku: string;
  name: string;
  price: string;
  compareAtPrice: string | null;
  fulfillmentType: "STOCKED" | "DROPSHIP" | "NON_STOCK" | "SERVICE";
  availableQty: number | null;
  available: boolean;
  isDefault: boolean;
};

export type StorefrontProduct = {
  id: string;
  slug: string;
  name: string;
  nameBn: string | null;
  shortDescription: string | null;
  description: string | null;
  descriptionBn: string | null;
  category: { slug: string; name: string; nameBn: string; vatPercentage: string };
  brand: { name: string; slug: string } | null;
  media: StorefrontMedia[];
  variants: StorefrontVariant[];
  price: string;
  compareAtPrice: string | null;
  available: boolean;
  isFeatured: boolean;
  isCustomizable: boolean;
  ratingAverage: string;
  ratingCount: number;
};

export type StorefrontCategory = {
  slug: string;
  name: string;
  nameBn: string;
  imageUrl: string | null;
  productCount: number;
};

type MediaRow = {
  altText: string | null;
  storageKey: string;
  width: number | null;
  height: number | null;
};

type VariantRow = {
  id: string;
  sku: string;
  name: string;
  price: unknown;
  compareAtPrice: unknown;
  fulfillmentType: StorefrontVariant["fulfillmentType"];
  isDefault: boolean;
  inventoryBalances: Array<{ availableQty: unknown }>;
};

function moneyString(value: unknown): string {
  const parsed = Number(String(value));
  return Number.isFinite(parsed) ? parsed.toFixed(2) : "0.00";
}

function mediaUrl(asset: MediaRow): StorefrontMedia {
  return {
    url: `/media/${asset.storageKey}`,
    alt: asset.altText ?? "",
    width: asset.width,
    height: asset.height,
  };
}

function toVariant(row: VariantRow): StorefrontVariant {
  const isStocked = row.fulfillmentType === "STOCKED";
  const availableQty = isStocked
    ? row.inventoryBalances.reduce((sum, balance) => sum + Number(balance.availableQty), 0)
    : null;
  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    price: moneyString(row.price),
    compareAtPrice: row.compareAtPrice === null ? null : moneyString(row.compareAtPrice),
    fulfillmentType: row.fulfillmentType,
    availableQty,
    available: isStocked ? (availableQty ?? 0) > 0 : true,
    isDefault: row.isDefault,
  };
}

const VARIANT_SELECT = {
  id: true,
  sku: true,
  name: true,
  price: true,
  compareAtPrice: true,
  fulfillmentType: true,
  isDefault: true,
  inventoryBalances: { select: { availableQty: true } },
} as const;

export async function defaultWarehouse(): Promise<{ id: string; name: string } | null> {
  return prisma.warehouse.findFirst({
    where: { isDefault: true, isActive: true },
    select: { id: true, name: true },
  });
}

function productSelect(warehouseId: string) {
  return {
    id: true,
    slug: true,
    name: true,
    nameBn: true,
    shortDescription: true,
    description: true,
    descriptionBn: true,
    basePrice: true,
    compareAtPrice: true,
    isFeatured: true,
    isCustomizable: true,
    ratingAverage: true,
    ratingCount: true,
    category: { select: { slug: true, name: true, nameBn: true, vatPercentage: true } },
    brand: { select: { name: true, slug: true } },
    media: {
      where: { role: "GALLERY" as const, mediaAsset: { visibility: "PUBLIC" as const } },
      orderBy: [{ isPrimary: "desc" as const }, { sortOrder: "asc" as const }],
      select: {
        mediaAsset: {
          select: {
            storageKey: true,
            altText: true,
            width: true,
            height: true,
          },
        },
      },
    },
    variants: {
      where: { status: "ACTIVE" as const },
      orderBy: [{ isDefault: "desc" as const }, { price: "asc" as const }],
      select: {
        ...VARIANT_SELECT,
        inventoryBalances: { where: { warehouseId }, select: { availableQty: true } },
      },
    },
  };
}

type ProductRow = {
  id: string;
  slug: string;
  name: string;
  nameBn: string | null;
  shortDescription: string | null;
  description: string | null;
  descriptionBn: string | null;
  basePrice: unknown;
  compareAtPrice: unknown;
  isFeatured: boolean;
  isCustomizable: boolean;
  ratingAverage: unknown;
  ratingCount: number;
  category: { slug: string; name: string; nameBn: string; vatPercentage: unknown };
  brand: { name: string; slug: string } | null;
  media: Array<{ mediaAsset: MediaRow }>;
  variants: VariantRow[];
};

function toProduct(row: ProductRow): StorefrontProduct {
  const variants = row.variants.map(toVariant);
  const priced = variants.length > 0 ? variants : null;
  const cheapest = priced
    ? priced.reduce((lowest, variant) =>
        Number(variant.price) < Number(lowest.price) ? variant : lowest,
      )
    : null;
  const defaultVariant = priced?.find((variant) => variant.isDefault) ?? cheapest;

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    nameBn: row.nameBn,
    shortDescription: row.shortDescription,
    description: row.description,
    descriptionBn: row.descriptionBn,
    category: {
      slug: row.category.slug,
      name: row.category.name,
      nameBn: row.category.nameBn,
      vatPercentage: moneyString(row.category.vatPercentage),
    },
    brand: row.brand,
    media: row.media.map((entry) => mediaUrl(entry.mediaAsset)),
    variants,
    price: defaultVariant?.price ?? moneyString(row.basePrice),
    compareAtPrice:
      defaultVariant?.compareAtPrice ??
      (row.compareAtPrice === null ? null : moneyString(row.compareAtPrice)),
    available: variants.some((variant) => variant.available),
    isFeatured: row.isFeatured,
    isCustomizable: row.isCustomizable,
    ratingAverage: moneyString(row.ratingAverage),
    ratingCount: row.ratingCount,
  };
}

const PUBLIC_PRODUCT_WHERE = {
  status: "ACTIVE" as const,
  isPublished: true,
  archivedAt: null,
};

export async function listPublicCategories(): Promise<StorefrontCategory[]> {
  const categories = await prisma.category.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: {
      slug: true,
      name: true,
      nameBn: true,
      imageUrl: true,
      _count: {
        select: {
          products: { where: PUBLIC_PRODUCT_WHERE },
        },
      },
    },
  });

  return categories
    .filter((category) => category._count.products > 0)
    .map((category) => ({
      slug: category.slug,
      name: category.name,
      nameBn: category.nameBn,
      imageUrl: category.imageUrl,
      productCount: category._count.products,
    }));
}

export type ProductListOptions = {
  category?: string | null;
  search?: string | null;
  sort?: "newest" | "featured" | "price-asc" | "price-desc";
  page?: number;
  pageSize?: number;
};

export async function listPublicProducts(options: ProductListOptions = {}): Promise<{
  products: StorefrontProduct[];
  total: number;
  page: number;
  pages: number;
}> {
  const warehouse = await defaultWarehouse();
  if (!warehouse) return { products: [], total: 0, page: 1, pages: 1 };

  const pageSize = Math.min(Math.max(options.pageSize ?? STOREFRONT_PAGE_SIZE, 1), 48);
  const page = Math.max(1, Math.trunc(options.page ?? 1));
  const search = options.search?.trim() ?? "";
  const category = options.category?.trim() ?? "";

  const where = {
    ...PUBLIC_PRODUCT_WHERE,
    ...(category ? { category: { slug: category } } : {}),
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" as const } },
            { nameBn: { contains: search, mode: "insensitive" as const } },
            { shortDescription: { contains: search, mode: "insensitive" as const } },
            { sku: { contains: search, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const orderBy =
    options.sort === "price-asc"
      ? [{ basePrice: "asc" as const }]
      : options.sort === "price-desc"
        ? [{ basePrice: "desc" as const }]
        : options.sort === "featured"
          ? [{ isFeatured: "desc" as const }, { createdAt: "desc" as const }]
          : [{ createdAt: "desc" as const }];

  const [total, rows] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: productSelect(warehouse.id),
    }),
  ]);

  return {
    products: rows.map(toProduct),
    total,
    page,
    pages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function getPublicProduct(slug: string): Promise<StorefrontProduct | null> {
  const warehouse = await defaultWarehouse();
  if (!warehouse) return null;

  const row = await prisma.product.findFirst({
    where: { ...PUBLIC_PRODUCT_WHERE, slug },
    select: productSelect(warehouse.id),
  });
  return row ? toProduct(row) : null;
}

export async function getStorefrontHome(): Promise<{
  categories: StorefrontCategory[];
  featured: StorefrontProduct[];
  latest: StorefrontProduct[];
}> {
  const [categories, featured, latest] = await Promise.all([
    listPublicCategories(),
    listPublicProducts({ sort: "featured", pageSize: 8 }),
    listPublicProducts({ sort: "newest", pageSize: 8 }),
  ]);
  return { categories, featured: featured.products, latest: latest.products };
}
