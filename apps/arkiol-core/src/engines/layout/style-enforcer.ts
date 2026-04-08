// src/engines/layout/style-enforcer.ts
// Style Enforcement Engine
//
// Validates and corrects color contrast, brand tone alignment, and visual
// consistency for every asset. Runs AFTER AI content generation, BEFORE render.
// All corrections are deterministic and logged as enforcement events.

import { isValidPresetId, getStylePreset, type StylePresetId } from '@arkiol/shared';

// ── WCAG contrast utilities ───────────────────────────────────────────────────
function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return [r, g, b];
}

function sRgbToLinear(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return (
    0.2126 * sRgbToLinear(r) +
    0.7152 * sRgbToLinear(g) +
    0.0722 * sRgbToLinear(b)
  );
}

export function contrastRatio(fg: string, bg: string): number {
  const L1 = relativeLuminance(fg);
  const L2 = relativeLuminance(bg);
  const lighter = Math.max(L1, L2);
  const darker  = Math.min(L1, L2);
  return (lighter + 0.05) / (darker + 0.05);
}

// WCAG minimum: 4.5:1 for normal text, 3:1 for large text (18pt+)
export function meetsWcag(ratio: number, isLargeText: boolean): boolean {
  return ratio >= (isLargeText ? 3.0 : 4.5);
}

// ── Color correction ──────────────────────────────────────────────────────────
function adjustLightness(hex: string, delta: number): string {
  const [r, g, b] = hexToRgb(hex);
  const clamp = (v: number) => Math.max(0, Math.min(255, v));
  const nr = clamp(r + delta);
  const ng = clamp(g + delta);
  const nb = clamp(b + delta);
  return `#${nr.toString(16).padStart(2, "0")}${ng.toString(16).padStart(2, "0")}${nb.toString(16).padStart(2, "0")}`;
}

export function ensureContrast(
  textColor:   string,
  bgColor:     string,
  isLargeText: boolean
): { color: string; corrected: boolean; ratio: number } {
  const ratio = contrastRatio(textColor, bgColor);
  if (meetsWcag(ratio, isLargeText)) {
    return { color: textColor, corrected: false, ratio };
  }

  // Try darkening text first
  let adjusted = textColor;
  let adjustedRatio = ratio;
  for (let delta = -10; delta >= -200; delta -= 10) {
    adjusted = adjustLightness(textColor, delta);
    adjustedRatio = contrastRatio(adjusted, bgColor);
    if (meetsWcag(adjustedRatio, isLargeText)) break;
  }

  // If darkening failed, try lightening
  if (!meetsWcag(adjustedRatio, isLargeText)) {
    for (let delta = 10; delta <= 200; delta += 10) {
      adjusted = adjustLightness(textColor, delta);
      adjustedRatio = contrastRatio(adjusted, bgColor);
      if (meetsWcag(adjustedRatio, isLargeText)) break;
    }
  }

  // Last resort: pure white or black
  if (!meetsWcag(adjustedRatio, isLargeText)) {
    const whiteRatio = contrastRatio("#ffffff", bgColor);
    const blackRatio = contrastRatio("#000000", bgColor);
    adjusted      = whiteRatio > blackRatio ? "#ffffff" : "#000000";
    adjustedRatio = Math.max(whiteRatio, blackRatio);
  }

  return { color: adjusted, corrected: true, ratio: adjustedRatio };
}

// ── Brand tone scoring ────────────────────────────────────────────────────────
export interface BrandToneProfile {
  professional: number; // 0–100
  bold:         number;
  warm:         number;
  playful:      number;
  minimal:      number;
}

export interface ContentToneSignals {
  fontWeights:       number[];   // collected from all text zones
  colorCount:        number;     // distinct non-background colors used
  hasGradient:       boolean;
  hasAccentShape:    boolean;
  textLengths:       number[];   // char lengths of all text zones
  capitalization:    "upper" | "title" | "sentence" | "lower";
}

