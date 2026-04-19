// src/engines/assets/asset-placement.ts
// Asset Placement Rules — kind → visual purpose → concrete placement.
//
// Step 15 turns the implicit placement logic that used to live inside
// asset-selector.ts into a declarative, per-kind rule table. Every library
// asset kind now has one canonical role in a composition:
//
//   purpose           example kinds        where it lives on the canvas
//   ─────────────────  ───────────────────  ────────────────────────────
//   background        texture              full-bleed behind everything
//   support-visual    illustration, photo  hero area, ~center
//   content-enhancer  frame                wraps a content block
//   section-marker    ribbon               title bar at the top of a section
//   divider           divider (kind)       horizontal break between blocks
//   accent            shape, sticker,      small touch in a corner
//                     badge
//   icon-group        icon                 inline beside a text zone
//
// Each rule fixes *placement, scale, alignment and layering* so assets feel
// intentional — never randomly scattered. The selector consults this table
// when it builds an ElementPlacement for a library asset.
//
// This module is intentionally the single source of truth for placement
// values: if you want bigger stickers, pull them away from the edge, or
// cap how many badges can appear on a single template, change it here.

import type { AssetKind } from "../../lib/asset-library";
import type { Anchor, AssetRole } from "./asset-selector";

// ── Purpose taxonomy ─────────────────────────────────────────────────────────
// Captures the *reason* a visual is on the canvas. Rules below reference a
// purpose so a new kind added later just needs to pick one of these and
// the surrounding placement behaviour follows for free.

export type PlacementPurpose =
  | "background"        // full-bleed surface behind all content
  | "support-visual"    // hero image / illustration that backs the copy
  | "content-enhancer"  // frames / cards that wrap a content block
  | "section-marker"    // ribbons / banners that flag a section header
  | "divider"           // horizontal break between sections
  | "accent"            // small corner decoration (sticker, badge, burst)
  | "icon-group";       // inline icon beside a text block

// ── Rule shape ───────────────────────────────────────────────────────────────

export interface ScaleRange {
  // All values are fractions of the artboard's *shorter* axis so rules work
  // uniformly across portrait, square and landscape formats.
  min:     number;
  default: number;
  max:     number;
}

export interface KindPlacementRule {
  purpose:       PlacementPurpose;
  // The AssetRole the selector should route this kind into. Kept here (not
  // only in asset-selector.ts) so role assignment stays consistent with the
  // placement rules around it.
  role:          AssetRole;
  scale:         ScaleRange;
  alignment:     "left" | "center" | "right";
  // Preferred anchors, in priority order. The first one that's compatible
  // with the chosen zone wins.
  anchors:       Anchor[];
  // Safe-area padding from the nearest edge, as a fraction of the shorter
  // canvas axis. Keeps accents from crashing into the bleed.
  marginFromEdge:number;
  // Base layer before contract hierarchy weight is added. Higher = in front.
  layerBase:     number;
  // Max number of this kind allowed in a single composition. Prevents the
  // canvas from turning into a collage when generation rolls the same kind
  // several times.
  maxPerLayout:  number;
  // When true, the asset spans the full width of its zone (dividers,
  // ribbons, textures). When false, it sits inside the zone as an object.
  fullWidth:     boolean;
  // Whether the kind may extend to the canvas bleed (backgrounds, photos).
  bleedAllowed:  boolean;
  description:   string;
}

// ── Per-kind rule table ──────────────────────────────────────────────────────
// Scale values are fractions of the artboard's shorter axis. Layer bases
// follow the bands declared in PURPOSE_LAYER_BAND below.

