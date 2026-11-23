# Phase 2 and Phase 3 — status

**Phase 2 modules 1–4 complete and approved.** Scaffold, migration and seed
(module 1), authentication + RBAC (module 2), catalog + zero-transform media
(module 3) and CRM/CMS (module 4) are in place and verified against a real
PostgreSQL instance and a real production build.

**Phase 3 modules 1–3 complete and approved.** The multi-warehouse inventory
engine — opening stock, adjustments, two-step transfers, AVCO and the
append-only stock ledger — is built and verified. Suppliers, purchase orders and
goods-received notes are also built and verified; posting a GRN feeds
`PURCHASE_RECEIPT` into the same AVCO engine. The counter, orders, payment
lifecycle and refunds are complete and were approved on 19 November 2026.

**Phase 3 module 4a complete and approved.** Every business event now posts a
balanced, immutable journal, and the console carries a trial balance, chart of
accounts, account ledger, journal browser and expense workflow.

**Phase 3 module 4b complete and approved (19 November 2026).** Loyalty points
earn on a paid or completed sale, redeem against a capped share of net
merchandise, expire after twelve months, and post a balanced journal for every
movement. The console carries a loyalty overview and a per-customer ledger with
manual adjustment.

**Phase 3 module 5a complete and approved (19 November 2026).** The public
storefront is live: catalogue, product pages, a guest cart, coupon codes,
delivery zones and a one-page guest checkout with cash on delivery or manual
bKash/Nagad. An online order runs through the same order engine as the counter —
stock leaves the default warehouse, the journal balances, the payment waits for
verification — and the customer gets a signed order link plus a mobile-based
tracking page. Guests still check out with only a mobile number; module 9 adds an
optional account on top. WhatsApp (4c) remains skipped until its credentials
arrive.

**Phase 3 module 5b complete and approved (19 November 2026).** Courier registry,
consignment booking, an append-only tracking timeline, order-status
synchronisation and cash-on-delivery remittance sit on top of the storefront.
Only the manual courier books today; Pathao, Steadfast and RedX are seeded
records whose adapters wait for credentials. Booking does not move the order — a
pickup event ships it, a delivery event delivers it — and a remittance clears
`1060 Courier COD Clearing` to cash or bank.

**Phase 3 module 5c complete and approved (19 November 2026).** The three
financial statements are readable in the console: profit and loss for a date
range, a balance sheet at a point in time and a cash-flow statement. Every figure
is a sum of posted journal lines, so the statements cannot disagree with the
ledger; reversals are ordinary entries and therefore net out on their own.

**Phase 3 module 6 complete and approved (19 November 2026).** Supplier settlement
closes the purchasing loop: a payment reduces what is owed, a purchase return
sends goods back at average cost and debits the supplier, and a statement shows
every movement with a running balance. The payable is never stored — it is the
supplier's share of account `1300` in the posted journal, so the statement and
the books cannot disagree.

**Phase 3 module 7 complete and approved (19 November 2026).** Engraving
production tracks each order line from design proof to hand-over: revisions and
internal approval, components issued at average cost into work in progress, and
completion or cancellation clearing that value. Shipping keeps its own status,
so production never blocks dispatch.

**Phase 3 module 8 complete and approved (20 November 2026).** Dropshipping now runs end to
end. A sale with dropship lines raises one supplier purchase order per supplier
in the same transaction, at the variant's dropship cost. The supplier order moves
draft, sent, confirmed, shipped and delivered; shipping is refused while the
customer owes money, recognises cost of goods sold once (DR `5010` / CR `1300`)
and creates a direct shipment with no warehouse. A sale split across suppliers
gets one direct parcel per supplier and only closes when the last parcel arrives.
Cancelling the sale cancels open supplier orders and is refused after shipment.

**Phase 3 module 9 complete and approved (22 November 2026).** Customer accounts
now sit on top of guest checkout. The mobile number is the identity; a guest
record with orders is claimed with one matching order number. A separate signed
customer cookie opens order history, saved addresses, the points ledger and a
password-protected profile. A signed-in checkout forces the account's own mobile
and allows spending points up to 20 % of net merchandise through the same
redemption engine as the counter.

**Phase 3 module 10 complete, awaiting owner approval (23 November 2026).** The
staff console now has an assistant that answers product, stock, delivery and
order questions from the live database and can create a **draft** order. It
cannot take payment, refund, discount, adjust stock or post a journal. It runs
with no API key on a deterministic rules adapter, and switches to an
OpenAI-compatible model only when a key is configured. Every tool call is
audited, mobile numbers are masked, drafts reserve nothing, and converting a
draft runs the ordinary sale engine so prices, VAT, stock and the journal are
re-checked before anything real happens.

## Module 1 — scaffold, database, seed

| Area | Detail |
| --- | --- |
| Runtime | Next.js 16.4.6 (App Router, Turbopack), React 19.3, TypeScript 5.9 |
| Styling | Tailwind CSS 4.3 (CSS-first `@theme`), 360 px-first layout, Bangla + English |
| ORM | Prisma 7.10.1 with the `pg` driver adapter; client generated to `src/generated/prisma` |
| Database | 3 migrations: full 90-table DDL, invariants, and the auth flag |
| Seed | 126 permissions, 6 roles, 37 accounts, 5 categories, 1 warehouse, 1 store, 1 owner user |
| Health | `GET /api/health` returns DB status, latency and PostgreSQL version without leaking secrets |
| Security | scrypt password + manager-PIN hashing in `src/lib/password.ts` |

### Verified here (not claimed — executed)

```text
npx prisma validate
  The schema at prisma/schema.prisma is valid 🚀

npx prisma migrate deploy
  20261115090000_init            applied
  20261115090100_invariants      applied
  20261116100000_auth_fields     applied

npx prisma db seed                (twice — second run changes nothing)
  permissions 126 | roles 6 | accounts 37 | categories 5
  warehouses 1 | stores 1 | users 1
  second run: identical counts, no duplicate owner, no dev-password banner

node scripts/verify-invariants.mjs
  10/10 checks behaved as expected
    - order totals mismatch rejected        - balanced posted journal accepted
    - consistent order accepted             - posted journal edit rejected
    - walk-in POS sale accepted             - posted journal delete rejected
    - walk-in digital payment rejected      - uppercase newsletter email rejected
    - unbalanced posted journal rejected    - lowercase newsletter email accepted

npm run build       → 7 routes, compiled
GET /               → 200
GET /api/health     → {"status":"ok","database":"up","server":"PostgreSQL 17.5"}
```

## Module 2 — authentication and RBAC

| Area | Detail |
| --- | --- |
| Port | `AuthAdapter` (`src/lib/adapters/auth/types.ts`): sign in, verify password, change password, create user |
| Adapters | `local` (scrypt against `users.passwordHash`) and `supabase` (Supabase Auth, linked by `users.supabaseUserId`) |
| Selection | `AUTH_PROVIDER=local\|supabase`; production defaults to Supabase, everything else to local |
| Session | HMAC-SHA256 signed token in an `HttpOnly`, `SameSite=Lax`, `Secure`-in-production cookie; 7-day TTL, no "remember me" |
| RBAC | `requireStaff()` on every page, `requirePermission(code)` in every action; permissions resolved from `user_roles → role_permissions → permissions` |
| Lockout | 5 failed attempts → 15-minute lock, stored on the user row and shared by both adapters |
| Audit | `auth.login.succeeded`, `auth.login.failed`, `auth.logout`, `auth.password.changed`, `auth.pin.changed` |
| First login | Seed sets `mustChangePassword`; every console page redirects to `/account/password` until a new password is saved |
| Manager PIN | Six digits, pepper (`MANAGER_PIN_PEPPER`), rejects repeated digits and sequences; requires the current password to change |
| Screens | `/login`, `/account/password`, `/dashboard`, `/profile` — mobile-first, Bangla + English |

### Verified here (executed)

```text
npm test                     → 9/9
  session token round-trip, tamper, expiry, future-dated rejection
  password policy + manager PIN policy
  PIN pepper hashing (correct PIN true, wrong PIN false)
  scrypt salting and verification
  CASHIER permissions resolved from the database (pos.write yes, role.write no)
  sign-in success, failed-attempt counter, lock after five, lock refuses even the correct password
  unknown email returns the same message as a wrong password

npm run verify:auth          → 9/9  (against `next start`, real HTTP)
  login page 200 for anonymous visitors
  /dashboard without cookie → /login
  tampered cookie → /login
  signed cookie → dashboard 200
  /profile renders account facts
  signed-in visitor is sent away from /login
  forced password change redirects /dashboard and /profile
  /account/password reachable while the change is pending
  suspended account loses access immediately

Browser run (Chromium, real form submits)
  login with temporary password → /account/password
  new password saved → /dashboard
  manager PIN 482913 saved → hash verifies, 123456 does not
  audit rows: login.succeeded, password.changed, pin.changed
  sign out → /login, cookie cleared

npm run typecheck   → clean
npm run lint        → clean
npm run build       → clean
```

### Production bug found and fixed

`src/lib/db.ts` cached the Prisma client on `globalThis` only when
`NODE_ENV !== "production"`. In a production build that created a **new client
and connection pool on every property access**, which exhausted connections
within a few requests (`Connection terminated unexpectedly`, HTTP 500 on
`/profile`). The client is now always cached per process, and the production
server shows zero Prisma errors during the full verification run.

### Design decisions locked in this module

1. **One session mechanism for both adapters.** Supabase is the credential
   store, not the session store: the app issues its own signed cookie bound to
   `users.id`. Revocation still works because every request re-reads
   `users.status` and `deletedAt`.
2. **Guards live in pages and actions, not in a proxy.** Next 16 renders a
   layout and its page in parallel; a redirect thrown from the layout aborts a
   page query mid-flight. The layout only redirects anonymous visitors, and each
   page calls `requireStaff()`.
3. **Users are soft-deleted.** `audit_logs` is append-only (enforced by a
   trigger), so `ON DELETE SET NULL` on `audit_logs.actorUserId` makes a hard
   delete of a user fail. That is correct: use `deletedAt` + `SUSPENDED`.
4. **Login errors never distinguish** unknown email, wrong password or missing
   password hash — same message, same timing (a dummy scrypt run).
5. **Account state is checked after the password**, so a wrong password cannot
   reveal whether an account is suspended.

## Module 3 — catalog and zero-transform media

| Area | Detail |
| --- | --- |
| Storage port | `StorageAdapter` (`src/lib/adapters/storage/types.ts`): `put`, `inspect`, `open`, `publicUrl`, `remove` |
| Adapters | `local` (immutable files under `.data/media`) and `supabase` (Supabase Storage, `upsert: false`) |
| Selection | `STORAGE_PROVIDER=local\|supabase`; production defaults to Supabase, everything else to local |
| Upload path | Server action → validate → write immutable random key → **re-read** and compare SHA-256 + size → `media_assets` |
| Validation | Declared MIME **and** magic bytes must agree; JPEG/PNG/WebP/AVIF only; SVG/PDF rejected for the gallery; 20 MB cap |
| Zero transform | Bytes are never resized, recompressed, cropped, re-encoded or EXIF-stripped; `isZeroTransform` is stored |
| Dedupe | Identical bytes reuse one `media_assets` row; the product link is unique per asset and role |
| Keys | `gallery/YYYY/MM/{uuid}.{ext}` — random, immutable, never overwritten |
| Serving | `/media/[...key]` streams originals with `Cache-Control: public, max-age=31536000, immutable` and a SHA-256 `ETag` |
| Catalogue | Categories (VAT rate), products, variants, publish/unpublish, archive (soft), gallery upload/remove/primary |
| Money | Integer-paisa VAT-inclusive math with half-up rounding (`src/lib/catalog/pricing.ts`) |
| Cost hiding | A DTO serializer removes `costPrice` unless the caller has `account.read` or `report.read` |
| Permissions | Pages use `requirePagePermission` (redirects to `/forbidden`); actions use `requirePermission` |
| Audit | `catalog.product.*`, `catalog.variant.*`, `catalog.category.*`, `catalog.media.*` |

### Verified here (executed)

```text
npm test                     → 18/18
  (module 2's 9 plus)
  magic bytes identify JPEG/PNG/WebP/AVIF and reject SVG, PDF and empty files
  upload validation enforces MIME agreement, size cap, filename safety, checksum
  storage keys are random, dated and unique
  SHA-256 is stable against a known vector
  VAT-inclusive paisa math rounds half-up; unit cost keeps four decimals
  PNG/JPEG dimensions are read without decoding or rewriting
  local adapter refuses overwrites and path traversal, reports true bytes
  gallery service stores original bytes and reuses identical uploads
  cost prices are stripped from DTOs for roles without accounting access

npm run verify:catalog       → 8/8  (against `next start`, real HTTP)
  anonymous visitors are redirected from /products
  owner sees the product list and /products/new
  owner sees the cost price; cashier never does
  cashier is redirected to /forbidden from a write-only screen
  /media serves original bytes with immutable caching
  conditional request (If-None-Match) → 304
  unknown media key → 404
  served SHA-256 equals the uploaded checksum

npm run verify:auth          → 9/9  (re-run after module 3)
npm run verify:invariants    → 10/10
npm run typecheck / lint / build → clean
```

Browser run (Chromium, real form submits):

```text
create product (Bangla name, VAT-inclusive price, cost price) → detail page
publish → status ACTIVE · live
upload the 70-byte original PNG → served bytes SHA-256 equal:
  c414cd0e204de974f73753c7e28d7638e7b3691bb8b1a2bab6b25bb7fed7ce77
upload the same file again → "That image is already in this product's gallery."
audit rows: catalog.product.created, catalog.product.published, catalog.media.linked
test data removed afterwards: 0 products, 0 media assets, 0 product media
```

### Design decisions locked in this module

1. **Direct server upload, not presigned PUT.** A server action receives the
   bytes, validates them and writes them through the adapter. Presigned uploads
   can be added later without changing the port; the zero-transform guarantee
   already holds because the server re-reads and hashes what was stored.
2. **Verify after writing.** A checksum mismatch between the upload and the
   stored object deletes the partial object and fails the upload. That is the
   enforceable form of "the gallery serves the bytes the photographer sent".
3. **Random immutable keys.** No original filename is used as a key, so
   traversal, collisions and cache poisoning are structurally impossible.
4. **Unlink, never delete bytes.** Removing a gallery image deletes only the
   `product_media` link. The `media_assets` row and its bytes remain, so order
   history and review attachments can never dangle.
5. **Cost price is a serializer concern.** The UI also hides the field, but the
   server refuses to read or write cost fields for callers without accounting
   access, so a hand-crafted form post cannot set them.
6. **Publishing is separate from editing.** `product.write` edits;
   `product.publish` publishes; `product.delete` archives. A cashier can read the
   catalogue but cannot open the editor or the create screen.
7. **`requirePagePermission` for pages.** It redirects to a readable `/forbidden`
   screen instead of throwing, because production Next redacts server error
   messages and an error boundary could not distinguish a 403 from a crash.

### Production build note

Turbopack traced the whole project when it saw a filesystem path taken from an
environment variable. Every runtime path in the local storage adapter is marked
`/* turbopackIgnore: true */`; the build is now warning-free and the standalone
output stays small.

## Module 4 — CRM and CMS

| Area | Detail |
| --- | --- |
| Customers | Profile, type, tags, notes, addresses (default handling), block/unblock and soft delete; walk-in cash customer is read-only |
| Identity | One canonical mobile `+8801XXXXXXXXX`; the typed form is kept as `mobileRaw`; a change writes `customer_mobile_history` |
| Addresses | Division, district, upazila, area, street, postcode, type and default flag; first address becomes default automatically |
| Reviews | New reviews are `PENDING`; only `APPROVED` reviews affect `products.ratingAverage/ratingCount`; one review per customer per product |
| Review photos | Max 5 originals, stored through the same zero-transform media pipeline as `mediaType: REVIEW` |
| Moderation | Approve, reject (with reason) or hide; `review.approve` is separate from `review.write` |
| CMS | Markdown pages with English + Bangla bodies, type, excerpt, SEO fields, header/footer placement and sort order |
| Page lifecycle | `DRAFT → PUBLISHED → ARCHIVED`; publishing needs `content.publish`, archiving needs `content.delete`; slugs are kept |
| Public route | `/p/[slug]` serves only `PUBLISHED` pages; draft and archived return 404 |
| Markdown safety | Hand-written escape-first renderer (`src/lib/cms/markdown.ts`); links limited to http(s), mailto, relative and anchor URLs |
| Newsletter | Double opt-in: `PENDING` with a random 48-hex token, `SUBSCRIBED` only after `/newsletter/confirm`; `UNSUBSCRIBED`/`BOUNCED` suppress |
| Newsletter rules | Emails lowercased in code and enforced by `chk_newsletter_email_lower`; staff must record consent; no email is sent before confirmation |
| Permissions | `customer.*`, `review.*`, `content.*`, `newsletter.*`; cashier has customer read/write but none of the other three |
| Audit | `crm.customer.*`, `crm.review.*`, `cms.page.*`, `crm.newsletter.*` |

