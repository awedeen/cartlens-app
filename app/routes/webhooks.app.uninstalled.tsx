import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const { shop, topic } = await authenticate.webhook(request);

    console.log(`Received ${topic} webhook for ${shop}`);

    // Always delete all OAuth sessions for the shop — idempotent, no session guard.
    // authenticate.webhook doesn't always return a session object (HMAC-only auth),
    // so the previous `if (session)` guard could silently skip cleanup.
    await db.session.deleteMany({ where: { shop } });

    // Delete all shop data — CartSessions and CartEvents cascade automatically
    // via the Shop → CartSession → CartEvent FK cascade chain.
    await db.shop.deleteMany({ where: { shopifyDomain: shop } });

    return new Response();
  } catch (error) {
    if (error instanceof Response) throw error;
    console.error("[Uninstall Webhook] Error:", error);
    return new Response(null, { status: 500 });
  }
};
