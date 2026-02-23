// Webhook handler for checkout events (checkouts/create, checkouts/update)
// This is the reliable way to detect checkout — pixel checkout_started is unreliable on dev stores

import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { Prisma } from "@prisma/client";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import sseManager from "../services/sse.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
  const { topic, shop, payload } = await authenticate.webhook(request);

  // Shopify checkout payload includes cart_token which links to our CartSession
  const cartToken = payload.cart_token;
  if (!cartToken) {
    return data({ success: true }, { status: 200 });
  }
  // Look up shop record first
  const shopRecord = await prisma.shop.findUnique({
    where: { shopifyDomain: shop },
  });

  if (!shopRecord) {
    return data({ success: true }, { status: 200 });
  }

  // Find the cart session by cart token (stored as visitorId) + shop
  const cartSession = await prisma.cartSession.findFirst({
    where: {
      shopId: shopRecord.id,
      visitorId: cartToken,
    },
  });

  if (!cartSession) {
    return data({ success: true }, { status: 200 });
  }
  // Update session — mark checkout started
  const updates: Prisma.CartSessionUpdateInput = { checkoutStarted: true };

  // If customer info is available in checkout, capture it
  // Pull from all available sources so we capture data regardless of checkout step order
  if (payload.customer?.id) {
    updates.customerId = String(payload.customer.id);
  }

  // Email: payload.email (contact step) falls back to customer.email
  const email = payload.email || payload.customer?.email;
  if (email) updates.customerEmail = email;

  // Name: shipping address → billing address → customer object
  // Prefer what the user actually typed at checkout over their stored account profile.
  // shipping_address is populated from the shipping step form (most live source).
  // customer.first/last_name reflects the saved Shopify customer profile which may
  // differ from what they enter during this checkout — using it first was wrong.
  const nameFromShipping = [payload.shipping_address?.first_name, payload.shipping_address?.last_name].filter(Boolean).join(" ");
  const nameFromBilling = [payload.billing_address?.first_name, payload.billing_address?.last_name].filter(Boolean).join(" ");
  const nameFromCustomer = [payload.customer?.first_name, payload.customer?.last_name].filter(Boolean).join(" ");
  const resolvedName = nameFromShipping || nameFromBilling || nameFromCustomer;
  if (resolvedName && resolvedName !== cartSession.customerName) {
    updates.customerName = resolvedName;
  }

  // Discount codes — deduplicate by code value (Shopify can send the same code twice if reapplied)
  const discountCodes = payload.discount_codes || [];
  const uniqueDiscountCodes = discountCodes.filter(
    (dc: any, idx: number, arr: any[]) => arr.findIndex((d: any) => d.code === dc.code) === idx
  );  if (uniqueDiscountCodes.length > 0) {
    updates.discountCodes = JSON.stringify(uniqueDiscountCodes);
  }

  // Total discount amount
  const totalDiscounts = parseFloat(payload.total_discounts || "0");
  if (totalDiscounts > 0) {
    updates.totalDiscounts = totalDiscounts;
  }

  // Geo from billing or shipping address
  const billing = payload.billing_address || payload.shipping_address;  if (billing) {
    if (billing.city) updates.city = billing.city;
    if (billing.country) updates.country = billing.country;
    if (billing.country_code) updates.countryCode = billing.country_code;  }

  await prisma.cartSession.update({
    where: { id: cartSession.id },
    data: updates,
  });

  // Create checkout events — one for the session, plus one per line item
  const lineItems = payload.line_items || [];

  // Create checkout_started event — idempotent via partial unique index on
  // (sessionId) WHERE eventType = 'checkout_started'. The findFirst pre-check
  // avoids the write on subsequent webhooks; the try/catch handles the rare
  // concurrent-webhook race where two requests slip past the check simultaneously.
  const existingCheckoutEvent = await prisma.cartEvent.findFirst({
    where: { sessionId: cartSession.id, eventType: "checkout_started" },
  });
  if (!existingCheckoutEvent) {
    try {
      await prisma.cartEvent.create({
        data: {
          sessionId: cartSession.id,
          eventType: "checkout_started",
          timestamp: new Date(),
        },
      });
    } catch (e: any) {
      if (e?.code !== "P2002") throw e; // ignore unique constraint violation (duplicate webhook)
    }
  }

  // Record each product that reached checkout (only once per session)
  const existingCheckoutItemCount = await prisma.cartEvent.count({
    where: { sessionId: cartSession.id, eventType: "checkout_item" },
  });
  if (existingCheckoutItemCount === 0) {
    await Promise.all(
      lineItems.map((item: any) =>
        prisma.cartEvent.create({
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
        })
      )
    );
  }

  // Broadcast update via SSE
  const updatedSession = await prisma.cartSession.findUnique({
    where: { id: cartSession.id },
    include: {
      events: { orderBy: { timestamp: "desc" } },
    },
  });

  if (updatedSession) {
    sseManager.broadcast(shopRecord.id, "cart-update", { session: updatedSession });
  }

  return data({ success: true }, { status: 200 });
  } catch (error) {
    if (error instanceof Response) throw error;
    console.error("[Checkout Webhook] Error:", error);
    return data({ error: "Internal server error" }, { status: 500 });
  }
};
