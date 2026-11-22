-- Engraving production: a journal source for production postings and a work in
-- progress account that holds the value of issued components until the job is
-- completed or cancelled.

ALTER TYPE "JournalSource" ADD VALUE IF NOT EXISTS 'PRODUCTION';

INSERT INTO "accounts" (
  "id", "code", "name", "nameBn", "type", "normalBalance",
  "isSystem", "isActive", "createdAt", "updatedAt"
)
VALUES (
  'acc-1130-work-in-progress', '1130', 'Work in Progress', 'চলমান উৎপাদন',
  'ASSET', 'DEBIT', true, true, now(), now()
)
ON CONFLICT ("code") DO NOTHING;
