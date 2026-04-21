// src/engines/render/typography-hierarchy.ts
//
// Step 60: Typography hierarchy enforcement.
//
// Earlier steps made sure the CANVAS is composed (placement, dominance,
// structural balance). This module enforces hierarchy on the TYPE — the
// piece that most directly controls whether a template reads as
// "designed" vs "generic slide template". Flat, undifferentiated text
// styling is the single strongest signal of a random layout, and it
// slips past every geometry-level check because the zones land in the
// right spots with the wrong weights and sizes.
//
// A template fails typography hierarchy when any of the following are
// true:
//
//   1. The headline is not clearly the largest thing on the canvas.
//      A headline only 1.1× the body size reads as "also a paragraph".
//      We demand at least 1.8× on size, and a weight of 600+ so the
//      headline ACTUALLY dominates, not just nominally.
//
//   2. Multiple text zones share the same (size, weight) tuple. Three
//      zones in 24px/500 means the template has no hierarchy at all —
//      everything shouts at the same volume.
//
//   3. The CTA blends into the body. A CTA that matches body size and
//      weight, or is lighter than body, loses its action character.
//      Call-to-actions must project.
//
//   4. A zone's font-weight falls outside its role's expected band.
//      Legal text in 700 weight reads as shouting; headlines in 300
//      weight read as an afterthought. Each zone role has a band.
//
//   5. Subheads fall outside the visual "bridge" range between
//      headline and body — either too small to scan as a subhead or
//      too large and competing with the headline.
//
//   6. The display / body font pair is disharmonious. We score the
//      pair with the existing font-pairing module; negative scores
//      are rejections (e.g. same-personality duplicates).
//
//   7. A template uses a single font family across every text zone
//      when a paired display + body is available. Single-font
//      typography is legitimate (one-font systems), but unintentional
//      single-font usage (theme provides pair, template ignores it)
//      reads as lazy.
//
// The validator is pure: it consumes a `TypographyProfile` built from
// the final `SvgContent.textContents` and any theme-level pairing
// hints. It does not mutate state or re-pick fonts.

import type { ZoneId } from "../layout/families";
import { scoreFontPair } from "../style/font-pairing";
import type { ThemeFont } from "./design-themes";

// ── Zone-role typography defaults ────────────────────────────────────────────
// Each zone role gets a target size band (ordinal) and a weight range.
// Bands are ordinal, not pixel values, because the per-family layout
// spec sets the actual sizes (IG Post headline ≠ Poster headline). The
// validator compares zones to each other, not to absolute numbers.

export type SizeBand = "display" | "large" | "medium" | "small" | "micro";

/** Lower ordinal = larger visually. display > large > medium > small > micro. */
const BAND_ORDER: Record<SizeBand, number> = {
  display: 0, large: 1, medium: 2, small: 3, micro: 4,
};

export interface ZoneTypographyProfile {
  band:      SizeBand;
  minWeight: number;
  maxWeight: number;
  role:      "display" | "body" | "support";
}

/**
 * Canonical per-zone expectations. Zones missing from this map are
 * treated as unconstrained (accent / image / background / logo).
 */
export const ZONE_TYPOGRAPHY_DEFAULTS: Partial<Record<ZoneId, ZoneTypographyProfile>> = {
  headline:       { band: "display", minWeight: 600, maxWeight: 900, role: "display" },
  title:          { band: "display", minWeight: 600, maxWeight: 900, role: "display" },
  subhead:        { band: "medium",  minWeight: 500, maxWeight: 700, role: "support" },
  section_header: { band: "medium",  minWeight: 500, maxWeight: 700, role: "support" },
  body:           { band: "small",   minWeight: 300, maxWeight: 500, role: "body" },
  bullet_1:       { band: "small",   minWeight: 400, maxWeight: 600, role: "body" },
  bullet_2:       { band: "small",   minWeight: 400, maxWeight: 600, role: "body" },
  bullet_3:       { band: "small",   minWeight: 400, maxWeight: 600, role: "body" },
  cta:            { band: "medium",  minWeight: 600, maxWeight: 800, role: "display" },
  tagline:        { band: "medium",  minWeight: 400, maxWeight: 600, role: "support" },
  badge:          { band: "micro",   minWeight: 500, maxWeight: 700, role: "support" },
  price:          { band: "medium",  minWeight: 600, maxWeight: 900, role: "display" },
  name:           { band: "medium",  minWeight: 500, maxWeight: 700, role: "support" },
  company:        { band: "small",   minWeight: 400, maxWeight: 600, role: "support" },
  contact:        { band: "micro",   minWeight: 300, maxWeight: 500, role: "body" },
  legal:          { band: "micro",   minWeight: 300, maxWeight: 400, role: "body" },
};

