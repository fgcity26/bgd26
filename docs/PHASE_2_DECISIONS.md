# Phase 2 — Decisions locked with "use defaults"

Owner approved Phase 1 and asked to proceed with the recommended defaults on
2026-11-15. This page records every default that affects code, seed data or
money logic, why it was chosen, and how to change it later. Nothing here is
irreversible except posted journals and stock history.

## 1. The thirteen answers

| # | Question | Default now | Why / how to change |
| --- | --- | --- | --- |
| 1 | VAT | B2C prices are **VAT-inclusive**; standard rate **15 %**; books & stationery **0 %**; rate set per category and snapshotted onto each order line. BIN left blank until the certificate number is known. | Bangladesh retail convention is an all-in shelf price. Change a category rate in the admin; old orders keep their snapshot. |
| 2 | Accounts | Seeded chart of accounts (§12.2) with **zero opening balances**. Cash on Hand, Bank — Current, bKash Merchant, Nagad Merchant, Card/SSLCommerz Clearing. | Real bank/MFS numbers and opening balances are added as a dated opening journal before go-live. |
| 3 | Stores / warehouses | One **Main Store (ST-MAIN)** and one **Central Warehouse (WH-MAIN)**, both Dhaka. POS devices attach to ST-MAIN. | Add more warehouses/stores in admin; one is flagged default. |
| 4 | Dropship | **Mixed carts allowed**: stocked lines ship from the warehouse, dropship lines ship from the supplier (two parcels, one order, one payment). Delivery charged once; supplier cost posts to Accounts Payable. | Blocking mixed carts is a checkout flag, not a schema change. |
| 5 | Couriers | **Pathao + Steadfast** enabled; REDX off. Credentials empty until merchant accounts are approved. | Add a courier adapter; no order data changes. |
| 6 | WhatsApp | One business number, **official Cloud API**; templates: `order_confirmation`, `order_shipped`, `payment_reminder`, `review_request`. Marketing opt-in is **unchecked** by default. | Template names are configurable; each must be approved by Meta. |
| 7 | Payments | Start in **sandbox** for SSLCommerz, bKash and Nagad. Refund to the **original method**; if impossible, store credit with manager approval. | Flip to live keys in `.env.local`/Vercel; policy is enforced in the refund service. |
| 8 | Loyalty | Earn **on DELIVERED**; redeem from the **next** order; 1 point per ৳100; 1 point = ৳1; expires after **12 months**. | Timing is a service setting; expiry job is a cron. |
| 9 | Advance | **50 %** default for custom/engraving orders; advance methods: bKash, Nagad, card, bank transfer. Cash on delivery cannot be an advance. | Per-product `advancePercentage` overrides the default. |
| 10 | AI | Provider behind an adapter (OpenAI-compatible), **budget 0 at launch**, feature flag off until a key is added. **Draft-only**: never reserves stock, never takes payment, never posts journals. | Add key + budget, enable flag; the tool allowlist is code, not config. |
| 11 | Reviews | **Manual moderation**; no auto-approve, even for verified buyers; photos allowed, **max 5**. | `REVIEWS_REQUIRE_MODERATION` and `REVIEWS_MAX_IMAGES`. |
| 12 | Newsletter | **Double opt-in**; sender `BGD26 <news@bgd26.com>`; provider **Resend** (adapter, can swap). | Provider is an adapter; sender is env config. |
| 13 | Content pages | Launch pages: **About, Contact, Privacy, Terms, Return & Refund, Delivery, FAQ**; legal text approved by the **owner**; blog enabled (`BLOG` page type). | Any page can be drafted/published/archived in the CMS. |

## 2. Consequences baked into the code already

- `categories.vatPercentage` exists and defaults to 15 for the starter
  categories; the 0 % exemption is seeded for Books & Stationery.
- `orders` totals CHECK expects VAT-inclusive math:
  `grandTotal = subtotal − discountTotal − couponDiscount + vatTotal + deliveryCharge − loyaltyDiscount`.
- The shared `WALK_IN_CASH` customer exists with mobile `+8800000000000`; every
  walk-in sale still needs a manager PIN and a fully paid POS order.
- The chart of accounts and fiscal period **FY 2026-27** (July–June) are seeded.
- Owner account `owner@bgd26.com` is seeded in development with a temporary
  password; it must be changed before any real use.

## 2b. Authentication defaults (module 2)

| # | Question | Default now | Why / how to change it |
| --- | --- | --- | --- |
| 14 | Credential store | `AUTH_PROVIDER=local` in development, `supabase` in production. | Local keeps development working without a Supabase project and gives an offline-capable fallback. Set `AUTH_PROVIDER=supabase` to use Supabase Auth anywhere. |
| 15 | Session | Own HMAC-signed `HttpOnly` cookie, 7-day TTL, no "remember me". | One mechanism for both adapters, so swapping providers cannot change session semantics. TTL: `SESSION_TTL_SECONDS`. |
| 16 | Lockout | 5 failed attempts → 15-minute lock, stored per user. | Matches the manager-PIN rule and works for both adapters. Constants live in `src/lib/adapters/auth/shared.ts`. |
| 17 | First login | The seeded owner must change the temporary password before any other screen. | `users.mustChangePassword` is also set when an administrator resets a password. |
| 18 | Manager PIN | Six digits, pepper in `MANAGER_PIN_PEPPER`, no repeated digits or sequences, changed with the current password. | PINs authorise money-adjacent actions; a six-digit space needs the pepper. |
| 19 | User removal | Soft delete (`deletedAt` + `SUSPENDED`), never a hard delete. | `audit_logs` is append-only, so a hard delete would need to rewrite history. |
| 20 | Login errors | One message for unknown email, wrong password and missing password hash. | Prevents account enumeration; timing is equalised with a dummy scrypt run. |

## 2c. Catalog and media defaults (module 3)

| # | Question | Default now | Why / how to change it |
| --- | --- | --- | --- |
| 21 | Upload transport | Direct upload through a server action (not presigned PUT). | Simpler and works on a single server; the storage port already isolates the transport. Move to presigned PUT later without changing business code. |
| 22 | Storage provider | `STORAGE_PROVIDER=local` in development, `supabase` in production. Local files live in `.data/media` (gitignored). | Development never needs cloud credentials. Set `STORAGE_PROVIDER=supabase` anywhere; bucket name is `SUPABASE_STORAGE_BUCKET` (default `bgd26-media`). |
| 23 | Gallery formats | JPEG, PNG, WebP and AVIF only. SVG and PDF are rejected for the gallery. | Raster-only avoids script injection and keeps the zero-transform promise. Documents get their own media type later. |
| 24 | Size cap | 20 MB per image (`MEDIA_MAX_UPLOAD_BYTES`), max 8 files per upload. | Covers full-resolution phone and DSLR exports. Raise the env value and the server-action body limit together. |
| 25 | Zero transform | No resize, recompress, crop, format conversion or EXIF stripping, ever. Bytes are re-read after writing and the SHA-256 must match. | This is a product guarantee, not an optimisation. Any transform would break the checksum proof. |
| 26 | Storage keys | `gallery/YYYY/MM/{uuid}.{ext}` — random, immutable, never overwritten. | Removes filename collisions and path traversal, and makes a one-year cache header safe. |
| 27 | Duplicate images | Identical bytes reuse one `media_assets` row; a product may link an asset only once per role. | Saves storage without weakening provenance. Re-uploading the same file returns a clear message. |
| 28 | Removing an image | Unlink `product_media`; keep the `media_assets` row and the bytes. | Order history, reviews and proofs may reference the asset. Cleanup, if ever needed, is a separate audited job. |
| 29 | Cost price visibility | Only `account.read` or `report.read` may read or write `costPrice`. The DTO removes the keys entirely for everyone else. | Cost is commercially sensitive; hiding it in the UI alone would leak through a crafted post. |
| 30 | Publish vs edit | `product.write` edits, `product.publish` publishes, `product.delete` archives (soft). | Separates everyday editing from going live, matching the role matrix. |
| 31 | Page permission failures | Pages redirect to `/forbidden`; server actions throw a typed `ForbiddenError`. | Production Next redacts error messages, so a redirect gives staff a readable reason. |
| 32 | Cache headers | Public media: `public, max-age=31536000, immutable` plus a SHA-256 `ETag`; private media: `private, no-store`. | Keys are immutable, so the strongest cache is correct and makes repeat views instant. |


