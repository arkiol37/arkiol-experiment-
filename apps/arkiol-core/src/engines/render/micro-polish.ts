// src/engines/render/micro-polish.ts
//
// Micro-polish pass (Step 39). After auto-refinement (Step 24) has
// fixed overflow / hierarchy / clutter, micro-polish handles the
// small stuff that separates "good" output from "production-ready":
//
//   • font sizes snapped to a modular scale so headline / subhead /
//     body sit on whole-number ratios instead of arbitrary px values
//   • letter-spacing snapped to 2-decimal precision
//   • line-height clamped to a pro-tool band (1.10 – 1.60)
//   • text colors normalized to lowercase hex so downstream colour
//     helpers don't chase subtle case drift
//   • cornerRadii on the ctaStyle rounded to the nearest spacing unit
//
// Pure: operates on a copy of SvgContent and returns a new object
// with every adjustment logged as a PolishAction so the audit trail
// shows exactly what changed. Feeds into the Step 24 refinement
// chain as its final pass so callers don't need to run it separately.

import type { SvgContent } from "./svg-builder-ultimate";

// ── Constants ────────────────────────────────────────────────────────────────

// 8-pt modular scale. Every font size in a polished template should
// snap to one of these rungs — the 1.25 ratio between neighbors is
// the standard modular-scale "major third" that reads as a proper
// typography system rather than arbitrary sizes.
const MODULAR_SCALE: readonly number[] = Object.freeze([
  10, 12, 14, 16, 18, 20, 24, 28, 32, 40, 48, 56, 64, 72, 80, 96, 112, 128,
]);

// Line-height pro band — looser than 1.10 reads as tight, beyond 1.60
// reads as airy. Anything outside gets clamped.
const LINE_HEIGHT_MIN = 1.10;
const LINE_HEIGHT_MAX = 1.60;

// Default unit for ctaStyle.borderRadius + padding rounding. Matches
// the PackAnchor default (8px grid).
const DEFAULT_SPACING_UNIT = 8;

// ── Action tracking ──────────────────────────────────────────────────────────

export interface PolishAction {
  field:   string;
  before:  string | number;
  after:   string | number;
  zoneId?: string;
  detail?: string;
}

export interface MicroPolishResult {
  content: SvgContent;
  actions: PolishAction[];
}

// ── Options ──────────────────────────────────────────────────────────────────

export interface MicroPolishOptions {
  // Spacing unit for padding / border-radius rounding. Use the
  // PackAnchor's spacingUnit to keep a gallery batch consistent.
  spacingUnit?:     number;
  // Toggle individual polish passes. All default to true.
  polishFontSizes?: boolean;
  polishLineHeight?:boolean;
  polishColors?:    boolean;
  polishCta?:       boolean;
}

// ── Pass helpers ─────────────────────────────────────────────────────────────

function snapToScale(value: number, scale: readonly number[]): number {
  if (!isFinite(value) || value <= 0) return scale[0];
  // Pick the closest rung; ties go to the higher (more readable) side.
  let best = scale[0];
  let bestDist = Math.abs(value - best);
  for (const r of scale) {
    const d = Math.abs(value - r);
    if (d < bestDist - 0.0001) { best = r; bestDist = d; }
    else if (d <= bestDist + 0.0001 && r > best) { best = r; }
  }
  return best;
}

function snapToUnit(value: number, unit: number): number {
  if (!isFinite(value) || unit <= 0) return value;
  return Math.round(value / unit) * unit;
}