// ── Thresholds ───────────────────────────────────────────────────────────────

/** Headline size must be at least this multiple of the tallest body/subhead. */
export const HEADLINE_DOMINANCE_RATIO = 1.8;

/** Minimum number of zones that must share an identical (size, weight) tuple
 *  before we flag flat hierarchy. 3 sibling zones in the same style reads
 *  as "no hierarchy"; 2 can still be intentional (paired badges, price+cta). */
export const FLAT_HIERARCHY_MIN_COUNT = 3;

/** Subhead should be no larger than this fraction of the headline. Above
 *  this, subhead starts competing. */
export const SUBHEAD_MAX_FRACTION_OF_HEADLINE = 0.75;

/** Subhead should be at least this fraction above body size to read as a
 *  bridge — anything closer blends into the paragraph. */
export const SUBHEAD_MIN_MULTIPLIER_OF_BODY = 1.15;

/** Font-pair score below this is a warning; below 0 is an error. */
export const PAIR_SCORE_HARMONY_FLOOR = 0.5;

/** Distinct text zones that share a single family before the
 *  single-font-only warning fires. */
export const SINGLE_FONT_ZONE_THRESHOLD = 4;

// ── Input shape ──────────────────────────────────────────────────────────────

/**
 * Minimal per-zone typography descriptor. Matches the fields the
 * SVG builder emits on `SvgContent.textContents`, plus an optional
 * `role` hint when the caller already knows the display/body split.
 */
export interface TextZoneStyle {
  zone:        ZoneId;
  text?:       string;
  fontSize:    number;     // px
  fontWeight:  number;     // 100-900
  fontFamily:  string;
  letterSpacing?: number;  // em
}

export interface TypographyProfile {
  zones:        readonly TextZoneStyle[];
  /** The theme's intended display font, if known. Used for pair scoring. */
  displayFont?: ThemeFont;
  /** The theme's intended body font, if known. Used for pair scoring. */
  bodyFont?:    ThemeFont;
}

// ── Violation shape ──────────────────────────────────────────────────────────

