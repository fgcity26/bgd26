"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { audit } from "@/lib/auth/audit";
import { requestMeta } from "@/lib/auth/request-meta";
import { requirePermission } from "@/lib/auth/session";
import { canViewCostPrices } from "@/lib/catalog/dto";
import { parseMoneyToPaisa, parseUnitCost } from "@/lib/catalog/pricing";
import { prisma } from "@/lib/db";

/**
 * Catalogue actions.
 *
 * Every action re-checks permission on the server. Cost prices are only read
 * from the form (and written) when the caller may see them; a hidden field is
 * never trusted. Nothing is hard-deleted: archiving sets status + archivedAt.
 */
export type ProductFormState = {
  error?: string;
  success?: string;
};

const PRODUCT_TYPES = ["STOCKED", "NON_STOCK", "SERVICE", "BUNDLE", "CUSTOM_MADE"] as const;
const FULFILLMENT_TYPES = ["STOCKED", "DROPSHIP", "NON_STOCK", "SERVICE"] as const;

const optionalText = (max: number) => z.string().trim().max(max).optional();

const productSchema = z.object({
  name: z.string().trim().min(2, "Enter a product name.").max(200),
  nameBn: optionalText(200),
  sku: optionalText(60),
  categoryId: z.string().trim().min(1, "Choose a category."),
  brandId: optionalText(40),
  basePrice: z.string().trim().min(1, "Enter a selling price."),
  compareAtPrice: optionalText(30),
  costPrice: optionalText(30),
  productType: z.enum(PRODUCT_TYPES),
  shortDescription: optionalText(500),
  description: optionalText(5000),
  descriptionBn: optionalText(5000),
  tags: optionalText(500),
  weightGrams: optionalText(20),
  warrantyMonths: optionalText(20),
  minOrderQty: optionalText(10),
  advancePercentage: optionalText(10),
  seoTitle: optionalText(200),
  seoDescription: optionalText(400),
  isFeatured: z.boolean(),
  isCustomizable: z.boolean(),
  requiresDesignApproval: z.boolean(),
  isDropshipEnabled: z.boolean(),
});

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function checkbox(formData: FormData, name: string): boolean {
  return formData.get(name) === "on" || formData.get(name) === "true";
}

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Check the highlighted fields.";
}

function optional(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function slugify(value: string): string {
  const slug = value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  return slug || "product";
}

async function uniqueSlug(base: string, exceptProductId?: string): Promise<string> {
  let candidate = base;
  for (let attempt = 1; attempt <= 50; attempt += 1) {
    const clash = await prisma.product.findFirst({
      where: { slug: candidate, ...(exceptProductId ? { id: { not: exceptProductId } } : {}) },
      select: { id: true },
    });
    if (!clash) return candidate;
    candidate = `${base}-${attempt + 1}`;
  }
  return `${base}-${Date.now().toString(36)}`;
}

async function skuExists(
  sku: string,
  options?: { productId?: string; variantIds?: string[] },
): Promise<boolean> {
  const product = await prisma.product.findFirst({
    where: { sku, ...(options?.productId ? { id: { not: options.productId } } : {}) },
    select: { id: true },
  });
  if (product) return true;

  const variant = await prisma.productVariant.findFirst({
    where: {
      sku,
      ...(options?.variantIds?.length ? { id: { notIn: options.variantIds } } : {}),
    },
    select: { id: true },
  });
  return Boolean(variant);
}

function generatedSku(): string {
  return `SKU-${Date.now().toString(36).toUpperCase()}-${Math.random()
    .toString(36)
    .slice(2, 6)
    .toUpperCase()}`;
}

function fulfillmentFor(productType: (typeof PRODUCT_TYPES)[number]) {
  if (productType === "SERVICE") return "SERVICE" as const;
  if (productType === "NON_STOCK") return "NON_STOCK" as const;
  return "STOCKED" as const;
}

function parseOptionalInteger(value: string | undefined, label: string, max: number): number | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (!/^\d+$/.test(trimmed)) throw new Error(`${label} must be a whole number.`);
  const parsed = Number(trimmed);
  if (parsed > max) throw new Error(`${label} is too large.`);
  return parsed;
}

function parseTags(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 20)
    .map((tag) => tag.slice(0, 40));
}

