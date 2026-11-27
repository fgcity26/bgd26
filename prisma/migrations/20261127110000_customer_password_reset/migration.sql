-- Customer password reset over WhatsApp.
--
-- A reset row holds only a scrypt hash of the six-digit code. The code is sent
-- as an AUTHENTICATION template with a copy-code button and is never stored in
-- plain text or written to the message history. The password_reset_otp template
-- starts PENDING until the owner has it approved in the Meta console.

-- CreateTable
CREATE TABLE "customer_password_resets" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "phoneNumberNormalized" VARCHAR(20) NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "consumedAt" TIMESTAMP(3),
    "requestedIp" VARCHAR(64),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_password_resets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customer_password_resets_customerId_createdAt_idx" ON "customer_password_resets"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "customer_password_resets_phoneNumberNormalized_createdAt_idx" ON "customer_password_resets"("phoneNumberNormalized", "createdAt");

-- CreateIndex
CREATE INDEX "customer_password_resets_expiresAt_idx" ON "customer_password_resets"("expiresAt");

-- AddForeignKey
ALTER TABLE "customer_password_resets" ADD CONSTRAINT "customer_password_resets_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Authentication template for the reset code. event is NULL because this is
-- not an order notification and is not gated by marketing consent.
INSERT INTO "whatsapp_templates"
  ("id", "name", "language", "category", "status", "event", "bodyText", "headerText", "footerText", "variables", "createdAt", "updatedAt")
VALUES
  (
    'wa_tpl_password_reset_otp_bn',
    'password_reset_otp',
    'bn',
    'AUTHENTICATION',
    'PENDING',
    NULL,
    E'আপনার bgd26 পাসওয়ার্ড রিসেট কোড: {{1}}\n\nকোডটি ১০ মিনিটের মধ্যে ব্যবহার করুন। আপনি অনুরোধ না করলে এই বার্তাটি উপেক্ষা করুন।',
    NULL,
    'bgd26.com',
    '[]'::jsonb,
    NOW(),
    NOW()
  )
ON CONFLICT ("name", "language") DO NOTHING;
