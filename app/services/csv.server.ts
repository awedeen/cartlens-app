// CSV export service

import type { CartSession, CartEvent } from "@prisma/client";

export interface CSVColumn {
  key: string;
  label: string;
}

export const AVAILABLE_COLUMNS: CSVColumn[] = [
  { key: "visitorId", label: "Visitor ID" },
  { key: "customerName", label: "Customer Name" },
  { key: "customerEmail", label: "Customer Email" },
  { key: "city", label: "City" },
  { key: "country", label: "Country" },
  { key: "countryCode", label: "Country Code" },
  { key: "deviceType", label: "Device" },
  { key: "browser", label: "Browser" },
  { key: "os", label: "OS" },
  { key: "referrerUrl", label: "Referrer URL" },
  { key: "landingPage", label: "Landing Page" },
  { key: "utmSource", label: "UTM Source" },
  { key: "utmMedium", label: "UTM Medium" },
  { key: "utmCampaign", label: "UTM Campaign" },
  { key: "cartTotal", label: "Cart Total" },
  { key: "itemCount", label: "Item Count" },
  { key: "cartCreated", label: "Cart Created" },
  { key: "checkoutStarted", label: "Checkout Started" },
  { key: "orderPlaced", label: "Order Placed" },
  { key: "orderId", label: "Order ID" },
  { key: "orderValue", label: "Order Value" },
  { key: "createdAt", label: "Session Start" },
  { key: "updatedAt", label: "Last Activity" },
];

// Characters that trigger formula execution in Excel/Google Sheets (CSV injection)
const FORMULA_PREFIXES = ["=", "+", "-", "@", "\t", "\r"];

/**
 * Safely formats a single CSV cell value.
 * - Always wraps strings in double quotes
 * - Escapes internal double quotes
 * - Prefixes formula-injection characters with a space to prevent execution
 */
function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (value instanceof Date) return `"${value.toISOString()}"`;
  if (typeof value === "number") return String(value);

  // String: sanitize then wrap in quotes
  let str = String(value);
  if (FORMULA_PREFIXES.some((p) => str.startsWith(p))) {
    str = " " + str; // prefix space neutralises formula execution
  }
  // Escape internal double quotes by doubling them
  str = str.replace(/"/g, '""');
  return `"${str}"`;
}

type SessionWithEvents = CartSession & { events: CartEvent[] };

export function generateCSV(
  sessions: SessionWithEvents[],
  columns: string[]
): string {
  const selectedColumns = AVAILABLE_COLUMNS.filter((col) =>
    columns.includes(col.key)
  );

  const header = selectedColumns.map((col) => `"${col.label}"`).join(",");

  const rows = sessions.map((session) =>
    selectedColumns
      .map((col) => formatCell((session as Record<string, unknown>)[col.key]))
      .join(",")
  );

  return [header, ...rows].join("\n");
}
