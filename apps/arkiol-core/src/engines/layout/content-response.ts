// src/engines/layout/content-response.ts
//
// Content-length driven layout response.
//
// Short headlines should create stronger focal compositions (big, centered
// headline, muted auxiliaries). Long content should trigger structured
// multi-block layouts (more height for body, bullets promoted, headline
// dialed back). Any zone at risk of overflow or awkward compression is
// grown (bounded by the canvas) or its font range is softened.
//
// This module owns content-length shaping only. Column/baseline alignment,
// safe zones, and gap enforcement live elsewhere and run after this phase.

import type { Zone, ZoneId } from "./families";
import type { BriefAnalysis } from "../ai/brief-analyzer";
import type { FormatCategory } from "./authority";

// ── Tiering ─────────────────────────────────────────────────────────────────

export type ContentLengthTier =
  | "ultra_short"
  | "short"
  | "medium"
  | "long"
  | "very_long";

export interface ContentResponseInput {
  headlineChars: number;
  subheadChars:  number;
  bodyChars:     number;
  ctaChars:      number;
  hasHeadline:   boolean;
  hasBody:       boolean;
  hasSubhead:    boolean;
  hasBullets:    boolean;
  totalChars:    number;
}

export function buildResponseInput(brief: BriefAnalysis): ContentResponseInput {
  const headlineChars = (brief.headline ?? "").length;
  const subheadChars  = (brief.subhead  ?? "").length;
  const bodyChars     = (brief.body     ?? "").length;
  const ctaChars      = (brief.cta      ?? "").length;
  const hasBullets    = !!(brief as { bullets?: string[] }).bullets?.length;

  return {
    headlineChars, subheadChars, bodyChars, ctaChars,
    hasHeadline: headlineChars > 0,
    hasBody:     bodyChars > 0,
    hasSubhead:  subheadChars > 0,
    hasBullets,
    totalChars:  headlineChars + subheadChars + bodyChars + ctaChars,
  };
}

export function classifyContentLength(input: ContentResponseInput): ContentLengthTier {
  const { headlineChars, bodyChars, totalChars } = input;

  if (headlineChars > 0 && headlineChars <= 14 && totalChars <= 40) return "ultra_short";
  if (headlineChars > 0 && headlineChars <= 25 && totalChars <= 120) return "short";
  if (totalChars > 500 || bodyChars > 380) return "very_long";
  if (totalChars > 250 || bodyChars > 180) return "long";
  return "medium";
}

// ── Geometric helpers ──────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Rough capacity estimate: lines the zone can hold at its minimum font. */
function linesCapacity(zone: Zone, canvasH: number): number {
  const minFont = zone.minFontSize ?? 14;
  const leading = 1.25;
  const linePx  = minFont * leading;
  const zonePx  = (zone.height / 100) * canvasH;
  return Math.max(1, Math.floor(zonePx / linePx));
}

/** Rough lines needed for `chars` at zone's width. */
function linesRequired(chars: number, zone: Zone, canvasW: number): number {
  if (chars <= 0) return 0;
  const minFont = zone.minFontSize ?? 14;
  const avgCharWidth = minFont * 0.55;
  const widthPx = (zone.width / 100) * canvasW;
  const charsPerLine = Math.max(8, Math.floor(widthPx / avgCharWidth));
  return Math.ceil(chars / charsPerLine);
}

// ── Format base canvas dimensions ──────────────────────────────────────────
//
// We compute overflow in pixels rather than % because zones with the same
// height % behave very differently on a 1080×1080 square vs 2550×3300 flyer.
// FormatCategory is enough granularity — exact pixels come from FORMAT_DIMS
// at render time, but for the overflow heuristic we only need ballpark.

const CANVAS_REF: Record<FormatCategory | "default", { w: number; h: number }> = {
  instagram: { w: 1080, h: 1080 },
  story:     { w: 1080, h: 1920 },
  thumbnail: { w: 1280, h: 720  },
  flyer:     { w: 2550, h: 3300 },
  poster:    { w: 2480, h: 3508 },
  slide:     { w: 1920, h: 1080 },
  card:      { w: 1050, h: 600  },
  document:  { w: 2550, h: 3300 },
  logo:      { w: 1000, h: 1000 },
  unknown:   { w: 1080, h: 1080 },
  default:   { w: 1080, h: 1080 },
};

// ── Per-zone char-source map ───────────────────────────────────────────────

function charsFor(zone: Zone, input: ContentResponseInput): number {
  switch (zone.id) {
    case "headline": return input.headlineChars;
    case "subhead":
    case "tagline":  return input.subheadChars;
    case "body":     return input.bodyChars;
    case "cta":      return input.ctaChars;
    default:         return 0;
  }
}

