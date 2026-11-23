import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localStorageAdapter } from "../src/lib/adapters/storage/local";
import { StorageError } from "../src/lib/adapters/storage/types";
import { prisma } from "../src/lib/db";
import { completeGalleryUpload, prepareGalleryUpload } from "../src/lib/media/service";
import {
  isGalleryStorageKey,
  MediaValidationError,
  mediaStorageKey,
  sha256Hex,
} from "../src/lib/media/validate";

/**
 * Direct uploads keep the zero-transform guarantee: the browser writes the
 * bytes to storage, and the server adopts the object only after re-reading,
 * re-validating and hashing it.
 */

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function pngWithRandomTail(): Uint8Array {
  return Uint8Array.from([...PNG_1X1, ...randomBytes(12)]);
}

async function withLocalStorage(run: () => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "bgd26-direct-"));
  const previousDir = process.env.STORAGE_LOCAL_DIR;
  const previousProvider = process.env.STORAGE_PROVIDER;
  process.env.STORAGE_LOCAL_DIR = root;
  process.env.STORAGE_PROVIDER = "local";

  try {
    await run();
  } finally {
    if (previousDir === undefined) delete process.env.STORAGE_LOCAL_DIR;
    else process.env.STORAGE_LOCAL_DIR = previousDir;
    if (previousProvider === undefined) delete process.env.STORAGE_PROVIDER;
    else process.env.STORAGE_PROVIDER = previousProvider;
    await rm(root, { recursive: true, force: true });
  }
}

test("gallery keys are only the ones this app issues", () => {
  const key = mediaStorageKey("png", new Date("2026-11-23T00:00:00Z"));
  assert.equal(isGalleryStorageKey(key), true);
  assert.match(key, /^gallery\/2026\/11\/[0-9a-f-]{36}\.png$/);

  assert.equal(isGalleryStorageKey("gallery/2026/11/../../etc/passwd.png"), false);
  assert.equal(isGalleryStorageKey("production/2026/11/file.png"), false);
  assert.equal(isGalleryStorageKey("gallery/2026/11/not-a-uuid.png"), false);
  assert.equal(isGalleryStorageKey(`${key}.svg`), false);
});

test("prepare refuses unsupported types and oversized files before signing", async () => {
  await withLocalStorage(async () => {
    await assert.rejects(
      () => prepareGalleryUpload({ declaredMime: "image/svg+xml", byteSize: 100 }),
      (error: unknown) => error instanceof MediaValidationError,
    );
    await assert.rejects(
      () => prepareGalleryUpload({ declaredMime: "image/png", byteSize: 0 }),
      (error: unknown) => error instanceof MediaValidationError,
    );
    await assert.rejects(
      () => prepareGalleryUpload({ declaredMime: "image/png", byteSize: 1024, maxBytes: 512 }),
      (error: unknown) => error instanceof MediaValidationError,
    );

    // The filesystem adapter has no signed-URL equivalent and must say so.
    await assert.rejects(
      () => prepareGalleryUpload({ declaredMime: "image/png", byteSize: 1024 }),
      (error: unknown) => error instanceof StorageError && error.code === "PROVIDER_ERROR",
    );
  });
});

test("an uploaded object is adopted, hashed and linked exactly as stored", async () => {
  await withLocalStorage(async () => {
    const owner = await prisma.user.findFirst({ select: { id: true } });
    assert.ok(owner, "The local database must be seeded before running this test.");

    const createdIds: string[] = [];
    try {
      const bytes = pngWithRandomTail();
      const key = mediaStorageKey("png");
      await localStorageAdapter.put({ key, bytes, contentType: "image/png" });

      const stored = await completeGalleryUpload({
        key,
        filename: "original.png",
        declaredMime: "image/png",
        uploadedByUserId: owner.id,
        altText: "Direct upload",
      });
      createdIds.push(stored.assetId);

      assert.equal(stored.deduped, false);
      assert.equal(stored.sha256, sha256Hex(bytes));
      assert.equal(stored.byteSize, bytes.byteLength);
      assert.equal(stored.width, 1);
      assert.equal(stored.height, 1);
      assert.equal(stored.storageKey, key);

      const row = await prisma.mediaAsset.findUniqueOrThrow({
        where: { id: stored.assetId },
        select: { isZeroTransform: true, sha256Checksum: true, storageKey: true },
      });
      assert.equal(row.isZeroTransform, true);
      assert.equal(row.sha256Checksum, stored.sha256);
      assert.equal(row.storageKey, key);

      // The stored bytes are still byte-identical to what the browser wrote.
      const info = await localStorageAdapter.inspect(key);
      assert.equal(info.sha256, stored.sha256);
    } finally {
      if (createdIds.length > 0) {
        await prisma.mediaAsset.deleteMany({ where: { id: { in: createdIds } } });
      }
    }
  });
});

