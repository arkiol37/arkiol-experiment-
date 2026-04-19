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
// Step 22 expands the scoring vocabulary. Bland outputs previously scored
// acceptably because the system weighed surface traits (decoration count,
// palette use) heavily while ignoring hierarchy, readability, composition
// craft, and intentional asset usage. The new dimensions (hierarchyClarity,
// readability, compositionBalance, assetUsage) close those gaps and the
// weights below are retuned so a template can't pass the bar on count
// alone — it has to read as a *designed* composition.

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
  /** Typographic hierarchy clarity — distinct zone sizing + headline dominance (0-1) */
  hierarchyClarity: number;
  /** Readability — overlay / contrast / CTA legibility / text-zone load (0-1) */
  readability: number;
  /** Composition balance — decoration distribution across quadrants (0-1) */
  compositionBalance: number;
  /** Asset usage — share and variety of library-style premium decorations (0-1) */
  assetUsage: number;
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

  const hierarchyClarity   = scoreHierarchyClarity(theme);
  const readability        = scoreReadabilityFromTheme(theme);
  const compositionBalance = scoreCompositionBalance(theme);
  const assetUsage         = scoreAssetUsage(theme);

  // Theme-level total uses a placeholder contentCompleteness. The richer
  // score is computed in scoreCandidateQuality when SvgContent is available.
  const contentCompleteness = 0.7;

  const total = combineQualityScore({
    decorationRichness,
    decorationDiversity,
    backgroundComplexity,
    paletteUtilization,
    premiumElements,
    contentCompleteness,
    visualLayering,
    hierarchyClarity,
    readability,
    compositionBalance,
    assetUsage,
  });

  return {
    decorationRichness,
    decorationDiversity,
    backgroundComplexity,
    paletteUtilization,
    premiumElements,
    contentCompleteness,
    visualLayering,
    hierarchyClarity,
    readability,
    compositionBalance,
    assetUsage,
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

  // Step 22: readability is re-derived when content is present so we can
  // penalize templates that cram many text zones or run text through a
  // bare background without a legibility treatment.
  const readability = refineReadabilityWithContent(
    themeScore.readability,
    populatedZones.length,
  );

  const score: Omit<CandidateQualityScore, "total"> = {
    decorationRichness:   themeScore.decorationRichness,
    decorationDiversity:  themeScore.decorationDiversity,
    backgroundComplexity: themeScore.backgroundComplexity,
    paletteUtilization:   themeScore.paletteUtilization,
    premiumElements:      themeScore.premiumElements,
    contentCompleteness,
    visualLayering:       themeScore.visualLayering,
    hierarchyClarity:     themeScore.hierarchyClarity,
    readability,
    compositionBalance:   themeScore.compositionBalance,
    assetUsage:           themeScore.assetUsage,
  };

  return { ...score, total: combineQualityScore(score) };
}

// ── Weights ──────────────────────────────────────────────────────────────────
// Step 22: retuned so bland outputs can't ride surface traits alone. The
// new dimensions (hierarchy, readability, balance, asset usage) together
// account for 28% of the score — enough that a theme weak on any of them
// can't easily hit the quality floor by piling on generic decorations.
// Weights sum to 1.00.

export const QUALITY_WEIGHTS = {
  decorationRichness:   0.08,
  decorationDiversity:  0.12,
  backgroundComplexity: 0.07,
  paletteUtilization:   0.06,
  premiumElements:      0.12,
  contentCompleteness:  0.13,
  visualLayering:       0.14,
  hierarchyClarity:     0.08,
  readability:          0.08,
  compositionBalance:   0.06,
  assetUsage:           0.06,
} as const;

function combineQualityScore(s: Omit<CandidateQualityScore, "total">): number {
  const w = QUALITY_WEIGHTS;
  return (
    s.decorationRichness   * w.decorationRichness   +
    s.decorationDiversity  * w.decorationDiversity  +
    s.backgroundComplexity * w.backgroundComplexity +
    s.paletteUtilization   * w.paletteUtilization   +
    s.premiumElements      * w.premiumElements      +
    s.contentCompleteness  * w.contentCompleteness  +
    s.visualLayering       * w.visualLayering       +
    s.hierarchyClarity     * w.hierarchyClarity     +
    s.readability          * w.readability          +
    s.compositionBalance   * w.compositionBalance   +
    s.assetUsage           * w.assetUsage
  );
}

// ── New scoring dimensions ───────────────────────────────────────────────────