## 2d. CRM, reviews, CMS and newsletter defaults (module 4)

| # | Question | Default now | Why / how to change it |
| --- | --- | --- | --- |
| 33 | Customer identity | One canonical mobile `+8801XXXXXXXXX` (`mobileNormalized`), original typed string kept in `mobileRaw`. Changing it writes `customer_mobile_history`. | A shop knows a customer by phone; duplicate detection and WhatsApp need one form. Landlines and non-BD numbers are refused. |
| 34 | Customer deletion | Soft delete only: `deletedAt` + `BLOCKED`. The walk-in cash customer is read-only. | Orders, payments, loyalty and journals reference the row. A hard delete would break history. |
| 35 | Address default | The first address becomes default automatically; choosing a new default clears the old one in the same transaction. | Courier dispatch needs exactly one default and no customer should be left without one. |
| 36 | Customer tags | Free-text, comma separated, max 20 tags of 40 characters, stored as `text[]`. | Segments and follow-up lists can start here; a tag table can replace it later without changing customers. |
| 37 | Review moderation | Every review starts `PENDING`; only `APPROVED` affects `ratingAverage`/`ratingCount`. Reject stores an optional reason; hide is reversible. | Reviews are public content. Auto-approval, even for verified buyers, is off by default. |
| 38 | Review photos | Max 5 originals per review, `mediaType: REVIEW`, same magic-byte + SHA-256 pipeline as the gallery. Removing a photo deletes only the link row. | Reuses the zero-transform proof and keeps bytes available for audits. |
| 39 | Review uniqueness | One review per `(productId, customerId)`; duplicate attempts get a clear message. | Stops ballot stuffing while still allowing a later verified purchase to update the same review. |
| 40 | CMS format | Markdown with separate English and Bangla bodies, rendered by a hand-written escape-first renderer. No Markdown/HTML package. | Policy text must never execute stored HTML. Links are limited to http(s), mailto, relative and anchor URLs. |
| 41 | Page lifecycle | `DRAFT → PUBLISHED → ARCHIVED`. `content.write` edits, `content.publish` publishes, `content.delete` archives. `/p/[slug]` is dynamic and serves only `PUBLISHED`. | Separates editing from going live and makes unpublishing take effect immediately. Archived pages keep their slug for redirects. |
| 42 | Newsletter opt-in | Double opt-in with a random 48-hex token; `PENDING → SUBSCRIBED` only through `/newsletter/confirm`. Staff must tick a consent box and the source/consent text is stored. `UNSUBSCRIBED` and `BOUNCED` suppress sending. | Consent must be provable. The confirmation link is shown in the console until the Resend adapter is connected. |

## 2e. Inventory defaults (Phase 3, module 1)

| # | Question | Default now | Why / how to change it |
| --- | --- | --- | --- |
| 43 | Stock granularity | One `inventory_balances` row per variant × warehouse; every document names one warehouse. | Stock must belong to a place. A shop, a van and a dropship location are all warehouses. |
| 44 | Costing | Moving average (AVCO) at 4 decimals; quantity 3 decimals; money 2 decimals, half-up. | Handles weighed goods and fractional units without cumulative rounding drift. Changing the method later would need a migration, so it is fixed now. |
| 45 | Balance projection | `available = physical − reserved − damaged − quarantined − inProduction`, enforced by a deferred DB trigger. | A UI bug must never be able to persist impossible stock math. |
| 46 | Opening stock | Posted immediately by `inventory.approve`, once per variant × warehouse; later corrections use an adjustment. | A second opening would double-count history and corrupt the first AVCO. |
| 47 | Adjustment types | `INCREASE`, `DECREASE`, `DAMAGE`, `QUARANTINE`, `WRITE_OFF`. `RECOUNT` and cycle counts are deferred. | These cover the module-1 gate. A recount workflow needs its own counting session and approval model. |
| 48 | Adjustment lifecycle | `DRAFT` created by `inventory.write`; `POSTED` or `VOID` by `inventory.approve`. Only drafts can be voided; posted movements are corrected by a new adjustment. | Keeps stock changes behind a manager while leaving cashiers read-only. |
| 49 | Damage semantics | Damage and quarantine keep physical stock unchanged and reduce available; write-off removes damaged units first, then sellable units, never reserved stock. | The damaged unit is still physically present until it is written off; reserved stock belongs to a customer order. |
| 50 | Transfer lifecycle | `DRAFT → IN_TRANSIT → RECEIVED`. Send posts `TRANSFER_OUT`; receive posts `TRANSFER_IN` at the source AVCO; cancelling in transit posts a compensating `TRANSFER_IN` back to the source. | Stock must not vanish while a truck is between warehouses. Corrections are new movements, never deletions. |
| 51 | Warehouse deactivation | Refused while the warehouse is the default or still holds stock; another default must be set and stock transferred out first. | Protects POS defaults and keeps balance history meaningful. |
| 52 | Cost visibility | Stock value, AVCO and unit cost are omitted from the response unless the role has `account.read` or `report.read`. | Same rule as product cost prices: a cashier sees quantities, never margins. |
| 53 | Purchasing scope | Module 1 accepts stock only through opening stock, adjustments and transfers. Purchase orders, GRNs, supplier bills and purchase returns are module 2. | Keeps the gate small and testable; the ledger already has `PURCHASE_RECEIPT` ready. |

## 2f. Purchasing defaults (Phase 3, module 2)