export const KIND_PLACEMENT_RULES: Record<AssetKind, KindPlacementRule> = {
  texture: {
    purpose:        "background",
    role:           "background",
    scale:          { min: 1.00, default: 1.00, max: 1.00 },
    alignment:      "center",
    anchors:        ["full-bleed"],
    marginFromEdge: 0,
    layerBase:      0,
    maxPerLayout:   1,
    fullWidth:      true,
    bleedAllowed:   true,
    description:    "Repeating surface pattern behind all content.",
  },

  photo: {
    purpose:        "support-visual",
    role:           "support",
    scale:          { min: 0.40, default: 0.60, max: 1.00 },
    alignment:      "center",
    anchors:        ["center", "full-bleed", "top-center"],
    marginFromEdge: 0.02,
    layerBase:      14,
    maxPerLayout:   1,
    fullWidth:      false,
    bleedAllowed:   true,
    description:    "Photographic hero backing the headline.",
  },

  illustration: {
    purpose:        "support-visual",
    role:           "support",
    scale:          { min: 0.40, default: 0.55, max: 0.75 },
    alignment:      "center",
    anchors:        ["center", "center-right", "center-left"],
    marginFromEdge: 0.06,
    layerBase:      16,
    maxPerLayout:   1,
    fullWidth:      false,
    bleedAllowed:   false,
    description:    "Vector hero illustration that supports the main message.",
  },

  frame: {
    purpose:        "content-enhancer",
    role:           "support",
    scale:          { min: 0.30, default: 0.50, max: 0.75 },
    alignment:      "center",
    anchors:        ["center", "top-center", "bottom-center"],
    marginFromEdge: 0.05,
    layerBase:      22,
    maxPerLayout:   1,
    fullWidth:      false,
    bleedAllowed:   false,
    description:    "Container artwork that wraps a content block (card, polaroid, ornate border).",
  },

  ribbon: {
    purpose:        "section-marker",
    role:           "divider",
    scale:          { min: 0.50, default: 0.75, max: 1.00 },
    alignment:      "center",
    anchors:        ["top-center", "edge-top", "bottom-center"],
    marginFromEdge: 0.04,
    layerBase:      30,
    maxPerLayout:   1,
    fullWidth:      true,
    bleedAllowed:   false,
    description:    "Title ribbon that flags a section header or callout.",
  },

  divider: {
    purpose:        "divider",
    role:           "divider",
    scale:          { min: 0.35, default: 0.55, max: 0.85 },
    alignment:      "center",
    anchors:        ["center", "edge-top", "edge-bottom"],
    marginFromEdge: 0.08,
    layerBase:      32,
    maxPerLayout:   2,
    fullWidth:      true,
    bleedAllowed:   false,
    description:    "Horizontal ornamental break between content sections.",
  },

  shape: {
    purpose:        "accent",
    role:           "divider",
    scale:          { min: 0.08, default: 0.15, max: 0.28 },
    alignment:      "center",
    anchors:        ["top-right", "top-left", "bottom-right", "bottom-left"],
    marginFromEdge: 0.05,
    layerBase:      38,
    maxPerLayout:   2,
    fullWidth:      false,
    bleedAllowed:   false,
    description:    "Decorative vector shape (blob, burst, arrow) anchored in a corner.",
  },

  sticker: {
    purpose:        "accent",
    role:           "accent",
    scale:          { min: 0.08, default: 0.14, max: 0.22 },
    alignment:      "center",
    anchors:        ["top-right", "bottom-right", "center-right"],
    marginFromEdge: 0.05,
    layerBase:      42,
    maxPerLayout:   2,
    fullWidth:      false,
    bleedAllowed:   false,
    description:    "Polychrome sticker motif pinned to a corner.",
  },

  badge: {
    purpose:        "accent",
    role:           "accent",
    scale:          { min: 0.10, default: 0.16, max: 0.22 },
    alignment:      "center",
    anchors:        ["top-right", "top-left", "bottom-right"],
    marginFromEdge: 0.04,
    layerBase:      44,
    maxPerLayout:   1,
    fullWidth:      false,
    bleedAllowed:   false,
    description:    "Emblem marking a key claim (NEW, SALE, VERIFIED).",
  },

  icon: {
    purpose:        "icon-group",
    role:           "icon-group",
    scale:          { min: 0.03, default: 0.06, max: 0.10 },
    alignment:      "left",
    anchors:        ["center-left", "center-right", "top-left", "bottom-left"],
    marginFromEdge: 0.03,
    layerBase:      40,
    maxPerLayout:   4,
    fullWidth:      false,
    bleedAllowed:   false,
    description:    "Inline pictogram beside a text block.",
  },
};

