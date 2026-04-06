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

  // Capture UTMs + referrer + landing page immediately on pixel load
  // This ensures we don't miss UTMs if cart_add fires before page_view
  const currentUrl = init.data?.shop?.url || "";
  const currentSearch = (() => {
    try { return new URL(currentUrl).search; } catch { return ""; }
  })();
  const currentParams = new URLSearchParams(currentSearch);

  const initialUtmSource = currentParams.get("utm_source") || null;
  const initialUtmMedium = currentParams.get("utm_medium") || null;
  const initialUtmCampaign = currentParams.get("utm_campaign") || null;
  const initialUtmContent = currentParams.get("utm_content") || null;
  const initialUtmId = currentParams.get("utm_id") || currentParams.get("fbclid") || null;

  // Persist landing page + UTMs in sessionStorage on first visit
  if (!browser.sessionStorage.get("cartlens_landing_page") && currentUrl) {
    browser.sessionStorage.set("cartlens_landing_page", currentUrl);
  }
  if (!browser.sessionStorage.get("cartlens_utm_source") && initialUtmSource) {
    browser.sessionStorage.set("cartlens_utm_source", initialUtmSource);
    if (initialUtmMedium) browser.sessionStorage.set("cartlens_utm_medium", initialUtmMedium);
    if (initialUtmCampaign) browser.sessionStorage.set("cartlens_utm_campaign", initialUtmCampaign);
    if (initialUtmContent) browser.sessionStorage.set("cartlens_utm_content", initialUtmContent);
    if (initialUtmId) browser.sessionStorage.set("cartlens_utm_id", initialUtmId);
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
      // Always include UTMs + landing page from session (captured at pixel load)
      utmSource: browser.sessionStorage.get("cartlens_utm_source") || null,
      utmMedium: browser.sessionStorage.get("cartlens_utm_medium") || null,
      utmCampaign: browser.sessionStorage.get("cartlens_utm_campaign") || null,
      utmContent: browser.sessionStorage.get("cartlens_utm_content") || null,
      utmId: browser.sessionStorage.get("cartlens_utm_id") || null,
      landingPage: browser.sessionStorage.get("cartlens_landing_page") || null,
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
    const href = context?.document?.location?.href;
    const referrer = context?.document?.referrer || null;

    // Update landing page if not already set (first page in session)
    if (!browser.sessionStorage.get("cartlens_landing_page") && href) {
      browser.sessionStorage.set("cartlens_landing_page", href);
    }

    // Capture UTMs from current URL if not already captured at load time
    const search = context?.document?.location?.search || "";
    if (search && !browser.sessionStorage.get("cartlens_utm_source")) {
      const params = new URLSearchParams(search);
      const src = params.get("utm_source");
      if (src) {
        browser.sessionStorage.set("cartlens_utm_source", src);
        const med = params.get("utm_medium"); if (med) browser.sessionStorage.set("cartlens_utm_medium", med);
        const cam = params.get("utm_campaign"); if (cam) browser.sessionStorage.set("cartlens_utm_campaign", cam);
        const con = params.get("utm_content"); if (con) browser.sessionStorage.set("cartlens_utm_content", con);
        const uid = params.get("utm_id") || params.get("fbclid"); if (uid) browser.sessionStorage.set("cartlens_utm_id", uid);
      }
    }

    sendEvent("page_view", {
      pageUrl: href,
      pageTitle: context?.document?.title,
      referrerUrl: referrer,
    });
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
