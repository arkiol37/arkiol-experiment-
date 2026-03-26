"use client";
// CanvasFullPage — Canva-style full-screen workspace.
// Escapes the sidebar layout visually via fixed positioning while
// still inheriting session/auth from parent (dashboard) layout.
// Back-to-Dashboard control always visible in the top chrome.

import React from "react";
import Link from "next/link";
import { CanvasEditorShell } from "./CanvasEditorShell";

export function CanvasFullPage() {
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 200,
      background: "var(--bg-base)", display: "flex", flexDirection: "column",
      overflow: "hidden",
    }}>
      {/* Top chrome — shown only when not in active edit mode.
          CanvasEditorShell renders its own edit-mode bar (← New Canvas)
          so we wrap and only show chrome on the picker step.
          We use a lightweight wrapper here that always shows the back control. */}
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
          }}
          onMouseEnter={e => ((e.currentTarget as HTMLElement).style.color = "var(--text-primary)")}
          onMouseLeave={e => ((e.currentTarget as HTMLElement).style.color = "var(--text-muted)")}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
          Back to Dashboard
        </Link>

        <div style={{ width: 1, height: 18, background: "var(--border)" }} />

        <span style={{ fontSize: 13, fontWeight: 700, fontFamily: "var(--font-display)", letterSpacing: "-0.02em", color: "var(--text-primary)" }}>
          Arkiol
        </span>
        <span style={{ fontSize: 12.5, color: "var(--text-muted)", fontWeight: 400 }}>/ Canvas</span>

        <div style={{ flex: 1 }} />

        <span style={{
          fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase",
          color: "#6366f1", background: "rgba(79,70,229,.10)",
          border: "1px solid rgba(79,70,229,.22)",
          padding: "2px 10px", borderRadius: "var(--radius-full)",
        }}>
          Manual Editor
        </span>
      </div>

      {/* Canvas content */}
      <div style={{ flex: 1, overflow: "auto" }}>
        <CanvasEditorShell />
      </div>
    </div>
  );
}
