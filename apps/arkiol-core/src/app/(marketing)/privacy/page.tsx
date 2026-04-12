// src/app/(marketing)/privacy/page.tsx
import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Privacy Policy — Arkiol", robots: "index, follow" };

export default function PrivacyPage() {
  const s: React.CSSProperties = { maxWidth: 720, margin: "0 auto", padding: "64px 24px" };
  const h2: React.CSSProperties = { fontSize: 18, fontWeight: 700, margin: "36px 0 12px", letterSpacing: "-0.02em" };
  const p: React.CSSProperties = { margin: "0 0 16px", fontSize: 14.5, color: "var(--text-secondary)", lineHeight: 1.75 };
  return (
    <div style={{ background: "var(--bg-base)", minHeight: "100vh" }}>
      <nav style={{ borderBottom: "1px solid var(--border)", padding: "0 24px", height: 56, display: "flex", alignItems: "center", gap: 10 }}>
        <Link href="/" style={{ display: "flex", alignItems: "center", gap: 8, textDecoration: "none" }}>
          <div style={{ width: 24, height: 24, borderRadius: 5, background: "linear-gradient(145deg, var(--accent), #9b5de5)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 800, color: "#fff" }}>A</div>
          <span style={{ fontWeight: 700, fontSize: 14, color: "var(--text-primary)", fontFamily: "var(--font-display)" }}>Arkiol</span>
        </Link>
      </nav>
      <div style={s}>
        <h1 style={{ fontSize: 34, fontWeight: 900, letterSpacing: "-0.04em", margin: "0 0 8px" }}>Privacy Policy</h1>
        <p style={{ ...p, color: "var(--text-muted)", marginBottom: 40 }}>Last updated: March 1, 2026</p>
        <p style={p}>Arkiol ("we", "us", "our") is committed to protecting your personal information and your right to privacy. This policy describes how we collect, use, and safeguard your data when you use our platform.</p>
        <h2 style={h2}>Information We Collect</h2>
        <p style={p}>We collect information you provide directly (name, email, organization details), information generated through use of our platform (generated assets, brand kits, job history), and technical information (IP address, browser type, usage analytics).</p>
        <h2 style={h2}>How We Use Your Information</h2>
        <p style={p}>We use your information to provide and improve our services, process payments, send important notices, and prevent fraud. We do not sell your personal data to third parties.</p>
        <h2 style={h2}>Data Storage & Security</h2>
        <p style={p}>Your data is stored on encrypted infrastructure (PostgreSQL on Neon/Railway, S3-compatible object storage). We use industry-standard security measures including TLS in transit and AES-256 at rest.</p>
        <h2 style={h2}>Generated Content</h2>
        <p style={p}>Assets you generate using Arkiol are stored in your account and are not used to train third-party AI models. Your brand kit data is encrypted and scoped strictly to your organization.</p>
        <h2 style={h2}>Data Retention</h2>
        <p style={p}>We retain your data for as long as your account is active, plus 90 days after deletion for backup purposes. You may request deletion of your data at any time.</p>
        <h2 style={h2}>Contact</h2>
        <p style={p}>For privacy questions, contact us at <a href="mailto:privacy@arkiol.com" style={{ color: "var(--accent)" }}>privacy@arkiol.com</a>.</p>
        <div style={{ marginTop: 48, paddingTop: 24, borderTop: "1px solid var(--border)" }}>
          <Link href="/" style={{ fontSize: 13, color: "var(--text-muted)", textDecoration: "none" }}>← Back to home</Link>
        </div>
      </div>
    </div>
  );
}
