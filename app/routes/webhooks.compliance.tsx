import { authenticate } from "../shopify.server";
import { ActionFunctionArgs, data } from "react-router";
import prisma from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, payload, shop } = await authenticate.webhook(request);

  console.log(`[Compliance Webhook] ${topic} for shop: ${shop}`);

  switch (topic) {
    case "CUSTOMERS_DATA_REQUEST": {
      // Shopify requests all data we store about a specific customer.
      // We must respond with the data or confirm we don't store PII directly.
      const customerId = payload.customer?.id?.toString();
      const customerEmail = payload.customer?.email;

      // Look up shop record by domain to get the internal cuid
      const shopRecord = await prisma.shop.findFirst({ where: { shopifyDomain: shop } });
      if (!shopRecord) {
        console.log(`[Compliance] data_request: no shop record found for ${shop}`);
        return data({ customer_data: [] }, { status: 200 });
      }

      const sessions = await prisma.cartSession.findMany({
        where: {
          shopId: shopRecord.id,
          OR: [
            customerId ? { customerId } : {},
            customerEmail ? { customerEmail } : {},
          ].filter(o => Object.keys(o).length > 0),
        },
        select: {
          id: true,
          visitorId: true,
          customerName: true,
          customerEmail: true,
          customerId: true,
          cartTotal: true,
          itemCount: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      console.log(`[Compliance] data_request: found ${sessions.length} sessions for customer ${customerId || customerEmail}`);
      // Response is informational — Shopify doesn't read the body, just expects 200
      return data({ customer_data: sessions }, { status: 200 });
    }

    case "CUSTOMERS_REDACT": {
      // Shopify requests deletion of all data for a specific customer.
      const customerId = payload.customer?.id?.toString();
      const customerEmail = payload.customer?.email;

      // Look up shop record by domain to get the internal cuid
      const shopRecord = await prisma.shop.findFirst({ where: { shopifyDomain: shop } });
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
        await prisma.cartEvent.deleteMany({ where: { sessionId: { in: ids } } });
        await prisma.cartSession.deleteMany({ where: { id: { in: ids } } });
        console.log(`[Compliance] customers_redact: deleted ${ids.length} sessions for customer ${customerId || customerEmail}`);
      } else {
        console.log(`[Compliance] customers_redact: no data found for customer ${customerId || customerEmail}`);
      }

      return data({ deleted: ids.length }, { status: 200 });
    }

    case "SHOP_REDACT": {
      // Merchant uninstalled — delete all their data (48h after uninstall).
      // CartSession, ShopSettings, CartEvent, AggregatedStats all cascade on Shop delete.
      const shopRecord = await prisma.shop.findFirst({ where: { shopifyDomain: shop } });

      if (shopRecord) {
        await prisma.shop.delete({ where: { id: shopRecord.id } });
        console.log(`[Compliance] shop_redact: deleted all data for shop ${shop}`);
      } else {
        console.log(`[Compliance] shop_redact: no data found for shop ${shop}`);
      }

      return data({ success: true }, { status: 200 });
    }

    default:
      console.log(`[Compliance] Unknown topic: ${topic}`);
      return data({ success: true }, { status: 200 });
  }
};
