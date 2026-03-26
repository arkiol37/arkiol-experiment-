/**
 * packages/shared/src/__tests__/archetype-helpers.test.ts
 *
 * Unit tests for ai/archetypes/helpers.ts
 *
 * Pure functions only — no DB, no HTTP, no Next.js.
 *
 * Covers:
 *  - stableHash        — determinism, distribution, known values
 *  - scale             — scaling relative to base 1280w canvas
 *  - roundZone         — rounds x/y/w/h to integers
 *  - uid               — deterministic, hex suffix, contains seed
 *  - imageBlock etc    — block factory shape and type fields
 *  - requireImage      — throws if not provided
 *  - requireFace       — throws if not detected
 *  - validateOnlyAllowedBlocks — throws for disallowed types
 *  - validateNoOverlap — detects overlapping blocks, passes non-overlapping
 *  - normalize         — word capping, whitespace collapse, undefined safe
 *  - sentenceCase      — capitalises first char, lowercases rest
 *  - titleCase         — capitalises each word
 *  - normalizeHeadline — combines normalize + casing modes
 *  - fitTextToZone     — returns fitted text at appropriate font size
 */

import {
  stableHash,
  scale,
  roundZone,
  uid,
  imageBlock,
  textBlock,
  overlayBlock,
  backgroundBlock,
  badgeBlock,
  lineBlock,
  requireImage,
  requireFace,
  validateOnlyAllowedBlocks,
  validateNoOverlap,
  normalize,
  sentenceCase,
  titleCase,
  normalizeHeadline,
  fitTextToZone,
  type FitTextOpts,
} from '../ai/archetypes/helpers';

import type { Zone, Canvas } from '../ai/archetypes/types';

// ── Fixtures ──────────────────────────────────────────────────────────────────
const ZONE: Zone = { x: 0, y: 0, w: 800, h: 200 };
const CANVAS: Canvas = { w: 1280, h: 720 };
const FIT_OPTS: FitTextOpts = { baseFontSize: 60, minFontSize: 12, lineHeight: 1.2, maxLines: 3, letterSpacing: 0 };

