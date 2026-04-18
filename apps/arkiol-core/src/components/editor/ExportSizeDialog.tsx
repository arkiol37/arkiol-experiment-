"use client";
// ExportSizeDialog — lets the user pick the final output size when exporting.
//
// Modes:
//   • Original  → export at the current artboard dimensions (no resize)
//   • Preset    → pick from common platform presets
//   • Custom    → type W × H directly
//
// When the target size differs from the artboard, the caller is responsible
// for adapting the rendered pixels via a "fit" strategy:
//   • contain  → preserve aspect, letterbox onto target
//   • cover    → preserve aspect, crop to fill target
//   • stretch  → non-uniform scale to match target exactly

import React, { useEffect, useMemo, useState } from "react";

export type ExportFit = "contain" | "cover" | "stretch";
export type ExportFormat = "png" | "jpg" | "pdf";

export interface ExportSizePreset {
  label: string;
  w: number;
  h: number;
  group?: string;
}

const DEFAULT_PRESETS: ExportSizePreset[] = [
  { label: "Instagram Post",    w: 1080, h: 1080, group: "Social"  },
  { label: "Instagram Story",   w: 1080, h: 1920, group: "Social"  },
  { label: "Facebook Post",     w: 1200, h: 630,  group: "Social"  },
  { label: "Twitter/X",         w: 1600, h: 900,  group: "Social"  },
  { label: "LinkedIn Post",     w: 1200, h: 627,  group: "Social"  },
  { label: "YouTube Thumb",     w: 1280, h: 720,  group: "Video"   },
  { label: "Presentation 16:9", w: 1920, h: 1080, group: "Video"   },
  { label: "A4 Poster",         w: 2480, h: 3508, group: "Print"   },
  { label: "US Letter",         w: 2550, h: 3300, group: "Print"   },
  { label: "Business Card",     w: 1050, h: 600,  group: "Print"   },
];

interface Props {
  format: ExportFormat;
  originalW: number;
  originalH: number;
  onCancel: () => void;
  onConfirm: (targetW: number, targetH: number, fit: ExportFit) => void;
}

