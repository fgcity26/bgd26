/**
 * Sample catalogue for bgd26.com — engraving gifts, wall clocks, gadgets and
 * bundles.
 *
 * This is *demo* data for a brand-new shop: realistic names, prices and stock,
 * safe to archive later with `--archive`. It is idempotent — running it twice
 * updates the same rows instead of duplicating them.
 *
 *   npx tsx scripts/seed-sample-catalog.mts             # create / update
 *   npx tsx scripts/seed-sample-catalog.mts --local     # store images on disk
 *   npx tsx scripts/seed-sample-catalog.mts --archive   # hide + archive them
 *
 * Images come from `prisma/sample-images/` and go through the normal media
 * pipeline (validation, SHA-256, object storage), so the storefront serves the
 * exact bytes that were uploaded.
 */
import { config } from "dotenv";
config({ path: [".env.local"], quiet: true });

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { prisma } from "../src/lib/db";
import { postOpeningStock } from "../src/lib/inventory/service";
import { storeGalleryImage } from "../src/lib/media/service";

const args = new Set(process.argv.slice(2));
const ARCHIVE = args.has("--archive");
const IMAGE_DIR = join(process.cwd(), "prisma", "sample-images");

if (args.has("--local")) process.env.STORAGE_PROVIDER = "local";
else process.env.STORAGE_PROVIDER = "supabase";

type CategorySeed = {
  slug: string;
  name: string;
  nameBn: string;
  /** Only set for categories this script creates; seeded ones keep their code. */
  code?: string;
  parentSlug?: string;
  vat: string;
  sortOrder: number;
  description: string;
};

/**
 * The seed already ships four top-level categories (`custom-gifts`,
 * `gadgets-electronics`, `home-lifestyle`, …), so sample products reuse them and
 * only two child categories are added.
 */
const CATEGORIES: CategorySeed[] = [
  {
    slug: "wall-clocks",
    name: "Wall Clocks",
    nameBn: "ওয়াল ক্লক",
    code: "CLOCK",
    parentSlug: "home-lifestyle",
    vat: "15",
    sortOrder: 10,
    description: "Silent wooden, metal and personalised photo clocks.",
  },
  {
    slug: "gift-bundles",
    name: "Gift Bundles",
    nameBn: "গিফট বান্ডেল",
    code: "BUNDLE",
    parentSlug: "custom-gifts",
    vat: "15",
    sortOrder: 10,
    description: "Ready-to-give sets for weddings, offices and festivals.",
  },
];

const BRANDS = [
  { slug: "bgd26-studio", name: "bgd26 Studio", nameBn: "বিজিডি২৬ স্টুডিও" },
  { slug: "bgd26-tech", name: "bgd26 Tech", nameBn: "বিজিডি২৬ টেক" },
];

type SampleProduct = {
  slug: string;
  name: string;
  nameBn: string;
  category: string;
  brand: string | null;
  sku: string;
  price: string;
  compareAt: string | null;
  cost: string;
  type: "STOCKED" | "CUSTOM_MADE" | "BUNDLE";
  fulfillment: "STOCKED" | "NON_STOCK";
  stock: number;
  featured: boolean;
  customizable: boolean;
  weightGrams: number;
  warrantyMonths?: number;
  tags: string[];
  short: string;
  shortBn: string;
  description: string;
  descriptionBn: string;
};

