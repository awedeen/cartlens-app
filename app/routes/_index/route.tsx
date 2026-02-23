import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";

import { login } from "../../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  // Shopify install flow — redirect to embedded app
  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export default function Index() {
  return (
    <div style={{
      minHeight: "100vh",
      background: "#f6f6f7",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      padding: "40px 20px"
    }}>
      <div style={{
        background: "#ffffff",
        border: "1px solid #e3e3e3",
        borderRadius: "8px",
        padding: "48px",
        maxWidth: "480px",
        width: "100%",
        boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
        textAlign: "center"
      }}>
        {/* Logo mark */}
        <svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ marginBottom: "20px" }}>
          <circle cx="20" cy="20" r="18" stroke="#008060" strokeWidth="2.5" fill="none"/>
          <circle cx="20" cy="20" r="5" fill="#008060"/>
          <line x1="20" y1="4" x2="20" y2="11" stroke="#008060" strokeWidth="2" strokeLinecap="round"/>
          <line x1="20" y1="29" x2="20" y2="36" stroke="#008060" strokeWidth="2" strokeLinecap="round"/>
          <line x1="4" y1="20" x2="11" y2="20" stroke="#008060" strokeWidth="2" strokeLinecap="round"/>
          <line x1="29" y1="20" x2="36" y2="20" stroke="#008060" strokeWidth="2" strokeLinecap="round"/>
        </svg>

        <h1 style={{ fontSize: "24px", fontWeight: 700, color: "#202223", margin: "0 0 8px" }}>
          CartLens
        </h1>
        <p style={{ fontSize: "15px", color: "#6d7175", margin: "0 0 32px", lineHeight: "1.5" }}>
          Real-time cart activity and conversion insights for Shopify stores.
        </p>

        <a
          href="https://apps.shopify.com"
          style={{
            display: "inline-block",
            background: "#008060",
            color: "#ffffff",
            padding: "12px 24px",
            borderRadius: "6px",
            fontSize: "14px",
            fontWeight: 600,
            textDecoration: "none",
            marginBottom: "16px"
          }}
        >
          Install on Shopify
        </a>

        <p style={{ fontSize: "12px", color: "#9ca3af", margin: "16px 0 0" }}>
          <a href="/privacy" style={{ color: "#6d7175", textDecoration: "underline" }}>Privacy Policy</a>
          {" · "}
          <a href="/tos" style={{ color: "#6d7175", textDecoration: "underline" }}>Terms of Service</a>
        </p>
      </div>
    </div>
  );
}
