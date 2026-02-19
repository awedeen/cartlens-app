import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // Delete OAuth sessions (idempotent — webhook may fire multiple times)
  if (session) {
    await db.session.deleteMany({ where: { shop } });
  }

  // Delete all shop data — CartSessions and CartEvents cascade automatically
  // via the Shop → CartSession → CartEvent FK cascade chain.
  await db.shop.deleteMany({ where: { shopifyDomain: shop } });

  return new Response();
};