export function scoreBrandTone(
  content:   ContentToneSignals,
  brandTone: BrandToneProfile
): { score: number; breakdown: Record<string, number>; warnings: string[] } {
  const warnings: string[] = [];
  const breakdown: Record<string, number> = {};

  // Professional: prefers heavier weights, less decoration, shorter concise text
  const avgWeight = content.fontWeights.reduce((a, b) => a + b, 0) / Math.max(1, content.fontWeights.length);
  const profSignal = (avgWeight >= 600 ? 40 : 20) +
                     (content.colorCount <= 3 ? 30 : 10) +
                     (content.hasGradient ? 0 : 30);
  breakdown.professional = Math.round(profSignal);

  // Bold: high weight, gradient, accent shapes, short punchy text
  const avgTextLen = content.textLengths.reduce((a, b) => a + b, 0) / Math.max(1, content.textLengths.length);
  const boldSignal = (avgWeight >= 700 ? 50 : 20) +
                     (content.hasGradient ? 30 : 10) +
                     (avgTextLen < 30 ? 20 : 5);
  breakdown.bold = Math.round(boldSignal);

  // Warm: moderate weights, more colors, accent shapes, title/sentence case
  const warmSignal = (content.colorCount >= 3 ? 40 : 20) +
                     (content.hasAccentShape ? 30 : 10) +
                     (content.capitalization !== "upper" ? 30 : 10);
  breakdown.warm = Math.round(warmSignal);

  // Playful: lower weights ok, multiple colors, accent shapes, mixed case
  const playfulSignal = (content.colorCount >= 4 ? 40 : 15) +
                        (content.hasAccentShape ? 30 : 10) +
                        (content.capitalization === "title" ? 30 : 10);
  breakdown.playful = Math.round(playfulSignal);

  // Minimal: few zones, low color count, no accent shapes, clean text
  const minimalSignal = (content.colorCount <= 2 ? 50 : 10) +
                        (!content.hasAccentShape ? 30 : 0) +
                        (!content.hasGradient ? 20 : 0);
  breakdown.minimal = Math.round(minimalSignal);

  // Weighted score vs brand expectations
  const dims: Array<keyof BrandToneProfile> = ["professional", "bold", "warm", "playful", "minimal"];
  let totalDelta = 0;
  for (const dim of dims) {
    const expected = brandTone[dim];
    const actual   = breakdown[dim];
    const delta    = Math.abs(expected - actual);
    totalDelta    += delta;
    if (delta > 30) {
      warnings.push(`${dim} mismatch: brand expects ${expected}, content scores ${actual} (delta=${delta})`);
    }
  }

  // Score 0–100 where 100 = perfect brand alignment
  const score = Math.max(0, 100 - Math.round(totalDelta / dims.length));

  return { score, breakdown, warnings };
}

// ── Style enforcement pass ────────────────────────────────────────────────────
export interface TextContentForEnforcement {
  zoneId:   string;
  text:     string;
  fontSize: number;
  weight:   number;
  color:    string;
}

export interface StyleEnforcementResult {
  contents:    TextContentForEnforcement[];
  brandScore:  number;
  violations:  Array<{ zoneId: string; issue: string; correction: string }>;
  contrastMap: Record<string, number>;  // zoneId → contrast ratio
}

