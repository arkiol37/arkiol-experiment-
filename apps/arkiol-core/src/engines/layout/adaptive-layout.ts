// src/engines/layout/adaptive-layout.ts
//
// Constraint-based adaptive layout engine.
// Takes the Authority's resolved zones + brief content signals and adjusts
// zone geometry to better fit the content. Runs between Stage 1 (resolveLayoutSpec)
// and Stage 2 (analyzeDensity) in the render pipeline.
//
// Goals:
//  - Zones adapt to content size (long headlines get more space)
//  - Grid-based snapping keeps alignment disciplined
//  - Minimum gaps between zones prevent crowding
//  - Platform safe zones are enforced
//  - Absent content zones collapse to reclaim space for neighbors

import type { Zone, ZoneId } from "./families";
import type { BriefAnalysis }  from "../ai/brief-analyzer";
import type { DensityProfile, FormatCategory } from "./authority";
import {
  getCategoryLayoutProfile,
  applyCategoryZoneOverrides,
  applyCategoryAlignment,
  applyHeadlineProportion,
  type CategoryLayoutProfile,
} from "../style/category-layout-profiles";
import { snapZonesToGrid } from "./artboard-grid";

// ── Configuration ─────────────────────────────────────────────────────────────

/** Baseline grid unit in % of canvas height */
const GRID_UNIT = 2;

/** Minimum vertical gap between stacked text zones (% of canvas height) */
const MIN_VERTICAL_GAP = 2.5;

/** Platform-specific safe zone insets (% of canvas dimension) */
const SAFE_ZONES: Record<FormatCategory | "default", { top: number; right: number; bottom: number; left: number }> = {
  instagram:  { top: 3, right: 4, bottom: 4, left: 4 },
  story:      { top: 12, right: 5, bottom: 16, left: 5 }, // IG Story has UI chrome top+bottom
  thumbnail:  { top: 2, right: 3, bottom: 10, left: 3 },   // YT has bottom bar overlay
  flyer:      { top: 5, right: 5, bottom: 5, left: 5 },
  poster:     { top: 5, right: 5, bottom: 5, left: 5 },
  slide:      { top: 3, right: 4, bottom: 4, left: 4 },
  card:       { top: 6, right: 6, bottom: 6, left: 6 },
  document:   { top: 5, right: 5, bottom: 5, left: 5 },
  logo:       { top: 10, right: 10, bottom: 10, left: 10 },
  unknown:    { top: 4, right: 4, bottom: 4, left: 4 },
  default:    { top: 4, right: 4, bottom: 4, left: 4 },
};

// Zone types that hold text content (eligible for adaptive sizing)
const TEXT_ZONES: Set<ZoneId> = new Set([
  "headline", "subhead", "body", "cta", "badge", "tagline", "legal", "price",
  "name", "title", "company", "contact", "section_header",
  "bullet_1", "bullet_2", "bullet_3",
]);

// Zone vertical order priority — determines stacking when reflowing
const ZONE_VERTICAL_ORDER: ZoneId[] = [
  "badge", "section_header",
  "headline", "name",
  "subhead", "tagline", "title",
  "body", "company", "contact",
  "bullet_1", "bullet_2", "bullet_3",
  "price", "legal",
  "cta",
];

// ── Layout intent classification ─────────────────────────────────────────────

export type LayoutIntent = "bold_focal" | "structured_detail" | "cta_driven" | "balanced";

// ── Content signals extraction ────────────────────────────────────────────────

interface ContentMetrics {
  headlineChars: number;
  subheadChars: number;
  bodyChars: number;
  ctaChars: number;
  hasHeadline: boolean;
  hasSubhead: boolean;
  hasBody: boolean;
  hasCta: boolean;
  hasBadge: boolean;
  hasName: boolean;
  hasTitle: boolean;
  totalTextZones: number;
  contentDensity: "light" | "medium" | "heavy";
  urgency: number;
  keywords: string[];
  hierarchyBias: "headline" | "balanced" | "detail" | "cta";
  layoutIntent: LayoutIntent;
}

