// Test endpoint for manually triggering SSE broadcasts
// Useful for debugging the SSE system without needing to trigger webhooks
// 
// Usage: /app/api/test-broadcast?shopId=<shop-id>&message=<optional-message>
//
// This endpoint allows you to verify:
// 1. The SSE manager singleton is accessible
// 2. Broadcasts reach connected clients
// 3. The instance ID is consistent
//
// SECURITY NOTE: This endpoint requires Shopify admin authentication,
// so it's safe to deploy. Only authenticated merchants can trigger test broadcasts.

import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import sseManager from "../services/sse.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    // Require authentication (only accessible from within the Shopify admin)
    const { session } = await authenticate.admin(request);
    
    if (!session?.shop) {
      return data({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(request.url);
    const shopId = url.searchParams.get("shopId");
    const message = url.searchParams.get("message") || "Test broadcast from API";
    const eventType = url.searchParams.get("event") || "test-event";

    if (!shopId) {
      return data({ 
        error: "Missing shopId parameter",
        usage: "/app/api/test-broadcast?shopId=<id>&message=<optional>&event=<optional>",
      }, { status: 400 });
    }

    // Verify the shop exists and belongs to the authenticated merchant
    const shop = await prisma.shop.findUnique({
      where: { id: shopId },
    });

    if (!shop) {
      return data({ error: "Shop not found" }, { status: 404 });
    }

    if (shop.shopifyDomain !== session.shop) {
      return data({ error: "Shop does not match authenticated session" }, { status: 403 });
    }

    // Get current client count before broadcast
    const clientCountBefore = sseManager.getClientCount(shopId);
    
    console.log(`[Test Broadcast] Triggering broadcast for shop ${shop.shopifyDomain} (${shopId})`);
    console.log(`[Test Broadcast] SSE manager instance: ${sseManager.instanceId}`);
    console.log(`[Test Broadcast] Clients connected: ${clientCountBefore}`);

    // Trigger the broadcast
    sseManager.broadcast(shopId, eventType, {
      message,
      timestamp: Date.now(),
      source: "test-broadcast-endpoint",
      instanceId: sseManager.instanceId,
    });

    console.log(`[Test Broadcast] Broadcast sent`);

    // Return success with diagnostic info
    return data({
      success: true,
      diagnostics: {
        instanceId: sseManager.instanceId,
        shopId: shopId,
        shopDomain: shop.shopifyDomain,
        clientsConnected: clientCountBefore,
        totalClients: sseManager.getClientCount(),
        eventType: eventType,
        message: message,
        timestamp: new Date().toISOString(),
      },
      instructions: [
        "Open the browser console on your CartLens dashboard",
        "You should see: [SSE Client] Received " + eventType,
        "If you don't see the event, check:",
        "  1. Dashboard is open in another tab",
        "  2. SSE connection is established (look for 'Connected successfully')",
        "  3. Server logs show the same instance ID as this response",
      ],
    });
  } catch (error) {
    console.error("[Test Broadcast] Error:", error);
    return data({ 
      error: "Internal server error",
      details: error instanceof Error ? error.message : String(error),
    }, { status: 500 });
  }
};
