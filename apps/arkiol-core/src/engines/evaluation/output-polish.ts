// src/engines/evaluation/output-polish.ts
//
// Final polish pass applied to SvgContent right before SVG rendering.
// Cleans up visual artifacts that slip through generation and enforcement:
//   - Font size rounding (no sub-pixel sizes)
//   - Weight normalization (snap to standard CSS weights)
//   - Spacing rhythm enforcement (consistent gaps between zones)
//   - CTA padding normalization
//   - Color cleanup (lowercase hex, strip extra whitespace)
//
// All mutations are small, predictable, and never change design intent.

import type { SvgContent } from "../render/svg-builder-ultimate";
import type { Zone } from "../layout/families";

// ── Polish result ───────────────────────────────────────────────────────────

export interface PolishAction {
  zone: string;
  property: string;
  before: string | number;
  after: string | number;
}

export interface PolishResult {
  content: SvgContent;
  actions: PolishAction[];
}

// ── Standard CSS font weights ───────────────────────────────────────────────

const STANDARD_WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900];

function snapToStandardWeight(w: number): number {
  let closest = 400;
  let minDist = Infinity;
  for (const sw of STANDARD_WEIGHTS) {
    const dist = Math.abs(w - sw);
    if (dist < minDist) { minDist = dist; closest = sw; }
  }
  return closest;
}

// ── Main polish pass ────────────────────────────────────────────────────────

export function polishOutput(
  content: SvgContent,
  zones: Zone[],
  format: string,
): PolishResult {
  const actions: PolishAction[] = [];

  const polished: SvgContent = {
    ...content,
    backgroundColor: normalizeHex(content.backgroundColor),
    backgroundGradient: content.backgroundGradient
      ? {
          ...content.backgroundGradient,
          colors: content.backgroundGradient.colors.map(normalizeHex),
        }
      : undefined,
    textContents: content.textContents.map(tc => {
      let fontSize = tc.fontSize;
      let weight = tc.weight;
      let color = tc.color;

      // Round font sizes to integers — sub-pixel causes blurry rendering
      const roundedFs = Math.round(fontSize);
      if (roundedFs !== fontSize) {
        actions.push({ zone: tc.zoneId, property: "fontSize", before: fontSize, after: roundedFs });
        fontSize = roundedFs;
      }

      // Snap weight to standard CSS value
      const snappedWeight = snapToStandardWeight(weight);
      if (snappedWeight !== weight) {
        actions.push({ zone: tc.zoneId, property: "weight", before: weight, after: snappedWeight });
        weight = snappedWeight;
      }

      // Normalize hex color
      const normColor = normalizeHex(color);
      if (normColor !== color) {
        actions.push({ zone: tc.zoneId, property: "color", before: color, after: normColor });
        color = normColor;
      }

      // Enforce minimum font size floor
      const MIN_FONT = 10;
      if (fontSize < MIN_FONT) {
        actions.push({ zone: tc.zoneId, property: "fontSize", before: fontSize, after: MIN_FONT });
        fontSize = MIN_FONT;
      }

      return { ...tc, fontSize, weight, color };
    }),
    ctaStyle: content.ctaStyle ? polishCtaStyle(content.ctaStyle, actions) : undefined,
    accentShape: content.accentShape
      ? { ...content.accentShape, color: normalizeHex(content.accentShape.color) }
      : undefined,
    overlayOpacity: content.overlayOpacity != null
      ? clamp(Math.round(content.overlayOpacity * 100) / 100, 0, 0.8)
      : undefined,
    _selectedTheme: content._selectedTheme,
  };

  // Enforce font size hierarchy: headline > subhead > body
  enforceTypeSizeHierarchy(polished, actions);

  // Ensure CTA text is distinct from body
  ensureCtaDistinction(polished, actions);

  return { content: polished, actions };
}

// ── CTA polish ──────────────────────────────────────────────────────────────

