// Public route — no Shopify auth required
import React from "react";

const h2Style: React.CSSProperties = {
  fontSize: "19px",
  fontWeight: "700",
  marginTop: "40px",
  marginBottom: "12px",
  borderBottom: "1px solid #e5e5e5",
  paddingBottom: "8px",
};

const ulStyle: React.CSSProperties = {
  paddingLeft: "24px",
  marginBottom: "16px",
};

export default function TermsOfService() {
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
        CartLens Terms of Service
      </h1>
      <p style={{ color: "#666", marginBottom: "40px" }}>
        Last updated: February 21, 2026
      </p>

      <p>
        These Terms of Service ("Terms") govern your access to and use of CartLens ("the App"), a Shopify
        application developed and operated by Horizon Motorsport Inc ("we", "us", or "our"). By installing
        or using CartLens, you ("Merchant") agree to these Terms in full.
      </p>

      <h2 style={h2Style}>1. Description of Service</h2>
      <p>
        CartLens is a Shopify embedded application that provides real-time cart activity tracking and
        conversion analytics for Shopify store owners. The App collects cart events, session data, and
        funnel metrics from your store's shoppers and displays them in a merchant-facing dashboard.
      </p>

      <h2 style={h2Style}>2. Eligibility</h2>
      <p>
        To use CartLens, you must have an active Shopify store and a valid Shopify account. You must be
        authorized to enter into agreements on behalf of the business operating the store.
      </p>

      <h2 style={h2Style}>3. Subscription and Billing</h2>
      <p>
        CartLens offers a paid subscription plan ("Essential") billed through Shopify's billing system.
        Pricing, trial periods, and billing cycles are displayed at the time of installation and in the
        Shopify Partner Dashboard. All billing is handled by Shopify and subject to{" "}
        <a href="https://www.shopify.com/legal/terms" style={{ color: "#1a1a1a" }}>Shopify's Terms of Service</a>.
      </p>
      <ul style={ulStyle}>
        <li>You may cancel your subscription at any time by uninstalling the App from your Shopify admin.</li>
        <li>Charges are non-refundable except where required by applicable law.</li>
        <li>We reserve the right to change pricing with reasonable advance notice.</li>
      </ul>

      <h2 style={h2Style}>4. Merchant Responsibilities</h2>
      <p>You are responsible for:</p>
      <ul style={ulStyle}>
        <li>Ensuring your use of CartLens complies with applicable privacy laws (including GDPR, CCPA, and any other laws applicable to your store's customers).</li>
        <li>Informing your shoppers about the data CartLens collects through your store's privacy policy.</li>
        <li>Not using CartLens to collect, process, or store data in a manner that violates applicable law.</li>
        <li>Maintaining the security of your Shopify account credentials.</li>
      </ul>

      <h2 style={h2Style}>5. Data and Privacy</h2>
      <p>
        CartLens collects and processes shopper data on your behalf as a data processor. Our collection
        and use of data is described in the{" "}
        <a href="/privacy" style={{ color: "#1a1a1a" }}>CartLens Privacy Policy</a>. By using CartLens,
        you agree to our data practices as described therein.
      </p>
      <p>
        Upon uninstallation, all data associated with your store is permanently deleted from our systems
        within a reasonable timeframe.
      </p>

      <h2 style={h2Style}>6. Acceptable Use</h2>
      <p>You agree not to:</p>
      <ul style={ulStyle}>
        <li>Use CartLens for any unlawful purpose or in violation of Shopify's Partner Program Agreement.</li>
        <li>Attempt to reverse-engineer, decompile, or otherwise extract the source code of the App.</li>
        <li>Resell, sublicense, or otherwise transfer your rights to use CartLens to any third party.</li>
        <li>Interfere with or disrupt the integrity or performance of the App or its infrastructure.</li>
      </ul>

      <h2 style={h2Style}>7. Intellectual Property</h2>
      <p>
        CartLens and all associated intellectual property, including but not limited to the software,
        design, and branding, remain the exclusive property of Horizon Motorsport Inc. These Terms do
        not grant you any ownership interest in the App.
      </p>

      <h2 style={h2Style}>8. Disclaimer of Warranties</h2>
      <p>
        CartLens is provided "as is" without warranty of any kind. We do not warrant that the App will
        be uninterrupted, error-free, or that data will be accurate or complete at all times. Analytics
        data is provided for informational purposes and should not be relied upon as the sole basis for
        business decisions.
      </p>

      <h2 style={h2Style}>9. Limitation of Liability</h2>
      <p>
        To the maximum extent permitted by applicable law, Horizon Motorsport Inc shall not be liable
        for any indirect, incidental, special, consequential, or punitive damages arising from your use
        of CartLens. Our total liability to you for any claims arising under these Terms shall not exceed
        the amount you paid for the App in the three months preceding the claim.
      </p>

      <h2 style={h2Style}>10. Termination</h2>
      <p>
        Either party may terminate this agreement at any time. You may do so by uninstalling CartLens
        from your Shopify admin. We reserve the right to suspend or terminate access to CartLens for
        violations of these Terms or for any other reason with reasonable notice.
      </p>

      <h2 style={h2Style}>11. Changes to These Terms</h2>
      <p>
        We may update these Terms from time to time. Continued use of CartLens after changes are posted
        constitutes acceptance of the updated Terms. Material changes will be communicated through the
        App or via email.
      </p>

      <h2 style={h2Style}>12. Governing Law</h2>
      <p>
        These Terms are governed by the laws of the State of California, United States, without regard
        to conflict of law principles.
      </p>

      <h2 style={h2Style}>13. Contact</h2>
      <p>
        For questions about these Terms, contact us at:<br />
        <strong>CartLens Support</strong><br />
        Email:{" "}
        <a href="mailto:alexanderwedeen+cartlens@gmail.com" style={{ color: "#1a1a1a" }}>
          alexanderwedeen+cartlens@gmail.com
        </a>
      </p>

      <p style={{ marginTop: "48px", color: "#888", fontSize: "13px" }}>
        <a href="/privacy" style={{ color: "#888" }}>Privacy Policy</a>
        {" · "}
        <a href="/" style={{ color: "#888" }}>CartLens</a>
      </p>
    </div>
  );
}