| # | Question | Default now | Why / how to change it |
| --- | --- | --- | --- |
| 54 | Module 2 scope | Suppliers, purchase orders and goods-received notes only. Supplier bills, purchase payments and purchase returns are deferred. | Those documents need balanced accounting journals, which arrive with the accounting module. GRNs already post stock correctly without them. |
| 55 | Supplier permissions | `purchase.read`, `purchase.write` and `purchase.approve`; no separate supplier resource. | Suppliers exist only to buy from. Adding a `supplier` resource later would duplicate the role matrix for no benefit today. |
| 56 | Purchase-order lifecycle | `DRAFT → SENT → PARTIALLY_RECEIVED → RECEIVED`, plus `CANCELLED` and `CLOSED`. | Mirrors the real conversation with a supplier. `CLOSED` abandons outstanding quantity without pretending it arrived. |
| 57 | GRN lifecycle | `DRAFT → POSTED`, or `CANCELLED` while still a draft. A posted GRN is immutable. | Only posting moves stock. A posted mistake is corrected by a purchase return, never by editing history. |
| 58 | Who can send and post | Drafts need `purchase.write`; sending, cancelling, closing and posting a GRN need `purchase.approve`. | Keeps receiving behind a manager while a stock keeper can prepare documents. |
| 59 | Landed cost | The GRN line's `unitCost` is what enters AVCO; the receiver may raise it above the ordered cost to include freight, duty or handling. The PO keeps the ordered cost. | Per-delivery cost is more accurate than a header-level allocation and needs no extra table. A full landed-cost allocation table can be added later without changing stock history. |
| 60 | Damaged or quarantined receipt | Post `PURCHASE_RECEIPT` first, then `DAMAGE` or `QUARANTINE`, so physical stock rises and available stock does not. | The goods did arrive; they are simply not sellable. This keeps the receipt value and the hold visible in the ledger. |
| 61 | Outstanding quantity | A draft GRN reserves its quantities; only posted receipts advance `receivedQty`. Over-receipt is refused, and two receivers are serialised with `SELECT … FOR UPDATE` on the ordered lines. | Prevents two people promising the same last unit and keeps the supplier's outstanding list honest. |
| 62 | Supplier and document deletion | Suppliers are never deleted; use `INACTIVE` or `BLACKLISTED`. Purchase orders and GRNs are documents, not editable history. | Same principle as every other module: status changes, never hard deletes. |
| 63 | Deferred with the accounting module | Supplier bills, purchase payments, purchase returns and landed-cost allocation. `StockMovementType` has no `PURCHASE_RETURN`, so returns also need a migration. | Each needs journals or a new ledger type. Deferring keeps module 2 small and avoids a half-built accounts-payable flow. |

## 2g. Sales defaults (Phase 3, module 3)

| # | Question | Default now | Why / how to change it |
| --- | --- | --- | --- |
| 64 | Module 3 scope | POS devices, shifts, the till, orders, the payment lifecycle and refunds. Courier dispatch, loyalty, WhatsApp notifications and journals are deferred. | Each deferred piece needs credentials or the accounting module. The till and the money trail are the part a shop cannot run without. |
| 65 | Price and VAT basis | B2C prices are VAT-inclusive; VAT is extracted as `gross × rate/(100+rate)` **before** the discount, and the order keeps `subtotal + vat − discount + delivery = grandTotal`. | Matches how counter receipts are written in Bangladesh and is the only shape `chk_order_totals` accepts. Discounting after VAT keeps the per-line and per-order arithmetic identical. |
| 66 | Discount authority | A cashier may discount up to 5 % of the gross sale value. Anything above it needs a manager PIN from an active user holding `order.approve`. | The cap is a business control, not a UI hint: the server recomputes the rate and refuses the sale without a valid PIN. |
| 67 | Walk-in cash | Blank mobile means `WALK_IN_CASH`: POS channel, cash only, paid in full, `dueAmount = 0`, and a manager PIN. DB triggers enforce the same rules. | A walk-in has no account to chase a due against, and a digital payment would have no customer record to verify against. |
| 68 | Offline sales | A sale queued offline is always stored, with `source = POS_OFFLINE`, `approvalDeferred` when it needed a PIN, and an `order.offline.approval_required` audit row. Offline is the only path allowed to drive stock negative. | Losing a real customer's cash is worse than a negative balance that a manager reconciles. The audit row is the follow-up worklist. |
| 69 | Idempotency | `orders.clientTransactionUuid` is unique; a replay returns the existing order with `duplicate: true`, and a `P2002` race is handled the same way. | A flaky counter connection must never double-sell or double-consume stock. |
| 70 | Payment lifecycle | Cash is `PAID` at the drawer (`CASH_DRAWER`). bKash, Nagad, card and bank transfer stay `PENDING_VERIFICATION` until `payment.approve` verifies them; rejection sets `FAILED`. | Digital money is a claim until someone checks the transaction. `paidAmount` counts only `PAID`, so `dueAmount` stays honest. |
| 71 | Stock timing | `SALE` movements post once per `STOCKED` line when the sale is created; non-stock lines never move stock. Cancelling restocks via `SALE_RETURN` at `costPriceSnapshot`. | A counter sale is physical custody moving now. Delivery and production status are separate lifecycles and must not gate stock. |
| 72 | Refund flow | `REQUESTED → APPROVED → COMPLETED` (or `REJECTED`). Approval restocks the ticked lines; completion settles the order to `REFUNDED`; partial quantities live on `order_items.refundedQty`. | Money and stock should not move on the same click as the request. A manager can approve a return without having paid it out yet. |
| 73 | Shift reconciliation | One open shift per device; closing stores expected cash, counted cash and the signed variance, and a second close is refused. | The drawer must balance against the sales the system recorded, and a closed shift is history, not a draft. |
| 74 | PIN handling on the device | A manager PIN is never stored: queued payloads strip it, force `source = POS_OFFLINE` and are replayed without it. | A shared till in a shop must not become a place where manager credentials leak. |
| 75 | Cost visibility in the till | `/api/pos/search` and `/api/pos/catalog` never select or return cost price. | Same rule as the catalogue: a cashier sees what to charge, never the margin. |
| 76 | Permissions | `order.*`, `pos.*`, `payment.*` and `refund.*`. A cashier sells and requests refunds but cannot read the refund list or approve; an accountant reads sales but cannot open the till. | The till is a cashier's tool, verification and refunds are a manager's, and accounting needs the record without the controls. |


## 2h. Accounting defaults (Phase 3, module 4a)

