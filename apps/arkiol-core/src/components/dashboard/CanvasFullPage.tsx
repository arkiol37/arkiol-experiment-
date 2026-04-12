"use client";
// CanvasFullPage — Canva-style workspace.
// Renders within the SidebarLayout (normal flow) so it stays
// properly constrained within the main content area beside the sidebar.

import React from "react";
import Link from "next/link";
import { CanvasEditorShell } from "./CanvasEditorShell";

export function CanvasFullPage() {
  return (
    <div style={{
      display: "flex", flexDirection: "column",
      minHeight: "100vh", width: "100%",
      overflow: "hidden",
    }}>
      {/* Top chrome */}
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
        <span style={{ fontSize: 12.5, color: "var(--text-muted)", fontWeight: 400 }}>/ Canvas</span>

        <div style={{ flex: 1 }} />

        <span aria-label="Canvas workspace" style={{
          fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase",
          color: "#4f8ef7", background: "rgba(79,142,247,.10)",
          border: "1px solid rgba(79,142,247,.22)",
          padding: "2px 10px", borderRadius: "var(--radius-full)", cursor: "default", userSelect: "none",
        }}>
          Canvas Workspace
        </span>
      </div>

      {/* Canvas content */}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden" }}>
        <CanvasEditorShell />
      </div>
    </div>
  );
}
