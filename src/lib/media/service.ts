import {
  getStorageAdapter,
  StorageError,
  type StorageProvider,
} from "@/lib/adapters/storage";
import { prisma } from "@/lib/db";
import { readImageDimensions } from "./dimensions";
import {
  galleryExtension,
  galleryMimeType,
  isGalleryStorageKey,
  maxUploadBytes,
  MediaValidationError,
  mediaStorageKey,
  validateImageUpload,
} from "./validate";

/**
 * Store an image exactly as uploaded.
 *
 * 1. Validate declared MIME, magic bytes and size.
 * 2. Reuse an existing asset with the same SHA-256, type and visibility.
 * 3. Write an immutable random key through the storage adapter.
 * 4. Re-read the object and compare SHA-256 + size before recording it.
 *
 * Step 4 is the zero-transform guarantee: if any layer rewrote the bytes, the
 * upload fails and the partial object is removed.
 */
export type StoreImageInput = {
  bytes: Uint8Array;
  declaredMime: string;
  filename: string;
  uploadedByUserId: string;
  altText?: string | null;
  maxBytes?: number;
  /** GALLERY for products, REVIEW for customer review photos. */
  mediaType?: "GALLERY" | "REVIEW";
  visibility?: "PUBLIC" | "PRIVATE";
  customerId?: string | null;
};

export type StoreGalleryImageInput = Omit<
  StoreImageInput,
  "mediaType" | "visibility" | "customerId"
>;

export type StoredImage = {
  assetId: string;
  storageKey: string;
  sha256: string;
  byteSize: number;
  mimeType: string;
  width: number | null;
  height: number | null;
  deduped: boolean;
  provider: StorageProvider;
};

export type StoredGalleryImage = StoredImage;

export function storageBucket(provider: StorageProvider): string {
  if (provider === "supabase") {
    return process.env.SUPABASE_STORAGE_BUCKET?.trim() || "bgd26-media";
  }
  return process.env.STORAGE_LOCAL_BUCKET?.trim() || "local";
}

export async function storeImage(input: StoreImageInput): Promise<StoredImage> {
  const validated = validateImageUpload({
    bytes: input.bytes,
    declaredMime: input.declaredMime,
    filename: input.filename,
    maxBytes: input.maxBytes,
  });

  const mediaType = input.mediaType ?? "GALLERY";
  const visibility = input.visibility ?? "PUBLIC";

  const adapter = getStorageAdapter();
  const bucket = storageBucket(adapter.provider);

  const existing = await prisma.mediaAsset.findFirst({
    where: {
      sha256Checksum: validated.sha256,
      mediaType,
      visibility,
      storageProvider: adapter.provider.toUpperCase(),
      bucket,
    },
    select: { id: true, storageKey: true, width: true, height: true },
  });

  if (existing) {
    return {
      assetId: existing.id,
      storageKey: existing.storageKey,
      sha256: validated.sha256,
      byteSize: validated.byteSize,
      mimeType: validated.mimeType,
      width: existing.width,
      height: existing.height,
      deduped: true,
      provider: adapter.provider,
    };
  }

  const key = mediaStorageKey(validated.extension);
  await adapter.put({ key, bytes: input.bytes, contentType: validated.mimeType });

  try {
    const stored = await adapter.inspect(key);
    if (stored.sha256 !== validated.sha256 || stored.byteSize !== validated.byteSize) {
      throw new MediaValidationError(
        "The stored file did not match the upload. Nothing was saved.",
      );
    }

    const dimensions = readImageDimensions(input.bytes, validated.mimeType);

    const asset = await prisma.mediaAsset.create({
      data: {
        storageProvider: adapter.provider.toUpperCase(),
        bucket,
        storageKey: key,
        originalFilename: validated.originalFilename,
        mimeType: validated.mimeType,
        byteSize: validated.byteSize,
        sha256Checksum: validated.sha256,
        width: dimensions?.width ?? null,
        height: dimensions?.height ?? null,
        mediaType,
        visibility,
        altText: input.altText?.trim() || null,
        uploadedByUserId: input.uploadedByUserId,
        customerId: input.customerId ?? null,
        isZeroTransform: true,
      },
      select: { id: true },
    });

    return {
      assetId: asset.id,
      storageKey: key,
      sha256: validated.sha256,
      byteSize: validated.byteSize,
      mimeType: validated.mimeType,
      width: dimensions?.width ?? null,
      height: dimensions?.height ?? null,
      deduped: false,
      provider: adapter.provider,
    };
  } catch (error) {
    // Never leave an orphan object behind when validation or the DB write fails.
    await adapter.remove(key).catch(() => undefined);
    throw error;
  }
}

/** Product gallery uploads keep the original GALLERY/PUBLIC semantics. */
export async function storeGalleryImage(
  input: StoreGalleryImageInput,
): Promise<StoredGalleryImage> {
  return storeImage({ ...input, mediaType: "GALLERY", visibility: "PUBLIC" });
}

