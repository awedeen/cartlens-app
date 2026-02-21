// Public route — no Shopify auth required
export default function PrivacyPolicy() {
  return (
    <div style={{
      maxWidth: "760px",
      margin: "0 auto",
      padding: "48px 24px",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      fontSize: "15px",
      lineHeight: "1.7",
      color: "#1a1a1a",
    }}>
      <h1 style={{ fontSize: "28px", fontWeight: "700", marginBottom: "8px" }}>
        CartLens Privacy Policy
      </h1>
      <p style={{ color: "#666", marginBottom: "40px" }}>
        Last updated: February 18, 2026
      </p>

      <p>
        CartLens ("we", "our", or "the App") is a Shopify application that provides
        real-time cart analytics to Shopify store owners ("Merchants"). This Privacy
        Policy explains what data CartLens collects, how it is used, and how it is
        protected.
      </p>

      <h2 style={h2Style}>1. Data We Collect</h2>

      <h3 style={h3Style}>Shopper Data (collected on behalf of Merchants)</h3>
      <p>
        When CartLens is installed on a Shopify store, it collects the following
        data from that store's shoppers:
      </p>
      <ul style={ulStyle}>
        <li>Anonymous visitor identifiers (browser fingerprint / cookie)</li>
        <li>Cart contents: product titles, variants, quantities, and prices</li>
        <li>Cart activity timestamps (add to cart, checkout started, order placed)</li>
        <li>Referring URL and landing page</li>
        <li>UTM campaign parameters (source, medium, campaign)</li>
        <li>Approximate geographic location (city and country, derived from IP address)</li>
        <li>IP address (used solely to derive approximate geographic location; not stored after processing)</li>
        <li>Customer name and email address, if the shopper is logged into the store</li>
        <li>Discount codes applied at checkout</li>
        <li>Visit count (number of times a visitor has added to cart)</li>
      </ul>

      <h3 style={h3Style}>Merchant Data</h3>
      <p>
        When a Merchant installs CartLens, we store:
      </p>
      <ul style={ulStyle}>
        <li>Shopify shop domain and access token (required to verify webhook authenticity)</li>
        <li>App settings and preferences configured by the Merchant</li>
      </ul>

      <h2 style={h2Style}>2. How We Use Data</h2>
      <p>
        All shopper data is collected and processed solely to provide analytics to
        the Merchant who operates that store. We use the data to:
      </p>
      <ul style={ulStyle}>
        <li>Display real-time cart activity in the Merchant's CartLens dashboard</li>
        <li>Show cart history, conversion status, and session details</li>
        <li>Generate aggregated analytics (top products, referrer sources, conversion rates)</li>
      </ul>
      <p>
        We do not sell shopper data, share it with third parties, or use it for
        advertising purposes.
      </p>

      <h2 style={h2Style}>3. Data Storage and Retention</h2>
      <p>
        Data is stored in a secure database associated with the Merchant's store.
        Merchants can configure a data retention period in the app settings. By
        default, cart session data is retained for 90 days. Data older than the
        configured retention period is automatically deleted.
      </p>

      <h2 style={h2Style}>4. Data Sharing</h2>
      <p>
        We do not share personal data with third parties except as necessary to
        operate the app (e.g., cloud infrastructure providers). All infrastructure
        providers are bound by data processing agreements consistent with applicable
        privacy law.
      </p>

      <h2 style={h2Style}>5. Shopper Rights (GDPR / CCPA)</h2>
      <p>
        If you are a shopper whose data has been collected by a store using CartLens,
        your privacy rights are governed by the Merchant's own privacy policy. To
        request access to or deletion of your data, contact the store where you shopped.
      </p>
      <p>
        When a Merchant receives a data request or deletion request, CartLens
        processes it as follows:
      </p>
      <ul style={ulStyle}>
        <li>
          <strong>Data access requests:</strong> We provide the Merchant with all
          cart session data associated with the customer's ID or email address.
        </li>
        <li>
          <strong>Data deletion requests:</strong> We permanently delete all cart
          session records associated with the customer's ID or email address.
        </li>
        <li>
          <strong>Store uninstall:</strong> When a Merchant uninstalls CartLens,
          all data associated with their store is permanently deleted within 48 hours.
        </li>
      </ul>

      <h2 style={h2Style}>6. Merchant Rights</h2>
      <p>
        Merchants may request deletion of all data associated with their store at
        any time by uninstalling CartLens or contacting us at the address below.
        Upon uninstall, all store data is automatically purged.
      </p>

      <h2 style={h2Style}>7. Security</h2>
      <p>
        All data is transmitted over HTTPS. We follow industry-standard security
        practices to protect stored data. Webhook payloads from Shopify are
        verified using HMAC signatures to prevent unauthorized access.
      </p>

      <h2 style={h2Style}>8. Children's Privacy</h2>
      <p>
        CartLens is a business tool intended for use by Shopify merchants. We do
        not knowingly collect data from children under the age of 13.
      </p>

      <h2 style={h2Style}>9. Changes to This Policy</h2>
      <p>
        We may update this Privacy Policy from time to time. We will notify
        Merchants of material changes by updating the date at the top of this page.
        Continued use of CartLens after changes constitutes acceptance of the
        updated policy.
      </p>

      <h2 style={h2Style}>10. Contact</h2>
      <p>
        For privacy-related questions or requests, contact us at:
      </p>
      <p>
        <strong>CartLens Support</strong><br />
        Email: <a href="mailto:alexanderwedeen+cartlens@gmail.com" style={{ color: "#1a1a1a" }}>alexanderwedeen+cartlens@gmail.com</a>
      </p>
    </div>
  );
}

const h2Style: React.CSSProperties = {
  fontSize: "18px",
  fontWeight: "600",
  marginTop: "40px",
  marginBottom: "12px",
  borderBottom: "1px solid #e5e5e5",
  paddingBottom: "8px",
};

const h3Style: React.CSSProperties = {
  fontSize: "15px",
  fontWeight: "600",
  marginTop: "24px",
  marginBottom: "8px",
};

const ulStyle: React.CSSProperties = {
  paddingLeft: "24px",
  marginBottom: "16px",
};
