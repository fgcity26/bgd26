/**
 * Best-effort image dimension readers.
 *
 * Dimensions are stored so pages can reserve space with explicit width/height
 * (no layout shift). Reading them never modifies the bytes. When a format is not
 * understood the caller stores null and the UI falls back to an aspect ratio.
 */
export type ImageDimensions = { width: number; height: number };

function uint16be(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function uint32be(bytes: Uint8Array, offset: number): number {
  return (
    (((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>>
      0)
  );
}

function uint24le(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function readPng(bytes: Uint8Array): ImageDimensions | null {
  // Signature (8) + length (4) + "IHDR" (4) + width (4) + height (4).
  if (bytes.length < 24) return null;
  if (String.fromCharCode(...bytes.subarray(12, 16)) !== "IHDR") return null;
  const width = uint32be(bytes, 16);
  const height = uint32be(bytes, 20);
  return width > 0 && height > 0 ? { width, height } : null;
}

function readJpeg(bytes: Uint8Array): ImageDimensions | null {
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    if (marker === 0xd8 || marker === 0xd9) {
      offset += 2;
      continue;
    }
    if (marker === 0xda) return null; // Start of scan: no SOF before it.

    const length = uint16be(bytes, offset + 2);
    if (length < 2) return null;

    const isStartOfFrame =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isStartOfFrame) {
      const height = uint16be(bytes, offset + 5);
      const width = uint16be(bytes, offset + 7);
      return width > 0 && height > 0 ? { width, height } : null;
    }

    offset += 2 + length;
  }
  return null;
}

function readWebp(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length < 30) return null;
  const chunk = String.fromCharCode(...bytes.subarray(12, 16));

  if (chunk === "VP8X") {
    const width = uint24le(bytes, 24) + 1;
    const height = uint24le(bytes, 27) + 1;
    return { width, height };
  }

  if (chunk === "VP8 ") {
    // Lossy: 3-byte frame tag, 3-byte start code, then 14-bit dimensions.
    const width = uint16be(bytes, 26) & 0x3fff;
    const height = uint16be(bytes, 28) & 0x3fff;
    return width > 0 && height > 0 ? { width, height } : null;
  }

  if (chunk === "VP8L") {
    const bits = bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24);
    const width = (bits & 0x3fff) + 1;
    const height = ((bits >>> 14) & 0x3fff) + 1;
    return { width, height };
  }

  return null;
}

function readAvif(bytes: Uint8Array): ImageDimensions | null {
  // Locate the `ispe` (image spatial extents) box. Its payload is
  // version/flags (4), width (4), height (4). A raw scan is safe because the
  // box type is four ASCII bytes and the payload is bounds-checked.
  for (let offset = 0; offset + 16 <= bytes.length; offset += 1) {
    if (
      bytes[offset] === 0x69 &&
      bytes[offset + 1] === 0x73 &&
      bytes[offset + 2] === 0x70 &&
      bytes[offset + 3] === 0x65
    ) {
      const width = uint32be(bytes, offset + 8);
      const height = uint32be(bytes, offset + 12);
      return width > 0 && height > 0 ? { width, height } : null;
    }
  }
  return null;
}

export function readImageDimensions(
  bytes: Uint8Array,
  mimeType: string,
): ImageDimensions | null {
  try {
    switch (mimeType) {
      case "image/png":
        return readPng(bytes);
      case "image/jpeg":
        return readJpeg(bytes);
      case "image/webp":
        return readWebp(bytes);
      case "image/avif":
        return readAvif(bytes);
      default:
        return null;
    }
  } catch {
    return null;
  }
}
