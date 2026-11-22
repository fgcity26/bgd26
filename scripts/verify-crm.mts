/**
 * End-to-end CRM + CMS verification.
 *
 *   npm run build
 *   STORAGE_PROVIDER=local npm start     # in another terminal
 *   npm run verify:crm
 *
 * Point it elsewhere with BASE_URL=http://localhost:3100 npm run verify:crm
 *
 * Proves over real HTTP: customer and content permissions, the 403 page for a
 * cashier, the public page going 404 → 200 only when published, Markdown
 * escaping, review moderation visibility and newsletter double opt-in.
 * Temporary rows and users are removed (users are soft-deleted) at the end.
 */
import { config } from "dotenv";
config({ path: [".env.local", ".env"], quiet: true });

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { prisma } from "../src/lib/db";
import { SESSION_VERSION, signSessionToken } from "../src/lib/auth/token";
import { confirmPath } from "../src/lib/crm/newsletter";
import { subscribeEmail } from "../src/lib/crm/newsletter-service";
import { recomputeProductRating } from "../src/lib/crm/reviews";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const COOKIE = process.env.SESSION_COOKIE_NAME?.trim() || "bgd26_session";

let failures = 0;
let checks = 0;

async function check(label: string, run: () => Promise<void>): Promise<void> {
  checks += 1;
  try {
    await run();
    console.log(`ok   ${label}`);
  } catch (error) {
    failures += 1;
    console.log(`FAIL ${label}\n     ${(error as Error).message}`);
  }
}

function sessionCookie(user: { id: string; email: string }): string {
  const now = Math.floor(Date.now() / 1000);
  const token = signSessionToken({
    v: SESSION_VERSION,
    userId: user.id,
    email: user.email,
    provider: "local",
    issuedAt: now,
    expiresAt: now + 3600,
  });
  return `${COOKIE}=${token}`;
}

