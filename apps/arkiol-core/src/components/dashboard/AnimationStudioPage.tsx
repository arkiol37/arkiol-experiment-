"use client";
// AnimationStudioPage — full-screen wrapper around AnimationStudioView.
// Uses a fixed full-screen overlay so it escapes the sidebar layout visually
// while still inheriting session/auth from the parent (dashboard) layout.

import React from "react";
import Link from "next/link";
import { AnimationStudioView } from "./AnimationStudioView";

export function AnimationStudioPage() {
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 200,
      background: "var(--bg-base)", display: "flex", flexDirection: "column",
      overflow: "hidden",
    }}>
      {/* Top chrome bar — consistent with CanvasEditorShell pattern */}
      <div style={{
        height: 52, flexShrink: 0, display: "flex", alignItems: "center",
        gap: 14, padding: "0 20px",
        borderBottom: "1px solid var(--border)",
        background: "var(--bg-surface)",
        zIndex: 201,
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

        {/* Wordmark */}
        <span style={{ fontSize: 13, fontWeight: 700, fontFamily: "var(--font-display)", letterSpacing: "-0.02em", color: "var(--text-primary)" }}>
          Arkiol
        </span>
        <span style={{ fontSize: 12.5, color: "var(--text-muted)", fontWeight: 400 }}>/ Animation Studio</span>

        <div style={{ flex: 1 }} />

        <span style={{
          fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase",
          color: "#7c3aed", background: "rgba(124,58,237,.10)",
          border: "1px solid rgba(124,58,237,.22)",
          padding: "2px 10px", borderRadius: "var(--radius-full)",
        }}>
          Studio
        </span>
      </div>

      {/* Studio content — scrollable */}
      <div style={{ flex: 1, overflow: "auto" }}>
        <AnimationStudioView />
      </div>
    </div>
  );
}
