# CartLens - Quick Start Guide

## 🚀 Installation & Setup

### 1. Install Dependencies
```bash
cd /Users/knoxai/.openclaw/workspace/projects/shopify-apps/cartlens-app/

# Install root dependencies
npm install

# Install pixel extension dependencies (handled by workspaces)
# npm install will also install workspace dependencies automatically
```

### 2. Set Up Database
```bash
# Generate Prisma client
npx prisma generate

# Create/update database tables
npx prisma db push
```

### 3. Configure Environment Variables
Create or update `.env` file:
```env
SHOPIFY_API_KEY=your_api_key_here
SHOPIFY_API_SECRET=your_api_secret_here
SCOPES=read_products,read_orders,read_customers,write_pixels,read_customer_events
SHOPIFY_APP_URL=https://your-tunnel-url.com
```

### 4. Start Development Server
```bash
npm run dev
```

This will:
- Start the Shopify CLI
- Create a Cloudflare tunnel
- Deploy the Web Pixel extension
- Open your browser to install the app

---

## 📋 Post-Installation Checklist

### ✅ Verify Web Pixel Registration
1. Go to Shopify Admin → Settings → Customer Events
2. Look for "CartLens Pixel" in the list
3. Status should be "Active"

### ✅ Register Webhooks
You can register webhooks via Shopify Admin API or manually:

**Option A: Via Shopify Admin (Recommended)**
1. Go to Settings → Notifications → Webhooks
2. Create webhook for `Cart creation`:
   - Format: JSON
   - URL: `https://your-app-url.com/webhooks/carts`
3. Create webhook for `Cart update`:
   - Format: JSON  
   - URL: `https://your-app-url.com/webhooks/carts`
4. Create webhook for `Order creation`:
   - Format: JSON
   - URL: `https://your-app-url.com/webhooks/orders`

**Option B: Via API (Advanced)**
```bash
# Get access token from your app installation
ACCESS_TOKEN="your_access_token"
SHOP="your-shop.myshopify.com"

# Register carts/create
curl -X POST "https://$SHOP/admin/api/2024-01/webhooks.json" \
  -H "X-Shopify-Access-Token: $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "webhook": {
      "topic": "carts/create",
      "address": "https://your-app-url.com/webhooks/carts",
      "format": "json"
    }
  }'

# Register carts/update
curl -X POST "https://$SHOP/admin/api/2024-01/webhooks.json" \
  -H "X-Shopify-Access-Token: $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "webhook": {
      "topic": "carts/update",
      "address": "https://your-app-url.com/webhooks/carts",
      "format": "json"
    }
  }'

# Register orders/create
curl -X POST "https://$SHOP/admin/api/2024-01/webhooks.json" \
  -H "X-Shopify-Access-Token: $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "webhook": {
      "topic": "orders/create",
      "address": "https://your-app-url.com/webhooks/orders",
      "format": "json"
    }
  }'
```

---

## 🧪 Testing

### Test 1: Add Product to Cart
1. Open your dev store storefront
2. Add a product to cart
3. Open CartLens app in Shopify Admin
4. Go to "Live Carts" tab
5. **Expected**: New cart session appears immediately (real-time via SSE)

### Test 2: Session Detail View
1. Click on any cart session in the list
2. **Expected**: See full timeline with timestamps and events

### Test 3: Checkout Flow
1. On storefront, proceed to checkout
2. **Expected**: Funnel badge changes from 🛒 to 💳

### Test 4: Order Completion
1. Complete the order
2. **Expected**: Funnel badge changes to ✅, session marked as converted

### Test 5: Reports Tab
1. Go to "Reports" tab
2. **Expected**: See top products with cart adds and conversion rates

### Test 6: Real-Time Updates
1. Open CartLens in two browser tabs
2. Add product to cart on storefront
3. **Expected**: Both tabs update simultaneously

### Test 7: CSV Export
1. Go to "Settings" tab
2. Click "Download CSV"
3. **Expected**: CSV file downloads with all session data

---

## 🛠 Development Tools

### Prisma Studio (Database Browser)
```bash
npx prisma studio
```
Opens visual database browser at http://localhost:5555

### View Database File Directly
```bash
sqlite3 dev.sqlite
.tables
SELECT * FROM CartSession;
SELECT * FROM CartEvent;
.quit
```

### Check SSE Connection
Open browser console on CartLens page:
```javascript
// Should see:
[SSE] Connected: {clientId: "...", timestamp: ...}
```

