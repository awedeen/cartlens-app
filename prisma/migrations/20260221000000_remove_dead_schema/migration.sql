-- Remove dead schema: ShopSettings, AggregatedStats, merchantOverride
DROP TABLE IF EXISTS "ShopSettings";
DROP TABLE IF EXISTS "AggregatedStats";
ALTER TABLE "CartSession" DROP COLUMN IF EXISTS "merchantOverride";
