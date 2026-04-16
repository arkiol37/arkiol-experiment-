// src/engines/render/candidate-quality.ts
//
// Quality scoring system for template candidates.
// Evaluates visual richness, decoration diversity, palette variety,
// content completeness, and uniqueness to reject bland outputs and
// rank candidates by marketplace-quality appearance.
//
// Used by svg-builder-ultimate (multi-candidate theme picking) and
// layout-intelligence (enhanced scoring dimensions).

import type { DesignTheme, DecorShape, BgTreatment } from "./design-themes";
import type { SvgContent } from "./svg-builder-ultimate";

// ── Quality score dimensions ──────────────────────────────────────────────────

export interface CandidateQualityScore {
  /** Decoration count and variety (0-1) */
  decorationRichness: number;
  /** Number of distinct decoration kinds used (0-1) */
  decorationDiversity: number;
  /** Background complexity — mesh/split > radial > linear > solid (0-1) */
  backgroundComplexity: number;
  /** Palette use — how many distinct palette colors appear in decorations (0-1) */
  paletteUtilization: number;
  /** Presence of premium elements: frames, stickers, icons, ribbons, etc. (0-1) */
  premiumElements: number;
  /** Text zone completeness — how many key zones are populated (0-1) */
  contentCompleteness: number;
  /** Visual layering — card panels, overlays, textures stacked (0-1) */
  visualLayering: number;
  /** Composite weighted score (0-1) */
  total: number;
}

// Premium shape kinds — these elevate templates beyond "flat card" feel
const PREMIUM_KINDS = new Set<string>([
  "ribbon", "sticker_circle", "icon_symbol", "checklist", "frame_border",
  "section_divider", "texture_fill", "photo_circle", "starburst",
  "price_tag", "banner_strip", "badge_pill",
]);

// Layering shape kinds — these create visual depth
const LAYERING_KINDS = new Set<string>([
  "card_panel", "noise_overlay", "texture_fill", "glow_circle",
  "diagonal_band", "starburst",
]);

// All known decoration kind names for diversity scoring
const ALL_DECOR_KINDS = new Set<string>([
  "circle", "rect", "blob", "line", "dots_grid", "diagonal_stripe",
  "half_circle", "accent_bar", "badge_pill", "deco_ring", "triangle",
  "cross", "wave", "card_panel", "glow_circle", "flower", "squiggle",
  "arc_stroke", "corner_bracket", "diagonal_band", "noise_overlay",
  "ribbon", "sticker_circle", "icon_symbol", "checklist", "frame_border",
  "section_divider", "texture_fill", "photo_circle", "starburst",
  "price_tag", "banner_strip",
]);

// ── Background complexity ranking ─────────────────────────────────────────────

function scoreBgComplexity(bg: BgTreatment): number {
  switch (bg.kind) {
    case "mesh":            return 1.0;
    case "split":           return 0.75;
    case "radial_gradient": return 0.6;
    case "linear_gradient": return bg.colors.length >= 3 ? 0.5 : 0.35;
    case "solid":           return 0.2;
    default:                return 0.1;
  }
}

// ── Theme quality scoring ─────────────────────────────────────────────────────

