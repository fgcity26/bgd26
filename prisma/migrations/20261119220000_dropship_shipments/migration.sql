-- A sale split across suppliers travels as separate direct parcels, so one
-- customer order may legitimately have more than one live dropship shipment.
-- Normal outbound shipments keep the stricter one-per-order rule.

DROP INDEX IF EXISTS "uq_shipment_active_order";

CREATE UNIQUE INDEX "uq_shipment_active_order"
  ON "shipments" ("orderId")
  WHERE "status" NOT IN ('CANCELLED', 'FAILED', 'RETURNED')
    AND "shipmentType" <> 'DROPSHIP_DIRECT';

CREATE UNIQUE INDEX "uq_shipment_active_dropship"
  ON "shipments" ("orderId", "supplierId")
  WHERE "status" NOT IN ('CANCELLED', 'FAILED', 'RETURNED')
    AND "shipmentType" = 'DROPSHIP_DIRECT';
