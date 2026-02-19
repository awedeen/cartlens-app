-- Update default retentionDays from 30 to 90 for all existing shops
ALTER TABLE "Shop" ALTER COLUMN "retentionDays" SET DEFAULT 90;
UPDATE "Shop" SET "retentionDays" = 90 WHERE "retentionDays" = 30;