### Verified here (executed)

```text
npm test                     → 22/22
  (modules 2 and 3's 18 plus)
  BD mobile numbers normalise to +8801XXXXXXXXX and landlines are refused
  newsletter emails are lowercased; tokens are 48 hex characters and unique
  the Markdown renderer escapes HTML, drops javascript: links and protects external links
  product ratings count only APPROVED reviews and recompute to the right average

npm run verify:crm           → 8/8  (against `next start`, real HTTP)
  anonymous visitors are redirected from /customers
  owner sees /customers, /customers/new, /reviews, /reviews/new, /pages, /pages/new, /newsletter
  customer detail shows the tag and saved address
  cashier can read customers but is redirected to /forbidden from /reviews, /pages/new and /newsletter
  the pending review is visible to the owner and remains PENDING
  a draft page is 404, a published page is 200 with escaped HTML, an archived page is 404
  newsletter confirmation completes double opt-in exactly once; a bad token is refused
  approving the review updates the product rating

npm run verify:auth          → 9/9  (re-run after module 4)
npm run verify:catalog       → 8/8  (re-run after module 4)
npm run verify:invariants    → 10/10
npm run typecheck / lint / build → clean (25 routes)
```

Browser run (Chromium, real form submits):

```text
owner signs in → Customers → New customer (name, 01712-345678, email, tags vip/dhaka)
detail page → add default address (Mirpur, Dhaka) → "Address added."
add pinned note → "Note added."; tag, mobile, address and note all render
Reviews → Record a review (5 stars, title, body) → "Review saved and waiting for moderation."
/reviews?status=PENDING shows it → Approve → PENDING count 0, APPROVED count 1
Pages → New page (policy, English + Bangla Markdown, footer) → DRAFT
/p/return-refund-policy → 404 before publish
Publish → PUBLISHED; public page 200, Bangla body renders, <script> appears as escaped text
Newsletter → add address + consent → confirmation link → "Subscription confirmed"
/subscribed list shows SUBSCRIBED; opening the same link again says "Already subscribed"
cashier signs in → nav hides Reviews/Pages/Newsletter; all three URLs → /forbidden
audit rows: crm.customer.created, address_added, note_added, review.submitted,
            review.approved, newsletter.pending, cms.page.created, cms.page.published
cleanup: 0 products, 0 reviews, 0 pages, 0 subscribers; only the seeded walk-in customer remains
```

### Design decisions locked in this module

1. **Mobile is the customer key.** Duplicate detection, order lookup and
   WhatsApp all use one canonical form. The original typed string is kept for
   display, and a change is written to `customer_mobile_history`.
2. **Customers and pages are never hard-deleted.** Customers are soft-deleted
   (`deletedAt` + `BLOCKED`); pages are archived and keep their slug.
3. **Reviews are draft-like.** Every entry starts `PENDING`. Only `APPROVED`
   rows affect the product score, and moderation recomputes the aggregate in the
   same request.
4. **Photos reuse the media pipeline.** Review images are originals with
   `mediaType: REVIEW`, validated and checksum-verified exactly like gallery
   images; the link table is capped at five rows per review in the action.
5. **No Markdown dependency.** The CMS uses a small escape-first renderer that
   only emits tags it creates. That keeps stored content from becoming HTML and
   avoids pulling a new package into the production surface.
6. **Publishing is a separate permission.** `content.write` edits a draft;
   `content.publish` makes it public; `content.delete` archives it. A cashier
   cannot reach any of those screens.
7. **Public pages are dynamic.** `/p/[slug]` reads the database on each request,
   so unpublishing takes effect immediately; a cached public page could keep
   serving text the owner has withdrawn.
8. **Double opt-in is enforced in the data model.** A new address is `PENDING`
   with a unique token; only the confirm route flips it to `SUBSCRIBED`. Staff
   adding an address cannot bypass the confirmation step.
9. **Consent is recorded.** The console requires a consent checkbox and stores
   the consent text and source alongside the address.
10. **The newsletter sender is not wired yet.** The confirmation link is shown
    in the console so the flow can be tested; transactional email connects with
    the Resend adapter in a later module.



`prisma db seed` does not reliably pass `NODE_ENV` through to the seed script, so
the guard does not depend on it. Instead it inspects the connection string:

| Target | Behaviour |
| --- | --- |
| `localhost` / `127.0.0.1` | allowed; development owner is created (`owner@bgd26.com` / `Bgd26!ChangeMe`, PIN `123456`) |
| any remote host | refused unless `SEED_ALLOW_PROD=true` **and** `SEED_OWNER_PASSWORD` are set |

Empty values in `.env.local` (`SEED_OWNER_PASSWORD=`) count as "not set", so a
blank line never becomes an empty password.

## Phase 3, module 1 — inventory engine

| Area | Detail |
| --- | --- |
| Balances | One `inventory_balances` row per variant × warehouse; `available = physical − reserved − damaged − quarantined − inProduction` is enforced by a deferred DB trigger |
| Costing | Moving average (AVCO) at 4 decimals, quantities at 3 decimals, money at 2 decimals, half-up rounding (`src/lib/inventory/decimal.ts`) |
| Ledger | `stock_ledger` is append-only at the database level (`trg_stock_ledger_immutable`); a correction is a new movement |
| Concurrency | `SELECT … FOR UPDATE` on the balance row inside one transaction per document; document status, balance, ledger row and cost history commit together |
| Opening stock | Posted immediately by `inventory.approve`; allowed once per variant × warehouse, sets the first AVCO, writes an `OPENING_BALANCE` row |
| Adjustments | `INCREASE`, `DECREASE`, `DAMAGE`, `QUARANTINE`, `WRITE_OFF`; drafted by `inventory.write`, posted or voided by `inventory.approve`; only drafts can be voided |
| Damage rules | Damage and quarantine keep physical stock unchanged while available falls; write-off consumes damaged units first, then sellable units, never reserved stock |
| Transfers | `DRAFT → IN_TRANSIT → RECEIVED`; send posts `TRANSFER_OUT`, receive posts `TRANSFER_IN` at the exact source AVCO; cancelling a draft moves nothing, cancelling in transit posts a compensating `TRANSFER_IN` back to the source |
| Warehouses | Create/edit/activate/deactivate; a default or stocked warehouse cannot be deactivated until another default is set and the stock is moved out |
| Non-stock | `NON_STOCK`, `SERVICE` and `DROPSHIP` variants bypass balances and the ledger; they are refused by inventory documents |
| Cost hiding | Stock value and AVCO are rendered only for `account.read` or `report.read`; cashiers see quantities only |
| Screens | `/inventory`, `/inventory/[variantId]`, `/inventory/warehouses[/id]`, `/inventory/opening`, `/inventory/adjustments[/new|/id]`, `/inventory/transfers[/new|/id]` |
| Audit | `inventory.warehouse.*`, `inventory.opening.posted`, `inventory.adjustment.*`, `inventory.transfer.*` |
| Deferred | Purchase orders, goods-received notes, supplier bills and stock reservations belong to Phase 3 module 2; `RECOUNT` and cycle counts are intentionally not exposed yet |

### Verified here (executed)

```text
npm test                     → 29/29
  (modules 2–4's 22 plus)
  AVCO blends receipts (10 @ 100 + 10 @ 200 → 150) and damage/write-off keep the
    balance projection exact
  a draft adjustment changes nothing until a manager posts it; voided drafts never post
  a transfer posts out on send and in on receive at the same unit cost
  cancelling an in-transit transfer returns the stock to the source
  insufficient stock, non-stock variants and a second opening entry are refused
  a warehouse holding stock cannot be deactivated
  the stock ledger refuses updates at the database level
  every scenario runs in a rolled-back transaction because the ledger is append-only

npm run verify:inventory     → 9/9  (against `next start`, real HTTP)
  opening stock + transfer + damage produced the expected balances and AVCO
  anonymous visitors are redirected from /inventory
  owner sees every inventory screen (balances, detail, warehouses, opening,
    adjustments, transfers)
  stock detail shows both warehouses, every movement type and the append-only ledger
  adjustment and transfer documents show their posted state
  the opening stock list contains this run
  cashier sees quantities but never stock value, AVCO value or unit cost
  cashier is redirected to /forbidden from opening, adjustment and transfer screens
  owner can still reach every stock-changing screen

npm run verify:crm           → 8/8   (re-run after module 1)
npm run verify:auth          → 9/9   (re-run after module 1)
npm run verify:catalog       → 8/8   (re-run after module 1)
npm run verify:invariants    → 10/10
npm run typecheck / lint / build → clean (36 routes)
```

Browser run (Chromium, real form submits):

```text
owner signs in → Opening stock (BROWSER-INV-A, 10 @ ৳100) → stock detail shows 10/10
Transfers → New transfer A → B, 4 units → DRAFT, stock unchanged
Send transfer → IN TRANSIT, TRANSFER_OUT −4, A balance after 6
Receive transfer → RECEIVED, TRANSFER_IN +4 at ৳100, B balance after 4
Adjustments → DAMAGE 2 units at A → DRAFT → Post adjustment → POSTED
stock detail: A physical 6 / available 4 / damaged 2; B physical 4 / available 4;
  total physical 10 / available 8 / held 2; AVCO ৳100 everywhere
ledger (newest first): DAMAGE −2, TRANSFER_IN +4, TRANSFER_OUT −4, OPENING_BALANCE +10
cashier signs in → quantities and damaged counts visible, no stock value, no AVCO
  value, no unit cost; /inventory/opening → /forbidden
audit rows: inventory.opening.posted, transfer.created/sent/received,
            adjustment.created/posted
cleanup: variant and product archived, both test warehouses deactivated, test
  users suspended; ledger history retained by design
```

### Design decisions locked in this module

1. **The balance row is a projection, not the truth.** Every movement locks the
   row `FOR UPDATE`, writes the new projection and appends a ledger row in the
   same transaction. The database trigger re-checks
   `available = physical − reserved − damaged − quarantined − inProduction`, so a
   buggy code path cannot persist impossible numbers.
2. **The ledger is the audit trail.** `stock_ledger` rows can never be updated or
   deleted; a mistake is corrected by a new adjustment. Only `DRAFT` documents
   can be voided, and a voided draft never touched stock.
3. **Opening stock is once per pair.** A second opening for the same variant and
   warehouse would double-count history, so it is refused; later corrections use
   an adjustment. This keeps the first AVCO defensible.
4. **AVCO is 4 decimals.** Quantity is 3 decimals and money is 2, with half-up
   rounding. Rounding once at the money boundary avoids cumulative drift while
   still supporting weighed goods and fractional units.
5. **Transfers move in two steps.** Send posts stock out of the source; receive
   values it into the destination at the exact source cost. Stock in transit is
   deliberately absent from both warehouses, and cancelling in transit returns
   it with a compensating ledger row rather than deleting the first leg.
6. **Damage is a hold, not a disappearance.** Physical stock stays; damaged or
   quarantined stock is subtracted from available. Write-off removes damaged
   units first, then sellable units, and never consumes reserved stock.
7. **Drafting and posting are separate permissions.** `inventory.write` creates
   drafts; `inventory.approve` posts them. A cashier can read balances and
   documents but cannot change stock.
8. **Cost visibility is server-side.** Stock value, AVCO and unit cost are
   omitted from the response for roles without `account.read` or `report.read`,
   not merely hidden with CSS.
9. **Warehouse deactivation is guarded.** A warehouse cannot be deactivated while
   it is the default or still holds stock; the stock must be transferred out
   first, which preserves the balance history.
10. **Purchasing is module 2.** This module accepts stock only through opening
    stock, adjustments and transfers. Purchase orders, GRNs and supplier bills
    come next, so the ledger already has `PURCHASE_RECEIPT` and the schema is
    ready.

## Phase 3, module 2 — suppliers, purchase orders and goods received

| Area | Detail |
| --- | --- |
| Scope | Suppliers, purchase orders and goods-received notes (GRN). Supplier bills, purchase payments and purchase returns are deferred until the accounting journals exist. |
| Suppliers | Code, English/Bangla name, contact, canonical BD mobile, email, address, division/district, payment terms, lead time, dropship flag, notes. Status is `ACTIVE`, `INACTIVE` or `BLACKLISTED`; suppliers are never deleted. |
| Purchase orders | `STANDARD` orders with one warehouse, expected date, discount, shipping, per-line tax and landed cost. `DRAFT → SENT → PARTIALLY_RECEIVED → RECEIVED`, plus `CANCELLED` and `CLOSED`. Only a draft can be edited, and only while no live GRN exists. |
| GRN | `DRAFT → POSTED`, or `CANCELLED` while still a draft. Posting claims the document, locks the ordered lines `FOR UPDATE`, re-checks outstanding quantity, appends `PURCHASE_RECEIPT` movements and advances the PO. A posted GRN is immutable. |
| Landed cost | The GRN line's `unitCost` enters AVCO; the receiver may raise it above the ordered cost for freight, duty or handling. The PO keeps the ordered cost. |
| Damaged/quarantined receipt | Posts `PURCHASE_RECEIPT` then `DAMAGE` or `QUARANTINE`, so physical stock rises while available stock does not. |
| Draft reservation | A draft GRN subtracts its quantities from the receive form's outstanding list, so two drafts cannot promise the same unit. Over-receipt is refused at create and again at post. |
| Permissions | `purchase.read` views; `purchase.write` drafts suppliers, orders and GRNs; `purchase.approve` sends, cancels, closes and posts. Cashiers have no purchasing access; accountants read only. |
| Screens | `/suppliers[/new|/id]`, `/purchases[/new|/id]`, `/purchases/[id]/receive`, `/purchases/grn[/id]`; `PurchaseNav` on every screen; admin nav entry “Purchases” behind `purchase.read`. |
| Audit | `purchase.supplier.created/updated/status`, `purchase.order.created/updated/sent/cancelled/closed`, `purchase.grn.created/posted/cancelled`. |
| Deferred | Supplier bills, purchase payments, purchase returns and a full landed-cost allocation table. `StockMovementType` has no `PURCHASE_RETURN`, so returns also need a migration. |

```text
npm test                    → 35/35 (29 existing + 6 purchasing; rolled-back transactions)
npm run verify:purchasing   → 9/9  (against `next start`, real HTTP)
  partial, damaged and final receipts produced the expected stock and AVCO
  anonymous visitors are redirected from /purchases and /suppliers
  owner sees every purchasing screen (orders, new, detail, receive, GRNs, suppliers)
  purchase order shows lines, totals, received quantity and its receipts
  each goods receipt shows condition, landed cost, ledger rows and posted state
  supplier page links its purchase orders
  goods-received list contains this run
  accountant can read purchases but cannot raise or receive (new/receive → /forbidden)
  cashier is redirected from every purchasing screen

npm run verify:inventory    → 9/9   (re-run after module 2)
npm run verify:crm          → 8/8   (re-run after module 2)
npm run verify:auth         → 9/9   (re-run after module 2)
npm run verify:catalog      → 8/8   (re-run after module 2)
npm run verify:invariants   → 10/10
npm run typecheck / lint / build → clean (44 routes)
```

Browser run (Chromium, real form submits):