function readProductForm(formData: FormData) {
  const parsed = productSchema.safeParse({
    name: text(formData, "name"),
    nameBn: text(formData, "nameBn"),
    sku: text(formData, "sku"),
    categoryId: text(formData, "categoryId"),
    brandId: text(formData, "brandId"),
    basePrice: text(formData, "basePrice"),
    compareAtPrice: text(formData, "compareAtPrice"),
    costPrice: text(formData, "costPrice"),
    productType: text(formData, "productType") || "STOCKED",
    shortDescription: text(formData, "shortDescription"),
    description: text(formData, "description"),
    descriptionBn: text(formData, "descriptionBn"),
    tags: text(formData, "tags"),
    weightGrams: text(formData, "weightGrams"),
    warrantyMonths: text(formData, "warrantyMonths"),
    minOrderQty: text(formData, "minOrderQty"),
    advancePercentage: text(formData, "advancePercentage"),
    seoTitle: text(formData, "seoTitle"),
    seoDescription: text(formData, "seoDescription"),
    isFeatured: checkbox(formData, "isFeatured"),
    isCustomizable: checkbox(formData, "isCustomizable"),
    requiresDesignApproval: checkbox(formData, "requiresDesignApproval"),
    isDropshipEnabled: checkbox(formData, "isDropshipEnabled"),
  });

  if (!parsed.success) throw new Error(firstIssue(parsed.error));
  return parsed.data;
}

export async function createProductAction(
  _previous: ProductFormState,
  formData: FormData,
): Promise<ProductFormState> {
  const session = await requirePermission("product.write");
  const maySeeCost = canViewCostPrices(session);

  let productId: string;
  try {
    const data = readProductForm(formData);
    const basePricePaisa = parseMoneyToPaisa(data.basePrice);
    const compareAtPaisa = data.compareAtPrice ? parseMoneyToPaisa(data.compareAtPrice) : null;
    const cost = maySeeCost && data.costPrice ? parseUnitCost(data.costPrice) : "0";
    const advance = data.advancePercentage ? Number(data.advancePercentage) : 50;
    if (!Number.isFinite(advance) || advance < 0 || advance > 100) {
      throw new Error("Advance percentage must be between 0 and 100.");
    }

    const category = await prisma.category.findUnique({
      where: { id: data.categoryId },
      select: { id: true },
    });
    if (!category) throw new Error("That category no longer exists.");

    const sku = data.sku?.trim() || generatedSku();
    if (await skuExists(sku)) throw new Error(`SKU ${sku} is already in use.`);

    const slug = await uniqueSlug(slugify(data.name));

    const created = await prisma.$transaction(async (tx) => {
      const product = await tx.product.create({
        data: {
          categoryId: data.categoryId,
          brandId: data.brandId || null,
          sku,
          name: data.name,
          nameBn: optional(data.nameBn),
          slug,
          shortDescription: optional(data.shortDescription),
          description: optional(data.description),
          descriptionBn: optional(data.descriptionBn),
          productType: data.productType,
          status: "DRAFT",
          basePrice: (basePricePaisa / 100).toFixed(2),
          compareAtPrice: compareAtPaisa === null ? null : (compareAtPaisa / 100).toFixed(2),
          costPrice: maySeeCost ? cost : null,
          tags: parseTags(data.tags),
          weightGrams: parseOptionalInteger(data.weightGrams, "Weight", 1_000_000),
          warrantyMonths: parseOptionalInteger(data.warrantyMonths, "Warranty", 240),
          minOrderQty: parseOptionalInteger(data.minOrderQty, "Minimum order quantity", 10_000) ?? 1,
          isFeatured: data.isFeatured,
          isCustomizable: data.isCustomizable,
          requiresDesignApproval: data.requiresDesignApproval,
          advancePercentage: advance.toFixed(2),
          isDropshipEnabled: data.isDropshipEnabled,
          seoTitle: optional(data.seoTitle),
          seoDescription: optional(data.seoDescription),
          createdByUserId: session.user.id,
        },
        select: { id: true },
      });

      // Every product starts with one default variant so POS, inventory and
      // pricing have a single stable SKU to reference.
      await tx.productVariant.create({
        data: {
          productId: product.id,
          sku,
          name: "Default",
          price: (basePricePaisa / 100).toFixed(2),
          compareAtPrice: compareAtPaisa === null ? null : (compareAtPaisa / 100).toFixed(2),
          costPrice: maySeeCost ? cost : "0",
          fulfillmentType: fulfillmentFor(data.productType),
          isDefault: true,
          status: "ACTIVE",
        },
      });

      return product;
    });

    productId = created.id;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { error: "That SKU or slug is already in use. Choose another." };
    }
    return { error: error instanceof Error ? error.message : "Could not save the product." };
  }

  await audit({
    actorUserId: session.user.id,
    action: "catalog.product.created",
    entityType: "product",
    entityId: productId,
    metadata: { name: text(formData, "name"), sku: text(formData, "sku") },
    ...(await requestMeta()),
  });

  revalidatePath("/products");
  redirect(`/products/${productId}`);
}

