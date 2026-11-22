-- Storefront invariants.
--
-- The storefront reuses the cart, coupon and delivery-zone tables that were
-- part of the original 90-table schema. These CHECKs make the money and
-- quantity rules true even if a service bug or a stray script writes directly:
-- a coupon can never hold a negative value, a cart line can never hold a
-- non-positive quantity, a delivery charge can never be negative, and an order
-- can never carry a negative coupon, discount, VAT, delivery or loyalty amount.
-- `chk_order_totals` already ties the grand total to those parts.

ALTER TABLE "coupons"
  ADD CONSTRAINT "chk_coupon_value" CHECK ("value" >= 0),
  ADD CONSTRAINT "chk_coupon_min_order" CHECK ("minOrderValue" >= 0),
  ADD CONSTRAINT "chk_coupon_max_discount"
    CHECK ("maxDiscount" IS NULL OR "maxDiscount" >= 0),
  ADD CONSTRAINT "chk_coupon_used_count" CHECK ("usedCount" >= 0),
  ADD CONSTRAINT "chk_coupon_usage_limit"
    CHECK ("usageLimit" IS NULL OR "usageLimit" >= 0),
  ADD CONSTRAINT "chk_coupon_per_customer" CHECK ("usageLimitPerCustomer" >= 0),
  ADD CONSTRAINT "chk_coupon_window"
    CHECK ("startsAt" IS NULL OR "endsAt" IS NULL OR "startsAt" < "endsAt");

ALTER TABLE "coupon_redemptions"
  ADD CONSTRAINT "chk_coupon_redemption_amount" CHECK ("discountAmount" >= 0);

ALTER TABLE "carts"
  ADD CONSTRAINT "chk_cart_subtotal" CHECK ("subtotal" >= 0),
  ADD CONSTRAINT "chk_cart_discount" CHECK ("discountTotal" >= 0),
  ADD CONSTRAINT "chk_cart_vat" CHECK ("vatTotal" >= 0),
  ADD CONSTRAINT "chk_cart_delivery" CHECK ("deliveryCharge" >= 0),
  ADD CONSTRAINT "chk_cart_total" CHECK ("grandTotal" >= 0);

ALTER TABLE "cart_items"
  ADD CONSTRAINT "chk_cart_item_qty" CHECK ("quantity" > 0),
  ADD CONSTRAINT "chk_cart_item_price" CHECK ("unitPrice" >= 0);

ALTER TABLE "delivery_zones"
  ADD CONSTRAINT "chk_delivery_charge" CHECK ("charge" >= 0),
  ADD CONSTRAINT "chk_delivery_free_threshold"
    CHECK ("freeShippingThreshold" IS NULL OR "freeShippingThreshold" >= 0),
  ADD CONSTRAINT "chk_delivery_days"
    CHECK ("estimatedDaysMin" >= 0 AND "estimatedDaysMax" >= "estimatedDaysMin");

ALTER TABLE "orders"
  ADD CONSTRAINT "chk_order_subtotal" CHECK ("subtotal" >= 0),
  ADD CONSTRAINT "chk_order_discount" CHECK ("discountTotal" >= 0),
  ADD CONSTRAINT "chk_order_coupon_discount" CHECK ("couponDiscount" >= 0),
  ADD CONSTRAINT "chk_order_vat" CHECK ("vatTotal" >= 0),
  ADD CONSTRAINT "chk_order_delivery" CHECK ("deliveryCharge" >= 0),
  ADD CONSTRAINT "chk_order_loyalty_discount" CHECK ("loyaltyDiscount" >= 0);
