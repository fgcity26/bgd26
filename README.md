# bgd26

Unified business operating system for Bangladesh: storefront, counter POS with
offline sync, multi-warehouse inventory, engraving production, CRM and loyalty,
double-entry accounting, WhatsApp and an AI assistant — on one order, one stock
ledger and one set of books.

**Status:** Phase 2 complete and approved — modules 1–4 (scaffold, database,
seed, authentication, RBAC, catalog, zero-transform media, CRM, reviews, CMS and
newsletter). Phase 3 module 1 — multi-warehouse inventory, opening stock,
adjustments, transfers, AVCO and the append-only stock ledger — is complete and
approved. Phase 3 module 2 — suppliers, purchase orders and goods-received notes
— is complete and approved. Phase 3 module 3 — POS devices, shifts, the offline
till, orders, the payment lifecycle and refunds — is complete and approved
(19 Nov 2026). Phase 3 module 4a — double-entry accounting journals, the chart
of accounts, expenses, trial balance and ledger — is complete and approved.
Phase 3 module 4b — loyalty points, redemption, expiry and the ledger — is
complete and approved (19 Nov 2026). Phase 3 module 5a — the public storefront,
guest cart, coupons, delivery zones and guest online checkout — is complete and
approved (19 Nov 2026). Phase 3 module 5b — couriers, consignments, tracking and
COD remittance — is complete and approved (19 Nov 2026). Phase 3 module 5c — the
profit and loss, balance sheet and cash-flow statements — is complete and
approved (19 Nov 2026). Phase 3 module 6 — supplier payments, purchase returns
and the payables statement — is complete and approved (19 Nov 2026). Phase 3
module 7 — engraving production, design approval, work in progress and material
issue — is complete and approved (19 Nov 2026). Phase 3 module 8 — prepaid
dropshipping, supplier orders, direct shipments and dropship cost of goods sold —
is complete and approved (20 Nov 2026). Phase 3 module 9 — customer accounts,
saved addresses, order history and online loyalty redemption — is complete and
approved (22 Nov 2026). Phase 3 module 10 — a read-and-draft AI assistant with
live product, delivery and order lookups — is complete and awaits owner
approval. WhatsApp notifications (4c) are skipped until their credentials
arrive. See `docs/PHASE_2_STATUS.md`.

## Requirements

- Node.js 22+ (tested on 26) and npm 10+
- A PostgreSQL 15+ database — Supabase in production, any local Postgres for
  development
- Python 3 only for the offline schema checker (optional)

## Setup

```bash
# 1. Install dependencies (also generates the Prisma client)
npm install

# 2. Create your local environment file
cp .env.example .env.local
#    Fill DATABASE_URL (pooled, port 6543) and DIRECT_URL (direct, port 5432).
#    Easiest: npm run env:setup  (interactive, never echoes secrets)
#    Never commit .env.local — .gitignore already blocks it.
#    Check it with: npm run env:check

# 3. Apply migrations (uses DIRECT_URL)
npm run db:deploy

# 4. Seed reference data: roles, chart of accounts, warehouse, store,
#    categories and the first owner account
npm run db:seed

# 5. Run the app
npm run dev
```

### No Supabase yet? Use the bundled local database

```bash
npm run db:local:setup   # starts local PostgreSQL and writes .env.local for you
npm run db:deploy && npm run db:seed && npm run dev
```

Open <http://localhost:3000> and check <http://localhost:3000/api/health>.

### Sign in

`owner@bgd26.com` / `Bgd26!ChangeMe` — the app forces a new password on first
sign-in. Set a six-digit manager PIN on `/profile` afterwards (it authorises
discounts above 5 %, walk-in cash sales and payment verification).

Authentication uses the `AuthAdapter` port (`src/lib/adapters/auth/`): `local`
checks `users.passwordHash` with scrypt, `supabase` delegates the password to
Supabase Auth. Choose with `AUTH_PROVIDER`; development defaults to `local`,
production to `supabase`. Sessions are HMAC-signed `HttpOnly` cookies, and every
page and server action re-checks permissions on the server.

The development seed creates `owner@bgd26.com` with a temporary password
(`Bgd26!ChangeMe`, manager PIN `123456`) unless `SEED_OWNER_PASSWORD` and
`SEED_OWNER_PIN` are set. Change both before any real use.

Seeding a **remote** database requires both `SEED_ALLOW_PROD=true` and an
explicit `SEED_OWNER_PASSWORD`; a `localhost` target needs neither. The guard
reads the connection string, not `NODE_ENV`, because `prisma db seed` does not
reliably forward it.

## Catalogue and media

Products live under **Products**, categories under **Categories**. A product is
created as a draft; publishing needs `product.publish`, archiving needs
`product.delete`. Every product starts with one default variant so POS,
inventory and pricing have a stable SKU.

Prices are stored VAT-inclusive and computed in integer paisa, so a 15 % category
rate cannot produce floating-point drift. The rate is copied onto each sale, so
changing a category later never rewrites history. `costPrice` is returned only to
roles with `account.read` or `report.read`.

Images follow one rule: **the gallery serves the exact bytes that were
uploaded.** JPEG, PNG, WebP and AVIF are accepted up to 20 MB; SVG and PDF are
rejected. After writing, the server re-reads the object and compares its SHA-256
and size — a mismatch fails the upload. Nothing is resized, cropped,
recompressed or stripped.

