"use client";
// CanvasViewport — professional workspace container for the editor canvas.
//
// Responsibilities:
//   • Scales any template proportionally within the available workspace.
//   • Centers the artboard when it fits, gives comfortable scroll padding
//     when it doesn't (so a 200% zoom still has breathing room on every side).
//   • Neutral pasteboard background with subtle texture — like a design-tool
//     workspace rather than a flat page.
//   • Ctrl/Cmd+scroll zooms symmetrically; double-clicking the pasteboard
//     resets to measured-container fit.
//
// Zoom behavior (Step 27):
//   • 100% = native pixel scale (1080px template draws at 1080px on screen).
//   • fitZoom clamps to 1.0 max so initial fit never upscales.
//   • Wheel zoom uses exact-inverse factors so scroll-up-then-scroll-down
//     returns to the same value (no drift).
//   • +/− buttons snap to canonical ZOOM_STOPS.
//
// Workspace layout (Step 28):
//   • CANVAS_VIEWPORT_CHROME constant is the padding every caller reserves
//     around the canvas; changing it here updates fit-to-screen math
//     across the editor surface in one place.
//   • Center-wrapper with min-w/h 100% + padding so flex centering works
//     when canvas fits AND scroll has breathing room when canvas overflows.

import React, { useRef, useCallback, useEffect } from "react";

// ── Zoom constants (Step 27) ──────────────────────────────────────────────

export const ZOOM_MIN = 0.05;
export const ZOOM_MAX = 4.0;

// Canonical stops the +/− buttons snap between.
export const ZOOM_STOPS = [
  0.05, 0.10, 0.15, 0.25, 0.33, 0.50, 0.67, 0.75,
  1.0, 1.25, 1.5, 2.0, 3.0, 4.0,
];

// Wheel zoom per-tick factor. Exact inverses so scroll-up then scroll-down
// returns to the same zoom — prevents the slow drift the previous 0.92/1.08
// pair caused over many ticks.
export const ZOOM_WHEEL_FACTOR = 1.1;
export const ZOOM_WHEEL_DOWN   = 1 / ZOOM_WHEEL_FACTOR;

export function zoomStepUp(current: number): number {
  for (const s of ZOOM_STOPS) { if (s > current + 0.005) return s; }
  return ZOOM_MAX;
}

export function zoomStepDown(current: number): number {
  for (let i = ZOOM_STOPS.length - 1; i >= 0; i--) {
    if (ZOOM_STOPS[i] < current - 0.005) return ZOOM_STOPS[i];
  }
  return ZOOM_MIN;
}

export function clampZoom(z: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, +z.toFixed(3)));
}

// ── Workspace padding (Step 28) ───────────────────────────────────────────

// Reserved space between the artboard and the workspace edges. Matches the
// inner wrapper padding below (PASTEBOARD_PAD * 2) plus a couple of pixels
// for the shadow spill. Exported so FullPageEditor / ArkiolEditor subtract
// the exact same amount when computing initial fit.
export const PASTEBOARD_PAD = 48;
export const CANVAS_VIEWPORT_CHROME = PASTEBOARD_PAD * 2; // 96px total

// Measure a workspace container's inner area — i.e. the space actually
// available to the artboard after the pasteboard padding is reserved.
// Returns null when the element isn't yet sized (flex layout unsettled).
export function measureWorkspace(el: HTMLElement | null): { availW: number; availH: number } | null {
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  const availW = rect.width  - CANVAS_VIEWPORT_CHROME;
  const availH = rect.height - CANVAS_VIEWPORT_CHROME;
  if (availW <= 0 || availH <= 0) return null;
  return { availW, availH };
}

// ── Fit zoom calculation ──────────────────────────────────────────────────

