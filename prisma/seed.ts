/**
 * bgd26 seed — reference data only.
 *
 * Idempotent: every write is an upsert or a skip-duplicates insert, so running
 * it twice is safe. It creates the minimum a fresh install needs to be usable:
 * roles/permissions, the chart of accounts, the first fiscal period, one
 * warehouse + store, the shared WALK_IN_CASH profile, and a starter category
 * tree. Business data (products, customers, orders) is never seeded.
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { hashPin, hashSecret, isValidManagerPin } from "../src/lib/password";

const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("Set DIRECT_URL or DATABASE_URL before seeding.");
}

// `prisma db seed` does not reliably inherit NODE_ENV, so the guard is based on
// where the database actually lives: localhost is safe, anything remote needs an
// explicit opt-in.
const isLocalDb = /(^|@)(localhost|127\.0\.0\.1)(:|\/|$)/.test(connectionString);
const allowRemote = process.env.SEED_ALLOW_PROD === "true";
if (!isLocalDb && !allowRemote) {
  const target = (() => {
    try {
      const url = new URL(connectionString);
      return `${url.hostname}:${url.port || "5432"}`;
    } catch {
      return "(unparseable connection string)";
    }
  })();
  throw new Error(
    `Refusing to seed a remote database at ${target}. ` +
      "Set SEED_ALLOW_PROD=true if this is intentional.",
  );
}
const useDevDefaults = isLocalDb && !allowRemote;

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString, max: 2 }),
});

// ---------------------------------------------------------------------------
// 1. RBAC catalogue
// ---------------------------------------------------------------------------
const RESOURCES = [
  "order",
  "product",
  "inventory",
  "purchase",
  "customer",
  "pos",
  "production",
  "shipment",
  "payment",
  "refund",
  "account",
  "expense",
  "report",
  "user",
  "role",
  "review",
  "content",
  "newsletter",
  "whatsapp",
  "ai",
  "settings",
] as const;

const ACTIONS = ["read", "write", "delete", "approve", "publish", "export"] as const;

const ROLE_MATRIX: Record<
  string,
  { name: string; description: string; grants: string[] }
> = {
  OWNER: {
    name: "Owner",
    description: "Full access, including roles, settings and period unlocks.",
    grants: ["*"],
  },
  MANAGER: {
    name: "Manager",
    description: "Runs the shop; cannot change roles or delete users.",
    grants: [
      "*",
      "-role.write",
      "-role.delete",
      "-user.delete",
      "-settings.write",
    ],
  },
  CASHIER: {
    name: "Cashier",
    description: "Counter sales, customers and payment capture.",
    grants: [
      "order.read",
      "order.write",
      "product.read",
      "inventory.read",
      "customer.read",
      "customer.write",
      "pos.read",
      "pos.write",
      "payment.read",
      "payment.write",
      "refund.write",
      "shipment.read",
    ],
  },
  ACCOUNTANT: {
    name: "Accountant",
    description: "Books, expenses, reconciliation and reports.",
    grants: [
      "account.*",
      "expense.*",
      "report.*",
      "order.read",
      "payment.read",
      "refund.read",
      "purchase.read",
      "inventory.read",
    ],
  },
  STOCK: {
    name: "Stock keeper",
    description: "Receiving, transfers, counts and dispatch.",
    grants: [
      "inventory.*",
      "purchase.*",
      "production.*",
      "product.read",
      "shipment.*",
      "order.read",
    ],
  },
  CONTENT: {
    name: "Content editor",
    description: "Catalogue copy, reviews, newsletter and CMS pages.",
    grants: [
      "product.read",
      "review.*",
      "content.*",
      "newsletter.*",
    ],
  },
};

function expandGrants(grants: string[]): Set<string> {
  const all = new Set<string>();
  for (const grant of grants) {
    if (grant.startsWith("-")) continue;
    if (grant === "*") {
      for (const resource of RESOURCES) {
        for (const action of ACTIONS) all.add(`${resource}.${action}`);
      }
    } else if (grant.endsWith(".*")) {
      const resource = grant.slice(0, -2);
      for (const action of ACTIONS) all.add(`${resource}.${action}`);
    } else {
      all.add(grant);
    }
  }
  for (const grant of grants) {
    if (grant.startsWith("-")) all.delete(grant.slice(1));
  }
  return all;
}

// ---------------------------------------------------------------------------
// 2. Chart of accounts (docs/ARCHITECTURE.md §12.2)
// ---------------------------------------------------------------------------
const ACCOUNTS: Array<{
  code: string;
  name: string;
  nameBn: string;
  type: "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE";
  normalBalance: "DEBIT" | "CREDIT";
}> = [
  { code: "1000", name: "Cash on Hand", nameBn: "হাতে নগদ", type: "ASSET", normalBalance: "DEBIT" },
  { code: "1010", name: "Bank — Current", nameBn: "ব্যাংক — চলতি হিসাব", type: "ASSET", normalBalance: "DEBIT" },
  { code: "1020", name: "bKash Merchant", nameBn: "বিকাশ মার্চেন্ট", type: "ASSET", normalBalance: "DEBIT" },
  { code: "1030", name: "Nagad Merchant", nameBn: "নগদ মার্চেন্ট", type: "ASSET", normalBalance: "DEBIT" },
  { code: "1040", name: "Card / SSLCommerz Clearing", nameBn: "কার্ড ক্লিয়ারিং", type: "ASSET", normalBalance: "DEBIT" },
  { code: "1050", name: "Accounts Receivable", nameBn: "প্রাপ্য হিসাব", type: "ASSET", normalBalance: "DEBIT" },
  { code: "1060", name: "Courier COD Clearing", nameBn: "কুরিয়ার সিওডি", type: "ASSET", normalBalance: "DEBIT" },
  { code: "1100", name: "Inventory", nameBn: "স্টক", type: "ASSET", normalBalance: "DEBIT" },
  { code: "1130", name: "Work in Progress", nameBn: "চলমান উৎপাদন", type: "ASSET", normalBalance: "DEBIT" },
  { code: "1150", name: "Input VAT Receivable", nameBn: "ইনপুট ভ্যাট", type: "ASSET", normalBalance: "DEBIT" },
  { code: "1200", name: "Customer Advances", nameBn: "কাস্টমার অগ্রিম", type: "LIABILITY", normalBalance: "CREDIT" },
  { code: "1300", name: "Accounts Payable", nameBn: "প্রদেয় হিসাব", type: "LIABILITY", normalBalance: "CREDIT" },
  { code: "1310", name: "Supplier Advances", nameBn: "সাপ্লায়ার অগ্রিম", type: "LIABILITY", normalBalance: "CREDIT" },
  { code: "1400", name: "VAT Payable", nameBn: "প্রদেয় ভ্যাট", type: "LIABILITY", normalBalance: "CREDIT" },
  { code: "1500", name: "Loyalty Points Liability", nameBn: "লয়্যালটি দায়", type: "LIABILITY", normalBalance: "CREDIT" },
  { code: "1600", name: "Payroll Payable", nameBn: "বেতন প্রদেয়", type: "LIABILITY", normalBalance: "CREDIT" },
  { code: "3000", name: "Owner's Equity", nameBn: "মালিকের মূলধন", type: "EQUITY", normalBalance: "CREDIT" },
  { code: "3100", name: "Retained Earnings", nameBn: "সঞ্চিত মুনাফা", type: "EQUITY", normalBalance: "CREDIT" },
  { code: "4000", name: "Product Sales", nameBn: "পণ্য বিক্রয়", type: "REVENUE", normalBalance: "CREDIT" },
  { code: "4010", name: "Delivery Revenue", nameBn: "ডেলিভারি আয়", type: "REVENUE", normalBalance: "CREDIT" },
  { code: "4020", name: "Sales Discounts", nameBn: "বিক্রয় ছাড়", type: "REVENUE", normalBalance: "DEBIT" },
  { code: "4030", name: "Sales Returns", nameBn: "বিক্রয় ফেরত", type: "REVENUE", normalBalance: "DEBIT" },
  { code: "4040", name: "Loyalty Discount", nameBn: "লয়্যালটি ছাড়", type: "REVENUE", normalBalance: "DEBIT" },
  { code: "5000", name: "Cost of Goods Sold", nameBn: "বিক্রীত পণ্যের ক্রয়মূল্য", type: "EXPENSE", normalBalance: "DEBIT" },
  { code: "5010", name: "Dropship COGS", nameBn: "ড্রপশিপ ক্রয়মূল্য", type: "EXPENSE", normalBalance: "DEBIT" },
  { code: "5020", name: "Inventory Shrinkage", nameBn: "স্টক ঘাটতি", type: "EXPENSE", normalBalance: "DEBIT" },
  { code: "5030", name: "Inventory Rounding", nameBn: "স্টক রাউন্ডিং", type: "EXPENSE", normalBalance: "DEBIT" },
  { code: "5100", name: "Transfer Expense", nameBn: "স্থানান্তর খরচ", type: "EXPENSE", normalBalance: "DEBIT" },
  { code: "5200", name: "Payment Gateway Fees", nameBn: "পেমেন্ট গেটওয়ে ফি", type: "EXPENSE", normalBalance: "DEBIT" },
  { code: "5300", name: "Courier & Delivery Expense", nameBn: "কুরিয়ার খরচ", type: "EXPENSE", normalBalance: "DEBIT" },
  { code: "5400", name: "Cash Over/Short", nameBn: "নগদ বেশি/কম", type: "EXPENSE", normalBalance: "DEBIT" },
  { code: "5500", name: "Loyalty Expense", nameBn: "লয়্যালটি খরচ", type: "EXPENSE", normalBalance: "DEBIT" },
  { code: "6000", name: "Rent", nameBn: "ভাড়া", type: "EXPENSE", normalBalance: "DEBIT" },
  { code: "6010", name: "Salaries", nameBn: "বেতন", type: "EXPENSE", normalBalance: "DEBIT" },
  { code: "6020", name: "Marketing", nameBn: "মার্কেটিং", type: "EXPENSE", normalBalance: "DEBIT" },
  { code: "6030", name: "Packaging", nameBn: "প্যাকেজিং", type: "EXPENSE", normalBalance: "DEBIT" },
  { code: "6040", name: "Utilities", nameBn: "ইউটিলিটি", type: "EXPENSE", normalBalance: "DEBIT" },
  { code: "6050", name: "Office & Misc", nameBn: "অফিস ও বিবিধ", type: "EXPENSE", normalBalance: "DEBIT" },
];

// ---------------------------------------------------------------------------
// 3. Starter categories (VAT-inclusive B2C default: 15 %, exempt where noted)
// ---------------------------------------------------------------------------
const CATEGORIES = [
  { code: "ELEC", name: "Gadgets & Electronics", nameBn: "গ্যাজেট ও ইলেকট্রনিক্স", slug: "gadgets-electronics", vat: 15, sort: 10 },
  { code: "GIFT", name: "Custom Gifts & Engraving", nameBn: "কাস্টম গিফট ও খোদাই", slug: "custom-gifts", vat: 15, sort: 20 },
  { code: "HOME", name: "Home & Lifestyle", nameBn: "হোম ও লাইফস্টাইল", slug: "home-lifestyle", vat: 15, sort: 30 },
  { code: "BOOK", name: "Books & Stationery", nameBn: "বই ও স্টেশনারি", slug: "books-stationery", vat: 0, sort: 40 },
  { code: "SERV", name: "Services", nameBn: "সার্ভিস", slug: "services", vat: 15, sort: 50 },
];

// Reference delivery pricing. The owner can edit these in the admin; the seed
// matches on `name`, so re-seeding never duplicates a zone.
const DELIVERY_ZONES = [
  { name: "Dhaka City", division: "Dhaka", district: "Dhaka", charge: 60, min: 1, max: 2, freeAbove: 3000 },
  { name: "Dhaka Suburb", division: "Dhaka", district: "Dhaka", charge: 90, min: 2, max: 3, freeAbove: 4000 },
  { name: "Chattogram", division: "Chattogram", district: "Chattogram", charge: 120, min: 2, max: 4, freeAbove: 5000 },
  { name: "Sylhet", division: "Sylhet", district: "Sylhet", charge: 130, min: 3, max: 5, freeAbove: 5000 },
  { name: "Khulna", division: "Khulna", district: "Khulna", charge: 130, min: 3, max: 5, freeAbove: 5000 },
  { name: "Rajshahi", division: "Rajshahi", district: "Rajshahi", charge: 130, min: 3, max: 5, freeAbove: 5000 },
  { name: "Barishal", division: "Barishal", district: "Barishal", charge: 140, min: 3, max: 6, freeAbove: 5000 },
  { name: "Rangpur", division: "Rangpur", district: "Rangpur", charge: 140, min: 3, max: 6, freeAbove: 5000 },
  { name: "Mymensingh", division: "Mymensingh", district: "Mymensingh", charge: 130, min: 2, max: 5, freeAbove: 5000 },
];

// Courier registry. Provider adapters for Pathao, Steadfast and RedX are added
// when their credentials arrive; until then the manual courier records a
// consignment and its tracking number by hand.
const COURIERS = [
  { code: "MANUAL", name: "Manual / own delivery", provider: "MANUAL", supportsCod: true },
  { code: "PATHAO", name: "Pathao Courier", provider: "PATHAO", supportsCod: true },
  { code: "STEADFAST", name: "Steadfast Courier", provider: "STEADFAST", supportsCod: true },
  { code: "REDX", name: "RedX", provider: "REDX", supportsCod: true },
];

// ---------------------------------------------------------------------------
// 4. Seed
// ---------------------------------------------------------------------------
async function main() {
  // --- permissions ---
  const permissionRows = RESOURCES.flatMap((resource) =>
    ACTIONS.map((action) => ({
      code: `${resource}.${action}`,
      resource,
      action,
      description: `${action} ${resource}`,
    })),
  );
  await prisma.permission.createMany({ data: permissionRows, skipDuplicates: true });

  const permissions = await prisma.permission.findMany({
    select: { id: true, code: true },
  });
  const permissionIdByCode = new Map(permissions.map((p) => [p.code, p.id]));

  // --- roles ---
  for (const [code, role] of Object.entries(ROLE_MATRIX)) {
    const roleRow = await prisma.role.upsert({
      where: { code },
      update: { name: role.name, description: role.description },
      create: { code, name: role.name, description: role.description, isSystem: true },
    });

    const grants = expandGrants(role.grants);
    const rows = [...grants]
      .map((grant) => permissionIdByCode.get(grant))
      .filter((id): id is string => Boolean(id))
      .map((permissionId) => ({ roleId: roleRow.id, permissionId }));

    if (rows.length > 0) {
      await prisma.rolePermission.createMany({ data: rows, skipDuplicates: true });
    }
  }

  // --- chart of accounts ---
  for (const account of ACCOUNTS) {
    await prisma.account.upsert({
      where: { code: account.code },
      update: { name: account.name, nameBn: account.nameBn, type: account.type, normalBalance: account.normalBalance },
      create: { ...account, isSystem: true },
    });
  }

  // --- fiscal period (Bangladesh FY: July–June) ---
  await prisma.fiscalPeriod.upsert({
    where: {
      startDate_endDate: {
        startDate: new Date("2026-07-01T00:00:00.000Z"),
        endDate: new Date("2027-06-30T23:59:59.999Z"),
      },
    },
    update: {},
    create: {
      name: "FY 2026-27",
      startDate: new Date("2026-07-01T00:00:00.000Z"),
      endDate: new Date("2027-06-30T23:59:59.999Z"),
      status: "OPEN",
    },
  });

  // --- warehouse + store ---
  const warehouse = await prisma.warehouse.upsert({
    where: { code: "WH-MAIN" },
    update: {},
    create: {
      code: "WH-MAIN",
      name: "Central Warehouse",
      nameBn: "কেন্দ্রীয় গুদাম",
      type: "MAIN",
      division: "Dhaka",
      district: "Dhaka",
      isDefault: true,
    },
  });

  await prisma.store.upsert({
    where: { code: "ST-MAIN" },
    update: {},
    create: {
      code: "ST-MAIN",
      name: "Main Store",
      nameBn: "প্রধান দোকান",
      warehouseId: warehouse.id,
      type: "RETAIL",
      division: "Dhaka",
      district: "Dhaka",
    },
  });

  // --- shared WALK_IN_CASH profile (one row, manager PIN required per sale) ---
  await prisma.customer.upsert({
    where: { mobileNormalized: "+8800000000000" },
    update: {},
    create: {
      mobileNormalized: "+8800000000000",
      fullName: "Walk-in Customer",
      customerType: "WALK_IN_CASH",
      isWalkInCash: true,
    },
  });

  // --- categories ---
  for (const category of CATEGORIES) {
    await prisma.category.upsert({
      where: { slug: category.slug },
      update: {},
      create: {
        code: category.code,
        name: category.name,
        nameBn: category.nameBn,
        slug: category.slug,
        vatPercentage: category.vat,
        sortOrder: category.sort,
      },
    });
  }

  // --- delivery zones (reference pricing for the storefront) ---
  for (const zone of DELIVERY_ZONES) {
    const existing = await prisma.deliveryZone.findFirst({
      where: { name: zone.name, division: zone.division, district: zone.district },
      select: { id: true },
    });
    if (existing) continue;
    await prisma.deliveryZone.create({
      data: {
        name: zone.name,
        division: zone.division,
        district: zone.district,
        charge: zone.charge,
        freeShippingThreshold: zone.freeAbove,
        estimatedDaysMin: zone.min,
        estimatedDaysMax: zone.max,
      },
    });
  }

  // --- couriers (manual is usable immediately; provider adapters wait for keys) ---
  for (const courier of COURIERS) {
    await prisma.courier.upsert({
      where: { code: courier.code },
      update: {},
      create: {
        code: courier.code,
        name: courier.name,
        provider: courier.provider as "MANUAL" | "PATHAO" | "STEADFAST" | "REDX",
        supportsCod: courier.supportsCod,
        credentialEnvPrefix:
          courier.provider === "MANUAL" ? null : `${courier.provider}_`,
        isActive: true,
      },
    });
  }

  // --- owner account ---
  // .env.local ships with `SEED_OWNER_PASSWORD=` (empty), so treat blank as unset.
  const optionalEnv = (key: string) => {
    const value = process.env[key]?.trim();
    return value ? value : undefined;
  };

  const ownerEmail = optionalEnv("SEED_OWNER_EMAIL") ?? "owner@bgd26.com";
  const ownerPassword =
    optionalEnv("SEED_OWNER_PASSWORD") ?? (useDevDefaults ? "Bgd26!ChangeMe" : undefined);
  if (!ownerPassword) {
    throw new Error("SEED_OWNER_PASSWORD is required for a remote database.");
  }

  const ownerPin = optionalEnv("SEED_OWNER_PIN") ?? (useDevDefaults ? "123456" : undefined);
  if (ownerPin && !isValidManagerPin(ownerPin)) {
    throw new Error("SEED_OWNER_PIN must be exactly six digits.");
  }

  const existingOwner = await prisma.user.findUnique({
    where: { email: ownerEmail },
    select: { id: true, managerPinUpdatedAt: true },
  });

  const pinHash = ownerPin ? await hashPin(ownerPin) : null;

  const owner = await prisma.user.upsert({
    where: { email: ownerEmail },
    // Re-hash the seeded PIN when it has never been changed, so the pepper can
    // be rotated without touching a PIN a human has chosen.
    update:
      existingOwner && existingOwner.managerPinUpdatedAt === null && pinHash
        ? { managerPinHash: pinHash }
        : {},
    create: {
      email: ownerEmail,
      fullName: "Owner",
      passwordHash: await hashSecret(ownerPassword),
      managerPinHash: pinHash,
      mustChangePassword: true,
      status: "ACTIVE",
    },
  });

  const ownerRole = await prisma.role.findUniqueOrThrow({ where: { code: "OWNER" } });
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: owner.id, roleId: ownerRole.id } },
    update: {},
    create: { userId: owner.id, roleId: ownerRole.id },
  });

  const counts = {
    permissions: await prisma.permission.count(),
    roles: await prisma.role.count(),
    accounts: await prisma.account.count(),
    categories: await prisma.category.count(),
    deliveryZones: await prisma.deliveryZone.count(),
    couriers: await prisma.courier.count(),
    warehouses: await prisma.warehouse.count(),
    stores: await prisma.store.count(),
    users: await prisma.user.count({ where: { deletedAt: null } }),
  };

  console.log("seed complete", counts);
  if (!existingOwner && useDevDefaults && !optionalEnv("SEED_OWNER_PASSWORD")) {
    console.warn(
      `[seed] Development owner created: ${ownerEmail} / Bgd26!ChangeMe (PIN 123456). ` +
        "A new password is required at first sign-in.",
    );
  }
}

main()
  .catch((error) => {
    console.error("seed failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
