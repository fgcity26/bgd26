/**
 * End-to-end catalogue + zero-transform media verification.
 *
 *   npm run build
 *   STORAGE_PROVIDER=local npm start     # in another terminal
 *   npm run verify:catalog
 *
 * Point it elsewhere with BASE_URL=http://localhost:3100 npm run verify:catalog
 *
 * Proves over real HTTP: catalogue permissions, cost-price hiding for a cashier,
 * the 403 page, immutable media headers, byte-for-byte checksum equality and
 * conditional requests. Creates and removes one temporary product.
 */
import { config } from "dotenv";
config({ path: [".env.local", ".env"], quiet: true });

import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "../src/lib/db";
import { getStorageAdapter } from "../src/lib/adapters/storage";
import { SESSION_VERSION, signSessionToken } from "../src/lib/auth/token";
import { storeGalleryImage } from "../src/lib/media/service";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const COOKIE = process.env.SESSION_COOKIE_NAME?.trim() || "bgd26_session";
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

let failures = 0;
let checks = 0;

async function check(label: string, run: () => Promise<void>): Promise<void> {
  checks += 1;
  try {
    await run();
    console.log(`ok   ${label}`);
  } catch (error) {
    failures += 1;
    console.log(`FAIL ${label}\n     ${(error as Error).message}`);
  }
}

function sessionCookie(user: { id: string; email: string }): string {
  const now = Math.floor(Date.now() / 1000);
  const token = signSessionToken({
    v: SESSION_VERSION,
    userId: user.id,
    email: user.email,
    provider: "local",
    issuedAt: now,
    expiresAt: now + 3600,
  });
  return `${COOKIE}=${token}`;
}

