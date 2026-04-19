// src/engines/style/category-layout-profiles.ts
//
// Category Layout Profiles — per-category section structure and visual rhythm.
//
// Where CategoryStylePack controls palette/typography and CategoryTemplateKit
// controls decorations, this module controls the actual *composition*: which
// layout variations each category prefers, how zones are repositioned for the
// category, and how the rhythm between zones (gaps, alignment, padding) is
// tuned so a productivity layout reads as a structured checklist while a
// motivation layout reads as a centered poster.
//
// Applied in two places:
//   1. authority.ts — biases the family variation selection for the category
//   2. adaptive-layout.ts — applies zone structure overrides and rhythm params
//      after content-adaptive resizing but before gap enforcement.

import type { Zone, ZoneId } from "../layout/families";
import type { FormatCategory } from "../layout/authority";

// ── Profile interface ─────────────────────────────────────────────────────────

export type CompositionApproach =
  | "grid_structured"     // productivity — left-aligned, disciplined grid
  | "centered_airy"       // wellness   — centered, generous breathing room
  | "card_stacked"        // education  — stacked cards, informational
  | "editorial_anchored"  // business   — left-rail accent, authority
  | "hero_compact"        // fitness    — bold focal, tight spacing
  | "editorial_graceful"  // beauty     — centered with airy serifs
  | "photo_dominant"      // travel     — image first, text in lower third
  | "promo_stacked"       // marketing  — top badge, bold stack, prominent CTA
  | "poster_centered";    // motivation — centered monolith, dramatic padding

export type AlignmentRhythm = "left" | "center" | "right" | "mixed";

export interface RhythmProfile {
  /** Additional vertical gap between text zones, added to density.minZonePadding */
  gapBoost:         number;
  /** Extra safe-zone padding applied on top of platform safe zone */
  paddingBoost:     number;
  /** Force all text zones to this alignment ("mixed" = leave untouched) */
  alignment:        AlignmentRhythm;
  /** Multiplier on headline height to emphasise or tighten the hero zone */
  headlineHeightMul: number;
  /** Multiplier on headline width (left/right cropping) for editorial trims */
  headlineWidthMul: number;
  /** Zone-order rewrite — reorder vertical stacking (empty = default) */
  stackOrder?:      ZoneId[];
}

/**
 * Per-format-category zone overrides keyed by zoneId.
 * Lets a category reposition or resize specific zones for a given format
 * (e.g. travel pushes text to the lower third on instagram_post but keeps
 * a two-column feel on flyer).
 */
export type FormatZoneOverrides = Partial<Record<FormatCategory, Partial<Record<ZoneId, Partial<Zone>>>>>;

export interface CategoryLayoutProfile {
  categoryId:        string;
  approach:          CompositionApproach;
  rhythm:            RhythmProfile;
  /** Preferred variation IDs, in priority order. First match wins. */
  preferredVariations: string[];
  /** Format-category specific zone overrides applied after adaptation */
  zoneOverrides:     FormatZoneOverrides;
}

// ── Profiles ──────────────────────────────────────────────────────────────────
//
// Each profile is intentionally distinct. The tests for "differentiation" are:
//   - alignment rhythm differs
//   - gap/padding rhythm differs
//   - headline proportion differs
//   - preferred variations differ
//   - per-format zone overrides push the composition into a different shape

// ── Productivity: grid-structured, left-aligned, disciplined ──────────────────
const PRODUCTIVITY_PROFILE: CategoryLayoutProfile = {
  categoryId: "productivity",
  approach:   "grid_structured",
  rhythm: {
    gapBoost:          1.5,
    paddingBoost:      1,
    alignment:         "left",
    headlineHeightMul: 1.0,
    headlineWidthMul:  0.8,   // narrower — leaves a column for checklist decor
    stackOrder:        ["badge", "section_header", "headline", "subhead", "body", "cta"],
  },
  preferredVariations: ["v1_split", "v1_default", "v1_classic", "v1_title_body"],
  zoneOverrides: {
    instagram: {
      headline: { alignH: "left", x: 5, width: 65 },
      subhead:  { alignH: "left", x: 5, width: 65 },
      cta:      { alignH: "left", x: 5, width: 42 },
    },
    story: {
      headline: { alignH: "left", x: 6, width: 70 },
      subhead:  { alignH: "left", x: 6, width: 70 },
      cta:      { alignH: "left", x: 6, width: 60 },
    },
    flyer: {
      headline: { alignH: "left", x: 8, width: 60 },
      subhead:  { alignH: "left", x: 8, width: 60 },
      body:     { alignH: "left", x: 8, width: 60 },
    },
  },
};

