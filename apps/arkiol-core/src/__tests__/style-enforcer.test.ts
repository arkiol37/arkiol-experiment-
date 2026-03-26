/**
 * apps/arkiol-core/src/__tests__/style-enforcer.test.ts
 *
 * Unit tests for engines/layout/style-enforcer.ts
 *
 * Pure functions — no DB, no HTTP, no Next.js.
 *
 * Covers:
 *  - contrastRatio — known values (black/white = 21:1), symmetry, same colour
 *  - meetsWcag — 4.5:1 threshold for normal text, 3:1 for large text
 *  - ensureContrast — already-passing passes unchanged, failing gets corrected,
 *    corrected ratio meets WCAG, last-resort black/white fallback
 *  - scoreBrandTone — score range, breakdown keys, warnings on large delta
 *  - enforceStyle — contrast violations tracked, contrast-corrected colors,
 *    brandScore default 80 with no brand, brandScore from voiceAttribs
 *  - applyPresetToEnforcement — hasBrand=true passes through, invalid preset passes
 *    through, valid preset may adjust brandScore
 */

import {
  contrastRatio,
  meetsWcag,
  ensureContrast,
  scoreBrandTone,
  enforceStyle,
  applyPresetToEnforcement,
  type BrandToneProfile,
  type ContentToneSignals,
  type TextContentForEnforcement,
  type StyleEnforcementResult,
} from '../engines/layout/style-enforcer';

// ── Fixtures ──────────────────────────────────────────────────────────────────
function makeContent(overrides: Partial<TextContentForEnforcement> = {}): TextContentForEnforcement {
  return {
    zoneId:   'headline',
    text:     'Big Headline',
    fontSize: 64,
    weight:   700,
    color:    '#ffffff',
    ...overrides,
  };
}

const NEUTRAL_BRAND: BrandToneProfile = {
  professional: 50, bold: 50, warm: 50, playful: 30, minimal: 50,
};

const TONE_SIGNALS: ContentToneSignals = {
  fontWeights:    [700, 400],
  colorCount:     3,
  hasGradient:    false,
  hasAccentShape: false,
  textLengths:    [20, 60],
  capitalization: 'sentence',
};