```text
owner signs in → Suppliers → New supplier BSUP-019D6F (terms 15 days)
Purchases → New order, BROWSER-PUR warehouse, 10 units @ ৳100 → DRAFT, ৳1,000
Send order → SENT
Receive goods → 4 units @ ৳100, condition GOOD → draft GRN, stock unchanged
Post receipt → POSTED; stock 4 physical / 4 available / AVCO ৳100;
  PO becomes PARTIALLY_RECEIVED; ledger PURCHASE_RECEIPT +4
Receive remaining 6 @ ৳150 landed cost → post → stock 10 / 10,
  AVCO ৳130, stock value ৳1,300; PO becomes RECEIVED
inventory detail ledger: PURCHASE_RECEIPT +6 at ৳150, PURCHASE_RECEIPT +4 at ৳100
accountant signs in → reads orders and receipts, no New order / Send / Receive;
  /purchases/new, /purchases/[id]/receive and /suppliers/new → /forbidden
cashier signs in → no Purchases nav; /purchases, /suppliers and /purchases/grn
  → /forbidden
audit rows: purchase.supplier.created, order.created/sent, grn.created/posted ×2
cleanup: variant archived, warehouse deactivated, supplier set INACTIVE, test
  users suspended; purchase and ledger history retained by design
```

### Design decisions locked in this module

1. **Only a posted GRN moves stock.** A purchase order is a promise and a draft
   GRN is a counted delivery; neither touches balances. This keeps the stock
   ledger aligned with physical custody.
2. **The receipt carries the landed cost.** Per-delivery unit cost, not the
   ordered cost, enters AVCO. Freight, duty and handling therefore reach the
   moving average without a separate allocation table.
3. **Outstanding quantity is checked twice.** `createGrn` subtracts existing
   drafts; `postGrn` locks the ordered lines and re-checks. Two receivers cannot
   consume the same last unit.
4. **Damaged goods still arrive.** The receipt posts first, then the hold. The
   ledger shows both the value received and the reason it is not sellable.
5. **Documents are immutable once committed.** A posted GRN cannot be cancelled
   or edited; a correction is a purchase return. The schema deliberately lacks a
   `PURCHASE_RETURN` movement type, so returns wait for a migration rather than
   being faked as an adjustment.
6. **Drafting and approval stay separate.** `purchase.write` prepares, and
   `purchase.approve` commits. Accountants read purchasing without being able to
   raise or receive; cashiers see nothing in the module.
7. **Suppliers are status, not rows to delete.** `INACTIVE` and `BLACKLISTED`
   preserve every order and receipt that references them.
8. **The receive form is server-computed.** Outstanding quantities come from the
   database, not from a number typed into the browser, so a stale tab cannot
   over-receive.

## Phase 3, module 3 — POS, orders, payments and refunds

| Area | Detail |
| --- | --- |
| Scope | Counter devices, shifts, the offline-first till, orders, the separate payment lifecycle, refunds and cash reconciliation. Courier dispatch, loyalty and journals are deferred. |
| Money model | B2C prices are VAT-inclusive. Per line: `gross = unitPrice × qty`, `vat = gross × rate/(100+rate)` (VAT before discount), `lineSubtotal = gross − vat`, `discount` allocated proportionally with the remainder on the last line, `lineTotal = gross − discount`. The order stores `subtotal = Σ lineSubtotal`, `vatTotal = Σ vat`, `grandTotal = subtotal + vat − discount + delivery`, which is exactly what `chk_order_totals` enforces and what the customer pays. |
| Till | `/pos` searches SKU, barcode or product name (server index, no cost price in the response), caches a bounded catalogue in `localStorage`, queues sales in `localStorage` when the network drops and replays them with the same `clientTransactionUuid`. A queued sale is never rejected. |
| Discount cap | 5 % of the gross sale value is a cashier's own authority. Anything above it, and any walk-in cash sale, needs a manager PIN verified against an active user holding `order.approve`. An offline sale cannot present a PIN, so it is accepted with `approvalDeferred` and an `order.offline.approval_required` audit row instead of being refused. |
| Payments | Cash is `PAID` at the drawer (`CASH_DRAWER`). Every digital method (bKash, Nagad, card, bank transfer) stays `PENDING_VERIFICATION` until a manager verifies it with `payment.approve`; rejection marks it `FAILED`. `paidAmount` counts only `PAID`, so an order is `PENDING_VERIFICATION` while any digital payment waits. |
| Stock | Stock leaves once per `STOCKED` line as a `SALE` movement when the sale is created. `allowNegative` is passed only for `POS_OFFLINE`, so an offline sale may drive a balance negative and a manager reconciles it later. Cancelling restocks at `costPriceSnapshot` via `SALE_RETURN`; non-stock lines never move stock. |
| Idempotency | `orders.clientTransactionUuid` is unique. A replay returns the existing order with `duplicate: true` (and a `P2002` race is caught the same way), so a flaky connection cannot double-sell. |
| Refunds | `REQUESTED → APPROVED → COMPLETED`, or `REJECTED`. Requesting moves nothing; approval restocks the ticked lines as `SALE_RETURN` at the sale-time cost; completing settles the order to `REFUNDED`. Partial quantities are tracked on `order_items.refundedQty`. |
| Shifts | `OPEN → CLOSED`, with an opening float, cash in/out/drop movements, expected drawer, counted cash and a signed variance. A second close is refused. |
| Permissions | `order.read/write/approve`, `pos.read/write/approve`, `payment.read/write/approve`, `refund.read/write/approve`. A cashier runs the till and can request a refund but cannot read the refund list or approve anything; an accountant reads orders, payments and refunds but cannot open the till. |
| Screens | `/pos`, `/pos/devices`, `/pos/shifts`, `/orders`, `/orders/[id]`, `/payments`, `/refunds`; `PosNav`/`OrdersNav` on every screen; admin nav entries POS till, Orders and Payments. |
| API | `/api/pos/search` and `/api/pos/catalog` answer 401 anonymously, 403 without `pos.read`, and never return cost price. |
| Audit | `order.created`, `order.offline.approval_required`, `order.status.changed`, `order.cancelled`, `payment.verified`, `payment.rejected`, `refund.requested/approved/completed`, `shift.opened/closed`. |
| Deferred | Courier dispatch and shipping labels, loyalty accrual/redemption, WhatsApp order notifications, and the double-entry journals these events will post to. |

```text
npm test                 → 48/48 (35 existing + 13 sales; rolled-back transactions)
npm run verify:orders    → 13/13 (against `next start`, real HTTP)
  anonymous visitors are redirected from /pos, /orders, /payments, /refunds; POS API 401
  POS search returns sellable variants, price and VAT, and no cost price
  accountant reads orders/payments/refunds, /pos* → /forbidden, POS API 403
  cashier sees the till and sells; /refunds → /forbidden
  order list and detail show the cash sale, its VAT and CASH DRAWER payment
  an offline sale is stored, flagged "approval deferred" and marked POS OFFLINE
  the payment queue shows the digital payment and hides Verify from a cashier
  verifying the payment marks the order PAID
  a requested refund is visible, approval restocks +2, completion sets COMPLETED
  the shift reconciles to ৳615 with ৳0 variance
  the shift sale is linked to its order
  the order detail offers status actions to a writer and none to an accountant
  stock left exactly once per stocked line (4 SALE rows, balance 17)

npm run verify:inventory    → 9/9    (re-run after module 3)
npm run verify:purchasing   → 9/9    (re-run after module 3)
npm run verify:auth         → 9/9    (re-run after module 3)
npm run verify:catalog      → 8/8    (re-run after module 3)
npm run verify:crm          → 8/8    (re-run after module 3)
npm run verify:invariants   → 10/10
npm run typecheck / lint / build → clean (53 routes)
```

Browser run (Chromium, real form submits, 18 Nov 2026):

```text
owner signs in → /pos/shifts → opens SHIFT-20261117-4F8565 with a ৳500 float
search BROWSER-POS-MUG-V1 → stock 30 → add to cart (৳115 = ৳100 + ৳15 VAT)
customer 01712345678 → Pay full → Complete sale → SO-20261118-B6049B, PAID
  → /orders shows it CONFIRMED/PAID; detail shows VAT ৳15, CASH DRAWER by owner
৳10 discount (8.7 %) → Complete sale is blocked with "A discount above 5 % needs
  a manager PIN"; PIN 111111 → server answers "That manager PIN is not valid."
  PIN 246810 → SO-20261118-B8F8FC: subtotal ৳100 + VAT ৳15 − discount ৳10 = ৳105
blank mobile → walk-in cash with PIN 246810 → SO-20261118-7B6AD3, isWalkInCash
bKash ৳115 with reference BKASH-GATE-0001 → SO-20261118-8B1953 stays
  PENDING_VERIFICATION → /payments shows it → Verify → PAID
refund 1 × mug with restock → REF-20261118-8F6362 → Approve & restock → Complete
  payout → order REFUNDED; stock 30 − 4 sales + 1 return = 27; ledger SALE_RETURN +1
shift closed: expected ৳835, counted ৳835, variance ৳0
cashier signs in → till, devices, shifts, orders and payments work; /refunds
  → /forbidden; no Cancel on an order; no device-registration form
accountant signs in → orders/payments/refunds read-only, no Verify, no Move to;
  /pos, /pos/devices, /pos/shifts → /forbidden
cleanup: variant archived, device revoked, warehouse/store/category deactivated,
  shift closed, temp users suspended; sales and ledger history retained
```

### Design decisions locked in this module

1. **The server always re-prices.** The till computes a preview for the cashier;
   `createSale` re-reads price, VAT and fulfilment type and recalculates. A
   tampered browser payload cannot change what is stored.
2. **VAT is taken before the discount.** That keeps `subtotal + vat − discount`
   equal to the amount charged, which is the only shape `chk_order_totals`
   accepts, and it matches how B2C receipts are written in Bangladesh.
3. **A queued sale outranks a rule.** An offline terminal cannot verify a PIN, so
   the sale is stored, flagged `approvalDeferred`, audited, and reviewed later.
   Refusing it would lose a real customer's money.
4. **Stock leaves at the sale, not at delivery.** A counter sale is physical
   custody moving immediately; delivery status is a separate lifecycle.
5. **Digital money is never assumed.** bKash, Nagad, card and bank transfers stay
   `PENDING_VERIFICATION` until a manager verifies them, and `paidAmount`
   ignores anything that is not `PAID`.
6. **Cash is verified at the drawer.** A cash payment is `PAID` immediately with
   `CASH_DRAWER` as its verification method, because the cashier can see it.
7. **Refunds are a three-step document.** Request, approve (restock at the
   sale-time cost), complete (settle). Stock only moves on approval, and the
   ledger row is never edited.
8. **Idempotency is a database constraint.** `clientTransactionUuid` is unique,
   so retries and double taps collapse to one order even under a race.
9. **A PIN never touches disk.** Queued offline payloads are stored with
   `managerPin: null` and `source: "POS_OFFLINE"`, so a shared till cannot leak a
   manager's PIN.
10. **The till has no cost price.** The search and catalogue APIs omit margin so
    a cashier cannot read supplier cost from the browser.

## Phase 3, module 4a — double-entry accounting journals

| Area | Detail |
| --- | --- |
| Scope | The journal engine, chart of accounts, expenses, trial balance, account ledger and manual reversal. Every stock, sales, purchasing and payment event posts through one function. Supplier bills, purchase payments and purchase returns (deferred from module 2), transfer fees, production journals and dropship COGS stay for a later slice. |
| Engine | `src/lib/accounting/journal.ts`: `postJournal` normalises lines to 2 dp, rejects negative or two-sided lines, requires an OPEN fiscal period covering the entry date, resolves account codes, writes the entry `DRAFT`, inserts the lines, then flips it to `POSTED` in the same transaction. `reverseJournal` mirrors a posted entry; `reverseJournalsForReference` unwinds every live entry for one document. |
| Immutability | `trg_journal_balanced` rejects a posted entry whose debit ≠ credit or whose total is zero. `trg_journal_immutable` and `trg_journal_line_immutable` reject every later UPDATE or DELETE of a posted entry or its lines. A correction is always a new entry: `reversalOfId` is unique, the original stays `POSTED`, and `JournalEntryStatus.REVERSED` is deliberately unused. |
| Sale posting | One entry per sale: DR Accounts Receivable (grand total), DR Sales Discounts, DR COGS; CR Product Sales (subtotal), CR VAT Payable, CR Delivery Revenue, CR Inventory. The entry is traceable to the order through `referenceType = "order"`. |
| Payment posting | A cash receipt posts DR Cash on Hand / CR Accounts Receivable against `referenceType = "payment"` at sale time. A digital payment posts nothing until a manager verifies it; verification then posts DR bKash/Nagad/Card/Bank / CR Accounts Receivable. |
| Cancel and refund | Cancelling reverses the order entry and every `PAID` payment entry. Refund approval posts DR Inventory / CR COGS at the sale-time cost. Completion posts DR Sales Returns + DR VAT Payable / CR the payment account for the amount actually paid out. |
| Purchasing and stock | A posted GRN posts DR Inventory / CR Accounts Payable at the landed value, with the supplier on the credit line. Opening stock posts DR Inventory / CR Owner's Equity. An adjustment increase posts DR Inventory / CR Inventory Shrinkage and every decrease the mirror; a warehouse transfer posts no journal because value stays inside inventory. |
| Expenses | A draft expense touches no account. Posting debits the expense account and Input VAT Receivable and credits cash, bank or the payment account (optionally tagged to a supplier). A posted expense is voided by reversal, never edited. |
| Read models | `trialBalance` aggregates only POSTED lines, grouped by account and filtered by fiscal period or date; totals must agree. `accountLedger` walks an account in its natural direction and returns a running balance. |
| Permissions | `account.read/write/approve` and `expense.read/write/approve`. An accountant reads and writes the books but still cannot open the till; a cashier has no accounting access and is redirected to `/forbidden`. |
| Screens | `/accounting` (trial balance), `/accounting/accounts`, `/accounting/accounts/[id]` (ledger), `/accounting/journals`, `/accounting/journals/[id]` (detail + reversal), `/accounting/expenses`; `AccountingNav`; admin nav entry behind `account.read`. |
| Audit | `account.created/activated/deactivated`, `expense.created/posted/voided`, `journal.reversed`. |

```text
npm test                  → 60/60 (48 existing + 12 accounting; rolled-back transactions)
npm run verify:accounting → 12/12 (against `next start`, real HTTP)
  anonymous visitors are redirected from every /accounting* screen to /login
  a cashier is redirected to /forbidden and sees no Accounting nav entry
  an accountant reads the trial balance, accounts, ledger, journals and expenses
  the trial balance totals agree and the page shows a ৳0.00 difference
  sale, cash receipt, verified bKash, refund restock, refund payout, GRN,
  opening stock, shrinkage, expense and a manual reversal all appear
  the sale entry is balanced and traceable to its order
  a voided expense and a reversed manual entry show "Reversed by", never an edit
  the cash ledger shows the drawer movement and a real closing balance
  the books still balance after the reversal, with the run's cash net at −৳885

npm run verify:orders       → 13/13  (re-run after module 4a)
npm run verify:inventory    → 9/9    (re-run after module 4a)
npm run verify:purchasing   → 9/9    (re-run after module 4a)
npm run verify:auth         → 9/9    (re-run after module 4a)
npm run verify:catalog      → 8/8    (re-run after module 4a)
npm run verify:crm          → 8/8    (re-run after module 4a)
npm run verify:invariants   → 10/10
npm run typecheck / lint / build → clean (58 routes)
```

### Design decisions locked in this module

1. **One journal function, no side doors.** Sales, payments, refunds, goods
   receipts, stock adjustments, opening stock and expenses all call
   `postJournal`; no page or action writes journal rows directly.
2. **Entries are written before they are posted.** The line trigger rejects any
   insert into a posted entry, so the engine writes DRAFT, inserts lines, then
   posts — inside one transaction with the business document.
3. **The database owns the invariants.** Balance, non-zero totals and
   immutability are triggers, not service checks. A bug or a stray script cannot
   store an unbalanced or edited journal.
4. **Reversal replaces editing.** A posted entry keeps `POSTED` forever; the
   reversal is a new entry pointing at it. That is what makes the audit trail
   trustworthy and why `REVERSED` is never written.
5. **Receivable is the hinge.** Every sale debits receivable, and every receipt —
   cash or verified digital — credits it. An order is fully settled in the books
   only when receivable returns to zero for it.
6. **Digital money is not booked on trust.** A pending bKash payment is a claim,
   not an asset; the books see it only when a manager verifies it.
7. **Value follows stock.** GRNs, opening stock, adjustments and refunds post the
   same value the AVCO engine recorded, so inventory in the ledger and inventory
   on the shelf move together.
8. **Opening stock is equity, not income.** The first movement of a variant in a
   warehouse debits inventory against owner's equity, never revenue.
9. **Expenses are documents.** Draft, post, void. A void reverses the posted
   entry and keeps the document for the record.
