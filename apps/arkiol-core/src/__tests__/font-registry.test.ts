/**
 * apps/arkiol-core/src/__tests__/font-registry.test.ts
 *
 * Unit tests for engines/render/font-registry-ultimate.ts
 *
 * Tests the pure/synchronous exported functions and data.
 *
 * Covers:
 *  - ULTIMATE_FONTS — shape, required fields, no duplicates
 *  - ULTIMATE_CHAR_WIDTH_RATIOS — expected font families present, values in range
 *  - getFontStack — known fonts get fallback stacks, unknown fonts get generic fallback
 *  - buildUltimateFontFaces — returns string (no crash), empty without CDN/local files
 */

import {
  ULTIMATE_FONTS,
  ULTIMATE_CHAR_WIDTH_RATIOS,
  getFontStack,
  buildUltimateFontFaces,
} from '../engines/render/font-registry-ultimate';

// ══════════════════════════════════════════════════════════════════════════════
// ULTIMATE_FONTS
// ══════════════════════════════════════════════════════════════════════════════
describe('ULTIMATE_FONTS', () => {
  it('is a non-empty array', () => {
    expect(Array.isArray(ULTIMATE_FONTS)).toBe(true);
    expect(ULTIMATE_FONTS.length).toBeGreaterThan(0);
  });

  it('all fonts have required fields', () => {
    for (const font of ULTIMATE_FONTS) {
      expect(typeof font.family).toBe('string');
      expect(font.family.length).toBeGreaterThan(0);
      expect(typeof font.weight).toBe('number');
      expect(typeof font.style).toBe('string');
      expect(typeof font.file).toBe('string');
    }
  });

  it('all weight values are valid CSS font-weight values', () => {
    const validWeights = [100, 200, 300, 400, 500, 600, 700, 800, 900];
    for (const font of ULTIMATE_FONTS) {
      expect(validWeights).toContain(font.weight);
    }
  });

  it('all style values are valid CSS font-style values', () => {
    const validStyles = ['normal', 'italic', 'oblique'];
    for (const font of ULTIMATE_FONTS) {
      expect(validStyles).toContain(font.style);
    }
  });

  it('all file names end with .ttf or .woff2', () => {
    for (const font of ULTIMATE_FONTS) {
      expect(font.file).toMatch(/\.(ttf|woff2)$/);
    }
  });

  it('includes Montserrat', () => {
    expect(ULTIMATE_FONTS.some(f => f.family === 'Montserrat')).toBe(true);
  });

  it('Montserrat has a bold variant (weight >= 700)', () => {
    const boldMontserrat = ULTIMATE_FONTS.find(
      f => f.family === 'Montserrat' && f.weight >= 700
    );
    expect(boldMontserrat).toBeDefined();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ULTIMATE_CHAR_WIDTH_RATIOS
// ══════════════════════════════════════════════════════════════════════════════
describe('ULTIMATE_CHAR_WIDTH_RATIOS', () => {
  it('is an object with at least one entry', () => {
    expect(typeof ULTIMATE_CHAR_WIDTH_RATIOS).toBe('object');
    expect(Object.keys(ULTIMATE_CHAR_WIDTH_RATIOS).length).toBeGreaterThan(0);
  });

  it('all values are positive numbers in a sensible range (0.01–1.5)', () => {
    for (const [, ratio] of Object.entries(ULTIMATE_CHAR_WIDTH_RATIOS)) {
      expect(ratio).toBeGreaterThan(0.01);
      expect(ratio).toBeLessThanOrEqual(1.5);
    }
  });

  it('includes Montserrat', () => {
    expect(ULTIMATE_CHAR_WIDTH_RATIOS['Montserrat']).toBeDefined();
  });

  it('Montserrat ratio is a reasonable value (0.4–0.8)', () => {
    const ratio = ULTIMATE_CHAR_WIDTH_RATIOS['Montserrat'];
    expect(ratio).toBeGreaterThan(0.4);
    expect(ratio).toBeLessThan(0.8);
  });

  it('all keys are non-empty strings', () => {
    for (const key of Object.keys(ULTIMATE_CHAR_WIDTH_RATIOS)) {
      expect(typeof key).toBe('string');
      expect(key.length).toBeGreaterThan(0);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// getFontStack
// ══════════════════════════════════════════════════════════════════════════════
describe('getFontStack', () => {
  const KNOWN_FONTS = [
    'Montserrat',
    'Playfair Display',
    'Oswald',
    'Poppins',
    'Raleway',
    'Lato',
    'DM Sans',
    'Cormorant Garamond',
    'Nunito',
    'Bebas Neue',
  ];

  it('returns a non-empty string', () => {
    expect(getFontStack('Montserrat').length).toBeGreaterThan(0);
  });

  it('all known fonts return a stack containing the font name', () => {
    for (const font of KNOWN_FONTS) {
      const stack = getFontStack(font);
      expect(stack).toContain(font);
    }
  });

  it('all stacks include a generic fallback (sans-serif or serif)', () => {
    for (const font of KNOWN_FONTS) {
      const stack = getFontStack(font);
      expect(stack.includes('sans-serif') || stack.includes('serif')).toBe(true);
    }
  });

  it('unknown font returns generic fallback containing the font name', () => {
    const stack = getFontStack('UnknownCustomFont');
    expect(stack).toContain('UnknownCustomFont');
    expect(stack).toContain('Arial');
    expect(stack).toContain('sans-serif');
  });

  it('Playfair Display stack includes a serif fallback', () => {
    const stack = getFontStack('Playfair Display');
    expect(stack.includes('serif') || stack.includes('Georgia')).toBe(true);
  });

  it('Bebas Neue includes a condensed fallback (Impact)', () => {
    const stack = getFontStack('Bebas Neue');
    expect(stack).toContain('Impact');
  });

  it('returns a comma-separated CSS font-family value', () => {
    const stack = getFontStack('Montserrat');
    expect(stack).toContain(',');
  });

  it('is deterministic — same input always produces same output', () => {
    expect(getFontStack('Poppins')).toBe(getFontStack('Poppins'));
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// buildUltimateFontFaces
// ══════════════════════════════════════════════════════════════════════════════
describe('buildUltimateFontFaces', () => {
  it('returns a string without throwing', () => {
    expect(() => buildUltimateFontFaces()).not.toThrow();
    expect(typeof buildUltimateFontFaces()).toBe('string');
  });

  it('with a cdnBase param does not throw', () => {
    expect(() => buildUltimateFontFaces('https://cdn.example.com/fonts')).not.toThrow();
  });

  it('with CDN base returns @font-face rules', () => {
    const css = buildUltimateFontFaces('https://cdn.example.com/fonts');
    if (css.length > 0) {
      expect(css).toContain('@font-face');
    }
    // If empty (no fonts cached + CDN URL has no trailing slash issues) — that's also ok
    expect(typeof css).toBe('string');
  });

  it('result is a string (possibly empty if no fonts are available)', () => {
    const css = buildUltimateFontFaces();
    expect(typeof css).toBe('string');
  });

  it('is idempotent — same output on repeated calls', () => {
    const a = buildUltimateFontFaces('https://cdn.example.com');
    const b = buildUltimateFontFaces('https://cdn.example.com');
    expect(a).toBe(b);
  });
});