const PRODUCTS: SampleProduct[] = [
  {
    slug: "engraved-wooden-name-plate",
    name: "Engraved Wooden Name Plate",
    nameBn: "খোদাই করা কাঠের নামফলক",
    category: "custom-gifts",
    brand: "bgd26-studio",
    sku: "BG-ENG-001",
    price: "1450.00",
    compareAt: "1800.00",
    cost: "620.00",
    type: "CUSTOM_MADE",
    fulfillment: "NON_STOCK",
    stock: 0,
    featured: true,
    customizable: true,
    weightGrams: 400,
    tags: ["sample", "engraving", "desk", "corporate"],
    short: "A solid wood desk plaque, laser-engraved with your name, shop name or logo.",
    shortBn: "শক্ত কাঠের নামফলক — আপনার নাম, দোকানের নাম বা লোগো লেজার খোদাই করা।",
    description:
      "Order it with any name, designation or shop name. We engrave walnut or oak, sand the edges and finish with natural oil. Size 20 x 6 cm, brass stand included. Production takes 2-3 working days.",
    descriptionBn:
      "নাম, পদবি বা দোকানের নাম দিয়ে অর্ডার করুন। ওয়ালনাট বা ওক কাঠে খোদাই করে ধার ঘষে প্রাকৃতিক তেল দেওয়া হয়। আকার ২০ × ৬ সেমি, পিতলের স্ট্যান্ড সহ। তৈরি করতে ২–৩ কার্যদিবস।",
  },
  {
    slug: "acrylic-led-photo-lamp",
    name: "Personalised Acrylic LED Photo Lamp",
    nameBn: "কাস্টম অ্যাক্রিলিক ফটো ল্যাম্প",
    category: "custom-gifts",
    brand: "bgd26-studio",
    sku: "BG-ENG-002",
    price: "2890.00",
    compareAt: "3400.00",
    cost: "1150.00",
    type: "CUSTOM_MADE",
    fulfillment: "NON_STOCK",
    stock: 0,
    featured: true,
    customizable: true,
    weightGrams: 700,
    tags: ["sample", "engraving", "photo", "wedding"],
    short: "A 3D-laser-etched photo inside clear acrylic, glowing from a wooden base.",
    shortBn: "স্বচ্ছ অ্যাক্রিলিকে ৩ডি লেজার খোদাই করা ছবি, কাঠের বেসে উষ্ণ আলো।",
    description:
      "Send one clear photo and we etch it into 5 mm acrylic. Warm-white LED base, USB powered, touch switch. A popular wedding and anniversary gift; production takes 3-4 working days.",
    descriptionBn:
      "একটি স্পষ্ট ছবি পাঠান, আমরা ৫ মিমি অ্যাক্রিলিকে খোদাই করি। উষ্ণ সাদা এলইডি বেস, ইউএসবি চালিত, টাচ সুইচ। বিয়ে ও বিবাহবার্ষিকীর জনপ্রিয় উপহার; তৈরি করতে ৩–৪ কার্যদিবস।",
  },
  {
    slug: "engraved-wooden-keyring-set",
    name: "Engraved Wooden Keyring Set",
    nameBn: "খোদাই করা কাঠের চাবির রিং সেট",
    category: "custom-gifts",
    brand: "bgd26-studio",
    sku: "BG-ENG-003",
    price: "690.00",
    compareAt: "850.00",
    cost: "210.00",
    type: "STOCKED",
    fulfillment: "STOCKED",
    stock: 60,
    featured: false,
    customizable: true,
    weightGrams: 120,
    tags: ["sample", "engraving", "keyring", "gift-box"],
    short: "Three engraved wooden keyrings in a ready-to-give gift box.",
    shortBn: "তিনটি খোদাই করা কাঠের চাবির রিং, উপহারের বাক্সে।",
    description:
      "Walnut and oak blanks with stainless steel rings. Engrave names, initials or a short date. Packed in a kraft gift box, so it is ready for guests, colleagues and corporate events.",
    descriptionBn:
      "ওয়ালনাট ও ওক কাঠের রিং, স্টেইনলেস স্টিলের রিং সহ। নাম, আদ্যক্ষর বা তারিখ খোদাই করা যায়। ক্রাফট গিফট বক্সে প্যাক করা — অতিথি, সহকর্মী বা কর্পোরেট ইভেন্টের জন্য প্রস্তুত।",
  },
  {
    slug: "engraved-wooden-wall-plaque",
    name: "Engraved Wooden Wall Plaque",
    nameBn: "খোদাই করা কাঠের ওয়াল প্লাক",
    category: "custom-gifts",
    brand: "bgd26-studio",
    sku: "BG-ENG-004",
    price: "2350.00",
    compareAt: null,
    cost: "940.00",
    type: "STOCKED",
    fulfillment: "STOCKED",
    stock: 18,
    featured: false,
    customizable: true,
    weightGrams: 900,
    tags: ["sample", "engraving", "wall-art", "home"],
    short: "Hand-finished wooden wall art with a deep geometric engraving.",
    shortBn: "হাতে ফিনিশ করা কাঠের ওয়াল আর্ট, গভীর জ্যামিতিক খোদাই।",
    description:
      "A 30 x 20 cm walnut plaque with a deep geometric engraving and a brass hanging wire. We can replace the pattern with your family name or a short verse on request.",
    descriptionBn:
      "৩০ × ২০ সেমি ওয়ালনাট প্লাক, গভীর জ্যামিতিক খোদাই ও পিতলের ঝুলানোর তার। চাইলে প্যাটার্নের বদলে পারিবারিক নাম বা ছোট লেখা দেওয়া যায়।",
  },
  {
    slug: "minimal-oak-wall-clock",
    name: "Minimal Oak Wall Clock",
    nameBn: "মিনিমাল ওক ওয়াল ক্লক",
    category: "wall-clocks",
    brand: "bgd26-studio",
    sku: "BG-CLK-001",
    price: "2190.00",
    compareAt: "2600.00",
    cost: "1050.00",
    type: "STOCKED",
    fulfillment: "STOCKED",
    stock: 20,
    featured: true,
    customizable: false,
    weightGrams: 1200,
    tags: ["sample", "clock", "wood", "silent"],
    short: "A quiet 12-inch oak clock with brass hour markers.",
    shortBn: "১২ ইঞ্চি ওক কাঠের নীরব ঘড়ি, পিতলের মার্কার।",
    description:
      "Natural oak frame, silent sweep movement with no tick, and a white face with brass dots. Runs on one AA cell. A calm piece for a living room or office.",
    descriptionBn:
      "প্রাকৃতিক ওক ফ্রেম, নীরব মুভমেন্ট — কোনো টিক শব্দ নেই, সাদা ডায়ালে পিতলের ডট। একটি AA ব্যাটারিতে চলে। বসার ঘর বা অফিসের জন্য শান্ত একটি ঘড়ি।",
  },
  {
    slug: "custom-photo-wall-clock",
    name: "Custom Photo Wall Clock",
    nameBn: "কাস্টম ফটো ওয়াল ক্লক",
    category: "wall-clocks",
    brand: "bgd26-studio",
    sku: "BG-CLK-002",
    price: "2650.00",
    compareAt: "3200.00",
    cost: "1180.00",
    type: "CUSTOM_MADE",
    fulfillment: "NON_STOCK",
    stock: 0,
    featured: false,
    customizable: true,
    weightGrams: 1100,
    tags: ["sample", "clock", "photo", "personalised"],
    short: "Your photo printed on an 11-inch clock face.",
    shortBn: "১১ ইঞ্চি ঘড়ির ডায়ালে আপনার ছবি।",
    description:
      "Send a photo and we print it on the clock face, then fit slim hands so the picture stays readable. Silent movement. A family or couple photo makes it a personal gift.",
    descriptionBn:
      "ছবি পাঠান; আমরা ডায়ালে ছবি প্রিন্ট করে সরু কাঁটা বসাই যাতে ছবি স্পষ্ট থাকে। নীরব মুভমেন্ট। পারিবারিক বা দম্পতির ছবি দিয়ে ব্যক্তিগত উপহার।",
  },
  {
    slug: "silent-metal-wall-clock",
    name: "Silent Metal Wall Clock",
    nameBn: "সাইলেন্ট মেটাল ওয়াল ক্লক",
    category: "wall-clocks",
    brand: "bgd26-tech",
    sku: "BG-CLK-003",
    price: "1590.00",
    compareAt: null,
    cost: "720.00",
    type: "STOCKED",
    fulfillment: "STOCKED",
    stock: 30,
    featured: false,
    customizable: false,
    weightGrams: 900,
    tags: ["sample", "clock", "metal", "office"],
    short: "Matte black metal frame, white face, truly silent.",
    shortBn: "ম্যাট ব্ল্যাক মেটাল ফ্রেম, সাদা ডায়াল, সম্পূর্ণ নীরব।",
    description:
      "A 10-inch clock with a slim powder-coated steel frame and a silent sweep movement. Reads clearly from across a room; suits a study, kitchen or office.",
    descriptionBn:
      "১০ ইঞ্চি ঘড়ি, পাতলা পাউডার-কোটেড স্টিল ফ্রেম ও নীরব মুভমেন্ট। দূর থেকেও স্পষ্ট দেখা যায়; পড়ার ঘর, রান্নাঘর বা অফিসের জন্য।",
  },
  {
    slug: "wireless-earbuds-pro",
    name: "Wireless Earbuds Pro",
    nameBn: "ওয়্যারলেস ইয়ারবাডস প্রো",
    category: "gadgets-electronics",
    brand: "bgd26-tech",
    sku: "BG-ELC-001",
    price: "2450.00",
    compareAt: "3200.00",
    cost: "1650.00",
    type: "STOCKED",
    fulfillment: "STOCKED",
    stock: 40,
    featured: true,
    customizable: false,
    weightGrams: 180,
    warrantyMonths: 12,
    tags: ["sample", "audio", "bluetooth", "gadget"],
    short: "Bluetooth 5.3 earbuds with active noise cancelling and a 24-hour case.",
    shortBn: "ব্লুটুথ ৫.৩ ইয়ারবাডস, অ্যাক্টিভ নয়েজ ক্যানসেলিং ও ২৪ ঘণ্টার কেস।",
    description:
      "Bluetooth 5.3, active noise cancelling, touch controls and a USB-C case that adds three extra charges. Twelve months service warranty through our counter.",
    descriptionBn:
      "ব্লুটুথ ৫.৩, অ্যাক্টিভ নয়েজ ক্যানসেলিং, টাচ কন্ট্রোল, ইউএসবি-সি কেসে আরও তিনবার চার্জ। আমাদের কাউন্টার থেকে ১২ মাসের সার্ভিস ওয়ারেন্টি।",
  },
  {
    slug: "amoled-smart-watch",
    name: "AMOLED Smart Watch",
    nameBn: "অ্যামোলেড স্মার্ট ওয়াচ",
    category: "gadgets-electronics",
    brand: "bgd26-tech",
    sku: "BG-ELC-002",
    price: "4990.00",
    compareAt: "6500.00",
    cost: "3400.00",
    type: "STOCKED",
    fulfillment: "STOCKED",
    stock: 25,
    featured: false,
    customizable: false,
    weightGrams: 220,
    warrantyMonths: 12,
    tags: ["sample", "wearable", "gadget"],
    short: "1.85-inch AMOLED display, heart-rate and SpO2 tracking, 7-day battery.",
    shortBn: "১.৮৫ ইঞ্চি অ্যামোলেড ডিসপ্লে, হার্ট-রেট ও SpO2, ৭ দিনের ব্যাটারি।",
    description:
      "A bright AMOLED screen that stays readable in sunlight, with call alerts, step and sleep tracking, and IP68 water resistance. Charging cable included; 12 months service warranty.",
    descriptionBn:
      "রোদেও স্পষ্ট অ্যামোলেড স্ক্রিন, কল অ্যালার্ট, স্টেপ ও স্লিপ ট্র্যাকিং, IP68 পানি প্রতিরোধী। চার্জিং কেবল সহ; ১২ মাসের সার্ভিস ওয়ারেন্টি।",
  },
  {
    slug: "portable-bluetooth-speaker",
    name: "Portable Bluetooth Speaker",
    nameBn: "পোর্টেবল ব্লুটুথ স্পিকার",
    category: "gadgets-electronics",
    brand: "bgd26-tech",
    sku: "BG-ELC-003",
    price: "2990.00",
    compareAt: "3800.00",
    cost: "1950.00",
    type: "STOCKED",
    fulfillment: "STOCKED",
    stock: 30,
    featured: false,
    customizable: false,
    weightGrams: 600,
    warrantyMonths: 12,
    tags: ["sample", "audio", "bluetooth", "gadget"],
    short: "Pocket-size speaker with a strap, 10-hour battery and deep bass.",
    shortBn: "পকেট সাইজ স্পিকার, স্ট্র্যাপ, ১০ ঘণ্টার ব্যাটারি ও গভীর বেজ।",
    description:
      "A 10 W speaker with a passive bass radiator, IPX6 splash resistance and a leather strap. Pairs with a phone in seconds; USB-C charging.",
    descriptionBn:
      "১০ ওয়াট স্পিকার, প্যাসিভ বেজ রেডিয়েটর, IPX6 স্প্ল্যাশ প্রতিরোধী ও লেদার স্ট্র্যাপ। ফোনের সাথে সহজে যুক্ত হয়; ইউএসবি-সি চার্জিং।",
  },
  {
    slug: "corporate-gift-box",
    name: "Corporate Gift Box",
    nameBn: "কর্পোরেট গিফট বক্স",
    category: "gift-bundles",
    brand: "bgd26-studio",
    sku: "BG-BND-001",
    price: "1990.00",
    compareAt: "2400.00",
    cost: "980.00",
    type: "BUNDLE",
    fulfillment: "STOCKED",
    stock: 20,
    featured: false,
    customizable: true,
    weightGrams: 800,
    tags: ["sample", "bundle", "corporate", "engraving"],
    short: "Engraved pen, keyring, desk card and notebook in a black gift box.",
    shortBn: "খোদাই করা কলম, চাবির রিং, ডেস্ক কার্ড ও নোটবুক — কালো গিফট বক্সে।",
    description:
      "A ready corporate set: engraved wooden pen, matching keyring, a small engraved desk card and a slim notebook. We engrave your company name on every piece; minimum 10 boxes for custom branding.",
    descriptionBn:
      "প্রস্তুত কর্পোরেট সেট: খোদাই করা কাঠের কলম, মিলিত চাবির রিং, ছোট ডেস্ক কার্ড ও সরু নোটবুক। প্রতিটি পণ্যে কোম্পানির নাম খোদাই করা যায়; কাস্টম ব্র্যান্ডিংয়ে সর্বনিম্ন ১০ বক্স।",
  },
  {
    slug: "wedding-gift-hamper",
    name: "Wedding Gift Hamper",
    nameBn: "ওয়েডিং গিফট হ্যাম্পার",
    category: "gift-bundles",
    brand: "bgd26-studio",
    sku: "BG-BND-002",
    price: "5450.00",
    compareAt: "6500.00",
    cost: "3100.00",
    type: "BUNDLE",
    fulfillment: "STOCKED",
    stock: 8,
    featured: true,
    customizable: true,
    weightGrams: 2500,
    tags: ["sample", "bundle", "wedding", "gift"],
    short: "Clock, acrylic frame, two keyrings and a candle on a wooden tray.",
    shortBn: "ঘড়ি, অ্যাক্রিলিক ফ্রেম, দুটি চাবির রিং ও মোমবাতি — কাঠের ট্রেতে।",
    description:
      "Our wedding hamper: a small wall clock, a personalised acrylic photo frame, two engraved keyrings and a scented candle, arranged on a wooden tray with a satin ribbon. The couple's names are added at no extra cost.",
    descriptionBn:
      "আমাদের ওয়েডিং হ্যাম্পার: ছোট ওয়াল ক্লক, কাস্টম অ্যাক্রিলিক ফটো ফ্রেম, দুটি খোদাই করা চাবির রিং ও সুগন্ধি মোমবাতি, কাঠের ট্রেতে সাটিন ফিতা সহ। অতিরিক্ত খরচ ছাড়াই দম্পতির নাম যোগ করা যায়।",
  },
];