| # | Question | Default now | Why / how to change it |
| --- | --- | --- | --- |
| 77 | Module 4a scope | The journal engine, chart of accounts, expenses, trial balance, account ledger, journal browser and manual reversal. Every existing sale, payment, refund, goods receipt, stock adjustment and opening-stock event posts. Supplier bills, purchase payments and purchase returns (item 63), transfer fees, production journals and dropship COGS stay deferred. | These are the events the system already records. Supplier documents need their own approval workflow before they can post safely. |
| 78 | Sale entry shape | One combined entry: DR Accounts Receivable (grand total), DR Sales Discounts, DR COGS; CR Product Sales (subtotal), CR VAT Payable, CR Delivery Revenue, CR Inventory. | The sale is one economic event. A single entry keeps it atomic and traceable to the order; splitting it would add cross-entry references without changing any report. |
| 79 | Cash vs digital receipts | A cash payment posts DR Cash on Hand / CR Accounts Receivable at sale time. A bKash, Nagad, card or bank payment posts nothing until a manager verifies it, then debits its own asset account. | Digital money is a claim until verified; booking it early would overstate cash and understate receivable. |
| 80 | Cancellation | Cancelling reverses the sale entry and every `PAID` payment entry for the order, in the same transaction as the stock return. | The books must unwind exactly what was recognised, and a cancelled order should leave no revenue, receivable or drawer balance behind. |
| 81 | Refund posting | Approval posts DR Inventory / CR COGS at the sale-time cost. Completion posts DR Sales Returns + DR VAT Payable / CR the payment account for the amount paid out. | Stock returns when it reaches the shelf; money returns when it is actually paid. Two steps, two entries. |
| 82 | Goods receipt | Posting a GRN debits Inventory and credits Accounts Payable at the landed value, with the supplier on the credit line. | The supplier is owed what the goods cost including freight and duty, and the supplier tag makes the payable traceable. |
| 83 | Opening stock and adjustments | Opening stock debits Inventory / credits Owner's Equity. An increase adjustment debits Inventory / credits Inventory Shrinkage; every decrease is the mirror. A warehouse transfer posts no journal. | Opening stock is capital, not income; an adjustment is a gain or loss against shrinkage; a transfer only moves value between shelves. |
| 84 | Expenses | A draft touches nothing. Posting debits the expense account and Input VAT Receivable and credits cash, bank or the payment account. Voiding posts a reversal and marks the document `VOID`. | Expenses need the same draft/approve discipline as stock documents, and a posted entry must never be edited. |
| 85 | Immutability | Entries are created `DRAFT`, lines inserted, then posted. Database triggers reject an unbalanced or zero posted entry and every later UPDATE or DELETE of a posted entry or line. `reversalOfId` is unique and the original stays `POSTED`; `REVERSED` is never written. | The ledger is evidence. Enforcing this in the database means no service bug or script can rewrite history. |
| 86 | Fiscal periods | An entry date must fall inside an `OPEN` fiscal period; a missing or locked period refuses the post. A zero-value journal is skipped. The trial balance reads only `POSTED` lines. | A closed year must not change because a late sale arrives, and a zero entry carries no information the ledger needs. |
| 87 | Permissions | `account.read/write/approve` and `expense.read/write/approve`. An accountant reads and writes the books but still cannot open the till; a cashier has no accounting access. | The person who keeps the books should not also hold the drawer, and a cashier has no reason to see margins or journals. |
| 88 | Screens and navigation | `/accounting` (trial balance), `/accounting/accounts`, `/accounting/accounts/[id]`, `/accounting/journals`, `/accounting/journals/[id]`, `/accounting/expenses`; `AccountingNav`; admin nav entry behind `account.read`. | One section with a stable sub-navigation, matching inventory, purchasing and sales. |


## 2i. Loyalty defaults (Phase 3, module 4b)

| # | Question | Default now | Why / how to change it |
| --- | --- | --- | --- |
| 89 | Earning rate | One point per complete ৳100 of **net merchandise** (`subtotal − discountTotal`: after discount, before VAT). Fractions below ৳100 earn nothing. | Net merchandise is what the customer actually paid for the goods, so a discounted sale does not mint points on money never collected. The rate is one constant in `src/lib/loyalty/service.ts`. |
| 90 | Point value and cap | One point is worth ৳1. A single sale may redeem at most 20 % of its net merchandise, further limited by the live balance. | A 20 % cap keeps loyalty from swallowing the margin while still feeling generous. Both numbers live in the `LOYALTY` constant and are shown in the POS and the overview. |
| 91 | When points are earned | Once per order, when the payment becomes `PAID` (cash at the drawer, digital on manager verification) or the order reaches `COMPLETED`. A partial unique index allows one `EARN` per order. | Points follow money, not the click that created the order; completion covers an order paid across several steps. The index makes a retry idempotent. |
| 92 | Who can earn and redeem | A named customer earns and redeems. A walk-in cash sale has no account and never earns or redeems; a blocked or soft-deleted customer cannot redeem. | A walk-in has no identity to attach a balance to, and a blocked account should not be rewarded. |
| 93 | Offline behaviour | An offline sale never redeems (no live balance can be checked) but earns when it syncs and is paid. The till strips the points field and shows an offline note. | The counter must never reject a real sale for a points check it cannot make; earning later is safe because it is idempotent. |
| 94 | Expiry | Points expire twelve months after they are earned. The expiry job is aggregate: it expires the balance above the sum of still-live positive movements, so running it twice cannot expire the same points twice. A positive manual adjustment gets its own twelve-month expiry. | Points are fungible, so lot tracking would add a table for no business benefit; the aggregate rule is idempotent and auditable. |
| 95 | Loyalty journals | Earn: DR 5500 Loyalty Expense / CR 1500 Loyalty Points Liability. Redeem: a DR 1500 line inside the sale entry. Expire and claw-back: DR 1500 / CR 5500. Manual grant DR 5500 / CR 1500; a correction is the mirror. `source = "MANUAL"`, `referenceType = "loyalty_transaction"`. | The outstanding balance must appear as a real liability in the trial balance. Putting the redemption inside the sale entry means a cancelled sale unwinds it automatically. |
| 96 | Cancellation | Cancelling restores redeemed points with no second journal (the sale reversal already reverses the DR 1500 line) and claws back earned points with DR 1500 / CR 5500. | Restoring a redemption is just undoing the sale; posting a second journal would double-count the liability. |
| 97 | Refunds | A refund reverses the earned share in proportion to the amount refunded; a full refund reverses whatever is left. The reversal is capped by the current balance. | Points spent on another sale must not push the balance negative; the cap keeps the ledger consistent with what the customer still holds. |
| 98 | Database invariants | CHECKs forbid a negative cached balance, a negative `balanceAfter`, a zero movement and a movement whose sign contradicts its `type`; `uq_loyalty_earn_order` and `uq_loyalty_redeem_order` allow one earn and one redeem per order. | Points are money-adjacent, so the same database-level discipline as journals and stock applies: a service bug cannot invent or double-spend points. |
| 99 | Permissions | No new resource. Overview and ledger use `customer.read`; manual adjustment and expiry use `customer.approve`; redemption is part of `order.write` through the sale. A cashier reads loyalty but cannot adjust. | Loyalty is part of the customer relationship, so it borrows the customer permissions; a cashier spends points only by making a sale. |
| 100 | Screens | `/loyalty` (outstanding liability, holders, rules, recent movements, search), `/loyalty/[customerId]` (balance, earned/redeemed/expired totals, manual adjustment, expire button, full ledger); admin nav entry behind `customer.read`; customer profile links to its ledger. | One overview plus one per-customer ledger mirrors how the books and stock screens are laid out, and keeps the audit trail one click from the customer. |


## 2j. Storefront defaults (Phase 3, module 5a)