10. **A fiscal period must be open.** Posting into a missing or locked period is
    refused, so a closed year cannot be changed by a late sale.

## Phase 3, module 4b — loyalty points (approved)

| Area | Detail |
| --- | --- |
| Scope | Earning, redemption, expiry, cancellation and refund claw-back, plus the manual adjustment and the two read screens. Coupons, tiers and segment-targeted campaigns stay for a later slice. |
| Earning | One point per complete ৳100 of **net merchandise** (`subtotal − discountTotal`: after discount, before VAT). Points accrue once per order when the payment becomes `PAID` (cash at the drawer, digital on verification) or the order reaches `COMPLETED`. A partial unique index (`uq_loyalty_earn_order`) makes a retried sale or a second verification idempotent. |
| Redemption | One point is worth ৳1. A sale may spend at most 20 % of its net merchandise, further limited by the live balance. The POS previews the balance and cap, and `createSale` re-reads both inside the sale transaction. A blocked customer, a soft-deleted customer and a walk-in cannot redeem. |
| Expiry | Points expire twelve months after they are earned. Because points are not kept in lots, the job treats the balance above the sum of still-live positive movements as old and expires exactly that. Running it twice cannot expire the same points twice. |
| Ledger | `loyalty_transactions` is append-only: signed `points`, `balanceAfter`, `expiresAt`, an optional order and a reference. `customers.loyaltyPointsBalance` is a cached projection. DB CHECKs forbid a negative balance, a zero movement and a movement whose sign contradicts its `type`; `uq_loyalty_redeem_order` allows one redemption per order. |
| Journals | Earn: DR 5500 Loyalty Expense / CR 1500 Loyalty Points Liability. Redeem: a DR 1500 line inside the sale entry (receivable is reduced). Expire and claw-back: DR 1500 / CR 5500. Manual grant: DR 5500 / CR 1500; a manual correction is the mirror. Loyalty journals use `source = "MANUAL"` with `referenceType = "loyalty_transaction"`. |
| Cancel and refund | Cancelling restores redeemed points without a second journal (the sale reversal already reverses the DR 1500 line) and claws back earned points. A refund reverses the earned share in proportion to the amount refunded, capped by the current balance so a spent point never creates a negative balance. |
| Offline rule | An offline sale never redeems (no live balance can be checked) but earns when it syncs and is paid. The till strips the points field and shows an offline note. |
| Permissions | No new resource. Reading the overview and ledger uses `customer.read`; manual adjustments and expiry use `customer.approve`; redemption is part of `order.write` through the sale. A cashier reads loyalty but cannot adjust points. |
| Screens | `/loyalty` (outstanding liability, holders, rules, recent movements, search), `/loyalty/[customerId]` (balance, earned/redeemed/expired totals, manual adjustment, expire button, full ledger); admin nav entry behind `customer.read`; the customer profile links to its ledger. |
| Audit | `loyalty.adjusted` and `loyalty.expired`, with points, resulting balance and transaction id. |

```text
npm test                 → 70/70 (60 existing + 10 loyalty; rolled-back transactions)
npm run verify:loyalty   → 9/9   (against `next start`, real HTTP)
  anonymous visitors are redirected from /loyalty to /login
  an accountant without customer.read is refused and sees no nav entry
  a cashier reads the overview and ledger but sees no adjustment form
  the owner sees the balance, the rules, the whole ledger and every movement type
  an expired customer shows an EXPIRE row and a zero balance
  the customer profile links to the loyalty ledger
  the POS preview answers 401, 403 and 200 and returns balance 434, max 200
  every movement (sale, earn, refund, adjustment, expiry) posted a balanced journal
  the accounting pages show the loyalty accounts and this run's entries

npm run verify:orders       → 13/13  (re-run after module 4b)
npm run verify:inventory    → 9/9    (re-run after module 4b)
npm run verify:purchasing   → 9/9    (re-run after module 4b)
npm run verify:auth         → 9/9    (re-run after module 4b)
npm run verify:catalog      → 8/8    (re-run after module 4b)
npm run verify:crm          → 8/8    (re-run after module 4b)
npm run verify:accounting   → 12/12  (re-run after module 4b)
npm run verify:invariants   → 10/10
npm run typecheck / lint / build → clean (61 routes)
```

### Design decisions locked in this module

1. **Points are a liability, not a discount pot.** Every point sits on the books
   as DR 5500 / CR 1500 until it is spent or expires, so the outstanding balance
   is visible in the trial balance instead of being an off-book promise.
2. **Net merchandise is the base.** Earning and the 20 % cap both use
   `subtotal − discountTotal`, so a discounted sale does not earn or spend points
   on value the customer never paid.
3. **Redemption rides in the sale entry.** The DR 1500 line sits inside the sale
   journal, which means a cancelled sale unwinds it automatically and no second
   entry can drift out of step.
4. **One earn and one redeem per order.** Partial unique indexes make a retried
   sale, a re-verification or a double-click unable to award or spend twice.
5. **The database refuses a negative balance.** A CHECK on both the cached
   balance and `balanceAfter`, plus a sign check per type, means a bug cannot
   invent points.
6. **Expiry is aggregate, not lot-based.** Points are fungible, so the job
   expires only the balance that no live movement still covers; that keeps it
   idempotent without a FIFO lot table.
7. **Claw-back is capped by the balance.** A refund or cancellation reverses at
   most the points the customer still holds, so a point already spent is never
   turned into a negative balance.
8. **Offline earns but cannot spend.** A queued sale has no reliable balance, so
   it never redeems; it still earns when it syncs and becomes paid.
9. **Loyalty borrows the customer permissions.** Points are part of the customer
   relationship, so the overview reads `customer.read` and adjustments need
   `customer.approve`; a cashier redeems only through a sale.
10. **The ledger is the source of truth.** `customers.loyaltyPointsBalance` is a
    cache for fast screens and the POS preview; every change is first a ledger
    row, and the cache is only ever moved with it.

## Phase 3, module 5a — public storefront and guest checkout (approved)

| Area | Detail |
| --- | --- |
| Scope | A public catalogue, product pages, a guest cart, coupon codes, delivery zones and a one-page guest checkout with cash on delivery or manual bKash/Nagad, plus order confirmation and mobile-based tracking. No customer login, no online loyalty redemption and no gateway adapters yet. |
| Data model | No new tables. The storefront reuses `carts`, `cart_items`, `coupons`, `coupon_redemptions`, `delivery_zones`, `orders`, `payments` and `order_items`. Migration `20261119150000_storefront` adds the CHECKs that keep cart totals, coupon discounts and delivery charges non-negative. The seed now creates nine delivery zones (Dhaka city and the divisions) idempotently. |
| Catalogue | Only `ACTIVE`, published, non-archived products are visible. Stock is read from the **default warehouse**, because that is where an online order ships from. Cost price, supplier data and internal notes are never selected, so they cannot leak into the HTML. A draft or archived slug returns 404. |
| Guest identity | There is no login. The mobile number identifies the customer: it is normalised to `+8801XXXXXXXXX` and an existing customer is reused, otherwise a retail customer is created inside the checkout transaction. The cart itself is anonymous. |
| Cart | The `bgd26_cart` cookie holds a random database token, `HttpOnly`, `SameSite=Lax`, `Secure` outside development, 30 days. Prices are always re-read from the catalogue; the stored `unitPrice` is a display snapshot. A cart is a soft hold only — stock is consumed at order confirmation, not while browsing. The header badge asks `/api/storefront/cart-count`, so catalogue pages stay cacheable. |
| Coupons | A coupon is quoted against **gross merchandise** (`subtotal + VAT`, the price the shopper sees), capped by `maxDiscount` and the gross, and checked against `minOrderValue`, its date window, `usageLimit`, the per-customer limit and `ONLINE` channel eligibility. `FREE_SHIPPING` discounts the delivery charge instead of the goods. Checkout locks the coupon row `FOR UPDATE`, quotes again inside the transaction, writes `coupon_redemptions` and increments `usedCount`. Cancelling deletes the redemption and decrements the counter. |
| Delivery | `delivery_zones` carry a division, district, charge, free-shipping threshold and an estimated day range. Checkout refuses a zone that does not match the chosen division and district, and free delivery applies above the zone threshold or with a free-shipping coupon. |
| Payments | Cash on delivery and manual bKash/Nagad both create a `PENDING_VERIFICATION` payment, so the existing payments queue is the single place a manager confirms money. A bKash/Nagad order requires a transaction id. No gateway adapter is wired yet. |
| Order engine | `createSale` now accepts `source: "WEB"`, a warehouse, a delivery zone and a coupon, and skips the cashier PIN for online orders. The order is `channel = ONLINE`, `source = WEB`, `status = CONFIRMED`. Stock leaves once per stocked line with `allowNegative: false`, so insufficient stock rejects the order. An order whose coupon covers everything is `PAID` with zero paid and needs no payment row. |
| Loyalty | Earning uses net merchandise after the coupon (`subtotal − discountTotal − couponDiscount`). The storefront cannot redeem points because there is no logged-in customer. |
| Order access | There is no customer account, so the confirmation page is protected by an HMAC-signed token in the URL (`scope: "order"`, 7-day TTL, one order and mobile). `/track` asks for the order number and mobile and issues a fresh token; a wrong mobile reveals nothing. |
| Cancellation | Cancelling an online order restocks the default warehouse, reverses the sale and paid payment journals, releases the coupon redemption, and marks any still-pending payment `FAILED` so it leaves the verification queue. |
| Permissions | The storefront is public by design. Everything that changes money or stock runs through the same services and guards as the console; there is no anonymous write path into inventory or accounting. Journals and stock movements use the inactive `storefront@bgd26.local` system actor. |

```text
npm test                    → 81/81 (70 existing + 11 storefront; rolled-back transactions)
npm run verify:storefront   → 14/14 (against `next start`, real HTTP)
  the public home page renders without a session
  the shop lists the published product
  the product page renders and never exposes cost price (no `80.0000`, no `costPrice`)
  a draft product is not public (404)
  the cart badge endpoint counts the guest cart (0 without a cookie, 2 with one)
  the cart page reads the guest cart cookie and shows the merchandise total
  the checkout page shows the seeded delivery zone and the order button
  the coupon API quotes the expected 10 % saving
  a COD order consumes stock, posts a balanced ONLINE_SALE journal, converts the cart,
    increments the coupon and leaves the payment PENDING_VERIFICATION
  the signed order link shows the confirmation
  a missing or tampered order token reveals nothing
  /track issues a fresh link from order number + mobile and refuses a wrong mobile
  cancelling restores stock, releases the coupon and fails the pending payment
  the cancelled order page still opens for its owner

npm run verify:orders       → 13/13  (re-run after module 5a)
npm run verify:inventory    → 9/9    (re-run after module 5a)
npm run verify:purchasing   → 9/9    (re-run after module 5a)
npm run verify:auth         → 9/9    (re-run after module 5a)
npm run verify:catalog      → 8/8    (re-run after module 5a)
npm run verify:crm          → 8/8    (re-run after module 5a)
npm run verify:accounting   → 12/12  (re-run after module 5a)
npm run verify:loyalty      → 9/9    (re-run after module 5a)
npm run verify:invariants   → 10/10
npm run typecheck / lint / build → clean (69 routes)
```

### Design decisions locked in this module

1. **One order engine, two doors.** The storefront calls the same `createSale`
   as the till, so stock, journals, payments and loyalty cannot behave
   differently online. The only branches are the source, the warehouse, the
   coupon and the absent cashier PIN.
2. **Guest means mobile, not account.** A first-time shopper becomes a retail
   customer keyed by their normalised mobile, which makes repeat orders and
   loyalty earning work later without a login.
3. **The cart is a soft hold.** Nothing is reserved while browsing; stock leaves
   at confirmation. Overselling is refused rather than silently back-ordered.
4. **A coupon is merchandise value, delivery is separate.** The quote uses
   `subtotal + VAT`, and a free-shipping coupon reduces the delivery line, so a
   coupon can never create a negative merchandise total.
5. **Money waits for a human.** COD and bKash/Nagad both enter the existing
   verification queue; the storefront never marks a digital payment paid.
6. **Signed links instead of accounts.** A seven-day HMAC token names one order
   and mobile; `/track` re-proves ownership and issues a new one.
7. **Cancellation gives everything back.** Stock, coupon redemption and pending
   payments are released in the same transaction as the reversal.
8. **Catalogue pages stay cacheable.** The header badge is the only personalised
   element and it is fetched from an API route, so no page render reads the cart
   cookie.
9. **The public catalogue cannot see margin.** Cost price and supplier fields
   are never selected, not merely hidden in the template.

## Phase 3, module 5b — shipping, couriers and COD remittance (approved)

