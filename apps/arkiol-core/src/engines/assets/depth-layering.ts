// src/engines/assets/depth-layering.ts
// Visual Depth & Layering System
//
// Step 19 introduces an explicit depth model so templates feel
// dimensional and composed instead of flat. Every placement gets a
// semantic *tier* (where does it sit in the depth stack) plus an
// optional *shadow* (how does it cast onto layers below). A tonal
// depth-separation layer between the background treatment and the
// content plane pushes content forward so the foreground / background
// distinction reads even on quiet surfaces.
//
// This module is the single source of truth for: depth tiers, the
// per-tier shadow profile, and the role/kind → tier mapping. Renderers
// consume the resolved values via the new optional fields on
// ElementPlacement (depthTier, shadow). Older renderers that ignore
// those fields keep working — the depth model is purely additive.

import type { AssetKind }     from "../../lib/asset-library";
import type { AssetRole }     from "./asset-selector";

// ── Tier taxonomy ────────────────────────────────────────────────────────────
// Tiers are ordered back → front. Each tier captures a *meaning* (this
// element is the floor; this one is raised content; this one is floating
// on top), not just a paint order.

export type DepthTier =
  | "surface"      // background fill — flush with the canvas
  | "ground"       // textures / patterns / atmospheric — flat above surface
  | "mid"          // hero photo / illustration — the main content plane
  | "raised"       // frames / cards / panels — slightly above mid
  | "elevated"     // ribbons / dividers / icon groups — clearly above mid
  | "floating";    // stickers / badges / accents — top tier, strongest cast

export const DEPTH_TIERS: readonly DepthTier[] = Object.freeze([
  "surface", "ground", "mid", "raised", "elevated", "floating",
]);

// ── Shadow shape ─────────────────────────────────────────────────────────────
// All shadow values are fractions of the artboard's shorter axis so they
// scale uniformly across portrait / square / landscape. A renderer
// translates these into either SVG <feDropShadow> (for inline-SVG outputs)
// or CSS box-shadow (for HTML editor previews).

export interface ShadowSpec {
  offsetX: number;   // 0–1 of shorter axis; positive = right
  offsetY: number;   // 0–1 of shorter axis; positive = down
  blur:    number;   // 0–1 of shorter axis
  opacity: number;   // 0–1
  color:   string;   // hex
}

// ── Per-tier profile ─────────────────────────────────────────────────────────
// `layerBase` is the canonical paint-order base for the tier. Combined
// with the contract / placement weight downstream, it determines final
// z-order. Shadow presets are tuned so successive tiers cast slightly
// longer / softer shadows — the eye reads a continuous depth ramp.

export interface TierProfile {
  layerBase:   number;
  shadow:      ShadowSpec | null;
  description: string;
}

export const TIER_PROFILE: Record<DepthTier, TierProfile> = {
  surface: {
    layerBase:   0,
    shadow:      null,
    description: "Background fill — flush with the canvas, no cast shadow.",
  },
  ground: {
    layerBase:   5,
    shadow:      null,
    description: "Textures / atmospheric layers — flat above surface.",
  },
  mid: {
    layerBase:   18,
    shadow:      { offsetX: 0, offsetY: 0.012, blur: 0.025, opacity: 0.18, color: "#000000" },
    description: "Hero content plane — soft drop shadow lifts it off the surface.",
  },
  raised: {
    layerBase:   26,
    shadow:      { offsetX: 0, offsetY: 0.014, blur: 0.030, opacity: 0.22, color: "#000000" },
    description: "Cards / frames / panels — gentle elevation above mid.",
  },
  elevated: {
    layerBase:   36,
    shadow:      { offsetX: 0, offsetY: 0.018, blur: 0.040, opacity: 0.28, color: "#000000" },
    description: "Ribbons / dividers / icon groups — clearly above the content plane.",
  },
  floating: {
    layerBase:   44,
    shadow:      { offsetX: 0, offsetY: 0.022, blur: 0.050, opacity: 0.32, color: "#000000" },
    description: "Stickers / badges / accents — top tier with the strongest cast.",
  },
};

// ── Role / kind → tier mapping ───────────────────────────────────────────────
// Roles give a default tier; specific kinds can override (a frame is more
// "raised" than the generic "support" role suggests; a divider sits
// "elevated", not just "divider"). Callers should consult tierForKind first
// when an asset kind is known, falling back to tierForRole.

export function tierForRole(role: AssetRole): DepthTier {
  switch (role) {
    case "background":  return "surface";
    case "support":     return "mid";
    case "divider":     return "elevated";
    case "icon-group":  return "elevated";
    case "accent":      return "floating";
  }
}

export function tierForKind(kind: AssetKind): DepthTier {
  switch (kind) {
    case "texture":      return "ground";
    case "illustration": return "mid";
    case "photo":        return "mid";
    case "frame":        return "raised";
    case "ribbon":       return "elevated";
    case "divider":      return "elevated";
    case "icon":         return "elevated";
    case "shape":        return "floating";
    case "sticker":      return "floating";
    case "badge":        return "floating";
  }
}

// ── Shadow accessors ─────────────────────────────────────────────────────────

