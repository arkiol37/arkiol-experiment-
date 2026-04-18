// src/engines/render/text-measure.ts
//
// Unified text measurement utilities for SVG, PNG (via sharp), and GIF (via canvas).
// All three renderers call these functions to guarantee identical text wrapping
// and font-size selection — zero layout drift between formats.
//
// In a worker environment (Node.js with native canvas), measureText() uses
// canvas.measureText for pixel-perfect accuracy.
// In a serverless environment, it falls back to a character-width ratio model
// that is accurate to within ~3% for Latin characters.

import { Zone } from "../layout/families";
// Import calibrated char-width ratios measured against our ACTUAL bundled fonts.
// This ensures the serverless fallback uses the same metrics as the worker canvas.
import { REGISTERED_CHAR_WIDTH_RATIOS } from "./font-registry";
// Ultimate font ratios — Google Fonts (Montserrat, Playfair Display, etc.)
// Merged here so measureTextInZone works correctly for both base and Ultimate themes.
import { ULTIMATE_CHAR_WIDTH_RATIOS } from "./font-registry-ultimate";

// Combined lookup: Ultimate fonts take precedence when present, base fonts as fallback.
const ALL_CHAR_WIDTH_RATIOS: Record<string, number> = {
  ...REGISTERED_CHAR_WIDTH_RATIOS,
  ...ULTIMATE_CHAR_WIDTH_RATIOS,
};

// ── Types ─────────────────────────────────────────────────────────────────────
export interface WrappedText {
  lines:      string[];
  lineHeight: number;   // px — fontSize * 1.25
  totalHeight:number;   // px — lines * lineHeight
  maxLineWidth:number;  // px — widest rendered line (estimated)
}

export interface MeasuredZoneText {
  lines:         string[];
  fontSize:      number;   // Possibly reduced to fit zone
  lineHeight:    number;
  totalHeight:   number;
  textAnchorX:   number;   // Absolute pixel X for SVG/canvas anchor
  baselineY:     number;   // Absolute pixel Y for first baseline
  canvasAlign:   CanvasTextAlign;
  svgTextAnchor: "start" | "middle" | "end";
}

// ── Character width estimation (serverless fallback) ──────────────────────────
// Uses REGISTERED_CHAR_WIDTH_RATIOS — ratios empirically measured against the
// actual bundled DejaVu/Liberation fonts that canvas uses in the worker.
// This guarantees the fallback and canvas measurements agree within ~1%.
const DEFAULT_CHAR_WIDTH_RATIO = 0.505; // DejaVu Sans at 100px

function estimateCharWidth(fontFamily: string, fontSize: number): number {
  const ratio = ALL_CHAR_WIDTH_RATIOS[fontFamily] ?? DEFAULT_CHAR_WIDTH_RATIO;
  return ratio * fontSize;
}

// ── Canvas measureText (worker environment) ───────────────────────────────────
// IMPORTANT: canvas must have registerFonts() called before this is used.
// That happens in workers/index.ts at process startup.
let _canvasMeasure: ((text: string, font: string) => number) | null | undefined = undefined;

function getCanvasMeasure(): ((text: string, font: string) => number) | null {
  if (_canvasMeasure !== undefined) return _canvasMeasure;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const canvasModule = require("canvas");
    const canvas  = canvasModule.createCanvas(1, 1);
    const ctx     = canvas.getContext("2d");
    _canvasMeasure = (text: string, font: string): number => {
      ctx.font = font;
      return ctx.measureText(text).width;
    };
  } catch {
    _canvasMeasure = null; // canvas not available — use fallback
  }
  return _canvasMeasure;
}

// ── Core: measure a single line ───────────────────────────────────────────────
export function measureLineWidth(
  text:       string,
  fontSize:   number,
  fontFamily: string,
  fontWeight: number = 400
): number {
  const measure = getCanvasMeasure();
  if (measure) {
    const weight = fontWeight >= 700 ? "bold" : "normal";
    return measure(text, `${weight} ${fontSize}px ${fontFamily}`);
  }
  // Fallback: estimate
  return estimateCharWidth(fontFamily, fontSize) * text.length;
}