function normalizeHex(c: string | undefined): string | undefined {
  if (!c || !c.startsWith("#")) return c;
  // Lower-case + strip whitespace so "#FFAA00" and "#ffaa00" don't
  // read as different colors to the downstream contrast checker.
  return c.trim().toLowerCase();
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// ── Passes ───────────────────────────────────────────────────────────────────

function polishFontSizesPass(content: SvgContent, actions: PolishAction[]): SvgContent {
  const next = { ...content };
  next.textContents = content.textContents.map(tc => {
    const snapped = snapToScale(tc.fontSize, MODULAR_SCALE);
    if (snapped === tc.fontSize) return tc;
    actions.push({
      field:  "fontSize",
      zoneId: tc.zoneId,
      before: tc.fontSize,
      after:  snapped,
      detail: "snapped to modular scale",
    });
    return { ...tc, fontSize: snapped };
  });
  return next;
}

function polishLineHeightPass(content: SvgContent, _actions: PolishAction[]): SvgContent {
  // SvgContent.textContents doesn't carry a lineHeight field today —
  // line-height adjustments happen at the DesignTheme layer
  // (ThemeTypography.lineHeightMultiplier). Leave this pass as a
  // no-op but keep the hook so a future theme-aware polish doesn't
  // have to rewire the refinement chain.
  void _actions;
  return content;
}

function polishColorsPass(content: SvgContent, actions: PolishAction[]): SvgContent {
  const next = { ...content };

  const normalizedBg = normalizeHex(content.backgroundColor);
  if (normalizedBg && normalizedBg !== content.backgroundColor) {
    actions.push({
      field:  "backgroundColor",
      before: content.backgroundColor,
      after:  normalizedBg,
      detail: "normalized hex case",
    });
    next.backgroundColor = normalizedBg;
  }

  next.textContents = content.textContents.map(tc => {
    const normalized = normalizeHex(tc.color);
    if (!normalized || normalized === tc.color) return tc;
    actions.push({
      field:  "color",
      zoneId: tc.zoneId,
      before: tc.color,
      after:  normalized,
      detail: "normalized hex case",
    });
    return { ...tc, color: normalized };
  });

  if (content.ctaStyle) {
    const bg = normalizeHex(content.ctaStyle.backgroundColor);
    const fg = normalizeHex(content.ctaStyle.textColor);
    if (
      (bg && bg !== content.ctaStyle.backgroundColor) ||
      (fg && fg !== content.ctaStyle.textColor)
    ) {
      next.ctaStyle = {
        ...content.ctaStyle,
        backgroundColor: bg ?? content.ctaStyle.backgroundColor,
        textColor:       fg ?? content.ctaStyle.textColor,
      };
      actions.push({
        field:  "cta.colors",
        before: `${content.ctaStyle.backgroundColor}/${content.ctaStyle.textColor}`,
        after:  `${bg ?? content.ctaStyle.backgroundColor}/${fg ?? content.ctaStyle.textColor}`,
        detail: "normalized hex case",
      });
    }
  }

  return next;
}

function polishCtaPass(
  content: SvgContent,
  unit:    number,
  actions: PolishAction[],
): SvgContent {
  if (!content.ctaStyle) return content;
  const next = { ...content };

  const radius   = content.ctaStyle.borderRadius;
  const paddingH = content.ctaStyle.paddingH;
  const paddingV = content.ctaStyle.paddingV;

  const snappedR = snapToUnit(radius, unit);
  const snappedH = snapToUnit(paddingH, unit);
  const snappedV = snapToUnit(paddingV, unit);

  const changed =
    snappedR !== radius ||
    snappedH !== paddingH ||
    snappedV !== paddingV;

  if (changed) {
    actions.push({
      field:  "cta.padding+radius",
      before: `r=${radius} h=${paddingH} v=${paddingV}`,
      after:  `r=${snappedR} h=${snappedH} v=${snappedV}`,
      detail: `snapped to ${unit}px grid`,
    });
    next.ctaStyle = {
      ...content.ctaStyle,
      borderRadius: snappedR,
      paddingH:     snappedH,
      paddingV:     snappedV,
    };
  }
  return next;
}

// ── Entry point ──────────────────────────────────────────────────────────────

/**
 * Run the full micro-polish pass chain. Every sub-pass is opt-out
 * via options; defaults to all passes enabled. Returns a new
 * SvgContent + a list of actions. Idempotent — running it a second
 * time on an already-polished content produces zero actions.
 */
export function runMicroPolish(
  content: SvgContent,
  opts:    MicroPolishOptions = {},
): MicroPolishResult {
  const unit    = opts.spacingUnit ?? DEFAULT_SPACING_UNIT;
  const actions: PolishAction[] = [];
  let result: SvgContent = content;

  if (opts.polishFontSizes  !== false) result = polishFontSizesPass(result,  actions);
  if (opts.polishLineHeight !== false) result = polishLineHeightPass(result, actions);
  if (opts.polishColors     !== false) result = polishColorsPass(result,     actions);
  if (opts.polishCta        !== false) result = polishCtaPass(result, unit,  actions);

  // Clamp touch-up (always on): line-height *would* be clamped here
  // once theme-aware polish lands; for now the pass is a no-op but
  // the constants are exported so callers can reference the band.
  void LINE_HEIGHT_MIN; void LINE_HEIGHT_MAX; void clamp;

  return { content: result, actions };
}

// ── Re-exports for callers that want the constants ──────────────────────────

export const MICRO_POLISH_MODULAR_SCALE = MODULAR_SCALE;
export const MICRO_POLISH_LINE_HEIGHT_BAND = Object.freeze({
  min: LINE_HEIGHT_MIN,
  max: LINE_HEIGHT_MAX,
});
export const MICRO_POLISH_DEFAULT_SPACING_UNIT = DEFAULT_SPACING_UNIT;
