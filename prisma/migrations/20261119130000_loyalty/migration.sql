-- Loyalty ledger invariants.
--
-- Points are money-adjacent: one point is worth one taka and the balance is a
-- liability, so the database refuses a negative balance, a zero movement and a
-- movement whose sign contradicts its type. The two partial unique indexes make
-- earning and redeeming idempotent per order: a retried sale or a second
-- verification can never award or spend the same points twice.

ALTER TABLE "customers"
  ADD CONSTRAINT "chk_customer_loyalty_balance"
  CHECK ("loyaltyPointsBalance" >= 0);

ALTER TABLE "loyalty_transactions"
  ADD CONSTRAINT "chk_loyalty_balance_after"
  CHECK ("balanceAfter" >= 0);

ALTER TABLE "loyalty_transactions"
  ADD CONSTRAINT "chk_loyalty_points_nonzero"
  CHECK ("points" <> 0);

ALTER TABLE "loyalty_transactions"
  ADD CONSTRAINT "chk_loyalty_sign"
  CHECK (
    ("type" = 'EARN' AND "points" > 0)
    OR ("type" = 'REDEEM' AND "points" < 0)
    OR ("type" = 'EXPIRE' AND "points" < 0)
    OR ("type" = 'REVERSAL' AND "points" <> 0)
    OR ("type" = 'ADJUSTMENT' AND "points" <> 0)
  );

CREATE UNIQUE INDEX "uq_loyalty_earn_order"
  ON "loyalty_transactions" ("orderId")
  WHERE "type" = 'EARN' AND "orderId" IS NOT NULL;

CREATE UNIQUE INDEX "uq_loyalty_redeem_order"
  ON "loyalty_transactions" ("orderId")
  WHERE "type" = 'REDEEM' AND "orderId" IS NOT NULL;

CREATE INDEX "idx_loyalty_reference"
  ON "loyalty_transactions" ("referenceType", "referenceId");
