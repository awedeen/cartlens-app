import { useState, useEffect, useRef } from "react";
import { SaveBar } from "@shopify/app-bridge-react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useLoaderData, useFetcher, data } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import type { CartSession, CartEvent } from "@prisma/client";

type SessionWithEvents = CartSession & { events: CartEvent[] };

type SessionWithMeta = SessionWithEvents & { visitNumber?: number };

interface LoaderData {
  shopId: string;
  pixelInstalled: boolean;
  sessions: SessionWithMeta[];
  settings: {
    timezone: string;
    retentionDays: number;
    botFilterEnabled: boolean;
    highValueThreshold: number | null;
  };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  
  if (!session?.shop) {
    throw new Response("Unauthorized", { status: 401 });
  }

  const shopifyDomain = session.shop;

  // Find or create Shop record
  let shop = await prisma.shop.findUnique({
    where: { shopifyDomain },
  });

  if (!shop) {
    shop = await prisma.shop.create({
      data: { shopifyDomain },
    });
  }

  // Get recent sessions (last 100)
  const sessions = await prisma.cartSession.findMany({
    where: { shopId: shop.id },
    include: {
      events: {
        orderBy: { timestamp: "desc" },
      },
    },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });

  // Backfill missing product images
  const eventsNeedingImages = sessions
    .flatMap((s) => s.events)
    .filter((e) => e.productId && !e.variantImage);
  
  const uniqueProductIds = [...new Set(eventsNeedingImages.map((e) => e.productId!))];
  
  if (uniqueProductIds.length > 0 && uniqueProductIds.length <= 20) {
    try {
      const gids = uniqueProductIds.map((id) => `"gid://shopify/Product/${id}"`).join(", ");
      const imgResponse = await admin.graphql(`
        query {
          nodes(ids: [${gids}]) {
            ... on Product {
              id
              featuredImage {
                url(transform: { maxWidth: 100, maxHeight: 100 })
              }
            }
          }
        }
      `);
      const imgResult = await imgResponse.json();
      const imageMap = new Map<string, string>();
      for (const node of imgResult?.data?.nodes || []) {
        if (node?.id && node?.featuredImage?.url) {
          const numericId = node.id.replace("gid://shopify/Product/", "");
          imageMap.set(numericId, node.featuredImage.url);
        }
      }

      // Update DB in batches — one updateMany per unique image URL instead of one update per event
      const imageToEventIds = new Map<string, string[]>();
      for (const s of sessions) {
        for (const e of s.events) {
          if (e.productId && !e.variantImage && imageMap.has(e.productId)) {
            const url = imageMap.get(e.productId)!;
            e.variantImage = url; // update in-memory immediately
            if (!imageToEventIds.has(url)) imageToEventIds.set(url, []);
            imageToEventIds.get(url)!.push(e.id);
          }
        }
      }
      await Promise.all(
        Array.from(imageToEventIds.entries()).map(([url, ids]) =>
          prisma.cartEvent.updateMany({
            where: { id: { in: ids } },
            data: { variantImage: url },
          })
        )
      );
    } catch (imgErr) {
      console.error("[Loader] Failed to fetch product images:", imgErr);
    }
  }

  // Compute visit numbers for repeat visitors
  const visitCountMap = new Map<string, number>();
  const customerEmails = sessions.map(s => s.customerEmail).filter(Boolean) as string[];
  const customerIds = sessions.map(s => s.customerId).filter(Boolean) as string[];

  if (customerEmails.length > 0 || customerIds.length > 0) {
    const allCustomerSessions = await prisma.cartSession.findMany({
      where: {
        shopId: shop.id,
        OR: [
          ...(customerEmails.length > 0 ? [{ customerEmail: { in: customerEmails } }] : []),
          ...(customerIds.length > 0 ? [{ customerId: { in: customerIds } }] : []),
        ],
      },
      select: { id: true, customerEmail: true, customerId: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });

    // Group by customer identifier and assign visit numbers
    const customerVisits = new Map<string, string[]>();
    for (const cs of allCustomerSessions) {
      const key = cs.customerEmail || cs.customerId || "";
      if (!key) continue;
      if (!customerVisits.has(key)) customerVisits.set(key, []);
      customerVisits.get(key)!.push(cs.id);
    }
    for (const [, ids] of customerVisits) {
      ids.forEach((id, idx) => visitCountMap.set(id, idx + 1));
    }
  }

  const sessionsWithMeta: SessionWithMeta[] = sessions.map(s => ({
    ...s,
    visitNumber: visitCountMap.get(s.id) || 1,
  }));

  // Check if pixel is already installed
  let pixelInstalled = false;
  try {
    const pixelResponse = await admin.graphql(`
      query { webPixel { id settings } }
    `);
    const pixelResult = await pixelResponse.json();
    const existingPixel = pixelResult?.data?.webPixel;
    pixelInstalled = !!existingPixel?.id;

    // Auto-update pixel URL if tunnel changed
    if (existingPixel?.id) {
      const currentAppUrl = new URL(request.url).origin.replace("http://", "https://");
      let existingSettings: any = {};
      try { existingSettings = JSON.parse(existingPixel.settings || "{}"); } catch {}
      if (existingSettings.app_url !== currentAppUrl) {
        const newSettings = JSON.stringify({ ...existingSettings, app_url: currentAppUrl });
        await admin.graphql(`
          mutation updatePixel($id: ID!, $settings: JSON!) {
            webPixelUpdate(id: $id, webPixel: { settings: $settings }) {
              userErrors { field message }
            }
          }
        `, { variables: { id: existingPixel.id, settings: newSettings } });
      }
    }
  } catch (e) {
    console.error("[Pixel check/update error]", e);
  }

  return data<LoaderData>({
    shopId: shop.id,
    pixelInstalled,
    sessions: sessionsWithMeta,
    settings: {
      timezone: shop.timezone,
      retentionDays: shop.retentionDays,
      botFilterEnabled: shop.botFilterEnabled,
      highValueThreshold: shop.highValueThreshold,
    },
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  
  if (!session?.shop) {
    throw new Response("Unauthorized", { status: 401 });
  }

  const shopifyDomain = session.shop;
  const formData = await request.formData();
  const action = formData.get("action");

  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain },
  });

  if (!shop) {
    throw new Response("Shop not found", { status: 404 });
  }

  if (action === "installPixel") {
    try {
      // Get the current app URL from the request
      const appUrl = new URL(request.url).origin.replace("http://", "https://");
      const pixelSettings = JSON.stringify({ app_url: appUrl });
      
      // Delete existing pixel first (in case we're updating the URL)
      try {
        const existingPixel = await admin.graphql(`query { webPixel { id } }`);
        const existingResult = await existingPixel.json();
        if (existingResult?.data?.webPixel?.id) {
          await admin.graphql(`
            mutation deletePixel($id: ID!) {
              webPixelDelete(id: $id) { userErrors { field message } }
            }
          `, { variables: { id: existingResult.data.webPixel.id } });
        }
      } catch { /* no existing pixel */ }

      const response = await admin.graphql(`
        mutation createPixel($settings: JSON!) {
          webPixelCreate(webPixel: { settings: $settings }) {
            userErrors { field message }
            webPixel { id }
          }
        }
      `, { variables: { settings: pixelSettings } });
      const result = await response.json();
      const errors = result?.data?.webPixelCreate?.userErrors;
      if (errors && errors.length > 0) {
        return data({ success: false, error: errors[0].message });
      }
      return data({ success: true, pixelInstalled: true });
    } catch (e: any) {
      console.error("[Pixel Install Error]", e);
      return data({ success: false, error: e.message });
    }
  }

  if (action === "updateSettings") {
    try {
      const timezone = formData.get("timezone") as string;
      const botFilterEnabled = formData.get("botFilterEnabled") === "true";
      const rawThreshold = formData.get("highValueThreshold") as string;
      const highValueThreshold = rawThreshold && rawThreshold !== "" ? parseFloat(rawThreshold) : null;
      const rawRetention = formData.get("retentionDays") as string;
      const retentionDays = rawRetention ? Math.max(1, Math.min(365, parseInt(rawRetention, 10))) : 90;

      await prisma.shop.update({
        where: { id: shop.id },
        data: { timezone, botFilterEnabled, highValueThreshold, retentionDays },
      });

      return data({ success: true });
    } catch (e: any) {
      console.error("[Settings Update] Error:", e);
      return data({ success: false, error: "Failed to save settings. Please try again." });
    }
  }

