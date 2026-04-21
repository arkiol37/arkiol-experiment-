// src/engines/render/color-harmony.ts
//
// Step 61: Color harmony enforcement.
//
// The existing pipeline already covers WCAG contrast (low_contrast_text)
// and palette fragmentation via 30° hue bucketing (palette_fragmentation).
// What it DOESN'T catch:
//
//   • Random hue combos that technically clear the fragmentation cap but
//     have no harmonic relationship — no monochromatic, analogous,
//     complementary, or triadic structure. Three random hues pass the
//     bucket test and still feel uncoordinated.
//
//   • Saturation clashes — muted pastels sitting next to neon accents,
//     which reads as "two templates glued together" even though every
//     hue passes contrast.
//
//   • Harsh gradients — linear / radial / mesh backgrounds whose
//     endpoints jump 120° across the wheel at similar lightness produce
//     visible seams. Good gradients ramp lightness within a hue or
//     slide a small amount of hue along a lightness ramp.
//
//   • Text that feels pasted on — a text color whose hue doesn't belong
//     to the palette's neighbourhood reads like a styling mistake even
//     if WCAG passes.
//
//   • Category drift — fitness templates in mint-green pastels or
//     wellness templates in neon orange. Category carries a mood
//     expectation (warmth, saturation band, lightness band) and
//     palettes that drift from it feel off-brief.
//
//   • Indistinct accents — a highlight that differs from the primary
//     by 8° hue does no visual work. Designers reach for the highlight
//     when they need a hit of contrast; a clone isn't one.
//
// This module is a pure validator. It takes a minimal palette input
// (the seven ThemePalette slots, an optional gradient, an optional
// category) and returns a list of violations.

import type { AssetCategory } from "../../lib/asset-library";

// ── HSL conversion (self-contained) ──────────────────────────────────────────
// Kept inside this module so it doesn't cross-couple into the mutator's
// HSL helpers, which evolve independently for color-transformation
// purposes. The math here targets perceptual grouping, not mutation.

export interface Hsl { h: number; s: number; l: number; }

/** Parse "#rrggbb" / "#rgb" into HSL. Returns { h:0, s:0, l:0 } on garbage. */
export function hexToHsl(hex: string): Hsl {
  const norm = hex.trim().toLowerCase();
  let m = norm.match(/^#?([0-9a-f]{6})$/);
  let r = 0, g = 0, b = 0;
  if (m) {
    r = parseInt(m[1].slice(0, 2), 16);
    g = parseInt(m[1].slice(2, 4), 16);
    b = parseInt(m[1].slice(4, 6), 16);
  } else {
    m = norm.match(/^#?([0-9a-f]{3})$/);
    if (!m) return { h: 0, s: 0, l: 0 };
    r = parseInt(m[1][0] + m[1][0], 16);
    g = parseInt(m[1][1] + m[1][1], 16);
    b = parseInt(m[1][2] + m[1][2], 16);
  }
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rn: h = (gn - bn) / d + (gn < bn ? 6 : 0); break;
      case gn: h = (bn - rn) / d + 2; break;
      case bn: h = (rn - gn) / d + 4; break;
    }
    h *= 60;
  }
  return { h, s, l };
}

/** Shortest angular distance between two hues in degrees, 0–180. */
export function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

// ── Hue families ─────────────────────────────────────────────────────────────
// Coarse 10-bucket family taxonomy. Used by category-drift checks and
// warm/cool balance. `neutral` is reserved for very low saturation
// (no meaningful hue).

export type HueFamily =
  | "red" | "orange" | "yellow" | "lime" | "green" | "teal"
  | "blue" | "indigo" | "purple" | "pink" | "neutral";

export function hueFamily(color: Hsl | string): HueFamily {
  const hsl = typeof color === "string" ? hexToHsl(color) : color;
  if (hsl.s < 0.12) return "neutral";
  const h = ((hsl.h % 360) + 360) % 360;
  if (h < 15)  return "red";
  if (h < 45)  return "orange";
  if (h < 65)  return "yellow";
  if (h < 85)  return "lime";
  if (h < 155) return "green";
  if (h < 185) return "teal";
  if (h < 225) return "blue";
  if (h < 265) return "indigo";
  if (h < 295) return "purple";
  if (h < 335) return "pink";
  return "red";
}

/** Warmth classification — reds/oranges/yellows warm, blues/teals/indigos cool. */
export type Warmth = "warm" | "cool" | "neutral";

