# SSE System Debug Guide

## What Was Fixed

### Primary Issue: Singleton Not Shared Across Module Contexts
**Problem:** The SSE manager singleton was using `(global as any).sseManager`, which may not be reliably shared across different module contexts in Vite dev mode. When webhooks arrived, they would broadcast to a different SSE manager instance than the one serving connected clients.

**Fix:** Changed to use `globalThis.__sseManager` with proper TypeScript declaration, ensuring the same instance is used across all module contexts.

### Secondary Improvements
1. **Added instance ID tracking** - Each SSE manager now has a unique ID for debugging
2. **Enhanced logging** - All critical operations now log the instance ID and client counts
3. **Frontend connection monitoring** - Better logging of EventSource lifecycle
4. **Dependency array fix** - useEffect now properly depends on `data.shopId`

---

## How to Verify the Fix

### Step 1: Start the Development Server
```bash
cd /Users/knoxai/.openclaw/workspace/projects/shopify-apps/cartlens-app
npm run dev
```

### Step 2: Check Server Startup Logs
You should see logs like:
```
[SSE Manager] Created new instance: sse-1708123456789-abc123def
[SSE] Initialized global singleton: sse-1708123456789-abc123def
[SSE] Module loaded, using instance: sse-1708123456789-abc123def
```

**IMPORTANT:** All modules should show the **same instance ID**. If you see different IDs, the singleton is not being shared.

### Step 3: Open the Dashboard
Navigate to the CartLens app in your Shopify admin. Open the browser console (F12).

You should see:
```
[SSE Client] Connecting to SSE endpoint for shopId: <shop-id>
[SSE Client] Connected successfully: {clientId: "...", timestamp: ..., instanceId: "sse-..."}
[SSE Client] Connection opened
```

**VERIFY:** The `instanceId` in the client should match the instance ID from Step 2.

### Step 4: Check Server Logs for Client Connection
After the dashboard loads, the server should log:
```
[SSE Endpoint] Request received for shopId: <shop-id>
[SSE Endpoint] Using SSE manager instance: sse-1708123456789-abc123def
[SSE Endpoint] Shop found: <shop-domain> (id: <shop-id>)
[SSE Endpoint] Creating client <client-id> for shop <shop-domain>
[SSE Manager sse-1708123456789-abc123def] Client connected: <client-id> for shop <shop-id> (total clients: 1)
[SSE Endpoint] Client <client-id> connected for shop <shop-domain>, sent connection event
```

### Step 5: Trigger a Cart Webhook
Create or update a cart on your Shopify store (add a product to cart).

**Expected Server Logs:**
```
[Webhook] Received CARTS_CREATE (or CARTS_UPDATE) from <shop-domain>
[Webhook] Processed CARTS_CREATE for cart <token> — X items, $XX.XX
[Webhook] Using SSE manager instance: sse-1708123456789-abc123def  ← MUST MATCH
[Webhook] Broadcasting cart-update for shop <shop-id> (<shop-domain>)
[Webhook] Current client count: 1 for this shop, 1 total
[SSE Manager sse-1708123456789-abc123def] Broadcasting "cart-update" to 1 clients for shop <shop-id> (total clients: 1)
[SSE Manager sse-1708123456789-abc123def] Sent "cart-update" to client <client-id>
[Webhook] Broadcast complete
```

**Expected Browser Console:**
```
[SSE Client] Received cart-update: {session: {...}}
[SSE Client] Adding new session: <session-id>  (or "Updating existing session")
```

---

## Troubleshooting

### Issue: Different Instance IDs
**Symptom:** Webhook logs show `sse-123` but SSE endpoint shows `sse-456`

**Cause:** The singleton is not being shared. This could happen if:
- Vite is creating separate module graphs
- HMR is causing module reloads

**Solution:**
1. Restart the dev server completely
2. Clear the `.react-router` cache: `rm -rf .react-router`
3. If still broken, consider using a Redis-backed SSE manager for development

