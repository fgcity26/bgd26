-- Default WhatsApp notification rows.
--
-- The wording is a starting point, not Meta-approved copy. Each template stays
-- PENDING until the owner copies the approved text and marks it APPROVED in the
-- console (or Meta's template webhook does it in a later module).
--
-- This is a separate migration from the enum change so PostgreSQL can use the
-- newly added WaNotificationEvent values in the same deploy.

INSERT INTO "whatsapp_settings" ("id", "updatedAt")
VALUES ('default', NOW())
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "whatsapp_templates"
  ("id", "name", "language", "category", "status", "event", "bodyText", "headerText", "footerText", "variables", "createdAt", "updatedAt")
VALUES
  (
    'wa_tpl_order_confirmation_bn',
    'order_confirmation',
    'bn',
    'UTILITY',
    'PENDING',
    'ORDER_CONFIRMED',
    'আসসালামু আলাইকুম {{1}}, আপনার অর্ডার {{2}} নিশ্চিত হয়েছে। মোট {{3}} টাকা। ধন্যবাদ — bgd26।',
    NULL,
    'bgd26.com',
    '[]'::jsonb,
    NOW(),
    NOW()
  ),
  (
    'wa_tpl_order_shipped_bn',
    'order_shipped',
    'bn',
    'UTILITY',
    'PENDING',
    'ORDER_SHIPPED',
    'আপনার অর্ডার {{1}} পাঠানো হয়েছে। কুরিয়ার {{2}}, ট্র্যাকিং নম্বর {{3}}।',
    NULL,
    'bgd26.com',
    '[]'::jsonb,
    NOW(),
    NOW()
  ),
  (
    'wa_tpl_refund_completed_bn',
    'refund_completed',
    'bn',
    'UTILITY',
    'PENDING',
    'REFUND_COMPLETED',
    'আপনার অর্ডার {{1}}-এর {{3}} টাকার রিফান্ড সম্পন্ন হয়েছে। মাধ্যম: {{4}}। ধন্যবাদ।',
    NULL,
    'bgd26.com',
    '[]'::jsonb,
    NOW(),
    NOW()
  ),
  (
    'wa_tpl_payment_reminder_bn',
    'payment_reminder',
    'bn',
    'UTILITY',
    'PENDING',
    'PAYMENT_REMINDER',
    'আসসালামু আলাইকুম {{1}}, অর্ডার {{2}}-এর বাকি {{3}} টাকা পরিশোধ করুন। ধন্যবাদ।',
    NULL,
    'bgd26.com',
    '[]'::jsonb,
    NOW(),
    NOW()
  ),
  (
    'wa_tpl_review_request_bn',
    'review_request',
    'bn',
    'MARKETING',
    'PENDING',
    'REVIEW_REQUEST',
    'ধন্যবাদ {{1}}! আপনার অর্ডার {{2}} কেমন লেগেছে জানান: {{3}}',
    NULL,
    'bgd26.com',
    '[]'::jsonb,
    NOW(),
    NOW()
  )
ON CONFLICT ("name", "language") DO NOTHING;
