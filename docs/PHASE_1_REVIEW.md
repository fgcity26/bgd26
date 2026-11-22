# Phase 1 — Review & Verification Gate

**Status: APPROVED on 2026-11-15 (owner replied "use defaults").**
Phase 2 has started from this baseline. This page stays as the record of what
was reviewed and how it was verified.

## 1. What was delivered

| File | Purpose |
| --- | --- |
| `docs/ARCHITECTURE.md` | System architecture, speed/mobile design, adapters, AVCO, offline sync, zero-transform media, double-entry posting map, dropshipping, security, SQL invariants, roadmap |
| `docs/ER_DIAGRAM.md` | Complete Mermaid ER diagram (all 90 tables, 234 relationships) + critical path + dropship flow |
| `prisma/schema.prisma` | Production schema: 90 tables (84 core + 6 engagement), 81 enums, indexes, relations, snapshots |
| `.env.example` | Every environment variable for Supabase, S3, auth, payments, couriers, WhatsApp, AI |
| `.gitignore` | Blocks all `.env*` except `.env.example`, plus build/test artefacts |
| `scripts/check-schema.py` | Offline structural validator (no Node required) |

## 2. Verification already performed

Everything below was executed against this exact schema and migration set.

```text
$ npx prisma validate                      # Prisma 7.10.1
The schema at prisma/schema.prisma is valid 🚀

$ python3 scripts/check-schema.py
models: 90 | tables: 90 | enums: 81 | relations: 468
fields with Decimal: 133
OK: no structural errors found.

$ npx prisma migrate deploy                # real PostgreSQL 17.5
2 migrations applied successfully

$ npx prisma db seed
permissions: 126 | roles: 6 | accounts: 37 | categories: 5 | users: 1

$ node scripts/verify-invariants.mjs
10/10 checks behaved as expected
```

The offline validator checks:

- exactly the **90 tables**: the 84 required tables from Section 4 plus the 6
  approved engagement tables (`product_reviews`, `review_media`, `wishlists`,
  `wishlist_items`, `newsletter_subscribers`, `site_pages`), no missing/extra
  tables;
- every field type exists (scalar, enum or model);
- every relation has a matching opposite relation on the target model;
- relation names match when there are multiple relations between two models;
- every FK points at an `@id`/`@unique` column;
- FK optionality matches the relation field optionality;
- one-to-one relations have a unique FK;
- every model has a primary key;
- indexes/unique constraints reference real columns;
- enum defaults use real enum values;
- every `Decimal` declares a precision.

## 3. Exact commands to reproduce

Prerequisites: Node.js 22+ (tested on 26) and npm 10+.

```bash
# 1. Go to the project
cd "Default Project"

# 2. Count tables and enums (must print 90 and 81)
grep -c '^model ' prisma/schema.prisma
grep -c '^enum '  prisma/schema.prisma

# 3. Environment file (dummy DB values are enough for schema validation)
cp .env.example .env.local

# 4. Install and validate (Prisma 7: URL lives in prisma.config.ts)
npm install
npx prisma validate
# Expected: "The schema at prisma/schema.prisma is valid 🚀"

# 5. Format check (review the diff; commit only formatting changes)
npx prisma format
git diff --stat   # should be empty or whitespace-only

# 6. Offline structural validator
python3 scripts/check-schema.py
```

## 4. Secret-safety check (before the first commit)

```bash
git init
git add .
git status --short          # .env.local must NOT appear
git check-ignore -v .env.local
# expected: .gitignore:2:.env.*    .env.local

# Quick scan for accidental keys/tokens in tracked files
git grep -nE '(sk_live_|AKIA[0-9A-Z]{16}|eyJhbGciOi|SUPABASE_SERVICE_ROLE_KEY=.+)' \
  -- . ':!*.example' || echo "no obvious secrets found"
```

Rules going forward: `.env.local` stays local, production values live in the
Vercel and Supabase dashboards, and no service-role key is ever exposed to the
browser.

## 5. Review focus — the decisions I need you to confirm

