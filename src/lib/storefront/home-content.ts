import { unstable_cache } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";

/**
 * The front page, as a shop owner sees it.
 *
 * Only the copy is editable. Categories, featured products and new arrivals come
 * from the catalogue, so a half-finished edit can never hide the shop or leave a
 * product advertised after it was archived.
 *
 * A missing row means "nobody has edited it yet": the storefront renders
 * `HOME_CONTENT_DEFAULTS`, which is the copy this project shipped with. That
 * keeps a fresh deployment complete and makes the editor safe to open on day one.
 */
export type HomeContent = {
  /** Small line above the heading — the Bangla delivery note by default. */
  kicker: string;
  heading: string;
  subheading: string;
  /** Empty label hides the button; the href is then ignored. */
  primaryLabel: string;
  primaryHref: string;
  secondaryLabel: string;
  secondaryHref: string;
  /** Zero to four short chips under the carousel. */
  bullets: string[];
  /** Uploaded brand mark; `null` falls back to the letter badge. */
  logoAssetId: string | null;
  /** Wordmark beside the mark. Empty hides it. */
  logoText: string;
  /** Optional photo behind the first carousel slide. */
  heroImageAssetId: string | null;
};

/** A public image as the storefront needs it — id to save, URL to render. */
export type StorefrontImage = {
  assetId: string;
  url: string;
  width: number | null;
  height: number | null;
  alt: string;
};

/** What the editor and the shop render: the copy plus resolved images. */
export type HomeEditorContent = HomeContent & {
  logo: StorefrontImage | null;
  heroImage: StorefrontImage | null;
};

export const HOME_CONTENT_DEFAULTS: HomeContent = {
  kicker: "বাংলাদেশে ডেলিভারি",
  heading: "Everyday things, delivered to your door.",
  subheading:
    "Order online and pay cash when the parcel arrives. bKash and Nagad are also accepted — every transaction is checked before dispatch.",
  primaryLabel: "Start shopping",
  primaryHref: "/shop",
  secondaryLabel: "Track an order",
  secondaryHref: "/track",
  bullets: [
    "Cash on delivery",
    "bKash · Nagad",
    "Dhaka and all divisions",
    "Order updates by mobile",
  ],
  logoAssetId: null,
  logoText: "bgd26",
  heroImageAssetId: null,
};

export const DEFAULT_LOGO_TEXT = "bgd26";

const MAX_BULLETS = 4;

/**
 * Buttons may only point inside this shop.
 *
 * The value is rendered into `href`, so `javascript:` or an off-site URL would
 * turn a typo into an open redirect or a script injection. Same-origin paths
 * (starting with a single `/`) are the whole use case.
 */
export function isSitePath(value: string): boolean {
  if (!value.startsWith("/")) return false;
  if (value.startsWith("//") || value.includes("\\")) return false;
  // Control characters and whitespace have no business in a path.
  return !/[\u0000-\u001f\u007f\s]/.test(value);
}

const label = (max: number, required: boolean) =>
  required
    ? z.string().trim().min(1, "This line cannot be empty.").max(max)
    : z.string().trim().max(max);

const link = (required: boolean) =>
  z
    .string()
    .trim()
    .max(200)
    .refine(
      (value) => (required ? isSitePath(value) : value === "" || isSitePath(value)),
      "Use a page on this shop, starting with / (for example /shop).",
    );

/** An uploaded asset id, or empty for "none". */
const assetId = z.string().trim().max(80).nullish();

export const homeContentSchema = z
  .object({
    kicker: label(60, false),
    heading: label(120, true),
    subheading: label(400, false),
    primaryLabel: label(40, false),
    primaryHref: link(false),
    secondaryLabel: label(40, false),
    secondaryHref: link(false),
    bullets: z.array(z.string().trim().max(60)).max(MAX_BULLETS, `Use at most ${MAX_BULLETS} points.`),
    logoAssetId: assetId,
    logoText: z.string().trim().max(40).optional(),
    heroImageAssetId: assetId,
  })
  .superRefine((value, ctx) => {
    if (value.primaryLabel && !value.primaryHref) {
      ctx.addIssue({
        code: "custom",
        path: ["primaryHref"],
        message: "Add a link for the first button, or clear its label to hide it.",
      });
    }
    if (value.secondaryLabel && !value.secondaryHref) {
      ctx.addIssue({
        code: "custom",
        path: ["secondaryHref"],
        message: "Add a link for the second button, or clear its label to hide it.",
      });
    }
  });

export const brandingSchema = z.object({
  logoAssetId: assetId,
  logoText: z.string().trim().max(40).optional(),
});

/** Drop blank chips so an empty input row is not stored as an empty chip. */
export function normaliseBullets(values: readonly string[]): string[] {
  return values
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .slice(0, MAX_BULLETS);
}

export class HomeContentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HomeContentError";
  }
}

