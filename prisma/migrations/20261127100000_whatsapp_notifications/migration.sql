-- WhatsApp Cloud API notifications (module 4c).
--
-- Adds the durable outbox fields on whatsapp_messages, the event binding on
-- templates, and the singleton notification settings row. Enum additions live
-- here; the default rows are inserted in the next migration so PostgreSQL can
-- use the new enum values after the type change commits.

-- CreateEnum
CREATE TYPE "WaNotificationEvent" AS ENUM ('ORDER_CONFIRMED', 'ORDER_SHIPPED', 'REFUND_COMPLETED', 'PAYMENT_REMINDER', 'REVIEW_REQUEST', 'MANUAL');

-- AlterEnum
ALTER TYPE "WaMessageStatus" ADD VALUE 'SKIPPED';

-- AlterTable
ALTER TABLE "whatsapp_messages" ADD COLUMN     "attemptCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "dedupeKey" TEXT,
ADD COLUMN     "event" "WaNotificationEvent" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "lastAttemptAt" TIMESTAMP(3),
ADD COLUMN     "lockedAt" TIMESTAMP(3),
ADD COLUMN     "maxAttempts" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "nextAttemptAt" TIMESTAMP(3),
ADD COLUMN     "recipient" VARCHAR(20),
ADD COLUMN     "relatedOrderId" TEXT,
ADD COLUMN     "relatedRefundId" TEXT,
ADD COLUMN     "templateLanguage" TEXT,
ADD COLUMN     "templateName" TEXT,
ADD COLUMN     "templateVariables" JSONB;

-- AlterTable
ALTER TABLE "whatsapp_templates" ADD COLUMN     "event" "WaNotificationEvent";

-- CreateTable
CREATE TABLE "whatsapp_settings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "autoSend" BOOLEAN NOT NULL DEFAULT true,
    "orderConfirmation" BOOLEAN NOT NULL DEFAULT true,
    "orderShipped" BOOLEAN NOT NULL DEFAULT true,
    "refundCompleted" BOOLEAN NOT NULL DEFAULT true,
    "paymentReminder" BOOLEAN NOT NULL DEFAULT false,
    "reviewRequest" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByUserId" TEXT,

    CONSTRAINT "whatsapp_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_messages_dedupeKey_key" ON "whatsapp_messages"("dedupeKey");

-- CreateIndex
CREATE INDEX "whatsapp_messages_status_nextAttemptAt_idx" ON "whatsapp_messages"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "whatsapp_messages_relatedOrderId_idx" ON "whatsapp_messages"("relatedOrderId");

-- CreateIndex
CREATE INDEX "whatsapp_messages_relatedRefundId_idx" ON "whatsapp_messages"("relatedRefundId");

-- CreateIndex
CREATE INDEX "whatsapp_templates_event_status_idx" ON "whatsapp_templates"("event", "status");

-- AddForeignKey
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_relatedOrderId_fkey" FOREIGN KEY ("relatedOrderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_relatedRefundId_fkey" FOREIGN KEY ("relatedRefundId") REFERENCES "refunds"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_settings" ADD CONSTRAINT "whatsapp_settings_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