async function upsertCategories() {
  const idBySlug = new Map<string, string>();

  // Parents first: the two sample categories are children of seeded ones.
  for (const category of CATEGORIES) {
    let parentId: string | null = null;
    if (category.parentSlug) {
      const parent = await prisma.category.findUnique({
        where: { slug: category.parentSlug },
        select: { id: true },
      });
      if (!parent) {
        throw new Error(
          `Parent category ${category.parentSlug} is missing. Run \`npm run db:seed\` first.`,
        );
      }
      parentId = parent.id;
    }

    const row = await prisma.category.upsert({
      where: { slug: category.slug },
      update: {
        name: category.name,
        nameBn: category.nameBn,
        vatPercentage: category.vat,
        sortOrder: category.sortOrder,
        description: category.description,
        parentId,
        isActive: true,
      },
      create: {
        slug: category.slug,
        ...(category.code ? { code: category.code } : {}),
        name: category.name,
        nameBn: category.nameBn,
        vatPercentage: category.vat,
        sortOrder: category.sortOrder,
        description: category.description,
        parentId,
        isActive: true,
      },
      select: { id: true },
    });
    idBySlug.set(category.slug, row.id);
  }

  // Existing parents are referenced but not modified.
  for (const slug of ["custom-gifts", "gadgets-electronics", "home-lifestyle"]) {
    const row = await prisma.category.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (row) idBySlug.set(slug, row.id);
  }

  return idBySlug;
}