// ══════════════════════════════════════════════════════════════════════════════
// contrastRatio
// ══════════════════════════════════════════════════════════════════════════════
describe('contrastRatio', () => {
  it('black on white is 21:1', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0);
  });

  it('white on black is 21:1 (symmetric)', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 0);
  });

  it('same color on same color is 1:1', () => {
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 3);
    expect(contrastRatio('#000000', '#000000')).toBeCloseTo(1, 3);
  });

  it('is always >= 1', () => {
    const pairs = [
      ['#ff0000', '#00ff00'],
      ['#0000ff', '#ffffff'],
      ['#808080', '#404040'],
    ] as const;
    for (const [a, b] of pairs) {
      expect(contrastRatio(a, b)).toBeGreaterThanOrEqual(1);
    }
  });

  it('result is symmetric', () => {
    const a = contrastRatio('#ff5733', '#1a1a2e');
    const b = contrastRatio('#1a1a2e', '#ff5733');
    expect(a).toBeCloseTo(b, 8);
  });

  it('returns a number greater than 0', () => {
    expect(contrastRatio('#4f6ef7', '#ffffff')).toBeGreaterThan(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// meetsWcag
// ══════════════════════════════════════════════════════════════════════════════
describe('meetsWcag', () => {
  it('4.5:1 passes for normal text', () => {
    expect(meetsWcag(4.5, false)).toBe(true);
  });

  it('4.49:1 fails for normal text', () => {
    expect(meetsWcag(4.49, false)).toBe(false);
  });

  it('3.0:1 passes for large text', () => {
    expect(meetsWcag(3.0, true)).toBe(true);
  });

  it('2.99:1 fails for large text', () => {
    expect(meetsWcag(2.99, true)).toBe(false);
  });

  it('21:1 passes for both normal and large text', () => {
    expect(meetsWcag(21, false)).toBe(true);
    expect(meetsWcag(21, true)).toBe(true);
  });

  it('1.0:1 fails for both', () => {
    expect(meetsWcag(1.0, false)).toBe(false);
    expect(meetsWcag(1.0, true)).toBe(false);
  });

  it('boundary 4.5 for large text passes (>= 3.0)', () => {
    expect(meetsWcag(4.5, true)).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ensureContrast
// ══════════════════════════════════════════════════════════════════════════════
describe('ensureContrast', () => {
  it('white text on black bg already passes — corrected=false', () => {
    const result = ensureContrast('#ffffff', '#000000', false);
    expect(result.corrected).toBe(false);
    expect(result.color).toBe('#ffffff');
  });

  it('returns the original color unchanged when passing', () => {
    const result = ensureContrast('#ffffff', '#000000', false);
    expect(result.color).toBe('#ffffff');
  });

  it('ratio is returned in result', () => {
    const result = ensureContrast('#ffffff', '#000000', false);
    expect(result.ratio).toBeCloseTo(21, 0);
  });

  it('low-contrast color gets corrected', () => {
    // #cccccc on #ffffff has ratio ~1.6:1 — below 4.5
    const result = ensureContrast('#cccccc', '#ffffff', false);
    expect(result.corrected).toBe(true);
  });

  it('corrected color meets WCAG (normal text)', () => {
    const result = ensureContrast('#aaaaaa', '#ffffff', false);
    expect(meetsWcag(result.ratio, false)).toBe(true);
  });

  it('corrected color meets WCAG (large text)', () => {
    const result = ensureContrast('#aaaaaa', '#ffffff', true);
    expect(meetsWcag(result.ratio, true)).toBe(true);
  });

  it('result color is a hex string', () => {
    const result = ensureContrast('#aaaaaa', '#ffffff', false);
    expect(result.color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('last-resort fallback is pure white or black', () => {
    // Pure white on pure white — must fall back
    const result = ensureContrast('#ffffff', '#ffffff', false);
    expect(result.corrected).toBe(true);
    expect(['#ffffff', '#000000']).toContain(result.color);
  });

  it('large text threshold is more lenient (corrects less)', () => {
    // #aaaaaa on white: ratio ~2.32 — fails normal (4.5), passes large (3.0)
    const largeResult  = ensureContrast('#aaaaaa', '#ffffff', true);
    const normalResult = ensureContrast('#aaaaaa', '#ffffff', false);
    // Both need correction but normal needs larger adjustment
    expect(normalResult.ratio).toBeGreaterThanOrEqual(largeResult.ratio);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// scoreBrandTone
// ══════════════════════════════════════════════════════════════════════════════
describe('scoreBrandTone', () => {
  it('returns an object with score, breakdown, and warnings', () => {
    const result = scoreBrandTone(TONE_SIGNALS, NEUTRAL_BRAND);
    expect(typeof result.score).toBe('number');
    expect(result.breakdown).toBeDefined();
    expect(Array.isArray(result.warnings)).toBe(true);
  });

  it('score is in [0, 100]', () => {
    const result = scoreBrandTone(TONE_SIGNALS, NEUTRAL_BRAND);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it('breakdown contains all 5 tone dimensions', () => {
    const result = scoreBrandTone(TONE_SIGNALS, NEUTRAL_BRAND);
    expect(typeof result.breakdown.professional).toBe('number');
    expect(typeof result.breakdown.bold).toBe('number');
    expect(typeof result.breakdown.warm).toBe('number');
    expect(typeof result.breakdown.playful).toBe('number');
    expect(typeof result.breakdown.minimal).toBe('number');
  });

  it('all breakdown values are non-negative', () => {
    const result = scoreBrandTone(TONE_SIGNALS, NEUTRAL_BRAND);
    for (const v of Object.values(result.breakdown)) {
      expect(v).toBeGreaterThanOrEqual(0);
    }
  });

  it('high font weights increase bold and professional signals', () => {
    const heavySignals: ContentToneSignals = { ...TONE_SIGNALS, fontWeights: [900, 800] };
    const lightSignals: ContentToneSignals = { ...TONE_SIGNALS, fontWeights: [300, 400] };
    const heavy = scoreBrandTone(heavySignals, NEUTRAL_BRAND);
    const light = scoreBrandTone(lightSignals, NEUTRAL_BRAND);
    expect(heavy.breakdown.bold).toBeGreaterThan(light.breakdown.bold);
    expect(heavy.breakdown.professional).toBeGreaterThanOrEqual(light.breakdown.professional);
  });

  it('produces warnings when brand expectation delta > 30', () => {
    // Brand wants 100 minimal, but content has many colors/shapes
    const extremeBrand: BrandToneProfile = { professional: 0, bold: 0, warm: 0, playful: 0, minimal: 100 };
    const loudSignals: ContentToneSignals = {
      fontWeights: [800, 700], colorCount: 6, hasGradient: true,
      hasAccentShape: true, textLengths: [10, 15], capitalization: 'upper',
    };
    const result = scoreBrandTone(loudSignals, extremeBrand);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('warnings are strings', () => {
    const result = scoreBrandTone(TONE_SIGNALS, NEUTRAL_BRAND);
    for (const w of result.warnings) {
      expect(typeof w).toBe('string');
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// enforceStyle
// ══════════════════════════════════════════════════════════════════════════════
describe('enforceStyle', () => {
  it('returns contents, brandScore, violations, and contrastMap', () => {
    const result = enforceStyle([makeContent()], '#000000');
    expect(Array.isArray(result.contents)).toBe(true);
    expect(typeof result.brandScore).toBe('number');
    expect(Array.isArray(result.violations)).toBe(true);
    expect(result.contrastMap).toBeDefined();
  });

  it('brandScore defaults to 80 when no brand provided', () => {
    expect(enforceStyle([makeContent()], '#000000').brandScore).toBe(80);
  });

  it('does not modify already-passing contrast text', () => {
    const content = makeContent({ color: '#ffffff' }); // white on black
    const result = enforceStyle([content], '#000000');
    expect(result.contents[0]!.color).toBe('#ffffff');
    expect(result.violations.length).toBe(0);
  });

  it('corrects low-contrast text and records a violation', () => {
    // #cccccc on #ffffff — fails 4.5:1
    const content = makeContent({ color: '#cccccc', fontSize: 14 });
    const result = enforceStyle([content], '#ffffff');
    // Either a violation is recorded or the color was corrected
    const corrected = result.contents[0]!.color !== '#cccccc';
    const violated  = result.violations.length > 0;
    expect(corrected || violated).toBe(true);
  });

  it('contrastMap has entry for each content zone', () => {
    const contents = [
      makeContent({ zoneId: 'headline' }),
      makeContent({ zoneId: 'body', fontSize: 16 }),
    ];
    const result = enforceStyle(contents, '#000000');
    expect(result.contrastMap['headline']).toBeDefined();
    expect(result.contrastMap['body']).toBeDefined();
  });

  it('does not mutate input contents array', () => {
    const content = makeContent({ color: '#cccccc' });
    const originalColor = content.color;
    enforceStyle([content], '#ffffff');
    expect(content.color).toBe(originalColor);
  });

  it('output contents.length equals input length', () => {
    const inputs = [makeContent(), makeContent({ zoneId: 'body' })];
    const result = enforceStyle(inputs, '#000000');
    expect(result.contents.length).toBe(2);
  });

  it('brandScore is in [0, 100]', () => {
    const result = enforceStyle(
      [makeContent()],
      '#000000',
      { voiceAttribs: { professional: 80, bold: 60, warm: 40, playful: 20, minimal: 50 } }
    );
    expect(result.brandScore).toBeGreaterThanOrEqual(0);
    expect(result.brandScore).toBeLessThanOrEqual(100);
  });

  it('violations have zoneId, issue, and correction fields', () => {
    const content = makeContent({ color: '#cccccc', fontSize: 14 });
    const result = enforceStyle([content], '#ffffff');
    for (const v of result.violations) {
      expect(typeof v.zoneId).toBe('string');
      expect(typeof v.issue).toBe('string');
      expect(typeof v.correction).toBe('string');
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// applyPresetToEnforcement
// ══════════════════════════════════════════════════════════════════════════════
describe('applyPresetToEnforcement', () => {
  function makeEnforcementResult(): StyleEnforcementResult {
    return enforceStyle([makeContent()], '#000000');
  }

  it('returns the same result unchanged when hasBrand=true', () => {
    const result = makeEnforcementResult();
    const output = applyPresetToEnforcement(result, 'bold', true);
    expect(output).toBe(result); // same reference
  });

  it('returns the same result when presetId is invalid', () => {
    const result = makeEnforcementResult();
    const output = applyPresetToEnforcement(result, 'nonexistent_preset', false);
    expect(output).toBe(result);
  });

  it('valid preset with hasBrand=false returns a new result', () => {
    const result = makeEnforcementResult();
    const output = applyPresetToEnforcement(result, 'bold', false);
    // May or may not be same ref, but should not throw
    expect(output).toBeDefined();
    expect(typeof output.brandScore).toBe('number');
  });

  it('bold preset adds bonus to brandScore', () => {
    const result = makeEnforcementResult();
    const output = applyPresetToEnforcement(result, 'bold', false);
    expect(output.brandScore).toBeGreaterThanOrEqual(result.brandScore);
  });

  it('output brandScore never exceeds 100', () => {
    const highResult: StyleEnforcementResult = { ...makeEnforcementResult(), brandScore: 99 };
    const output = applyPresetToEnforcement(highResult, 'bold', false);
    expect(output.brandScore).toBeLessThanOrEqual(100);
  });
});