async function get(path: string, cookie?: string) {
  const response = await fetch(`${BASE}${path}`, {
    redirect: "manual",
    headers: cookie ? { cookie } : undefined,
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  return {
    status: response.status,
    location: response.headers.get("location") ?? "",
    headers: response.headers,
    text: bytes.toString("utf8"),
  };
}

const run = randomBytes(4).toString("hex");
const digits = String(Date.now()).slice(-8);

const [ownerRole, cashierRole, category] = await Promise.all([
  prisma.role.findUniqueOrThrow({ where: { code: "OWNER" }, select: { id: true } }),
  prisma.role.findUniqueOrThrow({ where: { code: "CASHIER" }, select: { id: true } }),
  prisma.category.findFirstOrThrow({ orderBy: { sortOrder: "asc" }, select: { id: true } }),
]);

const [owner, cashier] = await Promise.all([
  prisma.user.create({
    data: {
      email: `verify-crm-owner-${run}@example.test`,
      fullName: "Verify CRM Owner",
      status: "ACTIVE",
      mustChangePassword: false,
      userRoles: { create: [{ roleId: ownerRole.id }] },
    },
    select: { id: true, email: true },
  }),
  prisma.user.create({
    data: {
      email: `verify-crm-cashier-${run}@example.test`,
      fullName: "Verify CRM Cashier",
      status: "ACTIVE",
      mustChangePassword: false,
      userRoles: { create: [{ roleId: cashierRole.id }] },
    },
    select: { id: true, email: true },
  }),
]);

const customer = await prisma.customer.create({
  data: {
    fullName: `Verify CRM Customer ${run}`,
    mobileNormalized: `+88017${digits}`,
    mobileRaw: `017${digits}`,
    email: `verify-crm-customer-${run}@example.test`,
    customerType: "RETAIL",
    tags: ["vip", "verify"],
    addresses: {
      create: {
        label: "Home",
        recipientName: `Verify CRM Customer ${run}`,
        mobileNormalized: `+88017${digits}`,
        division: "Dhaka",
        district: "Dhaka",
        upazila: "Mirpur",
        area: "Block C",
        addressLine: "House 12, Road 4",
        addressType: "SHIPPING",
        isDefault: true,
      },
    },
  },
  select: { id: true, fullName: true },
});

const product = await prisma.product.create({
  data: {
    categoryId: category.id,
    sku: `VERIFY-CRM-${run.toUpperCase()}`,
    name: `Verify CRM Product ${run}`,
    slug: `verify-crm-product-${run}`,
    status: "ACTIVE",
    isPublished: true,
    basePrice: "100.00",
  },
  select: { id: true, name: true },
});

const review = await prisma.productReview.create({
  data: {
    productId: product.id,
    customerId: customer.id,
    rating: 5,
    title: "Excellent",
    body: "The engraving was perfect.",
    status: "PENDING",
  },
  select: { id: true },
});

const pageSlug = `verify-policy-${run}`;
const page = await prisma.sitePage.create({
  data: {
    slug: pageSlug,
    pageType: "POLICY",
    status: "DRAFT",
    title: `Verify Policy ${run}`,
    body: [
      "## Returns",
      "",
      "Send it back within **7 days**.",
      "",
      "<script>alert('xss')</script>",
    ].join("\n"),
    authorUserId: owner.id,
  },
  select: { id: true, title: true },
});

const subscriberEmail = `verify-crm-newsletter-${run}@example.test`;
const subscription = await subscribeEmail({
  email: subscriberEmail,
  source: "verify",
  consentText: "Verification run.",
});

const ownerCookie = sessionCookie(owner);
const cashierCookie = sessionCookie(cashier);

try {
  await check("anonymous visitors are redirected from the customer list", async () => {
    const response = await get("/customers");
    assert.ok([302, 303, 307, 308].includes(response.status), `status ${response.status}`);
    assert.match(response.location, /\/login/);
  });

  await check("owner sees every CRM and CMS screen", async () => {
    for (const path of ["/customers", "/customers/new", "/reviews", "/reviews/new", "/pages", "/pages/new", "/newsletter"]) {
      const response = await get(path, ownerCookie);
      assert.equal(response.status, 200, `${path} returned ${response.status}`);
    }
  });

  await check("customer detail shows the tag and saved address", async () => {
    const response = await get(`/customers/${customer.id}`, ownerCookie);
    assert.equal(response.status, 200);
    assert.match(response.text, new RegExp(customer.fullName));
    assert.match(response.text, /vip/);
    assert.match(response.text, /House 12, Road 4/);
    assert.match(response.text, /Default/);
  });

  await check("cashier can read customers but cannot moderate or publish", async () => {
    const customers = await get("/customers", cashierCookie);
    assert.equal(customers.status, 200);

    for (const path of ["/reviews", "/pages/new", "/newsletter"]) {
      const response = await get(path, cashierCookie);
      assert.ok(
        [302, 303, 307, 308].includes(response.status),
        `${path} returned ${response.status}`,
      );
      assert.match(response.location, /\/forbidden/, `${path} did not redirect to /forbidden`);
    }
  });

  await check("the pending review is visible to the owner and not approved", async () => {
    const response = await get("/reviews?status=PENDING", ownerCookie);
    assert.equal(response.status, 200);
    assert.match(response.text, /The engraving was perfect\./);
    assert.match(response.text, /PENDING/);

    const stored = await prisma.productReview.findUniqueOrThrow({
      where: { id: review.id },
      select: { status: true },
    });
    assert.equal(stored.status, "PENDING");
  });

  await check("a draft page is not public, a published page is, an archived one is not", async () => {
    const draft = await get(`/p/${pageSlug}`);
    assert.equal(draft.status, 404);

    await prisma.sitePage.update({
      where: { id: page.id },
      data: { status: "PUBLISHED", publishedAt: new Date() },
    });

    const published = await get(`/p/${pageSlug}`);
    assert.equal(published.status, 200);
    assert.match(published.text, new RegExp(page.title));
    assert.match(published.text, /<strong>7 days<\/strong>/);
    // Stored HTML is escaped, never executed.
    assert.doesNotMatch(published.text, /<script>alert/);
    assert.match(published.text, /&lt;script&gt;alert\(&#39;xss&#39;\)&lt;\/script&gt;/);

    await prisma.sitePage.update({ where: { id: page.id }, data: { status: "ARCHIVED" } });
    const archived = await get(`/p/${pageSlug}`);
    assert.equal(archived.status, 404);
  });

  await check("newsletter confirmation completes double opt-in exactly once", async () => {
    assert.equal(subscription.outcome, "pending");
    if (subscription.outcome !== "pending") return;

    const link = confirmPath(subscription.token);
    const first = await get(link);
    assert.equal(first.status, 200);
    assert.match(first.text, /Subscription confirmed/);

    const stored = await prisma.newsletterSubscriber.findUniqueOrThrow({
      where: { email: subscriberEmail },
      select: { status: true, confirmedAt: true },
    });
    assert.equal(stored.status, "SUBSCRIBED");
    assert.ok(stored.confirmedAt);

    const second = await get(link);
    assert.equal(second.status, 200);
    assert.match(second.text, /Already subscribed/);

    const invalid = await get("/newsletter/confirm?token=not-a-real-token");
    assert.equal(invalid.status, 200);
    assert.match(invalid.text, /Link not recognised/);
  });

  await check("approving the review updates the product rating", async () => {
    await prisma.productReview.update({
      where: { id: review.id },
      data: { status: "APPROVED", moderatedByUserId: owner.id, moderatedAt: new Date() },
    });
    const rating = await recomputeProductRating(product.id);
    assert.deepEqual(rating, { average: 5, count: 1 });

    const page = await get("/reviews?status=APPROVED", ownerCookie);
    assert.equal(page.status, 200);
    assert.match(page.text, /The engraving was perfect\./);
  });
} finally {
  await prisma.productReview.deleteMany({ where: { productId: product.id } }).catch(() => undefined);
  await prisma.sitePage.delete({ where: { id: page.id } }).catch(() => undefined);
  await prisma.newsletterSubscriber
    .deleteMany({ where: { email: subscriberEmail } })
    .catch(() => undefined);
  await prisma.customerAddress.deleteMany({ where: { customerId: customer.id } }).catch(() => undefined);
  await prisma.customer.delete({ where: { id: customer.id } }).catch(() => undefined);
  await prisma.product.delete({ where: { id: product.id } }).catch(() => undefined);
  await prisma.user
    .updateMany({
      where: { id: { in: [owner.id, cashier.id] } },
      data: { status: "SUSPENDED", deletedAt: new Date() },
    })
    .catch(() => undefined);
  await prisma.$disconnect();
}

console.log(`\n${checks - failures}/${checks} CRM/CMS checks passed.`);
process.exitCode = failures === 0 ? 0 : 1;