test("identical bytes are reused and the duplicate object is deleted", async () => {
  await withLocalStorage(async () => {
    const owner = await prisma.user.findFirst({ select: { id: true } });
    assert.ok(owner, "The local database must be seeded before running this test.");

    const createdIds: string[] = [];
    try {
      const bytes = pngWithRandomTail();
      const firstKey = mediaStorageKey("png");
      const secondKey = mediaStorageKey("png");
      await localStorageAdapter.put({ key: firstKey, bytes, contentType: "image/png" });
      await localStorageAdapter.put({ key: secondKey, bytes, contentType: "image/png" });

      const first = await completeGalleryUpload({
        key: firstKey,
        filename: "first.png",
        declaredMime: "image/png",
        uploadedByUserId: owner.id,
      });
      createdIds.push(first.assetId);

      const second = await completeGalleryUpload({
        key: secondKey,
        filename: "second.png",
        declaredMime: "image/png",
        uploadedByUserId: owner.id,
      });
      createdIds.push(second.assetId);

      assert.equal(second.deduped, true);
      assert.equal(second.assetId, first.assetId);
      assert.equal(second.storageKey, first.storageKey);

      await assert.rejects(
        () => localStorageAdapter.inspect(secondKey),
        (error: unknown) => error instanceof StorageError && error.code === "NOT_FOUND",
      );
    } finally {
      if (createdIds.length > 0) {
        await prisma.mediaAsset.deleteMany({ where: { id: { in: createdIds } } });
      }
    }
  });
});

test("invalid or oversized objects are removed and never recorded", async () => {
  await withLocalStorage(async () => {
    const owner = await prisma.user.findFirst({ select: { id: true } });
    assert.ok(owner, "The local database must be seeded before running this test.");

    // A file that claims to be a PNG but is not one.
    const fakeKey = mediaStorageKey("png");
    await localStorageAdapter.put({
      key: fakeKey,
      bytes: Uint8Array.from(Buffer.from("<script>alert(1)</script>")),
      contentType: "image/png",
    });

    const before = await prisma.mediaAsset.count({ where: { storageKey: fakeKey } });
    await assert.rejects(
      () =>
        completeGalleryUpload({
          key: fakeKey,
          filename: "attack.png",
          declaredMime: "image/png",
          uploadedByUserId: owner.id,
        }),
      (error: unknown) => error instanceof MediaValidationError,
    );
    assert.equal(await prisma.mediaAsset.count({ where: { storageKey: fakeKey } }), before);
    await assert.rejects(
      () => localStorageAdapter.inspect(fakeKey),
      (error: unknown) => error instanceof StorageError && error.code === "NOT_FOUND",
    );

    // Valid PNG, but bigger than the limit configured for this call.
    const bigKey = mediaStorageKey("png");
    const bytes = pngWithRandomTail();
    await localStorageAdapter.put({ key: bigKey, bytes, contentType: "image/png" });
    await assert.rejects(
      () =>
        completeGalleryUpload({
          key: bigKey,
          filename: "big.png",
          declaredMime: "image/png",
          uploadedByUserId: owner.id,
          maxBytes: 8,
        }),
      (error: unknown) => error instanceof MediaValidationError,
    );
    await assert.rejects(
      () => localStorageAdapter.inspect(bigKey),
      (error: unknown) => error instanceof StorageError && error.code === "NOT_FOUND",
    );

    // Keys outside gallery/ are refused before touching storage.
    await assert.rejects(
      () =>
        completeGalleryUpload({
          key: "production/2026/11/private.pdf",
          filename: "private.pdf",
          declaredMime: "application/pdf",
          uploadedByUserId: owner.id,
        }),
      (error: unknown) => error instanceof MediaValidationError,
    );
  });
});