export function scoreThemeQuality(theme: DesignTheme): CandidateQualityScore {
  const decos = theme.decorations;
  const kindSet = new Set(decos.map(d => d.kind));

  // Decoration richness: count-based (diminishing returns above 8)
  const decoCount = decos.length;
  const decorationRichness = clamp(decoCount / 10, 0, 1);

  // Decoration diversity: unique kinds / total possible kinds (capped)
  const decorationDiversity = clamp(kindSet.size / 8, 0, 1);

  // Background complexity
  const backgroundComplexity = scoreBgComplexity(theme.background);

  // Palette utilization: count distinct colors used in decorations
  const decoColors = new Set<string>();
  for (const d of decos) {
    if ("color" in d && typeof (d as any).color === "string") {
      decoColors.add(normalizeColor((d as any).color));
    }
  }
  const paletteUtilization = clamp(decoColors.size / 5, 0, 1);

  // Premium elements: proportion of decorations that are "premium" kinds
  const premiumCount = decos.filter(d => PREMIUM_KINDS.has(d.kind)).length;
  const premiumElements = clamp(premiumCount / 3, 0, 1);

  // Visual layering: presence of depth-creating elements
  const layerCount = decos.filter(d => LAYERING_KINDS.has(d.kind)).length;
  const visualLayering = clamp(layerCount / 3, 0, 1);

  // Content completeness is not applicable at theme level — set to neutral
  const contentCompleteness = 0.7;

  const total =
    decorationRichness   * 0.18 +
    decorationDiversity  * 0.20 +
    backgroundComplexity * 0.12 +
    paletteUtilization   * 0.10 +
    premiumElements      * 0.15 +
    contentCompleteness  * 0.10 +
    visualLayering       * 0.15;

  return {
    decorationRichness,
    decorationDiversity,
    backgroundComplexity,
    paletteUtilization,
    premiumElements,
    contentCompleteness,
    visualLayering,
    total,
  };
}

// ── Full candidate scoring (theme + content) ──────────────────────────────────

export function scoreCandidateQuality(
  theme: DesignTheme,
  content: SvgContent,
): CandidateQualityScore {
  const themeScore = scoreThemeQuality(theme);

  // Override content completeness with actual content data
  const textZones = content.textContents ?? [];
  const populatedZones = textZones.filter(z => z.text?.trim().length > 0);
  const hasHeadline = populatedZones.some(z => z.zoneId === "headline" || z.zoneId === "name");
  const hasCta = populatedZones.some(z => z.zoneId === "cta");
  const hasSubhead = populatedZones.some(z => z.zoneId === "subhead" || z.zoneId === "tagline");
  const hasBadge = populatedZones.some(z => z.zoneId === "badge" || z.zoneId === "eyebrow");

  let contentCompleteness = 0.3; // base
  if (hasHeadline) contentCompleteness += 0.3;
  if (hasCta)      contentCompleteness += 0.15;
  if (hasSubhead)  contentCompleteness += 0.15;
  if (hasBadge)    contentCompleteness += 0.1;
  contentCompleteness = clamp(contentCompleteness, 0, 1);

  const total =
    themeScore.decorationRichness   * 0.18 +
    themeScore.decorationDiversity  * 0.20 +
    themeScore.backgroundComplexity * 0.10 +
    themeScore.paletteUtilization   * 0.08 +
    themeScore.premiumElements      * 0.14 +
    contentCompleteness             * 0.15 +
    themeScore.visualLayering       * 0.15;

  return {
    ...themeScore,
    contentCompleteness,
    total,
  };
}

// ── Bland detection ───────────────────────────────────────────────────────────

/** Quality floor — candidates below this score are considered "bland" */
const BLAND_THRESHOLD = 0.38;

/** Gradient-heavy detection — penalizes templates that are just a gradient + text */
const GRADIENT_ONLY_THRESHOLD = 0.30;

export function isBlandCandidate(theme: DesignTheme): boolean {
  const score = scoreThemeQuality(theme);

  // Hard reject: below quality floor
  if (score.total < BLAND_THRESHOLD) return true;

  // Gradient-heavy with minimal decorations
  if (
    theme.background.kind === "linear_gradient" &&
    theme.decorations.length <= 4 &&
    score.premiumElements === 0
  ) {
    return true;
  }

  // Zero diversity: all decorations are the same kind
  const kinds = new Set(theme.decorations.map(d => d.kind));
  if (kinds.size <= 1 && theme.decorations.length > 0) return true;

  return false;
}

// ── Similarity detection ──────────────────────────────────────────────────────

