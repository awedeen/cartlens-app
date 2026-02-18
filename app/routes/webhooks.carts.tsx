// Webhook handler for cart events (carts/create, carts/update)

import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { authenticate, unauthenticated } from "../shopify.server";
import prisma from "../db.server";
import sseManager from "../services/sse.server";

// Cache product images to avoid repeated API calls
const imageCache = new Map<string, string | null>();

async function getProductImage(shop: string, productId: string): Promise<string | null> {
  const cacheKey = `${shop}:${productId}`;
  if (imageCache.has(cacheKey)) return imageCache.get(cacheKey)!;

  try {
    console.log(`[Webhook] Fetching image for product ${productId} from ${shop}`);
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
    console.log(`[Webhook] Image query result:`, JSON.stringify(result?.data?.product));
    const imageUrl = result?.data?.product?.featuredImage?.url || null;
    imageCache.set(cacheKey, imageUrl);
    console.log(`[Webhook] Image for product ${productId}: ${imageUrl || "none"}`);
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

    console.log(`[Webhook] Received ${topic} from ${shop}`);
    console.log(`[Webhook] Customer fields:`, JSON.stringify({
      customer_id: payload.customer_id,
      customer: payload.customer,
      email: payload.email,
      buyer_identity: payload.buyer_identity,
      note: payload.note,
    }));

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
      cartTotal += parseFloat(item.price) * item.quantity;
      itemCount += item.quantity;
    }

    // Always find by cart token first (most reliable cart identifier)
    let session = await prisma.cartSession.findFirst({
      where: {
        shopId: shopRecord.id,
        visitorId: cartToken,
      },
      include: {
        events: true,
      },
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

      // Create initial cart_add events
      for (const item of lineItems) {
        console.log(`[Webhook] Line item keys:`, Object.keys(item));
        console.log(`[Webhook] Line item image fields:`, { image: item.image, featured_image: item.featured_image, images: item.images });
        // Try webhook payload image first, fall back to API
        const webhookImage = item.featured_image?.url || item.image || null;
        const variantImage = webhookImage || await getProductImage(shop, item.product_id?.toString());
        await prisma.cartEvent.create({
          data: {
            sessionId: session.id,
            eventType: "cart_add",
            productId: item.product_id?.toString(),
            productTitle: item.title,
            variantId: item.variant_id?.toString(),
            variantTitle: item.variant_title,
            quantity: item.quantity,
            variantImage,
            price: parseFloat(item.price),
          },
        });
      }
    } else if (session) {
      // CARTS_UPDATE — diff line items to detect adds and removes
      const existingItems = new Map<string, { quantity: number; title: string; price: number }>();
      
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

      // Detect additions (new items or increased quantity)
      for (const [key, { quantity, item }] of newState) {
        const oldQty = currentState.get(key) || 0;
        if (quantity > oldQty) {
          const webhookImage = item.featured_image?.url || item.image || null;
          const variantImage = webhookImage || await getProductImage(shop, item.product_id?.toString());
          await prisma.cartEvent.create({
            data: {
              sessionId: session.id,
              eventType: "cart_add",
              productId: item.product_id?.toString(),
              productTitle: item.title,
              variantId: item.variant_id?.toString(),
              variantTitle: item.variant_title,
              quantity: quantity - oldQty,
              variantImage,
              price: parseFloat(item.price),
            },
          });
        }
      }

      // Detect removals (items gone or decreased quantity)
      for (const [key, oldQty] of currentState) {
        const newEntry = newState.get(key);
        const newQty = newEntry?.quantity || 0;
        if (oldQty > 0 && newQty < oldQty) {
          // Find the product info from the last add event for this variant
          const lastAdd = lastEvents.find(
            (e) => (e.variantId === key || e.productId === key) && e.eventType === "cart_add"
          );
          await prisma.cartEvent.create({
            data: {
              sessionId: session.id,
              eventType: "cart_remove",
              productId: lastAdd?.productId || key,
              productTitle: lastAdd?.productTitle || "Unknown Product",
              variantId: lastAdd?.variantId || key,
              variantTitle: lastAdd?.variantTitle,
              quantity: oldQty - newQty,
              price: lastAdd?.price || 0,
            },
          });
        }
      }

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

      for (const item of lineItems) {
        await prisma.cartEvent.create({
          data: {
            sessionId: session.id,
            eventType: "cart_add",
            productId: item.product_id?.toString(),
            productTitle: item.title,
            variantId: item.variant_id?.toString(),
            variantTitle: item.variant_title,
            quantity: item.quantity,
            variantImage: item.featured_image?.url || item.image || await getProductImage(shop, item.product_id?.toString()),
            price: parseFloat(item.price),
          },
        });
      }
    }

    // If no session was created/found (e.g. empty cart with no prior session), bail
    if (!session) {
      console.log(`[Webhook] No session to update (empty cart, no prior session)`);
      return data({ success: true }, { status: 200 });
    }

    // Broadcast update via SSE
    const sessionWithEvents = await prisma.cartSession.findUnique({
      where: { id: session.id },
      include: {
        events: {
          orderBy: { timestamp: "desc" },
          take: 20,
        },
      },
    });

    console.log(`[Webhook] Processed ${topic} for cart ${cartToken} — ${itemCount} items, $${cartTotal.toFixed(2)}`);
    console.log(`[Webhook] Using SSE manager instance: ${sseManager.instanceId}`);
    console.log(`[Webhook] Broadcasting cart-update for shop ${shopRecord.id} (${shopRecord.shopifyDomain})`);
    console.log(`[Webhook] Current client count: ${sseManager.getClientCount(shopRecord.id)} for this shop, ${sseManager.getClientCount()} total`);

    sseManager.broadcast(shopRecord.id, "cart-update", {
      session: sessionWithEvents,
    });

    console.log(`[Webhook] Broadcast complete`);

    return data({ success: true });
  } catch (error) {
    console.error("[Webhook Carts] Error:", error);
    return data({ error: "Internal server error" }, { status: 500 });
  }
};
