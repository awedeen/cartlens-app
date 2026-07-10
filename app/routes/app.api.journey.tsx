// On-demand journey completion for the Live Carts detail view.
//
// Before checkout, a shopper's page-views live on their pixel "visit" session,
// separate from the webhook "cart" session shown in the feed. This endpoint
// finds the correlated visit and returns its page_view events so the detail view
// can show the full browsing → cart → checkout journey pre-checkout. Display-only.

import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { findVisitPageViews } from "../services/attribution.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    const { session } = await authenticate.admin(request);
    if (!session?.shop) {
      return data({ error: "Unauthorized" }, { status: 401 });
    }

    const sessionId = new URL(request.url).searchParams.get("sessionId");
    if (!sessionId) {
      return data({ error: "Missing sessionId" }, { status: 400 });
    }

    const shop = await prisma.shop.findUnique({
      where: { shopifyDomain: session.shop },
    });
    if (!shop) {
      return data({ error: "Shop not found" }, { status: 404 });
    }

    // Load the cart, scoped to this shop, with its cart_add events (for a
    // contents match). Scoping by shopId prevents cross-shop reads.
    const cart = await prisma.cartSession.findFirst({
      where: { id: sessionId, shopId: shop.id },
      include: { events: { where: { eventType: "cart_add" }, select: { variantId: true } } },
    });
    if (!cart) {
      return data({ sessionId, pageViews: [] });
    }

    const variantIds = Array.from(
      new Set(cart.events.map((e) => e.variantId).filter((v): v is string => !!v)),
    );

    const pageViews = await findVisitPageViews({
      shopId: shop.id,
      cartId: cart.id,
      customerId: cart.customerId,
      customerEmail: cart.customerEmail,
      variantIds,
      before: cart.createdAt,
    });

    return data({ sessionId, pageViews });
  } catch (err) {
    if (err instanceof Response) throw err; // OAuth redirects
    console.error("[Journey API] Error:", err);
    return data({ error: "Internal server error" }, { status: 500 });
  }
};
