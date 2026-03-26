// src/engines/layout/density.ts
// Visual Hierarchy & Density Engine
//
// Computes precise typographic scale, spacing, and density for each asset based
// on the resolved LayoutSpec. Runs BEFORE the AI content call so the prompt can
// include exact pixel measurements that the model must respect.

import { Zone, ZoneId } from "./families";
import { LayoutSpec, DensityProfile } from "./authority";
import { FORMAT_DIMS } from "../../lib/types";

// ── Typographic scale ─────────────────────────────────────────────────────────
// Based on a 1.333 (perfect fourth) modular scale seeded by the base size
const SCALE_RATIO = 1.333;

export function modularScale(base: number, steps: number): number {
  return Math.round(base * Math.pow(SCALE_RATIO, steps));
}

// ── Zone density analysis ─────────────────────────────────────────────────────
export interface ZoneDensitySpec {
  zoneId:        ZoneId;
  // Computed in absolute pixels
  xPx:           number;
  yPx:           number;
  widthPx:       number;
  heightPx:      number;
  // Typography
  recommendedFontSize:  number;  // within zone min/max, scaled to canvas
  maxLinesAtRecommended:number;  // how many lines fit at recommended size
  effectiveLeading:     number;  // px per line (fontSize * leading multiplier)
  // Density signal
  densityScore:  number;  // 0–100, how "full" this zone should feel
  charBudget:    number;  // tight character budget based on zone area + font
}

export interface DensityAnalysis {
  canvasWidth:  number;
  canvasHeight: number;
  zones:        ZoneDensitySpec[];
  totalDensityScore: number;   // sum — signals overall visual weight
  isOverloaded: boolean;       // true if too many zones active
  suggestions:  string[];      // human-readable suggestions for AI prompt
}

// ── Main entry ────────────────────────────────────────────────────────────────
export function analyzeDensity(
  spec:          LayoutSpec,
  contentHints?: { headline?: string; subhead?: string; body?: string }
): DensityAnalysis {
  const dims    = FORMAT_DIMS[spec.family.formats[0]] ?? { width: 1080, height: 1080 };
  const density = spec.density;

  const activeZones = spec.zones.filter(z =>
    spec.activeZoneIds.includes(z.id) &&
    z.id !== "background" && z.id !== "image"
  );

  const zoneDensitySpecs: ZoneDensitySpec[] = activeZones.map(zone =>
    computeZoneDensity(zone, dims, density, contentHints)
  );

  // Check overload: too many text zones in too little space
  const textZones = zoneDensitySpecs.filter(z =>
    ["headline", "subhead", "body", "cta", "badge", "tagline"].includes(z.zoneId)
  );
  const totalDensityScore = zoneDensitySpecs.reduce((s, z) => s + z.densityScore, 0);
  const isOverloaded = textZones.length > density.maxTextZones ||
                       totalDensityScore > 320;

  const suggestions = buildSuggestions(zoneDensitySpecs, density, isOverloaded);

  return {
    canvasWidth:  dims.width,
    canvasHeight: dims.height,
    zones:        zoneDensitySpecs,
    totalDensityScore,
    isOverloaded,
    suggestions,
  };
}

