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
  /** Zero to four short chips beside the copy. */
  bullets: string[];
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
};

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

/** Parse untrusted input (a form) and throw the first readable problem. */
export function parseHomeContent(input: unknown): HomeContent {
  const parsed = homeContentSchema.safeParse(input);
  if (!parsed.success) {
    throw new HomeContentError(parsed.error.issues[0]?.message ?? "Check the front page fields.");
  }
  return parsed.data;
}

/**
 * The copy the storefront should render. Never throws for a missing row: a new
 * deployment has no row until the owner saves the form once.
 */
export async function getHomeContent(): Promise<HomeContent> {
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
    },
  });

  if (!row) return HOME_CONTENT_DEFAULTS;

  return {
    kicker: row.kicker,
    heading: row.heading,
    subheading: row.subheading,
    primaryLabel: row.primaryLabel,
    primaryHref: row.primaryHref,
    secondaryLabel: row.secondaryLabel,
    secondaryHref: row.secondaryHref,
    bullets: row.bullets,
  };
}

/** Upsert the single row. Validated here as well, not only in the action. */
export async function saveHomeContent(
  input: unknown,
  actorUserId: string,
): Promise<HomeContent> {
  const content = parseHomeContent(input);

  await prisma.storefrontHome.upsert({
    where: { id: "home" },
    update: { ...content, updatedByUserId: actorUserId },
    create: { id: "home", ...content, updatedByUserId: actorUserId },
    select: { id: true },
  });

  return content;
}
