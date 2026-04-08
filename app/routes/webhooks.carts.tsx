// Webhook handler for cart events (carts/create, carts/update)

import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { authenticate, unauthenticated } from "../shopify.server";
import prisma from "../db.server";
import sseManager from "../services/sse.server";

// Cache product images to avoid repeated API calls — capped at 500 entries (LRU-lite: evict oldest on overflow)
const IMAGE_CACHE_MAX = 500;
const imageCache = new Map<string, string | null>();

async function getProductImage(shop: string, productId: string): Promise<string | null> {
  const cacheKey = `${shop}:${productId}`;
  if (imageCache.has(cacheKey)) return imageCache.get(cacheKey)!;
  if (imageCache.size >= IMAGE_CACHE_MAX) {
    // Delete the oldest entry (Map preserves insertion order)
    imageCache.delete(imageCache.keys().next().value!);
  }

  try {
    const { admin } = await unauthenticated.admin(shop);
    const response = await admin.graphql(`
      query getProductImage($id: ID!) {
        product(id: $id) {
          featuredImage {
            url(transform: { maxWidth: 100, maxHeight: 100 })
          }
        }
      }
    `, { variables: { id: `gid://shopify/Product/${productId}` } });
    const result = await response.json();
    const imageUrl = result?.data?.product?.featuredImage?.url || null;
    imageCache.set(cacheKey, imageUrl);
    return imageUrl;
  } catch (e: any) {
    console.error(`[Webhook] Failed to fetch image for product ${productId}:`, e?.message || e);
    imageCache.set(cacheKey, null);
    return null;
  }
}

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const { topic, shop, payload } = await authenticate.webhook(request);

    if (topic !== "CARTS_CREATE" && topic !== "CARTS_UPDATE") {
      return data({ error: "Invalid topic" }, { status: 400 });
    }

    const shopRecord = await prisma.shop.findUnique({
      where: { shopifyDomain: shop },
    });

    if (!shopRecord) {
      console.warn(`[Webhook] Shop not found: ${shop}`);
      return data({ error: "Shop not found" }, { status: 404 });
    }

    const cartToken = payload.token || payload.id;
    const customerId = payload.customer_id;
    const lineItems = payload.line_items || [];

    // Calculate cart total and item count
    let cartTotal = 0;
    let itemCount = 0;
    for (const item of lineItems) {
      cartTotal += (item.price ? parseFloat(item.price) : 0) * (item.quantity || 0);
      itemCount += item.quantity || 0;
    }

    // Always find by cart token first (most reliable cart identifier)
    // Use findUnique with the named compound key — consistent with the upserts below
    let session = await prisma.cartSession.findUnique({
      where: { shopId_visitorId: { shopId: shopRecord.id, visitorId: cartToken } },
      include: { events: true },
    });

    if (topic === "CARTS_CREATE" && !session && lineItems.length > 0) {
      session = await prisma.cartSession.upsert({
        where: { shopId_visitorId: { shopId: shopRecord.id, visitorId: cartToken } },
        update: { cartTotal, itemCount, customerId: customerId?.toString() },
        create: {
          shopId: shopRecord.id,
          visitorId: cartToken,
          customerId: customerId?.toString(),
          cartCreated: true,
          cartTotal,
          itemCount,
        },
        include: { events: true },
      });

      // Create initial cart_add events — pre-fetch images in parallel
      const createImages = await Promise.all(
        lineItems.map(async (item: any) => {
          const webhookImage = item.featured_image?.url || item.image || null;
          return webhookImage || await getProductImage(shop, item.product_id?.toString());
        })
      );
      await Promise.all(
        lineItems.map((item: any, idx: number) =>
          prisma.cartEvent.create({
            data: {
              sessionId: session!.id,
              eventType: "cart_add",
              productId: item.product_id?.toString(),
              productTitle: item.title,
              variantId: item.variant_id?.toString(),
              variantTitle: item.variant_title,
              quantity: item.quantity,
              variantImage: createImages[idx],
              price: item.price ? parseFloat(item.price) : null,
            },
          })
        )
      );
    } else if (session) {
      // CARTS_UPDATE — diff line items to detect adds and removes

      // Build map of what we had from last snapshot
      // Use the most recent events to reconstruct current cart state
      const lastEvents = session.events || [];
      const currentState = new Map<string, number>(); // variantId -> quantity
      
      for (const event of lastEvents) {
        const key = event.variantId || event.productId || "unknown";
        if (event.eventType === "cart_add") {
          currentState.set(key, (currentState.get(key) || 0) + (event.quantity || 0));
        } else if (event.eventType === "cart_remove") {
          currentState.set(key, (currentState.get(key) || 0) - (event.quantity || 0));
        }
      }

      // Build new state from webhook payload
      const newState = new Map<string, { quantity: number; item: any }>();
      for (const item of lineItems) {
        const key = item.variant_id?.toString() || item.product_id?.toString() || "unknown";
        newState.set(key, { quantity: item.quantity, item });
      }

      // Detect additions (new items or increased quantity) — pre-fetch images in parallel
      const additions = Array.from(newState.entries())
        .map(([key, { quantity, item }]) => ({ key, quantity, item, oldQty: currentState.get(key) || 0 }))
        .filter(({ quantity, oldQty }) => quantity > oldQty);

      const additionImages = await Promise.all(
        additions.map(({ item }) => {
          const webhookImage = item.featured_image?.url || item.image || null;
          return webhookImage ? Promise.resolve(webhookImage) : getProductImage(shop, item.product_id?.toString());
        })
      );
      await Promise.all(
        additions.map(({ quantity, item, oldQty }, idx) =>
          prisma.cartEvent.create({
            data: {
              sessionId: session!.id,
              eventType: "cart_add",
              productId: item.product_id?.toString(),
              productTitle: item.title,
              variantId: item.variant_id?.toString(),
              variantTitle: item.variant_title,
              quantity: quantity - oldQty,
              variantImage: additionImages[idx],
              price: item.price ? parseFloat(item.price) : null,
            },
          })
        )
      );

      // Detect removals (items gone or decreased quantity) — parallel writes
      const removals = Array.from(currentState.entries())
        .filter(([key, oldQty]) => {
          const newQty = newState.get(key)?.quantity || 0;
          return oldQty > 0 && newQty < oldQty;
        })
        .map(([key, oldQty]) => {
          const newQty = newState.get(key)?.quantity || 0;
          const lastAdd = lastEvents.find(
            (e) => (e.variantId === key || e.productId === key) && e.eventType === "cart_add"
          );
          return { key, removedQty: oldQty - newQty, lastAdd };
        });

      await Promise.all(
        removals.map(({ key, removedQty, lastAdd }) =>
          prisma.cartEvent.create({
            data: {
              sessionId: session!.id,
              eventType: "cart_remove",
              productId: lastAdd?.productId || key,
              productTitle: lastAdd?.productTitle || "Unknown Product",
              variantId: lastAdd?.variantId || key,
              variantTitle: lastAdd?.variantTitle,
              quantity: removedQty,
              price: lastAdd?.price || 0,
            },
          })
        )
      );

      // Update session totals
      session = await prisma.cartSession.update({
        where: { id: session.id },
        data: {
          cartTotal,
          itemCount,
          customerId: customerId?.toString() || session.customerId,
          updatedAt: new Date(),
        },
        include: { events: true },
      });
    } else if (lineItems.length > 0) {
      // CARTS_UPDATE but no existing session — create one (only if has items)
      session = await prisma.cartSession.upsert({
        where: { shopId_visitorId: { shopId: shopRecord.id, visitorId: cartToken } },
        update: { cartTotal, itemCount, customerId: customerId?.toString() },
        create: {
          shopId: shopRecord.id,
          visitorId: cartToken,
          customerId: customerId?.toString(),
          cartCreated: true,
          cartTotal,
          itemCount,
        },
        include: { events: true },
      });

      // Pre-fetch images in parallel for new session items
      const newSessionImages = await Promise.all(
        lineItems.map((item: any) => {
          const webhookImage = item.featured_image?.url || item.image || null;
          return webhookImage ? Promise.resolve(webhookImage) : getProductImage(shop, item.product_id?.toString());
        })
      );
      await Promise.all(
        lineItems.map((item: any, idx: number) =>
          prisma.cartEvent.create({
            data: {
              sessionId: session!.id,
              eventType: "cart_add",
              productId: item.product_id?.toString(),
              productTitle: item.title,
              variantId: item.variant_id?.toString(),
              variantTitle: item.variant_title,
              quantity: item.quantity,
              variantImage: newSessionImages[idx],
              price: item.price ? parseFloat(item.price) : null,
            },
          })
        )
      );
    }

    // If no session was created/found (e.g. empty cart with no prior session), bail
    if (!session) {
      return data({ success: true }, { status: 200 });
    }

    // Broadcast update via SSE
    const sessionWithEvents = await prisma.cartSession.findUnique({
      where: { id: session.id },
      include: {
        events: { orderBy: { timestamp: "desc" } },
      },
    });

    sseManager.broadcast(shopRecord.id, "cart-update", {
      session: sessionWithEvents,
    });

    return data({ success: true });
  } catch (error) {
    console.error("[Webhook Carts] Error:", error);
    return data({ error: "Internal server error" }, { status: 500 });
  }
};