function extractContentMetrics(brief: BriefAnalysis): ContentMetrics {
  const headlineChars = (brief.headline ?? "").length;
  const subheadChars  = (brief.subhead ?? "").length;
  const bodyChars     = (brief.body ?? "").length;
  const ctaChars      = (brief.cta ?? "").length;

  const hasHeadline = headlineChars > 0;
  const hasSubhead  = subheadChars > 0;
  const hasBody     = bodyChars > 0;
  const hasCta      = ctaChars > 0;
  const hasBadge    = !!(brief.badge);
  const hasName     = !!(brief.name);
  const hasTitle    = !!(brief.title);

  const filledZones = [hasHeadline, hasSubhead, hasBody, hasCta, hasBadge, hasName, hasTitle]
    .filter(Boolean).length;

  const totalChars = headlineChars + subheadChars + bodyChars + ctaChars;
  const contentDensity = totalChars > 300 ? "heavy" : totalChars > 100 ? "medium" : "light";

  const urgency = brief.tone === "urgent" ? 1 : brief.tone === "energetic" ? 0.72 : hasCta ? 0.46 : 0.2;
  const keywords = (brief.keywords ?? []).filter((k: string) => k.length > 3).slice(0, 4);

  let hierarchyBias: ContentMetrics["hierarchyBias"] = "balanced";
  if (hasHeadline && headlineChars <= 28 && keywords.length >= 2) hierarchyBias = "headline";
  else if (bodyChars > 240 || subheadChars > 110) hierarchyBias = "detail";
  else if (hasCta && (ctaChars <= 16 || urgency > 0.7)) hierarchyBias = "cta";

  let layoutIntent: LayoutIntent = "balanced";
  if (hasHeadline && headlineChars <= 20 && bodyChars < 80 && filledZones <= 3) {
    layoutIntent = "bold_focal";
  } else if (bodyChars > 300 || (filledZones >= 5 && contentDensity === "heavy")) {
    layoutIntent = "structured_detail";
  } else if (hasCta && urgency > 0.6 && headlineChars <= 35) {
    layoutIntent = "cta_driven";
  }

  return {
    headlineChars, subheadChars, bodyChars, ctaChars,
    hasHeadline, hasSubhead, hasBody, hasCta, hasBadge, hasName, hasTitle,
    totalTextZones: filledZones,
    contentDensity,
    urgency, keywords, hierarchyBias, layoutIntent,
  };
}

// ── Grid snapping ─────────────────────────────────────────────────────────────

