"use server";

import { revalidatePath } from "next/cache";
import { audit } from "@/lib/auth/audit";
import { requestMeta } from "@/lib/auth/request-meta";
import { requirePermission } from "@/lib/auth/session";
import {
  HomeContentError,
  normaliseBullets,
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
