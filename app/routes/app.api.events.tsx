// DEPRECATED: Admin-only API endpoint for manual event injection
// The Web Pixel should use /api/public/events instead (no authentication required)
// This route is kept for admin-initiated events or manual testing

import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { detectBot } from "../services/bot.server";
import { lookupIP } from "../services/geo.server";
import sseManager from "../services/sse.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return data({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    // Authenticate the request (admin only)
    const { session } = await authenticate.admin(request);
    
    if (!session?.shop) {
      return data({ error: "Unauthorized" }, { status: 401 });
    }

    const shopifyDomain = session.shop;

    // Parse event payload
    const payload = await request.json();
    const {
      eventType,
      visitorId,
      customerId,
      customerEmail,
      customerName,
      product,
      variant,
      quantity,
      price,
      pageUrl,
      pageTitle,
      referrerUrl,
      landingPage,
      utmSource,
      utmMedium,
      utmCampaign,
      deviceType,
      browser,
      os,
      userAgent,
      ipAddress,
      timestamp,
    } = payload;

    // Find or create Shop record
    let shop = await prisma.shop.findUnique({
      where: { shopifyDomain },
      include: { settings: true },
    });

    if (!shop) {
      shop = await prisma.shop.create({
        data: { shopifyDomain },
        include: { settings: true },
      });
    }

    // Bot detection
    const botDetection = detectBot(userAgent);
    const isSuspectedBot = shop.botFilterEnabled ? botDetection.isBot : false;

    // Geo lookup if IP provided
    let city = null;
    let country = null;
    let countryCode = null;
    if (ipAddress) {
      const geo = await lookupIP(ipAddress);
      city = geo.city;
      country = geo.country;
      countryCode = geo.countryCode;
    }

    // Find or create CartSession
    let cartSession = await prisma.cartSession.findFirst({
      where: {
        shopId: shop.id,
        visitorId,
      },
      orderBy: { createdAt: "desc" },
    });

    if (!cartSession) {
      cartSession = await prisma.cartSession.create({
        data: {
          shopId: shop.id,
          visitorId,
          customerId,
          customerEmail,
          customerName,
          referrerUrl,
          landingPage,
          utmSource,
          utmMedium,
          utmCampaign,
          ipAddress,
          city,
          country,
          countryCode,
          deviceType,
          browser,
          os,
          userAgent,
          isSuspectedBot,
          botReason: isSuspectedBot ? botDetection.reason : null,
        },
      });
    } else {
      // Update session with latest info
      cartSession = await prisma.cartSession.update({
        where: { id: cartSession.id },
        data: {
          customerId: customerId || cartSession.customerId,
          customerEmail: customerEmail || cartSession.customerEmail,
          customerName: customerName || cartSession.customerName,
          city: city || cartSession.city,
          country: country || cartSession.country,
          countryCode: countryCode || cartSession.countryCode,
          updatedAt: new Date(),
        },
      });
    }

    // Create CartEvent
    const event = await prisma.cartEvent.create({
      data: {
        sessionId: cartSession.id,
        eventType,
        productId: product?.id,
        productTitle: product?.title,
        variantId: variant?.id,
        variantTitle: variant?.title,
        variantImage: variant?.image,
        quantity,
        price,
        pageUrl,
        pageTitle,
        timestamp: timestamp ? new Date(timestamp) : new Date(),
      },
    });

    // Update session funnel status and cart summary
    const updates: any = {};

    if (eventType === "cart_add") {
      updates.cartCreated = true;
      // Recalculate cart total and item count
      const cartEvents = await prisma.cartEvent.findMany({
        where: {
          sessionId: cartSession.id,
          eventType: { in: ["cart_add", "cart_remove"] },
        },
      });

      let total = 0;
      let items = 0;
      const productQuantities: Record<string, number> = {};

      for (const evt of cartEvents) {
        if (evt.eventType === "cart_add" && evt.variantId && evt.price && evt.quantity) {
          productQuantities[evt.variantId] = (productQuantities[evt.variantId] || 0) + evt.quantity;
          total += evt.price * evt.quantity;
          items += evt.quantity;
        } else if (evt.eventType === "cart_remove" && evt.variantId && evt.quantity) {
          productQuantities[evt.variantId] = (productQuantities[evt.variantId] || 0) - evt.quantity;
          if (evt.price) {
            total -= evt.price * evt.quantity;
          }
          items -= evt.quantity;
        }
      }

      updates.cartTotal = Math.max(0, total);
      updates.itemCount = Math.max(0, items);
    }

    if (eventType === "checkout_started") {
      updates.checkoutStarted = true;
    }

    if (eventType === "checkout_completed") {
      updates.orderPlaced = true;
    }

    if (Object.keys(updates).length > 0) {
      await prisma.cartSession.update({
        where: { id: cartSession.id },
        data: updates,
      });
    }

    // Broadcast to SSE clients
    const sessionWithEvents = await prisma.cartSession.findUnique({
      where: { id: cartSession.id },
      include: {
        events: {
          orderBy: { timestamp: "desc" },
          take: 10,
        },
      },
    });

    sseManager.broadcast(shop.id, "cart-update", {
      session: sessionWithEvents,
      event,
    });

    return data({ success: true, sessionId: cartSession.id, eventId: event.id });
  } catch (error) {
    console.error("[API Events] Error:", error);
    return data({ error: "Internal server error" }, { status: 500 });
  }
};
