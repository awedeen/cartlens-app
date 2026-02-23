// Server-Sent Events endpoint for real-time cart updates
// Uses shopId from query param — shopId is a UUID only exposed to authenticated merchants via the app loader.
// We skip authenticate.admin here because EventSource (native browser API) cannot pass session tokens.
// Instead, we verify the shop exists and has an active Shopify session.

import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import sseManager from "../services/sse.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    const url = new URL(request.url);
    const shopId = url.searchParams.get("shopId");

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

    // Verify the shop has an active Shopify session (still installed, not churned)
    const activeSession = await prisma.session.findFirst({
      where: { shop: shop.shopifyDomain },
    });
    if (!activeSession) {
      return new Response("Unauthorized", { status: 403 });
    }

    // Check per-shop connection cap before building the stream — return a proper 503
    // so the browser gets a real error response instead of a silent empty stream.
    if (sseManager.getClientCount(shop.id) >= 10) {
      return new Response("Too many connections", { status: 503 });
    }

    const stream = new ReadableStream({
      start(controller) {
        const clientId = `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;

        sseManager.addClient({
          id: clientId,
          shopId: shop.id,
          controller,
        });

        // Send initial connection message
        const message = `event: connected\ndata: ${JSON.stringify({ clientId, timestamp: Date.now(), instanceId: sseManager.instanceId })}\n\n`;
        controller.enqueue(new TextEncoder().encode(message));

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