On Supabase the browser uploads each original straight to a short-lived signed
URL, then the server adopts the object, re-validates the magic bytes and records
the SHA-256 before linking it. This keeps 20 MB originals working on serverless
platforms, whose request bodies are capped at 4.5 MB. The local provider keeps
the multipart form because there is no signed-URL equivalent on disk.

Storage is an adapter (`src/lib/adapters/storage/`):

| Provider | Use | Where bytes go |
| --- | --- | --- |
| `local` | development, single self-hosted server | `.data/media` (gitignored) |
| `supabase` | production | Supabase Storage bucket `bgd26-media` |

Choose with `STORAGE_PROVIDER=local|supabase`; production defaults to Supabase.
Originals are served by `/media/[...key]` with a one-year immutable cache and a
SHA-256 `ETag`, because keys are random and never reused. Removing an image from
a product unlinks it only; the asset row and bytes are kept.

The local storage path is runtime data, not build input, so every filesystem call
is marked `/* turbopackIgnore: true */` — otherwise Turbopack traces the whole
project into the build.

### Sample catalogue

A new shop needs something to look at. `npm run sample:catalog` seeds twelve
published products — engraved wood and acrylic gifts, wall clocks (including a
personalised photo clock), three gadgets and two gift bundles — with Bangla
names, VAT-inclusive prices, one default variant each and opening stock posted
to the ledger. It is idempotent: run it again and it updates the same rows.

```bash
npm run sample:catalog            # images → Supabase Storage, stock posted
npm run sample:catalog:local      # same, but bytes stay on disk
npm run sample:catalog:archive    # archive all of it; stock and media are kept
```

The product photos currently shipped are **locally rendered placeholders**
(`scripts/sample-images.py`, tagged `SAMPLE PHOTO`, 1000 × 1000 JPEG). They carry
no third-party rights and exist so the storefront is presentable before the
owner's own photography arrives. Replace them one by one on each product page:
uploading a new image makes it primary, and the placeholder can then be removed
from the gallery (the asset row itself is kept, by rule).

## Inventory and stock ledger

Stock lives under **Inventory**, one balance row per variant and warehouse.
Opening stock is posted once per pair by a manager (`inventory.approve`) and sets
the moving average cost (AVCO, 4 decimals). Later corrections are adjustments:
`INCREASE`, `DECREASE`, `DAMAGE`, `QUARANTINE` or `WRITE_OFF`. A draft changes
nothing; posting it writes the ledger row. Only drafts can be voided, because a
posted movement is corrected by a new adjustment, never edited.

Damage and quarantine keep physical stock on hand while reducing what is
available; write-off consumes damaged units first, then sellable units, and never
touches reserved stock. Transfers move in two steps — send posts stock out of the
source, receive values it into the destination at the exact source cost — so stock
is never lost while a van is between warehouses. Cancelling in transit returns it
with a compensating ledger row.

`stock_ledger` is append-only at the database level, and every balance row is
locked `FOR UPDATE` inside the document transaction. Cashiers can read balances
and documents but cannot change stock; stock value, AVCO and unit cost are
omitted from their responses unless the role has `account.read` or `report.read`.

## Suppliers and purchasing

Suppliers live under **Suppliers**, purchase orders and receipts under
**Purchases**. Suppliers carry a code, English and Bangla names, a canonical
Bangladeshi mobile, payment terms, lead time and a dropship flag. They are never
deleted: set the status to `INACTIVE` or `BLACKLISTED`.

A purchase order is a promise, not a stock movement. It starts `DRAFT`, is sent
when agreed with the supplier, and only a draft can be edited. Receiving goods
creates a goods-received note (GRN) that starts as a draft; posting it claims the
document, locks the ordered lines `FOR UPDATE`, re-checks the outstanding
quantity and appends `PURCHASE_RECEIPT` movements. The order then moves to
`PARTIALLY_RECEIVED` or `RECEIVED`.

The GRN line's unit cost is the **landed** cost — ordered cost plus freight, duty
or handling for that delivery — and that is what enters AVCO. Damaged or
quarantined units post `PURCHASE_RECEIPT` and then `DAMAGE` or `QUARANTINE`, so
physical stock rises while available stock does not. A draft GRN subtracts its
quantities from the receive form, so two drafts cannot promise the same unit, and
over-receipt is refused at both create and post.

Drafting needs `purchase.write`; sending, cancelling, closing and posting a GRN
need `purchase.approve`. Accountants read purchasing without raising or receiving;
cashiers see none of it. A posted GRN is immutable — a correction is a purchase
return.

### Supplier settlement

**Purchases → Payments** records money paid to a supplier, and **Purchases →
Returns** sends goods back against a posted receipt. The supplier page carries a
payable card and a **Statement** link.

