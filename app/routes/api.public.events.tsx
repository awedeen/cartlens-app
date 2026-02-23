// Public API endpoint to receive events from Web Pixel extension
// This route is OUTSIDE the authenticated app layout (no "app." prefix)
// and does NOT require Shopify authentication

import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { Prisma } from "@prisma/client";
import prisma from "../db.server";
import { detectBot } from "../services/bot.server";
// Geo now handled via Cloudflare headers — no external API needed
import sseManager from "../services/sse.server";
import { checkRateLimit, sanitizeString } from "../utils/security.server";

function parseUserAgent(ua: string | null): { browser: string | null; os: string | null } {
  if (!ua) return { browser: null, os: null };

  let browser: string | null = null;
  if (/Edg\//i.test(ua)) browser = "Edge";
  else if (/SamsungBrowser/i.test(ua)) browser = "Samsung Browser";
  else if (/OPR\/|Opera/i.test(ua)) browser = "Opera";
  else if (/Firefox\//i.test(ua)) browser = "Firefox";
  else if (/Chrome\//i.test(ua)) browser = "Chrome";
  else if (/Safari\//i.test(ua) && /Version\//i.test(ua)) browser = "Safari";

  let os: string | null = null;
  if (/iPhone|iPad|iPod/i.test(ua)) os = "iOS";
  else if (/Android/i.test(ua)) os = "Android";
  else if (/Windows NT/i.test(ua)) os = "Windows";
  else if (/Mac OS X/i.test(ua)) os = "macOS";
  else if (/Linux/i.test(ua)) os = "Linux";
  else if (/CrOS/i.test(ua)) os = "Chrome OS";

  return { browser, os };
}

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return data({ error: "Method not allowed" }, { status: 405 });
  }

  // Rate limit by IP — 120 requests/minute covers normal pixel activity.
  // Railway runs behind Fastly CDN — real client IP comes from x-forwarded-for.
  // cf-connecting-ip is Cloudflare-specific and will always be null on Railway,
  // but keeping it as a no-op fallback doesn't hurt.
  const clientIp =
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown";
  if (!checkRateLimit(clientIp, 120, 60_000)) {
    return data({ error: "Too many requests" }, { status: 429 });
  }

  try {
    // Grab geo data from Cloudflare/proxy headers
    const cfCountry = request.headers.get("cf-ipcountry") || request.headers.get("CF-IPCountry");
    const cfCity = request.headers.get("cf-ipcity") || request.headers.get("CF-IPCity");
    const cfIP = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();

    // Parse event payload
    const payload = await request.json();
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
      billingCity,
      billingCountry,
      billingCountryCode,
    } = payload;

    // Sanitize string inputs — cap length and strip whitespace
    const safeShopDomain = sanitizeString(shopDomain, 100);
    const safeVisitorId = sanitizeString(visitorId, 128);
    const safeCustomerEmail = sanitizeString(customerEmail, 255);
    const safeCustomerName = sanitizeString(customerName, 255);
    const safePageUrl = sanitizeString(pageUrl, 512);
    const safePageTitle = sanitizeString(pageTitle, 255);
    const safeReferrerUrl = sanitizeString(referrerUrl, 512);
    const safeLandingPage = sanitizeString(landingPage, 512);
    const safeUtmSource = sanitizeString(utmSource, 100);
    const safeUtmMedium = sanitizeString(utmMedium, 100);
    const safeUtmCampaign = sanitizeString(utmCampaign, 255);

    // Validate required fields
    if (!safeShopDomain || !safeVisitorId || !eventType) {
      return data({ error: "Missing required fields: shopDomain, visitorId, eventType" }, { status: 400 });
    }

    // Basic origin validation — referer header is optional and stripped by some browsers/extensions

    // Look up shop in Session table to verify it's a real installed shop
    const session = await prisma.session.findFirst({
      where: { shop: safeShopDomain! },
    });

    if (!session) {
      console.warn(`[Public API] Invalid shop domain: ${safeShopDomain}`);
      return data({ error: "Invalid shop" }, { status: 403 });
    }

    // Find or create Shop record — upsert is race-condition-safe
    const shop = await prisma.shop.upsert({
      where: { shopifyDomain: safeShopDomain! },
      create: { shopifyDomain: safeShopDomain! },
      update: {},
    });

    // Bot detection
    const botDetection = detectBot(userAgent);
    const isSuspectedBot = shop.botFilterEnabled ? botDetection.isBot : false;

    // Geo: Cloudflare headers first, fall back to billing address from checkout events
    const city = cfCity || billingCity || null;
    const country = billingCountry || null;
    const countryCode = (cfCountry && cfCountry !== "XX") ? cfCountry : (billingCountryCode || null);
    const resolvedIP = cfIP || ipAddress || null;

    // Parse browser and OS from user agent
    const parsedUA = parseUserAgent(userAgent || null);
    const resolvedBrowser = browser || parsedUA.browser;
    const resolvedOS = os || parsedUA.os;

    // Find or create CartSession — upsert is race-condition-safe
    // On conflict (same shopId+visitorId), only update mutable identity fields.
    // undefined values are ignored by Prisma (field stays unchanged).
    const cartSession = await prisma.cartSession.upsert({
      where: { shopId_visitorId: { shopId: shop.id, visitorId: safeVisitorId! } },
      create: {
        shopId: shop.id,
        visitorId: safeVisitorId!,
        customerId,
        customerEmail: safeCustomerEmail,
        customerName: safeCustomerName,
        referrerUrl: safeReferrerUrl,
        landingPage: safeLandingPage,
        utmSource: safeUtmSource,
        utmMedium: safeUtmMedium,
        utmCampaign: safeUtmCampaign,
        ipAddress: resolvedIP,
        city,
        country,
        countryCode,
        deviceType,
        browser: resolvedBrowser,
        os: resolvedOS,
        userAgent,
        isSuspectedBot,
        botReason: isSuspectedBot ? botDetection.reason : null,
      },
      update: {
        // Only overwrite if new value is present — undefined = leave unchanged in Prisma
        customerId: customerId || undefined,
        customerEmail: safeCustomerEmail || undefined,
        customerName: safeCustomerName || undefined,
        city: city || undefined,
        country: country || undefined,
        countryCode: countryCode || undefined,
        updatedAt: new Date(),
      },
    });

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
        pageUrl: safePageUrl,
        pageTitle: safePageTitle,
        timestamp: timestamp ? new Date(timestamp) : new Date(),
      },
    });

    // Update session funnel status and cart summary
    const updates: Prisma.CartSessionUpdateInput = {};

    if (eventType === "cart_add" || eventType === "cart_remove") {
      if (eventType === "cart_add") {
        updates.cartCreated = true;
      }
      // Recalculate cart total and item count from all add/remove events
      const cartEvents = await prisma.cartEvent.findMany({
        where: {
          sessionId: cartSession.id,
          eventType: { in: ["cart_add", "cart_remove"] },
        },
      });

      let total = 0;
      let items = 0;

      for (const evt of cartEvents) {
        if (evt.eventType === "cart_add" && evt.price && evt.quantity) {
          total += evt.price * evt.quantity;
          items += evt.quantity;
        } else if (evt.eventType === "cart_remove" && evt.quantity) {
          if (evt.price) total -= evt.price * evt.quantity;
          items -= evt.quantity;
        }
      }

      updates.cartTotal = Math.max(0, total);
      updates.itemCount = Math.max(0, items);
    }

    if (eventType === "checkout_started") {
      updates.checkoutStarted = true;
      // If they're starting checkout again, clear any prior abandonment
      if (cartSession.checkoutAbandoned) {
        updates.checkoutAbandoned = false;
      }
    }

    if (eventType === "checkout_completed") {
      updates.orderPlaced = true;
    }

    // Detect checkout abandonment: page_view after checkout started, before order placed
    if (
      eventType === "page_view" &&
      cartSession.checkoutStarted &&
      !cartSession.orderPlaced &&
      !cartSession.checkoutAbandoned
    ) {
      await prisma.cartEvent.create({
        data: {
          sessionId: cartSession.id,
          eventType: "checkout_abandoned",
          timestamp: timestamp ? new Date(timestamp) : new Date(),
        },
      });
      updates.checkoutAbandoned = true;
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
        },
      },
    });

    sseManager.broadcast(shop.id, "cart-update", {
      session: sessionWithEvents,
    });

    return data({ success: true, sessionId: cartSession.id, eventId: event.id });
  } catch (error) {
    console.error("[Public API Events] Error:", error);
    return data({ error: "Internal server error" }, { status: 500 });
  }
};
