"use client";
// CanvasViewport — a flexible workspace container that scales any template
// size proportionally within the available viewport area.
//
// Behavior:
//   • Canvas is always centered with consistent padding
//   • Templates of any dimension are scaled to fit naturally
//   • Ctrl+Scroll zooms; double-click resets to fit
//   • Background provides visual separation (checkerboard pasteboard)

import React, { useRef, useCallback, useEffect } from "react";

// ── Fit zoom calculation ───────────────────────────────────────────────────
// Computes the zoom level that fits the canvas inside the available viewport
// with breathing room on all sides. When called with explicit viewport
// dimensions (from a measured container), uses those; otherwise estimates
// from window.innerWidth/Height minus chrome offsets.

export function fitZoom(
  canvasWidth: number,
  canvasHeight: number,
  viewportWidth?: number,
  viewportHeight?: number,
): number {
  const vw = viewportWidth ?? (typeof window !== "undefined" ? window.innerWidth - 80 : 1200);
  const vh = viewportHeight ?? (typeof window !== "undefined" ? window.innerHeight - 140 : 700);
  if (vw <= 0 || vh <= 0) return 0.35;
  const scaleX = vw / canvasWidth;
  const scaleY = vh / canvasHeight;
  // Cap at 1.0 so we never upscale beyond native resolution, floor at 0.08
  const raw = Math.min(scaleX, scaleY, 1.0);
  return Math.max(0.08, +raw.toFixed(3));
}

// ── Props ──────────────────────────────────────────────────────────────────

interface CanvasViewportProps {
  canvasWidth: number;
  canvasHeight: number;
  zoom: number;
  onZoomChange: (zoom: number | ((prev: number) => number)) => void;
  children: React.ReactNode;
}

// ── Component ──────────────────────────────────────────────────────────────

export function CanvasViewport({
  canvasWidth,
  canvasHeight,
  zoom,
  onZoomChange,
  children,
}: CanvasViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Ctrl+Scroll zoom
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const factor = e.deltaY > 0 ? 0.92 : 1.08;
      onZoomChange(z => Math.min(3, Math.max(0.05, +(z * factor).toFixed(3))));
    };

    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [onZoomChange]);

  // Double-click to fit
  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    if (e.target !== containerRef.current) return;
    const rect = containerRef.current!.getBoundingClientRect();
    onZoomChange(fitZoom(canvasWidth, canvasHeight, rect.width - 80, rect.height - 80));
  }, [canvasWidth, canvasHeight, onZoomChange]);

  const scaledW = canvasWidth * zoom;
  const scaledH = canvasHeight * zoom;

  return (
    <div
      ref={containerRef}
      onDoubleClick={handleDoubleClick}
      style={{
        width: "100%",
        height: "100%",
        overflow: "auto",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--bg-base, #1a1a1e)",
        // Subtle checkerboard pasteboard pattern
        backgroundImage: `
          linear-gradient(45deg, rgba(255,255,255,0.015) 25%, transparent 25%),
          linear-gradient(-45deg, rgba(255,255,255,0.015) 25%, transparent 25%),
          linear-gradient(45deg, transparent 75%, rgba(255,255,255,0.015) 75%),
          linear-gradient(-45deg, transparent 75%, rgba(255,255,255,0.015) 75%)
        `,
        backgroundSize: "20px 20px",
        backgroundPosition: "0 0, 0 10px, 10px -10px, -10px 0px",
        position: "relative",
        cursor: "default",
      }}
    >
      {/* Canvas wrapper — centered with shadow for depth */}
      <div
        style={{
          width: scaledW,
          height: scaledH,
          minWidth: scaledW,
          minHeight: scaledH,
          flexShrink: 0,
          position: "relative",
          boxShadow: "0 2px 24px rgba(0,0,0,0.35), 0 0 0 1px rgba(255,255,255,0.04)",
          borderRadius: 2,
          margin: 40,
          transition: "width 0.2s ease, height 0.2s ease",
        }}
      >
        {children}
      </div>
    </div>
  );
}
