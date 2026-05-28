// Server-side aggregations for the Reports tab.
//
// Runs against the FULL date-range slice — not the 100-session dashboard cap.
// Replaces the in-memory `filteredForReports` calculation in app._index.tsx,
// which silently truncated stats once a shop had > 100 sessions in a 30/90 day
// window.
//
// Suspected-bot sessions are excluded so marketing metrics aren't distorted
// by scraper / stock-checker traffic. The Live Carts toggle remains the way
// to inspect bot sessions individually.

import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { Prisma } from "@prisma/client";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

const ALLOWED_RANGES = [7, 30, 90] as const;
type Range = (typeof ALLOWED_RANGES)[number];

export interface ReportsTopProduct {
  productId: string;
  productTitle: string;
  cartAdds: number;
  checkouts: number;
  conversions: number;
  conversionRate: number;
}

export interface ReportsTopReferrer {
  referrer: string;
  sessions: number;
  cartAdds: number;
  conversionRate: number;
}

export interface ReportsData {
  range: Range;
  totalSessions: number;
  totalCarts: number;
  totalCheckouts: number;
  totalOrders: number;
  totalRevenue: number;
  avgCartValue: number;
  conversionRate: number;
  checkoutRate: number;
  checkoutToOrderRate: number;
  topProducts: ReportsTopProduct[];
  topReferrers: ReportsTopReferrer[];
}

