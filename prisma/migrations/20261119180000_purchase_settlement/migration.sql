-- Supplier settlement: a return to the supplier gets its own stock movement
-- type, each received line remembers how much has already gone back, and a cash
-- refund can carry the supplier's reference.

ALTER TYPE "StockMovementType" ADD VALUE IF NOT EXISTS 'PURCHASE_RETURN';

ALTER TABLE "goods_received_items"
  ADD COLUMN "returnedQty" DECIMAL(14, 3) NOT NULL DEFAULT 0;

ALTER TABLE "purchase_returns"
  ADD COLUMN "refundReference" TEXT;
