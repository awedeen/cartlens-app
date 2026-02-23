import { authenticate } from "../shopify.server";
import { ActionFunctionArgs, data } from "react-router";
import prisma from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
  const { topic, payload, shop } = await authenticate.webhook(request);

  console.log(`[Compliance Webhook] ${topic} for shop: ${shop}`);

  switch (topic) {
    case "CUSTOMERS_DATA_REQUEST": {
      // Shopify requests all data we store about a specific customer.
      // We must respond with the data or confirm we don't store PII directly.
      const customerId = payload.customer?.id?.toString();
      const customerEmail = payload.customer?.email;

      // Look up shop record by domain to get the internal cuid
      const shopRecord = await prisma.shop.findUnique({ where: { shopifyDomain: shop } });
      if (!shopRecord) {
        console.log(`[Compliance] data_request: no shop record found for ${shop}`);
        return data({ customer_data: [] }, { status: 200 });
      }

      // Only select id — we just need the count for logging; Shopify ignores the response body
      const sessions = await prisma.cartSession.findMany({
        where: {
          shopId: shopRecord.id,
          OR: [
            customerId ? { customerId } : {},
            customerEmail ? { customerEmail } : {},
          ].filter(o => Object.keys(o).length > 0),
        },
        select: { id: true },
      });

      console.log(`[Compliance] data_request: found ${sessions.length} session(s) for shop ${shop}`);
      // Shopify ignores the compliance webhook response body — just expects 200.
      // Do NOT return session data here; that's PII that would be logged by infrastructure.
      return data({ success: true }, { status: 200 });
    }

    case "CUSTOMERS_REDACT": {
      // Shopify requests deletion of all data for a specific customer.
      const customerId = payload.customer?.id?.toString();
      const customerEmail = payload.customer?.email;

      // Look up shop record by domain to get the internal cuid
      const shopRecord = await prisma.shop.findUnique({ where: { shopifyDomain: shop } });
      if (!shopRecord) {
        console.log(`[Compliance] customers_redact: no shop record found for ${shop}`);
        return data({ deleted: 0 }, { status: 200 });
      }

      const toDelete = await prisma.cartSession.findMany({
        where: {
          shopId: shopRecord.id,
          OR: [
            customerId ? { customerId } : {},
            customerEmail ? { customerEmail } : {},
          ].filter(o => Object.keys(o).length > 0),
        },
        select: { id: true },
      });

      const ids = toDelete.map(s => s.id);

      if (ids.length > 0) {
        // CartEvent rows cascade automatically on CartSession delete (onDelete: Cascade in schema)
        await prisma.cartSession.deleteMany({ where: { id: { in: ids } } });
        console.log(`[Compliance] customers_redact: deleted ${ids.length} session(s) for shop ${shop}`);
      } else {
        console.log(`[Compliance] customers_redact: no data found for shop ${shop}`);
      }

      return data({ deleted: ids.length }, { status: 200 });
    }

    case "SHOP_REDACT": {
      // Merchant uninstalled — delete all their data (48h after uninstall).
      // CartSession and CartEvent cascade on Shop delete via schema onDelete: Cascade.
      const shopRecord = await prisma.shop.findUnique({ where: { shopifyDomain: shop } });

      if (shopRecord) {
        await prisma.shop.delete({ where: { id: shopRecord.id } });
        console.log(`[Compliance] shop_redact: deleted all data for shop ${shop}`);
      } else {
        console.log(`[Compliance] shop_redact: no data found for shop ${shop}`);
      }

      return data({ success: true }, { status: 200 });
    }

    default:
      return data({ success: true }, { status: 200 });
  }
  } catch (error) {
    if (error instanceof Response) throw error;
    console.error("[Compliance Webhook] Error:", error);
    return data({ error: "Internal server error" }, { status: 500 });
  }
};
