-- =============================================================================
-- bgd26 — business invariants that Prisma cannot express
--
-- Applied after the generated schema migration. Everything here is a last line
-- of defence: the service layer checks first, the database refuses to store an
-- impossible state. See docs/ARCHITECTURE.md §12.4 and §19.
--
-- Naming convention: tables are snake_case (Prisma @@map), columns keep the
-- Prisma field name in camelCase, so every column reference is double-quoted.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Money sanity
-- -----------------------------------------------------------------------------
ALTER TABLE orders
  ADD CONSTRAINT "chk_order_totals" CHECK (
    "grandTotal" = "subtotal" - "discountTotal" - "couponDiscount" + "vatTotal"
                   + "deliveryCharge" - "loyaltyDiscount"
    AND "grandTotal" >= 0
    AND "paidAmount" >= 0
    -- Overpayment is stored as customer credit, never as a negative due.
    AND "dueAmount" = GREATEST("grandTotal" - "paidAmount", 0)
  );

ALTER TABLE order_items
  ADD CONSTRAINT "chk_item_vat" CHECK ("vatPercentageSnapshot" BETWEEN 0 AND 100);

ALTER TABLE order_items
  ADD CONSTRAINT "chk_item_qty" CHECK ("quantity" > 0 AND "refundedQty" >= 0);

-- -----------------------------------------------------------------------------
-- 2. Identity and classification flags
-- -----------------------------------------------------------------------------
ALTER TABLE customers
  ADD CONSTRAINT "chk_walk_in_flag" CHECK (
    ("customerType" = 'WALK_IN_CASH') = "isWalkInCash"
  );

ALTER TABLE categories
  ADD CONSTRAINT "chk_category_vat" CHECK ("vatPercentage" BETWEEN 0 AND 100);

ALTER TABLE products
  ADD CONSTRAINT "chk_advance_percentage" CHECK ("advancePercentage" BETWEEN 0 AND 100);

ALTER TABLE product_reviews
  ADD CONSTRAINT "chk_review_rating" CHECK ("rating" BETWEEN 1 AND 5);

ALTER TABLE newsletter_subscribers
  ADD CONSTRAINT "chk_newsletter_email_lower" CHECK ("email" = lower("email"));

-- WALK_IN_CASH orders: POS only, fully paid, no digital payment.
CREATE OR REPLACE FUNCTION assert_walk_in_rules() RETURNS trigger AS $$
BEGIN
  IF NEW."isWalkInCash" THEN
    IF NEW."channel" <> 'POS' OR NEW."paymentStatus" <> 'PAID'
       OR NEW."dueAmount" <> 0 THEN
      RAISE EXCEPTION 'WALK_IN_CASH requires a fully paid POS sale';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_walk_in_order
  BEFORE INSERT OR UPDATE OF "isWalkInCash", "channel", "paymentStatus", "dueAmount"
  ON orders
  FOR EACH ROW EXECUTE FUNCTION assert_walk_in_rules();

-- Payments are inserted after the order, so guard that path too.
CREATE OR REPLACE FUNCTION assert_walk_in_payment() RETURNS trigger AS $$
BEGIN
  IF NEW."method" <> 'CASH' AND EXISTS (
    SELECT 1 FROM orders o
    WHERE o."id" = NEW."orderId" AND o."isWalkInCash"
  ) THEN
    RAISE EXCEPTION 'WALK_IN_CASH cannot use digital or credit payment';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_walk_in_payment
  BEFORE INSERT OR UPDATE OF "method" ON payments
  FOR EACH ROW EXECUTE FUNCTION assert_walk_in_payment();

