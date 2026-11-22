import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  localStorageAdapter,
  readLocalObject,
} from "../src/lib/adapters/storage/local";
import { StorageError } from "../src/lib/adapters/storage/types";
import {
  canViewCostPrices,
  toProductView,
  type ProductWithRelations,
} from "../src/lib/catalog/dto";
import {
  formatPaisa,
  netOfVatInclusive,
  parseMoneyToPaisa,
  parseUnitCost,
  percentageToBasisPoints,
  vatPortionInclusive,
} from "../src/lib/catalog/pricing";
import { prisma } from "../src/lib/db";
import { readImageDimensions } from "../src/lib/media/dimensions";
import { storeGalleryImage } from "../src/lib/media/service";
import {
  MediaValidationError,
  mediaStorageKey,
  sha256Hex,
  sniffMimeType,
  validateImageUpload,
} from "../src/lib/media/validate";

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const JPEG_HEADER = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const WEBP_HEADER = Uint8Array.from([
  ...Buffer.from("RIFF"),
  0x00,
  0x00,
  0x00,
  0x00,
  ...Buffer.from("WEBP"),
  0x56,
  0x50,
  0x38,
  0x58,
]);
const AVIF_HEADER = Uint8Array.from([
  0x00,
  0x00,
  0x00,
  0x18,
  ...Buffer.from("ftyp"),
  ...Buffer.from("avif"),
  0x00,
  0x00,
  0x00,
  0x00,
]);

function pngWithRandomTail(): Uint8Array {
  return new Uint8Array(Buffer.concat([PNG_1X1, randomBytes(12)]));
}

