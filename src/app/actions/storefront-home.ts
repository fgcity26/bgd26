"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { audit } from "@/lib/auth/audit";
import { requestMeta } from "@/lib/auth/request-meta";
import { requirePermission } from "@/lib/auth/session";
import {
  completeGalleryUpload,
  prepareGalleryUpload,
  storeImage,
} from "@/lib/media/service";
import { MediaValidationError } from "@/lib/media/validate";
import { StorageError } from "@/lib/adapters/storage";
import { BANNER_SLOTS, saveBanners } from "@/lib/storefront/banners";
import {
  HomeContentError,
  normaliseBullets,
  saveBranding,
  saveHomeContent,
} from "@/lib/storefront/home-content";

/**
 * Front-page editing.
 *
 * Reading needs `content.read`, saving needs `content.write` — the same pair the
 * CMS uses, because it is the same job. The public page is revalidated only
 * after the row is stored, so a failed save never publishes half an edit.
 */
export type HomeContentState = {
  error?: string;
  success?: string;
};

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

export async function saveHomeContentAction(
  _previous: HomeContentState,
  formData: FormData,
): Promise<HomeContentState> {
  const session = await requirePermission("content.write");

  let saved;
  try {
    saved = await saveHomeContent(
      {
        kicker: text(formData, "kicker"),
        heading: text(formData, "heading"),
        subheading: text(formData, "subheading"),
        primaryLabel: text(formData, "primaryLabel"),
        primaryHref: text(formData, "primaryHref"),
        secondaryLabel: text(formData, "secondaryLabel"),
        secondaryHref: text(formData, "secondaryHref"),
        bullets: normaliseBullets(formData.getAll("bullets").map((value) => String(value))),
        logoAssetId: text(formData, "logoAssetId"),
        logoText: text(formData, "logoText"),
        heroImageAssetId: text(formData, "heroImageAssetId"),
      },
      session.user.id,
    );
  } catch (error) {
    if (error instanceof HomeContentError) return { error: error.message };
    console.error("[storefront] front page save failed", error);
    return { error: "Could not save the front page. Please try again." };
  }

  await audit({
    actorUserId: session.user.id,
    action: "storefront.home.updated",
    entityType: "storefront_home",
    entityId: "home",
    metadata: { heading: saved.heading, bullets: saved.bullets.length },
    ...(await requestMeta()),
  });

  revalidatePath("/");
  return { success: "Front page updated. The shop shows the new copy within seconds." };
}

export async function saveBrandingAction(
  _previous: HomeContentState,
  formData: FormData,
): Promise<HomeContentState> {
  const session = await requirePermission("content.write");

  let saved;
  try {
    saved = await saveBranding(
      {
        logoAssetId: text(formData, "logoAssetId"),
        logoText: text(formData, "logoText"),
      },
      session.user.id,
    );
  } catch (error) {
    if (error instanceof HomeContentError) return { error: error.message };
    console.error("[storefront] branding save failed", error);
    return { error: "Could not save the logo. Please try again." };
  }

  await audit({
    actorUserId: session.user.id,
    action: "storefront.branding.updated",
    entityType: "storefront_home",
    entityId: "home",
    metadata: { logo: saved.logoAssetId !== null, logoText: saved.logoText },
    ...(await requestMeta()),
  });

  revalidateTag("storefront-branding", { expire: 0 });
  revalidatePath("/", "layout");
  return { success: "Logo updated. The shop header shows it everywhere." };
}

export async function saveBannersAction(
  _previous: HomeContentState,
  formData: FormData,
): Promise<HomeContentState> {
  const session = await requirePermission("content.write");

  let saved;
  try {
    saved = await saveBanners(
      BANNER_SLOTS.map((slot) => ({
        slot,
        title: text(formData, `banner-${slot}-title`),
        subtitle: text(formData, `banner-${slot}-subtitle`),
        imageAssetId: text(formData, `banner-${slot}-image`),
        linkLabel: text(formData, `banner-${slot}-linkLabel`),
        linkHref: text(formData, `banner-${slot}-linkHref`),
        isActive: formData.get(`banner-${slot}-active`) === "on",
      })),
      session.user.id,
    );
  } catch (error) {
    if (error instanceof HomeContentError) return { error: error.message };
    console.error("[storefront] banner save failed", error);
    return { error: "Could not save the banners. Please try again." };
  }

  await audit({
    actorUserId: session.user.id,
    action: "storefront.banners.updated",
    entityType: "storefront_banners",
    metadata: { active: saved.filter((banner) => banner.isActive).length },
    ...(await requestMeta()),
  });

  revalidatePath("/");
  return { success: "Banners updated. Up to six slides now rotate every 10 seconds." };
}

// -----------------------------------------------------------------------------
// Image uploads for the logo, the hero slide and banners 2–6.
//
// Production uploads straight to object storage with a signed URL, because a
// serverless action body caps at ~4.5 MB. Local development has no signed URLs,
// so the same field falls back to a normal server action.
// -----------------------------------------------------------------------------

export type UploadedStorefrontImage = {
  assetId: string;
  url: string;
  width: number | null;
  height: number | null;
  alt: string;
};

function uploadedImage(
  stored: { assetId: string; storageKey: string; width: number | null; height: number | null },
  alt: string,
): UploadedStorefrontImage {
  return {
    assetId: stored.assetId,
    url: `/media/${stored.storageKey}`,
    width: stored.width,
    height: stored.height,
    alt,
  };
}

export async function prepareStorefrontUploadAction(input: {
  declaredMime: string;
  byteSize: number;
}): Promise<{ key: string; uploadUrl: string } | { error: string }> {
  await requirePermission("content.write");

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
    console.error("[storefront] prepare upload failed", error);
    return { error: "Could not start the upload." };
  }
}

export async function completeStorefrontUploadAction(input: {
  key: string;
  filename: string;
  declaredMime: string;
  alt?: string;
}): Promise<UploadedStorefrontImage | { error: string }> {
  const session = await requirePermission("content.write");
  const alt = (input.alt ?? "").trim();

  try {
    const stored = await completeGalleryUpload({
      key: input.key,
      filename: input.filename,
      declaredMime: input.declaredMime,
      uploadedByUserId: session.user.id,
      altText: alt || null,
    });
    return uploadedImage(stored, alt);
  } catch (error) {
    if (error instanceof MediaValidationError || error instanceof StorageError) {
      return { error: error.message };
    }
    console.error("[storefront] complete upload failed", error);
    return { error: "The image could not be saved. Try again." };
  }
}

export async function uploadStorefrontImageAction(
  formData: FormData,
): Promise<UploadedStorefrontImage | { error: string }> {
  const session = await requirePermission("content.write");

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose an image." };
  }

  const alt = text(formData, "alt").trim();

  try {
    const stored = await storeImage({
      bytes: new Uint8Array(await file.arrayBuffer()),
      declaredMime: file.type,
      filename: file.name,
      uploadedByUserId: session.user.id,
      altText: alt || null,
    });
    return uploadedImage(stored, alt);
  } catch (error) {
    if (error instanceof MediaValidationError || error instanceof StorageError) {
      return { error: error.message };
    }
    console.error("[storefront] upload failed", error);
    return { error: "The image could not be saved. Try again." };
  }
}
