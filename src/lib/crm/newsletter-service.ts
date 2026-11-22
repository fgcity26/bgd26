import { prisma } from "@/lib/db";
import { newConfirmToken, normalizeNewsletterEmail } from "./newsletter";

/**
 * Newsletter subscription lifecycle.
 *
 * `PENDING → SUBSCRIBED` only through a confirmation token (double opt-in).
 * `UNSUBSCRIBED` and `BOUNCED` are terminal for sending, but the row is kept so
 * the address stays suppressed instead of being re-added silently.
 */
export type SubscribeOutcome =
  | { outcome: "pending"; email: string; token: string }
  | { outcome: "already_subscribed"; email: string };

export async function subscribeEmail(input: {
  email: string;
  customerId?: string | null;
  source?: string | null;
  consentText?: string | null;
  locale?: string;
}): Promise<SubscribeOutcome> {
  const email = normalizeNewsletterEmail(input.email);

  const existing = await prisma.newsletterSubscriber.findUnique({
    where: { email },
    select: {
      id: true,
      status: true,
      confirmToken: true,
    },
  });

  if (existing?.status === "SUBSCRIBED") {
    return { outcome: "already_subscribed", email };
  }

  if (existing?.status === "PENDING" && existing.confirmToken) {
    // Re-send the same link; a second token would invalidate the first.
    return { outcome: "pending", email, token: existing.confirmToken };
  }

  const token = newConfirmToken();
  const data = {
    status: "PENDING" as const,
    confirmToken: token,
    confirmedAt: null,
    unsubscribedAt: null,
    customerId: input.customerId ?? null,
    source: input.source?.trim() || "admin",
    consentText: input.consentText?.trim() || null,
    locale: input.locale === "en" ? "en" : "bn",
  };

  if (existing) {
    await prisma.newsletterSubscriber.update({ where: { id: existing.id }, data });
  } else {
    await prisma.newsletterSubscriber.create({ data: { email, ...data } });
  }

  return { outcome: "pending", email, token };
}

export type ConfirmOutcome = "confirmed" | "already_confirmed" | "not_found";

export async function confirmSubscription(token: string): Promise<{
  outcome: ConfirmOutcome;
  email?: string;
}> {
  const trimmed = token.trim();
  if (!trimmed) return { outcome: "not_found" };

  const subscriber = await prisma.newsletterSubscriber.findUnique({
    where: { confirmToken: trimmed },
    select: { id: true, email: true, status: true },
  });
  if (!subscriber) return { outcome: "not_found" };
  if (subscriber.status === "SUBSCRIBED") {
    return { outcome: "already_confirmed", email: subscriber.email };
  }

  await prisma.newsletterSubscriber.update({
    where: { id: subscriber.id },
    data: {
      status: "SUBSCRIBED",
      confirmedAt: new Date(),
      unsubscribedAt: null,
    },
  });

  return { outcome: "confirmed", email: subscriber.email };
}

export async function setSubscriptionStatus(
  id: string,
  status: "UNSUBSCRIBED" | "BOUNCED",
): Promise<{ email: string } | null> {
  const subscriber = await prisma.newsletterSubscriber.findUnique({
    where: { id },
    select: { id: true, email: true },
  });
  if (!subscriber) return null;

  await prisma.newsletterSubscriber.update({
    where: { id },
    data: {
      status,
      ...(status === "UNSUBSCRIBED" ? { unsubscribedAt: new Date() } : {}),
    },
  });

  return { email: subscriber.email };
}
