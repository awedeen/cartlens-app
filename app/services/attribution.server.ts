// Fallback attribution — recover a CartSession when the exact cart_token match fails.
//
// CartLens links a sale to its cart by matching the order/checkout `cart_token`
// against `CartSession.visitorId` (the token captured by the carts webhook).
// That single key is fragile: Shopify can rotate the cart token between the
// storefront cart and the final checkout, and accelerated checkouts (Shop Pay,
// "Buy it now", PayPal) skip the AJAX cart entirely — so `carts/create` never
// records the token the order eventually arrives with. The result is a real sale
// that finds no session and stays stuck at "Browsing".
//
// This helper runs ONLY after the exact-token lookup misses, and tries to
// recover the originating session through secondary signals:
//
//   1. Identity (exact): same customerId, then same customerEmail. Reliable for
//      logged-in buyers and for guest sessions a prior checkout webhook enriched.
//   2. Contents (unique-only): an un-converted session whose cart holds a
//      cart_add for EVERY variant in the order. Trusted only when EXACTLY ONE
//      such session exists in the window — if two shoppers have the same item we
//      return null rather than guess, so a sale is never attached to the wrong
//      cart (important for hot products that attract several carts at once).
//
// Callers gate this on a present cart_token so POS/draft/API orders (which have
// no storefront cart) are never speculatively attributed.

import prisma from "../db.server";
import { Prisma } from "@prisma/client";
import type { CartSession, CartEvent } from "@prisma/client";
import sseManager from "./sse.server";

// Pixel sessions are keyed on the Web Pixel's own cookie id (`v_<ts>_<rand>`),
// which never equals a Shopify cart_token. This prefix is how we tell a
// browser-side "marketing" session apart from a webhook "cart" session.
const PIXEL_VISITOR_PREFIX = "v_";

// How far back to look for a candidate cart. A buyer may add to cart and convert
// hours later; 24h is generous without trawling unrelated history.
const FALLBACK_WINDOW_MS = 24 * 60 * 60 * 1000;

// Tolerance on the upper time bound. The session's createdAt is its first-seen
// time (always before checkout), but webhook delivery can be delayed, so a small
// forward buffer avoids excluding a cart whose carts/create landed late.
const CLOCK_SKEW_BUFFER_MS = 15 * 60 * 1000;

export type FallbackVia = "customerId" | "customerEmail" | "contents";

export interface FallbackInput {
  shopId: string;
  customerId?: string | null;
  customerEmail?: string | null;
  /** Variant IDs (as strings) from the order/checkout line items. */
  variantIds: string[];
  /** Order/checkout creation time — only consider carts created at/before this. */
  before: Date;
}

/**
 * Attempt to recover the CartSession behind an order/checkout when the exact
 * cart_token lookup failed. Returns the matched session and the signal used, or
 * null when nothing can be matched safely.
 */
export async function findFallbackSession(
  input: FallbackInput,
): Promise<{ session: CartSession; via: FallbackVia } | null> {
  const { shopId, customerId, customerEmail, variantIds, before } = input;

  const since = new Date(before.getTime() - FALLBACK_WINDOW_MS);
  const until = new Date(before.getTime() + CLOCK_SKEW_BUFFER_MS);
  const baseWhere = {
    shopId,
    orderPlaced: false,
    createdAt: { gte: since, lte: until },
  };

  // 1a. Exact identity — logged-in buyer. Most recent un-converted cart wins.
  if (customerId) {
    const byCustomer = await prisma.cartSession.findFirst({
      where: { ...baseWhere, customerId },
      orderBy: { createdAt: "desc" },
    });
    if (byCustomer) return { session: byCustomer, via: "customerId" };
  }

  // 1b. Exact identity — email captured on the session by an earlier checkout.
  if (customerEmail) {
    const byEmail = await prisma.cartSession.findFirst({
      where: { ...baseWhere, customerEmail },
      orderBy: { createdAt: "desc" },
    });
    if (byEmail) return { session: byEmail, via: "customerEmail" };
  }

  // 2. Contents match — guest checkout with no shared identity. Require the
  //    session to contain a cart_add for every variant in the order, and trust
  //    it only when the match is unambiguous (exactly one candidate).
  const cleanVariants = Array.from(new Set(variantIds.filter(Boolean)));
  if (cleanVariants.length === 0) return null;

  const candidates = await prisma.cartSession.findMany({
    where: {
      ...baseWhere,
      AND: cleanVariants.map((variantId) => ({
        events: { some: { eventType: "cart_add", variantId } },
      })),
    },
    orderBy: { createdAt: "desc" },
    take: 2, // we only need to know whether the match is unique
  });

  if (candidates.length === 1) {
    return { session: candidates[0], via: "contents" };
  }

  // 0 candidates → nothing to recover; 2+ → ambiguous, skip to avoid mis-attribution.
  return null;
}

