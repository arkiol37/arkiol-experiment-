// src/app/(marketing)/terms/page.tsx
import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Terms of Service — Arkiol", robots: "index, follow" };

export default function TermsPage() {
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
        <h1 style={{ fontSize: 34, fontWeight: 900, letterSpacing: "-0.04em", margin: "0 0 8px" }}>Terms of Service</h1>
        <p style={{ ...p, color: "var(--text-muted)", marginBottom: 40 }}>Last updated: March 1, 2026</p>
        <p style={p}>By using Arkiol, you agree to these terms. Please read them carefully. If you do not agree, do not use the service.</p>
        <h2 style={h2}>Acceptable Use</h2>
        <p style={p}>You may use Arkiol to create design assets for lawful purposes. You may not use the platform to generate content that infringes intellectual property, violates privacy, promotes illegal activity, or is otherwise harmful or deceptive.</p>
        <h2 style={h2}>Intellectual Property</h2>
        <p style={p}>You own the assets you generate using Arkiol (subject to the licenses of underlying AI models). Arkiol retains ownership of the platform, its codebase, and design system. You grant us a limited license to process your content to provide the service.</p>
        <h2 style={h2}>Credits & Billing</h2>
        <p style={p}>Credits are deducted at the time of generation. Unused paid credits roll over (up to plan limits). Daily free credits reset at midnight UTC. Credits are non-refundable except as required by applicable law.</p>
        <h2 style={h2}>Service Availability</h2>
        <p style={p}>We strive for high availability but do not guarantee uninterrupted service. Scheduled maintenance will be announced in advance. We are not liable for service interruptions beyond our reasonable control.</p>
        <h2 style={h2}>Termination</h2>
        <p style={p}>We may terminate or suspend your account for violations of these terms. You may cancel your account at any time. Upon termination, your data will be retained for 90 days before deletion.</p>
        <h2 style={h2}>Limitation of Liability</h2>
        <p style={p}>To the maximum extent permitted by law, Arkiol's liability is limited to the amount you paid in the 12 months preceding the claim. We are not liable for indirect, incidental, or consequential damages.</p>
        <h2 style={h2}>Contact</h2>
        <p style={p}>For legal questions, contact <a href="mailto:legal@arkiol.com" style={{ color: "var(--accent)" }}>legal@arkiol.com</a>.</p>
        <div style={{ marginTop: 48, paddingTop: 24, borderTop: "1px solid var(--border)" }}>
          <Link href="/" style={{ fontSize: 13, color: "var(--text-muted)", textDecoration: "none" }}>← Back to home</Link>
        </div>
      </div>
    </div>
  );
}