| # | Question | Default now | Why / how to change it |
| --- | --- | --- | --- |
| 101 | Module 5a scope | Public catalogue, product pages, guest cart, coupons, delivery zones, one-page guest checkout with COD or manual bKash/Nagad, order confirmation and tracking. No customer login, no online loyalty redemption, no payment gateway and no courier booking. | This is the smallest slice that lets a real customer buy and pay without inventing an account system or a gateway integration first. |
| 102 | Guest identity | The mobile number is the identity. It is normalised to `+8801XXXXXXXXX`; an existing customer is reused, otherwise a retail customer is created inside the checkout transaction. No password, no session. | Repeat orders, loyalty earning and support all need one stable key; the mobile is the key the business already uses. |
| 103 | Cart | The `bgd26_cart` cookie holds a random database token (`HttpOnly`, `Lax`, `Secure` in production, 30 days). Prices are re-read from the catalogue on every render; the stored `unitPrice` is only a snapshot. A cart is a soft hold and expires after 30 days. | No stock is reserved while browsing, so an abandoned cart cannot starve the shop; re-pricing prevents a stale price from being charged. |
| 104 | Catalogue visibility and stock | Only `ACTIVE`, published, non-archived products appear; a draft or archived slug returns 404. Stock is read from the default warehouse. Cost price, supplier data and internal notes are never selected. | The shop must show exactly what can ship, and margin must not be inferable from the HTML. |
| 105 | Coupon base and caps | A coupon quotes against gross merchandise (`subtotal + VAT`), is capped by `maxDiscount` and the gross, and must satisfy `minOrderValue`, its date window, `usageLimit`, the per-customer limit and `ONLINE` eligibility. The discount is allocated across line totals for proportional refunds. | The shopper compares the discount with the price they see, which includes VAT; capping by the gross prevents a negative merchandise total. |
| 106 | Free-shipping coupons | `FREE_SHIPPING` discounts the delivery charge, not the merchandise. The zone's own free-shipping threshold applies first. | Delivery is priced separately; a shipping coupon that reduced goods would understate revenue and overstate the delivery subsidy. |
| 107 | Coupon locking and release | Checkout locks the coupon row `FOR UPDATE`, quotes again inside the transaction, writes `coupon_redemptions` and increments `usedCount`. Cancelling deletes the redemption and decrements the counter. | Two shoppers must not spend the last redemption; a cancelled order must give the code back. |
| 108 | Delivery zones | `delivery_zones` carry division, district, charge, a free-shipping threshold and an estimated day range. The seed creates nine zones. Checkout refuses a zone that does not match the chosen division and district. | A district-level charge is how Bangladeshi delivery actually prices, and the mismatch check stops a cheap zone being selected for a far address. |
| 109 | Online payment methods | Cash on delivery and manual bKash/Nagad both create a `PENDING_VERIFICATION` payment; bKash/Nagad require a transaction id. A manager confirms the money in the existing payments queue. No gateway adapter is wired. | This reuses the offline digital-money rule — a claim is not cash until a human verifies it — and avoids pretending a gateway exists. |
| 110 | Stock timing | Stock leaves the default warehouse once per stocked line when the order is confirmed, with `allowNegative: false`; insufficient stock rejects the order. No reservation row is created. | An online order is a commitment, and refusing an oversell is better than silently back-ordering. Soft reservations are a later slice. |
| 111 | Order access | The confirmation page uses an HMAC-signed token in the URL (`scope: "order"`, 7-day TTL, one order and mobile). `/track` asks for order number + mobile and issues a fresh token; a wrong mobile reveals nothing. | Without accounts, a signed link is the least-effort way to keep one shopper's order private while still letting them return later. |
| 112 | Zero-payable orders | An order fully covered by a coupon is `PAID` with zero paid, needs no payment row and posts the same balanced journal. | There is nothing to collect, so creating a payment would leave a phantom item in the verification queue. |
| 113 | Loyalty earning online | Earning uses net merchandise after the coupon (`subtotal − discountTotal − couponDiscount`). The storefront cannot redeem points. | Points follow money actually paid for goods; redemption needs a live balance and therefore a logged-in customer. |
| 114 | Cancelling an online order | Cancellation restocks the default warehouse, reverses the sale and paid payment journals, deletes the coupon redemption, decrements `usedCount` and marks any `PENDING_VERIFICATION` payment `FAILED`. | A cancelled order must leave no stock, coupon or pending money behind. |
| 115 | Actor and permissions | The storefront is public, but every write runs through the same services and guards as the console. Journals and stock movements use the inactive `storefront@bgd26.local` system actor. | Public browsing must not become an anonymous write path into inventory or the books. |
| 116 | Routes | `/`, `/shop`, `/product/[slug]`, `/cart`, `/checkout`, `/order/[orderNumber]?t=…`, `/track`, `/api/storefront/cart-count`, `/api/storefront/coupon`. The admin console is unchanged. | A separate route group keeps the public shell (no admin nav, cacheable pages) away from the console. |

## 2k. Shipping defaults (Phase 3, module 5b)

| # | Question | Default now | Why / how to change it |
| --- | --- | --- | --- |
| 117 | Module 5b scope | Courier registry, consignment booking, an append-only tracking timeline, order-status synchronisation and COD remittance. No provider API adapter, no pickup scheduling and no label printing yet. | This completes the storefront loop — a paid order can leave the shop — without pretending a Pathao/Steadfast/RedX integration exists. |
| 118 | When a shipment can be booked | Only an order in `READY_TO_SHIP`, and only when it has no live shipment. A cancelled, failed or returned attempt may be followed by a new one. | Booking a parcel that has not been picked or prepared would create false expectations; two live consignments would mean one parcel is with two couriers. |
| 119 | One live shipment per order | A partial unique index on `shipments (orderId)` excludes `CANCELLED`, `FAILED` and `RETURNED`. | The service checks first, but the index is what holds under two simultaneous clicks. |
| 120 | Booking does not move the order | The order stays `READY_TO_SHIP`; a pickup, transit or out-for-delivery event moves it to `SHIPPED`, and a delivery event moves it to `DELIVERED`. | A booked consignment can still be cancelled; only proof of movement should change the customer-facing status. |
| 121 | Courier return or failure | The shipment ends `RETURNED` or `FAILED`, but the order status is left alone. | Restocking and money are decided by a refund or return document, not by a courier scan; coupling them would restock twice. |
| 122 | Courier adapters | A port with `isConfigured`, `book` and `cancel`. Only `MANUAL` is wired; Pathao, Steadfast and RedX throw a clear "not wired yet" error. | An honest failure is safer than a fabricated tracking number. A provider becomes usable by implementing the port, not by changing the workflow. |
| 123 | COD amount on a shipment | The order's due amount when a COD payment is `PENDING_VERIFICATION`; otherwise zero. A courier that does not support COD cannot carry a non-zero amount. | The courier must collect exactly what the order still owes; a prepaid order carries no cash. |
| 124 | COD accounting | Verifying a COD payment debits `1060 Courier COD Clearing`. A remittance posts DR cash `1000` or bank `1010` / CR `1060`, `source: "MANUAL"`, `referenceType: "cod_remittance"`. | The verification recognises the sale; the remittance only moves cleared money to the shop's account, so revenue is never posted twice. |
| 125 | Cancelling a shipment | Only `PENDING` or `BOOKED`, before pickup; the adapter is told first, then the shipment becomes `CANCELLED` with a closing event, and the order stays ready to ship. | A parcel already picked up cannot be un-shipped by a click; it needs a return. |
| 126 | Permissions | `shipment.read` reads everything; `shipment.write` books and records events; `shipment.approve` cancels a booking and posts a remittance. | Cancelling and remitting undo or recognise money and a physical commitment, so they sit with the approver. A cashier reads shipments but cannot book. |
| 127 | Routes and order page | `/shipping`, `/shipping/new`, `/shipping/[id]`, `/shipping/couriers`, `/shipping/couriers/[id]`, `/shipping/remittances`. The order page lists its shipments and offers "Book shipment" when ready and unbooked. | The shipment is managed where dispatch happens, while the order page stays the single place to see an order's whole life. |
| 128 | Seed data | Four couriers (manual, Pathao, Steadfast, RedX) are upserted idempotently; provider records carry a credential env prefix, never a secret. | Staff can record which company carried a parcel before the API exists; secrets stay in environment variables. |

## 2l. Financial statement defaults (Phase 3, module 5c)

