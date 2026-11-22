"use server";

import { revalidatePath } from "next/cache";
import { audit } from "@/lib/auth/audit";
import { requestMeta } from "@/lib/auth/request-meta";
import { requirePermission } from "@/lib/auth/session";
import {
  setSubscriptionStatus,
  subscribeEmail,
} from "@/lib/crm/newsletter-service";
import { confirmPath, NewsletterError } from "@/lib/crm/newsletter";

/**
 * Newsletter actions (staff console).
 *
 * Adding an address only queues it; it becomes subscribed after the
 * confirmation link is opened. The console shows the link so the flow can be
 * tested before transactional email is connected.
 */
export type NewsletterFormState = {
  error?: string;
  success?: string;
  confirmUrl?: string;
};

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

export async function subscribeNewsletterAction(
  _previous: NewsletterFormState,
  formData: FormData,
): Promise<NewsletterFormState> {
  const session = await requirePermission("newsletter.write");
  const email = text(formData, "email");
  const customerId = text(formData, "customerId") || null;
  const source = text(formData, "source") || "admin";

  if (text(formData, "consent") !== "on") {
    return {
      error:
        "Record the customer's consent before adding them. The confirmation email is still required.",
    };
  }

  try {
    const result = await subscribeEmail({
      email,
      customerId,
      source,
      consentText:
        text(formData, "consentText") ||
        "Customer agreed to receive news and offers; double opt-in confirmation sent.",
      locale: text(formData, "locale") || "bn",
    });

    await audit({
      actorUserId: session.user.id,
      action:
        result.outcome === "already_subscribed"
          ? "crm.newsletter.already_subscribed"
          : "crm.newsletter.pending",
      entityType: "newsletter_subscriber",
      metadata: { email: result.email, source },
      ...(await requestMeta()),
    });

    revalidatePath("/newsletter");

    if (result.outcome === "already_subscribed") {
      return { success: `${result.email} is already subscribed.` };
    }

    return {
      success: `Confirmation queued for ${result.email}. Open the link to complete the double opt-in.`,
      confirmUrl: confirmPath(result.token),
    };
  } catch (error) {
    return {
      error:
        error instanceof NewsletterError
          ? error.message
          : error instanceof Error
            ? error.message
            : "Could not add the subscriber.",
    };
  }
}

export async function setNewsletterStatusAction(formData: FormData): Promise<void> {
  const session = await requirePermission("newsletter.write");
  const id = text(formData, "id");
  const status = text(formData, "status");
  if (!id) return;
  // SUBSCRIBED is reachable only through the confirmation link, never from the
  // console: that is what makes double opt-in real.
  if (status !== "UNSUBSCRIBED" && status !== "BOUNCED") return;

  const result = await setSubscriptionStatus(id, status);
  if (!result) return;

  await audit({
    actorUserId: session.user.id,
    action: `crm.newsletter.${status.toLowerCase()}`,
    entityType: "newsletter_subscriber",
    entityId: id,
    metadata: { email: result.email },
    ...(await requestMeta()),
  });

  revalidatePath("/newsletter");
}
