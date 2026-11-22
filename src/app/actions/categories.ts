"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { audit } from "@/lib/auth/audit";
import { requestMeta } from "@/lib/auth/request-meta";
import { requirePermission } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

/**
 * Category actions. Categories carry the VAT rate that is snapshotted onto
 * order items at sale time, so changing a rate never rewrites history.
 */
export type CategoryFormState = {
  error?: string;
  success?: string;
};

const categorySchema = z.object({
  name: z.string().trim().min(2, "Enter a category name.").max(120),
  nameBn: z.string().trim().min(1, "Enter the Bangla name.").max(120),
  code: z.string().trim().max(20).optional(),
  slug: z.string().trim().max(120).optional(),
  description: z.string().trim().max(1000).optional(),
  vatPercentage: z.string().trim().min(1, "Enter a VAT rate (use 0 for exempt)."),
  parentId: z.string().trim().max(40).optional(),
  sortOrder: z.string().trim().max(10).optional(),
});

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
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
    .slice(0, 100);
  return slug || "category";
}

async function uniqueSlug(base: string, exceptId?: string): Promise<string> {
  let candidate = base;
  for (let attempt = 1; attempt <= 50; attempt += 1) {
    const clash = await prisma.category.findFirst({
      where: { slug: candidate, ...(exceptId ? { id: { not: exceptId } } : {}) },
      select: { id: true },
    });
    if (!clash) return candidate;
    candidate = `${base}-${attempt + 1}`;
  }
  return `${base}-${Date.now().toString(36)}`;
}

function parseVat(value: string): string {
  if (!/^\d+(\.\d{1,2})?$/.test(value)) {
    throw new Error("VAT must be a percentage with at most two decimals.");
  }
  const numeric = Number(value);
  if (numeric < 0 || numeric > 100) throw new Error("VAT must be between 0 and 100.");
  return numeric.toFixed(2);
}

function parseSortOrder(value: string | undefined): number {
  const trimmed = value?.trim();
  if (!trimmed) return 0;
  if (!/^\d+$/.test(trimmed)) throw new Error("Sort order must be a whole number.");
  return Math.min(Number(trimmed), 100_000);
}

async function assertNoCycle(categoryId: string, parentId: string): Promise<void> {
  let cursor: string | null = parentId;
  for (let depth = 0; cursor && depth < 20; depth += 1) {
    if (cursor === categoryId) throw new Error("A category cannot be its own parent.");
    const parent: { parentId: string | null } | null = await prisma.category.findUnique({
      where: { id: cursor },
      select: { parentId: true },
    });
    cursor = parent?.parentId ?? null;
  }
}

export async function createCategoryAction(
  _previous: CategoryFormState,
  formData: FormData,
): Promise<CategoryFormState> {
  const session = await requirePermission("product.write");

  const parsed = categorySchema.safeParse({
    name: text(formData, "name"),
    nameBn: text(formData, "nameBn"),
    code: text(formData, "code"),
    slug: text(formData, "slug"),
    description: text(formData, "description"),
    vatPercentage: text(formData, "vatPercentage"),
    parentId: text(formData, "parentId"),
    sortOrder: text(formData, "sortOrder"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the category fields." };
  }

  const data = parsed.data;
  try {
    const code = optional(data.code);
    if (code && (await prisma.category.findUnique({ where: { code }, select: { id: true } }))) {
      throw new Error(`Category code ${code} is already in use.`);
    }
    if (data.parentId) {
      const parent = await prisma.category.findUnique({
        where: { id: data.parentId },
        select: { id: true },
      });
      if (!parent) throw new Error("That parent category no longer exists.");
    }

    const slug = await uniqueSlug(slugify(data.slug?.trim() || data.name));

    const category = await prisma.category.create({
      data: {
        name: data.name,
        nameBn: data.nameBn,
        code,
        slug,
        description: optional(data.description),
        vatPercentage: parseVat(data.vatPercentage),
        parentId: data.parentId || null,
        sortOrder: parseSortOrder(data.sortOrder),
      },
      select: { id: true },
    });

    await audit({
      actorUserId: session.user.id,
      action: "catalog.category.created",
      entityType: "category",
      entityId: category.id,
      metadata: { name: data.name, vatPercentage: data.vatPercentage },
      ...(await requestMeta()),
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { error: "That category code or slug is already in use." };
    }
    return { error: error instanceof Error ? error.message : "Could not save the category." };
  }

  revalidatePath("/categories");
  revalidatePath("/products");
  return { success: `${data.name} added.` };
}

export async function updateCategoryAction(
  _previous: CategoryFormState,
  formData: FormData,
): Promise<CategoryFormState> {
  const session = await requirePermission("product.write");
  const id = text(formData, "id");
  if (!id) return { error: "Missing category id." };

  const parsed = categorySchema.safeParse({
    name: text(formData, "name"),
    nameBn: text(formData, "nameBn"),
    code: text(formData, "code"),
    slug: text(formData, "slug"),
    description: text(formData, "description"),
    vatPercentage: text(formData, "vatPercentage"),
    parentId: text(formData, "parentId"),
    sortOrder: text(formData, "sortOrder"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the category fields." };
  }

  const data = parsed.data;
  try {
    const current = await prisma.category.findUnique({
      where: { id },
      select: { id: true, slug: true, code: true },
    });
    if (!current) return { error: "That category no longer exists." };

    if (data.parentId) await assertNoCycle(id, data.parentId);

    const code = optional(data.code);
    if (code && code !== current.code) {
      const clash = await prisma.category.findUnique({ where: { code }, select: { id: true } });
      if (clash && clash.id !== id) throw new Error(`Category code ${code} is already in use.`);
    }

    const slug =
      data.slug?.trim() && data.slug.trim() !== current.slug
        ? await uniqueSlug(slugify(data.slug), id)
        : current.slug;

    await prisma.category.update({
      where: { id },
      data: {
        name: data.name,
        nameBn: data.nameBn,
        code,
        slug,
        description: optional(data.description),
        vatPercentage: parseVat(data.vatPercentage),
        parentId: data.parentId || null,
        sortOrder: parseSortOrder(data.sortOrder),
      },
    });

    await audit({
      actorUserId: session.user.id,
      action: "catalog.category.updated",
      entityType: "category",
      entityId: id,
      metadata: { vatPercentage: data.vatPercentage },
      ...(await requestMeta()),
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { error: "That category code or slug is already in use." };
    }
    return { error: error instanceof Error ? error.message : "Could not save the category." };
  }

  revalidatePath("/categories");
  revalidatePath("/products");
  return { success: "Category saved." };
}

export async function setCategoryActiveAction(formData: FormData): Promise<void> {
  const session = await requirePermission("product.write");
  const id = text(formData, "id");
  const active = text(formData, "active") === "true";
  if (!id) return;

  await prisma.category.update({ where: { id }, data: { isActive: active } });

  await audit({
    actorUserId: session.user.id,
    action: active ? "catalog.category.activated" : "catalog.category.deactivated",
    entityType: "category",
    entityId: id,
    ...(await requestMeta()),
  });

  revalidatePath("/categories");
  revalidatePath("/products");
}