export function enforceStyle(
  contents:      TextContentForEnforcement[],
  backgroundColor: string,
  brand?: { voiceAttribs?: Record<string, number>; primaryColor?: string }
): StyleEnforcementResult {
  const result: TextContentForEnforcement[] = contents.map(c => ({ ...c }));
  const violations: StyleEnforcementResult["violations"] = [];
  const contrastMap: Record<string, number> = {};

  // ── 1. Contrast enforcement ───────────────────────────────────────────────
  for (const content of result) {
    const isLargeText = content.fontSize >= 18;
    const { color, corrected, ratio } = ensureContrast(content.color, backgroundColor, isLargeText);
    contrastMap[content.zoneId] = Math.round(ratio * 100) / 100;

    if (corrected) {
      violations.push({
        zoneId:     content.zoneId,
        issue:      `contrast ratio ${ratio.toFixed(2)}:1 below WCAG minimum`,
        correction: `color adjusted from ${content.color} to ${color} (ratio: ${contrastRatio(color, backgroundColor).toFixed(2)}:1)`,
      });
      content.color = color;
    }
  }

  // ── 2. Brand tone scoring ─────────────────────────────────────────────────
  let brandScore = 80; // default when no brand

  if (brand?.voiceAttribs) {
    const toneProfile: BrandToneProfile = {
      professional: (brand.voiceAttribs["professional"] ?? 50) as number,
      bold:         (brand.voiceAttribs["bold"]         ?? 50) as number,
      warm:         (brand.voiceAttribs["warm"]         ?? 50) as number,
      playful:      (brand.voiceAttribs["playful"]      ?? 30) as number,
      minimal:      (brand.voiceAttribs["minimal"]      ?? 50) as number,
    };

    const firstColor = result[0]?.color ?? "#ffffff";
    const capitalization = detectCapitalization(result.map(c => c.text));

    const toneResult = scoreBrandTone(
      {
        fontWeights:    result.map(c => c.weight),
        colorCount:     new Set(result.map(c => c.color)).size + 1,
        hasGradient:    false, // caller can pass this
        hasAccentShape: false,
        textLengths:    result.map(c => c.text.length),
        capitalization,
      },
      toneProfile
    );

    brandScore = toneResult.score;
    for (const w of toneResult.warnings) {
      violations.push({ zoneId: "brand", issue: w, correction: "Advisory — no auto-correction applied" });
    }
  }

  return { contents: result, brandScore, violations, contrastMap };
}

function detectCapitalization(texts: string[]): ContentToneSignals["capitalization"] {
  const joined = texts.join(" ");
  if (!joined) return "sentence";
  const upperCount = (joined.match(/[A-Z]/g) ?? []).length;
  const lowerCount = (joined.match(/[a-z]/g) ?? []).length;
  const total = upperCount + lowerCount;
  if (total === 0) return "sentence";
  if (upperCount / total > 0.8) return "upper";
  if (upperCount / total > 0.5) return "title";
  if (upperCount / total > 0.2) return "sentence";
  return "lower";
}

// ── Style Preset Integration (P9.3) ──────────────────────────────────────────
// Re-exported from the shared archetype module so the render pipeline can use
// preset tokens without depending on the AI module directly.
// The style enforcement stage applies preset defaults when no brand overrides
// are present, ensuring every render has a coherent visual system.

export {
  STYLE_PRESETS,
  getStylePreset,
  isValidPresetId,
  ARCHETYPE_PREFERRED_PRESETS,
  pickPresetForPlatform,
} from '@arkiol/shared';

export type { StylePreset, StylePresetId } from '@arkiol/shared';

/**
 * applyPresetToStyle
 *
 * Merges a style preset's token values into the enforcement result's
 * brand score and background color — additive only, never overrides
 * explicitly set brand colors.
 *
 * Called from pipeline.ts at the style enforcement stage boundary.
 */
export function applyPresetToEnforcement(
  result:      StyleEnforcementResult,
  presetId:    string,
  hasBrand:    boolean,
): StyleEnforcementResult {
  // If brand is present, brand wins — preset is decorative guidance only.
  if (hasBrand) return result;

  // Fetch preset using re-exported helpers (isValidPresetId / getStylePreset come
  // from the export * block at the bottom of this file).
  if (!isValidPresetId(presetId)) return result;
  const preset = getStylePreset(presetId as StylePresetId);

  // Apply preset bg as authoritative background color for contrast checks
  // Re-run contrast on the preset bg for any text blocks that weren't brand-corrected
  const reChecked: import('./style-enforcer').TextContentForEnforcement[] = result.contents.map(c => {
    const { color, corrected, ratio } = ensureContrast(c.color, preset.bg, c.fontSize >= 18);
    return corrected ? { ...c, color } : c;
  });

  // Small preset-affinity bonus to brandScore when preset signals match archetype
  const presetBonus = presetId === 'bold' || presetId === 'expressive' ? 3 : 0;

  return {
    ...result,
    contents:   reChecked,
    brandScore: Math.min(100, result.brandScore + presetBonus),
  };
}