export async function updateProductAction(
  _previous: ProductFormState,
  formData: FormData,
): Promise<ProductFormState> {
  const session = await requirePermission("product.write");
  const maySeeCost = canViewCostPrices(session);
  const id = text(formData, "id");
  if (!id) return { error: "Missing product id." };

  try {
    const data = readProductForm(formData);
    const current = await prisma.product.findUnique({
      where: { id },
      select: {
        id: true,
        sku: true,
        slug: true,
        basePrice: true,
        variants: { select: { id: true, sku: true, isDefault: true } },
      },
    });
    if (!current) return { error: "That product no longer exists." };

    const basePricePaisa = parseMoneyToPaisa(data.basePrice);
    const compareAtPaisa = data.compareAtPrice ? parseMoneyToPaisa(data.compareAtPrice) : null;
    const cost = maySeeCost && data.costPrice ? parseUnitCost(data.costPrice) : null;
    const advance = data.advancePercentage ? Number(data.advancePercentage) : 50;
    if (!Number.isFinite(advance) || advance < 0 || advance > 100) {
      throw new Error("Advance percentage must be between 0 and 100.");
    }

    const sku = data.sku?.trim() || current.sku || generatedSku();
    const variantIds = current.variants.map((variant) => variant.id);
    if (sku !== current.sku && (await skuExists(sku, { productId: id, variantIds }))) {
      throw new Error(`SKU ${sku} is already in use.`);
    }

    const slug =
      data.name === text(formData, "currentName") ? current.slug : await uniqueSlug(slugify(data.name), id);

    const defaultVariant = current.variants.find((variant) => variant.isDefault);

    await prisma.$transaction(async (tx) => {
      await tx.product.update({
        where: { id },
        data: {
          categoryId: data.categoryId,
          brandId: data.brandId || null,
          sku,
          name: data.name,
          nameBn: optional(data.nameBn),
          slug,
          shortDescription: optional(data.shortDescription),
          description: optional(data.description),
          descriptionBn: optional(data.descriptionBn),
          productType: data.productType,
          basePrice: (basePricePaisa / 100).toFixed(2),
          compareAtPrice: compareAtPaisa === null ? null : (compareAtPaisa / 100).toFixed(2),
          ...(maySeeCost ? { costPrice: cost } : {}),
          tags: parseTags(data.tags),
          weightGrams: parseOptionalInteger(data.weightGrams, "Weight", 1_000_000),
          warrantyMonths: parseOptionalInteger(data.warrantyMonths, "Warranty", 240),
          minOrderQty: parseOptionalInteger(data.minOrderQty, "Minimum order quantity", 10_000) ?? 1,
          isFeatured: data.isFeatured,
          isCustomizable: data.isCustomizable,
          requiresDesignApproval: data.requiresDesignApproval,
          advancePercentage: advance.toFixed(2),
          isDropshipEnabled: data.isDropshipEnabled,
          seoTitle: optional(data.seoTitle),
          seoDescription: optional(data.seoDescription),
        },
      });

      // Keep the single default variant aligned with the product. Named
      // variants keep their own prices and are edited separately.
      if (defaultVariant) {
        await tx.productVariant.update({
          where: { id: defaultVariant.id },
          data: {
            sku,
            price: (basePricePaisa / 100).toFixed(2),
            compareAtPrice: compareAtPaisa === null ? null : (compareAtPaisa / 100).toFixed(2),
            ...(maySeeCost && cost !== null ? { costPrice: cost } : {}),
          },
        });
      }
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { error: "That SKU or slug is already in use. Choose another." };
    }
    return { error: error instanceof Error ? error.message : "Could not save the product." };
  }

  await audit({
    actorUserId: session.user.id,
    action: "catalog.product.updated",
    entityType: "product",
    entityId: id,
    ...(await requestMeta()),
  });

  revalidatePath("/products");
  revalidatePath(`/products/${id}`);
  return { success: "Product saved." };
}

export async function setProductPublishedAction(formData: FormData): Promise<void> {
  const session = await requirePermission("product.publish");
  const id = text(formData, "id");
  const publish = text(formData, "publish") === "true";
  if (!id) return;

  await prisma.product.update({
    where: { id },
    data: { isPublished: publish, status: publish ? "ACTIVE" : "DRAFT" },
  });

  await audit({
    actorUserId: session.user.id,
    action: publish ? "catalog.product.published" : "catalog.product.unpublished",
    entityType: "product",
    entityId: id,
    ...(await requestMeta()),
  });

  revalidatePath("/products");
  revalidatePath(`/products/${id}`);
}

export async function archiveProductAction(formData: FormData): Promise<void> {
  const session = await requirePermission("product.delete");
  const id = text(formData, "id");
  if (!id) return;

  await prisma.product.update({
    where: { id },
    data: {
      status: "ARCHIVED",
      isPublished: false,
      archivedAt: new Date(),
      variants: { updateMany: { where: {}, data: { status: "ARCHIVED" } } },
    },
  });

  await audit({
    actorUserId: session.user.id,
    action: "catalog.product.archived",
    entityType: "product",
    entityId: id,
    ...(await requestMeta()),
  });

  revalidatePath("/products");
  revalidatePath(`/products/${id}`);
}

const variantSchema = z.object({
  productId: z.string().trim().min(1),
  name: z.string().trim().min(1, "Give the variant a name, for example “Large / Black”.").max(120),
  sku: z.string().trim().min(1, "Enter a variant SKU.").max(60),
  barcode: optionalText(60),
  price: z.string().trim().min(1, "Enter the variant price."),
  compareAtPrice: optionalText(30),
  costPrice: optionalText(30),
  fulfillmentType: z.enum(FULFILLMENT_TYPES),
  weightGrams: optionalText(20),
  attributes: optionalText(1000),
});

export async function createVariantAction(
  _previous: ProductFormState,
  formData: FormData,
): Promise<ProductFormState> {
  const session = await requirePermission("product.write");
  const maySeeCost = canViewCostPrices(session);

  const parsed = variantSchema.safeParse({
    productId: text(formData, "productId"),
    name: text(formData, "name"),
    sku: text(formData, "sku"),
    barcode: text(formData, "barcode"),
    price: text(formData, "price"),
    compareAtPrice: text(formData, "compareAtPrice"),
    costPrice: text(formData, "costPrice"),
    fulfillmentType: text(formData, "fulfillmentType") || "STOCKED",
    weightGrams: text(formData, "weightGrams"),
    attributes: text(formData, "attributes"),
  });
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  const data = parsed.data;
  try {
    const product = await prisma.product.findUnique({
      where: { id: data.productId },
      select: { id: true, archivedAt: true },
    });
    if (!product || product.archivedAt) return { error: "That product cannot be edited." };

    if (await skuExists(data.sku)) throw new Error(`SKU ${data.sku} is already in use.`);
    if (data.barcode && (await prisma.productVariant.findUnique({ where: { barcode: data.barcode }, select: { id: true } }))) {
      throw new Error("That barcode is already assigned to another variant.");
    }

    let attributes: Prisma.InputJsonValue | undefined;
    if (data.attributes?.trim()) {
      try {
        attributes = JSON.parse(data.attributes) as Prisma.InputJsonValue;
      } catch {
        throw new Error('Attributes must be valid JSON, for example {"size":"L"}.');
      }
    }

    await prisma.productVariant.create({
      data: {
        productId: data.productId,
        name: data.name,
        sku: data.sku,
        barcode: optional(data.barcode),
        price: (parseMoneyToPaisa(data.price) / 100).toFixed(2),
        compareAtPrice: data.compareAtPrice
          ? (parseMoneyToPaisa(data.compareAtPrice) / 100).toFixed(2)
          : null,
        costPrice: maySeeCost && data.costPrice ? parseUnitCost(data.costPrice) : "0",
        fulfillmentType: data.fulfillmentType,
        weightGrams: parseOptionalInteger(data.weightGrams, "Weight", 1_000_000),
        attributes,
        isDefault: false,
        status: "ACTIVE",
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { error: "That SKU or barcode is already in use." };
    }
    return { error: error instanceof Error ? error.message : "Could not save the variant." };
  }

  await audit({
    actorUserId: session.user.id,
    action: "catalog.variant.created",
    entityType: "product_variant",
    metadata: { productId: data.productId, sku: data.sku },
    ...(await requestMeta()),
  });

  revalidatePath(`/products/${data.productId}`);
  return { success: `Variant ${data.name} added.` };
}

export async function archiveVariantAction(formData: FormData): Promise<void> {
  const session = await requirePermission("product.write");
  const id = text(formData, "id");
  const productId = text(formData, "productId");
  if (!id || !productId) return;

  await prisma.productVariant.update({ where: { id }, data: { status: "ARCHIVED" } });

  await audit({
    actorUserId: session.user.id,
    action: "catalog.variant.archived",
    entityType: "product_variant",
    entityId: id,
    metadata: { productId },
    ...(await requestMeta()),
  });

  revalidatePath(`/products/${productId}`);
}
