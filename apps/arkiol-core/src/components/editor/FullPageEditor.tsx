"use client";
// FullPageEditor — dedicated full-screen editing environment.
// Mounts ArkiolEditor inside a minimal chrome with:
//   • Own top bar (back, title, zoom controls, export button)
//   • No sidebar — full viewport for the canvas
//   • Smart export modal for size selection
//   • Canvas viewport that scales any template proportionally

import React, { useState, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { SmartExportModal } from "./SmartExportModal";
import { CanvasViewport, fitZoom, zoomStepUp, zoomStepDown, measureWorkspace } from "./CanvasViewport";
import { FORMAT_DIMS, CATEGORY_LABELS, type ArkiolCategory } from "../../lib/types";

const ArkiolEditor = dynamic(
  () => import("./ArkiolEditor").then(m => m.default ?? m.ArkiolEditor),
  { ssr: false, loading: () => <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: 13 }}>Loading editor…</div> },
);

// ── Types ──────────────────────────────────────────────────────────────────

interface EditorSearchParams {
  format?: string;
  projectId?: string;
  w?: string;
  h?: string;
}

// ── FullPageEditor ─────────────────────────────────────────────────────────

export function FullPageEditor() {
  // Parse URL search params for initial config
  const [params] = useState<EditorSearchParams>(() => {
    if (typeof window === "undefined") return {};
    const sp = new URLSearchParams(window.location.search);
    return {
      format: sp.get("format") ?? undefined,
      projectId: sp.get("projectId") ?? undefined,
      w: sp.get("w") ?? undefined,
      h: sp.get("h") ?? undefined,
    };
  });

  const format = params.format as ArkiolCategory | undefined;
  const dims = format && FORMAT_DIMS[format]
    ? FORMAT_DIMS[format]
    : { width: parseInt(params.w ?? "1080", 10) || 1080, height: parseInt(params.h ?? "1080", 10) || 1080 };

  const [showExportModal, setShowExportModal] = useState(false);
  const [zoom, setZoom] = useState(() => fitZoom(dims.width, dims.height));

  // Step 26 / 27: all "fit to screen" operations measure the actual canvas
  // area container instead of guessing from window dimensions. doFit() is
  // the single source of truth — used by the initial post-mount fit, the
  // Fit button (⊡), the 100%/Fit toggle, and the double-click-pasteboard
  // reset inside CanvasViewport.
  const canvasAreaRef = useRef<HTMLDivElement>(null);
  const doFit = useCallback(() => {
    const measured = measureWorkspace(canvasAreaRef.current);
    setZoom(
      measured
        ? fitZoom(dims.width, dims.height, measured.availW, measured.availH)
        : fitZoom(dims.width, dims.height),
    );
  }, [dims.width, dims.height]);

  // Post-mount fit — retries on rAF when the flex layout hasn't settled
  // yet. Re-runs when artboard dimensions change (format switch) so the
  // new canvas is centered on first paint.
  useLayoutEffect(() => {
    let rafId: number | null = null;
    let fitted = false;
    let attempts = 0;
    const tryFit = () => {
      if (fitted) return;
      const measured = measureWorkspace(canvasAreaRef.current);
      if (!measured) {
        if (attempts++ < 10) rafId = requestAnimationFrame(tryFit);
        return;
      }
      fitted = true;
      setZoom(fitZoom(dims.width, dims.height, measured.availW, measured.availH));
    };
    tryFit();
    return () => { if (rafId !== null) cancelAnimationFrame(rafId); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dims.width, dims.height]);

  const title = format ? CATEGORY_LABELS[format] ?? format : `${dims.width}×${dims.height}`;

  return (
    <>
      {/* ── Top bar ────────────────────────────────────────────── */}
      <div
        className="ak-editor-topbar"
        style={{
          height: 48, flexShrink: 0,
          display: "flex", alignItems: "center", gap: 10, padding: "0 16px",
          borderBottom: "1px solid var(--border)",
          background: "var(--bg-surface)",
          zIndex: 100,
        }}
      >
        {/* Back */}
        <Link
          href="/dashboard"
          aria-label="Back to dashboard"
          className="ak-editor-back"
          style={{
            display: "flex", alignItems: "center", gap: 5,
            fontSize: 12, color: "var(--text-muted)", textDecoration: "none",
            fontWeight: 500, padding: "4px 8px", borderRadius: 6,
            transition: "color 0.15s",
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "var(--text-primary)"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "var(--text-muted)"; }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M19 12H5M12 5l-7 7 7 7" /></svg>
          <span className="ak-hide-sm">Dashboard</span>
        </Link>

        <div className="ak-hide-sm" style={{ width: 1, height: 20, background: "var(--border)" }} />

        {/* Title */}
        <span
          className="ak-editor-title"
          style={{
            fontSize: 13, fontWeight: 600, color: "var(--text-primary)",
            letterSpacing: "-0.01em",
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            minWidth: 0,
          }}
        >
          {title}
        </span>
        <span className="ak-hide-sm" style={{ fontSize: 11, color: "var(--text-muted)" }}>
          {dims.width}×{dims.height}
        </span>

        <div style={{ flex: 1 }} />

        {/* Zoom controls */}
        <div className="ak-editor-zoom" style={{ display: "flex", alignItems: "center", gap: 2 }}>
          <ZoomBtn onClick={() => setZoom(z => zoomStepDown(z))} title="Zoom out">−</ZoomBtn>
          <span
            onClick={() => { const atFull = Math.abs(zoom - 1) < 0.02; if (atFull) doFit(); else setZoom(1); }}
            style={{
              fontSize: 11, minWidth: 44, textAlign: "center",
              color: "var(--text-secondary)", fontFamily: "var(--font-mono)",
              cursor: "pointer", padding: "2px 4px", userSelect: "none",
            }}
            title="Toggle 100% / Fit"
          >
            {Math.round(zoom * 100)}%
          </span>
          <ZoomBtn onClick={() => setZoom(z => zoomStepUp(z))} title="Zoom in">+</ZoomBtn>
          <span className="ak-hide-sm" style={{ display: "inline-flex" }}>
            <ZoomBtn onClick={doFit} title="Fit to screen">⊡</ZoomBtn>
          </span>
        </div>

        <div className="ak-hide-sm" style={{ width: 1, height: 20, background: "var(--border)" }} />

        {/* Export button */}
        <button
          onClick={() => setShowExportModal(true)}
          aria-label="Export"
          className="ak-editor-export"
          style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "6px 16px", borderRadius: 8,
            background: "var(--accent)", color: "#fff",
            border: "none", fontSize: 13, fontWeight: 600,
            cursor: "pointer", transition: "opacity 0.15s",
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = "0.88"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = "1"; }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" /></svg>
          <span className="ak-hide-sm">Export</span>
        </button>
      </div>

      {/* ── Canvas area ──────────────────────────────────────── */}
      <div ref={canvasAreaRef} style={{ flex: 1, minHeight: 0, position: "relative", overflow: "hidden" }}>
        <CanvasViewport
          canvasWidth={dims.width}
          canvasHeight={dims.height}
          zoom={zoom}
          onZoomChange={setZoom}
        >
          <ArkiolEditor
            canvasWidth={dims.width}
            canvasHeight={dims.height}
            projectId={params.projectId}
            format={format}
          />
        </CanvasViewport>
      </div>

      {/* ── Smart Export Modal ────────────────────────────────── */}
      {showExportModal && (
        <SmartExportModal
          currentWidth={dims.width}
          currentHeight={dims.height}
          currentFormat={format}
          onClose={() => setShowExportModal(false)}
          onExport={(opts) => {
            setShowExportModal(false);
            triggerExport(opts);
          }}
        />
      )}
    </>
  );
}

// ── Export trigger ──────────────────────────────────────────────────────────
// Bridges the modal selection to the ArkiolEditor listener via a CustomEvent.
// ArkiolEditor's `exportCanvas` reads `targetW`, `targetH`, `fit`, `scale` —
// names used to be mismatched (width/height) and silently dropped, so the
// size picker had no effect. Step 29 lines them up and forwards every field.

interface ExportOptions {
  width:  number;
  height: number;
  format: "png" | "jpg" | "svg" | "pdf";
  scale:  number;
  fit:    "contain" | "cover" | "stretch";
}

function triggerExport(opts: ExportOptions) {
  const fileName = `design_${opts.width}x${opts.height}.${opts.format}`;

  if (opts.format === "pdf") {
    window.print();
    return;
  }

  window.dispatchEvent(new CustomEvent("arkiol:export", {
    detail: {
      format:  opts.format,
      // Canonical names the ArkiolEditor listener expects.
      targetW: opts.width,
      targetH: opts.height,
      fit:     opts.fit,
      scale:   opts.scale,
      fileName,
    },
  }));
}

// ── Zoom button ────────────────────────────────────────────────────────────

function ZoomBtn({ children, onClick, title }: { children: React.ReactNode; onClick: () => void; title?: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        width: 28, height: 28,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "none", border: "1px solid var(--border)",
        borderRadius: 6, cursor: "pointer",
        color: "var(--text-secondary)", fontSize: 14,
        transition: "background 0.12s",
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "var(--bg-hover)"; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "none"; }}
    >
      {children}
    </button>
  );
}
