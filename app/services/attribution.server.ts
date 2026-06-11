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
import type { CartSession } from "@prisma/client";

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