The payable is never stored. It is the supplier's share of account `1300 Accounts
Payable` in the posted journal (`src/lib/purchasing/settlement.ts`), so the
statement and the ledger cannot disagree. A payment needs `purchase.approve`,
cannot exceed the outstanding balance, locks the supplier row while it checks,
and posts DR `1300` / CR cash, bKash, Nagad, bank, cheque or card. A blacklisted
supplier cannot be paid. COD is not a payment method — it is money coming in.

A return is created from a posted receipt, so its quantities and cost come from
what actually arrived. Saving it makes a draft; approval appends `PURCHASE_RETURN`
stock movements at AVCO and posts DR `1300` / CR `1100` for exactly the value the
ledger released — the draft's total is only an estimate. Each received line
remembers `returnedQty`, so the same unit cannot go back twice. Completing an
approved return can record the supplier's cash refund (DR cash / CR `1300`),
which is what clears a credit after goods that were already paid for went back.

`/suppliers/[id]/statement` lists every posted movement with debit, credit and a
running balance. Accountants read settlement pages but cannot record a payment
or approve a return; cashiers are refused.

## Production

**Production** tracks engraving and made-to-order work per order line. A job
moves through pending design, design preparation, customer approval, approved,
production, quality check, ready to ship and completed; it can be cancelled from
any open state. A second live job on the same line is refused, and dropship
lines are not produced here.

Design revisions are numbered per job. The first revision moves the job out of
pending design; sending for approval expires any earlier pending approval;
approval marks the engraving customization approved; requesting changes sends the
job back to design. Approval is recorded by the manager for now — the schema
already carries an approval token for a public proof link later.

Components are stocked variants taken from the job's warehouse at AVCO through
`PRODUCTION_ISSUE`. Issue posts DR `1130 Work in Progress` / CR `1100 Inventory`
and is idempotent, so only the outstanding quantity moves. Production cannot
start until every component is issued. Completing the job posts DR `5000 Cost of
Goods Sold` / CR `1130` for the remaining value; cancelling after issue appends
`PRODUCTION_RETURN` inbound movements and posts DR `1100` / CR `1130` for exactly
what came back. The finished unit is not received into stock again — it already
left when it was sold, so production only adds the engraving cost.

`/production` lists jobs with design, production, ready and done filters.
`/production/[id]` shows the brief, revisions, components, work-in-progress value,
journal entries and status history. Production and shipping stay independent: a
job can be ready before a courier is booked, and a shipment can move while
quality check is open. `STOCK` can run production; `ACCOUNTANT` and `CASHIER`
are refused.

## Dropshipping

**Dropship** sells a variant that is never stocked; the supplier ships straight to
the customer. When an online sale contains dropship lines, the sale raises one
`DROPSHIP` purchase order per supplier in the same transaction, at the variant's
`dropshipCost` (falling back to its cost price). The supplier order points back
to the sale and to the exact sale line, and it has no warehouse.

The console at `/purchases/dropship` lists supplier orders with open, in-transit
and delivered counts. A supplier order moves draft, sent, confirmed, shipped and
delivered; it can be cancelled only before shipping. Shipping is refused while
the customer still owes money, because dropship is prepaid only. Marking the
supplier order shipped posts **DR `5010` Dropship Cost of Goods Sold / CR `1300`
Accounts Payable** once, creates a `DROPSHIP_DIRECT` shipment with no warehouse
and the supplier's tracking number. The sale becomes ready on the first
supplier dispatch and shipped only when every live supplier order has shipped;
delivery closes each parcel and the sale becomes delivered and fulfilled when
the last one arrives.

The supplier order is never received into stock: there is no GRN, no received
quantity and no inventory movement. The shipping journal is the only cost
movement, and the supplier's share of `1300` is what the existing settlement
statement and payables balance read. Standard `/purchases` hides dropship orders;
`/purchases/[id]` redirects them to their own detail page. `STOCK` can run
dropship orders, `ACCOUNTANT` can read, and `CASHIER` is refused.

## Counter, orders and payments

The till lives under **POS till**, orders under **Orders**, and the verification
queue under **Payments**. A device is registered once per counter and names the
warehouse its stock leaves from; a shift opens with a cash float and closes
against a counted drawer, storing the variance.

The counter prices every line on the server: B2C prices are VAT-inclusive, VAT is
extracted before the discount, and the order keeps
`subtotal + vat − discount + delivery = grand total`. A cashier may discount up
to 5 % of the gross sale; anything above that, and every walk-in cash sale
(blank mobile), needs a six-digit manager PIN from an active user holding
`order.approve`. A blank mobile is a cash-only, fully paid, POS-only sale and the
database enforces the same rule.

Offline is a first-class mode. The device caches a bounded catalogue, queues
sales in `localStorage` and replays them with the same `clientTransactionUuid`
(unique, so a retry can never double-sell). A queued sale is **never rejected**:
if it needed a PIN it is stored with `approvalDeferred` and an
`order.offline.approval_required` audit row for a manager to review, and only an
offline sale may drive stock negative. The PIN itself is never written to disk.

Stock leaves once per stocked line as a `SALE` movement when the sale is created;
non-stock lines never move stock. Cash is `PAID` at the drawer (`CASH_DRAWER`),
while bKash, Nagad, card and bank transfer stay `PENDING_VERIFICATION` until a
manager verifies them — `paidAmount` counts only `PAID`, so a pending payment
leaves the order `PENDING_VERIFICATION` with the money still due.

Refunds are a three-step document: request (nothing moves), approve (restock at
the sale-time cost via `SALE_RETURN`), complete (settle the order to `REFUNDED`).
Partial quantities are tracked per line. Cancelling an order returns its stock the
same way, and the ledger row is never edited.

Cashiers run the till and may request refunds but cannot read the refund list or
approve anything; accountants read orders, payments and refunds but cannot open
the till. `/api/pos/search` and `/api/pos/catalog` answer 401 anonymously, 403
without `pos.read`, and never return cost price.

## Accounting

Accounting lives under **Accounting**: trial balance, chart of accounts, account
ledger, journals and expenses. Every money event the system already records posts
through one engine (`src/lib/accounting/journal.ts`), so the books cannot drift
away from sales, stock and purchasing.

A sale posts one balanced entry: receivable, sales discount and cost of goods
sold on the debit side; product sales, VAT payable, delivery revenue and
inventory on the credit side. A cash receipt posts separately against the
payment, while a bKash, Nagad, card or bank payment posts nothing until a manager
verifies it. Cancelling reverses the sale and every paid receipt. A refund
returns inventory and COGS on approval, then sales returns and VAT payable on
payout. A posted GRN raises inventory and accounts payable at the landed value.
Opening stock posts against owner's equity, adjustments post against inventory
shrinkage, and a warehouse transfer posts nothing because value stays inside
inventory. Expenses are drafted, posted by a manager, and voided by reversal.

Posted entries are immutable at the database level: a trigger rejects an
unbalanced entry, and posted entries and lines can never be updated or deleted.
A correction is a new reversal entry pointing at the original through
`reversalOfId`, which is unique. Posting also requires an `OPEN` fiscal period
covering the entry date, so a closed year cannot be changed by a late sale.

Accountants need `account.read/write/approve` and `expense.read/write/approve`;
they can keep the books but still cannot open the till. Cashiers have no
accounting access and are redirected to `/forbidden`.

### Financial statements

**Accounting → Reports** carries the three statements:

| Statement | Route | Reads |
| --- | --- | --- |
| Profit and loss | `/accounting/reports` | Revenue, cost of sales (`5000`–`5030`), gross profit, operating expenses and net profit for a date range |
| Balance sheet | `/accounting/reports/balance-sheet` | Assets, liabilities and equity at the end of a Dhaka day, with an "Accumulated earnings" line and a balanced/out-by badge |
| Cash flow | `/accounting/reports/cash-flow` | Every posted entry that moves cash, bank, bKash, Nagad or card clearing, split into operating and financing, with opening and closing cash |

Every figure is a sum of `journal_entry_lines` on `POSTED` entries
(`src/lib/accounting/reports.ts`), so the statements cannot disagree with the
ledger and a reversal nets out on its own. Signs are natural: revenue is
credit-positive, so `Sales Discounts` shows as a negative and reduces net
revenue. There are no closing entries yet, so cumulative profit is presented as
accumulated earnings inside equity, which keeps the balance sheet balanced at any
date.

Cash is deliberately narrow: `1000` cash, `1010` bank, `1020` bKash, `1030`
Nagad and `1040` card clearing. Receivables (`1050`) and courier COD clearing
(`1060`) are claims, not cash. An entry that only moves money between two cash
accounts nets to zero and is omitted. An entry touching an `EQUITY` account is
`FINANCING`; everything else is `OPERATING` — there are no fixed-asset accounts,
so nothing is classified as investing.

Report ranges are Dhaka days (`+06:00`), not server UTC days. Reading needs
`report.read`, which `OWNER` and `ACCOUNTANT` hold and `CASHIER` does not.

## Loyalty

Loyalty lives under **Loyalty**. One point is worth ৳1 and a customer earns one
point per complete ৳100 of net merchandise (`subtotal − discountTotal`: after
discount, before VAT). Points accrue once per order when the payment becomes
`PAID` (cash at the drawer, digital on manager verification) or the order reaches
`COMPLETED`; a partial unique index makes a retry idempotent.

A sale may redeem at most 20 % of its net merchandise, further limited by the
live balance. The till previews the balance and the cap through
`/api/pos/loyalty`, and `createSale` re-reads both inside the sale transaction.
A signed-in customer sees the same cap at checkout and spends points through the
same engine; `/account/loyalty` shows the balance and the append-only ledger.
A walk-in, a blocked customer and a soft-deleted customer cannot redeem. An
offline sale cannot redeem but still earns when it syncs and is paid.

Points expire twelve months after they are earned. The expiry job is aggregate
and idempotent: it expires only the balance that no still-live movement covers,
so running it twice cannot expire the same points twice. A manual adjustment by
a manager can grant or correct points; a correction cannot take the balance below
zero.

Every movement is an append-only `loyalty_transactions` row, and the cached
`customers.loyaltyPointsBalance` only moves with it. Earn posts DR 5500 Loyalty
Expense / CR 1500 Loyalty Points Liability; a redemption is a DR 1500 line inside
the sale entry; expiry and claw-back post DR 1500 / CR 5500. Cancelling restores
redeemed points without a second journal and claws back earned points; a refund
reverses the earned share in proportion to the amount refunded, capped by the
current balance.

Reading the overview and ledger needs `customer.read`; manual adjustments and
expiry need `customer.approve`. A cashier reads loyalty but cannot adjust points,
and redeems only by making a sale.

## Storefront and guest checkout

The public shop lives at `/` with the catalogue at `/shop`, product pages at
`/product/[slug]`, the cart at `/cart`, checkout at `/checkout` and tracking at
`/track`. It shares the database and the order engine with the console: an
online order is created by the same `createSale` as a counter sale, so stock,
journals, payments and loyalty cannot drift apart.

A login is optional. The mobile number identifies the shopper — normalised to
`+8801XXXXXXXXX`, an existing customer is reused and a new one is created as a
retail customer. A guest can still check out with only a mobile; module 9 adds
an account on top (see **Customer accounts**). The cart is anonymous: a random
token in the `bgd26_cart` cookie (`HttpOnly`, `Lax`, `Secure` in production, 30
days) points at a database cart. Prices are re-read from the catalogue on every
page; the cart is a soft hold, not a reservation.

Only `ACTIVE`, published, non-archived products are public, and stock is read
from the default warehouse. Cost price, supplier data and internal notes are
never selected, so margin cannot leak into the HTML. A draft slug returns 404.

Coupons apply to gross merchandise (`subtotal + VAT`), capped by `maxDiscount`
and the gross, and must satisfy the minimum order, date window, usage limit,
per-customer limit and `ONLINE` channel. `FREE_SHIPPING` discounts the delivery
charge instead. Checkout locks the coupon row, quotes again inside the
transaction and records the redemption; cancelling gives it back.

Delivery zones (seeded for Dhaka and the divisions) carry a charge, a
free-shipping threshold and an estimated day range. Cash on delivery and manual
bKash/Nagad both create a `PENDING_VERIFICATION` payment, so a manager confirms
the money in the same payments queue as the counter; bKash/Nagad need a
transaction id. Stock leaves the default warehouse at confirmation and an
oversell is refused.

For a guest, the confirmation page is protected by a seven-day HMAC-signed token
in the URL. `/track` asks for the order number and mobile and issues a fresh
link; a wrong mobile reveals nothing. A signed-in customer can open the same
order under `/account/orders/[id]` without the link, because ownership is checked
by `customerId`. Cancelling restores stock, releases the coupon and marks a
pending payment `FAILED`.

## Customer accounts

The account area lives at `/account` with `/account/login`, `/account/register`,
`/account/orders`, `/account/orders/[id]`, `/account/addresses`,
`/account/loyalty` and `/account/profile`. The public header and footer link to
it, but guest checkout keeps working without one.

The mobile number is the login. A fresh number creates a customer; a number that
already ordered as a guest claims that same row rather than creating a duplicate.
If the row already has orders, one order number from it is required as ownership
proof — without an SMS gateway there is no better check. Five wrong passwords
lock the account for fifteen minutes, matching the staff rule, and a blocked or
soft-deleted customer loses access even with a valid cookie.

Customer credentials are stored on `Customer` (`passwordHash`, lockout counters,
`lastLoginAt`, `accountClaimedAt`), never on the staff `User` table. The session
is a separate `bgd26_customer` cookie (`HttpOnly`, `Lax`, `Secure` in
production, 30 days). Its payload carries `scope: "customer"` and the signature
covers a `customer.` prefix, so a staff session, a guest order token or a
customer session cannot be replayed on another surface.

Customers keep up to 20 soft-deleted addresses. The first is the default; setting
a new default clears the old one in a transaction, and deleting the default
promotes the most recently updated survivor. The mobile number is read-only for
the customer — staff change it, because it is both the login and the order key.

A signed-in checkout forces the account's own mobile no matter what the form
posts, so points and order history cannot land on another number. Saved
addresses prefill the form, and the points box allows spending up to
`min(balance, 20 % of net merchandise)` through the same `quoteRedemption` /
`redeemForOrder` engine as the counter. The browser figure is only a preview;
the live balance and cap are re-checked inside the sale transaction. A forgotten
password is reset manually by the shop until an SMS or WhatsApp channel exists.

## AI assistant

The assistant lives at `/assistant` and is for staff only (`ai.read`). It answers
questions about products, prices, stock, delivery charges and order status from
the live database, and can create one **draft** order. It cannot take payment,
refund, discount, adjust stock, post a journal, message a customer or edit a
customer record; those requests get a plain handover to a colleague.

It runs on an adapter port with two implementations. `local` is a deterministic
rules engine that needs no API key and works offline — the default. `openai`
uses Chat Completions tool calling and is reached only when
`AI_PROVIDER=openai` **and** `AI_API_KEY` is set; otherwise the app falls back to
`local` and says so on the page. A provider timeout, HTTP error or exhausted
limit becomes a handover message, never a blocked page or checkout.

The model never gets SQL, credentials or a raw table. It can only name one of
four allow-listed tools, each with a Zod schema and a server-side permission
check:

| Tool | Risk | What it does |
| --- | --- | --- |
| `search_products` | read | Published products and variants with live price, VAT rate, default-warehouse stock and fulfilment type |
| `get_order_status` | read | One order by number: status, payment, total, items, masked mobile and tracking |
| `quote_delivery` | read | Active zones with charge, day range and the free-shipping threshold applied to a subtotal |
| `create_draft_order` | draft | A `DRAFT` order with `source = AI_DRAFT` and `aiDraft = true`; no stock, payment, journal, loyalty or supplier order |

A draft is real paper but inert. Converting it on the order page locks the draft,
runs the ordinary `createSale` (`ADMIN`, COD/bKash/Nagad) so every line is
re-priced and stock is reserved, then marks the draft `CANCELLED`. An AI draft
cannot be confirmed directly, and cancelling a draft is status-only so no
phantom `SALE_RETURN` is written.

Every tool call — including `BLOCKED` and `ERROR` — goes to `ai_action_logs`
with a masked mobile and a duration. One `assistant.turn` row per request powers
the durable hourly limits, so a restart cannot reset them. Defaults: 60
requests/hour, 10 drafts/hour, 4 tool rounds, 1,200 output tokens, a 20-second
provider timeout and no monthly token budget. Cashiers have `ai.read` only.

## Shipping, couriers and COD remittance

Shipping lives under **Shipping**: the consignment list, booking, courier
registry and COD remittance. Only an order in `READY_TO_SHIP` can be booked, and
only once — a partial unique index allows a new shipment only after the previous
one is `CANCELLED`, `FAILED` or `RETURNED`.

Booking does not move the order. A pickup, transit or out-for-delivery event
moves it to `SHIPPED`; a delivery event moves it to `DELIVERED`. A courier return
or failure leaves the order alone, because only a refund or return document may
restock and reverse money. The tracking timeline is append-only; the shipment
row is a fast-read cache of the latest status.

Couriers are an adapter (`src/lib/adapters/couriers/`). The manual adapter is
the only one wired: it records the consignment and the tracking number a person
typed. Pathao, Steadfast and RedX are seeded records whose adapter throws a clear
"not wired yet" error, so a provider can be named without faking a booking.

Cash on delivery is not recognised at booking. Verifying the COD payment debits
`1060 Courier COD Clearing`; a remittance then posts DR cash (`1000`) or bank
(`1010`) / CR `1060` with `referenceType: "cod_remittance"`, tying the journal to
the courier's payout advice. Reading needs `shipment.read`, booking needs
`shipment.write`, and cancelling or remitting needs `shipment.approve`.

## Customers, reviews, pages and newsletter

Customers live under **Customers**. A mobile number is the identity key: it is
stored once as `+8801XXXXXXXXX` and duplicates are refused. Addresses, notes and
tags sit on the customer page; the first address becomes the default. Customers
are soft-deleted, never removed, because orders and payments reference them.

Reviews live under **Reviews**. Every new review is `PENDING`; only an
`APPROVED` review affects a product's rating. Staff can record a review taken by
phone or WhatsApp, attach up to five original photos, then approve, hide or
reject it. `review.approve` is a separate permission from `review.write`.

Pages live under **Pages**. The body is Markdown with separate English and Bangla
versions, rendered by an escape-first renderer — stored HTML is shown as text,
never executed. Pages are drafted first; publishing needs `content.publish`, and
archiving needs `content.delete`. Only `PUBLISHED` pages answer at `/p/[slug]`.

Newsletter addresses use **double opt-in**: staff record consent, the address
starts `PENDING`, and it becomes `SUBSCRIBED` only after the confirmation link
(`/newsletter/confirm?token=…`) is opened. `UNSUBSCRIBED` and `BOUNCED` suppress
sending. Transactional email connects with the Resend adapter in a later module;
until then the console shows the confirmation link so the flow can be tested.

## Scripts

Deployment to Vercel — environment variables, migrations, domain and the
serverless upload path — is documented in
[`docs/DEPLOY_VERCEL.md`](docs/DEPLOY_VERCEL.md). `vercel.json` pins functions
to `hnd1` (Tokyo) beside the Supabase project.

| Script | What it does |
| --- | --- |
| `npm run dev` | Next.js development server |
| `npm run build` | Generate Prisma client, then production build |
| `npm start` | Serve the production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint (Next.js core-web-vitals + TypeScript) |
| `npm run db:validate` | Official Prisma schema validation |
| `npm run db:generate` | Regenerate the Prisma client into `src/generated/prisma` |
| `npm run db:migrate` | Create/apply a migration in development |
| `npm run db:deploy` | Apply committed migrations (CI/production) |
| `npm run db:seed` | Seed reference data (idempotent) |
| `npm run db:studio` | Prisma Studio |
| `npm run db:local` | Local PostgreSQL via `prisma dev` (foreground) |
| `npm run db:local:setup` | Start it, create `bgd26`, write `.env.local` (backup first) |
| `npm run db:local:detach` | Same, in the background |
| `npm run env:setup` | Interactive `.env.local` writer |
| `npm run secrets:init` | Generate missing app secrets (`AUTH_SECRET`, pepper, …) |
| `npm test` | Unit + database tests for auth, RBAC, pricing, media, CRM, CMS, inventory, purchasing, supplier settlement, production, dropshipping, sales, accounting, loyalty, the storefront, customer accounts, shipping, the financial statements and the AI assistant (serial, for PGlite) |
| `npm run verify:auth` | HTTP auth checks against a running `npm start` |
| `npm run verify:catalog` | HTTP catalog + media checks against a running `npm start` |
| `npm run verify:crm` | HTTP CRM/CMS checks against a running `npm start` |
| `npm run verify:inventory` | HTTP inventory checks against a running `npm start` |
| `npm run verify:purchasing` | HTTP supplier, purchase-order and GRN checks against a running `npm start` |
| `npm run verify:purchasing-settlement` | HTTP supplier payment, return, refund, statement and permission checks against a running `npm start` |
| `npm run verify:production` | HTTP production job, design approval, material issue, completion, cancellation and permission checks against a running `npm start` |
| `npm run verify:dropship` | HTTP dropship list, detail, supplier-order transitions, direct shipment, cost of goods sold, prepaid guard and permission checks against a running `npm start` |
| `npm run verify:account` | HTTP customer login redirects, account dashboard, order history, ownership isolation, addresses, points, profile, token separation and account-aware checkout checks against a running `npm start` |
| `npm run verify:ai` | HTTP assistant access, provider/guardrail state, product, delivery and order answers, draft inertness, conversion and audit masking checks against a running `npm start` |
| `npm run verify:orders` | HTTP till, order, payment, refund and shift checks against a running `npm start` |
| `npm run verify:accounting` | HTTP trial-balance, journal, ledger and expense checks against a running `npm start` |
| `npm run verify:loyalty` | HTTP loyalty overview, ledger, POS preview and journal checks against a running `npm start` |
| `npm run verify:storefront` | HTTP storefront catalogue, cart, coupon, checkout, order link and cancellation checks against a running `npm start` |
| `npm run verify:shipping` | HTTP shipment booking, tracking, cancellation, courier registry and COD remittance checks against a running `npm start` |
| `npm run verify:reports` | HTTP profit and loss, balance sheet and cash-flow checks, including a reversal, against a running `npm start` |
| `npm run verify:invariants` | 10 database rule checks (totals, journals, immutability) |
| `npm run sample:catalog` | Seed the twelve-product sample catalogue with images and opening stock |
| `npm run sample:catalog:local` | Same, but keep image bytes in the local storage adapter |
| `npm run sample:catalog:archive` | Archive the sample products (stock and media are retained) |
| `npm run sample:images` | Re-render the placeholder product photos into `prisma/sample-images` |
| `npm run env:check` | Validate `.env.local` without printing secrets |
| `npm run schema:check` | Offline structural validator (90 tables / 81 enums) |

## Layout

```text
prisma/
  schema.prisma                90 tables, 81 enums — the source of truth
  migrations/
    20261115090000_init/       generated DDL for the whole schema
    20261115090100_invariants/ CHECK constraints, partial indexes, triggers
    20261116100000_auth_fields/ lockout, manager PIN, forced password change
    20261119130000_loyalty/    loyalty balance/sign CHECKs, per-order unique indexes
    20261119150000_storefront/ cart, coupon and delivery CHECKs
    20261119170000_shipping/   shipment COD/date CHECKs and one-live-shipment index
    20261119210000_dropship/   dropship statuses, timestamps and one order per supplier
    20261119220000_dropship_shipments/ one live direct shipment per supplier
    20261120090000_customer_accounts/ storefront password, lockout and claim columns
    20261122090000_ai_assistant/ assistant message/token counters and user timeline index
  seed.ts                      idempotent reference data