// ── Wellness: centered, airy, lots of breathing room ──────────────────────────
const WELLNESS_PROFILE: CategoryLayoutProfile = {
  categoryId: "wellness",
  approach:   "centered_airy",
  rhythm: {
    gapBoost:          4,
    paddingBoost:      4,
    alignment:         "center",
    headlineHeightMul: 0.92,
    headlineWidthMul:  0.78,  // narrower centered column
  },
  preferredVariations: ["v4_centered", "v2_centered", "v1_default", "v4_minimal", "v2_minimal"],
  zoneOverrides: {
    instagram: {
      headline: { alignH: "center", x: 11, width: 78, y: 50, height: 14 },
      subhead:  { alignH: "center", x: 14, width: 72, y: 70 },
      cta:      { alignH: "center", x: 29, width: 42 },
    },
    story: {
      headline: { alignH: "center", x: 10, width: 80, y: 60, height: 16 },
      subhead:  { alignH: "center", x: 14, width: 72, y: 80 },
      cta:      { alignH: "center", x: 20, width: 60 },
    },
    flyer: {
      headline: { alignH: "center", x: 10, width: 80 },
      subhead:  { alignH: "center", x: 15, width: 70 },
      body:     { alignH: "center", x: 18, width: 64 },
    },
    poster: {
      headline: { alignH: "center", x: 10, width: 80 },
      subhead:  { alignH: "center", x: 15, width: 70 },
    },
  },
};

// ── Education: stacked cards, informational, section-header driven ────────────
const EDUCATION_PROFILE: CategoryLayoutProfile = {
  categoryId: "education",
  approach:   "card_stacked",
  rhythm: {
    gapBoost:          2.5,
    paddingBoost:      2,
    alignment:         "left",
    headlineHeightMul: 1.05,
    headlineWidthMul:  0.9,
    stackOrder:        ["section_header", "headline", "subhead", "body", "bullet_1", "bullet_2", "bullet_3", "cta"],
  },
  preferredVariations: ["v2_text_heavy", "v1_title_body", "v3_two_col", "v1_classic", "v2_single_col"],
  zoneOverrides: {
    instagram: {
      headline: { alignH: "left", x: 6, width: 88, y: 40, height: 18 },
      subhead:  { alignH: "left", x: 6, width: 88, y: 62 },
      cta:      { alignH: "left", x: 6, width: 48 },
    },
    slide: {
      section_header: { alignH: "left", x: 5, width: 60, y: 4 },
      headline:       { alignH: "left", x: 5, width: 88, y: 16, height: 20 },
      body:           { alignH: "left", x: 5, width: 58, y: 54, height: 30 },
    },
    flyer: {
      headline: { alignH: "left", x: 8, width: 70, y: 47 },
      subhead:  { alignH: "left", x: 8, width: 70 },
      body:     { alignH: "left", x: 8, width: 78 },
    },
  },
};

