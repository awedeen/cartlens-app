// Webhook handler for checkout events (checkouts/create, checkouts/update)
// This is the reliable way to detect checkout — pixel checkout_started is unreliable on dev stores

import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import sseManager from "../services/sse.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload } = await authenticate.webhook(request);
  console.log(`[Checkout Webhook] ${topic} from ${shop}`);
  console.log(`[Checkout Webhook] Payload keys:`, Object.keys(payload));

  // Shopify checkout payload includes cart_token which links to our CartSession
  const cartToken = payload.cart_token;
  if (!cartToken) {
    console.log("[Checkout Webhook] No cart_token in payload, skipping");
    return data({ success: true }, { status: 200 });
  }

  console.log(`[Checkout Webhook] cart_token: ${cartToken}`);

  // Look up shop record first
  const shopRecord = await prisma.shop.findUnique({
    where: { shopifyDomain: shop },
  });

  if (!shopRecord) {
    console.log(`[Checkout Webhook] No Shop record for ${shop}`);
    return data({ success: true }, { status: 200 });
  }

  // Find the cart session by cart token (stored as visitorId) + shop
  const cartSession = await prisma.cartSession.findFirst({
    where: {
      shopId: shopRecord.id,
      visitorId: cartToken,
    },
    include: {
      events: {
        orderBy: { timestamp: "desc" },
        take: 10,
      },
    },
  });

  if (!cartSession) {
    console.log(`[Checkout Webhook] No CartSession found for cart_token ${cartToken}`);
    return data({ success: true }, { status: 200 });
  }

  console.log(`[Checkout Webhook] Found CartSession ${cartSession.id}, marking checkoutStarted`);

  // Update session — mark checkout started
  const updates: any = { checkoutStarted: true };

  // If customer info is available in checkout, capture it
  if (payload.customer?.id) {
    updates.customerId = String(payload.customer.id);
  }
  if (payload.email) {
    updates.customerEmail = payload.email;
  }
  if (payload.customer?.first_name || payload.customer?.last_name) {
    const name = [payload.customer.first_name, payload.customer.last_name].filter(Boolean).join(" ");
    if (name) updates.customerName = name;
  }

  // Discount codes
  const discountCodes = payload.discount_codes || [];
  console.log(`[Checkout Webhook] discount_codes:`, JSON.stringify(discountCodes));
  if (discountCodes.length > 0) {
    updates.discountCodes = JSON.stringify(discountCodes);
  }

  // Geo from billing address
  const billing = payload.billing_address || payload.shipping_address;
  if (billing) {
    if (billing.city) updates.city = billing.city;
    if (billing.country) updates.country = billing.country;
    if (billing.country_code) updates.countryCode = billing.country_code;
  }

  await prisma.cartSession.update({
    where: { id: cartSession.id },
    data: updates,
  });

  // Create checkout events — one for the session, plus one per line item
  const lineItems = payload.line_items || [];
  console.log(`[Checkout Webhook] ${lineItems.length} line items in checkout`);

  const existingCheckoutEvent = cartSession.events?.find((e: any) => e.eventType === "checkout_started");
  if (!existingCheckoutEvent) {
    await prisma.cartEvent.create({
      data: {
        sessionId: cartSession.id,
        eventType: "checkout_started",
        timestamp: new Date(),
      },
    });
  }

  // Record each product that reached checkout (only once per session)
  const existingCheckoutItems = cartSession.events?.filter((e: any) => e.eventType === "checkout_item") || [];
  if (existingCheckoutItems.length === 0) {
    for (const item of lineItems) {
      await prisma.cartEvent.create({
        data: {
          sessionId: cartSession.id,
          eventType: "checkout_item",
          productId: item.product_id?.toString(),
          productTitle: item.title,
          variantId: item.variant_id?.toString(),
          variantTitle: item.variant_title,
          quantity: item.quantity,
          price: item.price ? parseFloat(item.price) : null,
          timestamp: new Date(),
        },
      });
    }
  } else {
    console.log(`[Checkout Webhook] Checkout items already recorded for session ${cartSession.id}, skipping`);
  }

  // Broadcast update via SSE
  const updatedSession = await prisma.cartSession.findUnique({
    where: { id: cartSession.id },
    include: {
      events: {
        orderBy: { timestamp: "desc" },
        take: 10,
      },
    },
  });

  if (updatedSession) {
    sseManager.broadcast(shopRecord.id, "cart-update", {
      session: updatedSession,
    });
  }

  return data({ success: true }, { status: 200 });
};