prisma.config.ts               Prisma 7 CLI config (loads .env.local)
src/
  app/                         App Router pages and route handlers
    (admin)/products/          catalogue list, create and detail/edit
    (admin)/categories/        category and VAT admin
    (admin)/inventory/         balances, warehouses, opening stock, adjustments, transfers
    (admin)/purchases/         orders, goods receipts, supplier payments and returns
    (admin)/suppliers/         supplier list, detail/edit and payables statement
    (admin)/production/        job list, order-line picker, job detail and design flow
    (admin)/purchases/dropship/ supplier orders, direct shipment and delivery
    (admin)/pos/               till, device registry and shifts
    (admin)/orders/            order list and detail (payments, refunds, history)
    (admin)/payments/          pending-verification queue and recent payments
    (admin)/refunds/           refund approval and payout
    (admin)/accounting/        trial balance, accounts, ledger, journals, expenses
    (admin)/accounting/reports/ profit and loss, balance sheet, cash flow
    (admin)/loyalty/           loyalty overview and per-customer points ledger
    (admin)/shipping/          shipments, booking, couriers and COD remittance
    (storefront)/              public home, shop, product, cart, checkout, order, track
    (storefront)/account/      login, register, dashboard, orders, addresses, points, profile
    api/storefront/            cart-count and coupon preview endpoints
    (admin)/customers/         customer list, create and detail/edit
    (admin)/assistant/         assistant console: chat, draft form, audit and guardrails
    (admin)/reviews/           review moderation and staff-recorded reviews
    (admin)/pages/             CMS page list, create and detail/edit
    (admin)/newsletter/        subscriber list and double opt-in status
    p/[slug]/                  public published page
    newsletter/confirm/        double opt-in endpoint
    media/[...key]/            original-byte media route (immutable cache)
    actions/                   server actions (products, customers, reviews, pages, …)
  components/catalog/          product, category, media and variant forms
  components/inventory/        warehouse, opening, adjustment and transfer forms
  components/purchasing/       supplier, purchase-order, GRN, payment and return forms, nav
  components/production/       job, design-revision and changes forms, production nav
  components/pos/              till terminal, device and shift forms, POS nav
  components/orders/           order actions, refund form, orders nav
  components/payments/         payment verify and reject forms
  components/accounting/       accounting section and report navigation, statement table
  components/shipping/         shipment, tracking, courier and remittance forms + nav
  components/storefront/       public header, product card, cart, coupon, checkout and track forms
  components/crm/              customer, address, note and review forms
  components/ai/               assistant chat, manual draft form and draft conversion form
  components/cms/              page form
  components/newsletter/       subscriber form
  generated/prisma/            generated client (gitignored)
  lib/adapters/auth/           AuthAdapter port + local/Supabase adapters
  lib/adapters/couriers/       CourierAdapter port + manual and un-wired adapters
  lib/adapters/storage/        StorageAdapter port + local/Supabase adapters
  lib/auth/                    session, guards, RBAC, audit
  lib/catalog/                 VAT/money math and cost-stripping DTOs
  lib/cms/                     safe Markdown renderer
  lib/crm/                     mobile normalisation, ratings, newsletter service
  lib/inventory/               decimal math, AVCO engine, document workflows
  lib/purchasing/              suppliers, purchase orders, GRNs, landed cost, settlement
  lib/production/              jobs, design revisions, material issue, WIP and transitions
  lib/dropship/                supplier orders from a sale, ship, deliver and cancel
  lib/orders/                  sale totals, orders, payments, refunds, shifts, POS search
  lib/accounting/              journal engine, posting rules, statements, trial balance and expenses
  lib/loyalty/                 points rules, ledger movements, expiry and journals
  lib/storefront/              public catalogue, cart, coupons, guest checkout and order access
  lib/customer-auth/           customer session, registration/claim, addresses and own orders
  lib/shipping/                couriers, consignments, tracking, order sync and COD remittance
  lib/media/                   validation, dimensions, zero-transform service
  lib/db.ts                    Prisma client + pg driver adapter
  lib/env.ts                   validated server environment
  lib/password.ts              scrypt password / manager PIN hashing