// ── Core: wrap text to fit within maxWidth ────────────────────────────────────
export function wrapText(
  text:       string,
  fontSize:   number,
  fontFamily: string,
  fontWeight: number,
  maxWidth:   number,
  lineHeightMultiplier?: number,
): WrappedText {
  const words      = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let currentLine  = "";

  for (const word of words) {
    const testLine  = currentLine ? `${currentLine} ${word}` : word;
    const testWidth = measureLineWidth(testLine, fontSize, fontFamily, fontWeight);

    if (testWidth > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine) lines.push(currentLine);

  // Orphan prevention: if the last line has a single short word, pull one
  // word down from the previous line to balance the visual weight.
  if (lines.length >= 2) {
    const lastLine = lines[lines.length - 1];
    const prevLine = lines[lines.length - 2];
    const lastWords = lastLine.split(/\s+/);
    const prevWords = prevLine.split(/\s+/);
    if (lastWords.length === 1 && lastWords[0].length <= 6 && prevWords.length >= 3) {
      const pulled = prevWords.pop()!;
      lines[lines.length - 2] = prevWords.join(" ");
      lines[lines.length - 1] = `${pulled} ${lastLine}`;
    }
  }

  const lineHeight    = fontSize * (lineHeightMultiplier ?? 1.25);
  const totalHeight   = lines.length * lineHeight;
  const maxLineWidth  = Math.max(
    ...lines.map(l => measureLineWidth(l, fontSize, fontFamily, fontWeight))
  );

  return { lines, lineHeight, totalHeight, maxLineWidth };
}

// ── Zone-aware text measurement ────────────────────────────────────────────────
// Tries the given fontSize, then binary-searches downward if text overflows.
export function measureTextInZone(
  text:       string,
  fontSize:   number,
  fontFamily: string,
  fontWeight: number,
  zone:       Zone,
  canvasW:    number,
  canvasH:    number,
  lineHeightMultiplier?: number,
): MeasuredZoneText {
  const zoneWidthPx  = (zone.width  / 100) * canvasW;
  const zoneHeightPx = (zone.height / 100) * canvasH;
  const minFontSize  = zone.minFontSize ?? 8;

  // Binary search: find largest fontSize that fits
  let lo = minFontSize;
  let hi = fontSize;
  let bestFontSize = minFontSize;
  let bestWrapped  = wrapText(text, minFontSize, fontFamily, fontWeight, zoneWidthPx, lineHeightMultiplier);

  // Fast path: if text fits at requested fontSize, use it
  const directWrapped = wrapText(text, fontSize, fontFamily, fontWeight, zoneWidthPx, lineHeightMultiplier);
  if (directWrapped.totalHeight <= zoneHeightPx) {
    bestFontSize = fontSize;
    bestWrapped  = directWrapped;
  } else {
    // Binary search for largest fitting size
    for (let iter = 0; iter < 12; iter++) {
      const mid     = Math.floor((lo + hi) / 2);
      const wrapped = wrapText(text, mid, fontFamily, fontWeight, zoneWidthPx, lineHeightMultiplier);
      if (wrapped.totalHeight <= zoneHeightPx) {
        bestFontSize = mid;
        bestWrapped  = wrapped;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
  }

  const zoneX = (zone.x      / 100) * canvasW;
  const zoneY = (zone.y      / 100) * canvasH;

  // Horizontal anchor
  let textAnchorX:   number;
  let canvasAlign:   CanvasTextAlign;
  let svgTextAnchor: "start" | "middle" | "end";

  switch (zone.alignH) {
    case "center":
      textAnchorX   = zoneX + zoneWidthPx / 2;
      canvasAlign   = "center";
      svgTextAnchor = "middle";
      break;
    case "right":
      textAnchorX   = zoneX + zoneWidthPx;
      canvasAlign   = "right";
      svgTextAnchor = "end";
      break;
    default: // "left"
      textAnchorX   = zoneX;
      canvasAlign   = "left";
      svgTextAnchor = "start";
  }

  // Vertical baseline — start from top of zone, center text block
  const blockHeight = bestWrapped.totalHeight;
  const topPad      = (zoneHeightPx - blockHeight) / 2;
  const baselineY   = zoneY + Math.max(0, topPad) + bestFontSize; // first baseline

  return {
    lines:         bestWrapped.lines,
    fontSize:      bestFontSize,
    lineHeight:    bestWrapped.lineHeight,
    totalHeight:   bestWrapped.totalHeight,
    textAnchorX,
    baselineY,
    canvasAlign,
    svgTextAnchor,
  };
}

// ── SVG multi-line text helper ─────────────────────────────────────────────────
// Returns an array of <tspan> y values for each line.
export function getSvgLineYPositions(
  measured: MeasuredZoneText
): number[] {
  return measured.lines.map(
    (_, i) => measured.baselineY + i * measured.lineHeight
  );
}
