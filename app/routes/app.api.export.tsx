// CSV export endpoint

import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { generateCSV } from "../services/csv.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    const { session } = await authenticate.admin(request);
    
    if (!session?.shop) {
      return new Response("Unauthorized", { status: 401 });
    }

    const shopifyDomain = session.shop;
    const url = new URL(request.url);
    const startDate = url.searchParams.get("startDate");
    const endDate = url.searchParams.get("endDate");
    const columns = url.searchParams.get("columns")?.split(",") || [];

    // Find Shop record
    const shop = await prisma.shop.findUnique({
      where: { shopifyDomain },
    });

    if (!shop) {
      return new Response("Shop not found", { status: 404 });
    }

    // Build query filters
    const where: any = { shopId: shop.id };
    
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) {
        where.createdAt.gte = new Date(startDate);
      }
      if (endDate) {
        where.createdAt.lte = new Date(endDate);
      }
    }

    // Fetch sessions
    const sessions = await prisma.cartSession.findMany({
      where,
      include: {
        events: {
          orderBy: { timestamp: "asc" },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    // Generate CSV
    const csv = generateCSV(sessions, columns.length > 0 ? columns : [
      "visitorId",
      "customerName",
      "customerEmail",
      "city",
      "country",
      "deviceType",
      "cartTotal",
      "itemCount",
      "cartCreated",
      "checkoutStarted",
      "orderPlaced",
      "createdAt",
    ]);

    // Return as downloadable file
    const filename = `cartlens-export-${new Date().toISOString().split("T")[0]}.csv`;

    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error("[Export] Error:", error);
    return new Response("Internal server error", { status: 500 });
  }
};