/** Returns a fingerprint string for a theme candidate to detect near-duplicates */
export function themeFingerprint(theme: DesignTheme): string {
  const bgKind = theme.background.kind;
  const bgColors = "colors" in theme.background
    ? (theme.background as any).colors.slice(0, 2).join(",")
    : ("color" in theme.background ? (theme.background as any).color : "");
  const decoKinds = [...new Set(theme.decorations.map(d => d.kind))].sort().join(",");
  return `${theme.id}|${bgKind}|${bgColors}|${decoKinds}`;
}

/** Checks if two themes are too visually similar */
export function areTooSimilar(a: DesignTheme, b: DesignTheme): boolean {
  // Same theme ID is always too similar
  if (a.id === b.id) return true;

  // Same background kind + similar colors = too similar
  if (a.background.kind === b.background.kind) {
    const aColors = extractBgColors(a.background);
    const bColors = extractBgColors(b.background);
    const overlap = aColors.filter(c => bColors.includes(c)).length;
    if (overlap >= 2) return true;
  }

  // Same primary palette color
  if (normalizeColor(a.palette.primary) === normalizeColor(b.palette.primary)) return true;

  return false;
}

// ── Multi-candidate selection ─────────────────────────────────────────────────

export interface RankedThemeCandidate {
  theme: DesignTheme;
  quality: CandidateQualityScore;
  rejected: boolean;
  rejectReason?: string;
}

/**
 * Evaluate and rank multiple theme candidates.
 * Rejects bland candidates and deduplicates near-similar ones.
 * Returns sorted best-to-worst with rejection annotations.
 */
export function rankThemeCandidates(themes: DesignTheme[]): RankedThemeCandidate[] {
  const candidates: RankedThemeCandidate[] = themes.map(theme => {
    const quality = scoreThemeQuality(theme);
    const bland = isBlandCandidate(theme);
    return {
      theme,
      quality,
      rejected: bland,
      rejectReason: bland ? "below_quality_floor" : undefined,
    };
  });

  // Deduplicate: mark later candidates as rejected if too similar to an earlier accepted one
  const accepted: DesignTheme[] = [];
  for (const c of candidates) {
    if (c.rejected) continue;
    if (accepted.some(a => areTooSimilar(a, c.theme))) {
      c.rejected = true;
      c.rejectReason = "too_similar";
    } else {
      accepted.push(c.theme);
    }
  }

  // Sort: non-rejected first, then by quality score descending
  return candidates.sort((a, b) => {
    if (a.rejected !== b.rejected) return a.rejected ? 1 : -1;
    return b.quality.total - a.quality.total;
  });
}

/**
 * Pick the best theme from multiple candidates.
 * If all are rejected, returns the least-bad one (never returns null).
 */
export function pickBestTheme(themes: DesignTheme[]): DesignTheme {
  const ranked = rankThemeCandidates(themes);
  // Return best non-rejected, or the least-bad rejected one
  return ranked[0].theme;
}

// ── Recent output tracking for cross-request uniqueness ───────────────────────

const _recentOutputFingerprints: string[] = [];
const RECENT_OUTPUT_HISTORY = 12;

/** Record a generated output fingerprint for cross-request dedup */
export function recordOutputFingerprint(theme: DesignTheme): void {
  const fp = themeFingerprint(theme);
  _recentOutputFingerprints.unshift(fp);
  if (_recentOutputFingerprints.length > RECENT_OUTPUT_HISTORY) {
    _recentOutputFingerprints.pop();
  }
}

/** Check if a theme is too similar to recent outputs */
export function isRecentDuplicate(theme: DesignTheme): boolean {
  const fp = themeFingerprint(theme);
  return _recentOutputFingerprints.includes(fp);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function normalizeColor(c: string): string {
  return c.toLowerCase().replace(/\s/g, "");
}

function extractBgColors(bg: BgTreatment): string[] {
  if ("colors" in bg) return (bg as any).colors.map(normalizeColor);
  if ("color" in bg)  return [normalizeColor((bg as any).color)];
  return [];
}
