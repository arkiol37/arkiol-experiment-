/**
 * apps/arkiol-core/src/__tests__/text-measure.test.ts
 *
 * Unit tests for engines/render/text-measure.ts
 *
 * Pure computational logic — no DB, no HTTP.
 * (Canvas is not available in test env so measureLineWidth uses the
 * character-width-ratio fallback path automatically.)
 *
 * Covers:
 *  - measureLineWidth   — positive result, longer text → wider, scaling with fontSize
 *  - wrapText           — returns lines/lineHeight/totalHeight/maxLineWidth,
 *                         short text stays 1 line, long text wraps, empty text
 *  - measureTextInZone  — all required fields, fontSize ≤ requested,
 *                         alignment modes, getSvgLineYPositions consistent
 *  - getSvgLineYPositions — count matches lines, monotonically increasing
 */

import {
  measureLineWidth,
  wrapText,
  measureTextInZone,
  getSvgLineYPositions,
} from '../engines/render/text-measure';

import type { Zone } from '../engines/layout/families';

// ── Fixtures ──────────────────────────────────────────────────────────────────
function makeZone(overrides: Partial<Zone> = {}): Zone {
  return {
    id:     'z1',
    x:      5,
    y:      5,
    width:  40,
    height: 15,
    alignH: 'left',
    alignV: 'top',
    role:   'headline',
    minFontSize: 8,
    ...overrides,
  };
}

const CANVAS_W = 1080;
const CANVAS_H = 1080;
const FONT     = 'Inter';
const WEIGHT   = 400;