export interface ReconcileInput {
  shopId: string;
  /** The canonical cart_token session to enrich (the one an order attaches to). */
  canonicalId: string;
  customerId?: string | null;
  customerEmail?: string | null;
  /** Order/checkout creation time — bounds how far back a pixel session may be. */
  before: Date;
}

/**
 * Session unification. The Web Pixel and the Admin webhooks each create their
 * own CartSession for the same physical shopper — the pixel keys on its cookie
 * id (`v_…`, carrying UTM/referrer/device/page-views), the webhook keys on the
 * cart_token (carrying cart contents and the token orders attach to). This
 * folds the pixel "marketing" session into the canonical cart_token session so
 * one shopper is counted once and the sale is attributed to its true source.
 *
 * Matching is EXACT-IDENTITY only (customerId, then customerEmail) — never a
 * fuzzy contents guess — so a shopper's marketing data is never grafted onto a
 * stranger's cart. Marketing/device/geo fields are copied fill-empty (the
 * canonical's own values always win); page_view events (which webhooks never
 * produce, so there's no duplication) are re-pointed onto the canonical; and
 * the pixel session is stamped `mergedInto` so the feed and Reports hide it.
 *
 * No-op and safe when the pixel is dead (no `v_` sessions exist) or identity is
 * unknown — returns null without touching anything.
 */
export async function reconcilePixelSession(
  input: ReconcileInput,
): Promise<{ mergedId: string; via: "customerId" | "customerEmail" } | null> {
  const { shopId, canonicalId, customerId, customerEmail, before } = input;
  if (!customerId && !customerEmail) return null;

  const since = new Date(before.getTime() - FALLBACK_WINDOW_MS);
  const until = new Date(before.getTime() + CLOCK_SKEW_BUFFER_MS);
  const baseWhere = {
    shopId,
    id: { not: canonicalId },
    mergedInto: null,
    visitorId: { startsWith: PIXEL_VISITOR_PREFIX },
    createdAt: { gte: since, lte: until },
  };

  let pixel: CartSession | null = null;
  let via: "customerId" | "customerEmail" | null = null;
  if (customerId) {
    pixel = await prisma.cartSession.findFirst({
      where: { ...baseWhere, customerId },
      orderBy: { createdAt: "desc" },
    });
    if (pixel) via = "customerId";
  }
  if (!pixel && customerEmail) {
    pixel = await prisma.cartSession.findFirst({
      where: { ...baseWhere, customerEmail },
      orderBy: { createdAt: "desc" },
    });
    if (pixel) via = "customerEmail";
  }
  if (!pixel || !via) return null;

  const canonical = await prisma.cartSession.findUnique({ where: { id: canonicalId } });
  if (!canonical) return null;

  // Take the pixel's value only where the canonical currently has none.
  const fill = (current: string | null, incoming: string | null): string | undefined =>
    !current && incoming ? incoming : undefined;

  const data: Prisma.CartSessionUpdateInput = {
    utmSource: fill(canonical.utmSource, pixel.utmSource),
    utmMedium: fill(canonical.utmMedium, pixel.utmMedium),
    utmCampaign: fill(canonical.utmCampaign, pixel.utmCampaign),
    utmContent: fill(canonical.utmContent, pixel.utmContent),
    utmId: fill(canonical.utmId, pixel.utmId),
    referrerUrl: fill(canonical.referrerUrl, pixel.referrerUrl),
    landingPage: fill(canonical.landingPage, pixel.landingPage),
    deviceType: fill(canonical.deviceType, pixel.deviceType),
    browser: fill(canonical.browser, pixel.browser),
    os: fill(canonical.os, pixel.os),
    deviceModel: fill(canonical.deviceModel, pixel.deviceModel),
    userAgent: fill(canonical.userAgent, pixel.userAgent),
    ipAddress: fill(canonical.ipAddress, pixel.ipAddress),
    city: fill(canonical.city, pixel.city),
    country: fill(canonical.country, pixel.country),
    countryCode: fill(canonical.countryCode, pixel.countryCode),
    customerName: fill(canonical.customerName, pixel.customerName),
  };

  // One transaction: enrich canonical, move page-view history, retire the shadow.
  await prisma.$transaction([
    prisma.cartSession.update({ where: { id: canonicalId }, data }),
    prisma.cartEvent.updateMany({
      where: { sessionId: pixel.id, eventType: "page_view" },
      data: { sessionId: canonicalId },
    }),
    prisma.cartSession.update({
      where: { id: pixel.id },
      data: { mergedInto: canonicalId },
    }),
  ]);

  // Notify open dashboards that the shadow was merged. The pixel session may
  // already be rendered live (SSE broadcast it before the merge); without this,
  // it lingers as a blank/duplicate "ghost" row until the next full page load
  // (the loader filters mergedInto). Broadcasting the shadow now carrying
  // mergedInto lets the client drop it immediately. Best-effort — a broadcast
  // failure must never fail the merge, so callers keep their own try/catch.
  sseManager.broadcast(shopId, "cart-update", {
    session: { ...pixel, mergedInto: canonicalId },
  });

  return { mergedId: pixel.id, via };
}

