// src/engines/personalization/dna-applicator.ts
//
// Converts a DesignDNA profile into concrete overrides for the generation
// pipeline. The applicator bridges the abstract affinity model with the
// theme system, typography, layout selection, and CTA styling.
//
// Influence is scaled by profile strength — new users with few signals
// get minimal personalization, experienced users get stronger biases.

import type { DesignDNA, StyleAffinities } from "./design-dna";

// ── Theme scoring bias ─────────────────────────────────────────────────────
// Applied during multi-candidate theme selection in svg-builder-ultimate.

export interface DNAThemeBias {
  boosts: Record<string, number>;    // themeId → score delta
  penalties: Record<string, number>; // themeId → negative delta
  preferredThemeIds: string[];       // ordered list for agent preferences
}

export function computeDNAThemeBias(dna: DesignDNA): DNAThemeBias {
  if (dna.strength < 0.05) {
    return { boosts: {}, penalties: {}, preferredThemeIds: [] };
  }

  const scale = dna.strength * 0.20; // max 20% boost at full strength

  const boosts: Record<string, number> = {};
  for (const [themeId, affinity] of Object.entries(dna.themePreferences.favoriteThemes)) {
    if (affinity > 0.05) {
      boosts[themeId] = affinity * scale;
    }
  }

  const penalties: Record<string, number> = {};
  for (const [themeId, avoidance] of Object.entries(dna.themePreferences.avoidedThemes)) {
    if (avoidance > 0.05) {
      penalties[themeId] = -(avoidance * scale);
    }
  }

  const preferredThemeIds = Object.entries(dna.themePreferences.favoriteThemes)
    .filter(([, v]) => v > 0.1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id]) => id);

  return { boosts, penalties, preferredThemeIds };
}

// ── Typography overrides ───────────────────────────────────────────────────

export interface DNATypographyOverrides {
  headlineWeightBias: number;      // delta to font weight (e.g., +100 or -100)
  headlineSizeScale: number;       // multiplier (0.9–1.15)
  letterSpacingBias: number;       // delta to letter spacing
  preferUppercase: boolean;
}

export function computeDNATypographyOverrides(dna: DesignDNA): DNATypographyOverrides {
  const s = dna.strength;
  const a = dna.affinities;

  return {
    headlineWeightBias: Math.round(a.typographyWeight * s * 150),
    headlineSizeScale: 1.0 + a.typographyWeight * s * 0.08,
    letterSpacingBias: a.typographyExpressiveness * s * 0.04,
    preferUppercase: a.typographyWeight > 0.5 && s > 0.3,
  };
}

// ── Color overrides ────────────────────────────────────────────────────────

export interface DNAColorOverrides {
  saturationBias: number;    // [-0.15, +0.15] applied to theme palette
  warmthShift: number;       // HSL hue shift hint
  contrastBoost: number;     // overlay/contrast multiplier
}

export function computeDNAColorOverrides(dna: DesignDNA): DNAColorOverrides {
  const s = dna.strength;
  const a = dna.affinities;

  return {
    saturationBias: a.colorSaturation * s * 0.12,
    warmthShift: a.colorWarmth * s * 0.08,
    contrastBoost: a.contrast * s * 0.10,
  };
}

// ── Layout bias ────────────────────────────────────────────────────────────

export interface DNALayoutBias {
  layoutBoosts: Record<string, number>;  // layoutFamily → score delta
  preferredDensity: "airy" | "balanced" | "compact" | null;
  decorationLevel: "minimal" | "moderate" | "rich" | null;
}

export function computeDNALayoutBias(dna: DesignDNA): DNALayoutBias {
  const s = dna.strength;
  const a = dna.affinities;

  const layoutBoosts: Record<string, number> = {};
  for (const [family, affinity] of Object.entries(dna.themePreferences.favoriteLayouts)) {
    if (affinity > 0.05) {
      layoutBoosts[family] = affinity * s * 0.15;
    }
  }

  let preferredDensity: DNALayoutBias["preferredDensity"] = null;
  if (s > 0.2) {
    if (a.spacingDensity > 0.3) preferredDensity = "compact";
    else if (a.spacingDensity < -0.3) preferredDensity = "airy";
    else preferredDensity = "balanced";
  }

  let decorationLevel: DNALayoutBias["decorationLevel"] = null;
  if (s > 0.2) {
    if (a.decorationDensity > 0.4) decorationLevel = "rich";
    else if (a.decorationDensity > 0) decorationLevel = "moderate";
    else decorationLevel = "minimal";
  }

  return { layoutBoosts, preferredDensity, decorationLevel };
}

