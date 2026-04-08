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

  // UTM helpers using browser.localStorage for cross-page persistence
  // localStorage survives page navigation (unlike in-memory which dies on redirect-to-cart)
  // Keys are prefixed with cl_ to avoid collisions
  const ls = browser.localStorage;
  const lsGet = (key: string): string | null => { try { return ls.getItem(`cl_${key}`); } catch { return null; } };
  const lsSet = (key: string, val: string) => { try { ls.setItem(`cl_${key}`, val); } catch {} };
  const lsHas = (key: string): boolean => lsGet(key) !== null;

  // Capture UTMs from a URL and persist to localStorage (first call per session wins)
  const captureUtmsFromUrl = (urlOrSearch: string) => {
    if (!urlOrSearch || lsHas("utmSource")) return;
    try {
      let search = urlOrSearch;
      if (urlOrSearch.includes("://") || urlOrSearch.startsWith("/")) {
        const u = urlOrSearch.startsWith("http") ? new URL(urlOrSearch) : new URL(urlOrSearch, "https://x.invalid");
        search = u.search;
        if (!lsHas("landingPage")) lsSet("landingPage", urlOrSearch.startsWith("http") ? urlOrSearch : u.toString());
      }
      if (!search) return;
      const params = new URLSearchParams(search);
      const src = params.get("utm_source");
      if (src) {
        lsSet("utmSource", src);
        const med = params.get("utm_medium"); if (med) lsSet("utmMedium", med);
        const cam = params.get("utm_campaign"); if (cam) lsSet("utmCampaign", cam);
        const con = params.get("utm_content"); if (con) lsSet("utmContent", con);
        const uid = params.get("utm_id") || params.get("fbclid"); if (uid) lsSet("utmId", uid);
      }
    } catch { /* ignore parse errors */ }
  };

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
      // Include UTMs + landing page from localStorage (persists across page navigations)
      utmSource: lsGet("utmSource"),
      utmMedium: lsGet("utmMedium"),
      utmCampaign: lsGet("utmCampaign"),
      utmContent: lsGet("utmContent"),
      utmId: lsGet("utmId"),
      landingPage: lsGet("landingPage"),
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
    } catch (error: any) {
      // Log fetch failures so we can debug via Pixel Helper console
      console.error("[CartLens] fetch failed:", error?.message || error);
    }
  };

  // Subscribe to product_added_to_cart
  analytics.subscribe("product_added_to_cart", (event) => {
    const cartLine = event.data?.cartLine;
    // Capture UTMs — try all available URL sources (window.location is the correct pixel API path)
    const href = event.context?.window?.location?.href
      || event.context?.document?.location?.href
      || (init as any)?.context?.window?.location?.href
      || "";
    captureUtmsFromUrl(href);
    if (!lsHas("landingPage") && href) lsSet("landingPage", href);

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

    // Capture UTMs from current page URL (window.location is the correct pixel API path)
    const pageHref = context?.window?.location?.href || context?.document?.location?.href || href || "";
    captureUtmsFromUrl(pageHref);

    // Store landing page if not already set
    if (!lsHas("landingPage") && pageHref) lsSet("landingPage", pageHref);

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