| # | Question | Default now | Why / how to change it |
| --- | --- | --- | --- |
| 129 | Module 5c scope | Profit and loss, balance sheet and cash-flow statement read from posted journals. No closing entries, no budgeting, no comparative prior-year column and no export yet. | The ledger already holds every event; a statement is a read model, so this slice adds the highest value with no schema change. |
| 130 | Source of every figure | `journal_entry_lines` on `POSTED` entries only. Statements never read orders, payments or stock. | One source of truth means a statement cannot disagree with the ledger; a correction is a reversal entry and nets out by itself. |
| 131 | Sign convention | Natural signs: revenue credit-positive, expenses debit-positive, assets debit-positive, liabilities and equity credit-positive. Discounts and sales returns therefore appear as negative revenue. | A reader sees net revenue directly instead of subtracting a debit column by hand, and no per-statement sign table can drift. |
| 132 | Cost of sales split | Accounts `5000`–`5030` are cost of sales and produce gross profit; every other expense account is an operating expense. | Gross profit is the number a shopkeeper watches; the split is a fixed code list so it cannot depend on account naming. |
| 133 | Closing entries | None yet. The cumulative revenue-minus-expense balance is presented as **Accumulated earnings** inside equity on the balance sheet. | Without a year-end close the P&L accounts keep their balance, so the balance sheet would never balance; presenting the result as equity makes it balance at any date. |
| 134 | Cash accounts | `1000` cash, `1010` bank, `1020` bKash, `1030` Nagad, `1040` card clearing. Receivables `1050` and courier COD clearing `1060` are not cash. | A receivable is a claim and COD clearing is money held by a courier; counting either as cash would flatter the drawer. |
| 135 | Cash-flow classification | An entry touching any `EQUITY` account is `FINANCING`; everything else is `OPERATING`. No `INVESTING` category yet. | Owner capital and drawings are the only financing events today, and there are no fixed-asset accounts to invest in. Add investing when asset purchases exist. |
| 136 | Cash transfers | An entry whose cash lines net to zero (for example cash to bank) is omitted from the list and contributes nothing to the net change. | It is a movement between pockets, not a cash flow; listing it would double-count the same money. |
| 137 | Report dates | Dhaka days (`+06:00`) with explicit boundaries; the P&L and cash flow default to the current month, the balance sheet to today; a reversed range is swapped rather than returning nothing. | A sale at 00:30 Dhaka belongs to that Dhaka day, and a swapped range should still answer the question instead of showing an empty page. |
| 138 | Permissions | `report.read`, already held by `OWNER` and `ACCOUNTANT`, not by `CASHIER`. Anonymous visitors are redirected to login; a cashier gets `/forbidden`. | The statements expose margin and equity; counter staff should not read them. No new permission resource was added. |
| 139 | Routes | `/accounting/reports` (profit and loss), `/accounting/reports/balance-sheet`, `/accounting/reports/cash-flow`, with a **Reports** item in the accounting nav and a report tab strip. | The statements belong with the ledger they summarise, and the tab strip makes the three reachable in one tap on a phone. |
| 140 | Verification data | The HTTP verification posts a small scenario dated in a quiet past day (1990–2019) derived from the run id, and reverses one entry to prove reversals net out. | A past day keeps the expected profit isolated and stops the entries crowding page one of the journal browser; posted journals stay in the ledger by design. |

## 2m. Supplier settlement defaults (Phase 3, module 6)

| # | Question | Default now | Why / how to change it |
| --- | --- | --- | --- |
| 141 | Module 6 scope | Supplier payments, purchase returns and a per-supplier payables statement. No supplier invoice document, no payment approval queue, no multi-currency, no ageing buckets. | The goods receipt already creates the payable; this slice adds the two ways it goes down and one way to read it. Invoices and ageing can come later without changing these postings. |
| 142 | Where the payable lives | Derived from posted `journal_entry_lines` on `1300 Accounts Payable` filtered by `supplierId`. `outstanding = credit − debit`. `supplier_ledgers` is left unused. | A stored balance needs a trigger, a backfill and a repair path; a query over the immutable journal needs none, and the statement is the same query with dates. |
| 143 | Payment permission | `purchase.approve`. `purchase.read` is enough to see the list; `purchase.write` is not enough to pay. | Paying a supplier is the highest-risk purchasing action; the same permission that approves an order approves its settlement. |
| 144 | Payment cap | Greater than zero and no more than the outstanding balance, checked while the supplier row is locked with `SELECT … FOR UPDATE`. | Locking the row stops two simultaneous payments from both spending the last taka; the cap stops a typo turning into a prepayment. |
| 145 | Supplier state | A blacklisted supplier cannot be paid. An optional purchase order must belong to that supplier and must not be `CANCELLED`. | Blacklisting is meant to stop money leaving, and a payment linked to the wrong order is almost always a mis-click. |
| 146 | Payment methods | `CASH`, `BKASH`, `NAGAD`, `BANK_TRANSFER`, `CHEQUE`, `CARD`. No `COD`. | COD is money coming in from a customer, never money going out to a supplier. |
| 147 | Payment posting | DR `1300` / CR `paymentAccountCode(method)`, `source: PURCHASE_PAYMENT`, `referenceType: purchase_payment`. Posts immediately, with no approval queue. | The money has already left; delaying the entry would only make the books wrong for a while. The cap and the permission are the guards. |
| 148 | Return source | Only a **posted** goods receipt. Each received line carries `returnedQty`, and a line can be returned up to `quantityReceived − returnedQty`. | Returning against a real receipt is what fixes the cost and quantity; `returnedQty` makes "six left" a fact and blocks the same unit going back twice. |
| 149 | Return states | `DRAFT → APPROVED → COMPLETED`; `CANCELLED` only from `DRAFT`. An approved return is corrected by a new purchase, not by editing history. | Draft is a plan, approval is the physical event, completion is the money event. Keeping them separate keeps each step auditable. |
| 150 | Return value | Approval overwrites the draft estimate with the value the stock ledger actually released at AVCO, then posts DR `1300` / CR `1100` for exactly that figure. | The draft cost can be stale; the ledger value cannot. Writing the ledger figure into both places makes inventory and the supplier debit equal by construction. |
| 151 | Return stock movement | A new `StockMovementType.PURCHASE_RETURN` in the outbound branch: available stock only, at AVCO, ledger value negative. | It behaves like a sale leaving the warehouse, without pretending it was a sale; the same AVCO engine keeps the average honest. |
| 152 | Refund on completion | Optional. If chosen: DR `paymentAccountCode(refundMethod)` / CR `1300`, and `refundReference` stores the supplier's reference. Without a refund the payable simply carries a credit. | Approval already debited the payable, so a refund is the supplier clearing a debit balance — usually because the goods had already been paid for. Keeping goods and money as separate events is what makes it auditable. |
| 153 | Statement | `/suppliers/[id]/statement`: every posted entry touching the supplier's payable, oldest first, with debit, credit, running balance and closing totals. | The same query the payable uses, with dates attached, so the statement cannot disagree with the card on the supplier page. |
| 154 | Permissions summary | `purchase.read` for lists, detail and statement; `purchase.approve` for payment and return transitions; `purchase.write` for a draft return. `OWNER` all, `STOCK` `purchase.*`, `ACCOUNTANT` read only, `CASHIER` refused. | Counter staff have no business reading supplier money; the accountant can see it but not move it. |
| 155 | Verification data | Each HTTP run creates its own supplier, receipt and variant, then archives the variant and deactivates the supplier. The journals and stock ledger rows stay, by design. | A fresh supplier isolates the payable arithmetic; the append-only ledger is never deleted, so the run leaves a clean audit trail instead of cleanup. |

