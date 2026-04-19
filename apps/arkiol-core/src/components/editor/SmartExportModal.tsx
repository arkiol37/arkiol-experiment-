"use client";
// SmartExportModal — intelligent size-selection popup for design export.
//
// When the user clicks "Export", this modal appears with:
//   • Keep original size (default, one click)
//   • Platform presets (Instagram, Facebook, YouTube, etc.)
//   • Custom dimensions input
//   • Format selection (PNG, JPG, SVG, PDF)
//   • Scale multiplier (1×, 2×, 3×)
//   • Preview of how the design will adapt

import React, { useState, useMemo } from "react";
import { FORMAT_DIMS, type ArkiolCategory } from "../../lib/types";

// ── Export size presets ─────────────────────────────────────────────────────

interface SizePreset {
  id: string;
  label: string;
  group: string;
  width: number;
  height: number;
}

const SIZE_PRESETS: SizePreset[] = [
  // Social Media
  { id: "ig_post",       label: "Instagram Post",    group: "Social Media",     width: 1080, height: 1080 },
  { id: "ig_story",      label: "Instagram Story",   group: "Social Media",     width: 1080, height: 1920 },
  { id: "fb_post",       label: "Facebook Post",     group: "Social Media",     width: 1200, height: 630  },
  { id: "twitter",       label: "Twitter / X Post",  group: "Social Media",     width: 1600, height: 900  },
  { id: "linkedin",      label: "LinkedIn Post",     group: "Social Media",     width: 1200, height: 627  },
  { id: "tiktok",        label: "TikTok Video",      group: "Social Media",     width: 1080, height: 1920 },
  // Video
  { id: "yt_thumb",      label: "YouTube Thumbnail", group: "Video",            width: 1280, height: 720  },
  { id: "presentation",  label: "Presentation",      group: "Video",            width: 1920, height: 1080 },
  // Print
  { id: "flyer",         label: "Flyer (US Letter)",  group: "Print",           width: 2550, height: 3300 },
  { id: "poster",        label: "Poster (A3)",        group: "Print",           width: 2480, height: 3508 },
  { id: "biz_card",      label: "Business Card",      group: "Print",           width: 1050, height: 600  },
  // Branding
  { id: "logo",          label: "Logo",              group: "Branding",         width: 1000, height: 1000 },
  { id: "banner",        label: "Display Banner",    group: "Branding",         width: 728,  height: 90   },
];

// ── Props ──────────────────────────────────────────────────────────────────

export type ExportFit = "contain" | "cover" | "stretch";

interface SmartExportModalProps {
  currentWidth: number;
  currentHeight: number;
  currentFormat?: string;
  onClose: () => void;
  onExport: (opts: {
    width:  number;
    height: number;
    format: "png" | "jpg" | "svg" | "pdf";
    scale:  number;
    fit:    ExportFit;
  }) => void;
}

// Aspect-ratio difference under this threshold is treated as "effectively
// the same aspect" — Smart default stretches (no letterbox); above it we
// default to contain (letterbox, preserve the design's composition).
const ASPECT_DIFF_SIGNIFICANT = 0.02;

// ── Component ──────────────────────────────────────────────────────────────

