## Summary

Major feature update — UTM attribution, geolocation, pixel CORS fix, and a full Reports tab overhaul. This is the first significant update since the initial App Store launch.

## What's Fixed (Critical)

**Pixel events were silently failing on production.** The Web Pixel sandbox sends requests from `extensions.shopifycdn.com` — without CORS headers, every `fetch()` was being dropped by the browser. This means device type, location, and UTM data have never populated on production sessions. This PR fixes that.

**Root cause:** Missing `Access-Control-Allow-Origin` header on `/api/public/events`. All session data from the pixel was silently discarded.

## New Features

### UTM Attribution
- Full UTM tracking: `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_id` (covers Meta fbclid)
- Pixel rewritten to use in-memory store (`utmStore`) — `browser.sessionStorage` is unavailable in the strict pixel sandbox
- UTMs backfill on existing sessions when a return visitor arrives with UTM params
- Channel detection: Facebook Ads / Instagram Ads / Meta Ads / Google Ads / TikTok Ads / Email / SMS / Organic Search / etc.

### Geolocation
- IP geolocation via `iplocate.io` when Cloudflare headers unavailable (Railway uses Fastly, not CF)
- 1.5s timeout, non-fatal — geo failure = null fields, request continues

### Reports Tab (full overhaul)
- **Channel Performance** — carts / checkouts / orders / conv. rate by traffic source
- **Top Campaigns** — by `utm_campaign` with revenue column
- **Top Abandoned Products** — products added but never purchased
- **Top Locations** — by city + country
- **Variant breakdown** — expandable rows in Top Products (real variants only, not Shopify default variants)
- All tables sortable by any column
- Revenue card (replaced Avg Cart Value)
- CSV export respects selected date range
- Empty state when no data in range
- Removed redundant Funnel section and Top Referrers table

### Live Carts Tab
- 24h / 7d / 30d time filter
- Converted sessions: green left accent. Checkout-started: amber accent.
- Traffic source badge (color-coded) on each card
- Geo location shown on cards
- "View details" affordance on cards

## Infrastructure
- CORS headers on all `/api/public/events` response paths including OPTIONS preflight
- Webhook dedup on carts handler (Shopify retry protection)
- Health check endpoint `GET /health`
- Cleanup cron trigger `POST /api/internal/cleanup`
- Structured logging

## Schema Changes
Two additive migrations (nullable columns, no breaking changes):
- `CartSession.utmContent String?`
- `CartSession.utmId String?`
- `CartSession.deviceModel String?`

## Post-Merge Required
1. Verify Railway production deployment is green
2. Run `npx shopify app deploy --force` to push updated pixel extension to Shopify CDN
3. Smoke test: install on a real store, visit with `?utm_source=test` URL, add to cart, verify session shows UTM + geo

## No Shopify Re-Review Required
- `shopify.app.toml` unchanged (confirmed by git diff)
- No new OAuth scopes
- No new webhook topics
- All changes are backend code, schema additions, and UI
