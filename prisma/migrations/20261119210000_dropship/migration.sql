-- Dropship purchase orders: the supplier ships straight to the customer, so the
-- order needs its own statuses and timestamps. A partial unique index guarantees
-- one dropship order per supplier per customer order.

ALTER TYPE "PurchaseOrderStatus" ADD VALUE IF NOT EXISTS 'CONFIRMED';
ALTER TYPE "PurchaseOrderStatus" ADD VALUE IF NOT EXISTS 'SHIPPED';
ALTER TYPE "PurchaseOrderStatus" ADD VALUE IF NOT EXISTS 'DELIVERED';

ALTER TABLE "purchase_orders"
  ADD COLUMN IF NOT EXISTS "confirmedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "shippedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "deliveredAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "cancelReason" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "uq_dropship_order_supplier"
  ON "purchase_orders" ("orderId", "supplierId")
  WHERE "poType" = 'DROPSHIP' AND "orderId" IS NOT NULL;
