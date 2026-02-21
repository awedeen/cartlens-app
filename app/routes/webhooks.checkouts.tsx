// Webhook handler for checkout events (checkouts/create, checkouts/update)
// This is the reliable way to detect checkout — pixel checkout_started is unreliable on dev stores

import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import sseManager from "../services/sse.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
  const { topic, shop, payload } = await authenticate.webhook(request);

  // Shopify checkout payload includes cart_token which links to our CartSession
  const cartToken = payload.cart_token;
  if (!cartToken) {
    console.log("[Checkout Webhook] No cart_token in payload, skipping");
    return data({ success: true }, { status: 200 });
  }
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
  });

  if (!cartSession) {
    console.log(`[Checkout Webhook] No CartSession found for cart_token ${cartToken}`);
    return data({ success: true }, { status: 200 });
  }
  // Update session — mark checkout started
  const updates: any = { checkoutStarted: true };

  // If customer info is available in checkout, capture it
  // Pull from all available sources so we capture data regardless of checkout step order
  if (payload.customer?.id) {
    updates.customerId = String(payload.customer.id);
  }

  // Email: payload.email (contact step) falls back to customer.email
  const email = payload.email || payload.customer?.email;
  if (email) updates.customerEmail = email;

  // Name: customer object → billing address → shipping address
  // shipping_address.first/last_name is populated as soon as shipping step is filled,
  // often before payload.customer reflects it
  const nameFromCustomer = [payload.customer?.first_name, payload.customer?.last_name].filter(Boolean).join(" ");
  const nameFromBilling = [payload.billing_address?.first_name, payload.billing_address?.last_name].filter(Boolean).join(" ");
  const nameFromShipping = [payload.shipping_address?.first_name, payload.shipping_address?.last_name].filter(Boolean).join(" ");
  const resolvedName = nameFromCustomer || nameFromBilling || nameFromShipping;
  if (resolvedName && (!cartSession.customerName || resolvedName.length > cartSession.customerName.length)) {
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
  console.log(`[Checkout Webhook] ${lineItems.length} line items in checkout`);

  // Query directly — avoids false-positives from take: 10 truncation
  const existingCheckoutEvent = await prisma.cartEvent.findFirst({
    where: { sessionId: cartSession.id, eventType: "checkout_started" },
  });
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
  const existingCheckoutItemCount = await prisma.cartEvent.count({
    where: { sessionId: cartSession.id, eventType: "checkout_item" },
  });
  if (existingCheckoutItemCount === 0) {
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
