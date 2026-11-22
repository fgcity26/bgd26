-- Storefront customer accounts. The mobile number stays the identity; these
-- columns hold only the password hash and the same lockout counters the staff
-- login uses. Guest customers keep working with these columns null.

ALTER TABLE "customers"
  ADD COLUMN IF NOT EXISTS "passwordHash" TEXT,
  ADD COLUMN IF NOT EXISTS "passwordUpdatedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "lockedUntil" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lastLoginAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "accountClaimedAt" TIMESTAMP(3);