scripts/
  check-schema.py              offline schema validator
  verify-auth.mts              HTTP auth verification
  verify-catalog.mts           HTTP catalogue + media verification
  verify-crm.mts               HTTP CRM/CMS verification
  verify-inventory.mts         HTTP inventory verification
  verify-purchasing.mts        HTTP supplier, purchase-order and GRN verification
  verify-purchasing-settlement.mts HTTP payment, return, refund and statement verification
  verify-production.mts        HTTP production job, design, issue, completion and cancel verification
  verify-dropship.mts          HTTP dropship order, shipment, COGS, prepaid and permission verification
  verify-account.mts           HTTP account redirects, pages, isolation, tokens and checkout verification
  verify-orders.mts            HTTP till, order, payment, refund and shift verification
  verify-accounting.mts        HTTP trial-balance, journal, ledger and expense verification
  verify-loyalty.mts           HTTP loyalty overview, ledger, POS preview and journal verification
  verify-storefront.mts        HTTP storefront catalogue, cart, coupon, checkout, order and cancel verification
  verify-shipping.mts          HTTP shipment booking, tracking, cancellation, couriers and COD remittance verification
  verify-reports.mts           HTTP profit and loss, balance sheet, cash flow and reversal verification
  verify-invariants.mjs        proves the DB constraints reject bad data