Please read these sections and answer the 13 questions in §24 of
`docs/ARCHITECTURE.md`. The three that change the schema or money logic most:

1. **VAT mode** — are B2C prices VAT-inclusive (recommended for Bangladesh) or
   VAT-exclusive? What is the rate per category?
2. **Dropship mixed carts** — may one cart contain stocked + dropship items
   (two parcels), or should mixed carts be blocked?
3. **Loyalty timing** — award points on DELIVERED (recommended, prevents
   cancelled-order farming) or on payment/CONFIRMED?

Also needed for seeding: store/warehouse list, cash/bank/MFS account names and
opening balances, courier accounts, WhatsApp WABA details, and payment merchant
status.

**Engagement layer added in this phase** (before any migration, so no live table
has to be altered later): `product_reviews`, `review_media`, `wishlists`,
`wishlist_items`, `newsletter_subscribers`, `site_pages`. Defaults: manual
review moderation, verified badge only for delivered orders, wishlist never
reserves stock, newsletter double opt-in, CMS pages sanitised Markdown and
PUBLISHED-only in public. Confirm these defaults with your answers to questions
11–13.

## 6. Phase 1 exit criteria

- [x] `docs/ARCHITECTURE.md` covers speed, mobile, adapters, locking, AVCO,
      offline sync, zero-transform media, automatic double-entry, dropshipping.
- [x] `docs/ER_DIAGRAM.md` shows all 90 tables and their relationships.
- [x] `prisma/schema.prisma` contains all 90 tables, enums, PK/FK/unique/index.
- [x] `.env.example` covers all providers and feature flags.
- [x] `.gitignore` blocks secrets; no secret is hardcoded anywhere.
- [x] No migration or application code has been written.
- [ ] **Your approval + answers to the Phase 2 questions.**

## 7. Bangla summary (সংক্ষেপে)

**ফেজ ১ শেষ।** এখন পর্যন্ত শুধু নকশা, সম্পূর্ণ ডাটাবেস স্কিমা (৯০টি টেবিল) এবং
পরিবেশ ভেরিয়েবলের টেমপ্লেট তৈরি হয়েছে। কোনো অ্যাপ কোড লেখা হয়নি, ডাটাবেসে
কিছু চালানো হয়নি।

**যা যাচাই করা হয়েছে:** ৯০টি টেবিল (৮৪টি মূল + ৬টি রিভিউ/উইশলিস্ট/নিউজলেটার/পেজ), ৮১টি enum, ২৩৪টি সম্পর্ক—সব মিলেছে।
প্রতিটি টেবিল ও রিলেশনের নাম, প্রাইমারি কী, ইউনিক কী এবং ইনডেক্স পরীক্ষা করা
হয়েছে। তবে অফিসিয়াল Prisma ভ্যালিডেশন আপনার কম্পিউটারে একবার চালাতে হবে
(উপরের কমান্ড)। এতে কোনো ডাটাবেস লাগবে না।

**এরপর আপনার সিদ্ধান্ত দরকার:**

1. ভ্যাটসহ দাম দেখাবেন, নাকি ভ্যাট আলাদা? কোন ক্যাটাগরিতে কত শতাংশ?
2. ড্রপশিপিং ও সাধারণ পণ্য একই অর্ডারে থাকলে দুটি পার্সেল যাবে—এটি ঠিক আছে?
3. লয়্যালটি পয়েন্ট ডেলিভারির পরে দেবেন, নাকি পেমেন্টের সময়?

এছাড়া দোকান/গুদামের তালিকা, ব্যাংক/বিকাশ/নগদ অ্যাকাউন্টের নাম ও প্রারম্ভিক
ব্যালেন্স, কুরিয়ার ও হোয়াটসঅ্যাপ অ্যাকাউন্টের তথ্য দিলে ফেজ ২ শুরু করা যাবে।

**গুরুত্বপূর্ণ:** `.env.local` ফাইল কখনো গিটহাবে যাবে না। আসল পাসওয়ার্ড শুধু
`.env.local`-এ এবং পরে Vercel/Supabase-এর সেটিংসে থাকবে।