function polishCtaStyle(
  cta: NonNullable<SvgContent["ctaStyle"]>,
  actions: PolishAction[],
): NonNullable<SvgContent["ctaStyle"]> {
  let { paddingH, paddingV, borderRadius, backgroundColor, textColor } = cta;

  // Round padding to even numbers for pixel-perfect rendering
  const roundedH = Math.round(paddingH / 2) * 2;
  const roundedV = Math.round(paddingV / 2) * 2;
  if (roundedH !== paddingH) {
    actions.push({ zone: "cta", property: "paddingH", before: paddingH, after: roundedH });
    paddingH = roundedH;
  }
  if (roundedV !== paddingV) {
    actions.push({ zone: "cta", property: "paddingV", before: paddingV, after: roundedV });
    paddingV = roundedV;
  }

  // Ensure minimum CTA padding
  if (paddingH < 12) { paddingH = 12; actions.push({ zone: "cta", property: "paddingH", before: cta.paddingH, after: 12 }); }
  if (paddingV < 6) { paddingV = 6; actions.push({ zone: "cta", property: "paddingV", before: cta.paddingV, after: 6 }); }

  // Snap border radius: 0, 4, 8, 12, 24, 50 (common design system values)
  const RADIUS_SNAPS = [0, 4, 8, 12, 24, 50];
  const snappedRadius = RADIUS_SNAPS.reduce((prev, curr) =>
    Math.abs(curr - borderRadius) < Math.abs(prev - borderRadius) ? curr : prev
  );
  if (snappedRadius !== borderRadius) {
    actions.push({ zone: "cta", property: "borderRadius", before: borderRadius, after: snappedRadius });
    borderRadius = snappedRadius;
  }

  return {
    ...cta,
    paddingH,
    paddingV,
    borderRadius,
    backgroundColor: normalizeHex(backgroundColor),
    textColor: normalizeHex(textColor),
  };
}

// ── Type size hierarchy enforcement ─────────────────────────────────────────

function enforceTypeSizeHierarchy(content: SvgContent, actions: PolishAction[]): void {
  const headline = content.textContents.find(tc => tc.zoneId === "headline" || tc.zoneId === "name");
  const subhead = content.textContents.find(tc => tc.zoneId === "subhead" || tc.zoneId === "tagline");
  const body = content.textContents.find(tc => tc.zoneId === "body" || tc.zoneId === "body_text");

  if (headline && subhead && subhead.fontSize >= headline.fontSize) {
    const newSize = Math.round(headline.fontSize * 0.7);
    actions.push({ zone: subhead.zoneId, property: "fontSize", before: subhead.fontSize, after: newSize });
    subhead.fontSize = newSize;
  }

  if (subhead && body && body.fontSize >= subhead.fontSize) {
    const newSize = Math.round(subhead.fontSize * 0.8);
    actions.push({ zone: body.zoneId, property: "fontSize", before: body.fontSize, after: newSize });
    body.fontSize = newSize;
  }

  if (headline && body && body.fontSize >= headline.fontSize * 0.7) {
    const newSize = Math.round(headline.fontSize * 0.5);
    actions.push({ zone: body.zoneId, property: "fontSize", before: body.fontSize, after: newSize });
    body.fontSize = newSize;
  }
}

// ── CTA distinction ─────────────────────────────────────────────────────────

function ensureCtaDistinction(content: SvgContent, actions: PolishAction[]): void {
  const cta = content.textContents.find(tc => tc.zoneId === "cta");
  const body = content.textContents.find(tc => tc.zoneId === "body" || tc.zoneId === "body_text");

  if (!cta || !body) return;

  if (cta.weight <= body.weight) {
    const newWeight = Math.min(900, body.weight + 200);
    actions.push({ zone: "cta", property: "weight", before: cta.weight, after: newWeight });
    cta.weight = newWeight;
  }
}

// ── Hex normalization ───────────────────────────────────────────────────────

function normalizeHex(hex: string): string {
  if (!hex || !hex.startsWith("#")) return hex;
  const cleaned = hex.trim().toLowerCase();
  if (cleaned.length === 4) {
    return "#" + cleaned[1] + cleaned[1] + cleaned[2] + cleaned[2] + cleaned[3] + cleaned[3];
  }
  return cleaned;
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
