// src/engines/evaluation/candidate-quality.ts
//
// Marketplace-grade quality scoring and rejection system.
// Evaluates visual richness, decoration diversity, palette variety,
// content completeness, and uniqueness to reject bland outputs and
// rank candidates by marketplace-quality appearance.

import type { DesignTheme, DecorShape, BgTreatment } from "../render/design-themes";
import type { SvgContent } from "../render/svg-builder-ultimate";

export { themeFingerprint, recordOutputFingerprint, isRecentDuplicate } from "../memory/output-history";

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

// Basic geometric shapes — overreliance on these = flat placeholder feel
const BASIC_KINDS = new Set<string>([
  "circle", "rect", "line", "blob",
]);

// ── Background complexity ranking ─────────────────────────────────────────────

function scoreBgComplexity(bg: BgTreatment): number {
  switch (bg.kind) {
    case "mesh":            return 1.0;
    case "split":           return 0.75;
    case "radial_gradient": return 0.6;
    case "linear_gradient": return bg.colors.length >= 3 ? 0.45 : 0.3;
    case "solid":           return 0.15;
    default:                return 0.1;
  }
}

// ── Theme quality scoring ─────────────────────────────────────────────────────

export function scoreThemeQuality(theme: DesignTheme): CandidateQualityScore {
  const decos = theme.decorations;
  const kindSet = new Set(decos.map(d => d.kind));

  const decoCount = decos.length;
  const decorationRichness = clamp(decoCount / 12, 0, 1);

  const decorationDiversity = clamp(kindSet.size / 9, 0, 1);

  const backgroundComplexity = scoreBgComplexity(theme.background);

  const decoColors = new Set<string>();
  for (const d of decos) {
    if ("color" in d && typeof (d as any).color === "string") {
      decoColors.add(normalizeColor((d as any).color));
    }
  }
  const paletteUtilization = clamp(decoColors.size / 5, 0, 1);

  const premiumCount = decos.filter(d => PREMIUM_KINDS.has(d.kind)).length;
  const premiumElements = clamp(premiumCount / 4, 0, 1);

  const layerCount = decos.filter(d => LAYERING_KINDS.has(d.kind)).length;
  const visualLayering = clamp(layerCount / 3, 0, 1);

  const contentCompleteness = 0.7;

  const total =
    decorationRichness   * 0.16 +
    decorationDiversity  * 0.18 +
    backgroundComplexity * 0.10 +
    paletteUtilization   * 0.08 +
    premiumElements      * 0.16 +
    contentCompleteness  * 0.10 +
    visualLayering       * 0.22;

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

  const textZones = content.textContents ?? [];
  const populatedZones = textZones.filter(z => z.text?.trim().length > 0);
  const hasHeadline = populatedZones.some(z => z.zoneId === "headline" || z.zoneId === "name");
  const hasCta = populatedZones.some(z => z.zoneId === "cta");
  const hasSubhead = populatedZones.some(z => z.zoneId === "subhead" || z.zoneId === "tagline");
  const hasBadge = populatedZones.some(z => z.zoneId === "badge" || z.zoneId === "eyebrow");
  const hasBody = populatedZones.some(z => z.zoneId === "body" || z.zoneId === "body_text");

  let contentCompleteness = 0.2;
  if (hasHeadline) contentCompleteness += 0.30;
  if (hasCta)      contentCompleteness += 0.15;
  if (hasSubhead)  contentCompleteness += 0.15;
  if (hasBadge)    contentCompleteness += 0.10;
  if (hasBody)     contentCompleteness += 0.10;
  contentCompleteness = clamp(contentCompleteness, 0, 1);

  const total =
    themeScore.decorationRichness   * 0.14 +
    themeScore.decorationDiversity  * 0.16 +
    themeScore.backgroundComplexity * 0.08 +
    themeScore.paletteUtilization   * 0.06 +
    themeScore.premiumElements      * 0.16 +
    contentCompleteness             * 0.18 +
    themeScore.visualLayering       * 0.22;

  return {
    ...themeScore,
    contentCompleteness,
    total,
  };
}

// ── Bland detection ───────────────────────────────────────────────────────────

/** Quality floor — marketplace standard */
const BLAND_THRESHOLD = 0.48;

