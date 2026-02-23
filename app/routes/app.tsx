import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { authenticate, PLANS } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { billing } = await authenticate.admin(request);

  // Gate the app behind the Essential billing plan.
  // Merchants get a 14-day free trial; after that they must subscribe.
  // billing.require throws a redirect Response to Shopify's billing page
  // if no active subscription exists — boundary.error handles it cleanly.
  // isTest: true = no real charge (safe for dev/test stores and App Store review).
  // Set BILLING_LIVE_MODE=true in Railway env when ready for real production billing.
  const billingIsTest = process.env.BILLING_LIVE_MODE !== "true";

  await billing.require({
    plans: [PLANS.ESSENTIAL],
    isTest: billingIsTest,
    onFailure: async () =>
      billing.request({
        plan: PLANS.ESSENTIAL,
        isTest: billingIsTest,
        returnUrl: `${process.env.SHOPIFY_APP_URL || ""}/app`,
      }),
  });

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