const FAMILY_WARMTH: Record<HueFamily, Warmth> = {
  red:     "warm",  orange:  "warm",  yellow:  "warm",
  lime:    "neutral", green: "cool",  teal:    "cool",
  blue:    "cool",  indigo:  "cool",  purple:  "neutral",
  pink:    "warm",  neutral: "neutral",
};

export function warmthOf(color: Hsl | string): Warmth {
  return FAMILY_WARMTH[hueFamily(color)];
}

// ── Harmonic relationship detection ──────────────────────────────────────────
// Classic color-theory relationships between two or three non-neutral
// hues. Ordered from tightest to loosest: a palette that reads as
// "monochromatic" wins over "analogous" when both fit.

export type HarmonicRelation =
  | "monochromatic"
  | "analogous"
  | "complementary"
  | "split-complementary"
  | "triadic"
  | "tetradic"
  | "none";

/**
 * Classify a bag of 2–4 non-neutral hues into a harmonic relationship.
 * Returns "none" when the hues don't cluster into any recognised pattern.
 */
export function detectHarmonic(hues: readonly number[]): HarmonicRelation {
  const hs = hues.filter(h => Number.isFinite(h));
  if (hs.length < 2) return "monochromatic";

  const pairs: number[] = [];
  for (let i = 0; i < hs.length; i++) {
    for (let j = i + 1; j < hs.length; j++) {
      pairs.push(hueDistance(hs[i], hs[j]));
    }
  }
  const maxSpread = Math.max(...pairs);

  // Monochromatic — every hue within 15° of every other.
  if (maxSpread <= 15) return "monochromatic";

  // Analogous — every hue within 40° of every other (a small slice).
  if (maxSpread <= 40) return "analogous";

  // Complementary — exactly two clusters ~180° apart.
  if (hs.length === 2 && Math.abs(pairs[0] - 180) <= 20) return "complementary";

  // Triadic — three hues roughly evenly spaced 120° apart.
  if (hs.length === 3 &&
      pairs.every(p => Math.abs(p - 120) <= 20)) {
    return "triadic";
  }

  // Split-complementary — one hue and two neighbours of its opposite
  // (opposite ± 30°). With 3 hues we see distances of ~60, ~150, ~150.
  if (hs.length === 3) {
    const sorted = [...pairs].sort((a, b) => a - b);
    if (Math.abs(sorted[0] - 60)  <= 20 &&
        Math.abs(sorted[1] - 150) <= 20 &&
        Math.abs(sorted[2] - 150) <= 20) {
      return "split-complementary";
    }
  }

  // Tetradic — two complementary pairs (four hues, two distances near
  // 180 and two near 60/120).
  if (hs.length === 4) {
    const close180 = pairs.filter(p => Math.abs(p - 180) <= 20).length;
    if (close180 >= 2) return "tetradic";
  }

  return "none";
}

// ── Category targets ─────────────────────────────────────────────────────────
// Each category carries an expected palette mood. `temperature` steers
// warm / cool / neutral; saturation and lightness bands bound the vibe.
// These are soft targets — the drift rule only warns, never errors,
// because brand overrides and creative choices legitimately bend the
// frame.

export interface CategoryPaletteTarget {
  temperature:    Warmth | "any";
  saturationBand: [number, number];   // mean non-neutral saturation
  lightnessBand:  [number, number];   // mean lightness including background
  preferredFamilies?: readonly HueFamily[];
  avoidFamilies?:     readonly HueFamily[];
  rationale:      string;
}