  return data({ success: false });
};

export default function Index() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const settingsFetcher = useFetcher();
  const [activeTab, setActiveTab] = useState<"live" | "reports" | "settings">("live");
  const [sessions, setSessions] = useState<SessionWithMeta[]>(data.sessions);
  const [selectedSession, setSelectedSession] = useState<SessionWithMeta | null>(null);
  const selectedSessionRef = useRef<SessionWithMeta | null>(null);
  useEffect(() => { selectedSessionRef.current = selectedSession; }, [selectedSession]);
  const eventSourceRef = useRef<EventSource | null>(null);
  const [flashIds, setFlashIds] = useState<Set<string>>(new Set());
  const [mounted, setMounted] = useState(false);
  useEffect(() => { requestAnimationFrame(() => setMounted(true)); }, []);

  // Inject live dot keyframe animation
  useEffect(() => {
    const style = document.createElement("style");
    style.id = "cartlens-live-dot";
    style.textContent = `@keyframes livePulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.35;transform:scale(0.75)} } @keyframes clFade { from{opacity:0} to{opacity:1} }`;
    document.head.appendChild(style);
    return () => { document.head.removeChild(style); };
  }, []);

  // Detail panel animations
  const [detailMounted, setDetailMounted] = useState(false);
  useEffect(() => {
    if (selectedSession) {
      setDetailMounted(false);
      requestAnimationFrame(() => setDetailMounted(true));
    }
  }, [selectedSession?.id]);

  const triggerFlash = (id: string) => {
    setFlashIds(prev => new Set([...prev, id]));
    setTimeout(() => {
      setFlashIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, 700);
  };
  
  // Settings form state
  const [timezone, setTimezone] = useState<string>(data.settings.timezone);
  const [botFilterEnabled, setBotFilterEnabled] = useState<boolean>(data.settings.botFilterEnabled);
  const [highValueThreshold, setHighValueThreshold] = useState<string>(
    data.settings.highValueThreshold != null ? String(data.settings.highValueThreshold) : ""
  );
  const [retentionDays, setRetentionDays] = useState<string>(String(data.settings.retentionDays));

  // Track saved state for CSB dirty detection + discard
  const [savedSettings, setSavedSettings] = useState({
    timezone: data.settings.timezone,
    botFilterEnabled: data.settings.botFilterEnabled,
    highValueThreshold: data.settings.highValueThreshold != null ? String(data.settings.highValueThreshold) : "",
    retentionDays: String(data.settings.retentionDays),
  });
  const isSettingsDirty =
    timezone !== savedSettings.timezone ||
    botFilterEnabled !== savedSettings.botFilterEnabled ||
    highValueThreshold !== savedSettings.highValueThreshold ||
    retentionDays !== savedSettings.retentionDays;

  const handleDiscardSettings = () => {
    setTimezone(savedSettings.timezone);
    setBotFilterEnabled(savedSettings.botFilterEnabled);
    setHighValueThreshold(savedSettings.highValueThreshold);
    setRetentionDays(savedSettings.retentionDays);
  };
  const [reportRange, setReportRange] = useState<7 | 30 | 90>(30);

  // Connect to SSE for real-time updates
  useEffect(() => {
    const eventSource = new EventSource(`/app/api/sse?shopId=${data.shopId}`);
    eventSourceRef.current = eventSource;

    eventSource.addEventListener("connected", (_e) => {
      // SSE connection established
    });

    eventSource.addEventListener("cart-update", (e) => {
      const update = JSON.parse(e.data);

      triggerFlash(update.session?.id);

      setSessions((prev) => {
        const incoming = update.session;
        const existing = prev.find((s) => s.id === incoming.id);
        if (existing) {
          // Patch incoming events onto the full existing history — never drop events
          const existingEvents = existing.events || [];
          // incoming comes from JSON.parse (SSE wire format) — typed as any[]
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const incomingEvents: any[] = incoming.events || [];
          const patched = [...existingEvents];
          for (const newEvt of incomingEvents) {
            const idx = patched.findIndex((e) => e.id === newEvt.id);
            if (idx >= 0) {
              // Update in place; preserve image if SSE sent null
              const old = patched[idx];
              patched[idx] = (old?.variantImage && !newEvt.variantImage)
                ? { ...newEvt, variantImage: old.variantImage }
                : newEvt;
            } else {
              patched.push(newEvt); // new event — add it
            }
          }
          patched.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

          const updated = { ...incoming, events: patched };
          // If this session is open in the detail panel, update it live
          if (selectedSessionRef.current?.id === incoming.id) {
            setSelectedSession(updated);
          }
          // Replace in-place then re-sort so active sessions bubble to top
          return prev
            .map((s) => (s.id === incoming.id ? updated : s))
            .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
        } else {
          return [incoming, ...prev];
        }
      });
    });

    eventSource.onerror = () => {
      // EventSource will auto-reconnect — no action needed
    };

    return () => {
      eventSource.close();
    };
  }, [data.shopId]);

  const formatTimeAgo = (date: string) => {
    const now = new Date();
    const past = new Date(date);
    const seconds = Math.floor((now.getTime() - past.getTime()) / 1000);

    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  };

  const getTimeInCart = (session: SessionWithEvents) => {
    const firstAdd = session.events?.find((e) => e.eventType === "cart_add");
    if (!firstAdd) return null;
    const start = new Date(firstAdd.timestamp).getTime();
    const end = session.orderPlaced
      ? new Date(session.updatedAt.toString()).getTime()
      : Date.now();
    const mins = Math.floor((end - start) / 60000);
    if (mins < 1) return "<1m";
    if (mins < 60) return `${mins}m`;
    if (mins < 1440) { const hrs = Math.floor(mins / 60); return `${hrs}h ${mins % 60}m`; }
    const days = Math.floor(mins / 1440);
    return `${days}d ${Math.floor((mins % 1440) / 60)}h`;
  };

  const getVisitorName = (session: CartSession) => {
    const location = session.city && session.countryCode
      ? ` — ${session.city}, ${session.countryCode}`
      : session.countryCode
        ? ` — ${session.countryCode}`
        : session.city
          ? ` — ${session.city}`
          : "";
    if (session.customerName) return `${session.customerName}${location}`;
    return `Anonymous Visitor${location}`;
  };

  const getStatusBadge = (session: CartSession) => {
    if (session.orderPlaced) {
      return { color: "#008060", label: "Converted" };
    }
    if (session.checkoutAbandoned) {
      return { color: "#e07a00", label: "Returned" };
    }
    if (session.checkoutStarted) {
      return { color: "#ffc453", label: "Checkout" };
    }
    if (session.cartCreated) {
      return { color: "#6d7175", label: "Browsing" };
    }
    return { color: "#e3e3e3", label: "Viewing" };
  };

  const getEventIcon = (eventType: string) => {
    switch (eventType) {
      case "cart_add":
        return (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
            <rect x="6" y="1" width="2" height="12" rx="1"/>
            <rect x="1" y="6" width="12" height="2" rx="1"/>
          </svg>
        );
      case "cart_remove":
        return (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
            <rect x="1" y="6" width="12" height="2" rx="1"/>
          </svg>
        );
      case "checkout_started":
        return (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
            <circle cx="7" cy="7" r="5.5"/>
          </svg>
        );
      case "checkout_completed":
        return (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
            <polyline points="1.5,7 5,10.5 12.5,3.5"/>
          </svg>
        );
      case "checkout_item":
        return (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" xmlns="http://www.w3.org/2000/svg">
            <circle cx="7" cy="7" r="4.5"/>
          </svg>
        );
      case "checkout_abandoned":
        return (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
            <line x1="12" y1="7" x2="2" y2="7"/>
            <polyline points="6,3 2,7 6,11"/>
          </svg>
        );
      case "page_view":
        return (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
            <line x1="2" y1="7" x2="12" y2="7"/>
            <polyline points="8,3 12,7 8,11"/>
          </svg>
        );
      default:
        return (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
            <circle cx="7" cy="7" r="3"/>
          </svg>
        );
    }
  };

  const CollapsibleProducts = ({ session: s }: { session: SessionWithEvents }) => {
    const [expanded, setExpanded] = useState(false);
    const MAX_VISIBLE = 3;

    const quantityMap = new Map<string, { quantity: number; productTitle: string; variantTitle: string | null; variantImage: string | null; price: number }>();
    for (const e of s.events || []) {
      if (e.eventType !== "cart_add" && e.eventType !== "cart_remove") continue;
      const key = e.variantId || e.productId || "unknown";
      const existing = quantityMap.get(key);
      const delta = e.eventType === "cart_add" ? (e.quantity || 0) : -(e.quantity || 0);
      if (existing) {
        existing.quantity += delta;
      } else {
        quantityMap.set(key, {
          quantity: delta,
          productTitle: e.productTitle || "Unknown Product",
          variantTitle: e.variantTitle,
          variantImage: e.variantImage,
          price: e.price || 0,
        });
      }
    }
    const cartItems = Array.from(quantityMap.values()).filter((item) => item.quantity > 0);
    const removedItems = Array.from(quantityMap.values()).filter((item) => item.quantity <= 0);
    const allItems = [...cartItems.map(i => ({ ...i, removed: false })), ...removedItems.map(i => ({ ...i, removed: true }))];
    const totalCount = allItems.length;
    const hiddenCount = totalCount - MAX_VISIBLE;

    if (totalCount === 0) return null;

    const visibleItems = expanded ? allItems : allItems.slice(0, MAX_VISIBLE);

    const renderRow = (item: any, i: number) => (
      <div key={i} style={{ display: "flex", alignItems: "center", gap: "8px", opacity: item.removed ? 0.5 : 1 }}>
        {item.variantImage ? (
          <img src={item.variantImage} alt="" style={{ width: "32px", height: "32px", objectFit: "cover", borderRadius: "4px", border: "1px solid #e3e3e3", flexShrink: 0 }} />
        ) : (
          <div style={{ width: "32px", height: "32px", borderRadius: "4px", border: "1px solid #e3e3e3", background: "#f6f6f7", flexShrink: 0 }} />
        )}
        <div style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "12px", color: item.removed ? "#6d7175" : "#202223", textDecoration: item.removed ? "line-through" : "none" }}>
          {item.productTitle}
        </div>
        {item.removed ? (
          <div style={{ fontSize: "11px", color: "#d82c0d", flexShrink: 0 }}>Removed</div>
        ) : (
          <div style={{ fontSize: "12px", color: "#6d7175", flexShrink: 0, whiteSpace: "nowrap" }}>
            ${item.price.toFixed(2)} ×{item.quantity}
          </div>
        )}
      </div>
    );

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {visibleItems.map((item, i) => renderRow(item, i))}
        {hiddenCount > 0 && (
          <button
            onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
            style={{
              background: "none",
              border: "none",
              padding: "2px 0",
              fontSize: "12px",
              color: "#008060",
              cursor: "pointer",
              textAlign: "left"
            }}
          >
            {expanded ? "Show less" : `+${hiddenCount} more`}
          </button>
        )}
      </div>
    );
  };

  // Pending settings — applied to savedSettings only after server confirms success
  const pendingSettingsRef = useRef<typeof savedSettings | null>(null);

  useEffect(() => {
    if (settingsFetcher.data?.success && pendingSettingsRef.current) {
      setSavedSettings(pendingSettingsRef.current);
      pendingSettingsRef.current = null;
    }
  }, [settingsFetcher.data]);

  const handleSaveSettings = () => {
    const pending = { timezone, botFilterEnabled, highValueThreshold, retentionDays };
    pendingSettingsRef.current = pending;
    const formData = new FormData();
    formData.append("action", "updateSettings");
    formData.append("timezone", timezone);
    formData.append("botFilterEnabled", botFilterEnabled ? "true" : "false");
    formData.append("highValueThreshold", highValueThreshold);
    formData.append("retentionDays", retentionDays);
    settingsFetcher.submit(formData, { method: "POST" });
  };

  // Compute report stats client-side from loaded sessions, filtered by reportRange
  const reportRangeCutoff = new Date();
  reportRangeCutoff.setDate(reportRangeCutoff.getDate() - reportRange);
  const filteredForReports = sessions.filter(s => new Date(s.createdAt) >= reportRangeCutoff);
  const rCarts = filteredForReports.filter(s => s.cartCreated).length;
  const rCheckouts = filteredForReports.filter(s => s.checkoutStarted).length;
  const rOrders = filteredForReports.filter(s => s.orderPlaced).length;
  const rAvgCartValue = rCarts > 0
    ? filteredForReports.filter(s => s.cartCreated).reduce((sum, s) => sum + s.cartTotal, 0) / rCarts
    : 0;
  const rConversionRate = rCarts > 0 ? (rOrders / rCarts) * 100 : 0;
  const rCheckoutRate = rCarts > 0 ? (rCheckouts / rCarts) * 100 : 0;
  const rCheckoutToOrderRate = rCheckouts > 0 ? (rOrders / rCheckouts) * 100 : 0;
  // Top products for selected range
  const rProductMap: Record<string, { title: string; cartAdds: number; checkouts: number; conversions: number }> = {};
  for (const s of filteredForReports) {
    const evts = s.events || [];
    for (const e of evts.filter((e: any) => e.eventType === "cart_add")) {
      const key = e.productId || "unknown";
      if (!rProductMap[key]) rProductMap[key] = { title: e.productTitle || "Unknown", cartAdds: 0, checkouts: 0, conversions: 0 };
      rProductMap[key].cartAdds += 1;
      if (s.orderPlaced) rProductMap[key].conversions += 1;
    }
    const ciProductIds = new Set(evts.filter((e: any) => e.eventType === "checkout_item").map((e: any) => e.productId).filter(Boolean));
    for (const pid of ciProductIds) {
      const item = evts.find((e: any) => e.eventType === "checkout_item" && e.productId === pid);
      if (!rProductMap[pid as string]) rProductMap[pid as string] = { title: item?.productTitle || "Unknown", cartAdds: 0, checkouts: 0, conversions: 0 };
      rProductMap[pid as string].checkouts += 1;
    }
  }
  const rTopProducts = Object.entries(rProductMap)
    .map(([productId, d]) => ({ productId, productTitle: d.title, cartAdds: d.cartAdds, checkouts: d.checkouts, conversions: d.conversions, conversionRate: d.cartAdds > 0 ? (d.conversions / d.cartAdds) * 100 : 0 }))
    .sort((a, b) => b.cartAdds - a.cartAdds)
    .slice(0, 10);

  // Top referrers for selected range — computed client-side so the toggle affects this too
  const rReferrerMap: Record<string, { sessions: number; cartAdds: number; conversions: number }> = {};
  for (const s of filteredForReports) {
    const referrer = s.referrerUrl || "Direct";
    if (!rReferrerMap[referrer]) rReferrerMap[referrer] = { sessions: 0, cartAdds: 0, conversions: 0 };
    rReferrerMap[referrer].sessions += 1;
    if (s.cartCreated) rReferrerMap[referrer].cartAdds += 1;
    if (s.orderPlaced) rReferrerMap[referrer].conversions += 1;
  }
  const rTopReferrers = Object.entries(rReferrerMap)
    .map(([referrer, d]) => ({ referrer, sessions: d.sessions, cartAdds: d.cartAdds, conversionRate: d.cartAdds > 0 ? (d.conversions / d.cartAdds) * 100 : 0 }))
    .sort((a, b) => b.sessions - a.sessions)
    .slice(0, 10);

  return (
    <s-page title="CartLens">
      {/* Contextual Save Bar — shown when Settings tab has unsaved changes */}
      <SaveBar open={isSettingsDirty}>
        <button variant="primary" onClick={handleSaveSettings}>Save</button>
        <button onClick={handleDiscardSettings}>Discard</button>
      </SaveBar>

      {/* Page content — fades in on load */}
      <div style={{ opacity: mounted ? 1 : 0, transition: "opacity 0.35s ease" }}>

      {/* Tab Navigation */}
      <div style={{ 
        marginBottom: "20px",
        borderBottom: "1px solid #e3e3e3",
        display: "flex",
        gap: "0"
      }}>
        {[
          {
            id: "live" as const,
            label: (
              <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span style={{
                  width: "8px",
                  height: "8px",
                  borderRadius: "50%",
                  background: "#008060",
                  display: "inline-block",
                  flexShrink: 0,
                  animation: "livePulse 2s ease-in-out infinite",
                }} />
                Live Carts
              </span>
            )
          },
          { id: "reports" as const, label: "Reports" },
          { id: "settings" as const, label: "Settings" }
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              background: "none",
              border: "none",
              padding: "12px 20px",
              fontSize: "14px",
              fontWeight: activeTab === tab.id ? 600 : 400,
              color: activeTab === tab.id ? "#202223" : "#6d7175",
              borderBottom: activeTab === tab.id ? "2px solid #008060" : "2px solid transparent",
              cursor: "pointer",
              transition: "all 0.2s"
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Live Carts Tab */}
      {activeTab === "live" && (
        <div>
          {selectedSession ? (
            /* Detail View */
            <div style={{
              opacity: detailMounted ? 1 : 0,
              transition: detailMounted ? "opacity 0.3s ease" : "none"
            }}>
              <button
                onClick={() => setSelectedSession(null)}
                style={{
                  background: "none",
                  border: "none",
                  color: "#008060",
                  fontSize: "14px",
                  cursor: "pointer",
                  padding: "8px 0",
                  marginBottom: "16px",
                  display: "flex",
                  alignItems: "center",
                  gap: "4px"
                }}
              >
                ← Back to list
              </button>

              <div style={{
                background: "#ffffff",
                border: "1px solid #e3e3e3",
                borderRadius: "8px",
                padding: "20px",
                boxShadow: "0 1px 2px rgba(0,0,0,0.05)"
              }}>
                {/* Session Header */}
                <div style={{ marginBottom: "20px", borderBottom: "1px solid #e3e3e3", paddingBottom: "16px" }}>
                  <h2 style={{ fontSize: "20px", fontWeight: 600, color: "#202223", marginBottom: "8px", display: "flex", alignItems: "center", gap: "8px" }}>
                    {getVisitorName(selectedSession)}
                    {(selectedSession.visitNumber ?? 1) > 1 && (
                      <span style={{
                        fontSize: "12px",
                        fontWeight: 600,
                        color: "#916A00",
                        background: "#FFF8E6",
                        padding: "2px 8px",
                        borderRadius: "4px"
                      }}>
                        Visit #{selectedSession.visitNumber}
                      </span>
                    )}
                  </h2>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span key={getStatusBadge(selectedSession).label} style={{
                      display: "inline-block",
                      width: "8px",
                      height: "8px",
                      borderRadius: "50%",
                      background: getStatusBadge(selectedSession).color,
                      animation: "clFade 0.4s ease"
                    }} />
                    <span key={`lbl-${getStatusBadge(selectedSession).label}`} style={{ fontSize: "13px", color: "#6d7175", animation: "clFade 0.4s ease" }}>
                      {getStatusBadge(selectedSession).label}
                    </span>
                    {getTimeInCart(selectedSession) && (
                      <>
                        <span style={{ fontSize: "13px", color: "#6d7175" }}>•</span>
                        <span key={getTimeInCart(selectedSession)!} style={{ fontSize: "13px", color: "#6d7175", animation: "clFade 0.4s ease" }}>
                          Cart age: {getTimeInCart(selectedSession)}
                        </span>
                      </>
                    )}
                    <span style={{ fontSize: "13px", color: "#6d7175" }}>•</span>
                    <span style={{ fontSize: "13px", color: "#6d7175" }}>
                      {formatTimeAgo(selectedSession.updatedAt.toString())}
                    </span>
                  </div>
                </div>

                {/* Visitor Info */}
                <div style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "16px",
                  marginBottom: "20px",
                  padding: "16px",
                  background: "#f6f6f7",
                  borderRadius: "4px"
                }}>
                  <div>
                    <div style={{ fontSize: "12px", color: "#6d7175", marginBottom: "4px" }}>Location</div>
                    <div style={{ fontSize: "14px", color: "#202223" }}>
                      {(() => {
                        const parts = [selectedSession.city, selectedSession.country].filter(Boolean);
                        const code = selectedSession.countryCode;
                        if (parts.length > 0) return `${parts.join(", ")}${code && !selectedSession.country ? ` (${code})` : ""}`;
                        if (code) return code;
                        return "Unknown";
                      })()}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: "12px", color: "#6d7175", marginBottom: "4px" }}>Device</div>
                    <div style={{ fontSize: "14px", color: "#202223" }}>
                      {selectedSession.deviceType || "Unknown"} • {selectedSession.browser || "Unknown"}
                    </div>
                  </div>
                  {selectedSession.customerEmail && (
                    <div key={selectedSession.customerEmail} style={{ animation: "clFade 0.4s ease" }}>
                      <div style={{ fontSize: "12px", color: "#6d7175", marginBottom: "4px" }}>Email</div>
                      <div style={{ fontSize: "14px", color: "#202223", wordBreak: "break-all" }}>
                        {selectedSession.customerEmail}
                      </div>
                    </div>
                  )}
                  {selectedSession.referrerUrl && (
                    <div>
                      <div style={{ fontSize: "12px", color: "#6d7175", marginBottom: "4px" }}>Referrer</div>
                      <div style={{ fontSize: "14px", color: "#202223", wordBreak: "break-all" }}>
                        {selectedSession.referrerUrl}
                      </div>
                    </div>
                  )}
                  {selectedSession.landingPage && (
                    <div>
                      <div style={{ fontSize: "12px", color: "#6d7175", marginBottom: "4px" }}>Landing Page</div>
                      <div style={{ fontSize: "14px", color: "#202223", wordBreak: "break-all" }}>
                        {selectedSession.landingPage}
                      </div>
                    </div>
                  )}
                  <div>
                    <div style={{ fontSize: "12px", color: "#6d7175", marginBottom: "4px" }}>Cart Total</div>
                    <div key={selectedSession.cartTotal} style={{ fontSize: "14px", color: "#202223", fontWeight: 600, animation: "clFade 0.4s ease" }}>
                      {selectedSession.totalDiscounts > 0 ? (
                        <>
                          <span style={{ textDecoration: "line-through", color: "#8c9196", fontWeight: 400, marginRight: "6px" }}>
                            ${selectedSession.cartTotal.toFixed(2)}
                          </span>
                          ${(selectedSession.cartTotal - selectedSession.totalDiscounts).toFixed(2)}
                        </>
                      ) : (
                        `$${selectedSession.cartTotal.toFixed(2)}`
                      )}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: "12px", color: "#6d7175", marginBottom: "4px" }}>Items</div>
                    <div key={selectedSession.itemCount} style={{ fontSize: "14px", color: "#202223", fontWeight: 600, animation: "clFade 0.4s ease" }}>
                      {selectedSession.itemCount}
                    </div>
                  </div>
                  {(() => {
                    try {
                      const codes = selectedSession.discountCodes ? JSON.parse(selectedSession.discountCodes as string) : [];
                      if (codes.length === 0) return null;
                      return (
                        <div>
                          <div style={{ fontSize: "12px", color: "#6d7175", marginBottom: "4px" }}>Discount</div>
                          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
                            {codes.map((dc: any, i: number) => (
                              <span key={i} style={{
                                fontSize: "13px",
                                fontWeight: 600,
                                color: "#5C6AC4",
                                background: "#F4F5FA",
                                padding: "2px 8px",
                                borderRadius: "4px"
                              }}>
                                {dc.code}
                              </span>
                            ))}
                            {selectedSession.totalDiscounts > 0 && (
                              <span style={{ fontSize: "13px", color: "#008060", fontWeight: 600 }}>
                                −${selectedSession.totalDiscounts.toFixed(2)}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    } catch { return null; }
                  })()}
                </div>

                {/* Session Timeline */}
                <div>
                  <h3 style={{ fontSize: "16px", fontWeight: 600, color: "#202223", marginBottom: "12px" }}>
                    Session Timeline
                  </h3>
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    {selectedSession.events.map((event) => {
                        const isConversion = event.eventType === "checkout_completed";
                        const isCheckout = event.eventType === "checkout_started" || event.eventType === "checkout_item";
                        const isAbandoned = event.eventType === "checkout_abandoned";
                        const rowBg = isConversion ? "#f1faf5" : isAbandoned ? "#fff4ec" : isCheckout ? "#fdf9ed" : "#ffffff";
                        const rowBorder = isConversion ? "1px solid #95c9b4" : isAbandoned ? "1px solid #e8a060" : isCheckout ? "1px solid #e0c065" : "1px solid #e3e3e3";
                        const iconBg = isConversion ? "#007a5a" : isAbandoned ? "#c05c00" : isCheckout ? "#b7891a" : "#ffffff";
                        const iconColor = (isConversion || isCheckout || isAbandoned) ? "#ffffff" : "#202223";
                        const iconBorder = isConversion ? "1px solid #007a5a" : isAbandoned ? "1px solid #c05c00" : isCheckout ? "1px solid #b7891a" : "1px solid #e3e3e3";
                        return (
                      <div
                        key={event.id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "12px",
                          padding: "12px",
                          background: rowBg,
                          borderRadius: "4px",
                          border: rowBorder,
                          animation: "clFade 0.4s ease"
                        }}
                      >
                        <div style={{
                          width: "28px",
                          height: "28px",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          background: iconBg,
                          border: iconBorder,
                          borderRadius: "4px",
                          fontSize: "16px",
                          fontWeight: 700,
                          flexShrink: 0,
                          color: iconColor
                        }}>
                          {getEventIcon(event.eventType)}
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: "12px", color: "#6d7175", marginBottom: "4px" }}>
                            {new Date(event.timestamp).toLocaleTimeString()}
                          </div>
                          <div style={{ fontSize: "14px", color: "#202223" }}>
                            {event.eventType === "cart_add" && (
                              <>
                                Added {event.productTitle}
                                {event.variantTitle && ` - ${event.variantTitle}`}
                                {event.quantity && ` (${event.quantity}x)`}
                                {event.price && ` — $${event.price.toFixed(2)}`}
                              </>
                            )}
                            {event.eventType === "cart_remove" && (
                              <>
                                Removed {event.productTitle}
                                {event.variantTitle && ` - ${event.variantTitle}`}
                              </>
                            )}
                            {event.eventType === "page_view" && (
                              <>Viewed {event.pageUrl}</>
                            )}
                            {event.eventType === "checkout_started" && "Checkout started"}
                            {event.eventType === "checkout_item" && (
                              <>
                                In checkout: {event.productTitle}
                                {event.variantTitle && ` - ${event.variantTitle}`}
                                {event.quantity && ` (${event.quantity}x)`}
                                {event.price && ` — $${event.price.toFixed(2)}`}
                              </>
                            )}
                            {event.eventType === "checkout_completed" && (
                              <>Order placed{selectedSession.orderNumber ? ` — #${selectedSession.orderNumber}` : ""}</>
                            )}
                            {event.eventType === "checkout_abandoned" && "Left checkout — returned to browsing"}
                          </div>
                        </div>
                      </div>
                    ); })}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* List View */
            <div>
              <div style={{ marginBottom: "16px", display: "flex", alignItems: "center", gap: "8px" }}>
                <h2 style={{ fontSize: "16px", fontWeight: 600, color: "#202223" }}>Recent Cart Activity</h2>
                <span style={{
                  background: "#f6f6f7",
                  color: "#6d7175",
                  fontSize: "12px",
                  padding: "2px 8px",
                  borderRadius: "4px",
                  fontWeight: 600
                }}>
                  {sessions.length}
                </span>
              </div>

              {sessions.length === 0 ? (
                <div style={{
                  background: "#ffffff",
                  border: "1px solid #e3e3e3",
                  borderRadius: "8px",
                  padding: "32px",
                  textAlign: "center",
                  boxShadow: "0 1px 2px rgba(0,0,0,0.05)"
                }}>
                  {data.pixelInstalled || fetcher.data?.pixelInstalled ? (
                    <div>
                      <div style={{
                        width: "48px",
                        height: "48px",
                        background: "#f6f6f7",
                        borderRadius: "50%",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        margin: "0 auto 16px",
                        fontSize: "24px"
                      }}>
                        ✓
                      </div>
                      <div style={{ fontSize: "16px", fontWeight: 600, color: "#202223", marginBottom: "8px" }}>
                        Web Pixel is Active
                      </div>
                      <div style={{ fontSize: "14px", color: "#6d7175" }}>
                        Waiting for cart activity on your store...
                      </div>
                      <fetcher.Form method="post" style={{ marginTop: "12px" }}>
                        <input type="hidden" name="action" value="installPixel" />
                        <button type="submit" style={{ background: "none", border: "1px solid #e3e3e3", padding: "6px 12px", borderRadius: "4px", fontSize: "13px", color: "#6d7175", cursor: "pointer" }}>
                          {fetcher.state === "submitting" ? "Reinstalling..." : "Reinstall Pixel"}
                        </button>
                      </fetcher.Form>
                      {fetcher.data?.pixelInstalled && <div style={{ marginTop: "8px", fontSize: "13px", color: "#008060" }}>Pixel reinstalled successfully</div>}
                      {fetcher.data?.error && <div style={{ marginTop: "8px", fontSize: "13px", color: "#d82c0d" }}>Error: {fetcher.data.error}</div>}
                    </div>
                  ) : (
                    <div>
                      <div style={{
                        width: "48px",
                        height: "48px",
                        background: "#f6f6f7",
                        borderRadius: "50%",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        margin: "0 auto 16px",
                        fontSize: "24px"
                      }}>
                        ?
                      </div>
                      <div style={{ fontSize: "16px", fontWeight: 600, color: "#202223", marginBottom: "8px" }}>
                        Install Web Pixel
                      </div>
                      <div style={{ fontSize: "14px", color: "#6d7175", marginBottom: "16px" }}>
                        Install the Web Pixel to start tracking cart activity
                      </div>
                      <fetcher.Form method="post">
                        <input type="hidden" name="action" value="installPixel" />
                        <button
                          type="submit"
                          style={{
                            background: "#008060",
                            color: "#ffffff",
                            border: "none",
                            padding: "10px 16px",
                            borderRadius: "4px",
                            fontSize: "14px",
                            fontWeight: 600,
                            cursor: "pointer"
                          }}
                        >
                          Install Web Pixel
                        </button>
                      </fetcher.Form>
                      {fetcher.data?.error && (
                        <div style={{ marginTop: "12px", fontSize: "13px", color: "#d82c0d" }}>
                          Error: {fetcher.data.error}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  {sessions.slice(0, 50).map((session) => {
                    const status = getStatusBadge(session);
                    const products = session.events
                      ?.filter((e) => e.eventType === "cart_add")
                      .map((e) => e.productTitle)
                      .filter(Boolean)
                      .filter((v, i, a) => a.indexOf(v) === i);
                    const images = session.events
                      ?.filter((e) => e.eventType === "cart_add" && e.variantImage)
                      .map((e) => e.variantImage!)
                      .filter((v, i, a) => a.indexOf(v) === i)
                      .slice(0, 4);

                    const isFlashing = flashIds.has(session.id);
                    return (
                      <div
                        key={session.id}
                        onClick={() => setSelectedSession(session)}
                        style={{
                          background: isFlashing ? "#fffbef" : "#ffffff",
                          border: "1px solid #e3e3e3",
                          borderRadius: "8px",
                          padding: "16px",
                          cursor: "pointer",
                          transition: isFlashing ? "none" : "background-color 0.7s ease, box-shadow 0.2s",
                          boxShadow: "0 1px 2px rgba(0,0,0,0.05)"
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = "#f6f6f7";
                          e.currentTarget.style.boxShadow = "0 2px 4px rgba(0,0,0,0.1)";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = "#ffffff";
                          e.currentTarget.style.boxShadow = "0 1px 2px rgba(0,0,0,0.05)";
                        }}
                      >
                        {/* Card Header */}
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "4px", gap: "8px" }}>
                          <div style={{ fontSize: "14px", fontWeight: 600, color: "#202223", minWidth: 0, display: "flex", alignItems: "center", gap: "6px" }}>
                            <span>{getVisitorName(session)}</span>
                            {(session.visitNumber ?? 1) > 1 && (
                              <span style={{
                                fontSize: "11px",
                                fontWeight: 600,
                                color: "#916A00",
                                background: "#FFF8E6",
                                padding: "1px 6px",
                                borderRadius: "3px",
                                flexShrink: 0
                              }}>
                                Visit #{session.visitNumber}
                              </span>
                            )}
                            {data.settings.highValueThreshold != null &&
                              session.cartTotal >= data.settings.highValueThreshold &&
                              session.cartTotal > 0 && (
                              <span style={{
                                fontSize: "11px",
                                fontWeight: 600,
                                color: "#ffffff",
                                background: "#007a5a",
                                padding: "1px 6px",
                                borderRadius: "3px",
                                flexShrink: 0
                              }}>
                                High Value
                              </span>
                            )}
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "3px", flexShrink: 0 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "6px", whiteSpace: "nowrap" }}>
                              <span style={{
                                display: "inline-block",
                                width: "8px",
                                height: "8px",
                                borderRadius: "50%",
                                background: status.color,
                                flexShrink: 0
                              }} />
                              <span style={{ fontSize: "12px", color: "#6d7175" }}>
                                {status.label}
                              </span>
                              <span style={{ fontSize: "12px", color: "#919eab" }}>
                                {formatTimeAgo(session.updatedAt.toString())}
                              </span>
                            </div>
                            {getTimeInCart(session) && (
                              <span style={{ fontSize: "11px", color: "#919eab" }}>
                                {getTimeInCart(session)} in cart
                              </span>
                            )}
                          </div>
                        </div>
                        <div style={{ fontSize: "13px", color: session.itemCount === 0 ? "#d82c0d" : "#6d7175", marginBottom: "4px", display: "flex", alignItems: "center", gap: "6px" }}>
                          <span>
                            {session.itemCount === 0 ? "Cart emptied" : (
                              <>
                                {`${session.itemCount} ${session.itemCount === 1 ? "item" : "items"} · `}
                                {session.totalDiscounts > 0 ? (
                                  <>
                                    <span style={{ textDecoration: "line-through", color: "#8c9196" }}>${session.cartTotal.toFixed(2)}</span>
                                    <span style={{ marginLeft: "5px" }}>${(session.cartTotal - session.totalDiscounts).toFixed(2)}</span>
                                  </>
                                ) : (
                                  `$${session.cartTotal.toFixed(2)}`
                                )}
                              </>
                            )}
                          </span>
                          {(() => {
                            try {
                              const codes = session.discountCodes ? JSON.parse(session.discountCodes as string) : [];
                              if (codes.length === 0) return null;
                              return codes.map((dc: any, i: number) => (
                                <span key={i} style={{
                                  fontSize: "11px",
                                  fontWeight: 600,
                                  color: "#5C6AC4",
                                  background: "#F4F5FA",
                                  padding: "1px 6px",
                                  borderRadius: "3px",
                                  letterSpacing: "0.3px"
                                }}>
                                  {dc.code}
                                </span>
                              ));
                            } catch { return null; }
                          })()}
                        </div>
                        <div style={{ fontSize: "12px", color: "#919eab", marginBottom: "10px" }}>
                          Created {new Date(session.createdAt.toString()).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                        </div>

                        <CollapsibleProducts session={session} />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Reports Tab */}
      {activeTab === "reports" && (
        <div style={{ overflow: "hidden" }}>
          {/* Date Range Toggle */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
            <span style={{ fontSize: "12px", color: "#9ca3af" }}>
              Based on {sessions.length} most recent session{sessions.length !== 1 ? "s" : ""}
            </span>
            <div style={{ display: "flex", border: "1px solid #e3e3e3", borderRadius: "6px", overflow: "hidden" }}>
              {([7, 30, 90] as const).map((r) => (
                <button
                  key={r}
                  onClick={() => setReportRange(r)}
                  style={{
                    padding: "6px 14px",
                    fontSize: "13px",
                    fontWeight: reportRange === r ? 600 : 400,
                    color: reportRange === r ? "#ffffff" : "#6d7175",
                    background: reportRange === r ? "#008060" : "#ffffff",
                    border: "none",
                    borderRight: r !== 90 ? "1px solid #e3e3e3" : "none",
                    cursor: "pointer"
                  }}
                >
                  {r}d
                </button>
              ))}
            </div>
          </div>

          {/* Summary Cards */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, 1fr)",
            gap: "12px",
            marginBottom: "24px"
          }}>
            {[
              { label: "Total Carts", value: rCarts, color: "#202223" },
              { label: "Conversion Rate", value: `${rConversionRate.toFixed(1)}%`, color: "#008060" },
              { label: "Avg Cart Value", value: `$${rAvgCartValue.toFixed(2)}`, color: "#202223" },
              { label: "Total Orders", value: rOrders, color: "#008060" }
            ].map((stat, idx) => (
              <div
                key={idx}
                style={{
                  background: "#ffffff",
                  border: "1px solid #e3e3e3",
                  borderRadius: "8px",
                  padding: "16px",
                  boxShadow: "0 1px 2px rgba(0,0,0,0.05)"
                }}
              >
                <div style={{ fontSize: "22px", fontWeight: 600, color: stat.color, marginBottom: "4px" }}>
                  {stat.value}
                </div>
                <div style={{ fontSize: "12px", color: "#6d7175" }}>
                  {stat.label}
                </div>
              </div>
            ))}
          </div>

          {/* Funnel */}
          <div style={{
            background: "#ffffff",
            border: "1px solid #e3e3e3",
            borderRadius: "8px",
            padding: "16px",
            marginBottom: "20px",
            boxShadow: "0 1px 2px rgba(0,0,0,0.05)"
          }}>
            <h3 style={{ fontSize: "15px", fontWeight: 600, color: "#202223", marginBottom: "14px" }}>
              Funnel — Last {reportRange} Days
            </h3>
            <div style={{ marginBottom: "8px", fontSize: "13px", color: "#6d7175" }}>
              {rCarts} carts total
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {[
                {
                  label: "Checkout Started",
                  value: rCheckouts,
                  total: rCarts,
                  barPercent: rCheckoutRate,
                  color: "#ffc453"
                },
                {
                  label: "Order Placed",
                  value: rOrders,
                  total: rCarts,
                  barPercent: rConversionRate,
                  color: "#5C6AC4"
                }
              ].map((stage, idx) => (
                <div key={idx}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                    <span style={{ fontSize: "13px", color: "#202223" }}>{stage.label}</span>
                    <span style={{ fontSize: "13px", color: "#6d7175" }}>
                      {stage.value} of {stage.total}
                      <span style={{ color: "#adb0b3", fontSize: "12px" }}> · {stage.barPercent.toFixed(1)}%</span>
                    </span>
                  </div>
                  <div style={{ width: "100%", height: "8px", background: "#e3e3e3", borderRadius: "4px", overflow: "hidden" }}>
                    <div style={{
                      width: `${stage.barPercent}%`,
                      height: "100%",
                      background: stage.color,
                      transition: "width 0.3s"
                    }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Top Products */}
          <div style={{
            background: "#ffffff",
            border: "1px solid #e3e3e3",
            borderRadius: "8px",
            overflowX: "auto",
            marginBottom: "20px",
            boxShadow: "0 1px 2px rgba(0,0,0,0.05)"
          }}>
            <div style={{ padding: "16px 16px 12px" }}>
              <h3 style={{ fontSize: "15px", fontWeight: 600, color: "#202223", margin: 0 }}>
                Top Products
              </h3>
            </div>
            {rTopProducts.length === 0 ? (
              <div style={{ fontSize: "14px", color: "#6d7175", padding: "20px 16px", textAlign: "center" }}>
                No product data yet
              </div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderTop: "1px solid #e3e3e3", borderBottom: "1px solid #e3e3e3" }}>
                    <th style={{ padding: "8px 16px", fontSize: "12px", fontWeight: 600, color: "#6d7175", textAlign: "left" }}>Product</th>
                    <th style={{ padding: "8px 16px", fontSize: "12px", fontWeight: 600, color: "#6d7175", textAlign: "right", whiteSpace: "nowrap" }}>Cart adds</th>
                    <th style={{ padding: "8px 16px", fontSize: "12px", fontWeight: 600, color: "#6d7175", textAlign: "right", whiteSpace: "nowrap" }}>Checkouts</th>
                    <th style={{ padding: "8px 16px", fontSize: "12px", fontWeight: 600, color: "#6d7175", textAlign: "right", whiteSpace: "nowrap" }}>Orders</th>
                    <th style={{ padding: "8px 16px", fontSize: "12px", fontWeight: 600, color: "#6d7175", textAlign: "right", whiteSpace: "nowrap" }}>Conv. rate</th>
                  </tr>
                </thead>
                <tbody>
                  {rTopProducts.map((product, idx) => (
                    <tr key={product.productId} style={{ borderBottom: idx < rTopProducts.length - 1 ? "1px solid #f1f1f1" : "none" }}>
                      <td style={{ padding: "10px 16px", fontSize: "13px", fontWeight: 500, color: "#202223", maxWidth: "200px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {product.productTitle}
                      </td>
                      <td style={{ padding: "10px 16px", fontSize: "13px", color: "#202223", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                        {product.cartAdds}
                      </td>
                      <td style={{ padding: "10px 16px", fontSize: "13px", color: "#202223", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                        {product.checkouts}
                      </td>
                      <td style={{ padding: "10px 16px", fontSize: "13px", color: "#202223", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                        {product.conversions}
                      </td>
                      <td style={{ padding: "10px 16px", fontSize: "13px", color: "#008060", textAlign: "right", fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>
                        {product.conversionRate.toFixed(1)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Top Referrers */}
          <div style={{
            background: "#ffffff",
            border: "1px solid #e3e3e3",
            borderRadius: "8px",
            overflowX: "auto",
            marginBottom: "20px",
            boxShadow: "0 1px 2px rgba(0,0,0,0.05)"
          }}>
            <div style={{ padding: "16px 16px 12px" }}>
              <h3 style={{ fontSize: "15px", fontWeight: 600, color: "#202223", margin: 0 }}>
                Top Referrers
              </h3>
            </div>
            {rTopReferrers.length === 0 ? (
              <div style={{ fontSize: "14px", color: "#6d7175", padding: "20px 16px", textAlign: "center" }}>
                No referrer data yet
              </div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderTop: "1px solid #e3e3e3", borderBottom: "1px solid #e3e3e3" }}>
                    <th style={{ padding: "8px 16px", fontSize: "12px", fontWeight: 600, color: "#6d7175", textAlign: "left" }}>Source</th>
                    <th style={{ padding: "8px 16px", fontSize: "12px", fontWeight: 600, color: "#6d7175", textAlign: "right", whiteSpace: "nowrap" }}>Sessions</th>
                    <th style={{ padding: "8px 16px", fontSize: "12px", fontWeight: 600, color: "#6d7175", textAlign: "right", whiteSpace: "nowrap" }}>Cart adds</th>
                    <th style={{ padding: "8px 16px", fontSize: "12px", fontWeight: 600, color: "#6d7175", textAlign: "right", whiteSpace: "nowrap" }}>Conv. rate</th>
                  </tr>
                </thead>
                <tbody>
                  {rTopReferrers.map((referrer, idx) => (
                    <tr key={idx} style={{ borderBottom: idx < rTopReferrers.length - 1 ? "1px solid #f1f1f1" : "none" }}>
                      <td style={{ padding: "10px 16px", fontSize: "13px", fontWeight: 500, color: "#202223", maxWidth: "200px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {referrer.referrer}
                      </td>
                      <td style={{ padding: "10px 16px", fontSize: "13px", color: "#202223", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                        {referrer.sessions}
                      </td>
                      <td style={{ padding: "10px 16px", fontSize: "13px", color: "#202223", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                        {referrer.cartAdds}
                      </td>
                      <td style={{ padding: "10px 16px", fontSize: "13px", color: "#008060", textAlign: "right", fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>
                        {referrer.conversionRate.toFixed(1)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* Settings Tab */}
      {activeTab === "settings" && (
        <div>
          <div style={{
            background: "#ffffff",
            border: "1px solid #e3e3e3",
            borderRadius: "8px",
            padding: "20px",
            marginBottom: "20px",
            boxShadow: "0 1px 2px rgba(0,0,0,0.05)"
          }}>
            <h3 style={{ fontSize: "16px", fontWeight: 600, color: "#202223", marginBottom: "20px" }}>
              General Settings
            </h3>

            <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
              {/* Timezone */}
              <div style={{ paddingBottom: "20px", borderBottom: "1px solid #e3e3e3" }}>
                <label style={{ display: "block", marginBottom: "8px", fontSize: "14px", fontWeight: 600, color: "#202223" }}>
                  Timezone
                </label>
                <div style={{ fontSize: "13px", color: "#6d7175", marginBottom: "8px" }}>
                  Select your preferred timezone for reporting
                </div>
                <select
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  style={{
                    width: "100%",
                    maxWidth: "400px",
                    padding: "8px 12px",
                    fontSize: "14px",
                    border: "1px solid #e3e3e3",
                    borderRadius: "4px",
                    background: "#ffffff",
                    color: "#202223"
                  }}
                >
                  <optgroup label="UTC">
                    <option value="UTC">UTC (Coordinated Universal Time)</option>
                  </optgroup>
                  <optgroup label="North America">
                    <option value="America/New_York">Eastern Time (ET)</option>
                    <option value="America/Chicago">Central Time (CT)</option>
                    <option value="America/Denver">Mountain Time (MT)</option>
                    <option value="America/Los_Angeles">Pacific Time (PT)</option>
                    <option value="America/Anchorage">Alaska Time (AKT)</option>
                    <option value="Pacific/Honolulu">Hawaii Time (HT)</option>
                    <option value="America/Toronto">Toronto (ET)</option>
                    <option value="America/Vancouver">Vancouver (PT)</option>
                    <option value="America/Mexico_City">Mexico City (CT)</option>
                  </optgroup>
                  <optgroup label="South America">
                    <option value="America/Sao_Paulo">São Paulo (BRT)</option>
                    <option value="America/Argentina/Buenos_Aires">Buenos Aires (ART)</option>
                    <option value="America/Bogota">Bogotá (COT)</option>
                  </optgroup>
                  <optgroup label="Europe">
                    <option value="Europe/London">London (GMT/BST)</option>
                    <option value="Europe/Paris">Paris (CET/CEST)</option>
                    <option value="Europe/Berlin">Berlin (CET/CEST)</option>
                    <option value="Europe/Amsterdam">Amsterdam (CET/CEST)</option>
                    <option value="Europe/Madrid">Madrid (CET/CEST)</option>
                    <option value="Europe/Rome">Rome (CET/CEST)</option>
                    <option value="Europe/Stockholm">Stockholm (CET/CEST)</option>
                    <option value="Europe/Warsaw">Warsaw (CET/CEST)</option>
                    <option value="Europe/Kiev">Kyiv (EET/EEST)</option>
                    <option value="Europe/Istanbul">Istanbul (TRT)</option>
                  </optgroup>
                  <optgroup label="Middle East & Africa">
                    <option value="Asia/Dubai">Dubai (GST)</option>
                    <option value="Asia/Riyadh">Riyadh (AST)</option>
                    <option value="Africa/Cairo">Cairo (EET)</option>
                    <option value="Africa/Johannesburg">Johannesburg (SAST)</option>
                    <option value="Africa/Lagos">Lagos (WAT)</option>
                  </optgroup>
                  <optgroup label="Asia & Pacific">
                    <option value="Asia/Kolkata">India (IST)</option>
                    <option value="Asia/Dhaka">Dhaka (BST)</option>
                    <option value="Asia/Bangkok">Bangkok (ICT)</option>
                    <option value="Asia/Singapore">Singapore (SGT)</option>
                    <option value="Asia/Shanghai">China (CST)</option>
                    <option value="Asia/Tokyo">Tokyo (JST)</option>
                    <option value="Asia/Seoul">Seoul (KST)</option>
                    <option value="Australia/Sydney">Sydney (AEST/AEDT)</option>
                    <option value="Australia/Melbourne">Melbourne (AEST/AEDT)</option>
                    <option value="Pacific/Auckland">Auckland (NZST/NZDT)</option>
                  </optgroup>
                </select>
              </div>

              {/* Bot Filter */}
              <div style={{ paddingBottom: "20px", borderBottom: "1px solid #e3e3e3" }}>
                <label style={{ display: "flex", alignItems: "flex-start", gap: "12px", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={botFilterEnabled}
                    onChange={(e) => setBotFilterEnabled(e.target.checked)}
                    style={{
                      width: "20px",
                      height: "20px",
                      marginTop: "2px",
                      cursor: "pointer"
                    }}
                  />
                  <div>
                    <div style={{ fontSize: "14px", fontWeight: 600, color: "#202223", marginBottom: "4px" }}>
                      Bot Filter
                    </div>
                    <div style={{ fontSize: "13px", color: "#6d7175" }}>
                      Filter suspected bot traffic from analytics
                    </div>
                  </div>
                </label>
              </div>

              {/* High Value Cart Threshold */}
              <div style={{ paddingBottom: "20px", borderBottom: "1px solid #e3e3e3" }}>
                <label style={{ display: "block", marginBottom: "8px", fontSize: "14px", fontWeight: 600, color: "#202223" }}>
                  High Value Cart Threshold
                </label>
                <div style={{ fontSize: "13px", color: "#6d7175", marginBottom: "8px" }}>
                  Carts above this value are highlighted in the live view. Leave blank to disable.
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span style={{ fontSize: "14px", color: "#202223" }}>$</span>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    placeholder="e.g. 150"
                    value={highValueThreshold}
                    onChange={(e) => setHighValueThreshold(e.target.value)}
                    style={{
                      width: "120px",
                      padding: "8px 12px",
                      fontSize: "14px",
                      border: "1px solid #e3e3e3",
                      borderRadius: "4px",
                      background: "#ffffff",
                      color: "#202223"
                    }}
                  />
                </div>
              </div>

              {/* Data Retention */}
              <div>
                <label style={{ display: "block", marginBottom: "8px", fontSize: "14px", fontWeight: 600, color: "#202223" }}>
                  Data Retention
                </label>
                <div style={{ fontSize: "13px", color: "#6d7175", marginBottom: "8px" }}>
                  Cart sessions older than this will be automatically deleted. Min 1 day, max 365 days.
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <input
                    type="number"
                    min="1"
                    max="365"
                    step="1"
                    value={retentionDays}
                    onChange={(e) => setRetentionDays(e.target.value)}
                    style={{
                      width: "90px",
                      padding: "8px 12px",
                      fontSize: "14px",
                      border: "1px solid #e3e3e3",
                      borderRadius: "4px",
                      background: "#ffffff",
                      color: "#202223"
                    }}
                  />
                  <span style={{ fontSize: "14px", color: "#6d7175" }}>days</span>
                </div>
              </div>

              {/* Save error */}
              {settingsFetcher.data?.success === false && settingsFetcher.data?.error && (
                <div style={{
                  marginTop: "16px",
                  padding: "10px 14px",
                  background: "#fff4f4",
                  border: "1px solid #fca5a5",
                  borderRadius: "6px",
                  fontSize: "13px",
                  color: "#b91c1c"
                }}>
                  {settingsFetcher.data.error}
                </div>
              )}
              {/* Settings saved via Contextual Save Bar (above) */}
            </div>
          </div>

          {/* CSV Export */}
          <div style={{
            background: "#ffffff",
            border: "1px solid #e3e3e3",
            borderRadius: "8px",
            padding: "20px",
            boxShadow: "0 1px 2px rgba(0,0,0,0.05)"
          }}>
            <h3 style={{ fontSize: "16px", fontWeight: 600, color: "#202223", marginBottom: "8px" }}>
              CSV Export
            </h3>
            <div style={{ fontSize: "14px", color: "#6d7175", marginBottom: "16px" }}>
              Export all cart session data to CSV for analysis
            </div>
            <button
              onClick={async () => {
                try {
                  const res = await fetch("/app/api/export");
                  if (!res.ok) throw new Error("Export failed");
                  const blob = await res.blob();
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `cartlens-export-${new Date().toISOString().split("T")[0]}.csv`;
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                  URL.revokeObjectURL(url);
                } catch (e) {
                  alert("Export failed. Please try again.");
                }
              }}
              style={{
                display: "inline-block",
                background: "#ffffff",
                color: "#202223",
                border: "1px solid #e3e3e3",
                padding: "10px 16px",
                borderRadius: "4px",
                fontSize: "14px",
                fontWeight: 600,
                cursor: "pointer"
              }}
            >
              Download CSV
            </button>
          </div>

          {/* Pixel Status */}
          <div style={{
            background: "#ffffff",
            border: "1px solid #e3e3e3",
            borderRadius: "8px",
            padding: "20px",
            marginTop: "20px",
            boxShadow: "0 1px 2px rgba(0,0,0,0.05)"
          }}>
            {/* Header row: title + status indicator */}
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
              <h3 style={{ fontSize: "16px", fontWeight: 600, color: "#202223", margin: 0 }}>
                Web Pixel
              </h3>
              <span style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "5px",
                fontSize: "12px",
                fontWeight: 600,
                color: data.pixelInstalled || fetcher.data?.pixelInstalled ? "#008060" : "#d82c0d"
              }}>
                <span style={{
                  width: "8px",
                  height: "8px",
                  borderRadius: "50%",
                  background: data.pixelInstalled || fetcher.data?.pixelInstalled ? "#008060" : "#d82c0d",
                  display: "inline-block"
                }} />
                {data.pixelInstalled || fetcher.data?.pixelInstalled ? "Active" : "Not installed"}
              </span>
            </div>

            <div style={{ fontSize: "14px", color: "#6d7175", marginBottom: "16px" }}>
              {data.pixelInstalled || fetcher.data?.pixelInstalled
                ? "Web Pixel is active and tracking customer behavior."
                : "Web Pixel is not installed. Install it to track cart activity and device data."}
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <fetcher.Form method="post">
                <input type="hidden" name="action" value="installPixel" />
                <button
                  type="submit"
                  disabled={fetcher.state === "submitting"}
                  style={{
                    background: data.pixelInstalled || fetcher.data?.pixelInstalled ? "#ffffff" : "#008060",
                    color: data.pixelInstalled || fetcher.data?.pixelInstalled ? "#202223" : "#ffffff",
                    border: "1px solid #e3e3e3",
                    padding: "8px 14px",
                    borderRadius: "4px",
                    fontSize: "13px",
                    fontWeight: 600,
                    cursor: fetcher.state === "submitting" ? "not-allowed" : "pointer",
                    opacity: fetcher.state === "submitting" ? 0.6 : 1
                  }}
                >
                  {fetcher.state === "submitting"
                    ? "Installing..."
                    : data.pixelInstalled || fetcher.data?.pixelInstalled
                      ? "Reinstall Pixel"
                      : "Install Pixel"}
                </button>
              </fetcher.Form>
              {fetcher.data?.pixelInstalled && (
                <span style={{ fontSize: "13px", color: "#008060" }}>Installed successfully</span>
              )}
              {fetcher.data?.error && (
                <span style={{ fontSize: "13px", color: "#d82c0d" }}>Error: {fetcher.data.error}</span>
              )}
            </div>
          </div>
        </div>
      )}
      </div>{/* end fade-in wrapper */}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
