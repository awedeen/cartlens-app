-- Index on Session.shop for efficient lookup by shop domain.
-- Used by: api.public.events (every pixel event) and app.api.sse (every SSE connect).
-- Without this, both paths do a sequential scan of the Session table.
CREATE INDEX IF NOT EXISTS "Session_shop_idx" ON "Session"("shop");