export const CATEGORY_PALETTE_TARGETS: Record<AssetCategory, CategoryPaletteTarget> = {
  productivity: {
    temperature:       "cool",
    saturationBand:    [0.15, 0.55],
    lightnessBand:     [0.40, 0.92],
    preferredFamilies: ["blue", "indigo", "teal", "neutral"],
    avoidFamilies:     ["pink", "orange"],
    rationale:         "productivity reads cleanest in calm cools + neutrals.",
  },
  wellness: {
    temperature:       "cool",
    saturationBand:    [0.15, 0.50],
    lightnessBand:     [0.55, 0.95],
    preferredFamilies: ["green", "teal", "blue", "purple", "neutral"],
    avoidFamilies:     ["red"],
    rationale:         "wellness wants muted, restful cools / soft pastels.",
  },
  education: {
    temperature:       "any",
    saturationBand:    [0.25, 0.70],
    lightnessBand:     [0.45, 0.90],
    preferredFamilies: ["blue", "teal", "orange", "yellow"],
    avoidFamilies:     [],
    rationale:         "education can carry crisp primaries with trust-blue anchor.",
  },
  business: {
    temperature:       "cool",
    saturationBand:    [0.10, 0.45],
    lightnessBand:     [0.35, 0.88],
    preferredFamilies: ["blue", "indigo", "neutral", "teal"],
    avoidFamilies:     ["pink", "yellow", "lime"],
    rationale:         "business palettes anchor on trust-cool + low saturation.",
  },
  fitness: {
    temperature:       "warm",
    saturationBand:    [0.50, 0.90],
    lightnessBand:     [0.35, 0.70],
    preferredFamilies: ["orange", "red", "yellow", "lime"],
    avoidFamilies:     ["pink", "purple"],
    rationale:         "fitness wants energetic warms with strong saturation.",
  },
  beauty: {
    temperature:       "warm",
    saturationBand:    [0.25, 0.65],
    lightnessBand:     [0.55, 0.92],
    preferredFamilies: ["pink", "red", "purple", "orange", "neutral"],
    avoidFamilies:     ["lime", "green", "teal"],
    rationale:         "beauty leans soft warms, blush pinks, and neutrals.",
  },
  travel: {
    temperature:       "any",
    saturationBand:    [0.30, 0.75],
    lightnessBand:     [0.40, 0.88],
    preferredFamilies: ["blue", "teal", "orange", "yellow", "green"],
    avoidFamilies:     ["pink"],
    rationale:         "travel pairs natural warms (sand/sunset) with sky cools.",
  },
  marketing: {
    temperature:       "any",
    saturationBand:    [0.45, 0.90],
    lightnessBand:     [0.30, 0.80],
    preferredFamilies: ["red", "orange", "yellow", "purple", "pink", "blue"],
    avoidFamilies:     [],
    rationale:         "marketing tolerates vibrant saturated hits — stoppers.",
  },
  motivation: {
    temperature:       "any",
    saturationBand:    [0.25, 0.75],
    lightnessBand:     [0.30, 0.85],
    preferredFamilies: ["orange", "yellow", "blue", "indigo", "red"],
    avoidFamilies:     ["lime"],
    rationale:         "motivation benefits from high-contrast warm focal + dark field.",
  },
};

// ── Thresholds ───────────────────────────────────────────────────────────────

/** Maximum saturation spread (max − min across non-neutrals) before clash. */
export const MAX_SATURATION_SPREAD = 0.55;

/** Gradient endpoints above this hue distance AND within the lightness
 *  delta below are flagged as harsh bands. */
export const HARSH_GRADIENT_HUE_DISTANCE = 60;
export const HARSH_GRADIENT_LIGHTNESS_DELTA = 0.15;

/** Text hue must be within this of some non-neutral palette hue, OR text
 *  must be neutral itself, to belong to the palette. */
export const TEXT_PALETTE_MAX_HUE_DISTANCE = 45;

/** Highlight/accent clone thresholds — all three must hit for the accent
 *  to be "indistinct" from primary. */
export const ACCENT_MIN_HUE_DISTANCE      = 15;
export const ACCENT_MIN_SATURATION_DELTA  = 0.10;
export const ACCENT_MIN_LIGHTNESS_DELTA   = 0.08;

/** Saturation below this counts as "effectively neutral" for family logic. */
export const NEUTRAL_SATURATION_THRESHOLD = 0.12;

// ── Input / output shapes ────────────────────────────────────────────────────

export interface PaletteInput {
  background:  string;
  surface:     string;
  primary:     string;
  secondary:   string;
  text:        string;
  textMuted:   string;
  highlight:   string;
  /** Optional background gradient (linear / radial / mesh / none). */
  gradient?: {
    type:   "linear" | "radial" | "mesh" | "none";
    colors: readonly string[];
  };
  /** Optional — when present, palette is scored against category target. */
  category?: AssetCategory;
}