export interface TypographyViolation {
  rule:
    | "headline_not_dominant"    // headline size ratio too low, or weight too light
    | "flat_hierarchy"           // 3+ zones with identical (size, weight)
    | "cta_not_prominent"        // CTA blends into body / subhead
    | "zone_weight_out_of_band"  // a zone weight falls outside its role band
    | "subhead_out_of_band"      // subhead too big vs headline or too small vs body
    | "font_pair_disharmony"     // display+body pair has negative/low score
    | "single_font_overuse";     // every zone uses the same family when pair exists
  severity: "error" | "warning";
  message:  string;
  metric?:  number;
  zone?:    ZoneId;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function largestByZones(
  zones: readonly TextZoneStyle[],
  predicate: (z: TextZoneStyle) => boolean,
): TextZoneStyle | undefined {
  let best: TextZoneStyle | undefined;
  for (const z of zones) {
    if (!predicate(z)) continue;
    if (!best || z.fontSize > best.fontSize) best = z;
  }
  return best;
}

const BODY_LIKE_ZONES: ReadonlySet<ZoneId> = new Set<ZoneId>([
  "body", "bullet_1", "bullet_2", "bullet_3",
  "tagline", "contact", "legal", "company",
]);

const SUBHEAD_LIKE_ZONES: ReadonlySet<ZoneId> = new Set<ZoneId>([
  "subhead", "section_header",
]);

const HEADLINE_LIKE_ZONES: ReadonlySet<ZoneId> = new Set<ZoneId>([
  "headline", "title",
]);

// ── Validator ────────────────────────────────────────────────────────────────

/**
 * Enforce typography hierarchy on a resolved `TypographyProfile`. Returns
 * every violation encountered. The pipeline treats `error` rows as
 * rejections and folds `warning` rows into marketplace-gate scoring.
 */
export function validateTypographyHierarchy(
  profile: TypographyProfile,
): TypographyViolation[] {
  const violations: TypographyViolation[] = [];
  const zones = profile.zones;
  if (zones.length === 0) return violations;

  // ── 1. Headline dominance ───────────────────────────────────────────────
  // A headline must out-size every body/subhead by HEADLINE_DOMINANCE_RATIO
  // and carry a weight heavy enough to project.
  const headline = largestByZones(zones, z => HEADLINE_LIKE_ZONES.has(z.zone));
  const bodyOrSubheadTallest = largestByZones(zones, z =>
    BODY_LIKE_ZONES.has(z.zone) || SUBHEAD_LIKE_ZONES.has(z.zone),
  );
  if (headline && bodyOrSubheadTallest) {
    const ratio = headline.fontSize / bodyOrSubheadTallest.fontSize;
    if (ratio < HEADLINE_DOMINANCE_RATIO) {
      violations.push({
        rule:     "headline_not_dominant",
        severity: "error",
        metric:   ratio,
        zone:     headline.zone,
        message:
          `Headline (${headline.fontSize}px) is only ${ratio.toFixed(2)}× ` +
          `the largest body/subhead zone (${bodyOrSubheadTallest.zone} @ ` +
          `${bodyOrSubheadTallest.fontSize}px) — below the ${HEADLINE_DOMINANCE_RATIO}× ` +
          `floor. Grow the headline or shrink the secondary text.`,
      });
    }
    if (headline.fontWeight < 600) {
      violations.push({
        rule:     "headline_not_dominant",
        severity: "error",
        metric:   headline.fontWeight,
        zone:     headline.zone,
        message:
          `Headline weight ${headline.fontWeight} is below 600 — headlines must ` +
          `read as bold / semibold so they visually lead. Bump the weight to ≥600.`,
      });
    }
  }

  // ── 2. Flat hierarchy ───────────────────────────────────────────────────
  // Count zones that share an identical (fontSize, fontWeight) tuple.
  // 3+ colliding is flat typography — no hierarchy at all.
  const styleBuckets = new Map<string, TextZoneStyle[]>();
  for (const z of zones) {
    const k = `${z.fontSize}|${z.fontWeight}`;
    const bucket = styleBuckets.get(k) ?? [];
    bucket.push(z);
    styleBuckets.set(k, bucket);
  }
  for (const [key, bucket] of styleBuckets) {
    if (bucket.length >= FLAT_HIERARCHY_MIN_COUNT) {
      const [size, weight] = key.split("|");
      violations.push({
        rule:     "flat_hierarchy",
        severity: "error",
        metric:   bucket.length,
        message:
          `${bucket.length} zones (${bucket.map(b => b.zone).join(", ")}) share ` +
          `identical ${size}px / weight ${weight} — flat typography with no ` +
          `visual hierarchy. Differentiate the headline, subhead, and body by ` +
          `size and weight.`,
      });
    }
  }

  // ── 3. CTA prominence ──────────────────────────────────────────────────
  // CTA must be heavier than body, and no smaller than body. If the CTA
  // matches body in both axes it disappears into the paragraph.
  const cta  = zones.find(z => z.zone === "cta");
  const body = largestByZones(zones, z => z.zone === "body");
  if (cta && body) {
    if (cta.fontWeight < 600) {
      violations.push({
        rule:     "cta_not_prominent",
        severity: "error",
        metric:   cta.fontWeight,
        zone:     "cta",
        message:
          `CTA weight ${cta.fontWeight} is below 600 — call-to-action text ` +
          `needs semibold / bold presence to read as actionable. Bump to ≥600.`,
      });
    }
    if (cta.fontSize <= body.fontSize && cta.fontWeight <= body.fontWeight) {
      violations.push({
        rule:     "cta_not_prominent",
        severity: "error",
        zone:     "cta",
        message:
          `CTA (${cta.fontSize}px / ${cta.fontWeight}) does not visually ` +
          `exceed body text (${body.fontSize}px / ${body.fontWeight}) on ` +
          `either size or weight. CTAs must project — increase size, weight, ` +
          `or both so the action stands out.`,
      });
    }
  }

  // ── 4. Zone weight out-of-band ─────────────────────────────────────────
  for (const z of zones) {
    const def = ZONE_TYPOGRAPHY_DEFAULTS[z.zone];
    if (!def) continue;
    if (z.fontWeight < def.minWeight || z.fontWeight > def.maxWeight) {
      violations.push({
        rule:     "zone_weight_out_of_band",
        severity: "warning",
        metric:   z.fontWeight,
        zone:     z.zone,
        message:
          `Zone "${z.zone}" weight ${z.fontWeight} is outside the role band ` +
          `${def.minWeight}–${def.maxWeight} (${def.role}). Pick a weight ` +
          `that matches the zone's hierarchical role.`,
      });
    }
  }

  // ── 5. Subhead band ────────────────────────────────────────────────────
  // Subheads must stay below SUBHEAD_MAX_FRACTION_OF_HEADLINE * headline
  // AND above SUBHEAD_MIN_MULTIPLIER_OF_BODY * body. Outside that band
  // they either compete with the headline or blend into the paragraph.
  const subhead = largestByZones(zones, z => SUBHEAD_LIKE_ZONES.has(z.zone));
  if (subhead && headline) {
    const maxAllowed = headline.fontSize * SUBHEAD_MAX_FRACTION_OF_HEADLINE;
    if (subhead.fontSize > maxAllowed) {
      violations.push({
        rule:     "subhead_out_of_band",
        severity: "warning",
        metric:   subhead.fontSize / headline.fontSize,
        zone:     subhead.zone,
        message:
          `Subhead ${subhead.fontSize}px exceeds ${(SUBHEAD_MAX_FRACTION_OF_HEADLINE * 100).toFixed(0)}% ` +
          `of headline (${headline.fontSize}px) — it competes for the lead ` +
          `instead of supporting it. Shrink the subhead.`,
      });
    }
  }
  if (subhead && body) {
    const minAllowed = body.fontSize * SUBHEAD_MIN_MULTIPLIER_OF_BODY;
    if (subhead.fontSize < minAllowed) {
      violations.push({
        rule:     "subhead_out_of_band",
        severity: "warning",
        metric:   subhead.fontSize / body.fontSize,
        zone:     subhead.zone,
        message:
          `Subhead ${subhead.fontSize}px is less than ${SUBHEAD_MIN_MULTIPLIER_OF_BODY}× ` +
          `body (${body.fontSize}px) — it won't read as a bridge. Grow the subhead.`,
      });
    }
  }

  // ── 6. Font-pair harmony ───────────────────────────────────────────────
  if (profile.displayFont && profile.bodyFont && profile.displayFont !== profile.bodyFont) {
    const pair = scoreFontPair(profile.displayFont, profile.bodyFont);
    if (pair.total < 0) {
      violations.push({
        rule:     "font_pair_disharmony",
        severity: "error",
        metric:   pair.total,
        message:
          `Display "${profile.displayFont}" + body "${profile.bodyFont}" scores ` +
          `${pair.total.toFixed(2)} — anti-pair. Reasons: ${pair.reasons.join("; ")}. ` +
          `Pick a complementary pair (serif×sans, industrial×humanist, etc.).`,
      });
    } else if (pair.total < PAIR_SCORE_HARMONY_FLOOR) {
      violations.push({
        rule:     "font_pair_disharmony",
        severity: "warning",
        metric:   pair.total,
        message:
          `Display "${profile.displayFont}" + body "${profile.bodyFont}" scores ` +
          `${pair.total.toFixed(2)} — weak pairing. Reasons: ${pair.reasons.join("; ")}.`,
      });
    }
  }

  // ── 7. Single-font overuse ─────────────────────────────────────────────
  // A distinct pair exists but every zone still uses the same family.
  if (profile.displayFont && profile.bodyFont &&
      profile.displayFont !== profile.bodyFont &&
      zones.length >= SINGLE_FONT_ZONE_THRESHOLD) {
    const families = new Set(zones.map(z => z.fontFamily));
    if (families.size === 1) {
      violations.push({
        rule:     "single_font_overuse",
        severity: "warning",
        metric:   zones.length,
        message:
          `All ${zones.length} text zones use the same family "${[...families][0]}" ` +
          `while the theme provides a display/body pair (${profile.displayFont} / ` +
          `${profile.bodyFont}). Apply the pair — one family across every zone ` +
          `reads as generic.`,
      });
    }
  }

  return violations;
}

// ── Profile extraction helper ────────────────────────────────────────────────

/**
 * Build a TypographyProfile from a final SvgContent-like object. Accepts
 * the minimal fields actually needed so it works both on real
 * SvgContent (via duck typing) and on ad-hoc test inputs.
 */
export function buildTypographyProfile(
  content: {
    textContents: ReadonlyArray<{
      zoneId: string; fontSize: number; weight: number;
      fontFamily: string; letterSpacing?: number;
    }>;
  },
  pair?: { display?: ThemeFont; body?: ThemeFont },
): TypographyProfile {
  return {
    zones: content.textContents.map(tc => ({
      zone:          tc.zoneId as ZoneId,
      fontSize:      tc.fontSize,
      fontWeight:    tc.weight,
      fontFamily:    tc.fontFamily,
      letterSpacing: tc.letterSpacing,
    })),
    displayFont: pair?.display,
    bodyFont:    pair?.body,
  };
}

/** Lower ordinal = larger band. Useful for tests. */
export function sizeBandOrdinal(band: SizeBand): number {
  return BAND_ORDER[band];
}