export function SmartExportModal({
  currentWidth,
  currentHeight,
  currentFormat,
  onClose,
  onExport,
}: SmartExportModalProps) {
  const [selectedSize, setSelectedSize] = useState<"original" | "custom" | string>("original");
  const [customW, setCustomW] = useState(currentWidth);
  const [customH, setCustomH] = useState(currentHeight);
  const [exportFormat, setExportFormat] = useState<"png" | "jpg" | "svg" | "pdf">("png");
  const [scale, setScale] = useState(1);
  // Fit strategy: how the design is adapted when the target aspect differs
  // from the artboard. Default "contain" preserves the composition with a
  // letterbox; the user can switch to "cover" (crop) or "stretch" (distort).
  // Only shown when the chosen size has a different aspect ratio.
  const [fit, setFit] = useState<ExportFit>("contain");

  const exportDims = useMemo(() => {
    if (selectedSize === "original") return { width: currentWidth, height: currentHeight };
    if (selectedSize === "custom") return { width: customW, height: customH };
    const preset = SIZE_PRESETS.find(p => p.id === selectedSize);
    return preset ? { width: preset.width, height: preset.height } : { width: currentWidth, height: currentHeight };
  }, [selectedSize, currentWidth, currentHeight, customW, customH]);

  const isResized = exportDims.width !== currentWidth || exportDims.height !== currentHeight;
  const aspectOriginal = currentWidth / currentHeight;
  const aspectTarget = exportDims.width / exportDims.height;
  const aspectDiff = Math.abs(aspectOriginal - aspectTarget) / aspectOriginal;
  // Aspect-preserving resize (same aspect ratio) never needs a fit choice;
  // the design scales uniformly. Only expose the fit selector when a
  // non-trivial aspect change actually forces one of the three strategies.
  const aspectChanged = isResized && aspectDiff > ASPECT_DIFF_SIGNIFICANT;

  const groups = useMemo(() => {
    const map = new Map<string, SizePreset[]>();
    for (const p of SIZE_PRESETS) {
      const list = map.get(p.group) ?? [];
      list.push(p);
      map.set(p.group, list);
    }
    return map;
  }, []);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 10000,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)",
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 520, maxHeight: "85vh",
          background: "var(--bg-elevated, #222)", borderRadius: 14,
          border: "1px solid var(--border-strong, #333)",
          boxShadow: "0 8px 40px rgba(0,0,0,0.5)",
          overflow: "hidden", display: "flex", flexDirection: "column",
        }}
      >
        {/* Header */}
        <div style={{
          padding: "16px 20px", borderBottom: "1px solid var(--border, #333)",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <span style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary, #fff)" }}>
            Export Design
          </span>
          <button
            onClick={onClose}
            style={{
              width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center",
              background: "none", border: "none", color: "var(--text-muted, #888)",
              cursor: "pointer", borderRadius: 6, fontSize: 16,
            }}
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflow: "auto", padding: "16px 20px" }}>
          {/* Original size option */}
          <SizeOption
            selected={selectedSize === "original"}
            onClick={() => setSelectedSize("original")}
            label="Original Size"
            sublabel={`${currentWidth} × ${currentHeight}px`}
            badge="Recommended"
          />

          {/* Preset groups */}
          {[...groups.entries()].map(([group, presets]) => (
            <div key={group} style={{ marginTop: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted, #888)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
                {group}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                {presets.map(p => (
                  <SizeOption
                    key={p.id}
                    selected={selectedSize === p.id}
                    onClick={() => setSelectedSize(p.id)}
                    label={p.label}
                    sublabel={`${p.width}×${p.height}`}
                    compact
                  />
                ))}
              </div>
            </div>
          ))}

          {/* Custom size */}
          <div style={{ marginTop: 16 }}>
            <SizeOption
              selected={selectedSize === "custom"}
              onClick={() => setSelectedSize("custom")}
              label="Custom Size"
              sublabel="Enter dimensions"
            />
            {selectedSize === "custom" && (
              <div style={{ display: "flex", gap: 10, marginTop: 8, paddingLeft: 4 }}>
                <DimInput label="W" value={customW} onChange={setCustomW} />
                <span style={{ color: "var(--text-muted)", alignSelf: "flex-end", paddingBottom: 6 }}>×</span>
                <DimInput label="H" value={customH} onChange={setCustomH} />
                <span style={{ color: "var(--text-muted, #666)", fontSize: 11, alignSelf: "flex-end", paddingBottom: 8 }}>px</span>
              </div>
            )}
          </div>

          {/* Format + Scale */}
          <div style={{ marginTop: 20, display: "flex", gap: 16 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", marginBottom: 6 }}>Format</div>
              <div style={{ display: "flex", gap: 4 }}>
                {(["png", "jpg", "svg", "pdf"] as const).map(f => (
                  <button
                    key={f}
                    onClick={() => setExportFormat(f)}
                    style={{
                      flex: 1, padding: "6px 0", borderRadius: 6,
                      border: exportFormat === f ? "1px solid var(--accent, #4f8ef7)" : "1px solid var(--border, #444)",
                      background: exportFormat === f ? "rgba(79,142,247,0.12)" : "none",
                      color: exportFormat === f ? "var(--accent, #4f8ef7)" : "var(--text-secondary, #aaa)",
                      fontSize: 12, fontWeight: 600, cursor: "pointer", textTransform: "uppercase",
                    }}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", marginBottom: 6 }}>Scale</div>
              <div style={{ display: "flex", gap: 4 }}>
                {[1, 2, 3].map(s => (
                  <button
                    key={s}
                    onClick={() => setScale(s)}
                    style={{
                      width: 36, padding: "6px 0", borderRadius: 6,
                      border: scale === s ? "1px solid var(--accent, #4f8ef7)" : "1px solid var(--border, #444)",
                      background: scale === s ? "rgba(79,142,247,0.12)" : "none",
                      color: scale === s ? "var(--accent, #4f8ef7)" : "var(--text-secondary, #aaa)",
                      fontSize: 12, fontWeight: 600, cursor: "pointer",
                    }}
                  >
                    {s}×
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Adapt strategy — only when aspect ratio changes (otherwise
              the design just scales uniformly and no choice is needed). */}
          {aspectChanged && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Adapt design — aspect ratio changes
              </div>
              <div style={{ display: "flex", gap: 5 }}>
                {([
                  ["contain", "Fit",     "Preserve composition · letterbox"],
                  ["cover",   "Fill",    "Preserve composition · crop edges"],
                  ["stretch", "Stretch", "Ignore aspect · fill exactly"],
                ] as const).map(([k, lbl, hint]) => (
                  <button
                    key={k}
                    onClick={() => setFit(k)}
                    title={hint}
                    style={{
                      flex: 1, padding: "8px 6px", borderRadius: 6, cursor: "pointer",
                      border: fit === k ? "1px solid var(--accent, #4f8ef7)" : "1px solid var(--border, #444)",
                      background: fit === k ? "rgba(79,142,247,0.12)" : "none",
                      color: fit === k ? "var(--accent, #4f8ef7)" : "var(--text-secondary, #aaa)",
                      fontSize: 12, fontWeight: 600, textAlign: "center",
                    }}
                  >
                    <div>{lbl}</div>
                    <div style={{ fontSize: 10, color: "var(--text-muted, #666)", marginTop: 2, fontWeight: 500 }}>{hint}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Resize summary — always shown when the output differs so
              the user sees the final pixel size they'll receive. */}
          {isResized && (
            <div style={{
              marginTop: 14, padding: "10px 12px", borderRadius: 8,
              background: aspectChanged ? "rgba(255,180,60,0.10)" : "rgba(79,142,247,0.08)",
              border: `1px solid ${aspectChanged ? "rgba(255,180,60,0.25)" : "rgba(79,142,247,0.15)"}`,
              fontSize: 12, color: "var(--text-secondary, #ccc)", lineHeight: 1.5,
            }}>
              {aspectChanged
                ? `⚠ Aspect ratio differs — using "${fit}" to adapt the design.`
                : "Design will be proportionally scaled to the new dimensions."}
              <div style={{ marginTop: 4, fontSize: 11, color: "var(--text-muted)" }}>
                Output: {exportDims.width * scale} × {exportDims.height * scale}px
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: "14px 20px", borderTop: "1px solid var(--border, #333)",
          display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 10,
        }}>
          <button
            onClick={onClose}
            style={{
              padding: "8px 18px", borderRadius: 8,
              background: "none", border: "1px solid var(--border, #444)",
              color: "var(--text-secondary, #aaa)", fontSize: 13, fontWeight: 500, cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            onClick={() => onExport({
              ...exportDims,
              format: exportFormat,
              scale,
              // When aspect is preserved (or size is unchanged), fit is
              // irrelevant — send "stretch" because a uniform scale and
              // a stretch with identical aspect produce the same pixels,
              // and this keeps the exporter's fast path simple.
              fit: aspectChanged ? fit : "stretch",
            })}
            style={{
              padding: "8px 22px", borderRadius: 8,
              background: "var(--accent, #4f8ef7)", border: "none",
              color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer",
              transition: "opacity 0.15s",
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = "0.88"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = "1"; }}
          >
            Export {exportFormat.toUpperCase()}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Size option row ────────────────────────────────────────────────────────

function SizeOption({
  selected, onClick, label, sublabel, badge, compact,
}: {
  selected: boolean;
  onClick: () => void;
  label: string;
  sublabel: string;
  badge?: string;
  compact?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: 10, width: "100%",
        padding: compact ? "8px 10px" : "10px 12px",
        borderRadius: 8,
        border: selected ? "1px solid var(--accent, #4f8ef7)" : "1px solid var(--border, #333)",
        background: selected ? "rgba(79,142,247,0.08)" : "none",
        cursor: "pointer", textAlign: "left",
        transition: "border-color 0.15s, background 0.15s",
      }}
    >
      {/* Radio dot */}
      <div style={{
        width: 16, height: 16, borderRadius: "50%", flexShrink: 0,
        border: selected ? "5px solid var(--accent, #4f8ef7)" : "2px solid var(--border-strong, #555)",
        background: selected ? "#fff" : "none",
        transition: "border 0.15s",
      }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: compact ? 12 : 13, fontWeight: 500, color: "var(--text-primary, #fff)" }}>
          {label}
        </div>
        <div style={{ fontSize: 11, color: "var(--text-muted, #888)", marginTop: 1 }}>
          {sublabel}
        </div>
      </div>
      {badge && (
        <span style={{
          fontSize: 10, fontWeight: 600, color: "var(--accent, #4f8ef7)",
          background: "rgba(79,142,247,0.10)", padding: "2px 8px",
          borderRadius: 20, textTransform: "uppercase", letterSpacing: "0.03em",
        }}>
          {badge}
        </span>
      )}
    </button>
  );
}

// ── Dimension input ────────────────────────────────────────────────────────

function DimInput({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 10, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase" }}>{label}</span>
      <input
        type="number"
        min={100}
        max={8192}
        value={value}
        onChange={e => onChange(Math.max(100, Math.min(8192, parseInt(e.target.value, 10) || 100)))}
        style={{
          width: 90, padding: "6px 8px", borderRadius: 6,
          border: "1px solid var(--border, #444)", background: "var(--bg-base, #1a1a1e)",
          color: "var(--text-primary, #fff)", fontSize: 13, fontFamily: "var(--font-mono)",
          outline: "none",
        }}
      />
    </div>
  );
}