// ══════════════════════════════════════════════════════════════════════════════
// measureLineWidth
// ══════════════════════════════════════════════════════════════════════════════
describe('measureLineWidth', () => {
  it('returns a positive number for non-empty text', () => {
    expect(measureLineWidth('Hello World', 40, FONT)).toBeGreaterThan(0);
  });

  it('longer text produces larger width', () => {
    const short = measureLineWidth('Hi',    40, FONT);
    const long  = measureLineWidth('Hello World this is a longer line', 40, FONT);
    expect(long).toBeGreaterThan(short);
  });

  it('larger fontSize produces larger width', () => {
    const small = measureLineWidth('Test', 20, FONT);
    const large = measureLineWidth('Test', 60, FONT);
    expect(large).toBeGreaterThan(small);
  });

  it('empty string returns 0', () => {
    expect(measureLineWidth('', 40, FONT)).toBe(0);
  });

  it('returns a finite number', () => {
    expect(isFinite(measureLineWidth('Test', 40, FONT))).toBe(true);
  });

  it('bold weight (700) ≥ normal weight (400) for same text and size', () => {
    const normal = measureLineWidth('Test', 40, FONT, 400);
    const bold   = measureLineWidth('Test', 40, FONT, 700);
    expect(bold).toBeGreaterThanOrEqual(normal);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// wrapText
// ══════════════════════════════════════════════════════════════════════════════
describe('wrapText', () => {
  it('returns WrappedText with correct shape', () => {
    const result = wrapText('Hello World', 40, FONT, WEIGHT, 500);
    expect(Array.isArray(result.lines)).toBe(true);
    expect(typeof result.lineHeight).toBe('number');
    expect(typeof result.totalHeight).toBe('number');
    expect(typeof result.maxLineWidth).toBe('number');
  });

  it('short text in wide zone stays on 1 line', () => {
    const result = wrapText('Hi', 40, FONT, WEIGHT, 1000);
    expect(result.lines.length).toBe(1);
    expect(result.lines[0]).toBe('Hi');
  });

  it('long text wraps into multiple lines when width is narrow', () => {
    const longText = 'This is a very long piece of text that should definitely wrap into multiple lines';
    const result = wrapText(longText, 30, FONT, WEIGHT, 100);
    expect(result.lines.length).toBeGreaterThan(1);
  });

  it('empty text returns 0 lines', () => {
    const result = wrapText('', 40, FONT, WEIGHT, 500);
    expect(result.lines.length).toBe(0);
  });

  it('lineHeight is fontSize * 1.25', () => {
    const fontSize = 40;
    const result = wrapText('Test', fontSize, FONT, WEIGHT, 500);
    expect(result.lineHeight).toBeCloseTo(fontSize * 1.25, 5);
  });

  it('totalHeight is lines.length * lineHeight', () => {
    const result = wrapText('Hello World', 40, FONT, WEIGHT, 500);
    expect(result.totalHeight).toBeCloseTo(result.lines.length * result.lineHeight, 5);
  });

  it('maxLineWidth is positive for non-empty text', () => {
    const result = wrapText('Hello', 40, FONT, WEIGHT, 500);
    expect(result.maxLineWidth).toBeGreaterThan(0);
  });

  it('no line is empty string in result', () => {
    const result = wrapText('word1 word2 word3', 40, FONT, WEIGHT, 500);
    for (const line of result.lines) {
      expect(line.trim().length).toBeGreaterThan(0);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// measureTextInZone
// ══════════════════════════════════════════════════════════════════════════════
describe('measureTextInZone', () => {
  const ZONE = makeZone();

  it('returns MeasuredZoneText with all required fields', () => {
    const m = measureTextInZone('Hello', 40, FONT, WEIGHT, ZONE, CANVAS_W, CANVAS_H);
    expect(Array.isArray(m.lines)).toBe(true);
    expect(typeof m.fontSize).toBe('number');
    expect(typeof m.lineHeight).toBe('number');
    expect(typeof m.totalHeight).toBe('number');
    expect(typeof m.textAnchorX).toBe('number');
    expect(typeof m.baselineY).toBe('number');
    expect(typeof m.canvasAlign).toBe('string');
    expect(typeof m.svgTextAnchor).toBe('string');
  });

  it('fontSize is ≤ requested fontSize', () => {
    const m = measureTextInZone('Hello World', 40, FONT, WEIGHT, ZONE, CANVAS_W, CANVAS_H);
    expect(m.fontSize).toBeLessThanOrEqual(40);
  });

  it('fontSize is ≥ minFontSize', () => {
    const m = measureTextInZone('A very long text that needs to shrink quite a bit to fit', 60, FONT, WEIGHT, ZONE, CANVAS_W, CANVAS_H);
    expect(m.fontSize).toBeGreaterThanOrEqual(ZONE.minFontSize ?? 8);
  });

  it('lines is a non-empty array for non-empty text', () => {
    const m = measureTextInZone('Test', 40, FONT, WEIGHT, ZONE, CANVAS_W, CANVAS_H);
    expect(m.lines.length).toBeGreaterThan(0);
  });

  it('left alignment: canvasAlign="left", svgTextAnchor="start"', () => {
    const m = measureTextInZone('Test', 40, FONT, WEIGHT, makeZone({ alignH: 'left' }), CANVAS_W, CANVAS_H);
    expect(m.canvasAlign).toBe('left');
    expect(m.svgTextAnchor).toBe('start');
  });

  it('center alignment: canvasAlign="center", svgTextAnchor="middle"', () => {
    const m = measureTextInZone('Test', 40, FONT, WEIGHT, makeZone({ alignH: 'center' }), CANVAS_W, CANVAS_H);
    expect(m.canvasAlign).toBe('center');
    expect(m.svgTextAnchor).toBe('middle');
  });

  it('right alignment: canvasAlign="right", svgTextAnchor="end"', () => {
    const m = measureTextInZone('Test', 40, FONT, WEIGHT, makeZone({ alignH: 'right' }), CANVAS_W, CANVAS_H);
    expect(m.canvasAlign).toBe('right');
    expect(m.svgTextAnchor).toBe('end');
  });

  it('textAnchorX is within canvas bounds', () => {
    const m = measureTextInZone('Test', 40, FONT, WEIGHT, ZONE, CANVAS_W, CANVAS_H);
    expect(m.textAnchorX).toBeGreaterThanOrEqual(0);
    expect(m.textAnchorX).toBeLessThanOrEqual(CANVAS_W);
  });

  it('baselineY is within canvas bounds', () => {
    const m = measureTextInZone('Test', 40, FONT, WEIGHT, ZONE, CANVAS_W, CANVAS_H);
    expect(m.baselineY).toBeGreaterThanOrEqual(0);
    expect(m.baselineY).toBeLessThanOrEqual(CANVAS_H);
  });

  it('lineHeight is fontSize * 1.25', () => {
    const m = measureTextInZone('Test', 40, FONT, WEIGHT, ZONE, CANVAS_W, CANVAS_H);
    expect(m.lineHeight).toBeCloseTo(m.fontSize * 1.25, 5);
  });

  it('totalHeight is consistent with lines and lineHeight', () => {
    const m = measureTextInZone('Test text here', 40, FONT, WEIGHT, ZONE, CANVAS_W, CANVAS_H);
    expect(m.totalHeight).toBeCloseTo(m.lines.length * m.lineHeight, 1);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// getSvgLineYPositions
// ══════════════════════════════════════════════════════════════════════════════
describe('getSvgLineYPositions', () => {
  it('returns same number of positions as lines', () => {
    const m = measureTextInZone('Line one and line two words', 40, FONT, WEIGHT, makeZone({ width: 15 }), CANVAS_W, CANVAS_H);
    const ys = getSvgLineYPositions(m);
    expect(ys.length).toBe(m.lines.length);
  });

  it('first position matches baselineY', () => {
    const m = measureTextInZone('Test', 40, FONT, WEIGHT, makeZone(), CANVAS_W, CANVAS_H);
    const ys = getSvgLineYPositions(m);
    expect(ys[0]).toBeCloseTo(m.baselineY, 5);
  });

  it('Y positions increase monotonically (line spacing is positive)', () => {
    const m = measureTextInZone('word1 word2 word3 word4 word5 word6', 30, FONT, WEIGHT, makeZone({ width: 10 }), CANVAS_W, CANVAS_H);
    const ys = getSvgLineYPositions(m);
    for (let i = 1; i < ys.length; i++) {
      expect(ys[i]!).toBeGreaterThan(ys[i - 1]!);
    }
  });

  it('gap between consecutive positions matches lineHeight', () => {
    const m = measureTextInZone('hello world again test', 40, FONT, WEIGHT, makeZone({ width: 10 }), CANVAS_W, CANVAS_H);
    const ys = getSvgLineYPositions(m);
    for (let i = 1; i < ys.length; i++) {
      expect(ys[i]! - ys[i - 1]!).toBeCloseTo(m.lineHeight, 1);
    }
  });

  it('returns empty array for empty lines', () => {
    const m = measureTextInZone('', 40, FONT, WEIGHT, makeZone(), CANVAS_W, CANVAS_H);
    expect(getSvgLineYPositions(m)).toEqual([]);
  });

  it('all Y positions are finite numbers', () => {
    const m = measureTextInZone('Test heading', 40, FONT, WEIGHT, makeZone(), CANVAS_W, CANVAS_H);
    const ys = getSvgLineYPositions(m);
    for (const y of ys) {
      expect(isFinite(y)).toBe(true);
    }
  });
});