function computeZoneDensity(
  zone:     Zone,
  dims:     { width: number; height: number },
  density:  DensityProfile,
  hints?:   { headline?: string; subhead?: string; body?: string }
): ZoneDensitySpec {
  const xPx      = Math.round((zone.x      / 100) * dims.width);
  const yPx      = Math.round((zone.y      / 100) * dims.height);
  const widthPx  = Math.round((zone.width  / 100) * dims.width);
  const heightPx = Math.round((zone.height / 100) * dims.height);

  // Font size: start at midpoint of zone range, scale by canvas size
  const minFs = zone.minFontSize ?? 12;
  const maxFs = zone.maxFontSize ?? 96;
  const midFs = (minFs + maxFs) / 2;

  // Scale factor: larger canvases need proportionally larger text
  const scaleFactor = Math.sqrt((dims.width * dims.height) / (1080 * 1080));
  const scaledBase  = Math.round(midFs * scaleFactor);
  const recommendedFontSize = Math.max(minFs, Math.min(maxFs, scaledBase));

  // Leading
  const effectiveLeading = Math.round(recommendedFontSize * density.baseLeading);

  // How many lines fit
  const maxLinesAtRecommended = Math.max(1, Math.floor(heightPx / effectiveLeading));

  // Character budget: how many chars fill the zone at recommended size
  // Approximation: average char width ≈ 0.52 × fontSize (for Arial/sans-serif)
  const avgCharWidthPx = recommendedFontSize * 0.52;
  const charsPerLine   = Math.floor(widthPx / avgCharWidthPx);
  const charBudget     = charsPerLine * maxLinesAtRecommended;

  // Density score: percentage of zone "filled" by estimated content
  const hintText = hints?.[zone.id as keyof typeof hints] ?? "";
  const estimatedChars = hintText.length || zone.constraints?.maxChars ?? charBudget;
  const densityScore   = Math.min(100, Math.round((estimatedChars / Math.max(1, charBudget)) * 100));

  return {
    zoneId: zone.id,
    xPx, yPx, widthPx, heightPx,
    recommendedFontSize,
    maxLinesAtRecommended,
    effectiveLeading,
    densityScore,
    charBudget: Math.min(charBudget, zone.constraints?.maxChars ?? charBudget),
  };
}

function buildSuggestions(
  zones:      ZoneDensitySpec[],
  density:    DensityProfile,
  overloaded: boolean
): string[] {
  const suggestions: string[] = [];

  if (overloaded) {
    suggestions.push("Layout is at max density — keep all text concise and avoid filler phrases");
  }

  const headline = zones.find(z => z.zoneId === "headline");
  if (headline) {
    if (headline.charBudget < 30) {
      suggestions.push(`Headline zone is compact (${headline.charBudget} char budget) — use 1–4 punchy words`);
    } else if (headline.charBudget < 50) {
      suggestions.push(`Headline zone is medium (${headline.charBudget} chars) — aim for 5–8 words`);
    } else {
      suggestions.push(`Headline zone allows up to ${headline.charBudget} chars — can use a full sentence`);
    }
    suggestions.push(`Recommended headline font size: ${headline.recommendedFontSize}px`);
  }

  const subhead = zones.find(z => z.zoneId === "subhead");
  if (subhead) {
    suggestions.push(`Subhead fits ${subhead.maxLinesAtRecommended} lines at ${subhead.recommendedFontSize}px — keep it to ${subhead.maxLinesAtRecommended <= 1 ? "a single line" : `${subhead.maxLinesAtRecommended} lines max`}`);
  }

  const cta = zones.find(z => z.zoneId === "cta");
  if (cta) {
    suggestions.push(`CTA: max ${Math.min(cta.charBudget, 25)} chars — use action verbs`);
  }

  return suggestions;
}

// ── Font-size budget enforcer ─────────────────────────────────────────────────
// Ensures AI-returned font sizes stay within both zone bounds and density budget
export function enforceDensityBudget(
  analysis: DensityAnalysis,
  textContents: Array<{ zoneId: string; fontSize: number; text: string }>
): Array<{ zoneId: string; fontSize: number; text: string; adjusted: boolean }> {
  const specMap = new Map(analysis.zones.map(z => [z.zoneId, z]));

  return textContents.map(tc => {
    const spec = specMap.get(tc.zoneId);
    if (!spec) return { ...tc, adjusted: false };

    let adjusted  = false;
    let fontSize  = tc.fontSize;
    let text      = tc.text;

    // Clamp font size to density recommendation ±20%
    const minAllowed = Math.round(spec.recommendedFontSize * 0.8);
    const maxAllowed = Math.round(spec.recommendedFontSize * 1.2);

    if (fontSize < minAllowed) { fontSize = minAllowed; adjusted = true; }
    if (fontSize > maxAllowed) { fontSize = maxAllowed; adjusted = true; }

    // Trim text to char budget
    if (text.length > spec.charBudget) {
      text     = text.slice(0, spec.charBudget - 1) + "…";
      adjusted = true;
    }

    return { ...tc, fontSize, text, adjusted };
  });
}
