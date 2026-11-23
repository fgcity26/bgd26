import { createHash, randomUUID } from "node:crypto";

/**
 * Upload validation (defence in depth).
 *
 * The declared MIME header, the magic bytes and the size are all checked. The
 * filename never decides the type and is never used as the storage key. Bytes
 * are not rewritten here or anywhere else.
 */
export const MEDIA_MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export const GALLERY_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
] as const;

export type GalleryMimeType = (typeof GALLERY_MIME_TYPES)[number];

const EXTENSION_BY_MIME: Record<GalleryMimeType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
};

const MIME_ALIASES: Record<string, string> = {
  "image/jpg": "image/jpeg",
  "image/pjpeg": "image/jpeg",
  "image/x-png": "image/png",
};

export class MediaValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MediaValidationError";
  }
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  if (start < 0 || start + length > bytes.length) return "";
  let text = "";
  for (let index = start; index < start + length; index += 1) {
    text += String.fromCharCode(bytes[index]);
  }
  return text;
}

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  if (bytes.length < signature.length) return false;
  return signature.every((value, index) => bytes[index] === value);
}

/**
 * Detect the real image type from the first bytes of the file.
 * Returns null for anything that is not an allow-listed raster image.
 */
export function sniffMimeType(bytes: Uint8Array): GalleryMimeType | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "image/png";
  }

  // WebP: RIFF....WEBP
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") {
    return "image/webp";
  }

  // AVIF: ISO base media file with an `ftyp` box whose brand is avif/avis.
  if (ascii(bytes, 4, 4) === "ftyp") {
    const boxSize = Math.min(
      ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0,
      bytes.length,
    );
    const majorBrand = ascii(bytes, 8, 4);
    if (majorBrand === "avif" || majorBrand === "avis") return "image/avif";

    for (let offset = 16; offset + 4 <= boxSize; offset += 4) {
      const brand = ascii(bytes, offset, 4);
      if (brand === "avif" || brand === "avis") return "image/avif";
    }
  }

  return null;
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function maxUploadBytes(): number {
  const configured = Number(process.env.MEDIA_MAX_UPLOAD_BYTES);
  return Number.isFinite(configured) && configured > 0 ? configured : MEDIA_MAX_UPLOAD_BYTES;
}

export function sanitizeOriginalFilename(filename: string, extension: string): string {
  const base = filename.split(/[\\/]/).pop() ?? "";
  const cleaned = base
    // Control characters and characters that break headers or HTML.
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, "")
    .trim()
    .slice(0, 180);

  return cleaned || `upload.${extension}`;
}

function normalizeDeclaredMime(value: string): string {
  const base = value.split(";")[0]?.trim().toLowerCase() ?? "";
  return MIME_ALIASES[base] ?? base;
}

export type ValidatedImage = {
  mimeType: GalleryMimeType;
  extension: string;
  byteSize: number;
  sha256: string;
  originalFilename: string;
};

/** Normalise a declared MIME to an allow-listed gallery type, or null. */
export function galleryMimeType(value: string): GalleryMimeType | null {
  const normalized = normalizeDeclaredMime(value);
  return (GALLERY_MIME_TYPES as readonly string[]).includes(normalized)
    ? (normalized as GalleryMimeType)
    : null;
}

/** Canonical extension for a validated gallery type. */
export function galleryExtension(mimeType: GalleryMimeType): string {
  return EXTENSION_BY_MIME[mimeType];
}

/**
 * Keys this app is allowed to adopt back from storage.
 *
 * Direct uploads are issued for `gallery/YYYY/MM/<uuid>.<ext>`; anything else
 * (another tenant's object, a production file, a traversal attempt) is refused
 * even if the caller learned the key.
 */
const GALLERY_KEY_PATTERN =
  /^gallery\/\d{4}\/\d{2}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp|avif)$/;

export function isGalleryStorageKey(key: string): boolean {
  return GALLERY_KEY_PATTERN.test(key);
}

export function validateImageUpload(input: {
  bytes: Uint8Array;
  declaredMime: string;
  filename: string;
  maxBytes?: number;
}): ValidatedImage {
  const limit = input.maxBytes ?? maxUploadBytes();
  const { bytes } = input;

  if (bytes.byteLength === 0) {
    throw new MediaValidationError("The selected file is empty.");
  }
  if (bytes.byteLength > limit) {
    const megabytes = Math.round(limit / (1024 * 1024));
    throw new MediaValidationError(`Images must be ${megabytes} MB or smaller.`);
  }

  const declared = normalizeDeclaredMime(input.declaredMime);
  if (declared === "image/svg+xml") {
    throw new MediaValidationError("SVG files are not accepted. Upload a JPEG, PNG, WebP or AVIF image.");
  }

  const detected = sniffMimeType(bytes);
  if (!detected) {
    throw new MediaValidationError(
      "That file is not a supported image. Use JPEG, PNG, WebP or AVIF.",
    );
  }

  // An explicit, recognised image type must match the bytes. A generic
  // octet-stream declaration (some phones send this) falls back to detection.
  if (
    declared &&
    declared !== "application/octet-stream" &&
    declared !== "binary/octet-stream" &&
    declared !== detected
  ) {
    throw new MediaValidationError(
      `The file says ${declared} but its contents are ${detected}. Upload the original file.`,
    );
  }

  const extension = EXTENSION_BY_MIME[detected];

  return {
    mimeType: detected,
    extension,
    byteSize: bytes.byteLength,
    sha256: sha256Hex(bytes),
    originalFilename: sanitizeOriginalFilename(input.filename, extension),
  };
}

/** Random, immutable storage key: gallery/YYYY/MM/{uuid}.{ext}. */
export function mediaStorageKey(extension: string, now = new Date()): string {
  const safeExtension = extension.replace(/[^a-z0-9]/gi, "").toLowerCase() || "bin";
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `gallery/${year}/${month}/${randomUUID()}.${safeExtension}`;
}
