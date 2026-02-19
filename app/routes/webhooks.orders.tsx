// Webhook handler for order events (orders/create)

import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import sseManager from "../services/sse.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const { topic, shop, payload } = await authenticate.webhook(request);

    console.log(`[Webhook] Received ${topic} from ${shop}`);

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
    const customerEmail = payload.customer?.email;
    const orderValue = parseFloat(payload.total_price || "0");

    const cartToken = payload.cart_token;
    console.log(`[Webhook Orders] Order ${orderId} | cart_token: ${cartToken} | customer: ${customerEmail}`);

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

    if (session) {
      // Mark session as converted
      await prisma.cartSession.update({
        where: { id: session.id },
        data: {
          orderPlaced: true,
          orderId,
          orderNumber: orderNumber || null,
          orderValue,
          customerId: customerId || session.customerId,
          customerEmail: customerEmail || session.customerEmail,
          customerName: payload.customer?.first_name && payload.customer?.last_name
            ? `${payload.customer.first_name} ${payload.customer.last_name}`
            : session.customerName,
        },
      });

      // Create order event
      await prisma.cartEvent.create({
        data: {
          sessionId: session.id,
          eventType: "checkout_completed",
        },
      });

      // Broadcast update
      const sessionWithEvents = await prisma.cartSession.findUnique({
        where: { id: session.id },
        include: {
          events: {
            orderBy: { timestamp: "desc" },
            take: 10,
          },
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
