// src/app/(dashboard)/animation-studio/upgrade/page.tsx
// Paywall/upgrade preview shown to users who lack canUseStudioVideo.
// Reuses AnimationStudioView's gated UI by forcing gated=true state.
// No new auth complexity — reads same /api/capabilities endpoint pattern.

"use client";

import Link from "next/link";

const FEATURES = [
  ["◫", "Normal Ads (2D)", "Smooth 2D animations — 20 credits"],
  ["✦", "Cinematic Ads (2.5D)", "Parallax depth & cinematic lighting — 35 credits"],
  ["🎨", "Auto brand integration", "Applies your brand kit automatically"],
  ["📐", "All ad formats", "Posts, stories, banners & more"],
  ["⚡", "Real-time progress", "Live render stages with progress tracking"],
  ["📥", "Direct download", "Export MP4 video files instantly"],
];

export default function AnimationStudioUpgradePage() {
  return (
    <div className="ak-fade-in" style={{ padding: "60px 48px", maxWidth: 720, margin: "0 auto", textAlign: "center" }}>
      {/* Back link */}
      <div style={{ textAlign: "left", marginBottom: 32 }}>
        <Link href="/dashboard" style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12.5, color: "var(--text-muted)", textDecoration: "none", fontWeight: 500 }}
          onMouseEnter={e => ((e.currentTarget as HTMLElement).style.color = "var(--text-primary)")}
          onMouseLeave={e => ((e.currentTarget as HTMLElement).style.color = "var(--text-muted)")}>
          ← Back to Dashboard
        </Link>
      </div>

      {/* Hero */}
      <div style={{ width: 72, height: 72, borderRadius: "var(--radius-2xl)", background: "rgba(124,58,237,.12)", border: "1px solid rgba(124,58,237,.25)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 34, margin: "0 auto 20px" }}>
        🎬
      </div>
      <h1 style={{ fontSize: 30, fontWeight: 800, fontFamily: "var(--font-display)", letterSpacing: "-0.04em", margin: "0 0 12px" }}>
        Animation Studio
      </h1>
      <p style={{ fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.7, marginBottom: 36, maxWidth: 480, margin: "0 auto 36px" }}>
        Generate professional Normal Ads (2D) and Cinematic Ads (2.5D) from a single prompt.
        Available on <strong>Creator, Pro, and Studio</strong> plans.
      </p>

      {/* Feature grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 36, textAlign: "left" }}>
        {FEATURES.map(([icon, label, desc]) => (
          <div key={String(label)} className="ak-card" style={{ padding: "16px 18px" }}>
            <span style={{ fontSize: 22 }}>{icon}</span>
            <div style={{ fontSize: 13, fontWeight: 600, margin: "8px 0 3px", color: "var(--text-primary)" }}>{label}</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>{desc}</div>
          </div>
        ))}
      </div>

      {/* CTA */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
        <a href="/billing" className="ak-btn ak-btn-primary" style={{ padding: "13px 40px", fontSize: 15, width: "100%", maxWidth: 320, textDecoration: "none", display: "block", textAlign: "center" }}>
          Upgrade to unlock Animation Studio →
        </a>
        <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>From $25/month · Cancel anytime</p>
      </div>
    </div>
  );
}