export interface ColorHarmonyViolation {
  rule:
    | "palette_disharmony"       // core hues don't map to any relationship
    | "saturation_clash"         // non-neutral saturation range > MAX_SPREAD
    | "harsh_gradient"           // gradient endpoints far in hue, close in L
    | "text_palette_mismatch"    // text hue orphaned from palette
    | "category_palette_drift"   // palette mood doesn't match category target
    | "accent_indistinct";       // highlight clones primary
  severity: "error" | "warning";
  message:  string;
  metric?:  number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function isNeutral(h: Hsl): boolean {
  return h.s < NEUTRAL_SATURATION_THRESHOLD;
}

function nonNeutralHues(palette: PaletteInput): Hsl[] {
  const tokens = [
    palette.primary, palette.secondary, palette.highlight,
    palette.background, palette.surface,
  ];
  return tokens.map(hexToHsl).filter(h => !isNeutral(h));
}

// ── Validator ────────────────────────────────────────────────────────────────

/**
 * Check a palette for harmony problems. Returns every violation
 * encountered; callers surface errors as hard rejections and fold
 * warnings into marketplace-gate scoring alongside the existing
 * `palette_fragmentation` / `low_contrast_text` signals.
 */
export function validateColorHarmony(
  palette: PaletteInput,
): ColorHarmonyViolation[] {
  const violations: ColorHarmonyViolation[] = [];

  const primary   = hexToHsl(palette.primary);
  const secondary = hexToHsl(palette.secondary);
  const highlight = hexToHsl(palette.highlight);
  const background= hexToHsl(palette.background);
  const text      = hexToHsl(palette.text);

  // ── 1. Palette disharmony ──────────────────────────────────────────────
  // Core identity = primary + secondary + highlight. Skip hues that are
  // effectively neutral; two saturated hues still need a relationship,
  // but "primary + neutral + neutral" is a legitimate one-color palette.
  const coreHues = [primary, secondary, highlight]
    .filter(h => !isNeutral(h))
    .map(h => h.h);

  if (coreHues.length >= 2) {
    const relation = detectHarmonic(coreHues);
    if (relation === "none") {
      violations.push({
        rule:     "palette_disharmony",
        severity: "error",
        message:
          `Core palette hues (${coreHues.map(h => h.toFixed(0) + "°").join(", ")}) ` +
          `don't form any recognised harmonic relationship (monochromatic, ` +
          `analogous, complementary, split-complementary, triadic). Re-pick ` +
          `so the hues share the wheel instead of scattering.`,
      });
    }
  }

  // ── 2. Saturation clash ────────────────────────────────────────────────
  const nonNeutral = nonNeutralHues(palette);
  if (nonNeutral.length >= 2) {
    const sats = nonNeutral.map(h => h.s);
    const spread = Math.max(...sats) - Math.min(...sats);
    if (spread > MAX_SATURATION_SPREAD) {
      violations.push({
        rule:     "saturation_clash",
        severity: "warning",
        metric:   spread,
        message:
          `Saturation range across non-neutral palette tokens is ` +
          `${spread.toFixed(2)} — above the ${MAX_SATURATION_SPREAD} cap. ` +
          `Muted pastels mixed with neon accents clash. Pull the palette into ` +
          `a consistent saturation band.`,
      });
    }
  }

  // ── 3. Harsh gradient ─────────────────────────────────────────────────
  if (palette.gradient && palette.gradient.type !== "none" && palette.gradient.colors.length >= 2) {
    const colors = palette.gradient.colors.map(hexToHsl);
    // Check each consecutive pair — linear and radial have two stops;
    // mesh gradients typically three or four. Worst pair wins.
    let worstHue = 0, pairLDelta = 1;
    for (let i = 0; i < colors.length - 1; i++) {
      const a = colors[i], b = colors[i + 1];
      if (isNeutral(a) || isNeutral(b)) continue;
      const hd = hueDistance(a.h, b.h);
      const ld = Math.abs(a.l - b.l);
      if (hd > worstHue || (hd === worstHue && ld < pairLDelta)) {
        worstHue   = hd;
        pairLDelta = ld;
      }
    }
    if (worstHue > HARSH_GRADIENT_HUE_DISTANCE && pairLDelta < HARSH_GRADIENT_LIGHTNESS_DELTA) {
      violations.push({
        rule:     "harsh_gradient",
        severity: "error",
        metric:   worstHue,
        message:
          `Gradient endpoints jump ${worstHue.toFixed(0)}° across the hue wheel ` +
          `while keeping lightness within ${pairLDelta.toFixed(2)} — producing a ` +
          `harsh visible seam. Either pull the hues closer or add a lightness ramp.`,
      });
    }
  }

  // ── 4. Text-palette mismatch ──────────────────────────────────────────
  // If text is saturated enough to carry a hue, that hue should be near
  // at least one palette hue. Neutral / near-black / near-white text is
  // always allowed.
  if (!isNeutral(text) && nonNeutral.length > 0) {
    const bestDistance = Math.min(
      ...nonNeutral.map(h => hueDistance(h.h, text.h)),
    );
    if (bestDistance > TEXT_PALETTE_MAX_HUE_DISTANCE) {
      violations.push({
        rule:     "text_palette_mismatch",
        severity: "warning",
        metric:   bestDistance,
        message:
          `Text hue ${text.h.toFixed(0)}° is ${bestDistance.toFixed(0)}° from the ` +
          `nearest palette hue — reads as pasted on. Pull the text colour toward ` +
          `the palette's neighbourhood or swap it for a neutral.`,
      });
    }
  }

  // ── 5. Category palette drift ─────────────────────────────────────────
  if (palette.category) {
    const target = CATEGORY_PALETTE_TARGETS[palette.category];
    if (target) {
      const driftReasons: string[] = [];

      // Temperature — check dominant warmth of non-neutral tokens.
      if (target.temperature !== "any" && nonNeutral.length > 0) {
        const warmth = nonNeutral.map(h => warmthOf(h));
        const warmCount = warmth.filter(w => w === "warm").length;
        const coolCount = warmth.filter(w => w === "cool").length;
        const dominant: Warmth =
          warmCount > coolCount ? "warm"
          : coolCount > warmCount ? "cool"
          : "neutral";
        if (dominant !== "neutral" && dominant !== target.temperature) {
          driftReasons.push(
            `palette reads ${dominant}, category wants ${target.temperature}`,
          );
        }
      }

      // Saturation mean.
      if (nonNeutral.length > 0) {
        const satMean = nonNeutral.reduce((s, h) => s + h.s, 0) / nonNeutral.length;
        if (satMean < target.saturationBand[0] || satMean > target.saturationBand[1]) {
          driftReasons.push(
            `saturation mean ${satMean.toFixed(2)} outside ` +
            `${target.saturationBand[0]}–${target.saturationBand[1]}`,
          );
        }
      }

      // Lightness mean — include background for the overall "airiness".
      const lightnessTokens = [background, primary, secondary, highlight];
      const lMean = lightnessTokens.reduce((s, h) => s + h.l, 0) / lightnessTokens.length;
      if (lMean < target.lightnessBand[0] || lMean > target.lightnessBand[1]) {
        driftReasons.push(
          `lightness mean ${lMean.toFixed(2)} outside ` +
          `${target.lightnessBand[0]}–${target.lightnessBand[1]}`,
        );
      }

      // Avoid-family check — any non-neutral token in an avoid family.
      if (target.avoidFamilies && target.avoidFamilies.length > 0) {
        const bad = nonNeutral
          .map(h => hueFamily(h))
          .filter(f => target.avoidFamilies!.includes(f));
        if (bad.length > 0) {
          driftReasons.push(
            `contains avoided family ${Array.from(new Set(bad)).join(", ")}`,
          );
        }
      }

      if (driftReasons.length > 0) {
        violations.push({
          rule:     "category_palette_drift",
          severity: "warning",
          message:
            `Palette drifts from the ${palette.category} category mood ` +
            `(${target.rationale}): ${driftReasons.join("; ")}.`,
        });
      }
    }
  }

  // ── 6. Accent indistinct ──────────────────────────────────────────────
  // Skip when either primary or highlight is effectively neutral — a
  // neutral highlight is legitimate (white / cream accents).
  if (!isNeutral(primary) && !isNeutral(highlight)) {
    const hd = hueDistance(primary.h, highlight.h);
    const sd = Math.abs(primary.s - highlight.s);
    const ld = Math.abs(primary.l - highlight.l);
    if (hd < ACCENT_MIN_HUE_DISTANCE &&
        sd < ACCENT_MIN_SATURATION_DELTA &&
        ld < ACCENT_MIN_LIGHTNESS_DELTA) {
      violations.push({
        rule:     "accent_indistinct",
        severity: "warning",
        metric:   hd,
        message:
          `Highlight hue ${highlight.h.toFixed(0)}° is within ${hd.toFixed(0)}° ` +
          `of primary (Δs=${sd.toFixed(2)}, Δl=${ld.toFixed(2)}) — the accent ` +
          `does no work. Shift the highlight's hue, saturation, or lightness ` +
          `so it reads as a distinct second voice.`,
      });
    }
  }

  return violations;
}
