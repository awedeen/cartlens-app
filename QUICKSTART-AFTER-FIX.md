# Quick Start - Testing the SSE Fix

## What Was Wrong
Cart updates from webhooks weren't appearing in real-time. The SSE manager singleton wasn't being shared between the webhook handler and SSE endpoint.

## What's Fixed
Changed from `(global as any).sseManager` to `globalThis.__sseManager` with instance ID tracking and comprehensive logging.

## Test It Now

### 1. Start Dev Server
```bash
npm run dev
```

### 2. Look for This in Logs
```
[SSE Manager] Created new instance: sse-1708123456789-abc123def
[SSE] Initialized global singleton: sse-1708123456789-abc123def
```
**Write down the instance ID** (the `sse-...` part)

### 3. Open CartLens Dashboard
Open your Shopify admin → Apps → CartLens

### 4. Check Browser Console (F12)
Should see:
```
[SSE Client] Connected successfully: {...}
[SSE Client] Server instance ID: sse-1708123456789-abc123def
```
**Verify this matches** the instance ID from step 2. ✅

### 5. Add Item to Cart
Go to your Shopify store and add a product to cart.

### 6. Watch Both Consoles

**Server logs should show:**
```
[Webhook] Received CARTS_CREATE from <shop>
[Webhook] Using SSE manager instance: sse-1708123456789-abc123def  ← Same ID!
[Webhook] Broadcasting cart-update for shop <id>
[SSE Manager sse-...] Broadcasting "cart-update" to 1 clients
[SSE Manager sse-...] Sent "cart-update" to client <id>
```

**Browser console should show:**
```
[SSE Client] Received cart-update: {session: {...}}
[SSE Client] Adding new session: <id>
```

**Dashboard should update immediately** - new cart appears without refresh! ✅

---

## If It's NOT Working

### Check 1: Instance IDs Don't Match
**Problem:** Webhook shows `sse-123` but browser shows `sse-456`

**Fix:** 
```bash
# Stop server, clear cache, restart
rm -rf .react-router
npm run dev
```

### Check 2: No Clients Connected
**Problem:** Webhook logs show "Broadcasting to 0 clients"

**Fix:** Make sure dashboard is open and browser console shows "Connected successfully"

### Check 3: No Webhook Received
**Problem:** Adding to cart doesn't trigger any logs

**Fix:** 
- Check webhooks are installed: Shopify Admin → Settings → Notifications → Webhooks
- Should see `carts/create` and `carts/update` webhooks pointing to your app

---

## Manual Test (Without Real Cart)

Open this URL while dashboard is open:
```
https://your-app-url.ngrok.io/app/api/test-broadcast?shopId=<your-shop-id>&message=Hello
```

**Should see:**
- Server logs: "Broadcasting test-event to X clients"
- Browser console: "Received test-event"
- Response shows diagnostic info

---

## Success Criteria

✅ All modules show **same instance ID**  
✅ Dashboard connects and shows "Connected successfully"  
✅ Adding cart item triggers webhook  
✅ Webhook broadcasts to **same instance ID**  
✅ Browser receives "cart-update" event  
✅ Dashboard updates **without refresh**

---

## Need More Help?

See `SSE-DEBUG-GUIDE.md` for detailed troubleshooting.
