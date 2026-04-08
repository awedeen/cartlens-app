# CartLens Changelog

## [Unreleased] — dev branch (pending merge to main)

### Infrastructure & DevOps
- **Branch protection** — `main` branch now requires PR + review before merging. Direct pushes blocked via GitHub ruleset.
- **Staging environment** — Railway `staging` environment created, auto-deploys from `dev` branch. URL: `cartlens-app-staging.up.railway.app`
- **Health check endpoint** — `GET /health` returns `{status, db, ts}`. Configured as Railway healthcheck path on both environments.
- **Cleanup cron trigger** — `POST /api/internal/cleanup` endpoint added as secondary trigger for 90-day data retention. Primary trigger remains Railway cron service (`0 2 * * *`).
- **Structured logger** — `app/services/logger.server.ts` added. Consistent `[LEVEL] [timestamp] [context] message` format across server logs.
- **CLEANUP_SECRET** — env var added to both production and staging Railway environments.
- **CONTRIBUTING.md** — documents branch protection rules and three-surface deployment model (backend / DB migrations / pixel extension).

### Bug Fixes
- **CORS headers on public events endpoint** — pixel sandbox (`extensions.shopifycdn.com`) requires CORS. Added `Access-Control-Allow-Origin: *` and OPTIONS preflight handling to `api.public.events.tsx`. Fixes device/location/UTM data never populating on production.
- **Webhook dedup** — `webhooks.carts.tsx` now deduplicates on `x-shopify-webhook-id` with 10-minute TTL. Prevents duplicate `cart_add`/`cart_remove` events from Shopify retries.
- **UTM backfill on existing sessions** — upsert update path in `api.public.events.tsx` now includes UTM fields. Previously, returning visitors with UTMs in the URL had null UTM data because the update path skipped those fields.

### UTM Attribution (New Feature)
- **Schema** — added `utmContent String?`, `utmId String?`, `deviceModel String?` to `CartSession` via Prisma migrations.
- **Pixel UTM capture** — replaced `browser.sessionStorage` (unavailable in strict pixel sandbox) with in-memory `utmStore` closure variable. UTMs captured from `event.context.window.location.href` on both `page_viewed` and `product_added_to_cart` events.
- **API** — `api.public.events.tsx` now accepts and stores `utmContent`, `utmId`, `deviceModel`.
- **IP Geolocation** — falls back to `iplocate.io` API (free, 1k/day) when Cloudflare headers unavailable (Railway uses Fastly, not Cloudflare). 1.5s timeout, non-fatal.

### Dashboard UI — Live Carts Tab
- **Time filter** — 24h / 7d / 30d toggle on Live Carts list view. Defaults to 24h. Session count badge updates with filter.
- **Card visual distinction** — converted sessions get green left border + light green tint. Checkout-started sessions get amber left border.
- **Traffic source badges** — color-coded channel badges on each card (Facebook Ads blue, Instagram Ads pink, Google Ads green, Email purple, SMS teal, TikTok black, Direct gray, etc.).
- **Geo location on cards** — city + country shown inline with created date: `Created Apr 5, 2:30 PM · Los Angeles, US`.
- **"View details →"** affordance on cards so merchants know they're clickable.
- **Detail view — Traffic section** — unified section showing channel badge + campaign name + full landing URL in monospace selectable block.
- **Detail view — deviceModel** — Device row now shows model when available (e.g. "iPhone · Safari").

### Dashboard UI — Reports Tab
- **Removed**: Top Referrers table (redundant with Channel Performance).
- **Removed**: Funnel section (redundant with summary cards + Channel Performance).
- **Added**: Channel Performance table — carts / checkouts / orders / conv. rate by traffic source. Sortable.
- **Added**: Top Campaigns table — by `utm_campaign`, shows cart adds / orders / revenue / conv. rate. Sortable.
- **Added**: Top Abandoned Products table — products added to cart in non-converting sessions. Sortable.
- **Added**: Top Locations table — sessions / cart adds / orders / conv. rate by city + country. Sortable.
- **Changed**: "Avg Cart Value" card → "Revenue" card (sum of `orderValue` for converted sessions).
- **Added**: Empty state when no data in selected date range.
- **Added**: Export CSV button in Reports header, respects the selected date range (7d/30d/90d).
- **Added**: Variant breakdown in Top Products — `+`/`−` expand per product row. Only shows for products with real variant titles (not Shopify default variants).
- **Fixed**: Sort indicator uses `opacity: 0` when inactive to prevent column width shift on click.
- **Fixed**: Variant sub-rows now populate checkouts and orders (not just cart adds).

### Channel Detection
- Comprehensive traffic source mapping: Facebook Ads (`fb`), Instagram Ads (`ig`), Meta Ads (`an`/`messenger`/`meta`), TikTok Ads, Google Ads, Organic Search, Email (Klaviyo/Mailchimp/etc.), SMS (Attentive/Postscript), Pinterest, Snapchat, YouTube, Affiliate, Paid (generic).
- fbclid/gclid detection for click-ID based attribution.

### Post-Merge Actions Required
1. Merge `dev` → `main` on GitHub (Railway auto-deploys backend + runs DB migrations)
2. Verify Railway production deployment is green
3. Run `npx shopify app deploy --force` to push updated pixel extension to Shopify CDN
4. Smoke test: install on a real store, add to cart with UTM URL, verify session appears with geo + UTM data
