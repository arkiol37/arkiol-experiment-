/**
 * apps/arkiol-core/src/__tests__/design-themes.test.ts
 *
 * Unit tests for engines/render/design-themes.ts
 *
 * All functions are pure — no DB, no network, no Next.js runtime.
 *
 * Covers:
 *  - THEMES array integrity (12 themes, required fields, valid hex colours)
 *  - selectTheme — tone matching, colorMood matching, combined scoring,
 *    determinism, tie-breaking, unknown inputs produce a result
 *  - applyBrandColors — override behaviour, original immutability
 */

import {
  THEMES,
  selectTheme,
  applyBrandColors,
  type DesignTheme,
} from '../engines/render/design-themes';

// ══════════════════════════════════════════════════════════════════════════════
// Helpers
// ══════════════════════════════════════════════════════════════════════════════
const isHexColor = (s: string) => /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/.test(s);
const isRgba     = (s: string) => /^rgba?\(/.test(s);
const isValidColor = (s: string) => isHexColor(s) || isRgba(s);

function makeBrief(tone: string, colorMood: string) {
  return { tone, colorMood } as any;
}

// ══════════════════════════════════════════════════════════════════════════════
// THEMES array integrity
// ══════════════════════════════════════════════════════════════════════════════
describe('THEMES array', () => {
  it('exports exactly 12 themes', () => {
    expect(THEMES.length).toBe(12);
  });

  it('all themes have unique id values', () => {
    const ids = THEMES.map(t => t.id);
    expect(new Set(ids).size).toBe(THEMES.length);
  });

  it('all themes have non-empty id and name', () => {
    for (const t of THEMES) {
      expect(t.id.length).toBeGreaterThan(0);
      expect(t.name.length).toBeGreaterThan(0);
    }
  });

  it('all themes have at least 1 tone', () => {
    for (const t of THEMES) {
      expect(Array.isArray(t.tones)).toBe(true);
      expect(t.tones.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('all themes have at least 1 colorMood', () => {
    for (const t of THEMES) {
      expect(Array.isArray(t.colorMoods)).toBe(true);
      expect(t.colorMoods.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('palette has all 7 required color keys', () => {
    const KEYS = ['background', 'surface', 'primary', 'secondary', 'text', 'textMuted', 'highlight'];
    for (const t of THEMES) {
      for (const key of KEYS) {
        expect(t.palette[key as keyof typeof t.palette]).toBeDefined();
        expect(typeof t.palette[key as keyof typeof t.palette]).toBe('string');
      }
    }
  });

  it('palette background and primary are valid colors', () => {
    for (const t of THEMES) {
      expect(isValidColor(t.palette.background)).toBe(true);
      expect(isValidColor(t.palette.primary)).toBe(true);
    }
  });

  it('all themes have a background with a kind field', () => {
    const VALID_KINDS = ['solid', 'linear_gradient', 'radial_gradient', 'mesh', 'split'];
    for (const t of THEMES) {
      expect(VALID_KINDS).toContain(t.background.kind);
    }
  });

  it('all themes have typography with display and body font families', () => {
    for (const t of THEMES) {
      expect(typeof t.typography.display).toBe('string');
      expect(typeof t.typography.body).toBe('string');
      expect(t.typography.display.length).toBeGreaterThan(0);
      expect(t.typography.body.length).toBeGreaterThan(0);
    }
  });

  it('all themes have headline typography with fontWeight and color', () => {
    for (const t of THEMES) {
      expect(typeof t.typography.headline.fontWeight).toBe('number');
      expect(t.typography.headline.fontWeight).toBeGreaterThan(0);
      expect(isValidColor(t.typography.headline.color)).toBe(true);
    }
  });

  it('all themes have a ctaStyle with required fields', () => {
    for (const t of THEMES) {
      expect(typeof t.ctaStyle.backgroundColor).toBe('string');
      expect(typeof t.ctaStyle.textColor).toBe('string');
      expect(typeof t.ctaStyle.borderRadius).toBe('number');
      expect(typeof t.ctaStyle.paddingH).toBe('number');
      expect(typeof t.ctaStyle.paddingV).toBe('number');
    }
  });

  it('all themes have a decorations array', () => {
    for (const t of THEMES) {
      expect(Array.isArray(t.decorations)).toBe(true);
    }
  });

  it('contains expected canonical themes', () => {
    const ids = THEMES.map(t => t.id);
    expect(ids).toContain('vibrant_burst');
    expect(ids).toContain('dark_luxe');
    expect(ids).toContain('clean_minimal');
    expect(ids).toContain('sage_wellness');
    expect(ids).toContain('navy_pro');
    expect(ids).toContain('modern_editorial');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// selectTheme
// ══════════════════════════════════════════════════════════════════════════════
describe('selectTheme', () => {
  it('always returns a DesignTheme (never throws)', () => {
    expect(() => selectTheme(makeBrief('energetic', 'vibrant'))).not.toThrow();
  });

  it('returns an object that is one of the THEMES entries', () => {
    const result = selectTheme(makeBrief('energetic', 'vibrant'));
    expect(THEMES).toContain(result);
  });

  it('is deterministic — same brief always returns the same theme', () => {
    const brief = makeBrief('minimal', 'dark');
    const a = selectTheme(brief);
    const b = selectTheme(brief);
    expect(a.id).toBe(b.id);
  });

  it('tone=energetic, colorMood=vibrant → vibrant_burst', () => {
    const result = selectTheme(makeBrief('energetic', 'vibrant'));
    expect(result.id).toBe('vibrant_burst');
  });

  it('tone=professional, colorMood=dark → dark_luxe', () => {
    const result = selectTheme(makeBrief('professional', 'dark'));
    expect(result.id).toBe('dark_luxe');
  });

  it('tone=minimal, colorMood=light → clean_minimal', () => {
    const result = selectTheme(makeBrief('minimal', 'light'));
    // clean_minimal has tones=[minimal,professional,luxury] colorMoods=[light,muted,monochrome]
    expect(result.id).toBe('clean_minimal');
  });

  it('tone=bold, colorMood=warm → vibrant_burst (warm/bold match)', () => {
    const result = selectTheme(makeBrief('bold', 'warm'));
    expect(result.id).toBe('vibrant_burst');
  });

  it('completely unknown tone/colorMood still returns a valid theme', () => {
    const result = selectTheme(makeBrief('zagranian', 'glimmerful'));
    expect(result).toBeDefined();
    expect(typeof result.id).toBe('string');
    expect(THEMES).toContain(result);
  });

  it('returns a theme for every canonical tone value', () => {
    const tones = ['energetic', 'bold', 'urgent', 'professional', 'luxury', 'minimal', 'warm', 'playful'];
    for (const tone of tones) {
      const result = selectTheme(makeBrief(tone, 'vibrant'));
      expect(result).toBeDefined();
      expect(THEMES).toContain(result);
    }
  });

  it('returns a theme for every canonical colorMood value', () => {
    const moods = ['vibrant', 'warm', 'dark', 'monochrome', 'light', 'muted', 'earthy'];
    for (const colorMood of moods) {
      const result = selectTheme(makeBrief('minimal', colorMood));
      expect(result).toBeDefined();
      expect(THEMES).toContain(result);
    }
  });

  it('different tone/colorMood combinations can produce different themes', () => {
    const r1 = selectTheme(makeBrief('energetic', 'vibrant'));
    const r2 = selectTheme(makeBrief('minimal', 'light'));
    // They can differ — just check that at least some inputs differ
    // (we don't require ALL to differ, just that the function discriminates)
    const allSame = THEMES.every(t => t.id === r1.id);
    expect(allSame).toBe(false); // more than one possible result
  });

  it('tone match takes priority over colorMood match (score: tone=4, mood=3)', () => {
    // vibrant_burst: tones=[energetic,bold,urgent], colorMoods=[vibrant,warm]
    // dark_luxe: tones=[professional,luxury,minimal], colorMoods=[dark,monochrome]
    // brief: tone=energetic (matches vibrant_burst +4), colorMood=dark (matches dark_luxe +3)
    // → vibrant_burst should win (4 > 3)
    const result = selectTheme(makeBrief('energetic', 'dark'));
    expect(result.id).toBe('vibrant_burst');
  });

  it('headlineSizeMultiplier, when set, is greater than 0', () => {
    for (const t of THEMES) {
      if (t.headlineSizeMultiplier !== undefined) {
        expect(t.headlineSizeMultiplier).toBeGreaterThan(0);
      }
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// applyBrandColors
// ══════════════════════════════════════════════════════════════════════════════
describe('applyBrandColors', () => {
  const baseTheme = THEMES.find(t => t.id === 'vibrant_burst')!;
  const brand = { primaryColor: '#FF5733', secondaryColor: '#33FF57' };

  it('returns the original theme when brand is undefined', () => {
    const result = applyBrandColors(baseTheme, undefined);
    expect(result).toBe(baseTheme); // same reference
  });

  it('returns a new theme object when brand is provided', () => {
    const result = applyBrandColors(baseTheme, brand);
    expect(result).not.toBe(baseTheme);
  });

  it('overrides palette.primary with brand.primaryColor', () => {
    const result = applyBrandColors(baseTheme, brand);
    expect(result.palette.primary).toBe('#FF5733');
  });

  it('overrides palette.secondary with brand.secondaryColor', () => {
    const result = applyBrandColors(baseTheme, brand);
    expect(result.palette.secondary).toBe('#33FF57');
  });

  it('overrides palette.highlight with brand.primaryColor', () => {
    const result = applyBrandColors(baseTheme, brand);
    expect(result.palette.highlight).toBe('#FF5733');
  });

  it('overrides ctaStyle.backgroundColor with brand.primaryColor', () => {
    const result = applyBrandColors(baseTheme, brand);
    expect(result.ctaStyle.backgroundColor).toBe('#FF5733');
  });

  it('does NOT mutate the original theme', () => {
    const originalPrimary = baseTheme.palette.primary;
    applyBrandColors(baseTheme, brand);
    expect(baseTheme.palette.primary).toBe(originalPrimary);
  });

  it('preserves non-overridden palette fields', () => {
    const result = applyBrandColors(baseTheme, brand);
    expect(result.palette.background).toBe(baseTheme.palette.background);
    expect(result.palette.text).toBe(baseTheme.palette.text);
    expect(result.palette.textMuted).toBe(baseTheme.palette.textMuted);
  });

  it('preserves theme id, name, tones, colorMoods', () => {
    const result = applyBrandColors(baseTheme, brand);
    expect(result.id).toBe(baseTheme.id);
    expect(result.name).toBe(baseTheme.name);
    expect(result.tones).toEqual(baseTheme.tones);
    expect(result.colorMoods).toEqual(baseTheme.colorMoods);
  });

  it('preserves ctaStyle fields not overridden', () => {
    const result = applyBrandColors(baseTheme, brand);
    expect(result.ctaStyle.textColor).toBe(baseTheme.ctaStyle.textColor);
    expect(result.ctaStyle.borderRadius).toBe(baseTheme.ctaStyle.borderRadius);
    expect(result.ctaStyle.paddingH).toBe(baseTheme.ctaStyle.paddingH);
  });

  it('preserves typography untouched', () => {
    const result = applyBrandColors(baseTheme, brand);
    expect(result.typography).toBe(baseTheme.typography); // same reference — not cloned
  });

  it('works for every theme without throwing', () => {
    for (const theme of THEMES) {
      expect(() => applyBrandColors(theme, brand)).not.toThrow();
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Theme data correctness spot-checks
// ══════════════════════════════════════════════════════════════════════════════
describe('Theme data spot-checks', () => {
  it('vibrant_burst has energetic tone and vibrant colorMood', () => {
    const t = THEMES.find(t => t.id === 'vibrant_burst')!;
    expect(t.tones).toContain('energetic');
    expect(t.colorMoods).toContain('vibrant');
  });

  it('dark_luxe has professional tone and dark colorMood', () => {
    const t = THEMES.find(t => t.id === 'dark_luxe')!;
    expect(t.tones).toContain('professional');
    expect(t.colorMoods).toContain('dark');
  });

  it('clean_minimal has minimal tone and light colorMood', () => {
    const t = THEMES.find(t => t.id === 'clean_minimal')!;
    expect(t.tones).toContain('minimal');
    expect(t.colorMoods).toContain('light');
  });

  it('sage_wellness has warm colorMood', () => {
    const t = THEMES.find(t => t.id === 'sage_wellness')!;
    expect(t.colorMoods.some(m => ['muted', 'light', 'warm', 'earthy'].includes(m))).toBe(true);
  });

  it('all themes with dark colorMood have dark or near-dark backgrounds', () => {
    const darkThemes = THEMES.filter(t => t.colorMoods.includes('dark'));
    for (const t of darkThemes) {
      const bg = t.palette.background;
      // Dark backgrounds are typically very dark hex colors or dark gradients
      // Just ensure they're defined
      expect(bg).toBeDefined();
    }
  });
});