-- -----------------------------------------------------------------------------
-- 3. Balanced, immutable journals
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION assert_journal_balanced() RETURNS trigger AS $$
DECLARE d numeric; c numeric;
BEGIN
  SELECT COALESCE(SUM("debit"), 0), COALESCE(SUM("credit"), 0)
    INTO d, c
  FROM journal_entry_lines
  WHERE "journalEntryId" = NEW."id";

  IF d <> c OR d = 0 THEN
    RAISE EXCEPTION 'Journal % unbalanced: debit %, credit %', NEW."id", d, c;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER trg_journal_balanced
  AFTER INSERT OR UPDATE OF "status" ON journal_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (NEW."status" = 'POSTED')
  EXECUTE FUNCTION assert_journal_balanced();

CREATE OR REPLACE FUNCTION forbid_posted_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Posted accounting rows are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_journal_immutable
  BEFORE UPDATE OR DELETE ON journal_entries
  FOR EACH ROW WHEN (OLD."status" = 'POSTED')
  EXECUTE FUNCTION forbid_posted_mutation();

-- Lines of a posted entry are immutable too, including late inserts.
CREATE OR REPLACE FUNCTION forbid_posted_line_mutation() RETURNS trigger AS $$
DECLARE entry_status "JournalEntryStatus";
BEGIN
  SELECT "status" INTO entry_status
  FROM journal_entries
  WHERE "id" = COALESCE(NEW."journalEntryId", OLD."journalEntryId");

  IF entry_status = 'POSTED' THEN
    RAISE EXCEPTION 'Lines of a posted journal entry are immutable';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_journal_line_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON journal_entry_lines
  FOR EACH ROW EXECUTE FUNCTION forbid_posted_line_mutation();

-- -----------------------------------------------------------------------------
-- 4. Ledger and audit immutability
-- -----------------------------------------------------------------------------
CREATE TRIGGER trg_stock_ledger_immutable
  BEFORE UPDATE OR DELETE ON stock_ledger
  FOR EACH ROW EXECUTE FUNCTION forbid_posted_mutation();

CREATE TRIGGER trg_audit_immutable
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION forbid_posted_mutation();

-- -----------------------------------------------------------------------------
-- 5. No bundle self-reference (recursive cycle check lives in the service)
-- -----------------------------------------------------------------------------
ALTER TABLE bundle_items
  ADD CONSTRAINT "chk_bundle_not_self" CHECK ("bundleVariantId" <> "componentVariantId");

-- -----------------------------------------------------------------------------
-- 6. One default / one active row per scope
-- -----------------------------------------------------------------------------
CREATE UNIQUE INDEX "uq_customer_default_address"
  ON customer_addresses("customerId", "addressType")
  WHERE "isDefault" AND "deletedAt" IS NULL;

CREATE UNIQUE INDEX "uq_default_warehouse"
  ON warehouses("isDefault") WHERE "isDefault";

CREATE UNIQUE INDEX "uq_primary_product_image"
  ON product_media("productId") WHERE "isPrimary" AND "role" = 'GALLERY';

CREATE UNIQUE INDEX "uq_open_shift_per_device"
  ON pos_shifts("deviceId") WHERE "status" = 'OPEN';

CREATE UNIQUE INDEX "uq_default_variant"
  ON product_variants("productId") WHERE "isDefault";

CREATE UNIQUE INDEX "uq_default_wishlist"
  ON wishlists("customerId") WHERE "isDefault";

-- -----------------------------------------------------------------------------
-- 7. Inventory projection integrity (deferred so multi-row updates settle)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION assert_balance_math() RETURNS trigger AS $$
BEGIN
  IF NEW."availableQty" <> NEW."physicalQty" - NEW."reservedQty"
       - NEW."damagedQty" - NEW."quarantinedQty" - NEW."inProductionQty" THEN
    RAISE EXCEPTION 'inventory projection mismatch for %', NEW."id";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER trg_balance_math
  AFTER INSERT OR UPDATE ON inventory_balances
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_balance_math();

-- NOTE: physicalQty is intentionally allowed to go negative ONLY through the
-- offline-sync path, which must also insert stock_conflict_exceptions.