export function fitZoom(
  canvasWidth: number,
  canvasHeight: number,
  viewportWidth?: number,
  viewportHeight?: number,
): number {
  // Window fallback is a *last resort* — callers should measure their own
  // container after mount and pass real dimensions (see FullPageEditor's
  // canvasAreaRef / ArkiolEditor's containerRef usage).
  const vw = viewportWidth  ?? (typeof window !== "undefined" ? Math.max(0, window.innerWidth  - CANVAS_VIEWPORT_CHROME) : 1200);
  const vh = viewportHeight ?? (typeof window !== "undefined" ? Math.max(0, window.innerHeight - CANVAS_VIEWPORT_CHROME - 60) : 700);
  if (vw <= 0 || vh <= 0 || canvasWidth <= 0 || canvasHeight <= 0) return 0.35;
  const scaleX = vw / canvasWidth;
  const scaleY = vh / canvasHeight;
  // Never upscale past 100% during initial fit.
  return clampZoom(Math.min(scaleX, scaleY, 1.0));
}

// ── Props ─────────────────────────────────────────────────────────────────

interface CanvasViewportProps {
  canvasWidth:  number;
  canvasHeight: number;
  zoom:         number;
  onZoomChange: (zoom: number | ((prev: number) => number)) => void;
  children:     React.ReactNode;
}

// ── Component ─────────────────────────────────────────────────────────────

export function CanvasViewport({
  canvasWidth,
  canvasHeight,
  zoom,
  onZoomChange,
  children,
}: CanvasViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Ctrl/Cmd + wheel zoom — exact-inverse factors so repeated ticks don't
  // drift. Non-ctrl wheel is left alone so normal scroll-to-pan works.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handleWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const factor = e.deltaY > 0 ? ZOOM_WHEEL_DOWN : ZOOM_WHEEL_FACTOR;
      onZoomChange(z => clampZoom(z * factor));
    };
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [onZoomChange]);

  // Double-click empty pasteboard resets to measured-fit (not the window
  // fallback). Clicking inside the canvas is unaffected because we bail
  // unless the target is the scroll container itself.
  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    if (e.target !== containerRef.current) return;
    const measured = measureWorkspace(containerRef.current);
    if (measured) {
      onZoomChange(fitZoom(canvasWidth, canvasHeight, measured.availW, measured.availH));
    }
  }, [canvasWidth, canvasHeight, onZoomChange]);

  const scaledW = canvasWidth  * zoom;
  const scaledH = canvasHeight * zoom;

  return (
    <div
      ref={containerRef}
      onDoubleClick={handleDoubleClick}
      style={{
        // The scroll container. Fills the parent; overflows in both axes
        // so the user can pan around a zoomed-in canvas.
        width:  "100%",
        height: "100%",
        overflow: "auto",
        position: "relative",
        // Neutral pro-tool workspace background with a subtle dot texture
        // so the edges of the canvas read clearly against the pasteboard.
        background: "var(--workspace-bg, #1e1f22)",
        backgroundImage:
          "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.025) 1px, transparent 0)",
        backgroundSize: "16px 16px",
        // Prevent children from forcing a narrower container when the
        // canvas area is aggressively zoomed in.
        minWidth: 0,
        minHeight: 0,
      }}
    >
      {/* Center-flex wrapper:
          - min-width/height 100% guarantees padding space is scrollable
            even when the artboard is smaller than the pasteboard.
          - Symmetric PASTEBOARD_PAD on all sides = comfortable breathing
            room + scroll buffer when zoomed in past fit. */}
      <div
        style={{
          minWidth:  "100%",
          minHeight: "100%",
          boxSizing: "border-box",
          padding:   PASTEBOARD_PAD,
          display:   "flex",
          alignItems:    "center",
          justifyContent:"center",
        }}
      >
        {/* Canvas wrapper — flex-shrink disabled so it always renders at
            its intended scaled size; the surrounding padding handles the
            scroll buffer. */}
        <div
          style={{
            width:  scaledW,
            height: scaledH,
            minWidth:  scaledW,
            minHeight: scaledH,
            flexShrink: 0,
            position:   "relative",
            boxShadow:  "0 4px 32px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.06)",
            borderRadius: 2,
            transition: "width 0.18s ease, height 0.18s ease",
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
