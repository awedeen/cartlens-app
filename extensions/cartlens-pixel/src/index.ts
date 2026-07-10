// CartLens Web Pixel Extension
// Tracks customer cart activity and sends events to the app backend
//
// Strict sandbox constraints:
//   - browser.userAgent is undefined (must cast to any + guard)
//   - browser.cookie.get/set are async (return Promises)
//   - browser.sessionStorage is unavailable
//   - window.location.href returns the sandbox iframe URL, not the storefront URL
//   - The pixel reloads on every page navigation (in-memory state is lost)
//
// Strategy: single async init promise resolves visitor ID + UTM cookie before
// any event handler builds a payload. All handlers await this gate.

import { register } from "@shopify/web-pixels-extension";

register(({ analytics, browser, settings, init }) => {
  const appUrl = settings.app_url;
  const apiEndpoint = appUrl ? `${appUrl}/api/public/events` : null;
  const shopDomain = init.data?.shop?.myshopifyDomain || "";

  if (!apiEndpoint) {
    console.error("[CartLens] No app_url configured");
  }

  // Customer data from init context (logged-in customers only)
  const customer = init.data?.customer;
  const customerData = customer
    ? {
        customerId: customer.id?.toString(),
        customerEmail: customer.email,
        customerName:
          [customer.firstName, customer.lastName].filter(Boolean).join(" ") ||
          null,
      }
    : {};

  // User agent — `browser.userAgent` is undefined in the strict sandbox, but the
  // per-event `event.context.navigator.userAgent` IS populated. So we read it off
  // each event (see uaFromEvent) rather than a single module-level value.
  function detectDevice(ua: string): "mobile" | "tablet" | "desktop" {
    if (/tablet|ipad/i.test(ua)) return "tablet";
    if (/mobile/i.test(ua)) return "mobile";
    return "desktop";
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function uaFromEvent(event: any): string {
    const u = event?.context?.navigator?.userAgent;
    return typeof u === "string" ? u : "";
  }

  // --- Cookie helpers (all async) ---

  // Cookie format for UTMs: "source|medium|campaign|content|id|landingPage"
  // Pipe-delimited with URI-encoded landing page (may contain pipes)
  interface UtmData {
    utmSource: string | null;
    utmMedium: string | null;
    utmCampaign: string | null;
    utmContent: string | null;
    utmId: string | null;
    landingPage: string | null;
    referrerUrl: string | null;
  }

  const emptyUtm: UtmData = {
    utmSource: null,
    utmMedium: null,
    utmCampaign: null,
    utmContent: null,
    utmId: null,
    landingPage: null,
    referrerUrl: null,
  };

  function parseUtmCookie(val: string): UtmData {
    const p = val.split("|");
    return {
      utmSource: p[0] || null,
      utmMedium: p[1] || null,
      utmCampaign: p[2] || null,
      utmContent: p[3] || null,
      utmId: p[4] || null,
      landingPage: p[5] ? decodeURIComponent(p[5]) : null,
      referrerUrl: p[6] ? decodeURIComponent(p[6]) : null,
    };
  }

  function encodeUtmCookie(d: UtmData): string {
    return [
      d.utmSource || "",
      d.utmMedium || "",
      d.utmCampaign || "",
      d.utmContent || "",
      d.utmId || "",
      encodeURIComponent(d.landingPage || ""),
      encodeURIComponent(d.referrerUrl || ""),
    ].join("|");
  }

  function parseUtmsFromUrl(href: string): Partial<UtmData> {
    try {
      const url = new URL(href);
      const params = url.searchParams;
      const src = params.get("utm_source");
      if (!src) return {};
      return {
        utmSource: src,
        utmMedium: params.get("utm_medium"),
        utmCampaign: params.get("utm_campaign"),
        utmContent: params.get("utm_content"),
        utmId: params.get("utm_id") || params.get("fbclid") || params.get("gclid"),
      };
    } catch {
      return {};
    }
  }

  // --- Single initialization promise ---
  // Resolves visitor ID and loads UTM cookie ONCE before any handler fires.
  // All event handlers await this before building payloads.

  const initPromise: Promise<{ visitorId: string; utm: UtmData }> =
    (async () => {
      // Resolve visitor ID
      let visitorId: string | null = null;
      try {
        const existing = await browser.cookie.get("cl_vid");
        if (existing && typeof existing === "string" && existing.startsWith("v_")) {
          visitorId = existing;
        }
      } catch {}

      if (!visitorId) {
        visitorId = `v_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
        try {
          await browser.cookie.set("cl_vid", visitorId);
        } catch {}
      }

      // Load UTM cookie (persisted from previous page)
      let utm: UtmData = { ...emptyUtm };
      try {
        const val = await browser.cookie.get("cl_utm");
        if (val && typeof val === "string" && val.includes("|")) {
          utm = parseUtmCookie(val);
        }
      } catch {}

      return { visitorId, utm };
    })();

  // --- Send event helper ---

  async function sendEvent(
    eventType: string,
    data: Record<string, any> = {},
    ctxUa = "",
  ) {
    if (!apiEndpoint) return;

    const { visitorId, utm } = await initPromise;

    const payload = {
      shopDomain,
      eventType,
      visitorId,
      timestamp: new Date().toISOString(),
      deviceType: ctxUa ? detectDevice(ctxUa) : "desktop",
      userAgent: ctxUa || undefined,
      // UTM data from cookie (persisted across pages)
      utmSource: utm.utmSource,
      utmMedium: utm.utmMedium,
      utmCampaign: utm.utmCampaign,
      utmContent: utm.utmContent,
      utmId: utm.utmId,
      landingPage: utm.landingPage,
      referrerUrl: utm.referrerUrl,
      ...customerData,
      ...data,
    };

    try {
      await fetch(apiEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch {
      // Best-effort — pixel events are non-critical
    }
  }

  // --- Event: page_viewed ---
  // This is the first event on every page load. Captures UTMs from URL if
  // present and persists them to cookie for subsequent pages/events.

  analytics.subscribe("page_viewed", async (event) => {
    const ctx = event.context;
    const href = ctx?.document?.location?.href || "";
    const referrer = ctx?.document?.referrer || null;

    // Wait for init to complete (visitor ID + cookie loaded)
    const { utm } = await initPromise;

    // If this page has UTMs in the URL and we don't already have UTMs from
    // a previous page, capture them and persist to cookie
    const urlUtms = parseUtmsFromUrl(href);
    if (urlUtms.utmSource && !utm.utmSource) {
      utm.utmSource = urlUtms.utmSource;
      utm.utmMedium = urlUtms.utmMedium || null;
      utm.utmCampaign = urlUtms.utmCampaign || null;
      utm.utmContent = urlUtms.utmContent || null;
      utm.utmId = urlUtms.utmId || null;
    }

    // Landing page: first page the visitor sees (first-wins)
    if (!utm.landingPage && href) {
      utm.landingPage = href;
    }

    // Referrer: capture once
    if (!utm.referrerUrl && referrer) {
      utm.referrerUrl = referrer;
    }

    // Persist updated UTM data to cookie for the next page load
    try {
      await browser.cookie.set("cl_utm", encodeUtmCookie(utm));
    } catch {}

    // Now send the event — utm object is fully populated
    await sendEvent("page_view", {
      pageUrl: href,
      pageTitle: ctx?.document?.title,
    }, uaFromEvent(event));
  });

  // --- Event: product_added_to_cart ---

  analytics.subscribe("product_added_to_cart", async (event) => {
    const cartLine = event.data?.cartLine;

    // Check if this page's URL has UTMs (in case page_viewed hasn't fired yet)
    const href = event.context?.document?.location?.href || "";
    const { utm } = await initPromise;
    const urlUtms = parseUtmsFromUrl(href);
    if (urlUtms.utmSource && !utm.utmSource) {
      utm.utmSource = urlUtms.utmSource;
      utm.utmMedium = urlUtms.utmMedium || null;
      utm.utmCampaign = urlUtms.utmCampaign || null;
      utm.utmContent = urlUtms.utmContent || null;
      utm.utmId = urlUtms.utmId || null;
      try {
        await browser.cookie.set("cl_utm", encodeUtmCookie(utm));
      } catch {}
    }

    await sendEvent("cart_add", {
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
    }, uaFromEvent(event));
  });

  // --- Event: product_removed_from_cart ---

  analytics.subscribe("product_removed_from_cart", async (event) => {
    const cartLine = event.data?.cartLine;
    await sendEvent("cart_remove", {
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
    }, uaFromEvent(event));
  });

  // --- Event: checkout_started ---

  analytics.subscribe("checkout_started", async (event) => {
    const checkout = event.data?.checkout;
    await sendEvent("checkout_started", {
      customerId: (checkout as any)?.customer?.id,
      customerEmail: checkout?.email,
      billingCity: checkout?.billingAddress?.city || null,
      billingCountry: checkout?.billingAddress?.country || null,
      billingCountryCode: checkout?.billingAddress?.countryCode || null,
    }, uaFromEvent(event));
  });

  // --- Event: checkout_completed ---

  analytics.subscribe("checkout_completed", async (event) => {
    const checkout = event.data?.checkout;
    await sendEvent("checkout_completed", {
      orderId: checkout?.order?.id,
      customerId: (checkout as any)?.customer?.id,
      customerEmail: checkout?.email,
      customerName:
        checkout?.billingAddress?.firstName && checkout?.billingAddress?.lastName
          ? `${checkout.billingAddress.firstName} ${checkout.billingAddress.lastName}`
          : null,
      billingCity: checkout?.billingAddress?.city || null,
      billingCountry: checkout?.billingAddress?.country || null,
      billingCountryCode: checkout?.billingAddress?.countryCode || null,
    }, uaFromEvent(event));
  });
});