## 2n. Engraving production defaults (Phase 3, module 7)

| # | Question | Default now | Why / how to change it |
| --- | --- | --- | --- |
| 156 | Module 7 scope | Order-linked engraving and made-to-order jobs. A job belongs to one order line and tracks design, approval, materials and hand-over. No generic work orders, no bill-of-materials explosion, no labour or overhead costing, no finished-goods receipt. | The order line is the only thing a customer can ask to engrave. A generic manufacturing module would add machines, routings and work centres that this shop does not use yet. |
| 157 | How many jobs per line | One live job. A second is refused while the first is open; after `COMPLETED` or `CANCELLED` the line can be produced again. Dropship lines are refused. | Two open jobs on one unit would double-issue materials and split the design history. Dropship is the supplier's production, not ours. |
| 158 | Status flow | `PENDING_DESIGN → DESIGN_PREPARATION → AWAITING_CUSTOMER_APPROVAL → APPROVED → PRODUCTION → QUALITY_CHECK → READY_TO_SHIP → COMPLETED`; `CANCELLED` from any open state. Terminal: `COMPLETED`, `CANCELLED`. | Each step is a real handover in a small workshop. The transitions are enforced in one table (`PRODUCTION_TRANSITIONS`), so the UI and the service cannot disagree. |
| 159 | Design approval | Internal. Revisions are numbered per job; sending for approval expires earlier pending approvals; the manager records the customer's approval with an optional note. No public proof link yet. | The schema already has `approvalToken`, signer and expiry, but a public link needs a customer login and an email/SMS channel. Recording the approval keeps the workshop moving today. |
| 160 | Components | Stocked variants only, issued from the job's warehouse at AVCO through `PRODUCTION_ISSUE`. The same variant cannot be its own component. Issuing is idempotent and only moves the outstanding quantity. | Reusing the stock engine keeps AVCO, the append-only ledger and the journal in agreement. Refusing self-consumption keeps the average cost meaningful. |
| 161 | Work in progress | Account `1130 Work in Progress`. Issue posts DR `1130` / CR `1100`. `productionWipValue` is posted debit minus credit on `1130` for that job. | A stored job cost would need a repair path; the posted journal is already the truth. The detail page reads the same figure the ledger holds. |
| 162 | Completion | `COMPLETED` posts DR `5000 Cost of Goods Sold` / CR `1130` for the remaining job value. Production cannot start until every component is issued. | Revenue was recognised at the sale; completion only asks what the engraving consumed. Zeroing `1130` is what makes the WIP account meaningful. |
| 163 | Cancellation | After issue: `PRODUCTION_RETURN` inbound movements at the issue cost, then DR `1100` / CR `1130` for exactly the value returned. Before issue: no stock or journal movement. | Returning at the issue cost restores the average cost instead of revaluing the remaining stock. The journal follows the ledger value, so the two cannot disagree. |
| 164 | Finished good | Not received back into inventory. | The unit already left stock when it was sold. Receiving it again would double-count the same unit and create phantom availability. |
| 165 | Independence from shipping | Production status lives on the job and `OrderItem.productionStatus`; the order keeps its own `status` and `fulfillmentStatus`. | One team should not wait for the other's paperwork. A job can be ready before a courier is booked, and a shipment can move while quality check is open. |
| 166 | Permissions | `production.read` for list and detail; `production.write` for a job, revision or component; `production.approve` for design approval, material issue and status changes. `OWNER`/`MANAGER` all, `STOCK` `production.*`, `ACCOUNTANT`/`CASHIER` refused. | Issuing materials and approving a proof are the risky steps. Counter and accounts staff have no reason to see the workshop queue. |
| 167 | Verification data | Each HTTP run creates a fresh product, two variants, a warehouse, a customer and an order, then archives the variants and deactivates the warehouse. The journals and stock ledger stay. | A fresh order isolates the job arithmetic; the append-only ledger is never deleted, so the run leaves a clean audit trail. |

## 2o. Dropshipping defaults (Phase 3, module 8)

| # | Question | Default now | Why / how to change it |
| --- | --- | --- | --- |
| 168 | Module 8 scope | Prepaid dropshipping end to end: the sale raises the supplier order, the console sends and confirms it, shipping posts the cost and creates a direct shipment, delivery closes the sale. No supplier portal, no automatic courier booking and no COD dropship. | The hole was operational: a dropship sale created no supplier order. Closing that first is worth more than a second storefront feature. COD needs a remittance design of its own. |
| 169 | When the supplier order is created | Inside the sale transaction, right after the order lines. A dropship line without a supplier stops the whole sale. | A confirmed sale must never leave a supplier uninformed. A nightly job would show the customer a confirmed order that no supplier had seen, and a missing supplier would fail silently. |
| 170 | Grouping | One purchase order per supplier per sale, enforced by the partial unique index `uq_dropship_order_supplier` on `(orderId, supplierId) WHERE poType = 'DROPSHIP'`. | A multi-line supplier shipment belongs on one document, while two suppliers are two parcels. The index makes a double submission harmless. |
| 171 | Line cost | `variant.dropshipCost`, falling back to `costPrice`, snapshotted into `PurchaseItem.unitCost` and `lineTotal` at sale time. | The supplier price at the time of sale is the commitment. Re-reading the catalogue later would make the payable disagree with what was agreed. |
| 172 | Supplier order statuses | `DRAFT → SENT → CONFIRMED → SHIPPED → DELIVERED`; `CANCELLED` from draft, sent or confirmed. Standard statuses (`PARTIALLY_RECEIVED`, `RECEIVED`, `CLOSED`) never apply. One table (`DROPSHIP_TRANSITIONS`) drives the screen and the service. | A dropship order is a promise to ship, not a warehouse receipt. Separate statuses make the supplier's progress visible without pretending a GRN will arrive. |
| 173 | Prepaid rule | Shipping is refused while the sale has `dueAmount > 0`. COD dropship is deferred. | The supplier should not carry the customer's credit risk, and there is no COD remittance path for a direct supplier shipment yet. |
| 174 | Cost recognition | At `SHIPPED`: DR `5010 Dropship Cost of Goods Sold` / CR `1300 Accounts Payable` with the supplier id, `source: DROPSHIP_COGS`, `referenceType: "purchase_order"`. Idempotent on an existing posted entry. | A stocked sale credits `1100`, but dropship inventory never existed. Recognising the cost when the supplier ships matches the commitment and keeps inventory honest. |
| 175 | Shipment | A `DROPSHIP_DIRECT` shipment with `warehouseId: null`, the supplier id, the supplier tracking number and a `PICKED_UP` event. One live direct shipment per supplier (`uq_shipment_active_dropship`); normal outbound shipments stay one per order. The sale is walked to `READY_TO_SHIP` on the first dispatch and to `SHIPPED` only when every live supplier order has shipped. COD amount is zero. | Reusing the shipment record keeps the shipping screen and tracking history working, while the null warehouse records that no dispatch happened here. A sale split across suppliers has two independent parcels, so the sale must not claim to be shipped while one is still with the supplier. |
| 176 | Delivery | Appends a `DELIVERED` tracking event and closes that parcel directly, sets the supplier order to `DELIVERED`, and moves the sale to `DELIVERED` with fulfilment `FULFILLED` only when every live supplier order has arrived. | The customer's receipt is the proof. Using `addTrackingEvent` here would close the whole sale on the first parcel, so delivery writes the shipment itself and gates on all parcels. |
| 177 | Cancellation | A supplier order can be cancelled before shipping. Cancelling the sale cancels open dropship orders in the same transaction and is refused once any supplier order is shipped or delivered. | Before shipping the order is still a promise with no journal. After shipping the parcel exists, so a return must decide what happens to goods and money. |
| 178 | Payable | The supplier order is never received into stock: no GRN, no `receivedQty`, no inventory movement. The shipping journal credits `1300` with the supplier id, which `supplierPayable` and the supplier statement already read. | One payable source avoids a second ledger that can drift. The existing settlement page needed no change. |
| 179 | Standard purchase screens | `/purchases` filters to `poType: STANDARD`; `/purchases/[id]` redirects a dropship order to `/purchases/dropship/[id]`. | Mixing the two would offer receiving actions that make no sense for a direct shipment. Separate screens keep each flow obvious. |
| 180 | Permissions | `purchase.read` for list and detail; `purchase.approve` to send, confirm, ship, deliver or cancel. `OWNER`, `MANAGER` and `STOCK` can move; `ACCOUNTANT` reads; `CASHIER` is refused. | Moving a supplier order commits money and stock promises, which is the same weight as sending a standard purchase order. |
| 181 | Verification data | Each HTTP run creates a fresh supplier, product, dropship variant and two sales (paid and partly paid), then archives the variant, deactivates the supplier and blocks the customers. Journals and the order history stay. | A fresh supplier isolates grouping and payable checks; the append-only ledger is never deleted, so the run leaves a clean audit trail. |

