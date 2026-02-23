-- Partial unique index: only one "checkout_started" event is meaningful per cart session.
-- Prevents duplicate events when Shopify fires concurrent or retry checkout webhooks.
-- PostgreSQL partial indexes are not expressible in the Prisma schema DSL,
-- so this is applied as a raw migration.
CREATE UNIQUE INDEX IF NOT EXISTS "CartEvent_sessionId_checkout_started_key"
  ON "CartEvent"("sessionId")
  WHERE "eventType" = 'checkout_started';
