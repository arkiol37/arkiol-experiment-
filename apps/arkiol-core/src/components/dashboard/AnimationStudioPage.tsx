"use client";
// AnimationStudioPage — renders within the SidebarLayout.
// Uses normal flow (not fixed overlay) so it stays properly
// constrained within the main content area beside the sidebar.

import React from "react";
import Link from "next/link";
import { AnimationStudioView } from "./AnimationStudioView";

export function AnimationStudioPage() {
  return (
    <div style={{
      display: "flex", flexDirection: "column",
      minHeight: "100vh", width: "100%",
      overflow: "hidden",
    }}>
      {/* Top chrome bar */}
      <div style={{
        height: 52, flexShrink: 0, display: "flex", alignItems: "center",
        gap: 14, padding: "0 20px",
        borderBottom: "1px solid var(--border)",
        background: "var(--bg-surface)",
      }}>
        <Link
          href="/dashboard"
          style={{
            display: "flex", alignItems: "center", gap: 6,
            fontSize: 12.5, color: "var(--text-muted)", textDecoration: "none",
            fontWeight: 500, padding: "5px 10px", borderRadius: "var(--radius-sm)",
            transition: "color var(--transition-fast)",
          }}
          onMouseEnter={e => ((e.currentTarget as HTMLElement).style.color = "var(--text-primary)")}
          onMouseLeave={e => ((e.currentTarget as HTMLElement).style.color = "var(--text-muted)")}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
          Back to Dashboard
        </Link>

        <div style={{ width: 1, height: 18, background: "var(--border)" }} />

        <span style={{ fontSize: 13, fontWeight: 400, fontFamily: "var(--font-display)", letterSpacing: "-0.02em", color: "var(--text-primary)" }}>
          Arkiol
        </span>
        <span style={{ fontSize: 12.5, color: "var(--text-muted)", fontWeight: 400 }}>/ Animation Studio</span>

        <div style={{ flex: 1 }} />

        <span style={{
          fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase",
          color: "#4f8ef7", background: "rgba(79,142,247,.10)",
          border: "1px solid rgba(79,142,247,.22)",
          padding: "2px 10px", borderRadius: "var(--radius-full)",
        }}>
          Animation Studio
        </span>
      </div>

      {/* Studio content — scrollable */}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden" }}>
        <AnimationStudioView />
      </div>
    </div>
  );
}