export function isBlandCandidate(theme: DesignTheme): boolean {
  const score = scoreThemeQuality(theme);

  // Hard reject: below quality floor
  if (score.total < BLAND_THRESHOLD) return true;

  const decos = theme.decorations;
  const kinds = new Set(decos.map(d => d.kind));
  const allBasic = [...kinds].every(k => BASIC_KINDS.has(k));

  // Gradient + few or all-basic decorations = placeholder card
  if (
    (theme.background.kind === "linear_gradient" || theme.background.kind === "solid") &&
    (decos.length <= 6 || allBasic) &&
    score.premiumElements === 0
  ) {
    return true;
  }

  // Gradient-heavy: linear gradient with thin decoration layer
  if (
    theme.background.kind === "linear_gradient" &&
    kinds.size <= 4 &&
    score.premiumElements === 0 &&
    score.visualLayering < 0.34
  ) {
    return true;
  }

  // Low diversity: too few unique kinds for the decoration count
  if (kinds.size <= 1 && decos.length > 0) return true;
  if (kinds.size <= 2 && decos.length >= 4) return true;
  if (kinds.size <= 3 && decos.length >= 8) return true;

  // No visual layering at all with simple background
  if (score.visualLayering === 0 && score.backgroundComplexity < 0.5) return true;

  // Repetitive: >50% of decorations are the same kind
  if (decos.length >= 4) {
    const kindCounts = new Map<string, number>();
    for (const d of decos) kindCounts.set(d.kind, (kindCounts.get(d.kind) ?? 0) + 1);
    const maxCount = Math.max(...kindCounts.values());
    if (maxCount / decos.length > 0.5) return true;
  }

  // No premium elements at all — flat card feel
  if (score.premiumElements === 0 && score.visualLayering < 0.34) return true;

  return false;
}

// ── Similarity detection ──────────────────────────────────────────────────────

/** Checks if two themes are too visually similar */
export function areTooSimilar(a: DesignTheme, b: DesignTheme): boolean {
  if (a.id === b.id) return true;

  // Same background kind + any color overlap
  if (a.background.kind === b.background.kind) {
    const aColors = extractBgColors(a.background);
    const bColors = extractBgColors(b.background);
    const overlap = aColors.filter(c => bColors.includes(c)).length;
    if (overlap >= 1) return true;
  }

  // Same primary palette color
  if (normalizeColor(a.palette.primary) === normalizeColor(b.palette.primary)) return true;

  // Same background color (surface)
  if (normalizeColor(a.palette.background) === normalizeColor(b.palette.background)) return true;

  // Decoration profile overlap > 65%
  const aKinds = new Set(a.decorations.map(d => d.kind));
  const bKinds = new Set(b.decorations.map(d => d.kind));
  const kindOverlap = [...aKinds].filter(k => bKinds.has(k)).length;
  const kindTotal = new Set([...aKinds, ...bKinds]).size;
  if (kindTotal > 0 && kindOverlap / kindTotal > 0.65) return true;

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

  // Sort: non-rejected first, then by marketplace-quality composite
  return candidates.sort((a, b) => {
    if (a.rejected !== b.rejected) return a.rejected ? 1 : -1;
    // Bias toward visual layering + premium elements (marketplace look)
    const aMarketplace = a.quality.visualLayering * 0.4 + a.quality.premiumElements * 0.3 + a.quality.total * 0.3;
    const bMarketplace = b.quality.visualLayering * 0.4 + b.quality.premiumElements * 0.3 + b.quality.total * 0.3;
    return bMarketplace - aMarketplace;
  });
}

/**
 * Pick the best theme from multiple candidates.
 * If all are rejected, returns the least-bad one (never returns null).
 */
export function pickBestTheme(themes: DesignTheme[]): DesignTheme {
  const ranked = rankThemeCandidates(themes);
  return ranked[0].theme;
}

/**
 * Check if a fully-built template passes marketplace-quality bar.
 * Returns rejection reason string, or null if it passes.
 */
export function checkMarketplaceQuality(
  theme: DesignTheme,
  content: SvgContent,
): string | null {
  const score = scoreCandidateQuality(theme, content);

  if (score.total < 0.40)
    return `marketplace:low_score(${score.total.toFixed(2)})`;

  if (score.contentCompleteness < 0.50)
    return `marketplace:sparse_content(${score.contentCompleteness.toFixed(2)})`;

  if (score.visualLayering < 0.20 && score.premiumElements < 0.25)
    return `marketplace:flat_composition`;

  if (score.decorationDiversity < 0.30)
    return `marketplace:low_decoration_diversity(${score.decorationDiversity.toFixed(2)})`;

  return null;
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
