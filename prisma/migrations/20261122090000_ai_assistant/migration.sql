-- Module 10: AI assistant (read + draft only).
--
-- The existing ai_conversation_logs / ai_action_logs tables already cover the
-- audit trail. This migration adds the counters the console needs to show and
-- enforce a monthly token budget, plus a per-user timeline index for the
-- hourly request limit.

ALTER TABLE "ai_conversation_logs"
  ADD COLUMN "lastMessageAt" TIMESTAMP(3),
  ADD COLUMN "inputTokens" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "outputTokens" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "ai_conversation_logs_userId_startedAt_idx"
  ON "ai_conversation_logs"("userId", "startedAt");
