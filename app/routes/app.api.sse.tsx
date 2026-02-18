// Server-Sent Events endpoint for real-time cart updates
// Uses shopId from query param — only accessible within the authenticated app iframe

import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import sseManager from "../services/sse.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    const url = new URL(request.url);
    const shopId = url.searchParams.get("shopId");

    console.log(`[SSE Endpoint] Request received for shopId: ${shopId}`);
    console.log(`[SSE Endpoint] Using SSE manager instance: ${sseManager.instanceId}`);

    if (!shopId) {
      console.error("[SSE Endpoint] Missing shopId parameter");
      return new Response("Missing shopId", { status: 400 });
    }

    // Verify the shop exists
    const shop = await prisma.shop.findUnique({
      where: { id: shopId },
    });

    if (!shop) {
      console.error(`[SSE Endpoint] Shop not found: ${shopId}`);
      return new Response("Shop not found", { status: 404 });
    }

    console.log(`[SSE Endpoint] Shop found: ${shop.shopifyDomain} (id: ${shop.id})`);

    const stream = new ReadableStream({
      start(controller) {
        const clientId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        console.log(`[SSE Endpoint] Creating client ${clientId} for shop ${shop.shopifyDomain}`);

        sseManager.addClient({
          id: clientId,
          shopId: shop.id,
          controller,
        });

        // Send initial connection message
        const message = `event: connected\ndata: ${JSON.stringify({ clientId, timestamp: Date.now(), instanceId: sseManager.instanceId })}\n\n`;
        controller.enqueue(new TextEncoder().encode(message));

        console.log(`[SSE Endpoint] Client ${clientId} connected for shop ${shop.shopifyDomain}, sent connection event`);

        // Keep-alive ping every 30 seconds
        const keepAliveInterval = setInterval(() => {
          try {
            controller.enqueue(new TextEncoder().encode(": ping\n\n"));
          } catch {
            clearInterval(keepAliveInterval);
            sseManager.removeClient(clientId);
          }
        }, 30000);

        // Cleanup on close
        request.signal.addEventListener("abort", () => {
          clearInterval(keepAliveInterval);
          sseManager.removeClient(clientId);
          console.log(`[SSE Endpoint] Client ${clientId} disconnected`);
          try {
            controller.close();
          } catch {
            // Already closed
          }
        });
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    console.error("[SSE Endpoint] Error:", error);
    return new Response("Internal server error", { status: 500 });
  }
};