async function upsertBrands() {
  const idBySlug = new Map<string, string>();
  for (const brand of BRANDS) {
    const row = await prisma.brand.upsert({
      where: { slug: brand.slug },
      update: { name: brand.name, nameBn: brand.nameBn, isActive: true },
      create: { ...brand, isActive: true },
      select: { id: true },
    });
    idBySlug.set(brand.slug, row.id);
  }
  return idBySlug;
}

async function requireOwner() {
  const owner = await prisma.user.findFirst({
    where: { status: "ACTIVE", deletedAt: null },
    orderBy: { createdAt: "asc" },
    select: { id: true, email: true },
  });
  if (!owner) throw new Error("No active staff account found. Seed the database first.");
  return owner;
}

async function requireWarehouse() {
  const warehouse = await prisma.warehouse.findFirst({
    where: { isDefault: true, isActive: true },
    select: { id: true, name: true },
  });
  if (!warehouse) throw new Error("No default warehouse found.");
  return warehouse;
}

function sampleImagePath(slug: string) {
  return join(IMAGE_DIR, `${slug}.jpg`);
}

async function archiveSamples() {
  const result = await prisma.product.updateMany({
    where: { slug: { in: PRODUCTS.map((product) => product.slug) } },
    data: { status: "ARCHIVED", isPublished: false, archivedAt: new Date() },
  });
  console.log(`Archived ${result.count} sample product(s). Stock and media are kept, as the rules require.`);
}

