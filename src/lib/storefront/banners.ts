import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  HomeContentError,
  isSitePath,
  storefrontImage,
  type HomeContent,
  type StorefrontImage,
} from "@/lib/storefront/home-content";

/**
 * The six-slide front-page carousel.
 *
 * Slide 1 is the hero copy stored in `storefront_home`; slides 2–6 live in
 * `storefront_banners`, one row per fixed slot. Fixed slots are what enforce the
 * "six banners" limit: there is no counter to drift and no way to add a seventh.
 *
 * A slot that is cleared keeps its row with `isActive = false`, so nothing is
 * hard-deleted. An inactive slot is simply skipped by the carousel.
 */
export const BANNER_SLOTS = [2, 3, 4, 5, 6] as const;
export const MAX_CAROUSEL_SLIDES = 6;
export const CAROUSEL_INTERVAL_MS = 10_000;

export type StorefrontBanner = {
  slot: number;
  title: string;
  subtitle: string;
  image: StorefrontImage | null;
  linkLabel: string;
  linkHref: string;
  isActive: boolean;
};

export type BannerInput = Omit<StorefrontBanner, "image"> & { imageAssetId: string | null };

const link = z
  .string()
  .trim()
  .max(200)
  .refine(
    (value) => value === "" || isSitePath(value),
    "Use a page on this shop, starting with / (for example /shop).",
  );

export const bannerSchema = z
  .object({
    slot: z
      .number()
      .int()
      .min(2, "Banner slots start at 2 — slide 1 is the hero copy.")
      .max(6, "The carousel holds six banners: the hero plus five slots."),
    title: z.string().trim().max(80),
    subtitle: z.string().trim().max(160),
    imageAssetId: z.string().trim().max(80).optional(),
    linkLabel: z.string().trim().max(40),
    linkHref: link,
    isActive: z.boolean(),
  })
  .superRefine((value, ctx) => {
    if (value.linkLabel && !value.linkHref) {
      ctx.addIssue({
        code: "custom",
        path: ["linkHref"],
        message: "Add a link for this button, or clear its label.",
      });
    }
    const hasContent = value.title.length > 0 || Boolean(value.imageAssetId);
    if (value.isActive && !hasContent) {
      ctx.addIssue({
        code: "custom",
        path: ["isActive"],
        message: "Add a title or an image, or turn this banner off.",
      });
    }
  });

export function parseBanner(input: unknown): BannerInput {
  const parsed = bannerSchema.safeParse(input);
  if (!parsed.success) {
    throw new HomeContentError(parsed.error.issues[0]?.message ?? "Check the banner fields.");
  }
  const imageAssetId = (parsed.data.imageAssetId ?? "").trim() || null;
  return {
    slot: parsed.data.slot,
    title: parsed.data.title,
    subtitle: parsed.data.subtitle,
    imageAssetId,
    linkLabel: parsed.data.linkLabel,
    linkHref: parsed.data.linkHref,
    isActive: parsed.data.isActive,
  };
}

const ASSET_SELECT = {
  id: true,
  storageKey: true,
  width: true,
  height: true,
  altText: true,
} as const;

type BannerRow = {
  slot: number;
  title: string;
  subtitle: string;
  linkLabel: string;
  linkHref: string;
  isActive: boolean;
  image: {
    id: string;
    storageKey: string;
    width: number | null;
    height: number | null;
    altText: string | null;
  } | null;
};

function toBanner(row: BannerRow): StorefrontBanner {
  return {
    slot: row.slot,
    title: row.title,
    subtitle: row.subtitle,
    image: storefrontImage(row.image),
    linkLabel: row.linkLabel,
    linkHref: row.linkHref,
    isActive: row.isActive,
  };
}

/** All five editable slots, with empty defaults for rows nobody saved yet. */
export async function getBannerSlots(): Promise<StorefrontBanner[]> {
  const rows = await prisma.storefrontBanner.findMany({
    where: { slot: { in: [...BANNER_SLOTS] } },
    select: {
      slot: true,
      title: true,
      subtitle: true,
      linkLabel: true,
      linkHref: true,
      isActive: true,
      image: { select: ASSET_SELECT },
    },
  });

  const bySlot = new Map(rows.map((row) => [row.slot, toBanner(row)]));

  return BANNER_SLOTS.map(
    (slot) =>
      bySlot.get(slot) ?? {
        slot,
        title: "",
        subtitle: "",
        image: null,
        linkLabel: "",
        linkHref: "",
        isActive: false,
      },
  );
}