// ── CTA styling bias ───────────────────────────────────────────────────────

export interface DNACtaBias {
  radiusPreference: "sharp" | "rounded" | "pill" | null;
  shadowPreference: boolean | null;
}

export function computeDNACtaBias(dna: DesignDNA): DNACtaBias {
  if (dna.strength < 0.15) return { radiusPreference: null, shadowPreference: null };

  const a = dna.affinities;

  let radiusPreference: DNACtaBias["radiusPreference"] = null;
  if (a.typographyExpressiveness > 0.3) radiusPreference = "pill";
  else if (a.typographyWeight > 0.4 && a.contrast > 0.3) radiusPreference = "sharp";
  else if (dna.strength > 0.3) radiusPreference = "rounded";

  let shadowPreference: DNACtaBias["shadowPreference"] = null;
  if (a.decorationDensity > 0.2 && a.contrast > 0.2) shadowPreference = true;
  else if (a.decorationDensity < -0.3) shadowPreference = false;

  return { radiusPreference, shadowPreference };
}

// ── Combined personalization context ───────────────────────────────────────
// Single object that pipeline stages can consume without knowing DNA internals.

export interface PersonalizationContext {
  active: boolean;
  strength: number;
  themeBias: DNAThemeBias;
  typographyOverrides: DNATypographyOverrides;
  colorOverrides: DNAColorOverrides;
  layoutBias: DNALayoutBias;
  ctaBias: DNACtaBias;
}

export function buildPersonalizationContext(dna: DesignDNA): PersonalizationContext {
  if (dna.totalSignals < 3 || dna.strength < 0.05) {
    return {
      active: false,
      strength: 0,
      themeBias: { boosts: {}, penalties: {}, preferredThemeIds: [] },
      typographyOverrides: { headlineWeightBias: 0, headlineSizeScale: 1.0, letterSpacingBias: 0, preferUppercase: false },
      colorOverrides: { saturationBias: 0, warmthShift: 0, contrastBoost: 0 },
      layoutBias: { layoutBoosts: {}, preferredDensity: null, decorationLevel: null },
      ctaBias: { radiusPreference: null, shadowPreference: null },
    };
  }

  return {
    active: true,
    strength: dna.strength,
    themeBias: computeDNAThemeBias(dna),
    typographyOverrides: computeDNATypographyOverrides(dna),
    colorOverrides: computeDNAColorOverrides(dna),
    layoutBias: computeDNALayoutBias(dna),
    ctaBias: computeDNACtaBias(dna),
  };
}

// ── Trait observation extraction from theme ─────────────────────────────────
// Converts a generated theme into trait observations for DNA feedback.

export function extractTraitsFromTheme(theme: {
  id: string;
  palette?: { background: string };
  typography?: { headline?: { fontWeight: number; letterSpacing?: number } };
  decorations?: Array<{ kind: string }>;
  ctaStyle?: { borderRadius: number; shadow?: boolean };
  overlayOpacity?: number;
  headlineSizeMultiplier?: number;
}): Partial<import("./design-dna").StyleTraitObservation> {
  const traits: Partial<import("./design-dna").StyleTraitObservation> = {};

  // Typography weight
  const hw = theme.typography?.headline?.fontWeight ?? 400;
  if (hw >= 800) traits.weight = "heavy";
  else if (hw >= 600) traits.weight = "bold";
  else if (hw >= 400) traits.weight = "regular";
  else traits.weight = "light";

  // Expressiveness from letter spacing + size multiplier
  const ls = Math.abs(theme.typography?.headline?.letterSpacing ?? 0);
  const sm = theme.headlineSizeMultiplier ?? 1;
  if (ls > 0.1 || sm > 1.3) traits.expressiveness = "expressive";
  else if (ls < 0.02 && sm <= 1.1) traits.expressiveness = "clean";
  else traits.expressiveness = "balanced";

  // Decoration density
  const decoCount = theme.decorations?.length ?? 0;
  if (decoCount === 0) traits.decorations = "none";
  else if (decoCount <= 3) traits.decorations = "minimal";
  else if (decoCount <= 6) traits.decorations = "moderate";
  else traits.decorations = "rich";

  // Contrast from overlay
  const overlay = theme.overlayOpacity ?? 0;
  if (overlay > 0.3) traits.contrast = "high";
  else if (overlay > 0.1) traits.contrast = "medium";
  else traits.contrast = "low";

  return traits;
}