export function ExportSizeDialog({ format, originalW, originalH, onCancel, onConfirm }: Props) {
  const [mode, setMode]       = useState<"original" | "preset" | "custom">("original");
  const [preset, setPreset]   = useState<ExportSizePreset | null>(null);
  const [customW, setCustomW] = useState<number>(originalW);
  const [customH, setCustomH] = useState<number>(originalH);
  const [fit, setFit]         = useState<ExportFit>("contain");

  const { targetW, targetH } = useMemo(() => {
    if (mode === "preset" && preset) return { targetW: preset.w, targetH: preset.h };
    if (mode === "custom")           return { targetW: clamp(customW), targetH: clamp(customH) };
    return { targetW: originalW, targetH: originalH };
  }, [mode, preset, customW, customH, originalW, originalH]);

  const isSame      = targetW === originalW && targetH === originalH;
  const srcAspect   = originalW / originalH;
  const tgtAspect   = targetW / targetH;
  const aspectDiff  = Math.abs(srcAspect - tgtAspect) > 0.005;

  // Submit on Enter, cancel on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter" && !(e.target as HTMLElement)?.matches("input,textarea")) {
        onConfirm(targetW, targetH, fit);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [targetW, targetH, fit, onCancel, onConfirm]);

  const grouped = useMemo(() => {
    const map = new Map<string, ExportSizePreset[]>();
    for (const p of DEFAULT_PRESETS) {
      const g = p.group ?? "Other";
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(p);
    }
    return Array.from(map.entries());
  }, []);

  return (
    <div
      onClick={onCancel}
      style={{
        position: "fixed", inset: 0, zIndex: 30000,
        background: "rgba(0,0,0,0.72)",
        display: "flex", alignItems: "center", justifyContent: "center",
        animation: "ak-fade-in-fast 120ms ease",
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: "var(--bg-elevated)",
          border: "1px solid var(--border-strong)",
          borderRadius: 14, padding: 22, width: "min(520px, 92vw)",
          maxHeight: "86vh", overflowY: "auto",
          boxShadow: "var(--shadow-xl, 0 16px 40px rgba(0,0,0,0.6))",
          color: "var(--text-primary)",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800 }}>Export as {format.toUpperCase()}</div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
              Choose an output size. The design will be adapted to fit.
            </div>
          </div>
          <button
            onClick={onCancel}
            aria-label="Close"
            style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 18 }}
          >✕</button>
        </div>

        {/* Mode tabs */}
        <div style={{ display: "flex", gap: 4, marginBottom: 12, background: "var(--bg-surface)", padding: 3, borderRadius: 8, border: "1px solid var(--border)" }}>
          {([
            ["original", `Original · ${originalW}×${originalH}`],
            ["preset",   "Preset"],
            ["custom",   "Custom"],
          ] as const).map(([k, lbl]) => (
            <button
              key={k}
              onClick={() => setMode(k)}
              style={{
                flex: 1, padding: "7px 10px", fontSize: 12, fontWeight: 700,
                borderRadius: 6, cursor: "pointer", border: "none",
                background: mode === k ? "var(--accent-tint-md)" : "transparent",
                color: mode === k ? "var(--accent-light)" : "var(--text-secondary)",
              }}
            >{lbl}</button>
          ))}
        </div>

        {/* Body */}
        {mode === "original" && (
          <div style={{ fontSize: 12, color: "var(--text-secondary)", padding: "10px 2px" }}>
            The design will be exported at its current artboard size ({originalW}×{originalH} px) with no resizing.
          </div>
        )}

        {mode === "preset" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {grouped.map(([grp, items]) => (
              <div key={grp}>
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-muted)", marginBottom: 5 }}>{grp}</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 5 }}>
                  {items.map(p => {
                    const active = preset?.label === p.label;
                    return (
                      <button
                        key={p.label}
                        onClick={() => setPreset(p)}
                        style={{
                          textAlign: "left", padding: "8px 10px", fontSize: 12,
                          borderRadius: 6, cursor: "pointer",
                          background: active ? "var(--accent-tint-md)" : "var(--bg-surface)",
                          border: `1px solid ${active ? "var(--border-accent)" : "var(--border)"}`,
                          color: active ? "var(--accent-light)" : "var(--text-secondary)",
                        }}
                      >
                        <div style={{ fontWeight: 700 }}>{p.label}</div>
                        <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2, fontFamily: "var(--font-mono)" }}>
                          {p.w}×{p.h}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {mode === "custom" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <NumField label="Width (px)"  value={customW} onChange={setCustomW} />
            <NumField label="Height (px)" value={customH} onChange={setCustomH} />
          </div>
        )}

        {/* Fit strategy — only when the aspect ratio changes and resize is actually happening */}
        {!isSame && aspectDiff && (
          <div style={{ marginTop: 14, padding: 10, background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 8 }}>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-muted)", marginBottom: 6 }}>
              Fit — aspect ratio changes
            </div>
            <div style={{ display: "flex", gap: 5 }}>
              {([
                ["contain", "Fit",     "Preserve aspect · letterbox"],
                ["cover",   "Fill",    "Preserve aspect · crop"],
                ["stretch", "Stretch", "Ignore aspect"],
              ] as const).map(([k, lbl, hint]) => (
                <button
                  key={k}
                  onClick={() => setFit(k)}
                  title={hint}
                  style={{
                    flex: 1, padding: "8px 6px", fontSize: 11, fontWeight: 700,
                    borderRadius: 6, cursor: "pointer",
                    background: fit === k ? "var(--accent-tint-md)" : "var(--bg-elevated)",
                    border: `1px solid ${fit === k ? "var(--border-accent)" : "var(--border-strong)"}`,
                    color: fit === k ? "var(--accent-light)" : "var(--text-secondary)",
                  }}
                >
                  <div>{lbl}</div>
                  <div style={{ fontSize: 9, color: "var(--text-muted)", marginTop: 2, fontWeight: 500 }}>{hint}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Summary + actions */}
        <div style={{ marginTop: 18, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
            Output: <span style={{ color: "var(--text-secondary)" }}>{targetW}×{targetH}</span>
            {!isSame && (
              <span style={{ marginLeft: 8, color: "var(--accent-light)" }}>
                · {aspectDiff ? fit : "resize"}
              </span>
            )}
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              onClick={onCancel}
              style={{ padding: "8px 14px", fontSize: 12, fontWeight: 600, borderRadius: 6, cursor: "pointer", background: "none", color: "var(--text-secondary)", border: "1px solid var(--border-strong)" }}
            >Cancel</button>
            <button
              onClick={() => onConfirm(targetW, targetH, fit)}
              disabled={mode === "preset" && !preset}
              style={{
                padding: "8px 18px", fontSize: 12, fontWeight: 700, borderRadius: 6,
                cursor: mode === "preset" && !preset ? "not-allowed" : "pointer",
                background: "var(--accent)", color: "#fff", border: "none",
                opacity: mode === "preset" && !preset ? 0.5 : 1,
              }}
            >Export</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function clamp(v: number): number {
  if (!Number.isFinite(v)) return 100;
  return Math.min(16384, Math.max(16, Math.round(v)));
}

function NumField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-muted)" }}>{label}</span>
      <input
        type="number"
        value={value}
        min={16}
        max={16384}
        onChange={e => onChange(Number(e.target.value) || 0)}
        style={{
          padding: "8px 10px", fontSize: 13, borderRadius: 6,
          background: "var(--bg-input)", color: "var(--text-primary)",
          border: "1px solid var(--border-strong)", outline: "none",
          fontFamily: "var(--font-mono)",
        }}
      />
    </label>
  );
}

// ─── Pure helper: compute source→target draw rect for smart-fit ──────────────
// Exposed so the caller can implement the actual pixel render.
export function computeFitRect(
  srcW: number, srcH: number,
  tgtW: number, tgtH: number,
  fit: ExportFit,
): { dx: number; dy: number; dw: number; dh: number } {
  if (fit === "stretch" || srcW === 0 || srcH === 0) {
    return { dx: 0, dy: 0, dw: tgtW, dh: tgtH };
  }
  const srcAspect = srcW / srcH;
  const tgtAspect = tgtW / tgtH;
  if (fit === "cover") {
    if (srcAspect > tgtAspect) {
      const dh = tgtH;
      const dw = dh * srcAspect;
      return { dx: (tgtW - dw) / 2, dy: 0, dw, dh };
    }
    const dw = tgtW;
    const dh = dw / srcAspect;
    return { dx: 0, dy: (tgtH - dh) / 2, dw, dh };
  }
  // contain
  if (srcAspect > tgtAspect) {
    const dw = tgtW;
    const dh = dw / srcAspect;
    return { dx: 0, dy: (tgtH - dh) / 2, dw, dh };
  }
  const dh = tgtH;
  const dw = dh * srcAspect;
  return { dx: (tgtW - dw) / 2, dy: 0, dw, dh };
}