// Hierarchy clarity: rewards templates whose typography spells out a real
// reading order — distinct zone sizes, a dominant headline, and an intent-
// ional size multiplier. Flat sizing = low score.
function scoreHierarchyClarity(theme: DesignTheme): number {
  const typo: any = theme.typography;
  const mults: number[] = [
    typo?.headline?.fontSizeMultiplier,
    typo?.subhead?.fontSizeMultiplier,
    typo?.body_text?.fontSizeMultiplier,
    typo?.cta?.fontSizeMultiplier,
    typo?.badge?.fontSizeMultiplier,
    typo?.eyebrow?.fontSizeMultiplier,
  ].filter((n): n is number => typeof n === "number" && n > 0);

  const weights: number[] = [
    typo?.headline?.fontWeight,
    typo?.subhead?.fontWeight,
    typo?.body_text?.fontWeight,
    typo?.cta?.fontWeight,
    typo?.badge?.fontWeight,
    typo?.eyebrow?.fontWeight,
  ].filter((n): n is number => typeof n === "number" && n > 0);

  // Size distinctness: unique sizes / total configured sizes.
  let sizeDistinctScore = 0.4;
  if (mults.length >= 3) {
    const distinct = new Set(mults.map(m => Math.round(m * 100) / 100)).size;
    sizeDistinctScore = clamp(distinct / mults.length, 0.2, 1);
  }

  // Weight distinctness: same idea for weights.
  let weightDistinctScore = 0.4;
  if (weights.length >= 3) {
    const distinct = new Set(weights).size;
    weightDistinctScore = clamp(distinct / weights.length, 0.2, 1);
  }

  // Headline dominance: ratio of headline multiplier to avg of others.
  let dominanceScore = 0.4;
  const headlineMult = typo?.headline?.fontSizeMultiplier;
  const othersMult = mults.filter(m => m !== headlineMult);
  if (typeof headlineMult === "number" && othersMult.length > 0) {
    const avgOthers = othersMult.reduce((a, b) => a + b, 0) / othersMult.length;
    const ratio = headlineMult / Math.max(0.5, avgOthers);
    dominanceScore = clamp((ratio - 1) / 0.8, 0, 1);
  }

  // Intentional multiplier bonus.
  const mult = theme.headlineSizeMultiplier ?? 1;
  const multBonus = clamp((mult - 1) / 0.5, 0, 1);

  return clamp(
    sizeDistinctScore   * 0.30 +
    weightDistinctScore * 0.25 +
    dominanceScore      * 0.30 +
    multBonus           * 0.15,
    0, 1,
  );
}

// Theme-side readability: pre-content signals — overlay presence, text/bg
// contrast, CTA legibility, and textMuted differentiation. Content-side
// signals (zone crowding) fold in via refineReadabilityWithContent().
function scoreReadabilityFromTheme(theme: DesignTheme): number {
  let score = 0.25;

  // Overlay for busy backgrounds.
  if (typeof theme.overlayOpacity === "number" && theme.overlayOpacity > 0.05) {
    score += 0.15;
  }

  // CTA bg/text not the same color.
  if (theme.ctaStyle.backgroundColor.toLowerCase() !== theme.ctaStyle.textColor.toLowerCase()) {
    score += 0.12;
  }

  // Text color differs from every background color.
  const bgCols = extractBgColors(theme.background);
  const textCol = normalizeColor(theme.palette.text);
  if (!bgCols.includes(textCol)) score += 0.18;

  // textMuted differentiated from text.
  if (normalizeColor(theme.palette.textMuted) !== textCol) score += 0.10;

  // Primary !== background (brand color visible against surface).
  if (normalizeColor(theme.palette.primary) !== normalizeColor(theme.palette.background)) {
    score += 0.10;
  }

  return clamp(score, 0, 1);
}

// Fold content-side signals into readability: crowding and zone counts.
function refineReadabilityWithContent(themeSide: number, populatedZoneCount: number): number {
  // 1-5 zones read comfortably; 6-7 is borderline; 8+ is crowded.
  let load = 0;
  if      (populatedZoneCount === 0) load = -0.10;
  else if (populatedZoneCount <= 5)  load =  0.10;
  else if (populatedZoneCount <= 7)  load =  0.00;
  else                               load = -0.12;
  return clamp(themeSide + load, 0, 1);
}

// Composition balance: decorations should distribute across quadrants
// rather than pile up in a corner. All-bleed decorations (no x/y) are
// ignored — they don't cluster.
function scoreCompositionBalance(theme: DesignTheme): number {
  const decos = theme.decorations;
  if (decos.length === 0) return 0.3;

  const quadrants: number[] = [0, 0, 0, 0];
  let placed = 0;
  for (const d of decos) {
    const x = readAnchorCoord(d, "x");
    const y = readAnchorCoord(d, "y");
    if (x === null || y === null) continue;
    const qi = (y >= 50 ? 2 : 0) + (x >= 50 ? 1 : 0);
    quadrants[qi]++;
    placed++;
  }
  if (placed === 0) return 0.55;  // all full-bleed — neutral

  const populated = quadrants.filter(q => q > 0).length;
  const spread    = populated / 4;               // 0.25 .. 1.0

  const maxShare = Math.max(...quadrants) / placed;
  // Gentle penalty when one quadrant holds >60% of placed decorations.
  const concentrationPenalty = maxShare > 0.6 ? (maxShare - 0.6) * 1.6 : 0;

  return clamp(spread - concentrationPenalty, 0, 1);
}

// Extract an anchor coordinate from a decoration if the shape has one.
// Several decoration kinds use `x1/y1` or no position (bleed layers).
function readAnchorCoord(d: any, axis: "x" | "y"): number | null {
  if (typeof d?.[axis]  === "number") return d[axis];
  if (typeof d?.[axis + "1"] === "number") return d[axis + "1"];
  return null;
}

