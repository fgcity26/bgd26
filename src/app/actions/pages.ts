"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { audit } from "@/lib/auth/audit";
import { requestMeta } from "@/lib/auth/request-meta";
import { requirePermission } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

/**
 * CMS page actions.
 *
 * Pages are Markdown with separate English and Bangla bodies. Publishing is a
 * permission (`content.publish`), archiving is `content.delete`, and nothing is
 * hard-deleted: a page keeps its slug so old links can be redirected later.
 */
export type PageFormState = {
  error?: string;
  success?: string;
};

const PAGE_TYPES = ["STATIC", "POLICY", "FAQ", "LANDING", "BLOG"] as const;

const pageSchema = z.object({
  title: z.string().trim().min(2, "Enter a page title.").max(200),
  titleBn: z.string().trim().max(200).optional(),
  slug: z.string().trim().max(160).optional(),
  pageType: z.enum(PAGE_TYPES),
  excerpt: z.string().trim().max(500).optional(),
  body: z.string().trim().min(1, "Write the page body.").max(60_000),
  bodyBn: z.string().trim().max(60_000).optional(),
  seoTitle: z.string().trim().max(200).optional(),
  seoDescription: z.string().trim().max(400).optional(),
  showInHeader: z.boolean(),
  showInFooter: z.boolean(),
  sortOrder: z.string().trim().max(10).optional(),
});

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function checkbox(formData: FormData, name: string): boolean {
  return formData.get(name) === "on" || formData.get(name) === "true";
}

function optional(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Check the page fields.";
}

function slugify(value: string): string {
  const slug = value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  return slug || "page";
}

async function uniqueSlug(base: string, exceptId?: string): Promise<string> {
  let candidate = base;
  for (let attempt = 1; attempt <= 50; attempt += 1) {
    const clash = await prisma.sitePage.findFirst({
      where: { slug: candidate, ...(exceptId ? { id: { not: exceptId } } : {}) },
      select: { id: true },
    });
    if (!clash) return candidate;
    candidate = `${base}-${attempt + 1}`;
  }
  return `${base}-${Date.now().toString(36)}`;
}

function parseSortOrder(value: string | undefined): number {
  const trimmed = value?.trim();
  if (!trimmed) return 0;
  if (!/^\d+$/.test(trimmed)) throw new Error("Sort order must be a whole number.");
  return Math.min(Number(trimmed), 100_000);
}

function readPageForm(formData: FormData) {
  const parsed = pageSchema.safeParse({
    title: text(formData, "title"),
    titleBn: text(formData, "titleBn"),
    slug: text(formData, "slug"),
    pageType: text(formData, "pageType") || "STATIC",
    excerpt: text(formData, "excerpt"),
    body: text(formData, "body"),
    bodyBn: text(formData, "bodyBn"),
    seoTitle: text(formData, "seoTitle"),
    seoDescription: text(formData, "seoDescription"),
    showInHeader: checkbox(formData, "showInHeader"),
    showInFooter: checkbox(formData, "showInFooter"),
    sortOrder: text(formData, "sortOrder"),
  });
  if (!parsed.success) throw new Error(firstIssue(parsed.error));
  return parsed.data;
}

export async function createPageAction(
  _previous: PageFormState,
  formData: FormData,
): Promise<PageFormState> {
  const session = await requirePermission("content.write");

  let pageId: string;
  try {
    const data = readPageForm(formData);
    const slug = await uniqueSlug(slugify(data.slug?.trim() || data.title));

    const page = await prisma.sitePage.create({
      data: {
        slug,
        pageType: data.pageType,
        status: "DRAFT",
        title: data.title,
        titleBn: optional(data.titleBn),
        excerpt: optional(data.excerpt),
        body: data.body,
        bodyBn: optional(data.bodyBn),
        seoTitle: optional(data.seoTitle),
        seoDescription: optional(data.seoDescription),
        showInHeader: data.showInHeader,
        showInFooter: data.showInFooter,
        sortOrder: parseSortOrder(data.sortOrder),
        authorUserId: session.user.id,
      },
      select: { id: true },
    });
    pageId = page.id;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { error: "That slug is already in use. Choose another." };
    }
    return { error: error instanceof Error ? error.message : "Could not save the page." };
  }

  await audit({
    actorUserId: session.user.id,
    action: "cms.page.created",
    entityType: "site_page",
    entityId: pageId,
    metadata: { title: text(formData, "title") },
    ...(await requestMeta()),
  });

  revalidatePath("/pages");
  redirect(`/pages/${pageId}`);
}

export async function updatePageAction(
  _previous: PageFormState,
  formData: FormData,
): Promise<PageFormState> {
  const session = await requirePermission("content.write");
  const id = text(formData, "id");
  if (!id) return { error: "Missing page id." };

  try {
    const current = await prisma.sitePage.findUnique({
      where: { id },
      select: { id: true, slug: true },
    });
    if (!current) return { error: "That page no longer exists." };

    const data = readPageForm(formData);
    const slug = data.slug?.trim()
      ? await uniqueSlug(slugify(data.slug), id)
      : current.slug;

    await prisma.sitePage.update({
      where: { id },
      data: {
        slug,
        pageType: data.pageType,
        title: data.title,
        titleBn: optional(data.titleBn),
        excerpt: optional(data.excerpt),
        body: data.body,
        bodyBn: optional(data.bodyBn),
        seoTitle: optional(data.seoTitle),
        seoDescription: optional(data.seoDescription),
        showInHeader: data.showInHeader,
        showInFooter: data.showInFooter,
        sortOrder: parseSortOrder(data.sortOrder),
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { error: "That slug is already in use. Choose another." };
    }
    return { error: error instanceof Error ? error.message : "Could not save the page." };
  }

  await audit({
    actorUserId: session.user.id,
    action: "cms.page.updated",
    entityType: "site_page",
    entityId: id,
    ...(await requestMeta()),
  });

  revalidatePath("/pages");
  revalidatePath(`/pages/${id}`);
  return { success: "Page saved." };
}

export async function setPageStatusAction(formData: FormData): Promise<void> {
  const id = text(formData, "id");
  const action = text(formData, "action");
  if (!id) return;

  if (action === "publish") {
    const session = await requirePermission("content.publish");
    const page = await prisma.sitePage.findUnique({
      where: { id },
      select: { id: true, publishedAt: true },
    });
    if (!page) return;

    await prisma.sitePage.update({
      where: { id },
      data: { status: "PUBLISHED", publishedAt: page.publishedAt ?? new Date() },
    });

    await audit({
      actorUserId: session.user.id,
      action: "cms.page.published",
      entityType: "site_page",
      entityId: id,
      ...(await requestMeta()),
    });
  } else if (action === "unpublish") {
    const session = await requirePermission("content.publish");
    await prisma.sitePage.update({ where: { id }, data: { status: "DRAFT" } });

    await audit({
      actorUserId: session.user.id,
      action: "cms.page.unpublished",
      entityType: "site_page",
      entityId: id,
      ...(await requestMeta()),
    });
  } else if (action === "archive") {
    const session = await requirePermission("content.delete");
    await prisma.sitePage.update({ where: { id }, data: { status: "ARCHIVED" } });

    await audit({
      actorUserId: session.user.id,
      action: "cms.page.archived",
      entityType: "site_page",
      entityId: id,
      ...(await requestMeta()),
    });
  } else {
    return;
  }

  revalidatePath("/pages");
  revalidatePath(`/pages/${id}`);
  // Public pages are cached per slug; revalidate the list is enough here, the
  // page route is dynamic.
}