// ── Tier-specific shaping ──────────────────────────────────────────────────
//
// Each tier describes how much of the vertical stack the core zones should
// claim. The transforms preserve the zone's existing x/width unless the
// tier calls for a shift (e.g. ultra_short centers the headline).

interface TierTransform {
  (zone: Zone, input: ContentResponseInput, adjustments: string[]): Zone;
}

const ULTRA_SHORT: TierTransform = (zone, _in, adjustments) => {
  if (zone.height === 0) return zone;

  if (zone.id === "headline" || zone.id === "name") {
    const newHeight = clamp(zone.height * 1.55, zone.height, 55);
    const newMaxFont = zone.maxFontSize ? Math.round(zone.maxFontSize * 1.4) : zone.maxFontSize;
    adjustments.push(`content_response:ultra_short ${zone.id} focal boost`);
    return {
      ...zone,
      height: newHeight,
      maxFontSize: newMaxFont,
      alignH: "center",
      alignV: "middle",
    };
  }

  // Muted auxiliaries — keep cta/badge/logo at full fidelity, shrink the rest.
  if (zone.id === "subhead" || zone.id === "tagline" || zone.id === "body") {
    const shrink = Math.min(zone.height * 0.5, 6);
    adjustments.push(`content_response:ultra_short ${zone.id} -${shrink.toFixed(1)}%h`);
    return { ...zone, height: Math.max(0, zone.height - shrink), alignH: "center" };
  }

  return zone;
};

const SHORT: TierTransform = (zone, _in, adjustments) => {
  if (zone.height === 0) return zone;

  if (zone.id === "headline" || zone.id === "name") {
    const heightBoost = Math.min(12, zone.height * 0.4);
    const newMaxFont = zone.maxFontSize ? Math.round(zone.maxFontSize * 1.2) : zone.maxFontSize;
    adjustments.push(`content_response:short ${zone.id} +${heightBoost.toFixed(0)}%h`);
    return {
      ...zone,
      height: zone.height + heightBoost,
      maxFontSize: newMaxFont,
    };
  }

  return zone;
};

const LONG: TierTransform = (zone, input, adjustments) => {
  if (zone.height === 0) return zone;

  if (zone.id === "headline" || zone.id === "name") {
    // Give long-form content room — pull the headline in slightly
    const shrink = Math.min(6, zone.height * 0.22);
    const newMaxFont = zone.maxFontSize ? Math.round(zone.maxFontSize * 0.92) : zone.maxFontSize;
    adjustments.push(`content_response:long ${zone.id} -${shrink.toFixed(1)}%h`);
    return {
      ...zone,
      height: Math.max(8, zone.height - shrink),
      maxFontSize: newMaxFont,
    };
  }

  if (zone.id === "body") {
    const boost = Math.min(16, Math.ceil(input.bodyChars / 60) * 2);
    adjustments.push(`content_response:long body +${boost}%h`);
    return {
      ...zone,
      height: zone.height + boost,
      width: Math.max(zone.width, 64),
    };
  }

  if (zone.id === "bullet_1" || zone.id === "bullet_2" || zone.id === "bullet_3") {
    // Normalize bullet heights so they read as a list, not a stack of scraps
    const floor = 6;
    if (zone.height < floor) {
      adjustments.push(`content_response:long ${zone.id} floor ${floor}%h`);
      return { ...zone, height: floor };
    }
  }

  return zone;
};

const VERY_LONG: TierTransform = (zone, input, adjustments) => {
  if (zone.height === 0) return zone;

  if (zone.id === "headline" || zone.id === "name") {
    const shrink = Math.min(9, zone.height * 0.3);
    const newMaxFont = zone.maxFontSize ? Math.round(zone.maxFontSize * 0.85) : zone.maxFontSize;
    adjustments.push(`content_response:very_long ${zone.id} -${shrink.toFixed(1)}%h`);
    return {
      ...zone,
      height: Math.max(8, zone.height - shrink),
      maxFontSize: newMaxFont,
    };
  }

  if (zone.id === "body") {
    const boost = Math.min(22, Math.ceil(input.bodyChars / 50) * 2);
    adjustments.push(`content_response:very_long body +${boost}%h`);
    return {
      ...zone,
      height: zone.height + boost,
      width: Math.max(zone.width, 68),
    };
  }

  if (zone.id === "subhead" || zone.id === "tagline") {
    // Give the subhead enough room for 2 lines instead of cramming 1
    const min = 8;
    if (zone.height < min) {
      adjustments.push(`content_response:very_long ${zone.id} floor ${min}%h`);
      return { ...zone, height: min };
    }
  }

  return zone;
};