tests/
  auth.test.ts                 session, RBAC and lockout
  catalog.test.ts              VAT math, media validation, cost stripping
  crm.test.ts                  mobile normalisation, reviews, CMS, newsletter
  inventory.test.ts            AVCO, adjustments, transfers, ledger immutability
  purchasing.test.ts           orders, GRNs, landed cost, holds, permissions data
  orders.test.ts               VAT totals, discount cap and PIN, offline queue, refunds, shifts
  accounting.test.ts           balanced posting, immutability, reversal, and every event's journal
  loyalty.test.ts              earn, redeem, cap, expiry, adjustments, cancel, refund and invariants
  storefront.test.ts           coupon maths, order tokens, online COD sale and zero-payable order
  shipping.test.ts             booking, one-live-shipment, tracking, cancellation, adapters and COD remittance
  reports.test.ts              profit and loss, balance sheet, cash flow and empty-period statements
  purchasing-settlement.test.ts payment cap, return AVCO/journal, refund and statement balance
  production.test.ts           job guard, design flow, issue WIP, completion COGS and cancellation return
  dropship.test.ts             auto supplier orders, grouping, ship COGS, prepaid guard, delivery and cancel
  customer-account.test.ts     registration/claim, lockout, addresses, online redemption and order isolation
  ai-assistant.test.ts         tool allow-list, live lookups, inert draft, conversion, limits and audit masking
docs/
  ARCHITECTURE.md              the engineering contract
  ER_DIAGRAM.md                generated ER diagram
  PHASE_1_REVIEW.md            Phase 1 gate record
  PHASE_2_DECISIONS.md         locked defaults for all Phase 2 modules
  PHASE_2_STATUS.md            current module status
```

## Security rules

1. Secrets live only in `.env.local` and the Vercel/Supabase dashboards.
2. `.gitignore` blocks `.env`, `.env.*` and `secrets/`; only `.env.example` is
   tracked.
3. `SUPABASE_SERVICE_ROLE_KEY` is server-only. It must never be prefixed with
   `NEXT_PUBLIC_` or imported into a client component.
4. Posted journals, `stock_ledger` and `audit_logs` are immutable at the
   database level. Corrections are reversals, never edits.
5. The assistant reads and drafts only. It cannot take payment, refund,
   discount, adjust stock, post a journal or send a message, and every tool
   call is logged with the customer's mobile masked.
6. If a credential is exposed: revoke it first, then rotate, then update
   `.env.local`.