function optionalId(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Parse untrusted input (a form) and throw the first readable problem. */
export function parseHomeContent(input: unknown): HomeContent {
  const parsed = homeContentSchema.safeParse(input);
  if (!parsed.success) {
    throw new HomeContentError(parsed.error.issues[0]?.message ?? "Check the front page fields.");
  }
  return {
    kicker: parsed.data.kicker,
    heading: parsed.data.heading,
    subheading: parsed.data.subheading,
    primaryLabel: parsed.data.primaryLabel,
    primaryHref: parsed.data.primaryHref,
    secondaryLabel: parsed.data.secondaryLabel,
    secondaryHref: parsed.data.secondaryHref,
    bullets: parsed.data.bullets,
    logoAssetId: optionalId(parsed.data.logoAssetId),
    logoText: parsed.data.logoText ?? DEFAULT_LOGO_TEXT,
    heroImageAssetId: optionalId(parsed.data.heroImageAssetId),
  };
}

type AssetRow = {
  id: string;
  storageKey: string;
  width: number | null;
  height: number | null;
  altText: string | null;
};

/** Map a stored asset to the URL/alt pair the storefront renders. */
export function storefrontImage(asset: AssetRow | null | undefined): StorefrontImage | null {
  if (!asset) return null;
  return {
    assetId: asset.id,
    url: `/media/${asset.storageKey}`,
    width: asset.width,
    height: asset.height,
    alt: asset.altText ?? "",
  };
}

const ASSET_SELECT = {
  id: true,
  storageKey: true,
  width: true,
  height: true,
  altText: true,
} as const;

/**
 * Only public gallery images may sit on the storefront.
 *
 * An id is not trusted just because the form sent it: a private proof or a
 * customer's customisation file must never be promoted to the home page.
 */
async function assertStorefrontImage(id: string | null): Promise<void> {
  if (!id) return;
  const asset = await prisma.mediaAsset.findFirst({
    where: { id, mediaType: "GALLERY", visibility: "PUBLIC" },
    select: { id: true },
  });
  if (!asset) {
    throw new HomeContentError("That image is no longer available. Upload it again.");
  }
}

/**
 * The copy the storefront should render. Never throws for a missing row: a new
 * deployment has no row until the owner saves the form once.
 */
export async function getHomeContent(): Promise<HomeEditorContent> {
  const row = await prisma.storefrontHome.findUnique({
    where: { id: "home" },
    select: {
      kicker: true,
      heading: true,
      subheading: true,
      primaryLabel: true,
      primaryHref: true,
      secondaryLabel: true,
      secondaryHref: true,
      bullets: true,
      logoAssetId: true,
      logoText: true,
      heroImageAssetId: true,
      logoAsset: { select: ASSET_SELECT },
      heroImage: { select: ASSET_SELECT },
    },
  });

  if (!row) {
    return { ...HOME_CONTENT_DEFAULTS, logo: null, heroImage: null };
  }

  return {
    kicker: row.kicker,
    heading: row.heading,
    subheading: row.subheading,
    primaryLabel: row.primaryLabel,
    primaryHref: row.primaryHref,
    secondaryLabel: row.secondaryLabel,
    secondaryHref: row.secondaryHref,
    bullets: row.bullets,
    logoAssetId: row.logoAssetId,
    logoText: row.logoText,
    heroImageAssetId: row.heroImageAssetId,
    logo: storefrontImage(row.logoAsset),
    heroImage: storefrontImage(row.heroImage),
  };
}

/** The header only needs the mark and the wordmark. */
export async function getStorefrontBranding(): Promise<{
  logoText: string;
  logo: StorefrontImage | null;
}> {
  const row = await prisma.storefrontHome.findUnique({
    where: { id: "home" },
    select: {
      logoText: true,
      logoAsset: { select: ASSET_SELECT },
    },
  });

  return {
    logoText: row?.logoText ?? DEFAULT_LOGO_TEXT,
    logo: storefrontImage(row?.logoAsset),
  };
}

/**
 * The header renders on every storefront page, so its one row is cached across
 * requests. Saving the brand revalidates the tag, which keeps the logo instant
 * without a database round-trip on every catalogue view.
 */
export const getCachedStorefrontBranding = unstable_cache(
  getStorefrontBranding,
  ["storefront-branding"],
  { tags: ["storefront-branding"], revalidate: 120 },
);

/** Upsert the single row. Validated here as well, not only in the action. */
export async function saveHomeContent(
  input: unknown,
  actorUserId: string,
): Promise<HomeContent> {
  const content = parseHomeContent(input);
  await assertStorefrontImage(content.heroImageAssetId);

  await prisma.storefrontHome.upsert({
    where: { id: "home" },
    update: { ...content, updatedByUserId: actorUserId },
    create: { id: "home", ...content, updatedByUserId: actorUserId },
    select: { id: true },
  });

  return content;
}

/** Save only the brand mark and wordmark, leaving the banner copy untouched. */
export async function saveBranding(
  input: unknown,
  actorUserId: string,
): Promise<{ logoAssetId: string | null; logoText: string }> {
  const parsed = brandingSchema.safeParse(input);
  if (!parsed.success) {
    throw new HomeContentError(parsed.error.issues[0]?.message ?? "Check the logo fields.");
  }

  const logoAssetId = optionalId(parsed.data.logoAssetId);
  await assertStorefrontImage(logoAssetId);

  const logoText = parsed.data.logoText ?? DEFAULT_LOGO_TEXT;
  const data = { logoAssetId, logoText, updatedByUserId: actorUserId };

  await prisma.storefrontHome.upsert({
    where: { id: "home" },
    update: data,
    create: { id: "home", ...HOME_CONTENT_DEFAULTS, ...data },
    select: { id: true },
  });

  return { logoAssetId, logoText };
}
