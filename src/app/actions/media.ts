"use server";

import { revalidatePath } from "next/cache";
import { audit } from "@/lib/auth/audit";
import { requestMeta } from "@/lib/auth/request-meta";
import { requirePermission } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { storeGalleryImage } from "@/lib/media/service";
import { MediaValidationError } from "@/lib/media/validate";

/**
 * Product gallery actions.
 *
 * Uploads go through the storage adapter, are re-read and checksum-verified,
 * and are linked to the product. Removing an image unlinks it from the gallery;
 * the `media_assets` row and its bytes are retained (docs/ARCHITECTURE.md §10).
 */
export type MediaFormState = {
  error?: string;
  success?: string;
};

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function filesFrom(formData: FormData): File[] {
  return formData
    .getAll("files")
    .filter((value): value is File => value instanceof File && value.size > 0);
}

export async function uploadProductMediaAction(
  _previous: MediaFormState,
  formData: FormData,
): Promise<MediaFormState> {
  const session = await requirePermission("product.write");
  const productId = text(formData, "productId");
  const variantId = text(formData, "variantId") || null;
  const altText = text(formData, "altText").trim() || null;
  const makePrimary = formData.get("isPrimary") === "on";
  const files = filesFrom(formData);

  if (!productId) return { error: "Missing product id." };
  if (files.length === 0) return { error: "Choose at least one image." };
  if (files.length > 8) return { error: "Upload at most eight images at a time." };

  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, archivedAt: true },
  });
  if (!product || product.archivedAt) return { error: "That product cannot be edited." };

  if (variantId) {
    const variant = await prisma.productVariant.findFirst({
      where: { id: variantId, productId },
      select: { id: true },
    });
    if (!variant) return { error: "That variant does not belong to this product." };
  }

  let added = 0;
  let reused = 0;
  let alreadyLinked = 0;
  const failures: string[] = [];

  for (const file of files) {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const stored = await storeGalleryImage({
        bytes,
        declaredMime: file.type,
        filename: file.name,
        uploadedByUserId: session.user.id,
        altText,
      });

      // The same bytes may already be in this product's gallery. Reusing the
      // asset is fine, but the product↔asset link is unique per role.
      const linked = await prisma.productMedia.findFirst({
        where: { productId, mediaAssetId: stored.assetId, role: "GALLERY" },
        select: { id: true },
      });
      if (linked) {
        alreadyLinked += 1;
        continue;
      }

      const existingCount = await prisma.productMedia.count({ where: { productId } });
      const primary = makePrimary || existingCount === 0;

      await prisma.$transaction(async (tx) => {
        if (primary) {
          await tx.productMedia.updateMany({
            where: { productId },
            data: { isPrimary: false },
          });
        }
        await tx.productMedia.create({
          data: {
            productId,
            variantId,
            mediaAssetId: stored.assetId,
            role: "GALLERY",
            isPrimary: primary,
            sortOrder: existingCount,
          },
        });
      });

      if (stored.deduped) reused += 1;
      else added += 1;

      await audit({
        actorUserId: session.user.id,
        action: "catalog.media.linked",
        entityType: "product",
        entityId: productId,
        metadata: {
          mediaAssetId: stored.assetId,
          sha256: stored.sha256,
          byteSize: stored.byteSize,
          deduped: stored.deduped,
        },
        ...(await requestMeta()),
      });
    } catch (error) {
      if (error instanceof MediaValidationError) {
        failures.push(`${file.name}: ${error.message}`);
      } else {
        console.error("[media] upload failed", error);
        failures.push(`${file.name}: could not be saved.`);
      }
    }
  }

  revalidatePath(`/products/${productId}`);
  revalidatePath("/products");

  if (added + reused === 0) {
    if (alreadyLinked > 0) {
      return { error: "That image is already in this product's gallery." };
    }
    return { error: failures[0] ?? "No images were saved." };
  }

  const parts = [`${added + reused} image${added + reused === 1 ? "" : "s"} saved`];
  if (reused > 0) parts.push(`${reused} reused from an identical upload`);
  if (alreadyLinked > 0) parts.push(`${alreadyLinked} already in the gallery`);
  if (failures.length > 0) parts.push(failures.join(" · "));

  return { success: `${parts.join("; ")}.` };
}

export async function removeProductMediaAction(formData: FormData): Promise<void> {
  const session = await requirePermission("product.write");
  const id = text(formData, "id");
  const productId = text(formData, "productId");
  if (!id || !productId) return;

  const row = await prisma.productMedia.findFirst({
    where: { id, productId },
    select: { id: true, isPrimary: true, mediaAssetId: true },
  });
  if (!row) return;

  await prisma.$transaction(async (tx) => {
    await tx.productMedia.delete({ where: { id } });
    if (row.isPrimary) {
      const next = await tx.productMedia.findFirst({
        where: { productId },
        orderBy: { sortOrder: "asc" },
        select: { id: true },
      });
      if (next) {
        await tx.productMedia.update({ where: { id: next.id }, data: { isPrimary: true } });
      }
    }
  });

  await audit({
    actorUserId: session.user.id,
    action: "catalog.media.unlinked",
    entityType: "product",
    entityId: productId,
    metadata: { productMediaId: row.id, mediaAssetId: row.mediaAssetId },
    ...(await requestMeta()),
  });

  revalidatePath(`/products/${productId}`);
  revalidatePath("/products");
}

export async function setPrimaryProductMediaAction(formData: FormData): Promise<void> {
  const session = await requirePermission("product.write");
  const id = text(formData, "id");
  const productId = text(formData, "productId");
  if (!id || !productId) return;

  const row = await prisma.productMedia.findFirst({
    where: { id, productId },
    select: { id: true },
  });
  if (!row) return;

  await prisma.$transaction([
    prisma.productMedia.updateMany({ where: { productId }, data: { isPrimary: false } }),
    prisma.productMedia.update({ where: { id }, data: { isPrimary: true } }),
  ]);

  await audit({
    actorUserId: session.user.id,
    action: "catalog.media.primary_changed",
    entityType: "product",
    entityId: productId,
    metadata: { productMediaId: id },
    ...(await requestMeta()),
  });

  revalidatePath(`/products/${productId}`);
  revalidatePath("/products");
}