// Asset usage: rewards library-style premium decorations (ribbons, badges,
// icons, frames, dividers) both in absolute count and in variety. A
// template filled with generic circles/rects scores low here even if
// richness and diversity look fine.
function scoreAssetUsage(theme: DesignTheme): number {
  const decos = theme.decorations;
  if (decos.length === 0) return 0;

  const libraryKinds = new Set<string>([
    "ribbon", "sticker_circle", "icon_symbol", "checklist", "frame_border",
    "section_divider", "texture_fill", "photo_circle", "starburst",
    "price_tag", "banner_strip", "badge_pill", "card_panel", "deco_ring",
    "accent_bar", "corner_bracket",
  ]);

  const libraryDecos = decos.filter(d => libraryKinds.has(d.kind));
  const libraryKindSet = new Set(libraryDecos.map(d => d.kind));

  const shareScore     = clamp(libraryDecos.length / Math.max(3, decos.length), 0, 1);
  const varietyScore   = clamp(libraryKindSet.size / 5, 0, 1);
  const absoluteScore  = clamp(libraryDecos.length / 4, 0, 1);

  return clamp(
    shareScore    * 0.35 +
    varietyScore  * 0.40 +
    absoluteScore * 0.25,
    0, 1,
  );
}

// ── Bland detection ───────────────────────────────────────────────────────────
// Step 22: raise the floor and add dimension-specific rejection paths so
// templates that score well on surface traits but fail the new dimensions
// (hierarchy, readability, balance, asset usage) are still caught.

/** Quality floor — marketplace standard. Raised to 0.52 so templates must
 *  clear the bar with meaningful scores across multiple dimensions. */
const BLAND_THRESHOLD = 0.52;

/** Per-dimension floors — a theme that collapses on any of these reads as
 *  bland even if the weighted total scrapes by. */
const DIMENSION_FLOORS = {
  hierarchyClarity:   0.30,
  readability:        0.35,
  compositionBalance: 0.25,
  assetUsage:         0.20,
} as const;

export function isBlandCandidate(theme: DesignTheme): boolean {
  const score = scoreThemeQuality(theme);

  // Hard reject: below composite quality floor.
  if (score.total < BLAND_THRESHOLD) return true;

  // Hard reject on any single dimension collapsing below its floor.
  if (score.hierarchyClarity   < DIMENSION_FLOORS.hierarchyClarity)   return true;
  if (score.readability        < DIMENSION_FLOORS.readability)        return true;
  if (score.compositionBalance < DIMENSION_FLOORS.compositionBalance) return true;
  if (score.assetUsage         < DIMENSION_FLOORS.assetUsage)         return true;

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
    // Step 22: ranking now reflects the full quality vocabulary. Templates
    // that read as designed (strong hierarchy + readable + balanced + real
    // asset usage) outrank templates that simply pile on decorations. Mix:
    //   composite total           0.30  (baseline)
    //   hierarchy + readability   0.20  (clarity & legibility)
    //   composition + asset usage 0.20  (craft + intentional asset)
    //   layering + premium        0.20  (visual richness)
    //   diversity                 0.10  (variation)
    const rank = (q: CandidateQualityScore) =>
      q.total                * 0.30 +
      q.hierarchyClarity     * 0.12 +
      q.readability          * 0.08 +
      q.compositionBalance   * 0.10 +
      q.assetUsage           * 0.10 +
      q.visualLayering       * 0.12 +
      q.premiumElements      * 0.08 +
      q.decorationDiversity  * 0.10;
    return rank(b.quality) - rank(a.quality);
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

  // Step 22: raise the marketplace composite bar and add dimension-
  // specific rejects that align with the richer scoring vocabulary.
  // Step 23: additional hard rules live in rejection-rules.ts and are
  // consulted by the gallery batch filter — this single-string gate
  // stays as the per-template quick check for the build pipeline.

  if (score.total < 0.46)
    return `marketplace:low_score(${score.total.toFixed(2)})`;

  if (score.contentCompleteness < 0.50)
    return `marketplace:sparse_content(${score.contentCompleteness.toFixed(2)})`;

  if (score.visualLayering < 0.20 && score.premiumElements < 0.25)
    return `marketplace:flat_composition`;

  if (score.decorationDiversity < 0.30)
    return `marketplace:low_decoration_diversity(${score.decorationDiversity.toFixed(2)})`;

  if (score.hierarchyClarity < 0.30)
    return `marketplace:weak_hierarchy(${score.hierarchyClarity.toFixed(2)})`;

  if (score.readability < 0.40)
    return `marketplace:poor_readability(${score.readability.toFixed(2)})`;

  if (score.compositionBalance < 0.25)
    return `marketplace:unbalanced_composition(${score.compositionBalance.toFixed(2)})`;

  if (score.assetUsage < 0.20)
    return `marketplace:low_asset_usage(${score.assetUsage.toFixed(2)})`;

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