/** The slides the carousel may rotate through: active and not empty. */
export async function getActiveBanners(): Promise<StorefrontBanner[]> {
  const rows = await prisma.storefrontBanner.findMany({
    where: { slot: { in: [...BANNER_SLOTS] }, isActive: true },
    orderBy: { slot: "asc" },
    select: {
      slot: true,
      title: true,
      subtitle: true,
      linkLabel: true,
      linkHref: true,
      isActive: true,
      image: { select: ASSET_SELECT },
    },
  });

  return rows
    .map(toBanner)
    .filter((banner) => banner.title.length > 0 || banner.image !== null);
}

export type CarouselSlide = {
  key: string;
  kicker: string | null;
  title: string;
  subtitle: string;
  image: StorefrontImage | null;
  linkLabel: string;
  linkHref: string;
};

/**
 * Join the hero copy and the saved banners into the ordered slide list.
 *
 * Links are re-checked here, not only on save: a hand-inserted row or an older
 * value must never become a `javascript:` href. The list is capped at six so a
 * future data mistake cannot grow the carousel beyond what the layout expects.
 */
export function buildCarouselSlides(
  content: HomeContent,
  banners: readonly StorefrontBanner[],
  heroImage: StorefrontImage | null,
): CarouselSlide[] {
  const heroLink =
    content.primaryHref && content.primaryLabel && isSitePath(content.primaryHref)
      ? content.primaryHref
      : "";

  const hero: CarouselSlide = {
    key: "hero",
    kicker: content.kicker || null,
    title: content.heading,
    subtitle: content.subheading,
    image: heroImage,
    linkLabel: heroLink ? content.primaryLabel : "",
    linkHref: heroLink,
  };

  const rest = banners
    .filter((banner) => banner.isActive)
    .filter((banner) => banner.title.length > 0 || banner.image !== null)
    .map((banner) => {
      const href = banner.linkHref && banner.linkLabel && isSitePath(banner.linkHref)
        ? banner.linkHref
        : "";
      return {
        key: `banner-${banner.slot}`,
        kicker: null,
        title: banner.title,
        subtitle: banner.subtitle,
        image: banner.image,
        linkLabel: href ? banner.linkLabel : "",
        linkHref: href,
      } satisfies CarouselSlide;
    });

  return [hero, ...rest].slice(0, MAX_CAROUSEL_SLIDES);
}

/** Upsert every supplied slot. Validation happens here too, not just in the form. */
export async function saveBanners(
  inputs: readonly unknown[],
  actorUserId: string,
): Promise<BannerInput[]> {
  const parsed = inputs.map(parseBanner);

  const seen = new Set<number>();
  for (const banner of parsed) {
    if (seen.has(banner.slot)) {
      throw new HomeContentError("Each banner slot can only be saved once.");
    }
    seen.add(banner.slot);
  }

  const imageIds = parsed.map((banner) => banner.imageAssetId).filter((id): id is string => !!id);
  if (imageIds.length > 0) {
    const found = await prisma.mediaAsset.findMany({
      where: { id: { in: imageIds }, mediaType: "GALLERY", visibility: "PUBLIC" },
      select: { id: true },
    });
    if (found.length !== new Set(imageIds).size) {
      throw new HomeContentError("One of the banner images is no longer available. Upload it again.");
    }
  }

  await prisma.$transaction(
    parsed.map((banner) => {
      const data = {
        title: banner.title,
        subtitle: banner.subtitle,
        imageAssetId: banner.imageAssetId,
        linkLabel: banner.linkLabel,
        linkHref: banner.linkHref,
        isActive: banner.isActive,
        updatedByUserId: actorUserId,
      };
      return prisma.storefrontBanner.upsert({
        where: { slot: banner.slot },
        update: data,
        create: { slot: banner.slot, ...data },
        select: { id: true },
      });
    }),
  );

  return parsed;
}