| Area | Detail |
| --- | --- |
| Scope | A courier registry, consignment booking, an append-only tracking timeline, order-status synchronisation and cash-on-delivery remittance. No provider API is wired yet: Pathao, Steadfast and RedX are seeded records with an adapter that refuses to book. |
| Data model | No new tables. The shipment reuses `couriers`, `shipments` and `shipment_tracking_events`. Migration `20261119170000_shipping` adds CHECKs for a non-negative COD amount and delivery charge and for an ordered ship/deliver time, plus a partial unique index that allows only one live shipment per order. The seed creates four couriers (manual, Pathao, Steadfast, RedX) idempotently. |
| Courier adapters | `src/lib/adapters/couriers/` defines the port (`book`, `cancel`, `isConfigured`). The manual adapter records the consignment and any tracking number a person typed; it is the only one that can book. The Pathao/Steadfast/RedX adapter throws a clear "not wired yet" error, so a provider record can exist without pretending to book. |
| Booking | Only an order in `READY_TO_SHIP` can be booked, and only once: a second live consignment is refused by the service and by the partial unique index. Booking writes the shipment, its first tracking event and the COD amount (the order's due amount when a COD payment is pending), but deliberately leaves the order in `READY_TO_SHIP`. |
| Tracking | Events are append-only history; the shipment row carries the latest status for fast lists. A pickup, transit or out-for-delivery event moves a ready order to `SHIPPED`; a delivery event moves it to `DELIVERED`. A courier return or failure leaves the order alone — the refund/return document decides what happens to stock and money. |
| Cancellation | Only a `PENDING` or `BOOKED` shipment can be cancelled, before pickup. The adapter is told first, then the shipment becomes `CANCELLED`, a closing event is appended and the order stays ready to ship so it can be booked again. |
| COD money | Verifying a COD payment already debits `1060 Courier COD Clearing`. A remittance posts DR cash (`1000`) or bank (`1010`) / CR `1060`, with `source: "MANUAL"`, `referenceType: "cod_remittance"` and a generated reference, so the payout advice ties to the journal. |
| Permissions | Reading shipments, couriers and remittances needs `shipment.read`. Booking and recording events need `shipment.write`. Cancelling a booking and posting a remittance need `shipment.approve`, because both undo or recognise money and a physical commitment. A cashier reads shipments but cannot open the booking form. |
| Routes | `/shipping` (list, filters, COD-in-transit total), `/shipping/new`, `/shipping/[id]`, `/shipping/couriers`, `/shipping/couriers/[id]`, `/shipping/remittances`. The order page shows its shipments and offers "Book shipment" when the order is ready and has no live consignment. |

```text
npm test                    → 97/97 (81 existing + 16 shipping; rolled-back transactions)
npm run verify:shipping     → 10/10 (against `next start`, real HTTP)
  an anonymous visitor is sent to login from shipping
  the shipments list renders for staff
  a ready-to-ship order is booked and appears on its own page
  the order page shows the shipment and no longer offers a new booking
  a pickup event moves the order to shipped
  a delivery event moves the order to delivered
  a booked shipment can be cancelled and rebooked
  the courier registry says which adapters are wired
  a cashier reads shipments but cannot open the booking form
  a COD remittance posts a balanced journal that clears 1060

npm run verify:storefront   → 14/14  (re-run after module 5b)
npm run verify:orders       → 13/13  (re-run after module 5b)
npm run verify:accounting   → 12/12  (re-run after module 5b)
npm run verify:loyalty      → 9/9    (re-run after module 5b)
npm run verify:inventory    → 9/9    (re-run after module 5b)
npm run verify:purchasing   → 9/9    (re-run after module 5b)
npm run verify:auth         → 9/9    (re-run after module 5b)
npm run verify:catalog      → 8/8    (re-run after module 5b)
npm run verify:crm          → 8/8    (re-run after module 5b)
npm run verify:invariants   → 10/10
npm run typecheck / lint / build → clean (76 routes)
```

### Design decisions locked in this module

1. **Booking is not shipping.** A consignment is a promise to hand over; the
   order only becomes `SHIPPED` when a pickup or transit event proves the parcel
   left. This keeps a cancelled or failed booking from leaving a false status.
2. **One live parcel per order.** A cancelled, failed or returned attempt may be
   followed by a new one, but two active consignments would mean the same parcel
   is with two couriers. A partial unique index enforces it under concurrency.
3. **Adapters are honest.** A seeded provider record is not a booking. The
   un-wired adapter refuses with an actionable message instead of inventing a
   tracking number; staff book manually and paste the real number.
4. **The tracking timeline is the history.** Events are never edited or deleted;
   the shipment row is a fast-read cache of the latest status.
5. **COD is cleared, not earned, here.** The payment verification already moves
   the money into `1060`; the remittance entry only moves it to cash or bank, so
   the books cannot recognise the same sale twice.
6. **A courier failure does not decide stock.** The shipment can end `FAILED` or
   `RETURNED` while the order stays put; a refund or return document is the only
   thing allowed to restock and reverse money.

## Phase 3, module 5c — financial statements (approved)

| Area | Detail |
| --- | --- |
| Scope | Three statements read straight from posted journals: profit and loss for a date range, a balance sheet at a point in time, and a cash-flow statement. No new tables, no new posting rules, no schema change. |
| Source of truth | `src/lib/accounting/reports.ts` sums `journal_entry_lines` on `POSTED` entries. Nothing reads orders, stock or payments directly, so a statement cannot disagree with the ledger; a corrected mistake is a reversal entry and nets out on its own. |
| Sign convention | Natural signs: revenue is credit-positive, so discounts (`4020`) and returns (`4030`) show as negative and reduce net revenue; expenses are debit-positive; assets are debit-positive; liabilities and equity are credit-positive. |
| Profit and loss | Revenue, cost of sales (`5000`–`5030`), gross profit, operating expenses (every other expense account) and net profit, with net margin. |
| Balance sheet | Assets, liabilities and equity at the end of the chosen Dhaka day. There are no closing entries yet, so the cumulative revenue-minus-expense result is shown as **Accumulated earnings** inside equity, which makes assets equal liabilities plus equity by construction. The page states whether it balances and by how much it is out. |
| Cash flow | Cash and cash-equivalent accounts are `1000`, `1010`, `1020`, `1030` and `1040`. Receivables (`1050`) and courier COD clearing (`1060`) are deliberately not cash. Each posted entry that moves a cash account appears once with its net cash effect; a transfer between two cash accounts nets to zero and is omitted. Opening cash, operating and financing inflows/outflows, net change and closing cash tie to the balance sheet. |
| Classification | An entry that touches any `EQUITY` account is `FINANCING` (owner capital, drawings); everything else is `OPERATING`. There are no fixed-asset accounts yet, so nothing is classified as investing. |
| Dates | Ranges are Dhaka days (`+06:00`), not server UTC days: `src/lib/accounting/report-dates.ts` builds explicit boundaries, defaults to the current month, and swaps a reversed range instead of returning nothing. |
| Permissions | `report.read` (already held by `OWNER` and `ACCOUNTANT`, not by `CASHIER`). All three pages refuse an anonymous visitor with a login redirect and a cashier with `/forbidden`. |
| Routes | `/accounting/reports` (profit and loss), `/accounting/reports/balance-sheet`, `/accounting/reports/cash-flow`. The accounting nav gained a **Reports** item and the three pages share a report tab strip. |

```text
npm test                    → 102/102 (97 existing + 5 reports; rolled-back transactions)
npm run verify:reports      → 8/8 (against `next start`, real HTTP)
  an anonymous visitor is sent to login from the reports
  a cashier without report.read is sent to forbidden
  the profit and loss page matches the posted journals
  the balance sheet renders and balances
  the cash flow page ties the net change to cash
  the accounting navigation exposes the reports
  the three statements are linked to each other
  a reversal removes the sale from the profit and loss statement

npm run verify:shipping     → 10/10  (re-run after module 5c)
npm run verify:storefront   → 14/14  (re-run after module 5c)
npm run verify:orders       → 13/13  (re-run after module 5c)
npm run verify:accounting   → 12/12  (re-run after module 5c)
npm run verify:loyalty      → 9/9    (re-run after module 5c)
npm run verify:inventory    → 9/9    (re-run after module 5c)
npm run verify:purchasing   → 9/9    (re-run after module 5c)
npm run verify:auth         → 9/9    (re-run after module 5c)
npm run verify:catalog      → 8/8    (re-run after module 5c)
npm run verify:crm          → 8/8    (re-run after module 5c)
npm run verify:invariants   → 10/10
npm run typecheck / lint / build → clean (79 routes)
```

### Design decisions locked in this module

1. **Statements are a view, not a second ledger.** Every number is a sum of
   posted lines. There is no report cache, no snapshot table and no separate
   calculation that could drift; if a figure looks wrong, the journal is wrong.
2. **Natural signs beat debit/credit columns.** A reader sees `Sales Discounts
   ৳-100.00` and a net revenue of `৳900.00`, not a debit column to subtract by
   hand. The same rule gives a positive liability balance and a positive asset
   balance without a per-statement sign table.
3. **No closing entries, so equity carries the result.** Until a year-end close
   exists, the cumulative profit is presented as accumulated earnings. The
   balance sheet therefore balances at any date, including mid-year.
4. **Cash is narrow on purpose.** Receivables and courier COD clearing are
   claims, not money in hand; counting them as cash would make the cash-flow
   statement flatter the drawer.
5. **Dhaka days, not UTC days.** A sale at 00:30 Dhaka belongs to that Dhaka
   day. The report helpers build `+06:00` boundaries explicitly rather than
   relying on the server timezone.
6. **Verification writes into a quiet past day.** The HTTP verification posts a
   small scenario dated in 1990–2019, derived from the run id, so the expected
   profit is isolated and the entries never crowd page one of the journal
   browser.

## Phase 3, module 6 — supplier settlement (approved)

| Area | Detail |
| --- | --- |
| Scope | Recording a payment to a supplier, sending goods back against a posted goods receipt, and reading a supplier payables statement. No supplier invoice table, no payment approval queue and no multi-currency. |
| One source of truth | The payable is **derived**, never stored: `src/lib/purchasing/settlement.ts` sums posted `journal_entry_lines` on `1300 Accounts Payable` filtered by `supplierId`. `supplier_ledgers` is deliberately left unused so there is no second balance to drift. `outstanding = credit − debit`; a negative figure is a credit with the supplier. |
| Payments | `purchase.approve` is required. The amount must be greater than zero and no more than the outstanding balance. The supplier row is locked with `SELECT … FOR UPDATE` so two payments cannot spend the same taka. A blacklisted supplier cannot be paid, and an optional purchase order must belong to that supplier and not be cancelled. Journal: DR `1300` / CR `paymentAccountCode(method)`, `source: PURCHASE_PAYMENT`. |
| Payment methods | `CASH`, `BKASH`, `NAGAD`, `BANK_TRANSFER`, `CHEQUE` and `CARD`. COD is excluded — it is money coming in, never going out. |
| Returns | `DRAFT → APPROVED → COMPLETED`; `CANCELLED` only from `DRAFT`. A return is always created from a **posted** goods receipt, and each received line remembers `returnedQty`, so the same unit cannot go back twice. |
| Return approval | Appends `PURCHASE_RETURN` stock movements (outbound at AVCO), increments `returnedQty`, then posts DR `1300` / CR `1100` for exactly the value the stock ledger released. The draft's `totalValue` is only an estimate at receipt cost; approval overwrites it with the ledger value, so inventory and the journal always agree. |
| Return completion | Optional cash refund: DR `paymentAccountCode(refundMethod)` / CR `1300`. This is what clears a debit balance after goods went back that had already been paid for. Without a refund the supplier simply carries a credit until the next invoice. |
| Statement | `/suppliers/[id]/statement` lists every posted entry that touched the supplier's payable, oldest first, with debit, credit and a running balance, plus received-on-credit, paid-or-returned and closing figures. |
| Permissions | `purchase.read` for the payment list, return list, return detail and statement; `purchase.approve` to record a payment or move a return; `purchase.write` to raise a draft return. `OWNER` has all, `STOCK` has `purchase.*`, `ACCOUNTANT` only reads, `CASHIER` is refused. |
| Routes | `/purchases/payments`, `/purchases/payments/new`, `/purchases/returns`, `/purchases/returns/new`, `/purchases/returns/[id]`, `/suppliers/[id]/statement`. The purchasing nav gained **Payments** and **Returns**, and the supplier page gained a payable card with a statement link. |

```text
npm test                              → 106/106 (102 existing + 4 settlement; rolled back)
npm run verify:purchasing-settlement  → 11/11 (against `next start`, real HTTP)
  the receipt created a payable of ৳1,000.00
  anonymous visitors are sent to login from settlement pages
  the owner sees the payments, returns and statement screens
  recording a payment reduces the payable and shows on the list
  an overpayment and a blacklisted supplier are both refused
  a draft return is listed but moves no stock or money
  approving a return removes stock at average cost and debits the payable
  completing a return with a cash refund clears the supplier credit
  the statement shows every movement and closes at zero
  an accountant reads settlement pages but cannot open the forms
  a cashier is redirected from every settlement page

npm run verify:reports     → 8/8    (re-run after module 6)
npm run verify:shipping    → 10/10  (re-run after module 6)
npm run verify:storefront  → 14/14  (re-run after module 6)
npm run verify:orders      → 13/13  (re-run after module 6)
npm run verify:accounting  → 12/12  (re-run after module 6)
npm run verify:loyalty     → 9/9    (re-run after module 6)
npm run verify:inventory   → 9/9    (re-run after module 6)
npm run verify:purchasing  → 9/9    (re-run after module 6)
npm run verify:auth        → 9/9    (re-run after module 6)
npm run verify:catalog     → 8/8    (re-run after module 6)
npm run verify:crm         → 8/8    (re-run after module 6)
npm run verify:invariants  → 10/10
npm run typecheck / lint / build → clean (85 routes)
```

### Design decisions locked in this module

1. **The payable is a query, not a column.** A stored balance needs a trigger, a
   backfill and a repair path; a query over posted journal lines needs none. The
   supplier statement is the same query with dates attached.
2. **A return is worth what the stock ledger releases.** The draft shows an
   estimate, but approval overwrites it with the AVCO value actually removed, so
   inventory and the supplier debit are equal by construction.
3. **`returnedQty` lives on the received line.** That is what makes "you can
   return six more" a fact rather than a re-count, and it blocks the same unit
   going back twice even under a race (the receipt lines are locked).
4. **A refund clears a credit, it does not reduce a debt.** Approval already
   debits the payable; completion with a refund credits it back and brings cash
   in. That keeps the two events — goods leaving and money arriving — separate
   and auditable.
5. **Payments post immediately.** The money has already left; an approval queue
   would only delay the books. The guard is the outstanding cap and the
   permission, not a second pair of eyes.
6. **One extra enum value, one extra column.** `PURCHASE_RETURN` joins the
   outbound stock movements, `returnedQty` defaults to zero and
   `refundReference` is nullable, so the migration is additive and existing
   receipts keep working.

## Phase 3, module 7 — engraving production (approved)

| Area | Detail |
| --- | --- |
| Scope | Order-linked engraving and made-to-order work. A job belongs to one order line and tracks design, approval, materials and hand-over. No generic work orders, no bill-of-materials explosion, no labour costing and no finished-goods receipt. |
| One live job | A second job on the same order line is refused while one is open. A line can be produced again only after the first job is completed or cancelled. Dropship lines are refused — the supplier makes those. |
| Status flow | `PENDING_DESIGN → DESIGN_PREPARATION → AWAITING_CUSTOMER_APPROVAL → APPROVED → PRODUCTION → QUALITY_CHECK → READY_TO_SHIP → COMPLETED`. `CANCELLED` is reachable from every open state. `COMPLETED` and `CANCELLED` are terminal. |
| Design | Revisions are numbered per job. The first revision moves the job out of pending design; sending for approval expires any earlier pending approval; approval marks the engraving customization approved. Changes can be requested, which returns the job to design. |
| Materials | Components are stocked variants only and are issued from the job's warehouse at AVCO through `PRODUCTION_ISSUE`. The same variant cannot be its own component. Issuing is idempotent — only the outstanding quantity moves. |
| Work in progress | `1130 Work in Progress` holds the issued value. Issue posts DR `1130` / CR `1100`. `productionWipValue` is the posted debit minus credit on `1130` for that job, so the card cannot drift from the ledger. |
| Completion | `COMPLETED` posts DR `5000 Cost of Goods Sold` / CR `1130` for the remaining job value, so the account is zero afterwards. Production cannot start until every component is issued. |
| Cancellation | Cancelling after issue appends `PRODUCTION_RETURN` inbound movements at the issue cost, then posts DR `1100` / CR `1130` for exactly the value returned. Cancelling before issue posts nothing. |
| Costing | Materials only. The finished unit already left stock when it was sold, so production does not receive it back into inventory; labour and overhead are not allocated in this module. |
| Independence | Production status lives on the job and on `OrderItem.productionStatus`. The order keeps `status` and `fulfillmentStatus`, so a job can be ready while dispatch is still waiting, or dispatch can move while the job is open. |
| Permissions | `production.read` for the list and detail; `production.write` to raise a job, add revisions or components; `production.approve` to approve a design, issue materials and change status. `OWNER` and `MANAGER` have all, `STOCK` has `production.*`, `ACCOUNTANT` and `CASHIER` are refused. |
| Routes | `/production`, `/production/new`, `/production/[id]`. The admin nav gained **Production** after **Purchases**. |
| Schema | `JournalSource.PRODUCTION`, account `1130`, and the existing `ProductionJob`, `ProductionJobItem`, `DesignRevision`, `DesignApproval` and `ProductionStatusHistory` tables. The migration only adds the enum value and the account. |

```text
npm test                    → 112/112 (106 existing + 6 production; rolled back)
npm run verify:production   → 11/11 (against `next start`, real HTTP)
  anonymous visitors are sent to login from production pages
  the owner sees the job list and the new-job picker
  the job detail shows the brief, components and next step
  a design revision moves the job into design
  sending for approval shows the approve and changes forms
  approving the design shows the issue-materials action
  issuing components takes stock at average cost into work in progress
  completing the job moves work in progress to cost of goods sold
  cancelling after issue returns the materials and clears work in progress
  a stock keeper can run production
  an accountant and a cashier are refused production

npm run verify:reports                → 8/8    (re-run after module 7)
npm run verify:shipping               → 10/10  (re-run after module 7)
npm run verify:storefront             → 14/14  (re-run after module 7)
npm run verify:orders                 → 13/13  (re-run after module 7)
npm run verify:accounting             → 12/12  (re-run after module 7)
npm run verify:loyalty                → 9/9    (re-run after module 7)
npm run verify:inventory              → 9/9    (re-run after module 7)
npm run verify:purchasing             → 9/9    (re-run after module 7)
npm run verify:purchasing-settlement  → 11/11  (re-run after module 7)
npm run verify:auth                   → 9/9    (re-run after module 7)
npm run verify:catalog                → 8/8    (re-run after module 7)
npm run verify:crm                    → 8/8    (re-run after module 7)
npm run verify:invariants             → 10/10
npm run schema:check                  → OK (90 tables / 81 enums)
npm run typecheck / lint / build      → clean (88 routes)
```

### Design decisions locked in this module

1. **A job is per order line, not per order.** Engraving text and proof approval
   belong to one unit; two engraved units in one order can be at different
   stages. The order flag `requiresProduction` is only a list-query shortcut.
2. **Design approval is internal for now.** The schema already carries an
   approval token, signer and expiry, but there is no public proof link yet; the
   manager records the customer's approval. That keeps the module usable without
   a customer login while leaving the token columns for later.
3. **Materials move at AVCO into `1130`, not into a job-cost sheet.** Using the
   existing stock engine means the ledger, the average cost and the journal all
   agree, and cancelling simply runs the same movement in reverse.
4. **The finished good is not received back into stock.** It left inventory when
   the order was sold; production adds the engraving cost, and completion sends
   that cost to `5000`. Receiving it again would double-count the unit.
5. **Completion is a cost transfer, not a sale.** Revenue was recognised at the
   sale. The only question left is what the engraving consumed, which is exactly
   the `1130` balance for that job.
6. **Production and shipping stay independent.** A job can be ready before a
   courier is booked, and a shipment can move while quality check is still open.
   Coupling them would make one team wait for the other's paperwork.

## Phase 3, module 8 — dropshipping

| Area | Detail |
| --- | --- |
| Scope | A dropship variant is sold but never stocked: the supplier ships straight to the customer. The sale raises the supplier order, the console drives it, and the supplier is paid through the existing settlement statement. No supplier portal, no automatic courier API call and no COD dropship yet. |
| Creation | `createDropshipOrdersForOrder` runs inside the sale transaction. It reads the order's `DROPSHIP` lines, groups them by `dropshipSupplierId` and creates one `DROPSHIP` purchase order per supplier with `warehouseId: null`. A line without a supplier stops the whole sale. |
| Grouping | One supplier order per supplier per sale, enforced by the partial unique index `uq_dropship_order_supplier` on `(orderId, supplierId) WHERE poType = 'DROPSHIP'`. Calling creation twice creates nothing new. Each supplier line keeps `orderItemId`, so the sale line and the supplier line stay linked. |
| Shipments per sale | One live `DROPSHIP_DIRECT` shipment per supplier, enforced by `uq_shipment_active_dropship` on `(orderId, supplierId)`. Normal outbound shipments keep the stricter one-per-order index. |
| Cost | The line cost is `variant.dropshipCost`, falling back to the recorded cost price. It is snapshotted into `PurchaseItem.unitCost` and `lineTotal` at sale time, so a later catalogue price change does not rewrite a committed supplier order. The purchase order total is the payable. |
| Status flow | `DRAFT → SENT → CONFIRMED → SHIPPED → DELIVERED`. `CANCELLED` is reachable from draft, sent or confirmed. Standard purchase statuses (`PARTIALLY_RECEIVED`, `RECEIVED`, `CLOSED`) never apply. The flow is one table (`DROPSHIP_TRANSITIONS`), so the screen and the service cannot disagree. |
| Prepaid guard | Shipping is refused while the sale still has `dueAmount > 0`. A cash-on-delivery dropship would ask the supplier to extend credit and there is no COD remittance path for a direct supplier shipment yet, so dropship is prepaid only. |
| Cost of goods sold | Shipping posts DR `5010 Dropship Cost of Goods Sold` / CR `1300 Accounts Payable` with the supplier id and `source: DROPSHIP_COGS`, `referenceType: "purchase_order"`. It checks for an existing posted entry first, so the cost is recognised once. |
| Shipment | Shipping creates a `DROPSHIP_DIRECT` shipment with `warehouseId: null`, the supplier id, the supplier's tracking number and a `PICKED_UP` event. The sale is walked to `READY_TO_SHIP` on the first supplier dispatch and only moves to `SHIPPED` once every live supplier order has shipped. Cash collected on delivery is zero because the sale is prepaid. |
| Delivery | Marking delivered appends a `DELIVERED` tracking event and closes that parcel directly; it does not reuse `addTrackingEvent`, which would move the whole sale. The supplier order becomes `DELIVERED`. The sale moves to `DELIVERED` and fulfilment to `FULFILLED` only once every live supplier order has arrived. A sale split across suppliers therefore waits for the last parcel. |
| Cancellation | A supplier order can be cancelled before it ships. Cancelling the sale cancels every draft, sent or confirmed dropship order in the same transaction; once any supplier order is shipped or delivered, the sale refuses cancellation and a return is the path. No journal is reversed because none was posted. |
| Payable | The supplier order is never received into stock, so no GRN, no `receivedQty` and no inventory movement. The shipping journal credits `1300` with the supplier id, which is exactly what `supplierPayable` and the supplier statement already read. |
| Standard purchases | `/purchases` filters to `poType: STANDARD`. A standard purchase screen cannot open a dropship order: `/purchases/[id]` redirects to its dropship detail page. |
| Permissions | `purchase.read` for the list and detail; `purchase.approve` to send, confirm, ship, deliver or cancel. `OWNER`, `MANAGER` and `STOCK` can move orders; `ACCOUNTANT` can read; `CASHIER` is refused. |
| Routes | `/purchases/dropship`, `/purchases/dropship/[id]`. The purchasing nav gained **Dropship** after **Orders**. |
| Schema | `PurchaseOrderStatus` gained `CONFIRMED`, `SHIPPED` and `DELIVERED`; `PurchaseOrder` gained `confirmedAt`, `shippedAt`, `deliveredAt` and `cancelReason`. The partial unique index adds the one-order-per-supplier rule, and `uq_shipment_active_dropship` allows one live direct shipment per supplier. |

```text
npm test                    → 122/122 (112 existing + 10 dropship; rolled back)
npm run verify:dropship     → 14/14 (against `next start`, real HTTP)
  anonymous visitors are sent to login from dropship pages
  the sale raised a supplier order with no warehouse and no stock
  the owner sees the supplier order in the dropship list
  the detail shows the supplier, sale, lines and next step
  standard purchase screens never show a dropship order
  sending shows the supplier-confirmation step
  confirming shows the ship step and stores the reference
  shipping posts cost of goods sold and creates a direct shipment
  a shipped supplier order cannot be cancelled
  shipping is refused while the sale still owes money
  delivery closes the shipment and fulfils the sale
  a stock keeper can read and run dropship orders
  an accountant can read but not move a dropship order
  a cashier is refused dropship pages

npm run verify:production             → 11/11 (re-run after module 8)
npm run verify:reports                → 8/8   (re-run after module 8)
npm run verify:shipping               → 10/10 (re-run after module 8)
npm run verify:storefront             → 14/14 (re-run after module 8)
npm run verify:orders                 → 13/13 (re-run after module 8)
npm run verify:accounting             → 12/12 (re-run after module 8)
npm run verify:loyalty                → 9/9   (re-run after module 8)
npm run verify:inventory              → 9/9   (re-run after module 8)
npm run verify:purchasing             → 9/9   (re-run after module 8)
npm run verify:purchasing-settlement  → 11/11 (re-run after module 8)
npm run verify:auth                   → 9/9   (re-run after module 8)
npm run verify:catalog                → 8/8   (re-run after module 8)
npm run verify:crm                    → 8/8   (re-run after module 8)
npm run verify:invariants             → 10/10
npm run schema:check                  → OK (90 tables / 81 enums)
npm run typecheck / lint / build      → clean (90 routes)
```

### Design decisions locked in this module

1. **The sale creates the supplier order, in the same transaction.** If the
   supplier cannot be resolved, the sale fails; a confirmed sale never leaves a
   dropship line without a supplier order. The alternative — a nightly job —
   would show the customer a confirmed order that no supplier had seen.
2. **One order per supplier per sale.** Grouping keeps a multi-line supplier
   shipment on one document, while a sale split across two suppliers still
   produces two independent parcels. The partial unique index makes the rule
   hold even against a double submission.
3. **Cost is snapshotted at sale time.** `dropshipCost` is the supplier's price
   now; rewriting a committed order when the catalogue changes would make the
   payable disagree with what was agreed. The fallback to `costPrice` keeps old
   variants usable.
4. **Cost of goods sold is recognised at shipping, not at the sale.** A stocked
   sale credits `1100`, but dropship inventory never existed. Recognising the
   cost when the supplier ships matches the commitment and keeps `1100` honest.
5. **No GRN and no received quantity.** Receiving a dropship line into a
   warehouse would create stock that was never on the shelf. The purchase order
   is the payable, and the shipping journal is the only cost movement.
6. **Prepaid only for now.** The supplier must not carry the customer's credit
   risk, and there is no COD remittance path for a direct shipment. Cash on
   delivery remains available for stocked orders through the normal courier.
7. **Cancellation stops at shipment.** Before shipping, the supplier order is
   still a promise and can be pulled back with no journal. After shipping, the
   parcel exists and the return flow must decide what happens to goods and money.
8. **A sale split across suppliers waits for every parcel.** One direct shipment
   is allowed per supplier (`uq_shipment_active_dropship`), and the sale moves to
   shipped or delivered only when all live supplier orders reach that state.
   Closing the sale on the first parcel would tell the customer that everything
   had arrived while another supplier was still preparing the rest.

## Phase 3, module 9 — customer accounts and online loyalty redemption (approved 22 November 2026)

| Area | Detail |
| --- | --- |
| Scope | Optional storefront accounts layered on the guest flow. The mobile number is the identity. No SMS/WhatsApp OTP, no automated password reset and no social login. |
| Identity | `Customer` gained `passwordHash`, `passwordUpdatedAt`, `failedLoginCount`, `lockedUntil`, `lastLoginAt` and `accountClaimedAt` (migration `20261120090000_customer_accounts`). Customer credentials never live on the staff `User` table, so a storefront login can never become a counter permission. |
| Session | A separate `bgd26_customer` cookie: HttpOnly, SameSite=Lax, Secure in production, 30-day TTL. The payload carries `scope: "customer"` and the signature covers a `customer.` prefix, so a staff session or a guest order token cannot be swapped for a customer session — or the other way round. |
| Registration | Name, mobile, optional email, password and confirmation. The password policy is the staff policy: at least 10 characters with a letter and a digit. A fresh mobile creates a customer row; a mobile that already ordered as a guest claims that same row instead of creating a duplicate. |
| Claim proof | If the mobile already has orders, one order number from that record is required. Without an SMS gateway that is the only ownership proof the shop can ask for; a wrong number is refused and the account is untouched. |
| Sign-in and lockout | Mobile plus password. Five failures lock the account for fifteen minutes, matching the staff rule. A blocked or soft-deleted customer loses access immediately even while the cookie is still valid. |
| Password | Changing it requires the current password, refuses the password already in use and clears any lock. A forgotten password is reset manually by the shop after checking the last order; there is no email or SMS reset channel yet. |
| Profile | Name and email are self-service. The mobile number is read-only on the profile page; staff change it, which keeps the login identity under shop control. |
| Addresses | Up to 20 per customer, soft-deleted. The first address becomes the default, setting a new default clears the old one in one transaction, and deleting the default promotes the most recently updated survivor. Every read and write filters by `customerId`. |
| Orders | `/account/orders` lists only rows whose `customerId` matches the session. `/account/orders/[id]` returns `notFound()` for another account's order, so the URL is not an ownership proof. Guests keep the signed order link and `/track`. |
| Checkout | A signed-in customer's mobile is forced from the account, whatever the form posts, so points and history cannot land on a different number. Saved addresses prefill the form. Guests still check out with only a mobile. |
| Loyalty redemption | The checkout points box spends up to `min(balance, 20 % of net merchandise)`. The browser shows the figure; `quoteRedemption` and `redeemForOrder` re-check the live balance and cap inside the sale transaction, so a tampered form cannot overspend. |
| Loyalty page | `/account/loyalty` shows the cached balance plus the append-only `loyalty_transactions` history, including earnings, redemptions, expiry and reversals. |
| Routes | `/account`, `/account/login`, `/account/register`, `/account/orders`, `/account/orders/[id]`, `/account/addresses`, `/account/loyalty`, `/account/profile`. The storefront header and footer gained an **Account** link. |
| Guards | Every account page calls `requireCustomer()` on the server and every action re-reads the session. `safeCustomerNext` only allows a same-site path and never returns to login or register. |

```text
npm test                    → 133/133 (122 existing + 11 account; rolled back)
npm run verify:account      → 15/15 (against `next start`, real HTTP)
  anonymous visitors are sent to the account login
  anonymous order history redirects and keeps the destination
  the login and register pages render for guests
  a signed customer sees the dashboard with points and address
  the order list shows only this account's orders
  the order detail page opens for its owner
  another account gets a 404 for that order
  the addresses page lists both saved addresses with a default
  the points page shows the balance and the rules
  the profile page shows the read-only mobile number
  a staff session is not a customer session
  a guest order token is not a customer session
  checkout prefills the account's address and points
  a guest checkout still offers sign-in instead of points
  the storefront header links to the account

npm run verify:dropship               → 14/14 (re-run after module 9)
npm run verify:production             → 11/11 (re-run after module 9)
npm run verify:reports                → 8/8   (re-run after module 9)
npm run verify:shipping               → 10/10 (re-run after module 9)
npm run verify:storefront             → 14/14 (re-run after module 9)
npm run verify:loyalty                → 9/9   (re-run after module 9)
npm run verify:orders                 → 13/13 (re-run after module 9)
npm run verify:accounting             → 12/12 (re-run after module 9)
npm run verify:inventory              → 9/9   (re-run after module 9)
npm run verify:purchasing             → 9/9   (re-run after module 9)
npm run verify:purchasing-settlement  → 11/11 (re-run after module 9)
npm run verify:auth                   → 9/9   (re-run after module 9)
npm run verify:catalog                → 8/8   (re-run after module 9)
npm run verify:crm                    → 8/8   (re-run after module 9)
npm run verify:invariants             → 10/10
npm run schema:check                  → OK (90 tables / 81 enums)
npm run typecheck / lint / build      → clean (98 routes)
```

### Design decisions locked in this module

1. **The mobile number is the identity, not an email.** Every order already
   carries the mobile, the courier needs it and the customer remembers it. An
   email would add a second identity that the shop cannot verify.
2. **Customer credentials live on `Customer`, not `User`.** A storefront account
   must never be one permission bug away from the counter. Keeping the rows
   separate makes the boundary structural instead of procedural.
3. **Claiming an existing guest record needs proof.** Without an SMS gateway, one
   order number from that mobile is the strongest check available. It stops a
   stranger from claiming someone else's order history by typing their number.
4. **The customer cookie is separate and domain-separated.** A staff session, a
   guest order token and a customer session sign different payloads with
   different prefixes, so no token can be replayed against another surface.
5. **A customer session lasts 30 days; a staff session lasts 7.** Customers shop
   from a personal phone and hate signing in repeatedly; staff share counter
   devices and need a short session.
6. **The mobile number is changed by staff only.** It is the login and the order
   key. Self-service changes would need OTP on both numbers, which the shop does
   not have yet.
7. **One default address, enforced in a transaction.** Checkout must always have
   one obvious choice, and deleting the default cannot leave the account without
   an address when another one exists.
8. **Redemption is only ever granted by the sale engine.** The checkout page is a
   preview; `quoteRedemption` checks the live balance and the 20 % cap again
   inside the transaction, exactly like the POS. The browser is never trusted.
9. **Order ownership is a `customerId` filter, not a URL.** The order id in the
   address bar is only a lookup key; another account gets a 404 rather than a
   redacted page.
10. **Manual password reset until a messaging channel exists.** The login page
    tells the customer to message the shop, and staff reset after checking the
    last order. Inventing an insecure reset would be worse than a slow one.

## Phase 3, module 10 — AI assistant, read and draft only (awaiting approval)

| Area | Detail |
| --- | --- |
| Scope | A staff-console assistant (`ADMIN` channel). No public widget and no WhatsApp path. It answers questions and may create one **draft** order. It cannot take payment, issue a refund, change a price, apply a discount, adjust stock, post a journal or send marketing. |
| Provider | An adapter port (`src/lib/adapters/ai/`) with two implementations. `local` is a deterministic rules engine that needs no key and works offline; `openai` uses Chat Completions tool calling. `AI_PROVIDER` picks one, but a missing `AI_API_KEY` falls back to `local` and the console says so. |
| Tools | Four allow-listed tools: `search_products` (read), `get_order_status` (read), `quote_delivery` (read) and `create_draft_order` (draft). Each has a Zod schema and a server-side permission check; an unknown name is refused and logged `BLOCKED`. |
| Live data | Prices, VAT, stock at the default warehouse, delivery charges and order state are always read from the database inside the call. The model never supplies a number, and the prompt tells it to treat tool output as data, not instructions. |
| Draft order | A real `Order` with `status = DRAFT`, `source = AI_DRAFT`, `aiDraft = true` and a status-history row. It reserves no stock, creates no payment, posts no journal, earns no loyalty and raises no dropship purchase order. |
| Conversion | `convertAiDraft` locks the draft row, calls the ordinary `createSale` (`source = ADMIN`, COD/bKash/Nagad) so every line is re-priced and stock is reserved, then marks the draft `CANCELLED`. The draft itself never moved stock or money. |
| Direct confirmation | `setOrderStatus` refuses to move an AI draft from `DRAFT` to `CONFIRMED`; conversion is the only sale path. Cancelling a draft is a status-only change, so it never invents a `SALE_RETURN` for goods that never left. |
| Audit | Every tool call, including `BLOCKED` and `ERROR`, is written to `ai_action_logs` with duration and a masked mobile. One `assistant.turn` row per request powers the durable hourly limit, so a restart does not reset it. |
| Limits | `AI_REQUESTS_PER_HOUR` (60) per user, `AI_MAX_DRAFTS_PER_HOUR` (10), a bounded tool loop (`AI_MAX_TOOL_ROUNDS` 4, `AI_MAX_TOOL_CALLS_PER_TURN` 5) and an optional monthly token budget (`AI_MONTHLY_TOKEN_BUDGET`, 0 = unlimited). |
| Failure | Provider timeout, HTTP error, rate limit or budget exhaustion ends in a human handover message. The assistant never blocks checkout, the till or a page render. |
| Blast radius | `CASHIER` gained `ai.read` only; `OWNER` and `MANAGER` have `ai.*` through the wildcard. The assistant page and the order conversion panel check `ai.read` and `ai.write` (plus `order.write` for a sale) on the server. |
| Routes | `/assistant` (chat, manual draft form, recent drafts, recent tool calls, guardrail status). `/orders/[id]` gains an assistant-draft banner and the conversion panel. |

```text
npm test                    → 145/145 (133 existing + 12 assistant; rolled back)
npm run verify:ai           → 11/11 (against `next start`, real HTTP)
  an anonymous visitor is sent to the staff login
  a role without ai.read is sent to the forbidden screen
  the owner sees the assistant, provider and draft form
  the assistant page offers product, delivery and order prompts
  the assistant draft appears with its review banner
  a product question is answered from the live catalogue
  a delivery question reads the zone table and free threshold
  the draft moved no stock, payment or journal
  converting the draft creates a real sale and posts a balance
  an order answer masks the customer's mobile
  an unknown tool is refused and recorded

npm run verify:dropship               → 14/14 (re-run after module 10)
npm run verify:production             → 11/11 (re-run after module 10)
npm run verify:reports                → 8/8   (re-run after module 10)
npm run verify:shipping               → 10/10 (re-run after module 10)
npm run verify:storefront             → 14/14 (re-run after module 10)
npm run verify:loyalty                → 9/9   (re-run after module 10)
npm run verify:orders                 → 13/13 (re-run after module 10)
npm run verify:accounting             → 12/12 (re-run after module 10)
npm run verify:account                → 15/15 (re-run after module 10)
npm run verify:inventory              → 9/9   (re-run after module 10)
npm run verify:purchasing             → 9/9   (re-run after module 10)
npm run verify:purchasing-settlement  → 11/11 (re-run after module 10)
npm run verify:auth                   → 9/9   (re-run after module 10)
npm run verify:catalog                → 8/8   (re-run after module 10)
npm run verify:crm                    → 8/8   (re-run after module 10)
npm run verify:invariants             → 10/10
npm run schema:check                  → OK (90 tables / 81 enums)
npm run typecheck / lint / build      → clean (99 routes)
```

### Design decisions locked in this module

1. **The assistant is a tool call, not a database client.** It can only name one
   of four allow-listed functions. It never sees SQL, a credential or a raw
   table, so a prompt injection has nothing to reach for.
2. **Every fact comes from the database.** Price, VAT, stock, delivery charge
   and order status are read inside the call. A model that invents a number
   cannot make the shop quote it.
3. **Draft only, and the draft is inert.** A draft reserves no stock, takes no
   payment, posts no journal and raises no supplier order. The worst a
   misheard request can do is create a reviewable piece of paper.
4. **Conversion re-runs the sale engine.** Conversion does not "confirm" the
   draft; it creates a new sale through `createSale`, which re-prices every
   line, reserves stock, posts the journal and creates the pending payment.
   That is why a draft cannot be confirmed directly.
5. **Cancelling a draft is status-only.** Running the normal cancellation path
   would write a `SALE_RETURN` for goods that never left, inventing stock. The
   early return in `cancelOrder` prevents phantom inventory.
6. **A missing key degrades, never breaks.** `local` is the default and needs
   nothing. Requesting `openai` without a key falls back with a visible notice.
   A provider outage becomes a human handover.
7. **Audit is not optional.** Blocked and failed calls are logged too, because
   the interesting events are the requests the assistant refused.
8. **Mobile numbers are masked before storage.** Staff reading the audit trail
   do not need a customer's full number, and a masked log cannot leak one.
9. **Limits are durable, not in memory.** The hourly counters read
   `ai_action_logs`, so a restart or a second worker cannot reset them.
10. **The counter keeps read-only access.** Cashiers may ask for a price or an
    order state; they may not create drafts or convert them. That keeps the
    risky step with the people who already own order write access.

## Running it locally

```bash
npm run db:local:setup    # local PostgreSQL + .env.local + application secrets
npm run db:deploy         # migrations
npm run db:seed           # reference data
npm run dev               # http://localhost:3000
```

Sign in with `owner@bgd26.com` / `Bgd26!ChangeMe`; the app forces a new password
immediately. Set a manager PIN on `/profile` afterwards.

`npm run secrets:init` generates `AUTH_SECRET`, `MANAGER_PIN_PEPPER`,
`FIELD_ENCRYPTION_KEY`, `CRON_SECRET` and `RATE_LIMIT_SALT` once, and never
overwrites existing values.

### Supabase (production target)

```bash
npm run env:setup      # pooled (6543) + direct (5432) URLs, keys
npm run env:check      # must end with: PASS — ready to migrate and run.
npm run db:deploy
npm run db:seed
npm run dev
```

The project requires **Node 22+** (`.nvmrc` pins 24); Node 18 fails the engine
check and is not supported by Next 16 or Prisma 7.

> Status note: the original Supabase project `gqghfeqxsovkuladydyv` never came
> back. On 23 November 2026 it was replaced by `chqajgxkwpmpoxsjsxks` (Tokyo,
> PostgreSQL 17.12): all migrations applied, reference data seeded, the owner
> account created with a forced password change and the private `bgd26-media`
> bucket created with an anonymous read policy limited to `gallery/`.
>
> New Supabase projects expose the direct database host over IPv6 only, so the
> app uses the transaction pooler on port 6543 and `DIRECT_URL` uses the
> session pooler on port 5432. Migrations run through that session pooler.

## Next: after module 10

Modules 4a (accounting), 4b (loyalty), 5a (storefront), 5b (shipping), 5c
(financial statements), 6 (supplier settlement), 7 (engraving production), 8
(dropshipping), 9 (customer accounts) and 10 (assistant) are built; module 10
waits for approval. Module 4c (WhatsApp) was skipped for now and needs its own
gate:

1. **4c — WhatsApp.** Official Cloud API only: template messages for order
   confirmation, shipping and refund updates, opt-in tracking, delivery receipts
   and a retry queue. Needs the WABA ID, business number and approved templates
   before it can send anything real.

The remaining backlog, each with its own gate: courier API adapters for Pathao,
Steadfast and RedX; an automated customer password-reset channel (SMS or
WhatsApp, once 4c exists); and a live AI provider key if the owner wants a
language model instead of the deterministic rules engine. Dropshipping is
complete for prepaid orders, so an online sale can now send the supplier order,
ship direct and settle the supplier without a spreadsheet. COD dropship needs a
remittance design before it can be offered.

## সংক্ষেপে

ফেজ ২-এর চারটি ধাপই শেষ ও অনুমোদিত। প্রথম ধাপে অ্যাপ কাঠামো, ৯০ টেবিলের
মাইগ্রেশন, নিয়ম যাচাইকারী SQL ও সিড ডেটা আসল PostgreSQL-এ পরীক্ষিত। দ্বিতীয়
ধাপে লগইন, সেশন কুকি, পারমিশন, পাঁচবার ভুল পাসওয়ার্ডে ১৫ মিনিট লক, অডিট লগ,
বাধ্যতামূলক পাসওয়ার্ড পরিবর্তন ও ৬ সংখ্যার ম্যানেজার পিন যুক্ত হয়েছে। তৃতীয়
ধাপে শ্রেণি, পণ্য, ভ্যারিয়েন্ট ও গ্যালারি যুক্ত হয়েছে—ছবি আপলোডের পর সার্ভার
আবার পড়ে SHA-256 মিলিয়ে দেখে, তাই কোনো ছবি resize, crop বা recompress হয় না।
চতুর্থ ধাপে ক্রেতা, ঠিকানা, ট্যাগ, নোট, রিভিউ অনুমোদন, নিরাপদ Markdown
কনটেন্ট পাতা ও ডাবল অপ্ট-ইন নিউজলেটার যুক্ত হয়েছে।

ফেজ ৩-এর প্রথম ধাপে গুদামভিত্তিক স্টক, চলমান গড় খরচ (AVCO), ওপেনিং স্টক,
সংশোধন, দুই ধাপের স্থানান্তর ও অপরিবর্তনীয় স্টক লেজার যুক্ত হয়েছে। দ্বিতীয়
ধাপে সরবরাহকারী, ক্রয় অর্ডার ও মাল গ্রহণের নোট (GRN) যুক্ত হয়েছে—শুধু পোস্ট
করা GRN স্টক বদলায়, আর প্রতিটি ডেলিভারির প্রকৃত (landed) দামই গড় খরচে ঢোকে।
নষ্ট বা কোয়ারেন্টিন মাল গ্রহণ করলে ভৌত স্টক বাড়ে, বিক্রয়যোগ্য স্টক বাড়ে না।

তৃতীয় ধাপে কাউন্টার (POS), অর্ডার, পেমেন্ট ও ফেরত যুক্ত হয়েছে। দাম ও ভ্যাট
সার্ভারেই আবার হিসাব হয়—ব্রাউজারে বদলানো যায় না। ৫%-এর বেশি ছাড় বা অতিথি
নগদ বিক্রয়ে ম্যানেজার পিন লাগে; ইন্টারনেট না থাকলে বিক্রি আটকে যায় না, ডিভাইসে
জমা থাকে ও পরে সিঙ্ক হয়, আর ম্যানেজার পরে যাচাই করেন। নগদ টাকা কাউন্টারেই
পরিশোধিত, কিন্তু বিকাশ/নগদ/কার্ড ম্যানেজার যাচাই করার আগে অপেক্ষমাণ থাকে।
স্টক বিক্রয়ের সময়ই একবার কমে; ফেরত অনুমোদন করলে বিক্রয়ের সময়ের দামেই ফিরে
আসে; শিফট শেষে ড্রয়ার মিলিয়ে ভ্যারিয়েন্স দেখানো হয়।

মডিউল ৪এ-তে ডাবল-এন্ট্রি হিসাব যুক্ত হয়েছে। প্রতিটি বিক্রি, নগদ/ডিজিটাল
পেমেন্ট, ফেরত, মাল গ্রহণ, স্টক সংশোধন, ওপেনিং স্টক ও খরচ একটি ভারসাম্যপূর্ণ
জার্নাল পোস্ট করে। পোস্ট করা জার্নাল ডেটাবেস স্তরেই অপরিবর্তনীয়—ভুল হলে
সংশোধনী এন্ট্রি (reversal) দিয়ে ঠিক করতে হয়, সম্পাদনা বা মুছে ফেলা যায় না।
কোনো হিসাব বন্ধ বা অনুপস্থিত অর্থবছরে পোস্ট হয় না। কনসোলে জের (trial
balance), হিসাবের তালিকা, খাতা (ledger), জার্নাল ব্রাউজার ও খরচের ড্রাফট/পোস্ট/
বাতিল রয়েছে। ক্যাশিয়ার হিসাব দেখতে পারেন না; হিসাবরক্ষক দেখেন ও লেখেন, কিন্তু
কাউন্টার খুলতে পারেন না।

মডিউল ৪বি-তে লয়্যালটি পয়েন্ট যুক্ত হয়েছে। প্রতি ৳১০০ নিট পণ্যমূল্যে (ছাড়ের
পরে, ভ্যাটের আগে) ১ পয়েন্ট; ১ পয়েন্ট = ৳১। একটি বিক্রয়ে নিট পণ্যমূল্যের
সর্বোচ্চ ২০% পয়েন্টে মেটানো যায়, আর পয়েন্ট ১২ মাস পরে মেয়াদোত্তীর্ণ হয়।
পেমেন্ট পরিশোধিত (নগদে সাথে সাথে, ডিজিটালে ম্যানেজার যাচাইয়ের পরে) বা অর্ডার
সম্পন্ন হলেই পয়েন্ট জমা হয়; প্রতিটি অর্ডারে একবারই—ডেটাবেসের ইউনিক ইনডেক্স
তাই নিশ্চিত করে। অফলাইন বিক্রয়ে পয়েন্ট খরচ করা যায় না, তবে সিঙ্ক হয়ে
পরিশোধিত হলে জমা হয়। প্রতিটি পয়েন্ট আন্দোলন একটি অপরিবর্তনীয় খাতায় ও
ভারসাম্যপূর্ণ জার্নালে (দায় ১৫০০, খরচ ৫৫০০) লেখা হয়; বাতিলে ফেরত দেওয়া
পয়েন্ট ফিরে আসে ও জমানো পয়েন্ট কেটে নেওয়া হয়, আর ফেরতে আনুপাতিক হারে
কাটা হয়—বর্তমান ব্যালেন্সের বেশি নয়, তাই ব্যালেন্স কখনো ঋণাত্মক হয় না।
কনসোলে লয়্যালটি সারসংক্ষেপ ও প্রতি ক্রেতার খাতা, ম্যানুয়াল সংশোধন ও মেয়াদ
শেষ করার সুবিধা রয়েছে; ক্যাশিয়ার দেখতে পারেন কিন্তু সংশোধন করতে পারেন না।

মডিউল ৫এ-তে পাবলিক অনলাইন দোকান যুক্ত হয়েছে। যে কেউ লগইন ছাড়াই পণ্য দেখতে,
কার্টে রাখতে, কুপন লাগাতে ও এক পাতায় অর্ডার করতে পারেন—ক্যাশ অন ডেলিভারি অথবা
বিকাশ/নগদে টাকা পাঠিয়ে ট্রানজেকশন আইডি দিয়ে। অর্ডারটি কাউন্টারের মতোই একই
ইঞ্জিনে তৈরি হয়: ডিফল্ট গুদাম থেকে স্টক কমে, জার্নাল ভারসাম্যপূর্ণ হয়, আর
বিকাশ/নগদ/ক্যাশ অন ডেলিভারির টাকা ম্যানেজার যাচাই করার আগে অপেক্ষমাণ থাকে।
কুপন পণ্যমূল্য (ভ্যাটসহ)-এর ওপর হিসাব হয়, ফ্রি শিপিং কুপন ডেলিভারি চার্জ কমায়;
কুপনটি লক করে একই ট্রানজেকশনে রিডিম করা হয়, তাই দুইজন একসাথে শেষ কুপনটি খরচ
করতে পারেন না। ডেলিভারি জোন, জেলার চার্জ ও ফ্রি-শিপিং থ্রেশহোল্ড সিডে দেওয়া
আছে। অর্ডারের লিংক সাত দিনের সই করা টোকেনে সুরক্ষিত; `/track`-এ অর্ডার নম্বর
ও মোবাইল দিয়ে নতুন লিংক নেওয়া যায়। বাতিল করলে স্টক ফিরে আসে, কুপন মুক্ত হয়
ও অপেক্ষমাণ পেমেন্ট বাতিল হয়। এখনো ক্রেতার লগইন বা অনলাইনে পয়েন্ট খরচ নেই।

৮১টি ইউনিট টেস্ট, ১৪টি দোকান HTTP যাচাই, ৯টি লয়্যালটি HTTP যাচাই, ১২টি হিসাব
যাচাই, ১৩টি বিক্রয় যাচাই, ৯টি স্টক যাচাই, ৯টি ক্রয় যাচাই, ৯টি লগইন যাচাই,
৮টি ক্যাটালগ যাচাই, ৮টি CRM/CMS যাচাই ও ১০টি ডেটাবেস নিয়ম যাচাই সফল। অনলাইন
দোকান (৫এ) ও লয়্যালটি (৪বি) অনুমোদিত। হোয়াটসঅ্যাপ (৪সি) আপনার নির্দেশে আপাতত
বন্ধ, ও তার তথ্য পেলে শুরু হবে।

মডিউল ৫বি-তে কুরিয়ার ও চালান যুক্ত হয়েছে। কুরিয়ার তালিকায় ম্যানুয়াল,
পাঠাও, স্টেডফাস্ট ও রেডএক্স আছে; এখন শুধু ম্যানুয়াল কুরিয়ার দিয়ে বুকিং হয়,
বাকিগুলোর এপিআই আপনার তথ্য পেলে চালু হবে। শুধু “ready to ship” অর্ডার একবার
বুক করা যায়—একই অর্ডারের দুটি সক্রিয় চালান ডেটাবেসই আটকে দেয়। বুকিং করলে
অর্ডার শিপড হয় না; কুরিয়ার পিকআপ বা ট্রানজিট ইভেন্ট দিলে শিপড হয়, ডেলিভারি
ইভেন্ট দিলে ডেলিভারড হয়। কুরিয়ার ফেরত বা ব্যর্থতা অর্ডারের স্টক/টাকা নিজে
বদলায় না—ফেরত ডকুমেন্টই তা ঠিক করে। ট্র্যাকিং ইভেন্টের ইতিহাস কখনো বদলায়
না। ক্যাশ অন ডেলিভারির টাকা যাচাইয়ের পর ১০৬০ কুরিয়ার সিওডি খাতায় জমা থাকে;
কুরিয়ার টাকা ফেরত দিলে একটি ভারসাম্যপূর্ণ জার্নালে তা নগদ বা ব্যাংকে নেওয়া
হয়। ক্যাশিয়ার চালান দেখতে পারেন কিন্তু বুক করতে বা সিওডি জমা দিতে পারেন না।

মডিউল ৫সি-তে তিনটি আর্থিক বিবরণী যুক্ত হয়েছে: লাভ-ক্ষতি, উদ্বৃত্তপত্র ও নগদ
প্রবাহ। সব সংখ্যাই পোস্ট করা জার্নালের যোগফল—আলাদা কোনো হিসাব নেই, তাই বিবরণী
আর খাতা কখনো মিলবে না এমন হতে পারে না। ছাড় ও ফেরত ঋণাত্মক দেখায়, তাই নিট
আয় নিজেই কমে যায়; কোনো ভুল সংশোধন করলে বিপরীত জার্নাল নিজেই সমন্বয় করে দেয়।
এখনো বছর-শেষ ক্লোজিং এন্ট্রি নেই, তাই সঞ্চিত মুনাফা ইকুইটির ভেতরে দেখানো হয়
এবং উদ্বৃত্তপত্র যেকোনো তারিখে মিলে যায়। নগদ হিসাবে শুধু নগদ, ব্যাংক, বিকাশ,
নগদ ও কার্ড ক্লিয়ারিং ধরা হয়—প্রাপ্য বা কুরিয়ার সিওডি নগদ নয়। তারিখগুলো
ঢাকার দিন অনুযায়ী হিসাব হয়, সার্ভারের UTC নয়। ক্যাশিয়ার এই বিবরণী দেখতে
পারেন না; হিসাবরক্ষক ও মালিক দেখতে পারেন।

মডিউল ৬-এ সরবরাহকারীর হিসাব নিষ্পত্তি যুক্ত হয়েছে। মাল গ্রহণের পর সরবরাহকারীকে
যত টাকা দিতে হয় তা কোথাও আলাদা করে জমা রাখা হয় না—পোস্ট করা জার্নালের ১৩০০
হিসাবে ওই সরবরাহকারীর নামে লেখা লাইনগুলোর যোগফলই পাওনা। তাই খাতা ও পাওনার
তালিকা কখনো আলাদা হতে পারে না। পরিশোধের টাকা পাওনার বেশি হতে পারে না; দুইজন
একসাথে শেষ টাকাটা খরচ করতে না পারে বলে সরবরাহকারীর সারি লক করা হয়। কালো
তালিকাভুক্ত সরবরাহকারীকে টাকা দেওয়া যায় না। মাল ফেরত দিলে স্টক গড় দামে কমে
এবং ঠিক সেই মূল্যেই সরবরাহকারীর পাওনা কমে—ড্রাফটে দেখানো দাম শুধু আনুমানিক,
অনুমোদনের সময় স্টক খাতার প্রকৃত মূল্য বসে। একই মাল দুইবার ফেরত দেওয়া যায় না,
কারণ প্রতিটি গ্রহণ লাইনে কত ইউনিট ইতিমধ্যে ফেরত গেছে তা লেখা থাকে। সরবরাহকারী
টাকা ফেরত দিলে সেটি আলাদা জার্নালে নগদ/বিকাশ/ব্যাংকে নেওয়া হয়। প্রতিটি
সরবরাহকারীর জন্য বিবরণী পাতা আছে—প্রতিটি লেনদেন, ডেবিট, ক্রেডিট ও ক্রমবর্ধমান
ব্যালেন্স সহ। ক্যাশিয়ার কিছুই দেখতে পান না; হিসাবরক্ষক দেখতে পারেন কিন্তু
টাকা লেখা বা ফেরত অনুমোদন করতে পারেন না; স্টক কিপার ও মালিক পারেন।

মডিউল ৭-এ খোদাই ও অর্ডারভিত্তিক উৎপাদন যুক্ত হয়েছে। প্রতিটি অর্ডার লাইনের জন্য
আলাদা কাজ তৈরি হয়—ডিজাইন প্রুফ, অনুমোদন, উপকরণ বের করা, মান যাচাই ও হস্তান্তর।
ডিজাইনের প্রতিটি সংশোধন নম্বরসহ জমা থাকে; প্রথম সংশোধনেই কাজটি ডিজাইন ধাপে
যায়, অনুমোদনের জন্য পাঠালে আগের অপেক্ষমাণ অনুমোদন বাতিল হয়, আর অনুমোদন হলে
খোদাইয়ের কাস্টমাইজেশনও অনুমোদিত হয়। উপকরণ শুধু স্টকভুক্ত ভ্যারিয়েন্ট হয় এবং
কাজের গুদাম থেকে চলমান গড় দামে বের হয়; একই পণ্য নিজের উপকরণ হতে পারে না।
বের করা উপকরণের মূল্য ১১৩০ চলমান উৎপাদন হিসাবে জমা থাকে—জার্নালে ডেবিট ১১৩০,
ক্রেডিট ১১০০। কাজ শেষ হলে পুরো মূল্য ৫০০০ বিক্রীত পণ্যের খরচে যায়, তাই ১১৩০
শূন্য হয়। মাঝপথে বাতিল করলে উপকরণ যে দামে বের হয়েছিল সেই দামেই স্টকে ফিরে
আসে (ডেবিট ১১০০, ক্রেডিট ১১৩০)। সব উপকরণ বের না হলে উৎপাদন শুরু করা যায় না।
উৎপাদন ও চালান আলাদা—কাজ প্রস্তুত থাকলেও কুরিয়ার বুকিং আলাদা, আবার চালান এগিয়ে
গেলেও মান যাচাই চলতে পারে। ক্যাশিয়ার ও হিসাবরক্ষক উৎপাদন দেখতে পান না; স্টক
কিপার ও মালিক পুরো কাজ চালাতে পারেন।

মডিউল ৮-এ ড্রপশিপিং যুক্ত হয়েছে। যে পণ্য গুদামে থাকে না, সেটি বিক্রি হলে একই
ট্রানজেকশনে সরবরাহকারীর একটি ক্রয় অর্ডার তৈরি হয়—প্রতি সরবরাহকারীর জন্য আলাদা,
ভ্যারিয়েন্টের ড্রপশিপ দামে। অর্ডারটি খসড়া, পাঠানো, সরবরাহকারী নিশ্চিত, পাঠানো
ও ডেলিভারি ধাপে চলে; মাল গুদামে আসে না, তাই কোনো GRN বা স্টক লেনদেন নেই। ক্রেতার
টাকা বাকি থাকলে সরবরাহকারী পাঠানোর ধাপ আটকে যায়—ড্রপশিপ শুধু আগে-পরিশোধে চলে।
সরবরাহকারী পাঠালে একবারই ৫০১০ ড্রপশিপ বিক্রীত পণ্যের খরচ ডেবিট ও ১৩০০
সরবরাহকারী পাওনা ক্রেডিট হয়, আর গুদাম ছাড়া সরাসরি চালান তৈরি হয়। ডেলিভারি হলে
চালান, অর্ডার ও সরবরাহকারী অর্ডার সব বন্ধ হয়। পাঠানোর আগে বাতিল করা যায়; পাঠানোর
পরে অর্ডার বাতিল আটকে যায় এবং ফেরত প্রক্রিয়াই পথ। সরবরাহকারীর পাওনা আগের
নিষ্পত্তি বিবরণীতেই দেখা যায়, আলাদা হিসাব নেই। সাধারণ ক্রয় তালিকা ড্রপশিপ অর্ডার
দেখায় না—সেগুলোর নিজের পাতা আছে। হিসাবরক্ষক দেখতে পারেন, ক্যাশিয়ার পারেন না;
স্টক কিপার ও মালিক পুরো কাজ চালাতে পারেন।

মডিউল ৯-এ অনলাইন ক্রেতার অ্যাকাউন্ট যুক্ত হয়েছে। মোবাইল নম্বরই পরিচয়—আগে অতিথি
হিসেবে অর্ডার করা নম্বর দিয়েই রেজিস্ট্রেশন করলে ওই পুরনো ক্রেতা রেকর্ডটিই
দাবি হয়, নতুন করে ডুপ্লিকেট তৈরি হয় না। ওই নম্বরে আগের অর্ডার থাকলে তার একটি
অর্ডার নম্বর দিতে হয়, নইলে অন্য কেউ নম্বরটি জেনে ইতিহাস দখল করতে পারত। আলাদা
`bgd26_customer` কুকি দিয়ে ড্যাশবোর্ড, অর্ডারের ইতিহাস, সংরক্ষিত ঠিকানা, পয়েন্ট
খাতা ও প্রোফাইল খোলে; স্টাফ সেশন বা অতিথির অর্ডার টোকেন দিয়ে এই কুকি জাল করা
যায় না। এক অ্যাকাউন্ট অন্য অ্যাকাউন্টের অর্ডার দেখতে পায় না—অর্ডার আইডি শুধু
খোঁজার চাবি, মালিকানা `customerId` দিয়েই যাচাই হয়, নইলে ৪০৪। লগইনে পাঁচবার
ভুল পাসওয়ার্ডে ১৫ মিনিট লক; পাসওয়ার্ড বদলাতে পুরনো পাসওয়ার্ড লাগে। মোবাইল নম্বর
নিজে বদলানো যায় না—দোকানই বদলায়। প্রথম ঠিকানাটিই ডিফল্ট; নতুন ডিফল্ট দিলে
পুরনোটি সরে যায়, ডিফল্ট মুছলে বাকি ঠিকানার সর্বশেষটিই ডিফল্ট হয়। লগইন করা
ক্রেতার চেকআউটে অ্যাকাউন্টের নম্বরই বাধ্যতামূলকভাবে বসে, তাই পয়েন্ট বা অর্ডার
অন্য নম্বরে যেতে পারে না; সংরক্ষিত ঠিকানা ফর্ম ভরে দেয় এবং নিট পণ্যমূল্যের
সর্বোচ্চ ২০% পর্যন্ত পয়েন্ট খরচ করা যায়। ব্রাউজারে দেখানো সংখ্যা শুধু preview—
বিক্রয়ের ভেতরে আসল ব্যালেন্স ও সীমা আবার যাচাই হয়। পাসওয়ার্ড ভুলে গেলে এখন
দোকানে যোগাযোগ করে ম্যানুয়ালি রিসেট করাতে হয়; এসএমএস/হোয়াটসঅ্যাপ চ্যানেল
এখনো নেই।

মডিউল ১০-এ স্টাফ কনসোলের সহায়ক যুক্ত হয়েছে। এটি পণ্যের দাম ও স্টক, ডেলিভারি
চার্জ এবং অর্ডারের অবস্থা সরাসরি ডেটাবেস থেকে বলে, আর চাইলে একটি **ড্রাফট**
অর্ডার তৈরি করে। টাকা নেওয়া, ফেরত দেওয়া, ছাড় দেওয়া, স্টক বদলানো বা জার্নাল
পোস্ট করা এর ক্ষমতা নেই। চারটি অনুমোদিত টুল ছাড়া এটি কিছুই চালাতে পারে না—
প্রতিটির নিজস্ব যাচাই ও সার্ভারে পারমিশন চেক আছে; অজানা টুল ব্লক হয়ে অডিটে
লেখা হয়। বাইরের মডেল ছাড়াই একটি লোকাল নিয়ম-ইঞ্জিন কাজ করে, তাই কোনো API key
না থাকলেও সহায়ক চলে; `AI_PROVIDER=openai` ও key দিলে OpenAI-সামঞ্জস্যপূর্ণ
মডেল ব্যবহার হয়, key না থাকলে আবার লোকাল ইঞ্জিনে ফিরে যায় এবং কনসোল তা জানায়।
দাম, ভ্যাট, স্টক, ডেলিভারি চার্জ ও অর্ডারের অবস্থা কখনো মডেল ঠিক করে না—সবই
সার্ভারে ডেটাবেস থেকে পড়া হয়। ড্রাফট অর্ডার সত্যিকারের `Order` হলেও শুধু
`DRAFT`: স্টক আটকায় না, পেমেন্ট তৈরি হয় না, জার্নাল পোস্ট হয় না, লয়্যালটি
জমা হয় না, ড্রপশিপ ক্রয় অর্ডারও ওঠে না। ড্রাফট সরাসরি কনফার্ম করা যায় না—
রূপান্তর করলে সাধারণ বিক্রয় ইঞ্জিন আবার সব লাইনের দাম যাচাই করে, স্টক আটকায়,
জার্নাল পোস্ট করে ও অপেক্ষমাণ পেমেন্ট তৈরি করে; তারপর ড্রাফটটি বাতিল হিসেবে
বন্ধ হয়। ড্রাফট বাতিল করলে শুধু স্টেটাস বদলায়, তাই যে মাল কখনো বের হয়নি তার
জন্য ভুয়া স্টক ফেরত লেখা হয় না। প্রতিটি টুল কল—সফল, ব্লক বা ত্রুটি—অডিট
লগে লেখা হয়, মোবাইল নম্বর মাস্ক করা থাকে। প্রতি ঘণ্টায় ব্যবহারের সীমা
ডেটাবেস থেকেই গোনা হয়, তাই সার্ভার রিস্টার্টে রিসেট হয় না; প্রদানকারী ব্যর্থ
হলে সহায়ক মানুষকে হস্তান্তর করে, কখনো বিক্রি বা কাউন্টার আটকায় না। ক্যাশিয়ার
শুধু পড়তে পারেন, ড্রাফট তৈরি বা রূপান্তর করতে পারেন না।

১৪৫টি ইউনিট টেস্ট, ১১টি সহায়ক HTTP যাচাই, ১৫টি অ্যাকাউন্ট HTTP যাচাই, ১৪টি
ড্রপশিপ HTTP যাচাই, ১১টি উৎপাদন HTTP যাচাই, ১১টি সরবরাহকারী নিষ্পত্তি HTTP
যাচাই, ৮টি বিবরণী HTTP যাচাই, ১০টি চালান HTTP যাচাই, ১৪টি দোকান HTTP যাচাই,
৯টি লয়্যালটি HTTP যাচাই, ১২টি হিসাব যাচাই, ১৩টি বিক্রয় যাচাই, ৯টি স্টক যাচাই,
৯টি ক্রয় যাচাই, ৯টি লগইন যাচাই, ৮টি ক্যাটালগ যাচাই, ৮টি CRM/CMS যাচাই ও ১০টি
ডেটাবেস নিয়ম যাচাই সফল। চালান (৫বি), লয়্যালটি (৪বি), হিসাব (৪এ), আর্থিক
বিবরণী (৫সি), সরবরাহকারী নিষ্পত্তি (৬), উৎপাদন (৭), ড্রপশিপ (৮) ও ক্রেতার
অ্যাকাউন্ট (৯) অনুমোদিত; সহায়ক (১০) আপনার অনুমোদনের অপেক্ষায়। হোয়াটসঅ্যাপ
(৪সি) আপনার নির্দেশে আপাতত বন্ধ, ও তার তথ্য পেলে শুরু হবে।

