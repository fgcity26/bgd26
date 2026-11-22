import { randomBytes } from "node:crypto";

/**
 * Newsletter rules.
 *
 * Double opt-in: a new address starts PENDING and only becomes SUBSCRIBED after
 * the confirmation link is opened. The database enforces lowercase emails, so
 * normalisation happens here, once, before any write.
 */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class NewsletterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NewsletterError";
  }
}

export function normalizeNewsletterEmail(input: string): string {
  const email = input.trim().toLowerCase();
  if (email.length > 254 || !EMAIL.test(email)) {
    throw new NewsletterError("Enter a valid email address.");
  }
  return email;
}

/** Random, unguessable confirmation token (48 hex characters). */
export function newConfirmToken(): string {
  return randomBytes(24).toString("hex");
}

export function confirmPath(token: string): string {
  return `/newsletter/confirm?token=${encodeURIComponent(token)}`;
}
