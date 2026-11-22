-- Adds the first-sign-in password change flag.
--
-- The seed creates the owner with a temporary password and sets this to true;
-- the app then refuses every other screen until a new password is saved. An
-- administrator resetting a password sets it again, which gives the same
-- forced-change behaviour without a second table.

ALTER TABLE "users"
  ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;

-- Existing seeded owner accounts (created before this column) must also change
-- their temporary password, so flag any account that has never signed in.
UPDATE "users"
   SET "mustChangePassword" = true
 WHERE "lastLoginAt" IS NULL
   AND "passwordHash" IS NOT NULL;