export function shadowForTier(tier: DepthTier): ShadowSpec | null {
  return TIER_PROFILE[tier].shadow;
}

export function shadowForRole(role: AssetRole): ShadowSpec | null {
  return shadowForTier(tierForRole(role));
}

export function shadowForKind(kind: AssetKind): ShadowSpec | null {
  return shadowForTier(tierForKind(kind));
}

// Convert a shadow spec into a CSS filter string. Useful for HTML/CSS
// previews (e.g. the in-editor canvas) and for embedding in SVG-as-image
// payloads where the renderer can apply a CSS filter on the wrapping
// element. Renderers that prefer feDropShadow can read the raw fields.
export function shadowToCssFilter(s: ShadowSpec, axisPx: number): string {
  const x = (s.offsetX * axisPx).toFixed(1);
  const y = (s.offsetY * axisPx).toFixed(1);
  const b = (s.blur    * axisPx).toFixed(1);
  return `drop-shadow(${x}px ${y}px ${b}px rgba(0,0,0,${s.opacity.toFixed(2)}))`;
}

// Render a shadow as an SVG <filter> markup fragment. Returns the markup
// + the id the caller should reference via `filter="url(#id)"`. The id is
// derived from the spec so identical shadows reuse the same definition.
export function shadowToSvgFilter(s: ShadowSpec): { id: string; markup: string } {
  const id = `ds_${Math.round(s.offsetY * 1000)}_${Math.round(s.blur * 1000)}_${Math.round(s.opacity * 100)}`;
  const markup =
    `<filter id="${id}" x="-20%" y="-20%" width="140%" height="140%">` +
      `<feDropShadow dx="${s.offsetX}" dy="${s.offsetY}" stdDeviation="${s.blur}" ` +
        `flood-color="${s.color}" flood-opacity="${s.opacity}"/>` +
    `</filter>`;
  return { id, markup };
}

// ── Depth-separation overlay ─────────────────────────────────────────────────
// A subtle radial vignette inserted between the background treatment and
// the content plane. The vignette dims the canvas edges so the central
// content zone reads as foreground without needing per-element shadows on
// every layer. Coverage is full-bleed; opacity is intentionally low so
// the surface's own color and texture remain visible.

function svgDataUrl(svg: string): string {
  const encoded = svg
    .replace(/"/g, "'")
    .replace(/>\s+</g, "><")
    .replace(/[\r\n\t]/g, "")
    .replace(/#/g, "%23")
    .replace(/%/g, "%25")
    .replace(/</g, "%3C")
    .replace(/>/g, "%3E");
  return `data:image/svg+xml;charset=UTF-8,${encoded}`;
}

export interface DepthSeparationLayer {
  url:          string;
  coverageHint: number;
  layerHint:    number;
  note:         string;
}

/**
 * Build a depth-separation vignette layer. Two flavors:
 *   "subtle" (default) — gentle radial dim, ~12% max opacity at edges
 *   "strong"           — darker vignette for image-heavy backgrounds
 * The dim-color defaults to #000 but accepts an override so dark surfaces
 * can use a lifted-edge effect instead of darkening (#FFF + low opacity).
 */
export function buildDepthSeparationLayer(
  flavor: "subtle" | "strong" = "subtle",
  color:  string              = "#000000",
): DepthSeparationLayer {
  const stops = flavor === "strong"
    ? [
        { off: "0%",  op: 0.0 },
        { off: "55%", op: 0.05 },
        { off: "100%",op: 0.20 },
      ]
    : [
        { off: "0%",  op: 0.0 },
        { off: "60%", op: 0.03 },
        { off: "100%",op: 0.12 },
      ];
  const stopMarkup = stops
    .map(s => `<stop offset="${s.off}" stop-color="${color}" stop-opacity="${s.op}"/>`)
    .join("");
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" preserveAspectRatio="none">` +
      `<defs><radialGradient id="v" cx="50%" cy="50%" r="65%">${stopMarkup}</radialGradient></defs>` +
      `<rect width="1000" height="1000" fill="url(%23v)"/>` +
    `</svg>`;
  return {
    url:          svgDataUrl(svg),
    coverageHint: 1.0,
    layerHint:    9,                              // last in the surface/ground band
    note:         `depth-separation vignette (${flavor})`,
  };
}

// ── Stack summary ────────────────────────────────────────────────────────────
// A small helper for debug / reasoning output: given a list of placements,
// summarize how the stack reads from back to front. Templates that fail to
// build a coherent depth ramp tend to show up here as "all elements at the
// same tier".

export function summarizeDepthStack(
  placements: Array<{ depthTier?: DepthTier; layer?: number }>,
): string {
  const counts = new Map<DepthTier, number>();
  for (const p of placements) {
    if (!p.depthTier) continue;
    counts.set(p.depthTier, (counts.get(p.depthTier) ?? 0) + 1);
  }
  const parts: string[] = [];
  for (const tier of DEPTH_TIERS) {
    const n = counts.get(tier) ?? 0;
    if (n > 0) parts.push(`${tier}×${n}`);
  }
  return parts.length > 0 ? parts.join(" → ") : "(no depth tiers assigned)";
}
