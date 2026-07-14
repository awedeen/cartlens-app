-- One-time data heal: repair converted carts corrupted by post-conversion writes.
--
-- Before the carts/checkouts webhook handlers learned to lock a converted
-- session, Shopify's post-purchase traffic on the same cart_token could still
-- mutate a completed order:
--   * the post-purchase cart-clear (carts/update, no items) wrote cart_remove
--     events and zeroed the cart -> "empty converted cart".
--   * a reused cart_token piled fresh cart_add events onto the order ->
--     "converted cart full of parts the customer didn't buy".
--
-- Fingerprint of the corruption: any event timestamped AFTER the session's
-- checkout_completed marker. We restore each affected converted cart to what it
-- was at purchase, then delete the offending events.
--
-- This migration runs exactly once (Prisma tracks it), only touches converted
-- sessions that actually have post-conversion events, and recomputes totals from
-- the surviving pre-conversion events only.

-- 1. Restore itemCount/cartTotal from surviving (<= conversion) events, for
--    converted sessions that carry post-conversion junk. Runs before the delete;
--    it reads only survivors (timestamp <= conversion) so the order is immaterial.
WITH conv AS (
  SELECT ce."sessionId", MAX(ce."timestamp") AS converted_at
  FROM "CartEvent" ce
  JOIN "CartSession" s ON s.id = ce."sessionId" AND s."orderPlaced" = true
  WHERE ce."eventType" = 'checkout_completed'
  GROUP BY ce."sessionId"
),
affected AS (
  SELECT DISTINCT ce."sessionId"
  FROM "CartEvent" ce
  JOIN conv ON ce."sessionId" = conv."sessionId"
  WHERE ce."timestamp" > conv.converted_at
    AND ce."eventType" <> 'checkout_completed'
),
survivors AS (
  SELECT ce."sessionId",
    GREATEST(0, COALESCE(SUM(
      CASE WHEN ce."eventType" = 'cart_add'    THEN COALESCE(ce."quantity", 0)
           WHEN ce."eventType" = 'cart_remove' THEN -COALESCE(ce."quantity", 0)
           ELSE 0 END), 0)) AS item_count,
    GREATEST(0, COALESCE(SUM(
      CASE WHEN ce."eventType" = 'cart_add'    THEN COALESCE(ce."price", 0) * COALESCE(ce."quantity", 0)
           WHEN ce."eventType" = 'cart_remove' THEN -COALESCE(ce."price", 0) * COALESCE(ce."quantity", 0)
           ELSE 0 END), 0)) AS cart_total
  FROM "CartEvent" ce
  JOIN conv ON ce."sessionId" = conv."sessionId"
  WHERE ce."sessionId" IN (SELECT "sessionId" FROM affected)
    AND ce."timestamp" <= conv.converted_at
  GROUP BY ce."sessionId"
)
UPDATE "CartSession" s
SET "itemCount" = sv.item_count,
    "cartTotal" = ROUND(sv.cart_total::numeric, 2)::double precision
FROM survivors sv
WHERE s.id = sv."sessionId";

-- 2. Delete the post-conversion events (the corruption). Keep the
--    checkout_completed marker itself even if duplicated at the same instant.
DELETE FROM "CartEvent" e
USING (
  SELECT ce."sessionId", MAX(ce."timestamp") AS converted_at
  FROM "CartEvent" ce
  JOIN "CartSession" s ON s.id = ce."sessionId" AND s."orderPlaced" = true
  WHERE ce."eventType" = 'checkout_completed'
  GROUP BY ce."sessionId"
) conv
WHERE e."sessionId" = conv."sessionId"
  AND e."timestamp" > conv.converted_at
  AND e."eventType" <> 'checkout_completed';
