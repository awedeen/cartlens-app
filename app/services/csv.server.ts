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

type SessionWithEvents = CartSession & { events: CartEvent[] };

export function generateCSV(
  sessions: SessionWithEvents[],
  columns: string[]
): string {
  // Filter to requested columns
  const selectedColumns = AVAILABLE_COLUMNS.filter((col) =>
    columns.includes(col.key)
  );

  // Build header row
  const header = selectedColumns.map((col) => col.label).join(",");

  // Build data rows
  const rows = sessions.map((session) => {
    return selectedColumns
      .map((col) => {
        let value: any = (session as any)[col.key];

        // Format special values
        if (value === null || value === undefined) {
          return "";
        }
        if (typeof value === "boolean") {
          return value ? "Yes" : "No";
        }
        if (value instanceof Date) {
          return value.toISOString();
        }
        if (typeof value === "string" && value.includes(",")) {
          return `"${value.replace(/"/g, '""')}"`;
        }
        return value;
      })
      .join(",");
  });

  return [header, ...rows].join("\n");
}
