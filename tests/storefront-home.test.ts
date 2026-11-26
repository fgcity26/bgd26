import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/lib/db";
import {
  HOME_CONTENT_DEFAULTS,
  HomeContentError,
  getHomeContent,
  getStorefrontBranding,
  isSitePath,
  normaliseBullets,
  parseHomeContent,
  saveBranding,
  saveHomeContent,
} from "../src/lib/storefront/home-content";
import {
  BANNER_SLOTS,
  buildCarouselSlides,
  getBannerSlots,
  parseBanner,
  saveBanners,
  type StorefrontBanner,
} from "../src/lib/storefront/banners";

/**
 * The front page is owner-edited copy, so the rules that keep it safe and
 * readable are worth testing directly: only same-site links, at most four chips,
 * a required heading, and a database round-trip that always restores what it
 * found.
 */

test("the shipped defaults are valid and render the current shop copy", () => {
  const parsed = parseHomeContent(HOME_CONTENT_DEFAULTS);
  assert.equal(parsed.heading, HOME_CONTENT_DEFAULTS.heading);
  assert.ok(parsed.bullets.length <= 4);
});

test("buttons may only point inside this shop", () => {
  assert.equal(isSitePath("/shop"), true);
  assert.equal(isSitePath("/shop?sort=newest"), true);
  assert.equal(isSitePath("/p/[slug]"), true);

  assert.equal(isSitePath(""), false);
  assert.equal(isSitePath("shop"), false);
  assert.equal(isSitePath("//evil.example/steal"), false);
  assert.equal(isSitePath("https://evil.example"), false);
  assert.equal(isSitePath("javascript:alert(1)"), false);
  assert.equal(isSitePath("/shop\\..\\admin"), false);
  assert.equal(isSitePath("/shop with space"), false);
});

test("a heading is required and unknown fields are dropped", () => {
  assert.throws(
    () => parseHomeContent({ ...HOME_CONTENT_DEFAULTS, heading: "   " }),
    HomeContentError,
  );

  const parsed = parseHomeContent({
    ...HOME_CONTENT_DEFAULTS,
    heading: "  Gifts that last  ",
    isFeatured: true,
    role: "ADMIN",
  });
  assert.equal(parsed.heading, "Gifts that last");
  assert.equal("isFeatured" in parsed, false);
  assert.equal("role" in parsed, false);
});

test("a visible button needs a link; hiding it needs only an empty label", () => {
  assert.throws(
    () => parseHomeContent({ ...HOME_CONTENT_DEFAULTS, primaryLabel: "Buy now", primaryHref: "" }),
    /Add a link for the first button/,
  );
  assert.throws(
    () =>
      parseHomeContent({ ...HOME_CONTENT_DEFAULTS, secondaryHref: "https://evil.example" }),
    /page on this shop/,
  );

  // Clearing the label hides the button, so an empty href is fine.
  const hidden = parseHomeContent({
    ...HOME_CONTENT_DEFAULTS,
    primaryLabel: "",
    primaryHref: "",
    secondaryLabel: "",
    secondaryHref: "",
  });
  assert.equal(hidden.primaryLabel, "");
  assert.equal(hidden.secondaryHref, "");
});

test("chips are trimmed, blanks dropped and the list is capped at four", () => {
  const bullets = normaliseBullets(["  Cash on delivery  ", "", "   ", "bKash", "Dhaka", "Updates", "Extra"]);
  assert.deepEqual(bullets, ["Cash on delivery", "bKash", "Dhaka", "Updates"]);

  assert.throws(
    () => parseHomeContent({ ...HOME_CONTENT_DEFAULTS, bullets: ["1", "2", "3", "4", "5"] }),
    /at most 4/,
  );
});

test("front page copy round-trips through the database", async () => {
  const user = await prisma.user.findFirst({ where: { deletedAt: null }, select: { id: true } });
  if (!user) {
    console.log("     skipped: no staff user in the test database");
    return;
  }

  const before = await prisma.storefrontHome.findUnique({ where: { id: "home" } });
  try {
    await saveHomeContent(
      {
        ...HOME_CONTENT_DEFAULTS,
        heading: "Round-trip heading",
        kicker: "",
        bullets: ["One", "Two"],
      },
      user.id,
    );

    const saved = await getHomeContent();
    assert.equal(saved.heading, "Round-trip heading");
    assert.equal(saved.kicker, "");
    assert.deepEqual(saved.bullets, ["One", "Two"]);
  } finally {
    // Leave the database exactly as it was found.
    if (before) {
      await saveHomeContent(
        {
          kicker: before.kicker,
          heading: before.heading,
          subheading: before.subheading,
          primaryLabel: before.primaryLabel,
          primaryHref: before.primaryHref,
          secondaryLabel: before.secondaryLabel,
          secondaryHref: before.secondaryHref,
          bullets: before.bullets,
          logoAssetId: before.logoAssetId,
          logoText: before.logoText,
          heroImageAssetId: before.heroImageAssetId,
        },
        user.id,
      );
    } else {
      await prisma.storefrontHome.deleteMany({ where: { id: "home" } });
    }
  }
});

test("empty image ids are stored as none, not as empty strings", () => {
  const parsed = parseHomeContent({
    ...HOME_CONTENT_DEFAULTS,
    logoAssetId: "   ",
    heroImageAssetId: "",
    logoText: "  ",
  });
  assert.equal(parsed.logoAssetId, null);
  assert.equal(parsed.heroImageAssetId, null);
  assert.equal(parsed.logoText, "");
});