// ── Overflow-aware expansion ───────────────────────────────────────────────
//
// After the tier shaping runs, double-check each text zone against its
// content length. If the zone physically can't hold the text at minFontSize,
// grow it toward the next zone below (bounded by 85% of canvas height).

function preventOverflow(
  zones: Zone[],
  input: ContentResponseInput,
  canvas: { w: number; h: number },
  adjustments: string[],
): Zone[] {
  const out = zones.map(z => ({ ...z }));

  for (const zone of out) {
    if (zone.height <= 0) continue;
    const chars = charsFor(zone, input);
    if (chars <= 0) continue;

    const needed = linesRequired(chars, zone, canvas.w);
    const capacity = linesCapacity(zone, canvas.h);

    if (needed > capacity) {
      // Try to grow the zone height — request ~needed × line-height in %
      const minFont = zone.minFontSize ?? 14;
      const neededPx = needed * minFont * 1.25;
      const neededPct = (neededPx / canvas.h) * 100;
      const target = Math.min(clamp(neededPct, zone.height, 85), 85);
      if (target > zone.height + 0.5) {
        adjustments.push(
          `content_response:overflow ${zone.id} grow ${zone.height.toFixed(1)}→${target.toFixed(1)}%h ` +
          `(needs ${needed}L, fits ${capacity}L)`,
        );
        zone.height = target;
      } else if (zone.maxFontSize) {
        // Already as tall as we'll allow — soften the font ceiling so the
        // text engine downstream doesn't pick a size that overflows.
        const softened = Math.max(zone.minFontSize ?? 12, Math.round(zone.maxFontSize * 0.88));
        if (softened < zone.maxFontSize) {
          adjustments.push(
            `content_response:overflow ${zone.id} maxFont ${zone.maxFontSize}→${softened}`,
          );
          zone.maxFontSize = softened;
        }
      }
    }
  }

  return out;
}

// ── Compression-aware floor ────────────────────────────────────────────────
//
// Prevent zones from compressing below a font-size floor. If a zone holds
// non-trivial content but its physical height can't fit its minFontSize at
// even one line, we lift the height to the smallest readable value.

function preventCompression(
  zones: Zone[],
  input: ContentResponseInput,
  canvas: { w: number; h: number },
  adjustments: string[],
): Zone[] {
  return zones.map(zone => {
    if (zone.height <= 0) return zone;
    const chars = charsFor(zone, input);
    if (chars <= 0) return zone;

    const minFont = zone.minFontSize ?? 14;
    const minHeightPx = minFont * 1.25;           // one readable line
    const minHeightPct = (minHeightPx / canvas.h) * 100;
    if (zone.height < minHeightPct) {
      adjustments.push(
        `content_response:compression ${zone.id} lift ${zone.height.toFixed(1)}→${minHeightPct.toFixed(1)}%h`,
      );
      return { ...zone, height: Math.min(85, minHeightPct) };
    }
    return zone;
  });
}

// ── Public API ─────────────────────────────────────────────────────────────

export interface ContentResponseResult {
  zones:       Zone[];
  adjustments: string[];
  tier:        ContentLengthTier;
}

export function applyContentResponse(
  zones:         Zone[],
  brief:         BriefAnalysis,
  formatCategory: FormatCategory,
): ContentResponseResult {
  const input = buildResponseInput(brief);
  const tier  = classifyContentLength(input);
  const canvas = CANVAS_REF[formatCategory] ?? CANVAS_REF.default;
  const adjustments: string[] = [];
  adjustments.push(`content_response:tier=${tier} total=${input.totalChars}c head=${input.headlineChars}c body=${input.bodyChars}c`);

  const transform: TierTransform =
    tier === "ultra_short" ? ULTRA_SHORT  :
    tier === "short"       ? SHORT        :
    tier === "long"        ? LONG         :
    tier === "very_long"   ? VERY_LONG    :
    (z) => z;  // medium: no-op

  let out = zones.map(z => transform(z, input, adjustments));
  out = preventOverflow(out, input, canvas, adjustments);
  out = preventCompression(out, input, canvas, adjustments);

  return { zones: out, adjustments, tier };
}

// Explicit zone-id check for downstream consumers.
export const CONTENT_ZONES: ReadonlySet<ZoneId> = new Set<ZoneId>([
  "headline", "subhead", "body", "cta", "tagline", "name", "title",
  "bullet_1", "bullet_2", "bullet_3",
]);
