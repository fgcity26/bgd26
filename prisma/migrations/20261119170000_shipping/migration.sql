-- Shipping invariants.
--
-- A shipment is the physical hand-over of an order to a courier. The money it
-- carries is cash the courier will collect on delivery, so the database refuses
-- a negative COD amount or delivery charge, and a delivered timestamp before
-- the shipped one.
--
-- One live shipment per order: a cancelled, failed or returned attempt may be
-- followed by a new one, but two active consignments for the same order would
-- mean the same parcel is with two couriers.

ALTER TABLE "shipments"
  ADD CONSTRAINT "chk_shipment_cod" CHECK ("codAmount" >= 0),
  ADD CONSTRAINT "chk_shipment_delivery_charge" CHECK ("deliveryCharge" >= 0),
  ADD CONSTRAINT "chk_shipment_dates"
    CHECK ("shippedAt" IS NULL OR "deliveredAt" IS NULL OR "shippedAt" <= "deliveredAt");

CREATE UNIQUE INDEX "uq_shipment_active_order"
  ON "shipments" ("orderId")
  WHERE "status" NOT IN ('CANCELLED', 'FAILED', 'RETURNED');