test("an image id must point at a public gallery asset", async () => {
  const user = await prisma.user.findFirst({ where: { deletedAt: null }, select: { id: true } });
  if (!user) {
    console.log("     skipped: no staff user in the test database");
    return;
  }

  await assert.rejects(
    () =>
      saveHomeContent(
        { ...HOME_CONTENT_DEFAULTS, heroImageAssetId: "cmnotarealasset" },
        user.id,
      ),
    (error: unknown) =>
      error instanceof HomeContentError && /no longer available/.test(error.message),
  );
});

test("the logo can be saved without touching the banner copy", async () => {
  const user = await prisma.user.findFirst({ where: { deletedAt: null }, select: { id: true } });
  if (!user) {
    console.log("     skipped: no staff user in the test database");
    return;
  }

  const before = await prisma.storefrontHome.findUnique({ where: { id: "home" } });
  try {
    await saveBranding({ logoAssetId: "", logoText: "Round-trip shop" }, user.id);
    const brand = await getStorefrontBranding();
    assert.equal(brand.logoText, "Round-trip shop");
    assert.equal(brand.logo, null);

    if (before) {
      // The hero copy is a different form and must still be intact.
      const content = await getHomeContent();
      assert.equal(content.heading, before.heading);
    }
  } finally {
    if (before) {
      await saveBranding(
        { logoAssetId: before.logoAssetId ?? "", logoText: before.logoText },
        user.id,
      );
    } else {
      await prisma.storefrontHome.deleteMany({ where: { id: "home" } });
    }
  }
});

test("banner links stay on this shop and an active banner needs content", () => {
  const base = {
    slot: 2,
    title: "Gifts",
    subtitle: "",
    imageAssetId: "",
    linkLabel: "",
    linkHref: "",
    isActive: true,
  };

  assert.equal(parseBanner(base).slot, 2);

  assert.throws(
    () => parseBanner({ ...base, linkHref: "https://evil.example" }),
    /page on this shop/,
  );
  assert.throws(
    () => parseBanner({ ...base, linkLabel: "Shop now", linkHref: "" }),
    /Add a link for this button/,
  );
  assert.throws(
    () => parseBanner({ ...base, title: "", isActive: true }),
    /Add a title or an image/,
  );
  assert.equal(parseBanner({ ...base, title: "", isActive: false }).isActive, false);
  assert.throws(() => parseBanner({ ...base, slot: 1 }), /slots start at 2/);
  assert.throws(() => parseBanner({ ...base, slot: 7 }), /holds six banners/);
});

test("the editor always offers exactly five extra slots", async () => {
  const slots = await getBannerSlots();
  assert.deepEqual(
    slots.map((banner) => banner.slot),
    [...BANNER_SLOTS],
  );
  assert.equal(slots.length, 5);
});

test("banners round-trip through the database and clear without deleting", async () => {
  const user = await prisma.user.findFirst({ where: { deletedAt: null }, select: { id: true } });
  if (!user) {
    console.log("     skipped: no staff user in the test database");
    return;
  }

  const before = await prisma.storefrontBanner.findMany({ orderBy: { slot: "asc" } });

  try {
    await saveBanners(
      BANNER_SLOTS.map((slot) => ({
        slot,
        title: slot === 3 ? "Round-trip banner" : "",
        subtitle: slot === 3 ? "Second line" : "",
        imageAssetId: "",
        linkLabel: slot === 3 ? "Open" : "",
        linkHref: slot === 3 ? "/shop" : "",
        isActive: slot === 3,
      })),
      user.id,
    );

    const slots = await getBannerSlots();
    const three = slots.find((banner) => banner.slot === 3);
    assert.equal(three?.title, "Round-trip banner");
    assert.equal(three?.linkHref, "/shop");
    assert.equal(three?.isActive, true);
    assert.equal(slots.filter((banner) => banner.isActive).length, 1);

    // Clearing the slot turns it off but keeps the row.
    await saveBanners(
      BANNER_SLOTS.map((slot) => ({
        slot,
        title: "",
        subtitle: "",
        imageAssetId: "",
        linkLabel: "",
        linkHref: "",
        isActive: false,
      })),
      user.id,
    );
    const cleared = await prisma.storefrontBanner.findUnique({ where: { slot: 3 } });
    assert.ok(cleared);
    assert.equal(cleared.isActive, false);
  } finally {
    await prisma.storefrontBanner.deleteMany({});
    if (before.length > 0) {
      await prisma.storefrontBanner.createMany({ data: before });
    }
  }
});

test("the carousel is capped at six slides and drops unsafe links", () => {
  const makeBanner = (
    slot: number,
    overrides: Partial<StorefrontBanner> = {},
  ): StorefrontBanner => ({
    slot,
    title: `Banner ${slot}`,
    subtitle: "",
    image: null,
    linkLabel: "",
    linkHref: "",
    isActive: true,
    ...overrides,
  });

  const slides = buildCarouselSlides(
    { ...HOME_CONTENT_DEFAULTS, primaryHref: "https://evil.example" },
    [makeBanner(2), makeBanner(3, { isActive: false }), makeBanner(4), makeBanner(5), makeBanner(6)],
    null,
  );

  assert.equal(slides.length, 5); // hero + four active banners
  assert.equal(slides[0]?.key, "hero");
  // An unsafe stored link is dropped rather than rendered.
  assert.equal(slides[0]?.linkHref, "");
  assert.deepEqual(
    slides.slice(1).map((slide) => slide.key),
    ["banner-2", "banner-4", "banner-5", "banner-6"],
  );

  // Even a bad data set with seven banners renders six slides.
  const capped = buildCarouselSlides(
    HOME_CONTENT_DEFAULTS,
    [2, 3, 4, 5, 6, 7].map((slot) => makeBanner(slot)),
    null,
  );
  assert.equal(capped.length, 6);
});