async function get(path: string, cookie?: string) {
  const response = await fetch(`${BASE}${path}`, {
    redirect: "manual",
    headers: cookie ? { cookie } : undefined,
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  return {
    status: response.status,
    location: response.headers.get("location") ?? "",
    headers: response.headers,
    body: bytes,
    text: bytes.toString("utf8"),
  };
}

const run = randomBytes(4).toString("hex");
const ownerRole = await prisma.role.findUniqueOrThrow({ where: { code: "OWNER" }, select: { id: true } });
const cashierRole = await prisma.role.findUniqueOrThrow({ where: { code: "CASHIER" }, select: { id: true } });
const category = await prisma.category.findFirstOrThrow({ orderBy: { sortOrder: "asc" }, select: { id: true } });

const [owner, cashier] = await Promise.all([
  prisma.user.create({
    data: {
      email: `verify-catalog-owner-${run}@example.test`,
      fullName: "Verify Catalogue Owner",
      status: "ACTIVE",
      mustChangePassword: false,
      userRoles: { create: [{ roleId: ownerRole.id }] },
    },
    select: { id: true, email: true },
  }),
  prisma.user.create({
    data: {
      email: `verify-catalog-cashier-${run}@example.test`,
      fullName: "Verify Catalogue Cashier",
      status: "ACTIVE",
      mustChangePassword: false,
      userRoles: { create: [{ roleId: cashierRole.id }] },
    },
    select: { id: true, email: true },
  }),
]);

const product = await prisma.product.create({
  data: {
    categoryId: category.id,
    sku: `VERIFY-${run.toUpperCase()}`,
    name: `Verify Catalogue ${run}`,
    slug: `verify-catalogue-${run}`,
    status: "ACTIVE",
    isPublished: true,
    basePrice: "1150.00",
    compareAtPrice: "1350.00",
    costPrice: "600.0000",
    variants: {
      create: {
        sku: `VERIFY-${run.toUpperCase()}`,
        name: "Default",
        price: "1150.00",
        costPrice: "600.0000",
        isDefault: true,
        status: "ACTIVE",
      },
    },
  },
  select: { id: true, name: true },
});

// Unique trailing bytes keep this run isolated from real gallery uploads that
// may share the same checksum (the service deduplicates identical images).
const uniquePng = new Uint8Array(Buffer.concat([PNG, randomBytes(12)]));

const stored = await storeGalleryImage({
  bytes: uniquePng,
  declaredMime: "image/png",
  filename: "verify-original.png",
  uploadedByUserId: owner.id,
  altText: "Verification image",
});

const link = await prisma.productMedia.create({
  data: {
    productId: product.id,
    mediaAssetId: stored.assetId,
    role: "GALLERY",
    isPrimary: true,
    sortOrder: 0,
  },
  select: { id: true },
});

const ownerCookie = sessionCookie(owner);
const cashierCookie = sessionCookie(cashier);

try {
  await check("anonymous visitors are redirected from the catalogue", async () => {
    const response = await get("/products");
    assert.ok([302, 303, 307, 308].includes(response.status), `status ${response.status}`);
    assert.match(response.location, /\/login/);
  });

  await check("owner sees the product list and the new-product page", async () => {
    const list = await get("/products", ownerCookie);
    assert.equal(list.status, 200);
    assert.match(list.text, new RegExp(product.name));

    const create = await get("/products/new", ownerCookie);
    assert.equal(create.status, 200);
    assert.match(create.text, /New product/);
  });

  await check("owner sees cost prices on the product page", async () => {
    const response = await get(`/products/${product.id}`, ownerCookie);
    assert.equal(response.status, 200);
    assert.match(response.text, /Cost price/);
    assert.match(response.text, /৳600/);
  });

  await check("cashier can read the product but never sees cost prices", async () => {
    const response = await get(`/products/${product.id}`, cashierCookie);
    assert.equal(response.status, 200);
    assert.match(response.text, new RegExp(product.name));
    assert.doesNotMatch(response.text, /Cost price/);
    assert.doesNotMatch(response.text, /Visible to accounts\/reports/);
    assert.doesNotMatch(response.text, /৳600/);
    assert.doesNotMatch(response.text, /New product/);
  });

  await check("cashier is redirected to the 403 page from a write-only screen", async () => {
    const response = await get("/products/new", cashierCookie);
    assert.ok([302, 303, 307, 308].includes(response.status), `status ${response.status}`);
    assert.match(response.location, /\/forbidden/);
  });

  await check("media route serves original bytes with immutable caching", async () => {
    const response = await get(`/media/${stored.storageKey}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/png");
    assert.match(response.headers.get("cache-control") ?? "", /max-age=31536000/);
    assert.match(response.headers.get("cache-control") ?? "", /immutable/);
    assert.equal(
      createHash("sha256").update(response.body).digest("hex"),
      stored.sha256,
      "served bytes differ from the uploaded checksum",
    );
  });

  await check("media route answers conditional requests with 304", async () => {
    const first = await get(`/media/${stored.storageKey}`);
    const etag = first.headers.get("etag");
    assert.ok(etag, "missing ETag");

    const response = await fetch(`${BASE}/media/${stored.storageKey}`, {
      headers: { "if-none-match": etag },
    });
    assert.equal(response.status, 304);
  });

  await check("unknown media keys return 404", async () => {
    const response = await get("/media/gallery/2026/11/does-not-exist.png");
    assert.equal(response.status, 404);
  });
} finally {
  await prisma.productMedia.deleteMany({ where: { productId: product.id } }).catch(() => undefined);
  await prisma.productVariant.deleteMany({ where: { productId: product.id } }).catch(() => undefined);
  await prisma.product.delete({ where: { id: product.id } }).catch(() => undefined);
  const assetRemoved = await prisma.mediaAsset
    .delete({ where: { id: stored.assetId } })
    .then(() => true)
    .catch(() => false);
  // Only remove the object when its database row is gone. A shared asset must
  // never lose its bytes because one verification run cleaned up.
  if (assetRemoved) await getStorageAdapter().remove(stored.storageKey).catch(() => undefined);
  await prisma.user
    .updateMany({
      where: { id: { in: [owner.id, cashier.id] } },
      data: { status: "SUSPENDED", deletedAt: new Date() },
    })
    .catch(() => undefined);
  await prisma.$disconnect();
}

console.log(`\n${checks - failures}/${checks} catalogue checks passed.`);
if (link.id) console.log("Temporary product and media were removed.");
process.exitCode = failures === 0 ? 0 : 1;
