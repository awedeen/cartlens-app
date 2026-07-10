// Webhook handler for order events (orders/create)

import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import sseManager from "../services/sse.server";
import { findFallbackSession, reconcilePixelSession } from "../services/attribution.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const { topic, shop, payload } = await authenticate.webhook(request);

    if (topic !== "ORDERS_CREATE") {
      return data({ error: "Invalid topic" }, { status: 400 });
    }

    // Find Shop record
    const shopRecord = await prisma.shop.findUnique({
      where: { shopifyDomain: shop },
    });

    if (!shopRecord) {
      console.warn(`[Webhook] Shop not found: ${shop}`);
      return data({ error: "Shop not found" }, { status: 404 });
    }

    // Extract order data
    const orderId = payload.id?.toString();
    const orderNumber = payload.order_number?.toString();
    const customerId = payload.customer?.id?.toString();
    // Guest orders often have no customer object but do carry a top-level email —
    // fall back to it so identity-based attribution/merge still works for guests.
    const customerEmail = payload.customer?.email || payload.email;
    const orderValue = parseFloat(payload.total_price || "0");

    const cartToken = payload.cart_token;
    console.log(`[Webhook Orders] Order ${orderId} | cart_token: ${cartToken ? "[present]" : "[missing]"}`);

    // Find matching cart session — cart_token only (reliable link to web storefront sessions)
    // Draft orders, POS, and API orders have null cart_token and should not be attributed
    let session = null;

    if (cartToken) {
      session = await prisma.cartSession.findFirst({
        where: {
          shopId: shopRecord.id,
          visitorId: cartToken,
          orderPlaced: false,
        },
        orderBy: { createdAt: "desc" },
      });
    }

    if (!cartToken) {
      console.log(`[Webhook Orders] No cart_token — likely draft/POS/API order, skipping attribution`);
    }

    // Fallback attribution: the order carried a cart_token but it matched no
    // session — Shopify rotated the token, or an accelerated checkout skipped the
    // cart so carts/create never recorded it. Recover the originating session by
    // customer identity, or by a unique contents match, before giving up.
    if (cartToken && !session) {
      const recovered = await findFallbackSession({
        shopId: shopRecord.id,
        customerId,
        customerEmail,
        variantIds: (payload.line_items || [])
          .map((li: any) => li.variant_id?.toString())
          .filter(Boolean),
        before: payload.created_at ? new Date(payload.created_at) : new Date(),
      });
      if (recovered) {
        session = recovered.session;
        console.log(
          `[Webhook Orders] Recovered session ${session.id} for order ${orderId} via ${recovered.via} fallback`,
        );
      }
    }

    if (session) {
      // Mark session as converted. Conversion is the strongest possible
      // "real human" signal — if a session ever placed an order, the
      // burst-cluster bot flag was a false positive. Clear it.
      await prisma.cartSession.update({
        where: { id: session.id },
        data: {
          orderPlaced: true,
          orderId,
          orderNumber: orderNumber || null,
          orderValue,
          isSuspectedBot: false,
          botReason: null,
          customerId: customerId || session.customerId,
          customerEmail: customerEmail || session.customerEmail,
          customerName: (() => {
            // Prefer shipping address name (what user typed) over stored customer profile
            const fromShipping = [payload.shipping_address?.first_name, payload.shipping_address?.last_name].filter(Boolean).join(" ");
            const fromBilling = [payload.billing_address?.first_name, payload.billing_address?.last_name].filter(Boolean).join(" ");
            const fromCustomer = payload.customer?.first_name && payload.customer?.last_name
              ? `${payload.customer.first_name} ${payload.customer.last_name}`
              : "";
            return fromShipping || fromBilling || fromCustomer || session.customerName;
          })(),
        },
      });

      // Create order event
      await prisma.cartEvent.create({
        data: {
          sessionId: session.id,
          eventType: "checkout_completed",
        },
      });

      // Session unification: fold the shopper's pixel "marketing" session (UTM,
      // referrer, device, page-views) into this converting cart_token session so
      // the sale is attributed to its true source and the shopper isn't counted
      // twice. Exact-identity only; no-op when the pixel is dead or unidentified.
      try {
        const merged = await reconcilePixelSession({
          shopId: shopRecord.id,
          canonicalId: session.id,
          customerId,
          customerEmail,
          before: payload.created_at ? new Date(payload.created_at) : new Date(),
        });
        if (merged) {
          console.log(`[Webhook Orders] Merged pixel session ${merged.mergedId} into ${session.id} via ${merged.via}`);
        }
      } catch (e) {
        // Enrichment is best-effort — never fail the conversion over it.
        console.error("[Webhook Orders] reconcilePixelSession failed:", e);
      }

      // Broadcast update
      const sessionWithEvents = await prisma.cartSession.findUnique({
        where: { id: session.id },
        include: {
          events: { orderBy: { timestamp: "desc" } },
        },
      });

      sseManager.broadcast(shopRecord.id, "cart-update", {
        session: sessionWithEvents,
      });

      console.log(`[Webhook Orders] Marked session ${session.id} as converted (order ${orderId})`);
    } else {
      console.warn(`[Webhook Orders] No matching session found for order ${orderId}`);
    }

    return data({ success: true });
  } catch (error) {
    console.error("[Webhook Orders] Error:", error);
    return data({ error: "Internal server error" }, { status: 500 });
  }
};