export interface VisitPageViewsInput {
  shopId: string;
  /** The cart session we're completing the journey for (excluded from the match). */
  cartId: string;
  customerId?: string | null;
  customerEmail?: string | null;
  /** Variant IDs (strings) from the cart's cart_add events, for a contents match. */
  variantIds: string[];
  /** The cart's created time — bounds how far back a correlated visit may be. */
  before: Date;
}

/**
 * Display-only journey completion. Before checkout, a shopper's page-views live
 * on their pixel "visit" session ("v_…"), separate from the webhook "cart"
 * session — they only get folded together by reconcilePixelSession at checkout.
 * For the Live Carts detail view we want the FULL story (browsing → cart →
 * checkout) even pre-checkout, so this finds the correlated visit and returns its
 * page_view events to interleave into the cart's journey.
 *
 * Correlation is conservative, mirroring findFallbackSession: exact identity
 * (customerId, then customerEmail), else a UNIQUE contents+time match (a single
 * visit that cart_add'd the same variants) — skip when ambiguous so a stranger's
 * browsing is never shown. This is display-only; it never mutates data.
 */
export async function findVisitPageViews(
  input: VisitPageViewsInput,
): Promise<CartEvent[]> {
  const { shopId, cartId, customerId, customerEmail, variantIds, before } = input;

  const since = new Date(before.getTime() - FALLBACK_WINDOW_MS);
  const until = new Date(before.getTime() + CLOCK_SKEW_BUFFER_MS);
  const baseWhere = {
    shopId,
    id: { not: cartId },
    visitorId: { startsWith: PIXEL_VISITOR_PREFIX },
    createdAt: { gte: since, lte: until },
  };

  let visit: CartSession | null = null;
  if (customerId) {
    visit = await prisma.cartSession.findFirst({
      where: { ...baseWhere, customerId },
      orderBy: { createdAt: "desc" },
    });
  }
  if (!visit && customerEmail) {
    visit = await prisma.cartSession.findFirst({
      where: { ...baseWhere, customerEmail },
      orderBy: { createdAt: "desc" },
    });
  }
  if (!visit) {
    const cleanVariants = Array.from(new Set(variantIds.filter(Boolean)));
    if (cleanVariants.length > 0) {
      const candidates = await prisma.cartSession.findMany({
        where: {
          ...baseWhere,
          AND: cleanVariants.map((variantId) => ({
            events: { some: { eventType: "cart_add", variantId } },
          })),
        },
        orderBy: { createdAt: "desc" },
        take: 2, // only need to know whether the match is unique
      });
      if (candidates.length === 1) visit = candidates[0];
    }
  }

  if (!visit) return [];

  return prisma.cartEvent.findMany({
    where: { sessionId: visit.id, eventType: "page_view" },
    orderBy: { timestamp: "asc" },
  });
}