// -----------------------------------------------------------------------------
// Direct browser → object storage uploads
//
// Vercel functions reject request bodies above 4.5 MB, so a 20 MB original can
// never pass through the multipart action in production. The browser PUTs the
// bytes straight to a short-lived signed URL instead; the server then adopts the
// object, re-validates it and records its SHA-256 before anything is linked.
// -----------------------------------------------------------------------------

export type PreparedGalleryUpload = {
  key: string;
  uploadUrl: string;
  token: string;
  expiresInSeconds: number | null;
};

export async function prepareGalleryUpload(input: {
  declaredMime: string;
  byteSize: number;
  maxBytes?: number;
}): Promise<PreparedGalleryUpload> {
  const mimeType = galleryMimeType(input.declaredMime);
  if (!mimeType) {
    throw new MediaValidationError("Use a JPEG, PNG, WebP or AVIF image. SVG is refused.");
  }

  const limit = input.maxBytes ?? maxUploadBytes();
  if (!Number.isFinite(input.byteSize) || input.byteSize <= 0) {
    throw new MediaValidationError("The selected file is empty.");
  }
  if (input.byteSize > limit) {
    const megabytes = Math.round(limit / (1024 * 1024));
    throw new MediaValidationError(`Images must be ${megabytes} MB or smaller.`);
  }

  const adapter = getStorageAdapter();
  if (!adapter.createSignedUploadUrl) {
    throw new StorageError(
      "PROVIDER_ERROR",
      "This storage provider does not support direct uploads. Use the upload form instead.",
    );
  }

  const key = mediaStorageKey(galleryExtension(mimeType));
  const signed = await adapter.createSignedUploadUrl({ key });

  return { key, ...signed };
}

async function readStoredBytes(
  stream: ReadableStream<Uint8Array>,
  limit: number,
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;

    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => undefined);
      const megabytes = Math.round(limit / (1024 * 1024));
      throw new MediaValidationError(`Images must be ${megabytes} MB or smaller.`);
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export type CompleteGalleryUploadInput = {
  key: string;
  filename: string;
  declaredMime: string;
  uploadedByUserId: string;
  altText?: string | null;
  maxBytes?: number;
};

/**
 * Adopt an object the browser already uploaded.
 *
 * The bytes are read back from storage, validated exactly like a multipart
 * upload (magic bytes, declared type, size) and hashed. An invalid object is
 * removed. An identical asset is reused and the duplicate object deleted.
 */
export async function completeGalleryUpload(
  input: CompleteGalleryUploadInput,
): Promise<StoredGalleryImage> {
  if (!isGalleryStorageKey(input.key)) {
    throw new MediaValidationError("That upload key is not recognised.");
  }

  const adapter = getStorageAdapter();
  const bucket = storageBucket(adapter.provider);
  const limit = input.maxBytes ?? maxUploadBytes();

  try {
    const bytes = await readStoredBytes(await adapter.open(input.key), limit);
    const validated = validateImageUpload({
      bytes,
      declaredMime: input.declaredMime,
      filename: input.filename,
      maxBytes: limit,
    });

    const existing = await prisma.mediaAsset.findFirst({
      where: {
        sha256Checksum: validated.sha256,
        mediaType: "GALLERY",
        visibility: "PUBLIC",
        storageProvider: adapter.provider.toUpperCase(),
        bucket,
      },
      select: { id: true, storageKey: true, width: true, height: true },
    });

    if (existing) {
      await adapter.remove(input.key).catch(() => undefined);
      return {
        assetId: existing.id,
        storageKey: existing.storageKey,
        sha256: validated.sha256,
        byteSize: validated.byteSize,
        mimeType: validated.mimeType,
        width: existing.width,
        height: existing.height,
        deduped: true,
        provider: adapter.provider,
      };
    }

    const dimensions = readImageDimensions(bytes, validated.mimeType);

    const asset = await prisma.mediaAsset.create({
      data: {
        storageProvider: adapter.provider.toUpperCase(),
        bucket,
        storageKey: input.key,
        originalFilename: validated.originalFilename,
        mimeType: validated.mimeType,
        byteSize: validated.byteSize,
        sha256Checksum: validated.sha256,
        width: dimensions?.width ?? null,
        height: dimensions?.height ?? null,
        mediaType: "GALLERY",
        visibility: "PUBLIC",
        altText: input.altText?.trim() || null,
        uploadedByUserId: input.uploadedByUserId,
        isZeroTransform: true,
      },
      select: { id: true },
    });

    return {
      assetId: asset.id,
      storageKey: input.key,
      sha256: validated.sha256,
      byteSize: validated.byteSize,
      mimeType: validated.mimeType,
      width: dimensions?.width ?? null,
      height: dimensions?.height ?? null,
      deduped: false,
      provider: adapter.provider,
    };
  } catch (error) {
    await adapter.remove(input.key).catch(() => undefined);
    throw error;
  }
}
