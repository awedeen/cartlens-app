// CartLens Web Pixel Extension
// Tracks customer cart activity and sends events to the app backend

import { register } from "@shopify/web-pixels-extension";

register(({ analytics, browser, settings, init }) => {
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

  // In-memory UTM store — populated on first page_viewed event from URL params
  // Persists for the lifetime of this pixel sandbox instance (single page load)
  // For cross-page persistence we encode UTMs into the visitor cookie value
  const utmStore: {
    utmSource: string | null;
    utmMedium: string | null;
    utmCampaign: string | null;
    utmContent: string | null;
    utmId: string | null;
    landingPage: string | null;
  } = {
    utmSource: null, utmMedium: null, utmCampaign: null,
    utmContent: null, utmId: null, landingPage: null,
  };

  // Parse UTMs from a URL string and store in memory (first call wins)
  const captureUtmsFromUrl = (urlOrSearch: string) => {
    if (!urlOrSearch) return;
    try {
      let search = urlOrSearch;
      if (urlOrSearch.includes("://") || urlOrSearch.startsWith("/")) {
        const u = urlOrSearch.startsWith("http") ? new URL(urlOrSearch) : new URL(urlOrSearch, "https://x.invalid");
        search = u.search;
        if (!utmStore.landingPage) utmStore.landingPage = urlOrSearch.startsWith("http") ? urlOrSearch : u.toString();
      }
      if (!search) return;
      const params = new URLSearchParams(search);
      const src = params.get("utm_source");
      if (src && !utmStore.utmSource) {
        utmStore.utmSource = src;
        utmStore.utmMedium = params.get("utm_medium");
        utmStore.utmCampaign = params.get("utm_campaign");
        utmStore.utmContent = params.get("utm_content");
        utmStore.utmId = params.get("utm_id") || params.get("fbclid");
      }
    } catch { /* ignore parse errors */ }
  };

  // Parse UTM cookie value — format: "src|med|cam|con|uid|landingPage"
  const parseUtmCookie = (val: string) => {
    const parts = val.split("|");
    if (parts[0]) utmStore.utmSource = parts[0] || null;
    if (parts[1]) utmStore.utmMedium = parts[1] || null;
    if (parts[2]) utmStore.utmCampaign = parts[2] || null;
    if (parts[3]) utmStore.utmContent = parts[3] || null;
    if (parts[4]) utmStore.utmId = parts[4] || null;
    if (parts[5]) utmStore.landingPage = decodeURIComponent(parts[5] || "");
  };

  const encodeUtmCookie = () =>
    [
      utmStore.utmSource || "",
      utmStore.utmMedium || "",
      utmStore.utmCampaign || "",
      utmStore.utmContent || "",
      utmStore.utmId || "",
      encodeURIComponent(utmStore.landingPage || ""),
    ].join("|");

  // Generate a random visitor ID
  const generateVisitorId = () => `v_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;

  // Visitor ID — resolved async from cookie, falls back to generated
  let resolvedVisitorId: string | null = null;

  const getOrCreateVisitorId = async (): Promise<string> => {
    if (resolvedVisitorId) return resolvedVisitorId;
    try {
      const existing = await browser.cookie.get("cl_vid");
      if (existing && typeof existing === "string" && existing.startsWith("v_")) {
        resolvedVisitorId = existing;
        return resolvedVisitorId;
      }
    } catch {}
    resolvedVisitorId = generateVisitorId();
    try { await browser.cookie.set("cl_vid", resolvedVisitorId); } catch {}
    return resolvedVisitorId;
  };

  // Load UTMs from cookie on first run (cross-page persistence)
  const loadUtmCookie = async () => {
    if (utmStore.utmSource) return; // already populated from URL
    try {
      const val = await browser.cookie.get("cl_utm");
      if (val && typeof val === "string") parseUtmCookie(val);
    } catch {}
  };

  // Save UTMs to cookie after capturing from URL
  const saveUtmCookie = async () => {
    if (!utmStore.utmSource) return;
    try { await browser.cookie.set("cl_utm", encodeUtmCookie()); } catch {}
  };

  // Helper to send events to backend
  const sendEvent = async (eventType: string, data: any = {}) => {
    const visitorId = await getOrCreateVisitorId();
    await loadUtmCookie();

    // Get device type from user agent (safe null check — userAgent may not be typed but is available at runtime)
    const ua = (typeof (browser as any).userAgent === "string" ? (browser as any).userAgent : "") || "";
    const deviceType = ua.match(/mobile/i) ? "mobile" : ua.match(/tablet/i) ? "tablet" : "desktop";

    const payload = {
      shopDomain,
      eventType,
      visitorId,
      timestamp: new Date().toISOString(),
      deviceType,
      userAgent: ua || undefined,
      utmSource: utmStore.utmSource,
      utmMedium: utmStore.utmMedium,
      utmCampaign: utmStore.utmCampaign,
      utmContent: utmStore.utmContent,
      utmId: utmStore.utmId,
      landingPage: utmStore.landingPage,
      ...customerData,
      ...data,
    };

    if (!apiEndpoint) return;

    try {
      await fetch(apiEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (error: any) {
      console.error("[CartLens] fetch failed:", error?.message || error);
    }
  };

  // Subscribe to product_added_to_cart
  analytics.subscribe("product_added_to_cart", async (event) => {
    const cartLine = event.data?.cartLine;
    const href = event.context?.window?.location?.href || event.context?.document?.location?.href || "";
    captureUtmsFromUrl(href);
    await saveUtmCookie();

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

  // Subscribe to page_viewed — captures UTMs and landing page
  analytics.subscribe("page_viewed", async (event) => {
    const context = event.context;
    const href = context?.document?.location?.href;
    const pageHref = context?.window?.location?.href || href || "";
    const referrer = context?.document?.referrer || null;

    captureUtmsFromUrl(pageHref);
    if (!utmStore.landingPage && pageHref) utmStore.landingPage = pageHref;
    await saveUtmCookie();

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
      customerId: (checkout as any)?.customer?.id,
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
      customerId: (checkout as any)?.customer?.id,
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