### Manual Event Testing
```bash
# Test event endpoint
curl -X POST http://localhost:3000/app/api/events \
  -H "Content-Type: application/json" \
  -d '{
    "eventType": "cart_add",
    "visitorId": "test-visitor-123",
    "product": {
      "id": "gid://shopify/Product/1",
      "title": "Test Product"
    },
    "variant": {
      "id": "gid://shopify/ProductVariant/1",
      "title": "Default",
      "image": "https://cdn.shopify.com/..."
    },
    "quantity": 1,
    "price": 29.99
  }'
```

---

## 📁 Project Structure

```
cartlens-app/
├── app/
│   ├── routes/
│   │   ├── app.tsx                    # App layout (nav links)
│   │   ├── app._index.tsx             # Main page (4 tabs)
│   │   ├── app.api.events.tsx         # Event receiver
│   │   ├── app.api.sse.tsx            # SSE endpoint
│   │   ├── app.api.export.tsx         # CSV export
│   │   ├── webhooks.carts.tsx         # Cart webhooks
│   │   └── webhooks.orders.tsx        # Order webhooks
│   ├── services/
│   │   ├── geo.server.ts              # IP geolocation
│   │   ├── bot.server.ts              # Bot detection
│   │   ├── sse.server.ts              # SSE manager
│   │   └── csv.server.ts              # CSV generator
│   ├── db.server.ts                   # Prisma client
│   └── shopify.server.ts              # Shopify auth
├── extensions/
│   └── cartlens-pixel/
│       ├── src/index.ts               # Pixel event subscriptions
│       ├── shopify.extension.toml     # Extension config
│       ├── package.json
│       └── tsconfig.json
├── prisma/
│   └── schema.prisma                  # Database schema
├── BUILD-COMPLETE.md                  # Detailed build docs
├── QUICKSTART.md                      # This file
└── package.json
```

---

## 🐛 Common Issues

### Issue: "Shop not found" in events endpoint
**Fix**: The Shop record is auto-created on first app load. Open the CartLens app in Shopify Admin once before sending events.

### Issue: SSE connection fails
**Fix**: Make sure you're authenticated. The SSE endpoint requires `authenticate.admin(request)` to pass.

### Issue: Events not appearing in Live Carts
**Fix**: 
1. Check browser console for errors
2. Verify Web Pixel is active
3. Check server logs for incoming POST requests to `/app/api/events`
4. Make sure bot filter isn't blocking events (check `isSuspectedBot` in database)

### Issue: Webhooks returning 404
**Fix**: Verify webhook URLs match your app URL exactly. Shopify sends webhooks to the URL you registered.

### Issue: Real-time updates not working
**Fix**: 
1. Check EventSource connection in browser Network tab
2. Look for `cart-update` events in SSE stream
3. Verify `sseManager.broadcast()` is being called in `app.api.events.tsx`

---

## 📊 Database Schema Quick Reference

### CartSession
- `visitorId` — Anonymous fingerprint or customer ID
- `customerId` — Shopify customer ID (if logged in)
- `cartTotal`, `itemCount` — Cart summary
- `cartCreated`, `checkoutStarted`, `orderPlaced` — Funnel status
- `city`, `country` — Geolocation data
- `deviceType`, `browser`, `os` — Device info
- `isSuspectedBot` — Bot detection flag

### CartEvent
- `sessionId` — Links to CartSession
- `eventType` — `cart_add`, `cart_remove`, `page_view`, `checkout_started`, `checkout_completed`
- `productId`, `productTitle`, `variantTitle` — Product data
- `timestamp` — When event occurred

### Shop
- `shopifyDomain` — Store domain
- `timezone`, `retentionDays` — Settings
- `cartlinkEnabled`, `botFilterEnabled` — Feature flags

---

## 🎯 Next Steps

1. ✅ **Install dependencies** → `npm install`
2. ✅ **Set up database** → `npx prisma generate && npx prisma db push`
3. ✅ **Configure .env** → Add Shopify API credentials
4. ✅ **Start dev server** → `npm run dev`
5. ✅ **Install app** → Follow CLI prompts
6. ✅ **Register webhooks** → Via Shopify Admin or API
7. ✅ **Test on storefront** → Add to cart, check Live Carts tab
8. 🚀 **Deploy to production** → See BUILD-COMPLETE.md Phase 4

---

## 📚 Resources

- [Shopify App Development Docs](https://shopify.dev/docs/apps)
- [Polaris Web Components](https://shopify.dev/docs/api/app-home/using-polaris-components)
- [Web Pixels API](https://shopify.dev/docs/api/web-pixels-api)
- [Prisma Documentation](https://www.prisma.io/docs)
- [React Router v7](https://reactrouter.com)

---

**Built with ❤️ for Horizon Motorsport**