// Raw row shapes returned by Prisma $queryRaw — COUNT returns BigInt in pg
interface SummaryRow {
  totalSessions: bigint;
  totalCarts: bigint;
  totalCheckouts: bigint;
  totalOrders: bigint;
  totalRevenue: number | null;
  avgCartValue: number | null;
}
interface ProductCartRow {
  productId: string;
  productTitle: string | null;
  cartAdds: bigint;
  conversions: bigint;
}
interface ProductCheckoutRow {
  productId: string;
  checkouts: bigint;
}
interface ReferrerRow {
  referrer: string;
  sessions: bigint;
  cartAdds: bigint;
  conversions: bigint;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    const { session } = await authenticate.admin(request);
    if (!session?.shop) {
      return data({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(request.url);
    const rawRange = parseInt(url.searchParams.get("range") || "30", 10);
    const range: Range = (ALLOWED_RANGES as readonly number[]).includes(rawRange)
      ? (rawRange as Range)
      : 30;

    const shop = await prisma.shop.findUnique({
      where: { shopifyDomain: session.shop },
    });
    if (!shop) {
      return data({ error: "Shop not found" }, { status: 404 });
    }

    const cutoff = new Date(Date.now() - range * 24 * 60 * 60 * 1000);

    // --- 1. Summary aggregates (single round-trip) ---
    const summaryRows = await prisma.$queryRaw<SummaryRow[]>`
      SELECT
        COUNT(*)::bigint                                                                    AS "totalSessions",
        (COUNT(*) FILTER (WHERE "cartCreated" = true))::bigint                              AS "totalCarts",
        (COUNT(*) FILTER (WHERE "checkoutStarted" = true))::bigint                          AS "totalCheckouts",
        (COUNT(*) FILTER (WHERE "orderPlaced" = true))::bigint                              AS "totalOrders",
        COALESCE(SUM("orderValue") FILTER (WHERE "orderPlaced" = true), 0)::float           AS "totalRevenue",
        COALESCE(AVG("cartTotal")  FILTER (WHERE "cartCreated" = true), 0)::float           AS "avgCartValue"
      FROM "CartSession"
      WHERE "shopId" = ${shop.id}
        AND "createdAt" >= ${cutoff}
        AND (
          "isSuspectedBot" = false
          OR "orderPlaced" = true
          OR "customerEmail" IS NOT NULL
          OR "customerName" IS NOT NULL
        )
    `;
    const sum = summaryRows[0];

    const totalSessions  = Number(sum?.totalSessions  ?? 0n);
    const totalCarts     = Number(sum?.totalCarts     ?? 0n);
    const totalCheckouts = Number(sum?.totalCheckouts ?? 0n);
    const totalOrders    = Number(sum?.totalOrders    ?? 0n);
    const totalRevenue   = sum?.totalRevenue  ?? 0;
    const avgCartValue   = sum?.avgCartValue  ?? 0;

    // --- 2. Top products by cart_add events (with conversions) ---
    const productCartRows = await prisma.$queryRaw<ProductCartRow[]>`
      SELECT
        e."productId"                                                              AS "productId",
        MAX(e."productTitle")                                                      AS "productTitle",
        COUNT(*)::bigint                                                           AS "cartAdds",
        (COUNT(*) FILTER (WHERE s."orderPlaced" = true))::bigint                   AS conversions
      FROM "CartEvent" e
      INNER JOIN "CartSession" s ON s.id = e."sessionId"
      WHERE s."shopId" = ${shop.id}
        AND s."createdAt" >= ${cutoff}
        AND (
          s."isSuspectedBot" = false
          OR s."orderPlaced" = true
          OR s."customerEmail" IS NOT NULL
          OR s."customerName" IS NOT NULL
        )
        AND e."eventType" = 'cart_add'
        AND e."productId" IS NOT NULL
      GROUP BY e."productId"
      ORDER BY COUNT(*) DESC
      LIMIT 25
    `;

    // --- 3. Checkout counts per product (distinct sessions) for the top 25 ---
    const productIds = productCartRows.map((r) => r.productId);
    let checkoutRows: ProductCheckoutRow[] = [];
    if (productIds.length > 0) {
      checkoutRows = await prisma.$queryRaw<ProductCheckoutRow[]>`
        SELECT
          e."productId"                                  AS "productId",
          COUNT(DISTINCT e."sessionId")::bigint          AS checkouts
        FROM "CartEvent" e
        INNER JOIN "CartSession" s ON s.id = e."sessionId"
        WHERE s."shopId" = ${shop.id}
          AND s."createdAt" >= ${cutoff}
          AND (
            s."isSuspectedBot" = false
            OR s."orderPlaced" = true
            OR s."customerEmail" IS NOT NULL
            OR s."customerName" IS NOT NULL
          )
          AND e."eventType" = 'checkout_item'
          AND e."productId" IN (${Prisma.join(productIds)})
        GROUP BY e."productId"
      `;
    }
    const checkoutByProduct = new Map<string, number>(
      checkoutRows.map((r) => [r.productId, Number(r.checkouts)])
    );

    const topProducts: ReportsTopProduct[] = productCartRows.map((row) => {
      const cartAdds = Number(row.cartAdds);
      const conversions = Number(row.conversions);
      return {
        productId: row.productId,
        productTitle: row.productTitle || "Unknown",
        cartAdds,
        checkouts: checkoutByProduct.get(row.productId) ?? 0,
        conversions,
        conversionRate: cartAdds > 0 ? (conversions / cartAdds) * 100 : 0,
      };
    });

    // --- 4. Top referrers ---
    const referrerRows = await prisma.$queryRaw<ReferrerRow[]>`
      SELECT
        COALESCE("referrerUrl", 'Direct')                                         AS referrer,
        COUNT(*)::bigint                                                          AS sessions,
        (COUNT(*) FILTER (WHERE "cartCreated" = true))::bigint                    AS "cartAdds",
        (COUNT(*) FILTER (WHERE "orderPlaced" = true))::bigint                    AS conversions
      FROM "CartSession"
      WHERE "shopId" = ${shop.id}
        AND "createdAt" >= ${cutoff}
        AND (
          "isSuspectedBot" = false
          OR "orderPlaced" = true
          OR "customerEmail" IS NOT NULL
          OR "customerName" IS NOT NULL
        )
      GROUP BY referrer
      ORDER BY COUNT(*) DESC
      LIMIT 10
    `;
    const topReferrers: ReportsTopReferrer[] = referrerRows.map((row) => {
      const cartAdds = Number(row.cartAdds);
      const conversions = Number(row.conversions);
      return {
        referrer: row.referrer,
        sessions: Number(row.sessions),
        cartAdds,
        conversionRate: cartAdds > 0 ? (conversions / cartAdds) * 100 : 0,
      };
    });

    const payload: ReportsData = {
      range,
      totalSessions,
      totalCarts,
      totalCheckouts,
      totalOrders,
      totalRevenue,
      avgCartValue,
      conversionRate: totalCarts > 0 ? (totalOrders / totalCarts) * 100 : 0,
      checkoutRate: totalCarts > 0 ? (totalCheckouts / totalCarts) * 100 : 0,
      checkoutToOrderRate: totalCheckouts > 0 ? (totalOrders / totalCheckouts) * 100 : 0,
      topProducts,
      topReferrers,
    };

    return data(payload);
  } catch (err) {
    // authenticate.admin throws Response for OAuth redirects — must rethrow
    if (err instanceof Response) throw err;
    console.error("[Reports API] Error:", err);
    return data({ error: "Internal server error" }, { status: 500 });
  }
};