function snapToGrid(value: number): number {
  return Math.round(value / GRID_UNIT) * GRID_UNIT;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// ── Main adaptive layout function ─────────────────────────────────────────────

export interface AdaptiveLayoutOptions {
  zones: Zone[];
  brief: BriefAnalysis;
  formatCategory: FormatCategory;
  density: DensityProfile;
  activeZoneIds: ZoneId[];
  /** Detected content category — drives section structure and visual rhythm */
  categoryId?: string;
}

export interface AdaptiveLayoutResult {
  zones: Zone[];
  adjustments: string[];
}

/**
 * Adjust zone geometry based on content signals.
 * Non-destructive: returns new zone array without mutating input.
 */
export function adaptLayout(options: AdaptiveLayoutOptions): AdaptiveLayoutResult {
  const { brief, formatCategory, density, activeZoneIds, categoryId } = options;
  const metrics = extractContentMetrics(brief);
  const profile = getCategoryLayoutProfile(categoryId);
  const safe = categoryAdjustedSafeZone(formatCategory, profile);
  const categoryDensity = categoryAdjustedDensity(density, profile);
  const adjustments: string[] = [];

  // Deep-copy zones so we don't mutate the Authority's output
  let zones: Zone[] = options.zones.map(z => ({
    ...z,
    constraints: z.constraints ? { ...z.constraints } : undefined,
  } as Zone));

  // ── Phase 1: Collapse absent content zones ──────────────────────────────
  zones = collapseAbsentZones(zones, brief, activeZoneIds, adjustments) as Zone[];

  // ── Phase 1.5: Content-driven layout intent ────────────────────────────
  zones = applyLayoutIntent(zones, metrics, adjustments) as Zone[];

  // ── Phase 2: Content-adaptive resizing ──────────────────────────────────
  zones = adaptZoneSizes(zones, metrics, density, adjustments) as Zone[];

  // ── Phase 2.5: Category section structure + rhythm ──────────────────────
  // Apply the category's structural signature (zone overrides, alignment,
  // headline proportion) before safe-zone/gap enforcement so the downstream
  // phases clean up anything that pushed out of bounds.
  if (profile) {
    const beforeSig = structuralSignature(zones);
    zones = applyCategoryZoneOverrides(zones, profile, formatCategory);
    zones = applyCategoryAlignment(zones, profile);
    zones = applyHeadlineProportion(zones, profile);
    if (structuralSignature(zones) !== beforeSig) {
      adjustments.push(
        `category_profile:${profile.categoryId} applied ${profile.approach} composition`,
      );
    }
  }

  // ── Phase 3: Safe zone enforcement ──────────────────────────────────────
  zones = enforceSafeZones(zones, safe, adjustments) as Zone[];

  // ── Phase 4: Minimum gap enforcement ────────────────────────────────────
  zones = enforceMinimumGaps(zones, categoryDensity, adjustments) as Zone[];

  // ── Phase 5: Grid snapping ──────────────────────────────────────────────
  // First, snap every zone to the artboard's column/baseline grid so edges
  // land on shared tracks. Then fall back to the baseline row snap so any
  // zones we didn't column-snap still stay on the rhythm.
  {
    const result = snapZonesToGrid(zones, formatCategory);
    zones = result.zones;
    if (result.moved > 0) {
      adjustments.push(
        `artboard_grid:${result.grid.columns}col snapped ${result.moved} zones ` +
        `(gutter ${result.grid.gutter}% row ${result.grid.rowUnit}%)`,
      );
    }
  }
  zones = snapAllToGrid(zones, adjustments) as Zone[];

  // ── Phase 6: Alignment normalization ────────────────────────────────────
  zones = normalizeAlignment(zones, adjustments) as Zone[];

  return { zones, adjustments };
}

// ── Category rhythm helpers ──────────────────────────────────────────────────

function categoryAdjustedSafeZone(
  formatCategory: FormatCategory,
  profile:        CategoryLayoutProfile | null,
): { top: number; right: number; bottom: number; left: number } {
  const base = SAFE_ZONES[formatCategory] ?? SAFE_ZONES.default;
  if (!profile) return base;
  const boost = profile.rhythm.paddingBoost;
  // Clamp so padding never eats more than 22% of a side
  return {
    top:    clamp(base.top    + boost, 0, 22),
    right:  clamp(base.right  + boost, 0, 22),
    bottom: clamp(base.bottom + boost, 0, 22),
    left:   clamp(base.left   + boost, 0, 22),
  };
}

function categoryAdjustedDensity(
  density: DensityProfile,
  profile: CategoryLayoutProfile | null,
): DensityProfile {
  if (!profile) return density;
  const boost = profile.rhythm.gapBoost;
  if (boost === 0) return density;
  return {
    ...density,
    minZonePadding: Math.max(0.5, density.minZonePadding + boost),
  };
}

function structuralSignature(zones: Zone[]): string {
  return zones
    .map(z => `${z.id}:${z.x.toFixed(1)},${z.y.toFixed(1)},${z.width.toFixed(1)},${z.height.toFixed(1)},${z.alignH}`)
    .join("|");
}

// ── Phase 1: Collapse absent content zones ────────────────────────────────────

function collapseAbsentZones(
  zones: Zone[],
  brief: BriefAnalysis,
  activeZoneIds: ZoneId[],
  adjustments: string[],
): Zone[] {
  const briefMap: Record<string, string | undefined> = {
    headline: brief.headline,
    subhead: brief.subhead,
    body: brief.body,
    cta: brief.cta,
    badge: brief.badge,
    tagline: brief.tagline,
    name: brief.name,
    title: brief.title,
    company: brief.company,
    contact: brief.contact,
    price: brief.priceText,
  };

  return zones.map(zone => {
    if (!TEXT_ZONES.has(zone.id)) return zone;
    if (zone.required) return zone;
    if (!activeZoneIds.includes(zone.id)) return zone;

    const content = briefMap[zone.id];
    if (content && content.trim().length > 0) return zone;

    // Collapse: shrink height to 0 so neighbors can reclaim space
    adjustments.push(`collapse:${zone.id} (no content)`);
    return { ...zone, height: 0, minFontSize: 0, maxFontSize: 0 };
  });
}

// ── Phase 1.5: Content-driven layout intent ──────────────────────────────────

function applyLayoutIntent(
  zones: Zone[],
  metrics: ContentMetrics,
  adjustments: string[],
): Zone[] {
  if (metrics.layoutIntent === "balanced") return zones;

  return zones.map(zone => {
    if (zone.height === 0) return zone;

    switch (metrics.layoutIntent) {
      case "bold_focal": {
        if (zone.id === "headline" || zone.id === "name") {
          const heightBoost = Math.min(16, zone.height * 0.6);
          const newMaxFont = zone.maxFontSize ? Math.round(zone.maxFontSize * 1.3) : zone.maxFontSize;
          adjustments.push(`intent:bold_focal ${zone.id} +${heightBoost.toFixed(0)}%h`);
          return { ...zone, height: zone.height + heightBoost, maxFontSize: newMaxFont, alignH: "center" as const };
        }
        if (zone.id === "subhead" || zone.id === "tagline") {
          const shrink = Math.min(4, zone.height * 0.25);
          adjustments.push(`intent:bold_focal ${zone.id} -${shrink.toFixed(1)}%h`);
          return { ...zone, height: Math.max(4, zone.height - shrink) };
        }
        return zone;
      }

      case "structured_detail": {
        if (zone.id === "headline" || zone.id === "name") {
          const shrink = Math.min(6, zone.height * 0.2);
          adjustments.push(`intent:structured_detail ${zone.id} -${shrink.toFixed(1)}%h`);
          return { ...zone, height: Math.max(8, zone.height - shrink) };
        }
        if (zone.id === "body") {
          const boost = Math.min(10, zone.height * 0.3);
          adjustments.push(`intent:structured_detail body +${boost.toFixed(0)}%h`);
          return { ...zone, height: zone.height + boost, width: Math.max(zone.width, 60) };
        }
        return zone;
      }

      case "cta_driven": {
        if (zone.id === "cta") {
          const heightBoost = Math.min(4, zone.height * 0.4);
          const widthBoost = Math.min(12, Math.max(0, 50 - zone.width));
          adjustments.push(`intent:cta_driven cta +${heightBoost.toFixed(0)}%h +${widthBoost.toFixed(0)}%w`);
          return { ...zone, height: zone.height + heightBoost, width: zone.width + widthBoost, y: Math.max(zone.y - 4, 0) };
        }
        return zone;
      }

      default:
        return zone;
    }
  });
}

// ── Phase 2: Content-adaptive resizing ────────────────────────────────────────

function adaptZoneSizes(
  zones: Zone[],
  metrics: ContentMetrics,
  density: DensityProfile,
  adjustments: string[],
): Zone[] {
  return zones.map(zone => {
    if (!TEXT_ZONES.has(zone.id)) return zone;
    if (zone.height === 0) return zone; // collapsed

    switch (zone.id) {
      case "headline":
      case "name": {
        const chars = zone.id === "headline" ? metrics.headlineChars : (metrics.hasName ? 30 : 0);
        let adjusted = { ...zone };

        if (chars > 45) {
          const boost = Math.min(8, Math.ceil((chars - 45) / 10) * 2);
          adjustments.push(`resize:${zone.id} +${boost}% height (${chars} chars)`);
          adjusted = { ...adjusted, height: adjusted.height + boost };
        } else if (chars > 0 && chars <= 20 && !density.preferCompact) {
          if (adjusted.maxFontSize) {
            adjustments.push(`resize:${zone.id} boost maxFontSize for short headline`);
            adjusted = { ...adjusted, maxFontSize: Math.round(adjusted.maxFontSize * 1.15) };
          } else {
            const maxBoost = Math.min(4, adjusted.height * 0.2);
            adjusted = { ...adjusted, height: adjusted.height + maxBoost };
          }
        }

        if (metrics.keywords.length >= 2 && chars > 0 && chars <= 30 && adjusted.width < 80) {
          const widthBoost = Math.min(10, metrics.keywords.length * 2);
          adjustments.push(`keyword_emphasis:${zone.id} +${widthBoost}%w (${metrics.keywords.length} keywords)`);
          adjusted = { ...adjusted, width: Math.min(90, adjusted.width + widthBoost) };
        }

        return adjusted;
      }

      case "subhead":
      case "tagline": {
        // Subhead adapts to length
        const chars = zone.id === "subhead" ? metrics.subheadChars : 0;
        if (chars > 120) {
          const boost = Math.min(6, Math.ceil((chars - 120) / 30) * 2);
          adjustments.push(`resize:${zone.id} +${boost}% height (${chars} chars)`);
          return { ...zone, height: zone.height + boost };
        }
        return zone;
      }

      case "body": {
        if (metrics.bodyChars > 400) {
          const boost = Math.min(10, Math.ceil((metrics.bodyChars - 400) / 80) * 2);
          adjustments.push(`resize:body +${boost}% height (${metrics.bodyChars} chars)`);
          return { ...zone, height: zone.height + boost };
        }
        if (metrics.bodyChars > 0 && metrics.bodyChars < 80 && metrics.contentDensity === "light") {
          // Very short body — reclaim some space
          const shrink = Math.min(4, zone.height * 0.2);
          adjustments.push(`resize:body -${shrink.toFixed(1)}% height (short body)`);
          return { ...zone, height: Math.max(4, zone.height - shrink) };
        }
        return zone;
      }

      case "cta": {
        // CTA gets promoted if it's the primary action element
        if (metrics.hasCta && metrics.ctaChars > 20) {
          adjustments.push(`resize:cta +2% height (long CTA text)`);
          return { ...zone, height: zone.height + 2, width: Math.min(100, zone.width + 8) };
        }
        return zone;
      }

      default:
        return zone;
    }
  });
}

// ── Phase 3: Safe zone enforcement ────────────────────────────────────────────

function enforceSafeZones(
  zones: Zone[],
  safe: { top: number; right: number; bottom: number; left: number },
  adjustments: string[],
): Zone[] {
  return zones.map(zone => {
    // Background and image zones can span full canvas
    if (zone.id === "background" || zone.id === "image" || zone.id === "accent") return zone;
    if (zone.height === 0) return zone; // collapsed

    let { x, y, width, height } = zone;
    let adjusted = false;

    // Enforce left safe zone
    if (x < safe.left) {
      const shift = safe.left - x;
      x = safe.left;
      width = Math.max(10, width - shift);
      adjusted = true;
    }

    // Enforce top safe zone
    if (y < safe.top) {
      const shift = safe.top - y;
      y = safe.top;
      height = Math.max(4, height - shift);
      adjusted = true;
    }

    // Enforce right safe zone
    const maxRight = 100 - safe.right;
    if (x + width > maxRight) {
      width = Math.max(10, maxRight - x);
      adjusted = true;
    }

    // Enforce bottom safe zone
    const maxBottom = 100 - safe.bottom;
    if (y + height > maxBottom) {
      height = Math.max(4, maxBottom - y);
      adjusted = true;
    }

    if (adjusted) {
      adjustments.push(`safe_zone:${zone.id} clamped to platform margins`);
    }

    return { ...zone, x, y, width, height };
  });
}

// ── Phase 4: Minimum gap enforcement ──────────────────────────────────────────

function enforceMinimumGaps(
  zones: Zone[],
  density: DensityProfile,
  adjustments: string[],
): Zone[] {
  const minGap = Math.max(MIN_VERTICAL_GAP, density.minZonePadding);

  // Sort text zones by y-position to check vertical stacking
  const textZones = zones
    .filter(z => TEXT_ZONES.has(z.id) && z.height > 0)
    .sort((a, b) => a.y - b.y);

  const shiftMap = new Map<ZoneId, number>();

  for (let i = 1; i < textZones.length; i++) {
    const prev = textZones[i - 1];
    const curr = textZones[i];

    const prevBottom = prev.y + prev.height + (shiftMap.get(prev.id) ?? 0);
    const gap = curr.y + (shiftMap.get(curr.id) ?? 0) - prevBottom;

    if (gap < minGap) {
      const shift = minGap - gap;
      const existingShift = shiftMap.get(curr.id) ?? 0;
      shiftMap.set(curr.id, existingShift + shift);
      adjustments.push(`gap:${curr.id} pushed down ${shift.toFixed(1)}% (gap was ${gap.toFixed(1)}%)`);
    }
  }

  if (shiftMap.size === 0) return zones;

  return zones.map(zone => {
    const shift = shiftMap.get(zone.id);
    if (!shift) return zone;

    let newY = zone.y + shift;
    // If pushing down would overflow, shrink height instead
    if (newY + zone.height > 98) {
      const overflow = (newY + zone.height) - 98;
      return { ...zone, y: newY, height: Math.max(4, zone.height - overflow) };
    }
    return { ...zone, y: newY };
  });
}

// ── Phase 5: Grid snapping ────────────────────────────────────────────────────

function snapAllToGrid(zones: Zone[], adjustments: string[]): Zone[] {
  let snapped = 0;
  const result = zones.map(zone => {
    // Don't snap background/image zones or collapsed zones
    if (zone.id === "background" || zone.id === "image" || zone.id === "accent") return zone;
    if (zone.height === 0) return zone;

    const newX = snapToGrid(zone.x);
    const newY = snapToGrid(zone.y);
    const newW = snapToGrid(zone.width);
    const newH = snapToGrid(zone.height);

    if (newX !== zone.x || newY !== zone.y || newW !== zone.width || newH !== zone.height) {
      snapped++;
    }

    return {
      ...zone,
      x: newX,
      y: newY,
      width: Math.max(GRID_UNIT, newW),
      height: Math.max(GRID_UNIT, newH),
    };
  });

  if (snapped > 0) {
    adjustments.push(`grid:snapped ${snapped} zones to ${GRID_UNIT}% baseline grid`);
  }

  return result;
}

// ── Phase 6: Alignment normalization ──────────────────────────────────────────

function normalizeAlignment(zones: Zone[], adjustments: string[]): Zone[] {
  // Find the dominant left margin among text zones
  const textZones = zones.filter(z => TEXT_ZONES.has(z.id) && z.height > 0 && z.alignH === "left");
  if (textZones.length < 2) return zones;

  // Count x-positions to find the most common one
  const xCounts = new Map<number, number>();
  for (const z of textZones) {
    xCounts.set(z.x, (xCounts.get(z.x) ?? 0) + 1);
  }

  let dominantX = textZones[0].x;
  let maxCount = 0;
  for (const [x, count] of xCounts) {
    if (count > maxCount) {
      maxCount = count;
      dominantX = x;
    }
  }

  // Align zones that are within 3% of the dominant margin
  let aligned = 0;
  const result = zones.map(zone => {
    if (!TEXT_ZONES.has(zone.id) || zone.height === 0 || zone.alignH !== "left") return zone;
    if (Math.abs(zone.x - dominantX) > 0 && Math.abs(zone.x - dominantX) <= 3) {
      aligned++;
      return { ...zone, x: dominantX };
    }
    return zone;
  });

  if (aligned > 0) {
    adjustments.push(`align:normalized ${aligned} zones to x=${dominantX}%`);
  }

  return result;
}