// ── Business: editorial, left accent rail, authoritative ──────────────────────
const BUSINESS_PROFILE: CategoryLayoutProfile = {
  categoryId: "business",
  approach:   "editorial_anchored",
  rhythm: {
    gapBoost:          2,
    paddingBoost:      3,
    alignment:         "left",
    headlineHeightMul: 1.0,
    headlineWidthMul:  0.72,  // narrow editorial column
  },
  preferredVariations: ["v2_text_heavy", "v3_split_col", "v1_classic", "v1_title_body", "v1_two_col"],
  zoneOverrides: {
    instagram: {
      headline: { alignH: "left", x: 9, width: 62, y: 36, height: 20 },
      subhead:  { alignH: "left", x: 9, width: 62, y: 62 },
      cta:      { alignH: "left", x: 9, width: 38 },
    },
    thumbnail: {
      headline: { alignH: "left", x: 56, width: 38, y: 10, height: 52 },
      badge:    { alignH: "left", x: 56, width: 38 },
    },
    slide: {
      headline: { alignH: "left", x: 6, width: 62, y: 20, height: 22 },
      subhead:  { alignH: "left", x: 6, width: 58, y: 46 },
      body:     { alignH: "left", x: 6, width: 58 },
    },
    flyer: {
      headline: { alignH: "left", x: 8, width: 58 },
      subhead:  { alignH: "left", x: 8, width: 58 },
      body:     { alignH: "left", x: 8, width: 66 },
    },
  },
};

// ── Fitness: bold hero, compact stacking, diagonal energy ─────────────────────
const FITNESS_PROFILE: CategoryLayoutProfile = {
  categoryId: "fitness",
  approach:   "hero_compact",
  rhythm: {
    gapBoost:          -0.5,  // tighter than default
    paddingBoost:      -1,
    alignment:         "center",
    headlineHeightMul: 1.25,  // hero headline dominates
    headlineWidthMul:  1.0,
  },
  preferredVariations: ["v3_full_bleed", "v2_full_bleed", "v4_full_bleed", "v4_centered", "v1_face_left"],
  zoneOverrides: {
    instagram: {
      headline: { alignH: "center", x: 4, width: 92, y: 44, height: 26 },
      subhead:  { alignH: "center", x: 8, width: 84, y: 74 },
      cta:      { alignH: "center", x: 20, width: 60 },
    },
    story: {
      headline: { alignH: "center", x: 3, width: 94, y: 52, height: 24 },
      subhead:  { alignH: "center", x: 6, width: 88, y: 80 },
      cta:      { alignH: "center", x: 15, width: 70 },
    },
    poster: {
      headline: { alignH: "center", x: 3, width: 94, y: 32, height: 30 },
      subhead:  { alignH: "center", x: 8, width: 84 },
    },
    thumbnail: {
      headline: { alignH: "left", x: 56, width: 42, y: 12, height: 58, maxFontSize: 120 },
    },
  },
};

// ── Beauty: editorial graceful, centered with serif feel ──────────────────────
const BEAUTY_PROFILE: CategoryLayoutProfile = {
  categoryId: "beauty",
  approach:   "editorial_graceful",
  rhythm: {
    gapBoost:          3,
    paddingBoost:      3,
    alignment:         "center",
    headlineHeightMul: 0.95,
    headlineWidthMul:  0.82,
  },
  preferredVariations: ["v4_centered", "v2_centered", "v5_bottom_third", "v1_classic", "v1_default"],
  zoneOverrides: {
    instagram: {
      headline: { alignH: "center", x: 9, width: 82, y: 46, height: 16 },
      subhead:  { alignH: "center", x: 12, width: 76, y: 68 },
      cta:      { alignH: "center", x: 30, width: 40 },
    },
    story: {
      headline: { alignH: "center", x: 8, width: 84, y: 58 },
      subhead:  { alignH: "center", x: 12, width: 76, y: 78 },
    },
    flyer: {
      headline: { alignH: "center", x: 12, width: 76 },
      subhead:  { alignH: "center", x: 16, width: 68 },
    },
  },
};

