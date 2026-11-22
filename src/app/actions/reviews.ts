"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { audit } from "@/lib/auth/audit";
import { requestMeta } from "@/lib/auth/request-meta";
import { requirePermission } from "@/lib/auth/session";
import { recomputeProductRating } from "@/lib/crm/reviews";
import { prisma } from "@/lib/db";
import { storeImage } from "@/lib/media/service";
import { MediaValidationError } from "@/lib/media/validate";

/**
 * Review actions.
 *
 * Reviews are draft-like until moderated: every new review is PENDING, and only
 * APPROVED reviews affect the product's rating. Photos use the same
 * zero-transform pipeline as product images, capped at five per review.
 *
 * Staff can record a review collected by phone or WhatsApp. Verified-purchase
 * reviews are created by the storefront from a delivered order item; staff
 * entries stay unverified unless that link is supplied.
 */
export type ReviewFormState = {
  error?: string;
  success?: string;
};

const MAX_REVIEW_IMAGES = 5;

const reviewSchema = z.object({
  productId: z.string().trim().min(1, "Choose a product."),
  customerId: z.string().trim().min(1, "Choose a customer."),
  variantId: z.string().trim().max(40).optional(),
  rating: z.string().trim().min(1, "Choose a rating."),
  title: z.string().trim().max(160).optional(),
  body: z.string().trim().min(3, "Write the review.").max(4000),
});

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function optional(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function filesFrom(formData: FormData): File[] {
  return formData
    .getAll("photos")
    .filter((value): value is File => value instanceof File && value.size > 0);
}

export async function createReviewAction(
  _previous: ReviewFormState,
  formData: FormData,
): Promise<ReviewFormState> {
  const session = await requirePermission("review.write");

  const parsed = reviewSchema.safeParse({
    productId: text(formData, "productId"),
    customerId: text(formData, "customerId"),
    variantId: text(formData, "variantId"),
    rating: text(formData, "rating"),
    title: text(formData, "title"),
    body: text(formData, "body"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the review fields." };
  }
  const data = parsed.data;

  const rating = Number(data.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return { error: "Rating must be a whole number from 1 to 5." };
  }

  const files = filesFrom(formData);
  if (files.length > MAX_REVIEW_IMAGES) {
    return { error: `Add at most ${MAX_REVIEW_IMAGES} photos.` };
  }

  let reviewId: string;
  try {
    const [product, customer] = await Promise.all([
      prisma.product.findUnique({
        where: { id: data.productId },
        select: { id: true, archivedAt: true },
      }),
      prisma.customer.findUnique({
        where: { id: data.customerId },
        select: { id: true, deletedAt: true },
      }),
    ]);
    if (!product || product.archivedAt) return { error: "That product cannot be reviewed." };
    if (!customer || customer.deletedAt) return { error: "That customer cannot be reviewed." };

    if (data.variantId) {
      const variant = await prisma.productVariant.findFirst({
        where: { id: data.variantId, productId: data.productId },
        select: { id: true },
      });
      if (!variant) return { error: "That variant does not belong to the product." };
    }

    const existing = await prisma.productReview.findUnique({
      where: { productId_customerId: { productId: data.productId, customerId: data.customerId } },
      select: { id: true },
    });
    if (existing) return { error: "This customer has already reviewed this product." };

    const review = await prisma.productReview.create({
      data: {
        productId: data.productId,
        variantId: data.variantId || null,
        customerId: data.customerId,
        rating,
        title: optional(data.title),
        body: data.body,
        status: "PENDING",
      },
      select: { id: true },
    });
    reviewId = review.id;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { error: "This customer has already reviewed this product." };
    }
    return { error: error instanceof Error ? error.message : "Could not save the review." };
  }

  const failures: string[] = [];
  let photosSaved = 0;
  for (const [index, file] of files.entries()) {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const stored = await storeImage({
        bytes,
        declaredMime: file.type,
        filename: file.name,
        uploadedByUserId: session.user.id,
        mediaType: "REVIEW",
        visibility: "PUBLIC",
        customerId: data.customerId,
        altText: `Review photo ${index + 1}`,
      });

      const alreadyLinked = await prisma.reviewMedia.findFirst({
        where: { reviewId, mediaAssetId: stored.assetId },
        select: { id: true },
      });
      if (!alreadyLinked) {
        await prisma.reviewMedia.create({
          data: { reviewId, mediaAssetId: stored.assetId, sortOrder: index },
        });
        photosSaved += 1;
      }
    } catch (error) {
      failures.push(
        error instanceof MediaValidationError
          ? `${file.name}: ${error.message}`
          : `${file.name}: could not be saved.`,
      );
    }
  }

  await audit({
    actorUserId: session.user.id,
    action: "crm.review.submitted",
    entityType: "product_review",
    entityId: reviewId,
    metadata: { productId: data.productId, rating, photos: photosSaved },
    ...(await requestMeta()),
  });

  revalidatePath("/reviews");
  revalidatePath(`/products/${data.productId}`);

  const parts = ["Review saved and waiting for moderation."];
  if (photosSaved > 0) parts.push(`${photosSaved} photo${photosSaved === 1 ? "" : "s"} attached.`);
  if (failures.length > 0) parts.push(failures.join(" · "));
  return { success: parts.join(" ") };
}

export async function moderateReviewAction(formData: FormData): Promise<void> {
  const session = await requirePermission("review.approve");
  const id = text(formData, "id");
  const status = text(formData, "status");
  if (!id) return;
  if (status !== "APPROVED" && status !== "REJECTED" && status !== "HIDDEN") return;

  const review = await prisma.productReview.findUnique({
    where: { id },
    select: { id: true, productId: true },
  });
  if (!review) return;

  const reason = text(formData, "reason").trim().slice(0, 500) || null;

  await prisma.productReview.update({
    where: { id },
    data: {
      status,
      moderatedByUserId: session.user.id,
      moderatedAt: new Date(),
      rejectionReason: status === "REJECTED" ? reason : null,
    },
  });

  const rating = await recomputeProductRating(review.productId);

  await audit({
    actorUserId: session.user.id,
    action: `crm.review.${status.toLowerCase()}`,
    entityType: "product_review",
    entityId: id,
    metadata: { productId: review.productId, ratingAverage: rating.average, ratingCount: rating.count },
    ...(await requestMeta()),
  });

  revalidatePath("/reviews");
  revalidatePath(`/products/${review.productId}`);
}

export async function removeReviewPhotoAction(formData: FormData): Promise<void> {
  const session = await requirePermission("review.approve");
  const id = text(formData, "id");
  const reviewId = text(formData, "reviewId");
  if (!id || !reviewId) return;

  const row = await prisma.reviewMedia.findFirst({
    where: { id, reviewId },
    select: { id: true, mediaAssetId: true, review: { select: { productId: true } } },
  });
  if (!row) return;

  await prisma.reviewMedia.delete({ where: { id } });

  await audit({
    actorUserId: session.user.id,
    action: "crm.review.photo_removed",
    entityType: "product_review",
    entityId: reviewId,
    metadata: { mediaAssetId: row.mediaAssetId },
    ...(await requestMeta()),
  });

  revalidatePath("/reviews");
  revalidatePath(`/products/${row.review.productId}`);
}
