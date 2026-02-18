// Public API endpoint to receive events from Web Pixel extension
// This route is OUTSIDE the authenticated app layout (no "app." prefix)
// and does NOT require Shopify authentication

import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import prisma from "../db.server";
import { detectBot } from "../services/bot.server";
// Geo now handled via Cloudflare headers — no external API needed
import sseManager from "../services/sse.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return data({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    // Grab geo data from Cloudflare/proxy headers
    const cfCountry = request.headers.get("cf-ipcountry") || request.headers.get("CF-IPCountry");
    const cfCity = request.headers.get("cf-ipcity") || request.headers.get("CF-IPCity");
    const cfIP = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    console.log(`[Public Events] Geo headers: country=${cfCountry}, city=${cfCity}, ip=${cfIP}`);

    // Parse event payload
    const payload = await request.json();
    console.log("[Public Events] Full payload:", JSON.stringify(payload).slice(0, 500));
    const {
      shopDomain,
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

    // Validate required fields
    if (!shopDomain || !visitorId || !eventType) {
      return data({ error: "Missing required fields: shopDomain, visitorId, eventType" }, { status: 400 });
    }

    // Basic origin validation: check referer header contains shop domain
    const referer = request.headers.get("referer") || request.headers.get("origin");
    if (referer && !referer.includes(shopDomain.replace(".myshopify.com", ""))) {
      console.warn(`[Public API] Origin mismatch: referer=${referer}, shopDomain=${shopDomain}`);
      // Don't reject, just log - some legitimate requests may have no referer
    }

    // Look up shop in Session table to verify it's a real installed shop
    const session = await prisma.session.findFirst({
      where: { shop: shopDomain },
    });

    if (!session) {
      console.warn(`[Public API] Invalid shop domain: ${shopDomain}`);
      return data({ error: "Invalid shop" }, { status: 403 });
    }

    // Find or create Shop record
    let shop = await prisma.shop.findUnique({
      where: { shopifyDomain: shopDomain },
      include: { settings: true },
    });

    if (!shop) {
      shop = await prisma.shop.create({
        data: { shopifyDomain: shopDomain },
        include: { settings: true },
      });
    }

    // Bot detection
    const botDetection = detectBot(userAgent);
    const isSuspectedBot = shop.botFilterEnabled ? botDetection.isBot : false;

    // Geo from Cloudflare headers (free, no API needed) or payload fallback
    const city = cfCity || null;
    const country = null; // CF doesn't give country name, just code
    const countryCode = cfCountry && cfCountry !== "XX" ? cfCountry : null;
    const resolvedIP = cfIP || ipAddress || null;

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
          ipAddress: resolvedIP,
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
    console.error("[Public API Events] Error:", error);
    return data({ error: "Internal server error" }, { status: 500 });
  }
};