## 2p. Customer account defaults (Phase 3, module 9)

| # | Question | Default now | Why / how to change it |
| --- | --- | --- | --- |
| 182 | Module 9 scope | Optional storefront accounts on top of guest checkout: register, sign in, profile, saved addresses, order history and online loyalty redemption. No SMS/WhatsApp OTP, no email verification, no social login and no automated password reset. | Guest checkout already works; an account is a convenience, not a gate. OTP and reset need a messaging channel the shop does not have yet. |
| 183 | Identity | The normalised Bangladeshi mobile number is the login. Credentials live on `Customer` (`passwordHash`, counters, timestamps), never on the staff `User` table. | Every order already uses the mobile, the courier needs it and the customer remembers it. Separate rows make it structurally impossible for a storefront login to become a counter permission. |
| 184 | Customer session | A separate `bgd26_customer` cookie, HttpOnly, SameSite=Lax, Secure outside development, 30-day TTL. Payload carries `scope: "customer"`; the signature covers a `customer.` prefix. | Customers shop from a personal phone and dislike re-login; staff share counter devices and keep the 7-day staff session. Domain separation stops either token being replayed on the other surface. |
| 185 | Registration and claim | A fresh mobile creates a customer row. An existing guest row is claimed instead of duplicated. If that row already has orders, one order number from it is required; a wrong number is refused and nothing changes. Blocked or soft-deleted rows cannot be claimed. | Without an SMS gateway, one order number is the strongest ownership proof available. It stops a stranger claiming another person's history by typing their number. |
| 186 | Password policy | Same as staff: at least 10 characters, a letter and a digit. Registration asks for confirmation; a change requires the current password and refuses reusing it. | One policy is easier to explain and to audit than a second, weaker customer rule. |
| 187 | Sign-in lockout | Five failed attempts lock the account for fifteen minutes; the counter resets after the lock. A blocked or deleted customer is refused even with a valid cookie. | The same rule as staff keeps the behaviour predictable and stops password guessing through the public login page. |
| 188 | Mobile number changes | Read-only for the customer; staff change it. | The mobile is the login and the order key. Self-service changes would need OTP on both old and new numbers, which the shop cannot send yet. |
| 189 | Saved addresses | Up to 20 per customer, soft-deleted. The first address is the default; setting a new default clears the old one in a transaction; deleting the default promotes the most recently updated survivor. | Checkout needs exactly one obvious choice, and a deletion must not leave a customer with addresses but no default. |
| 190 | Checkout identity | A signed-in customer orders against the account's own mobile, whatever the form posts. Saved addresses prefill recipient and address. A guest's flow is unchanged. | Loyalty and order history follow the mobile. Trusting a posted number would let a signed-in customer spend points and place history on someone else's number. |
| 191 | Online loyalty redemption | The checkout box allows up to `min(balance, 20 % of net merchandise)`. The browser figure is a preview; `quoteRedemption` re-checks the live balance and cap inside the sale transaction. | The POS and the storefront must apply one rule. Re-checking server-side means a tampered form cannot overspend. |
| 192 | Order access | `/account/orders` filters on the session's `customerId`; `/account/orders/[id]` returns 404 for another account. Guests keep the signed order link and the mobile-based `/track` page. | The order id in the URL is a lookup key, not proof. A 404 is clearer and leaks less than a redacted page. |
| 193 | Guards and redirects | Every account page calls `requireCustomer()` on the server and every action re-reads the session and ownership. `safeCustomerNext` accepts only a same-site path and never returns to login or register. | Hiding a link is not a guard. Keeping the next-destination check strict prevents an open redirect after sign-in. |
| 194 | Verification data | Each HTTP run creates a fresh product, variant, cart, two customers with saved addresses and two orders. It archives the product and variant, deletes the cart and blocks both customers; orders and journals stay. | A fresh pair of customers proves isolation. The append-only ledger is never deleted, so the run leaves an audit trail instead of cleanup. |

## 3. What is still needed from you (non-blocking)

These do not stop development, but they stop **go-live**:

1. BIN / VAT registration number and the real rate list.
2. Bank, bKash and Nagad merchant numbers plus opening balances.
3. Courier merchant credentials and pickup addresses.
4. WhatsApp WABA ID, business number and Meta-approved templates.
5. Payment gateway live keys and refund policy confirmation.
6. Legal text approval for the six policy pages.
7. A Supabase Storage bucket (`bgd26-media`, public read for `gallery/`) once
   the project is restored; development uses local disk and needs nothing.

Until each arrives, the system runs in sandbox with zero opening balances.

## 4. সংক্ষেপে

ফেজ ১ অনুমোদিত। এখন সুপারিশকৃত ডিফল্ট দিয়ে কাজ চলছে: দামে ভ্যাট অন্তর্ভুক্ত (১৫%,
বই ০%), একটি দোকান ও একটি গুদাম, ড্রপশিপ ও সাধারণ পণ্য একই অর্ডারে চলবে, পয়েন্ট
ডেলিভারির পরে, ৫০% অগ্রিম, রিভিউ ম্যানুয়াল অনুমোদন, নিউজলেটার ডাবল অপ্ট-ইন।
ব্যাংক/বিকাশ নম্বর, ভ্যাট রেজিস্ট্রেশন, কুরিয়ার ও হোয়াটসঅ্যাপ তথ্য পরে দিলেও
চলবে—শুধু লাইভ যাওয়ার আগে দরকার।