// ── Layer bands ──────────────────────────────────────────────────────────────
// Purposes occupy non-overlapping z-order bands so composition always paints
// back → front in a predictable order, regardless of which kinds are used.

export const PURPOSE_LAYER_BAND: Record<PlacementPurpose, { min: number; max: number }> = {
  background:          { min:  0, max:  9 },
  "support-visual":    { min: 10, max: 19 },
  "content-enhancer":  { min: 20, max: 29 },
  "section-marker":    { min: 30, max: 34 },
  divider:             { min: 35, max: 39 },
  "icon-group":        { min: 40, max: 43 },
  accent:              { min: 44, max: 49 },
};

// ── Helpers ──────────────────────────────────────────────────────────────────

export function ruleForKind(kind: AssetKind): KindPlacementRule {
  return KIND_PLACEMENT_RULES[kind];
}

export function purposeForKind(kind: AssetKind): PlacementPurpose {
  return KIND_PLACEMENT_RULES[kind].purpose;
}

export function roleForKind(kind: AssetKind): AssetRole {
  return KIND_PLACEMENT_RULES[kind].role;
}

export function maxInstancesPerLayout(kind: AssetKind): number {
  return KIND_PLACEMENT_RULES[kind].maxPerLayout;
}

/**
 * Clamp a requested scale into the kind's allowed [min, max] range. Falls
 * back to the kind's default when scale is undefined or non-finite.
 */
export function clampScaleForKind(kind: AssetKind, requested?: number): number {
  const { min, default: def, max } = KIND_PLACEMENT_RULES[kind].scale;
  const s = typeof requested === "number" && Number.isFinite(requested) ? requested : def;
  return Math.max(min, Math.min(max, s));
}

/**
 * Pick the first preferred anchor that's still available. `excluded` carries
 * anchors already taken by other elements in the same composition — callers
 * can pass an empty set when they don't track anchor occupancy. Falls back
 * to the kind's default (first preferred) when none are available.
 */
export function resolveAnchorForKind(
  kind:     AssetKind,
  excluded: Set<Anchor> = new Set(),
): Anchor {
  const anchors = KIND_PLACEMENT_RULES[kind].anchors;
  return anchors.find(a => !excluded.has(a)) ?? anchors[0];
}

/**
 * Compute the final render layer for an asset. The kind's layerBase anchors
 * the element in its purpose band; optional `weight` (typically the asset
 * contract's hierarchyWeight) is added on top so element types within the
 * same kind-bucket paint in a consistent order.
 */
export function resolveLayerForKind(kind: AssetKind, weight: number = 0): number {
  const rule   = KIND_PLACEMENT_RULES[kind];
  const band   = PURPOSE_LAYER_BAND[rule.purpose];
  const raw    = rule.layerBase + weight;
  // Keep layers pinned inside the purpose band so e.g. a heavy-contract
  // badge can't punch through into the background band.
  return Math.max(band.min, Math.min(band.max, raw));
}

/**
 * Summary of the rule — useful for reasoning/debug output the pipeline
 * attaches to a generated template.
 */
export function describePlacement(kind: AssetKind): string {
  const r = KIND_PLACEMENT_RULES[kind];
  return `${kind} → purpose=${r.purpose}, role=${r.role}, layer~${r.layerBase}, ` +
         `anchor=${r.anchors[0]}, scale=${r.scale.default}× (±${r.scale.max - r.scale.default}), ` +
         `max/layout=${r.maxPerLayout}, fullWidth=${r.fullWidth}`;
}
