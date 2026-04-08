// CartLens Web Pixel Extension
// Tracks customer cart activity and sends events to the app backend

import { register } from "@shopify/web-pixels-extension";

register(({ analytics, browser, settings, init }) => {
  // Generate or retrieve visitor ID
  const getVisitorId = (): string => {
    let visitorId = browser.cookie.get("cartlens_visitor_id");
    if (!visitorId) {
      visitorId = `v_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
      browser.cookie.set("cartlens_visitor_id", visitorId);
    }
    return visitorId;
  };

  // Capture customer data from init context (available when customer is logged in)
  const customer = init.data?.customer;
  const customerData = customer ? {
    customerId: customer.id?.toString(),
    customerEmail: customer.email,
    customerName: [customer.firstName, customer.lastName].filter(Boolean).join(" ") || null,
  } : {};

  // The app URL comes from pixel settings (set during webPixelCreate)
  const appUrl = settings.app_url;
  const apiEndpoint = appUrl ? `${appUrl}/api/public/events` : null;
  const shopDomain = init.data?.shop?.myshopifyDomain || "";

  if (!apiEndpoint) {
    console.error("[CartLens Pixel] No app_url configured — events will not be sent");
  }

  // Helper to send events to backend
  const sendEvent = async (eventType: string, data: any = {}) => {
    const visitorId = getVisitorId();

    // Get device/browser info
    const deviceType = browser.userAgent.match(/mobile/i) ? "mobile" :
                       browser.userAgent.match(/tablet/i) ? "tablet" : "desktop";

    const payload = {
      shopDomain,
      eventType,
      visitorId,
      timestamp: new Date().toISOString(),
      deviceType,
      userAgent: browser.userAgent,
      ...customerData,
      ...data,
    };

    if (!apiEndpoint) return;

    try {
      await fetch(apiEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
    } catch (error) {
      // Silently fail — pixel events are best-effort
    }
  };

  // Subscribe to product_added_to_cart
  analytics.subscribe("product_added_to_cart", (event) => {
    const cartLine = event.data?.cartLine;

    sendEvent("cart_add", {
      product: {
        id: cartLine?.merchandise?.product?.id,
        title: cartLine?.merchandise?.product?.title,
      },
      variant: {
        id: cartLine?.merchandise?.id,
        title: cartLine?.merchandise?.title,
        image: cartLine?.merchandise?.image?.src,
      },
      quantity: cartLine?.quantity,
      price: cartLine?.merchandise?.price?.amount,
    });
  });

  // Subscribe to product_removed_from_cart
  analytics.subscribe("product_removed_from_cart", (event) => {
    const cartLine = event.data?.cartLine;

    sendEvent("cart_remove", {
      product: {
        id: cartLine?.merchandise?.product?.id,
        title: cartLine?.merchandise?.product?.title,
      },
      variant: {
        id: cartLine?.merchandise?.id,
        title: cartLine?.merchandise?.title,
      },
      quantity: cartLine?.quantity,
      price: cartLine?.merchandise?.price?.amount,
    });
  });

  // Subscribe to page_viewed — used for checkout abandonment detection
  analytics.subscribe("page_viewed", (event) => {
    const context = event.context;

    sendEvent("page_view", {
      pageUrl: context?.document?.location?.href,
      pageTitle: context?.document?.title,
      referrerUrl: context?.document?.referrer,
      landingPage: browser.sessionStorage.get("cartlens_landing_page") || context?.document?.location?.href,
      utmSource: context?.document?.location?.search?.includes("utm_source")
        ? new URLSearchParams(context?.document?.location?.search).get("utm_source")
        : null,
      utmMedium: context?.document?.location?.search?.includes("utm_medium")
        ? new URLSearchParams(context?.document?.location?.search).get("utm_medium")
        : null,
      utmCampaign: context?.document?.location?.search?.includes("utm_campaign")
        ? new URLSearchParams(context?.document?.location?.search).get("utm_campaign")
        : null,
    });

    // Store landing page in session
    if (!browser.sessionStorage.get("cartlens_landing_page")) {
      browser.sessionStorage.set("cartlens_landing_page", context?.document?.location?.href || "");
    }
  });

  // Subscribe to checkout_started
  analytics.subscribe("checkout_started", (event) => {
    const checkout = event.data?.checkout;

    sendEvent("checkout_started", {
      customerId: checkout?.customer?.id,
      customerEmail: checkout?.email,
      billingCity: checkout?.billingAddress?.city || null,
      billingCountry: checkout?.billingAddress?.country || null,
      billingCountryCode: checkout?.billingAddress?.countryCode || null,
    });
  });

  // Subscribe to checkout_completed
  analytics.subscribe("checkout_completed", (event) => {
    const checkout = event.data?.checkout;

    sendEvent("checkout_completed", {
      orderId: checkout?.order?.id,
      customerId: checkout?.customer?.id,
      customerEmail: checkout?.email,
      customerName: checkout?.billingAddress?.firstName && checkout?.billingAddress?.lastName
        ? `${checkout.billingAddress.firstName} ${checkout.billingAddress.lastName}`
        : null,
      billingCity: checkout?.billingAddress?.city || null,
      billingCountry: checkout?.billingAddress?.country || null,
      billingCountryCode: checkout?.billingAddress?.countryCode || null,
    });
  });
});
