-- Remove stale cartlinkEnabled column
ALTER TABLE "Shop" DROP COLUMN IF EXISTS "cartlinkEnabled";

-- Add high-value cart threshold (nullable float, in dollars)
ALTER TABLE "Shop" ADD COLUMN IF NOT EXISTS "highValueThreshold" DOUBLE PRECISION;