// ── Travel: photo-dominant, text in lower third, wide ─────────────────────────
const TRAVEL_PROFILE: CategoryLayoutProfile = {
  categoryId: "travel",
  approach:   "photo_dominant",
  rhythm: {
    gapBoost:          1.5,
    paddingBoost:      1,
    alignment:         "center",
    headlineHeightMul: 1.05,
    headlineWidthMul:  0.94,
  },
  preferredVariations: ["v3_full_bleed", "v5_bottom_third", "v2_full_bleed", "v4_full_bleed", "v3_full_art"],
  zoneOverrides: {
    instagram: {
      image:    { height: 70 },
      headline: { alignH: "center", x: 5, width: 90, y: 72, height: 14 },
      subhead:  { alignH: "center", x: 10, width: 80, y: 86, height: 6 },
      cta:      { alignH: "center", x: 25, width: 50, y: 92 },
    },
    story: {
      image:    { y: 0, height: 70 },
      headline: { alignH: "center", x: 5, width: 90, y: 72 },
      subhead:  { alignH: "center", x: 8, width: 84, y: 86 },
    },
    flyer: {
      image:    { height: 62 },
      headline: { alignH: "center", x: 6, width: 88, y: 64 },
      subhead:  { alignH: "center", x: 10, width: 80 },
    },
    poster: {
      image:    { height: 68 },
      headline: { alignH: "center", x: 5, width: 90, y: 70 },
    },
  },
};

// ── Marketing: promo stacked, top badge, bold CTA ─────────────────────────────
const MARKETING_PROFILE: CategoryLayoutProfile = {
  categoryId: "marketing",
  approach:   "promo_stacked",
  rhythm: {
    gapBoost:          0,
    paddingBoost:      0,
    alignment:         "center",
    headlineHeightMul: 1.2,
    headlineWidthMul:  0.98,
    stackOrder:        ["badge", "headline", "price", "subhead", "cta", "legal"],
  },
  preferredVariations: ["v2_text_heavy", "v4_centered", "v3_full_bleed", "v1_classic", "v1_default"],
  zoneOverrides: {
    instagram: {
      badge:    { alignH: "center", x: 30, width: 40, y: 6, height: 8 },
      headline: { alignH: "center", x: 4, width: 92, y: 26, height: 30 },
      subhead:  { alignH: "center", x: 8, width: 84, y: 60, height: 10 },
      cta:      { alignH: "center", x: 20, width: 60, y: 78, height: 10 },
    },
    story: {
      badge:    { alignH: "center", x: 25, width: 50, y: 8, height: 7 },
      headline: { alignH: "center", x: 4, width: 92, y: 30, height: 32 },
      subhead:  { alignH: "center", x: 8, width: 84, y: 68 },
      cta:      { alignH: "center", x: 15, width: 70, y: 84 },
    },
    flyer: {
      headline: { alignH: "center", x: 4, width: 92, y: 40, height: 18 },
      subhead:  { alignH: "center", x: 8, width: 84 },
      cta:      { alignH: "center", x: 18, width: 64 },
    },
  },
};

// ── Motivation: centered monolith, dramatic padding ───────────────────────────
const MOTIVATION_PROFILE: CategoryLayoutProfile = {
  categoryId: "motivation",
  approach:   "poster_centered",
  rhythm: {
    gapBoost:          5,
    paddingBoost:      5,
    alignment:         "center",
    headlineHeightMul: 1.35,
    headlineWidthMul:  0.84,
  },
  preferredVariations: ["v2_minimal", "v4_centered", "v2_big_title", "v3_full_art", "v2_text_heavy"],
  zoneOverrides: {
    instagram: {
      image:    { height: 0 },
      headline: { alignH: "center", x: 8, width: 84, y: 30, height: 34 },
      subhead:  { alignH: "center", x: 14, width: 72, y: 70 },
      cta:      { alignH: "center", x: 30, width: 40 },
    },
    story: {
      image:    { height: 0 },
      headline: { alignH: "center", x: 6, width: 88, y: 36, height: 32 },
      subhead:  { alignH: "center", x: 12, width: 76, y: 74 },
    },
    poster: {
      image:    { height: 0 },
      headline: { alignH: "center", x: 6, width: 88, y: 28, height: 36 },
      subhead:  { alignH: "center", x: 12, width: 76, y: 68 },
    },
    flyer: {
      image:    { height: 0 },
      headline: { alignH: "center", x: 6, width: 88, y: 20, height: 28 },
      subhead:  { alignH: "center", x: 10, width: 80 },
    },
  },
};