test("magic bytes identify allow-listed images and reject everything else", () => {
  assert.equal(sniffMimeType(new Uint8Array(PNG_1X1)), "image/png");
  assert.equal(sniffMimeType(JPEG_HEADER), "image/jpeg");
  assert.equal(sniffMimeType(WEBP_HEADER), "image/webp");
  assert.equal(sniffMimeType(AVIF_HEADER), "image/avif");

  assert.equal(sniffMimeType(new Uint8Array(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"))), null);
  assert.equal(sniffMimeType(new Uint8Array(Buffer.from("%PDF-1.7"))), null);
  assert.equal(sniffMimeType(new Uint8Array()), null);
});

test("upload validation enforces MIME, size, filename and checksum", () => {
  const bytes = pngWithRandomTail();
  const valid = validateImageUpload({
    bytes,
    declaredMime: "image/png",
    filename: "../../evil name.png",
  });

  assert.equal(valid.mimeType, "image/png");
  assert.equal(valid.extension, "png");
  assert.equal(valid.byteSize, bytes.byteLength);
  assert.equal(valid.sha256, sha256Hex(bytes));
  assert.equal(valid.originalFilename, "evil name.png");

  assert.throws(
    () =>
      validateImageUpload({
        bytes,
        declaredMime: "image/jpeg",
        filename: "wrong.jpg",
      }),
    MediaValidationError,
  );

  assert.throws(
    () =>
      validateImageUpload({
        bytes: new Uint8Array(Buffer.from("<svg/>")),
        declaredMime: "image/svg+xml",
        filename: "x.svg",
      }),
    /SVG/,
  );

  assert.throws(
    () => validateImageUpload({ bytes, declaredMime: "image/png", filename: "x.png", maxBytes: 10 }),
    /MB or smaller/,
  );

  assert.throws(
    () => validateImageUpload({ bytes: new Uint8Array(), declaredMime: "image/png", filename: "x.png" }),
    /empty/,
  );

  // A generic octet-stream declaration is accepted only when the bytes are real.
  assert.equal(
    validateImageUpload({ bytes, declaredMime: "application/octet-stream", filename: "phone" }).mimeType,
    "image/png",
  );
});

test("storage keys are random, immutable and dated", () => {
  const key = mediaStorageKey("png", new Date("2026-11-16T00:00:00Z"));
  assert.match(key, /^gallery\/2026\/11\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.png$/);
  assert.notEqual(key, mediaStorageKey("png", new Date("2026-11-16T00:00:00Z")));
});

test("SHA-256 is stable", () => {
  assert.equal(
    sha256Hex(new Uint8Array(Buffer.from("abc"))),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});

test("VAT-inclusive money uses integer paisa and half-up rounding", () => {
  assert.equal(parseMoneyToPaisa("1,234.50"), 123450);
  assert.equal(parseMoneyToPaisa("0"), 0);
  assert.equal(formatPaisa(123450), "1234.50");
  assert.equal(formatPaisa(5), "0.05");
  assert.throws(() => parseMoneyToPaisa("1.234"), /two decimal/);

  assert.equal(percentageToBasisPoints("15"), 1500);
  assert.equal(percentageToBasisPoints("15.50"), 1550);

  // ৳1150 gross at 15% contains ৳150 VAT.
  assert.equal(vatPortionInclusive(115000, "15"), 15000);
  assert.equal(netOfVatInclusive(115000, "15"), 100000);
  assert.equal(vatPortionInclusive(115000, "0"), 0);

  // 100 × 100 / 200 = 0.5 paisa → 1 paisa (half-up).
  assert.equal(vatPortionInclusive(1, "100"), 1);

  assert.equal(parseUnitCost("12.3456"), "12.3456");
  assert.equal(parseUnitCost("12"), "12.0000");
  assert.throws(() => parseUnitCost("12.34567"), /four decimal/);
});

test("image dimensions are read without decoding or rewriting", () => {
  assert.deepEqual(readImageDimensions(new Uint8Array(PNG_1X1), "image/png"), {
    width: 1,
    height: 1,
  });

  const jpeg = new Uint8Array(24);
  jpeg.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x0b, 0x08]);
  jpeg[13] = 0x02;
  jpeg[14] = 0x58; // height 600
  jpeg[15] = 0x03;
  jpeg[16] = 0x20; // width 800
  assert.deepEqual(readImageDimensions(jpeg, "image/jpeg"), { width: 800, height: 600 });

  assert.equal(readImageDimensions(new Uint8Array(Buffer.from("not an image")), "image/png"), null);
});

test("local storage adapter refuses overwrites, traversal and reports true bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "bgd26-media-"));
  const previous = process.env.STORAGE_LOCAL_DIR;
  process.env.STORAGE_LOCAL_DIR = root;

  try {
    const key = "gallery/2026/11/test.png";
    const bytes = pngWithRandomTail();

    await localStorageAdapter.put({ key, bytes, contentType: "image/png" });
    const info = await localStorageAdapter.inspect(key);
    assert.equal(info.byteSize, bytes.byteLength);
    assert.equal(info.sha256, sha256Hex(bytes));

    const stored = await readLocalObject(key);
    assert.deepEqual(Buffer.from(stored), Buffer.from(bytes));

    const stream = await localStorageAdapter.open(key);
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
    assert.deepEqual(Buffer.concat(chunks), Buffer.from(bytes));

    await assert.rejects(
      () => localStorageAdapter.put({ key, bytes, contentType: "image/png" }),
      (error: unknown) => error instanceof StorageError && error.code === "ALREADY_EXISTS",
    );

    await assert.rejects(
      () => localStorageAdapter.inspect("../escape.png"),
      (error: unknown) => error instanceof StorageError && error.code === "INVALID_KEY",
    );

    await localStorageAdapter.remove(key);
    await assert.rejects(
      () => localStorageAdapter.inspect(key),
      (error: unknown) => error instanceof StorageError && error.code === "NOT_FOUND",
    );
  } finally {
    if (previous === undefined) delete process.env.STORAGE_LOCAL_DIR;
    else process.env.STORAGE_LOCAL_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("gallery service stores original bytes and reuses identical uploads", async () => {
  const root = await mkdtemp(join(tmpdir(), "bgd26-service-"));
  const previousDir = process.env.STORAGE_LOCAL_DIR;
  const previousProvider = process.env.STORAGE_PROVIDER;
  process.env.STORAGE_LOCAL_DIR = root;
  process.env.STORAGE_PROVIDER = "local";

  const owner = await prisma.user.findFirst({ select: { id: true } });
  assert.ok(owner, "The local database must be seeded before running this test.");

  const createdIds: string[] = [];
  try {
    const bytes = pngWithRandomTail();
    const first = await storeGalleryImage({
      bytes,
      declaredMime: "image/png",
      filename: "original.png",
      uploadedByUserId: owner.id,
      altText: "Test image",
    });
    createdIds.push(first.assetId);
    assert.equal(first.deduped, false);
    assert.equal(first.sha256, sha256Hex(bytes));
    assert.equal(first.width, 1);
    assert.equal(first.height, 1);

    const second = await storeGalleryImage({
      bytes,
      declaredMime: "image/png",
      filename: "same-bytes-again.png",
      uploadedByUserId: owner.id,
    });
    assert.equal(second.deduped, true);
    assert.equal(second.assetId, first.assetId);
    assert.equal(second.storageKey, first.storageKey);

    const asset = await prisma.mediaAsset.findUniqueOrThrow({
      where: { id: first.assetId },
      select: { isZeroTransform: true, sha256Checksum: true, storageProvider: true },
    });
    assert.equal(asset.isZeroTransform, true);
    assert.equal(asset.sha256Checksum, first.sha256);
    assert.equal(asset.storageProvider, "LOCAL");
  } finally {
    if (createdIds.length > 0) {
      await prisma.mediaAsset.deleteMany({ where: { id: { in: createdIds } } });
    }
    if (previousDir === undefined) delete process.env.STORAGE_LOCAL_DIR;
    else process.env.STORAGE_LOCAL_DIR = previousDir;
    if (previousProvider === undefined) delete process.env.STORAGE_PROVIDER;
    else process.env.STORAGE_PROVIDER = previousProvider;
    await rm(root, { recursive: true, force: true });
  }
});

test("cost prices are stripped from DTOs for roles without accounting access", () => {
  const decimal = (value: string) => ({ toString: () => value });
  const product = {
    id: "p1",
    name: "Test",
    nameBn: null,
    slug: "test",
    sku: "SKU-1",
    shortDescription: null,
    description: null,
    descriptionBn: null,
    productType: "STOCKED",
    status: "ACTIVE",
    basePrice: decimal("100.00"),
    compareAtPrice: null,
    costPrice: decimal("60.0000"),
    tags: [],
    weightGrams: null,
    warrantyMonths: null,
    minOrderQty: 1,
    isFeatured: false,
    isPublished: true,
    isCustomizable: false,
    requiresDesignApproval: false,
    advancePercentage: decimal("50.00"),
    isDropshipEnabled: false,
    seoTitle: null,
    seoDescription: null,
    archivedAt: null,
    createdAt: new Date("2026-11-16T00:00:00Z"),
    updatedAt: new Date("2026-11-16T00:00:00Z"),
    category: {
      id: "c1",
      name: "Gifts",
      nameBn: "গিফট",
      slug: "gifts",
      vatPercentage: decimal("15.00"),
    },
    brand: null,
    variants: [
      {
        id: "v1",
        productId: "p1",
        sku: "SKU-1",
        barcode: null,
        name: "Default",
        attributes: null,
        price: decimal("100.00"),
        compareAtPrice: null,
        costPrice: decimal("60.0000"),
        fulfillmentType: "STOCKED",
        dropshipSupplierId: null,
        dropshipSupplierSku: null,
        dropshipCost: null,
        isDefault: true,
        status: "ACTIVE",
        weightGrams: null,
        imageUrl: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
    media: [],
  } as unknown as ProductWithRelations;

  const hidden = toProductView(product, { canViewCost: false });
  assert.equal("costPrice" in hidden, false);
  assert.equal("costPrice" in hidden.variants[0], false);

  const visible = toProductView(product, { canViewCost: true });
  assert.equal(visible.costPrice, "60.0000");
  assert.equal(visible.variants[0].costPrice, "60.0000");

  assert.equal(canViewCostPrices({ permissions: new Set(["account.read"]) }), true);
  assert.equal(canViewCostPrices({ permissions: new Set(["report.read"]) }), true);
  assert.equal(canViewCostPrices({ permissions: new Set(["product.read"]) }), false);
});
