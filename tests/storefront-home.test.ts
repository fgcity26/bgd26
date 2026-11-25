import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/lib/db";
import {
  HOME_CONTENT_DEFAULTS,
  HomeContentError,
  getHomeContent,
  isSitePath,
  normaliseBullets,
  parseHomeContent,
  saveHomeContent,
} from "../src/lib/storefront/home-content";

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
        },
        user.id,
      );
    } else {
      await prisma.storefrontHome.deleteMany({ where: { id: "home" } });
    }
  }
});
