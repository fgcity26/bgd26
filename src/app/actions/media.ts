"use server";

import { revalidatePath } from "next/cache";
import { audit } from "@/lib/auth/audit";
import { requestMeta } from "@/lib/auth/request-meta";
import { requirePermission } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import {
  completeGalleryUpload,
  prepareGalleryUpload,
  storeGalleryImage,
  type StoredGalleryImage,
} from "@/lib/media/service";
import { MediaValidationError } from "@/lib/media/validate";
import { StorageError } from "@/lib/adapters/storage";

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

  const problem = await editableProduct(productId, variantId);
  if (problem) return { error: problem };

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

      const outcome = await linkStoredImage({
        actorUserId: session.user.id,
        productId,
        variantId,
        stored,
        makePrimary,
      });

      if (outcome === "already") {
        alreadyLinked += 1;
        continue;
      }

      if (stored.deduped) reused += 1;
      else added += 1;
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

// -----------------------------------------------------------------------------
// Direct uploads (browser → Supabase Storage)
//
// Used when the object store is remote and the deployment caps request bodies
// below the 20 MB original limit. The signed URL is issued per file by the
// server; the browser never sees the service-role key.
// -----------------------------------------------------------------------------

export type PreparedUpload = { key: string; uploadUrl: string };

export async function prepareMediaUploadAction(input: {
  productId: string;
  variantId?: string | null;
  declaredMime: string;
  byteSize: number;
}): Promise<PreparedUpload | { error: string }> {
  await requirePermission("product.write");

  const variantId = input.variantId || null;
  const problem = await editableProduct(input.productId, variantId);
  if (problem) return { error: problem };

  try {
    const prepared = await prepareGalleryUpload({
      declaredMime: input.declaredMime,
      byteSize: input.byteSize,
    });
    return { key: prepared.key, uploadUrl: prepared.uploadUrl };
  } catch (error) {
    if (error instanceof MediaValidationError || error instanceof StorageError) {
      return { error: error.message };
    }
    console.error("[media] prepare upload failed", error);
    return { error: "Could not start the upload." };
  }
}

export type CompletedUpload = {
  key: string;
  declaredMime: string;
  filename: string;
};

export async function completeMediaUploadAction(input: {
  productId: string;
  variantId?: string | null;
  altText?: string;
  isPrimary?: boolean;
  uploads: CompletedUpload[];
}): Promise<MediaFormState> {
  const session = await requirePermission("product.write");
  const productId = typeof input.productId === "string" ? input.productId : "";
  const variantId = input.variantId || null;
  const altText = (input.altText ?? "").trim() || null;
  const makePrimary = input.isPrimary === true;
  const uploads = Array.isArray(input.uploads) ? input.uploads : [];

  if (!productId) return { error: "Missing product id." };
  if (uploads.length === 0) return { error: "Choose at least one image." };
  if (uploads.length > 8) return { error: "Upload at most eight images at a time." };

  const problem = await editableProduct(productId, variantId);
  if (problem) return { error: problem };

  let added = 0;
  let reused = 0;
  let alreadyLinked = 0;
  const failures: string[] = [];

  for (const upload of uploads) {
    try {
      const stored = await completeGalleryUpload({
        key: upload.key,
        filename: upload.filename,
        declaredMime: upload.declaredMime,
        uploadedByUserId: session.user.id,
        altText,
      });

      const outcome = await linkStoredImage({
        actorUserId: session.user.id,
        productId,
        variantId,
        stored,
        makePrimary,
      });

      if (outcome === "already") {
        alreadyLinked += 1;
        continue;
      }

      if (stored.deduped) reused += 1;
      else added += 1;
    } catch (error) {
      if (error instanceof MediaValidationError || error instanceof StorageError) {
        failures.push(`${upload.filename}: ${error.message}`);
      } else {
        console.error("[media] direct upload failed", error);
        failures.push(`${upload.filename}: could not be saved.`);
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

async function editableProduct(
  productId: string,
  variantId: string | null,
): Promise<string | null> {
  if (!productId) return "Missing product id.";

  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, archivedAt: true },
  });
  if (!product || product.archivedAt) return "That product cannot be edited.";

  if (variantId) {
    const variant = await prisma.productVariant.findFirst({
      where: { id: variantId, productId },
      select: { id: true },
    });
    if (!variant) return "That variant does not belong to this product.";
  }

  return null;
}

type LinkOutcome = "linked" | "already";

async function linkStoredImage(input: {
  actorUserId: string;
  productId: string;
  variantId: string | null;
  stored: StoredGalleryImage;
  makePrimary: boolean;
}): Promise<LinkOutcome> {
  const { actorUserId, productId, variantId, stored, makePrimary } = input;

  // The same bytes may already be in this product's gallery. Reusing the
  // asset is fine, but the product↔asset link is unique per role.
  const linked = await prisma.productMedia.findFirst({
    where: { productId, mediaAssetId: stored.assetId, role: "GALLERY" },
    select: { id: true },
  });
  if (linked) return "already";

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

  await audit({
    actorUserId,
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

  return "linked";
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