### Issue: "No clients connected for shop"
**Symptom:** Webhook broadcasts but logs show `Broadcasting to 0 clients`

**Possible Causes:**
1. **Dashboard not open** - Open the CartLens dashboard in Shopify admin
2. **EventSource failed to connect** - Check browser console for errors
3. **Wrong shop ID** - Verify the webhook's shop ID matches the connected client's shop ID
4. **Client disconnected** - EventSource connections can timeout; refresh the dashboard

**Check:**
- Browser console for "[SSE Client] Connected successfully"
- Server logs for "Client connected: <id>"

### Issue: EventSource Error in Browser
**Symptom:** Browser console shows `[SSE Client] Connection error`

**Possible Causes:**
1. **SSE endpoint returning error** - Check server logs for "Shop not found" or "Missing shopId"
2. **Route not found** - Verify `/app/api/sse` endpoint exists
3. **CORS issue** - Check if the embedded app iframe is blocking the connection
4. **Vite buffering** - In rare cases, Vite dev server might buffer the stream

**Check:**
- Network tab in browser dev tools - look for `/app/api/sse` request
- Response headers should include `Content-Type: text/event-stream`
- Response should stay "pending" (streaming)

### Issue: Clients Connect but Don't Receive Updates
**Symptom:** Webhook broadcasts successfully, but browser doesn't update

**Possible Causes:**
1. **Different instance IDs** - See "Different Instance IDs" above
2. **Shop ID mismatch** - Webhook's `shopRecord.id` doesn't match client's `shopId`
3. **Frontend not listening** - Check browser console for "cart-update" event listeners
4. **Stream closed** - Connection might have died; check for "Client disconnected" logs

---

## Manual Test Commands

### Simulate a Broadcast (Server-Side)
You can create a test endpoint to manually trigger a broadcast:

Create `app/routes/app.api.test-broadcast.tsx`:
```typescript
import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import sseManager from "../services/sse.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const shopId = url.searchParams.get("shopId");
  
  if (!shopId) {
    return data({ error: "Missing shopId" }, { status: 400 });
  }
  
  sseManager.broadcast(shopId, "test-event", {
    message: "Test broadcast",
    timestamp: Date.now(),
  });
  
  return data({ 
    success: true, 
    instanceId: sseManager.instanceId,
    clientCount: sseManager.getClientCount(shopId),
  });
};
```

Then visit: `/app/api/test-broadcast?shopId=<your-shop-id>`

The browser should log:
```
[SSE Client] Received cart-update: {message: "Test broadcast", ...}
```

---

## Expected Behavior (Summary)

✅ **Working System:**
1. All modules use the same SSE manager instance ID
2. Dashboard connection shows in server logs
3. Webhook broadcasts trigger client updates
4. Browser console shows received events
5. Cart list updates without refresh

❌ **Broken System:**
1. Different instance IDs between webhook and SSE endpoint
2. "Broadcasting to 0 clients" despite dashboard being open
3. No "[SSE Client] Received cart-update" in browser console
4. Manual page refresh required to see new carts

---

## Production Considerations

The current fix uses `globalThis` to share the singleton, which works in development and simple production setups. For production at scale, consider:

1. **Redis-backed SSE manager** - Store client connections in Redis
2. **WebSocket alternative** - Use WebSockets instead of SSE for bidirectional communication
3. **Polling fallback** - Implement long-polling as a fallback for environments where SSE is unreliable
4. **Horizontal scaling** - If running multiple server instances, use a message broker (Redis Pub/Sub, RabbitMQ) to broadcast across instances

---

## Additional Logging

If you need even more debugging information, temporarily add this to `app/services/sse.server.ts`:

```typescript
// In the broadcast method, before the loop:
console.log(`[SSE Manager] All clients:`, Array.from(this.clients.entries()).map(([id, c]) => ({ id, shopId: c.shopId })));
```

This will show you exactly which clients are registered and their shop IDs.