// ── Registry ──────────────────────────────────────────────────────────────────

const PROFILE_MAP = new Map<string, CategoryLayoutProfile>([
  ["productivity", PRODUCTIVITY_PROFILE],
  ["wellness",     WELLNESS_PROFILE],
  ["education",    EDUCATION_PROFILE],
  ["business",     BUSINESS_PROFILE],
  ["fitness",      FITNESS_PROFILE],
  ["beauty",       BEAUTY_PROFILE],
  ["travel",       TRAVEL_PROFILE],
  ["marketing",    MARKETING_PROFILE],
  ["motivation",   MOTIVATION_PROFILE],
]);

// ── Public API ────────────────────────────────────────────────────────────────

export function getCategoryLayoutProfile(categoryId: string | undefined | null): CategoryLayoutProfile | null {
  if (!categoryId) return null;
  return PROFILE_MAP.get(categoryId) ?? null;
}

/**
 * Pick a variation from the available set that best matches the category's
 * preferredVariations order. Falls back to the hash-seeded index when the
 * category has no preference present in the family.
 */
export function selectCategoryVariationIndex(
  variationIds:        string[],
  profile:             CategoryLayoutProfile,
  fallbackIndex:       number,
): number {
  for (const preferred of profile.preferredVariations) {
    const idx = variationIds.indexOf(preferred);
    if (idx >= 0) return idx;
  }
  return fallbackIndex;
}

/**
 * Apply the profile's format-specific zone overrides to an already-resolved
 * zone array. Non-destructive — returns a new array.
 *
 * Collapsed zones (height === 0) are not expanded unless the override sets a
 * positive height, which lets a profile force a zone back on (e.g. Motivation
 * explicitly collapses the image by setting height: 0).
 */
export function applyCategoryZoneOverrides(
  zones:          Zone[],
  profile:        CategoryLayoutProfile,
  formatCategory: FormatCategory,
): Zone[] {
  const overrides = profile.zoneOverrides[formatCategory];
  if (!overrides) return zones;

  return zones.map(zone => {
    const ov = overrides[zone.id];
    if (!ov) return zone;
    return {
      ...zone,
      ...ov,
      constraints: {
        ...(zone.constraints ?? {}),
        ...(ov.constraints ?? {}),
      },
    };
  });
}

/**
 * Enforce the profile's alignment rhythm on all text zones. Leaves "mixed"
 * alone so families that deliberately mix alignments (e.g. YouTube thumbnail)
 * aren't flattened.
 */
export function applyCategoryAlignment(
  zones:   Zone[],
  profile: CategoryLayoutProfile,
): Zone[] {
  if (profile.rhythm.alignment === "mixed") return zones;
  const align = profile.rhythm.alignment;
  const textIds: ZoneId[] = [
    "headline", "subhead", "body", "cta", "tagline", "section_header", "legal",
  ];
  return zones.map(zone => {
    if (!textIds.includes(zone.id)) return zone;
    if (zone.height === 0) return zone;
    return { ...zone, alignH: align };
  });
}

/**
 * Apply the profile's headline proportion multipliers. Clamped so the zone
 * never exceeds canvas bounds.
 */
export function applyHeadlineProportion(
  zones:   Zone[],
  profile: CategoryLayoutProfile,
): Zone[] {
  const { headlineHeightMul, headlineWidthMul } = profile.rhythm;
  if (headlineHeightMul === 1 && headlineWidthMul === 1) return zones;
  return zones.map(zone => {
    if (zone.id !== "headline" && zone.id !== "name") return zone;
    if (zone.height === 0) return zone;
    const newWidth  = Math.max(20, Math.min(100 - zone.x, zone.width  * headlineWidthMul));
    const newHeight = Math.max(4,  Math.min(100 - zone.y, zone.height * headlineHeightMul));
    return { ...zone, width: newWidth, height: newHeight };
  });
}