async function main() {
  if (ARCHIVE) {
    await archiveSamples();
    return;
  }

  const provider = process.env.STORAGE_PROVIDER;
  console.log(`Storage provider: ${provider}`);
  const [owner, warehouse, categoryIds, brandIds] = await Promise.all([
    requireOwner(),
    requireWarehouse(),
    upsertCategories(),
    upsertBrands(),
  ]);
  console.log(`Actor: ${owner.email}   Warehouse: ${warehouse.name}`);

  let created = 0;
  let updated = 0;
  let images = 0;
  let openingStock = 0;

  for (const product of PRODUCTS) {
    const categoryId = categoryIds.get(product.category);
    if (!categoryId) throw new Error(`Unknown category ${product.category}`);

    const data = {
      categoryId,
      brandId: product.brand ? brandIds.get(product.brand) ?? null : null,
      sku: product.sku,
      name: product.name,
      nameBn: product.nameBn,
      slug: product.slug,
      shortDescription: product.short,
      description: product.description,
      descriptionBn: product.descriptionBn,
      productType: product.type,
      status: "ACTIVE" as const,
      basePrice: product.price,
      compareAtPrice: product.compareAt,
      costPrice: product.cost,
      tags: product.tags,
      weightGrams: product.weightGrams,
      warrantyMonths: product.warrantyMonths ?? null,
      isFeatured: product.featured,
      isPublished: true,
      isCustomizable: product.customizable,
      requiresDesignApproval: product.type === "CUSTOM_MADE",
      isDropshipEnabled: false,
      seoTitle: `${product.name} · bgd26`,
      seoDescription: product.short,
      archivedAt: null,
    };

    const existing = await prisma.product.findUnique({
      where: { slug: product.slug },
      select: { id: true },
    });

    const row = existing
      ? await prisma.product.update({
          where: { id: existing.id },
          data,
          select: { id: true },
        })
      : await prisma.product.create({
          data: { ...data, createdByUserId: owner.id },
          select: { id: true },
        });

    const variant = await prisma.productVariant.upsert({
      where: { sku: product.sku },
      update: {
        productId: row.id,
        name: product.name,
        price: product.price,
        compareAtPrice: product.compareAt,
        costPrice: product.cost,
        fulfillmentType: product.fulfillment,
        isDefault: true,
        status: "ACTIVE",
        weightGrams: product.weightGrams,
      },
      create: {
        productId: row.id,
        sku: product.sku,
        name: product.name,
        price: product.price,
        compareAtPrice: product.compareAt,
        costPrice: product.cost,
        fulfillmentType: product.fulfillment,
        isDefault: true,
        status: "ACTIVE",
        weightGrams: product.weightGrams,
      },
      select: { id: true },
    });

    const mediaCount = await prisma.productMedia.count({
      where: { productId: row.id, role: "GALLERY" },
    });
    if (mediaCount === 0) {
      const bytes = new Uint8Array(await readFile(sampleImagePath(product.slug)));
      const stored = await storeGalleryImage({
        bytes,
        declaredMime: "image/jpeg",
        filename: `${product.slug}.jpg`,
        uploadedByUserId: owner.id,
        altText: `${product.name} — sample photo`,
      });
      await prisma.productMedia.create({
        data: {
          productId: row.id,
          variantId: null,
          mediaAssetId: stored.assetId,
          role: "GALLERY",
          isPrimary: true,
          sortOrder: 0,
        },
      });
      images += 1;
    }

    if (product.stock > 0 && product.fulfillment === "STOCKED") {
      const history = await prisma.stockLedger.count({
        where: { variantId: variant.id, warehouseId: warehouse.id },
      });
      if (history === 0) {
        // Each opening entry posts a journal through the remote pooler, which
        // needs more than Prisma's default 5 s interactive-transaction budget.
        await prisma.$transaction(
          (tx) =>
            postOpeningStock(
              {
                warehouseId: warehouse.id,
                variantId: variant.id,
                quantity: product.stock,
                unitCost: product.cost,
                note: "Sample catalogue opening stock",
                actorUserId: owner.id,
              },
              tx,
            ),
          { timeout: 30_000, maxWait: 10_000 },
        );
        openingStock += 1;
      }
    }

    if (existing) updated += 1;
    else created += 1;
    console.log(
      `${existing ? "updated" : "created"}  ${product.sku.padEnd(11)} ${product.name}`,
    );
  }

  console.log(
    `\nDone: ${created} created, ${updated} updated, ${images} image(s) stored, ${openingStock} opening-stock entry(ies).`,
  );
  console.log("Storefront pages revalidate within 2 minutes.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
