import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { renderMarkdownToHtml } from "../src/lib/cms/markdown";
import {
  confirmPath,
  newConfirmToken,
  normalizeNewsletterEmail,
  NewsletterError,
} from "../src/lib/crm/newsletter";
import {
  formatBdMobile,
  normalizeBdMobile,
  PhoneError,
  tryNormalizeBdMobile,
} from "../src/lib/crm/phone";
import { recomputeProductRating } from "../src/lib/crm/reviews";
import { prisma } from "../src/lib/db";

test("Bangladeshi mobile numbers normalise to one canonical form", () => {
  const canonical = "+8801712345678";

  assert.equal(normalizeBdMobile("01712-345678"), canonical);
  assert.equal(normalizeBdMobile("+880 1712 345678"), canonical);
  assert.equal(normalizeBdMobile("8801712345678"), canonical);
  assert.equal(normalizeBdMobile("1712345678"), canonical);

  assert.equal(formatBdMobile(canonical), "01712-345678");
  assert.equal(formatBdMobile("not-a-number"), "not-a-number");

  assert.equal(tryNormalizeBdMobile("01712-345678"), canonical);
  assert.equal(tryNormalizeBdMobile("12345"), null);

  // Landlines, short codes and non-BD numbers are refused.
  assert.throws(() => normalizeBdMobile("029998877"), PhoneError);
  assert.throws(() => normalizeBdMobile("+15551234567"), PhoneError);
  assert.throws(() => normalizeBdMobile(""), PhoneError);
});

test("newsletter emails are lowercased and confirmation tokens are unguessable", () => {
  assert.equal(normalizeNewsletterEmail("  Customer@Example.COM "), "customer@example.com");
  assert.throws(() => normalizeNewsletterEmail("not-an-email"), NewsletterError);
  assert.throws(() => normalizeNewsletterEmail("a@b"), NewsletterError);
  assert.throws(
    () => normalizeNewsletterEmail(`${"a".repeat(250)}@example.com`),
    NewsletterError,
  );

  const token = newConfirmToken();
  assert.match(token, /^[0-9a-f]{48}$/);
  assert.notEqual(token, newConfirmToken());

  assert.equal(confirmPath("abc def"), "/newsletter/confirm?token=abc%20def");
});

test("the Markdown renderer escapes HTML before emitting its own tags", () => {
  const hostile = renderMarkdownToHtml(
    [
      "# Hello <script>alert(1)</script>",
      "",
      "<img src=x onerror=alert(1)>",
      "",
      "[click](javascript:alert(1))",
      "",
      "[safe](https://example.com/path?a=1&b=2)",
      "",
      "[relative](/products) and [mail](mailto:hi@example.com)",
      "",
      "**bold** and *italic* and `code <b>`",
      "",
      "- one",
      "- two",
      "",
      "1. first",
      "2. second",
      "",
      "> quoted",
      "",
      "```html",
      "<script>alert(2)</script>",
      "```",
    ].join("\n"),
  );

  // No raw tag from the input survives.
  assert.equal(hostile.includes("<script>"), false);
  assert.equal(hostile.includes("<img"), false);
  assert.match(hostile, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(hostile, /&lt;img src=x onerror=alert\(1\)&gt;/);

  // javascript: links degrade to plain text.
  assert.equal(hostile.includes("javascript:"), false);
  assert.match(hostile, /<p>click\)<\/p>/);

  // Allowed links gain rel protections when external.
  assert.match(
    hostile,
    /<a href="https:\/\/example\.com\/path\?a=1&amp;b=2" target="_blank" rel="noopener noreferrer nofollow">safe<\/a>/,
  );
  assert.match(hostile, /<a href="\/products">relative<\/a>/);
  assert.match(hostile, /<a href="mailto:hi@example\.com">mail<\/a>/);

  // Basic blocks render.
  assert.match(hostile, /<h1>Hello &lt;script&gt;/);
  assert.match(hostile, /<strong>bold<\/strong>/);
  assert.match(hostile, /<em>italic<\/em>/);
  assert.match(hostile, /<code>code &lt;b&gt;<\/code>/);
  assert.match(hostile, /<ul><li>one<\/li><li>two<\/li><\/ul>/);
  assert.match(hostile, /<ol><li>first<\/li><li>second<\/li><\/ol>/);
  assert.match(hostile, /<blockquote>quoted<\/blockquote>/);
  assert.match(hostile, /<pre><code class="language-html">/);
});

test("product ratings count only approved reviews", async () => {
  const category = await prisma.category.findFirst({ select: { id: true } });
  assert.ok(category, "The local database must be seeded before running this test.");

  const suffix = randomBytes(6).toString("hex");
  const product = await prisma.product.create({
    data: {
      categoryId: category.id,
      name: `Rating test ${suffix}`,
      slug: `rating-test-${suffix}`,
      basePrice: "100.00",
      status: "ACTIVE",
    },
    select: { id: true },
  });

  const customer = await prisma.customer.create({
    data: {
      fullName: "Rating test customer",
      mobileNormalized: `+88017${randomBytes(4).toString("hex").replace(/\D/g, "").padEnd(8, "0").slice(0, 8)}`,
      mobileRaw: "01700-000000",
    },
    select: { id: true },
  });

  try {
    await prisma.productReview.createMany({
      data: [
        {
          productId: product.id,
          customerId: customer.id,
          rating: 5,
          body: "Approved five star review.",
          status: "APPROVED",
        },
      ],
    });

    // A second customer is required because of the per-customer unique key.
    const second = await prisma.customer.create({
      data: {
        fullName: "Second rating customer",
        mobileNormalized: `+88018${randomBytes(4).toString("hex").replace(/\D/g, "").padEnd(8, "0").slice(0, 8)}`,
        mobileRaw: "01800-000000",
      },
      select: { id: true },
    });

    try {
      await prisma.productReview.create({
        data: {
          productId: product.id,
          customerId: second.id,
          rating: 1,
          body: "Still pending.",
          status: "PENDING",
        },
      });

      const first = await recomputeProductRating(product.id);
      assert.deepEqual(first, { average: 5, count: 1 });

      await prisma.productReview.updateMany({
        where: { productId: product.id, customerId: second.id },
        data: { status: "APPROVED" },
      });

      const secondPass = await recomputeProductRating(product.id);
      assert.equal(secondPass.count, 2);
      assert.equal(secondPass.average, 3);

      const stored = await prisma.product.findUniqueOrThrow({
        where: { id: product.id },
        select: { ratingAverage: true, ratingCount: true },
      });
      assert.equal(stored.ratingCount, 2);
      assert.equal(Number(stored.ratingAverage), 3);
    } finally {
      await prisma.productReview.deleteMany({ where: { productId: product.id } });
      await prisma.customer.delete({ where: { id: second.id } });
    }
  } finally {
    await prisma.productReview.deleteMany({ where: { productId: product.id } });
    await prisma.customer.delete({ where: { id: customer.id } });
    await prisma.product.delete({ where: { id: product.id } });
  }
});