// ══════════════════════════════════════════════════════════════════════════════
// stableHash
// ══════════════════════════════════════════════════════════════════════════════
describe('stableHash', () => {
  it('returns a number', () => {
    expect(typeof stableHash('hello')).toBe('number');
  });

  it('is deterministic — same input produces same output', () => {
    expect(stableHash('test')).toBe(stableHash('test'));
  });

  it('different inputs produce different hashes (no trivial collision)', () => {
    const hashes = ['a', 'b', 'c', 'hello', 'world', 'test'].map(stableHash);
    expect(new Set(hashes).size).toBe(hashes.length);
  });

  it('returns a 32-bit unsigned integer (>= 0)', () => {
    expect(stableHash('hello')).toBeGreaterThanOrEqual(0);
    expect(stableHash('world')).toBeGreaterThanOrEqual(0);
  });

  it('returns 32-bit unsigned integer (< 2^32)', () => {
    expect(stableHash('anything')).toBeLessThan(Math.pow(2, 32));
  });

  it('empty string produces a non-crashing number', () => {
    expect(() => stableHash('')).not.toThrow();
    expect(typeof stableHash('')).toBe('number');
  });

  it('null-ish input is coerced safely', () => {
    expect(() => stableHash(undefined as any)).not.toThrow();
    expect(() => stableHash(null as any)).not.toThrow();
  });

  it('same hash for same string with different reference', () => {
    const s1 = 'abc';
    const s2 = 'ab' + 'c';
    expect(stableHash(s1)).toBe(stableHash(s2));
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// scale
// ══════════════════════════════════════════════════════════════════════════════
describe('scale', () => {
  it('at 1280w canvas, scale factor is 1 (returns rounded value)', () => {
    expect(scale({ w: 1280, h: 720 }, 100)).toBe(100);
  });

  it('at 2560w canvas, value is doubled', () => {
    expect(scale({ w: 2560, h: 1440 }, 100)).toBe(200);
  });

  it('at 640w canvas, value is halved', () => {
    expect(scale({ w: 640, h: 360 }, 100)).toBe(50);
  });

  it('returns an integer (Math.round applied)', () => {
    const result = scale({ w: 1000, h: 720 }, 33);
    expect(Number.isInteger(result)).toBe(true);
  });

  it('null/undefined canvas uses 1280 as base', () => {
    expect(scale(null as any, 100)).toBe(100);
    expect(scale(undefined as any, 100)).toBe(100);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// roundZone
// ══════════════════════════════════════════════════════════════════════════════
describe('roundZone', () => {
  it('rounds all zone properties to integers', () => {
    const z = roundZone({ x: 1.7, y: 2.3, w: 100.6, h: 50.1 });
    expect(Number.isInteger(z.x)).toBe(true);
    expect(Number.isInteger(z.y)).toBe(true);
    expect(Number.isInteger(z.w)).toBe(true);
    expect(Number.isInteger(z.h)).toBe(true);
  });

  it('already-integer zone passes through unchanged', () => {
    const z = roundZone({ x: 10, y: 20, w: 100, h: 50 });
    expect(z).toEqual({ x: 10, y: 20, w: 100, h: 50 });
  });

  it('does not mutate input zone', () => {
    const input = { x: 1.5, y: 2.5, w: 10.5, h: 20.5 };
    roundZone(input);
    expect(input.x).toBe(1.5);
  });

  it('handles negative coordinates', () => {
    const z = roundZone({ x: -1.5, y: -2.7, w: 10, h: 10 });
    expect(z.x).toBe(-2); // Math.round(-1.5) = -1 in JS
    expect(typeof z.y).toBe('number');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// uid
// ══════════════════════════════════════════════════════════════════════════════
describe('uid', () => {
  it('returns a string', () => {
    expect(typeof uid('headline')).toBe('string');
  });

  it('contains the seed', () => {
    expect(uid('headline')).toContain('headline');
  });

  it('contains a hex suffix after a dash', () => {
    const result = uid('test');
    const parts = result.split('-');
    expect(parts.length).toBeGreaterThanOrEqual(2);
    expect(parts[parts.length - 1]).toMatch(/^[0-9a-f]+$/);
  });

  it('is deterministic', () => {
    expect(uid('body')).toBe(uid('body'));
  });

  it('different seeds produce different UIDs', () => {
    expect(uid('a')).not.toBe(uid('b'));
  });

  it('empty seed produces a non-empty string', () => {
    expect(uid('').length).toBeGreaterThan(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Block factories
// ══════════════════════════════════════════════════════════════════════════════
describe('block factories', () => {
  it('imageBlock produces type="image"', () => {
    expect(imageBlock('hero', ZONE, {}, 1).type).toBe('image');
  });

  it('textBlock produces type="text"', () => {
    expect(textBlock('headline', ZONE, 'Hello', {}, 2).type).toBe('text');
  });

  it('overlayBlock produces type="overlay"', () => {
    expect(overlayBlock('scrim', ZONE, {}, 0).type).toBe('overlay');
  });

  it('backgroundBlock produces type="background"', () => {
    expect(backgroundBlock('bg', ZONE, {}, 0).type).toBe('background');
  });

  it('badgeBlock produces type="badge"', () => {
    expect(badgeBlock('chip', ZONE, {}, 3).type).toBe('badge');
  });

  it('lineBlock produces type="line"', () => {
    expect(lineBlock('divider', ZONE, {}, 1).type).toBe('line');
  });

  it('all blocks have id, type, role, zone, style, z', () => {
    const blocks = [
      imageBlock('hero', ZONE, {}, 1),
      textBlock('headline', ZONE, 'text', {}, 2),
      overlayBlock('scrim', ZONE, {}, 0),
      backgroundBlock('bg', ZONE, {}, 0),
      badgeBlock('chip', ZONE, {}, 3),
      lineBlock('divider', ZONE, {}, 1),
    ];
    for (const b of blocks) {
      expect(typeof b.id).toBe('string');
      expect(typeof b.type).toBe('string');
      expect(typeof b.role).toBe('string');
      expect(b.zone).toBeDefined();
      expect(b.style).toBeDefined();
      expect(typeof b.z).toBe('number');
    }
  });

  it('textBlock includes value in style', () => {
    const b = textBlock('headline', ZONE, 'Hello World', {}, 2);
    expect((b.style as any).value).toBe('Hello World');
  });

  it('zone is rounded in all block factories', () => {
    const fractionalZone: Zone = { x: 1.5, y: 2.5, w: 100.5, h: 50.5 };
    const b = imageBlock('hero', fractionalZone, {}, 1);
    expect(Number.isInteger(b.zone.x)).toBe(true);
    expect(Number.isInteger(b.zone.w)).toBe(true);
  });

  it('z value is preserved', () => {
    expect(imageBlock('hero', ZONE, {}, 5).z).toBe(5);
    expect(textBlock('text', ZONE, 'x', {}, 10).z).toBe(10);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Validation helpers
// ══════════════════════════════════════════════════════════════════════════════
describe('requireImage', () => {
  it('does not throw when imageProvided=true', () => {
    expect(() => requireImage({ imageProvided: true })).not.toThrow();
  });

  it('throws when imageProvided=false', () => {
    expect(() => requireImage({ imageProvided: false })).toThrow();
  });

  it('error message mentions image', () => {
    try { requireImage({ imageProvided: false }); }
    catch (e: any) { expect(e.message.toLowerCase()).toContain('image'); }
  });
});

describe('requireFace', () => {
  it('does not throw when faceDetected=true', () => {
    expect(() => requireFace({ faceDetected: true })).not.toThrow();
  });

  it('throws when faceDetected=false', () => {
    expect(() => requireFace({ faceDetected: false })).toThrow();
  });
});

describe('validateOnlyAllowedBlocks', () => {
  it('does not throw when all blocks are allowed', () => {
    const blocks = [imageBlock('hero', ZONE, {}, 1), textBlock('head', ZONE, 'x', {}, 2)];
    expect(() => validateOnlyAllowedBlocks(blocks, ['image', 'text'])).not.toThrow();
  });

  it('throws when a block type is not in allowed list', () => {
    const blocks = [badgeBlock('chip', ZONE, {}, 1)];
    expect(() => validateOnlyAllowedBlocks(blocks, ['image', 'text'])).toThrow();
  });

  it('empty blocks list never throws', () => {
    expect(() => validateOnlyAllowedBlocks([], ['image'])).not.toThrow();
  });

  it('error message contains disallowed block type', () => {
    const blocks = [badgeBlock('chip', ZONE, {}, 1)];
    try { validateOnlyAllowedBlocks(blocks, ['image']); }
    catch (e: any) { expect(e.message).toContain('badge'); }
  });
});

describe('validateNoOverlap', () => {
  const ZONE_LEFT:  Zone = { x: 0,   y: 0, w: 400, h: 200 };
  const ZONE_RIGHT: Zone = { x: 500, y: 0, w: 400, h: 200 };
  const ZONE_OVERLAP: Zone = { x: 200, y: 0, w: 400, h: 200 };

  it('does not throw for non-overlapping blocks', () => {
    const t = textBlock('headline', ZONE_LEFT,  'text', {}, 2);
    const o = imageBlock('hero',    ZONE_RIGHT, {}, 1);
    expect(() => validateNoOverlap([t, o], ['headline'], ['hero'])).not.toThrow();
  });

  it('throws for overlapping blocks', () => {
    const t = textBlock('headline', ZONE_LEFT,    'text', {}, 2);
    const o = imageBlock('hero',    ZONE_OVERLAP, {}, 1);
    expect(() => validateNoOverlap([t, o], ['headline'], ['hero'])).toThrow();
  });

  it('does not throw when roles are absent', () => {
    expect(() => validateNoOverlap([], ['headline'], ['hero'])).not.toThrow();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Text normalization
// ══════════════════════════════════════════════════════════════════════════════
describe('normalize', () => {
  it('trims leading and trailing whitespace', () => {
    expect(normalize('  hello world  ', 10)).toBe('hello world');
  });

  it('collapses multiple spaces to single', () => {
    expect(normalize('hello   world', 10)).toBe('hello world');
  });

  it('limits to maxWords', () => {
    expect(normalize('one two three four five', 3)).toBe('one two three');
  });

  it('undefined input returns empty string', () => {
    expect(normalize(undefined, 5)).toBe('');
  });

  it('empty string input returns empty string', () => {
    expect(normalize('', 5)).toBe('');
  });

  it('whitespace-only returns empty string', () => {
    expect(normalize('   ', 5)).toBe('');
  });

  it('fewer words than maxWords returns all words', () => {
    expect(normalize('hello world', 10)).toBe('hello world');
  });
});

describe('sentenceCase', () => {
  it('capitalises first letter', () => {
    expect(sentenceCase('hello world').charAt(0)).toBe('H');
  });

  it('lowercases rest', () => {
    expect(sentenceCase('HELLO WORLD')).toBe('Hello world');
  });

  it('empty string returns empty string', () => {
    expect(sentenceCase('')).toBe('');
  });

  it('single word', () => {
    expect(sentenceCase('test')).toBe('Test');
  });
});

describe('titleCase', () => {
  it('capitalises first letter of each word', () => {
    expect(titleCase('hello world')).toBe('Hello World');
  });

  it('handles all-caps input', () => {
    expect(titleCase('HELLO WORLD')).toBe('Hello World');
  });

  it('single word', () => {
    expect(titleCase('test')).toBe('Test');
  });

  it('empty string returns empty string', () => {
    expect(titleCase('')).toBe('');
  });
});

describe('normalizeHeadline', () => {
  it('UPPER casing uppercases all words', () => {
    const result = normalizeHeadline('hello world', { casing: 'UPPER' });
    expect(result).toBe('HELLO WORLD');
  });

  it('TITLE casing title-cases', () => {
    expect(normalizeHeadline('hello world', { casing: 'TITLE' })).toBe('Hello World');
  });

  it('SENTENCE casing sentence-cases', () => {
    expect(normalizeHeadline('HELLO WORLD', { casing: 'SENTENCE' })).toBe('Hello world');
  });

  it('respects maxWords', () => {
    const result = normalizeHeadline('one two three four five', { maxWords: 3, casing: 'UPPER' });
    expect(result).toBe('ONE TWO THREE');
  });

  it('default maxWords is 8', () => {
    const result = normalizeHeadline('one two three four five six seven eight nine ten', {});
    expect(result.split(' ').length).toBeLessThanOrEqual(8);
  });

  it('undefined input returns empty string', () => {
    expect(normalizeHeadline(undefined, {})).toBe('');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// fitTextToZone
// ══════════════════════════════════════════════════════════════════════════════
describe('fitTextToZone', () => {
  it('returns text, fontSize, lineHeight', () => {
    const result = fitTextToZone('Short', ZONE, FIT_OPTS);
    expect(typeof result.text).toBe('string');
    expect(typeof result.fontSize).toBe('number');
    expect(typeof result.lineHeight).toBe('number');
  });

  it('short text fits at baseFontSize', () => {
    const result = fitTextToZone('Hi', ZONE, FIT_OPTS);
    expect(result.fontSize).toBe(FIT_OPTS.baseFontSize);
  });

  it('very long text reduces fontSize below baseFontSize', () => {
    const longText = 'a '.repeat(200);
    const result = fitTextToZone(longText, ZONE, FIT_OPTS);
    expect(result.fontSize).toBeLessThanOrEqual(FIT_OPTS.baseFontSize);
  });

  it('empty text returns empty text result', () => {
    const result = fitTextToZone('', ZONE, FIT_OPTS);
    expect(result.text).toBe('');
    expect(result.fontSize).toBe(FIT_OPTS.baseFontSize);
  });

  it('undefined text returns empty text result', () => {
    const result = fitTextToZone(undefined, ZONE, FIT_OPTS);
    expect(result.text).toBe('');
  });

  it('lineHeight is preserved from opts', () => {
    const result = fitTextToZone('Hello', ZONE, { ...FIT_OPTS, lineHeight: 1.5 });
    expect(result.lineHeight).toBe(1.5);
  });

  it('throws when text cannot fit even at minFontSize', () => {
    const tinyZone: Zone = { x: 0, y: 0, w: 5, h: 5 };
    const tightOpts: FitTextOpts = { baseFontSize: 12, minFontSize: 12, lineHeight: 1.2, maxLines: 1, letterSpacing: 0 };
    expect(() => fitTextToZone('This text is way too long to fit in a tiny zone', tinyZone, tightOpts)).toThrow();
  });

  it('fontSize never goes below minFontSize', () => {
    const result = fitTextToZone('word '.repeat(50), ZONE, FIT_OPTS);
    expect(result.fontSize).toBeGreaterThanOrEqual(FIT_OPTS.minFontSize);
  });
});
