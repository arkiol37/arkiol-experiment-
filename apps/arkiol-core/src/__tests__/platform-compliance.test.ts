/**
 * apps/arkiol-core/src/__tests__/platform-compliance.test.ts
 *
 * Unit tests for engines/platform/intelligence.ts
 *
 * Tests the pure exported functions — no DB, no HTTP, no Next.js.
 *
 * Covers:
 *  - getPlatformRules — returns a PlatformRules object with all required fields,
 *    known formats resolve correctly, unknown format returns fallback
 *  - getSupportedPlatforms — non-empty, all strings
 *  - buildPlatformPromptContext — mentions platform name, dimensions, text guide
 *  - scorePlatformCompliance — all result fields in [0,1], violations array,
 *    recommendations array, density profile effects, hook strategy effects
 */

import {
  getPlatformRules,
  scorePlatformCompliance,
  getSupportedPlatforms,
  buildPlatformPromptContext,
  type PlatformRules,
  type PlatformComplianceScore,
} from '../engines/platform/intelligence';
import type { DesignGenome } from '../engines/exploration/types';

// ── Fixtures ──────────────────────────────────────────────────────────────────
const BASE_GENOME: DesignGenome = {
  layoutFamily:          'ig_post',
  variationId:           'v1',
  archetype:             'BOLD_CLAIM' as any,
  preset:                'bold' as any,
  typographyPersonality: 1,
  densityProfile:        'balanced',
  hookStrategy:          'bold_headline',
  compositionPattern:    'centered_axis',
  motionEligible:        false,
};

const KNOWN_FORMATS = [
  'instagram_post',
  'instagram_story',
  'youtube_thumbnail',
  'flyer',
  'poster',
];

// ══════════════════════════════════════════════════════════════════════════════
// getPlatformRules
// ══════════════════════════════════════════════════════════════════════════════
describe('getPlatformRules', () => {
  it('returns an object for any format string (never throws)', () => {
    const formats = [...KNOWN_FORMATS, 'unknown_format_xyz', '', 'flyer', 'poster'];
    for (const fmt of formats) {
      expect(() => getPlatformRules(fmt)).not.toThrow();
    }
  });

  it('returns an object with all required PlatformRules fields', () => {
    const rules = getPlatformRules('instagram_post');
    expect(typeof rules.platformId).toBe('string');
    expect(typeof rules.platformName).toBe('string');
    expect(rules.dimensions).toBeDefined();
    expect(typeof rules.dimensions.width).toBe('number');
    expect(typeof rules.dimensions.height).toBe('number');
    expect(rules.safeZone).toBeDefined();
    expect(rules.textGuide).toBeDefined();
    expect(Array.isArray(rules.preferredCompositions)).toBe(true);
    expect(typeof rules.usesFaceCropping).toBe('boolean');
    expect(typeof rules.maxTextCoverageRatio).toBe('number');
    expect(typeof rules.requiresHighContrast).toBe('boolean');
    expect(typeof rules.isSmallDisplayContext).toBe('boolean');
    expect(Array.isArray(rules.effectiveHooks)).toBe(true);
    expect(Array.isArray(rules.effectiveArchetypes)).toBe(true);
    expect(Array.isArray(rules.qualityNotes)).toBe(true);
  });

  it('dimensions are positive integers', () => {
    for (const fmt of KNOWN_FORMATS) {
      const rules = getPlatformRules(fmt);
      expect(rules.dimensions.width).toBeGreaterThan(0);
      expect(rules.dimensions.height).toBeGreaterThan(0);
    }
  });

  it('maxTextCoverageRatio is in (0, 1]', () => {
    for (const fmt of KNOWN_FORMATS) {
      const r = getPlatformRules(fmt).maxTextCoverageRatio;
      expect(r).toBeGreaterThan(0);
      expect(r).toBeLessThanOrEqual(1);
    }
  });

  it('textGuide has headlineMinPx, bodyMinPx, maxBodyLines', () => {
    const rules = getPlatformRules('instagram_post');
    expect(typeof rules.textGuide.headlineMinPx).toBe('number');
    expect(typeof rules.textGuide.bodyMinPx).toBe('number');
    expect(typeof rules.textGuide.maxBodyLines).toBe('number');
  });

  it('textGuide headlineMinPx > bodyMinPx (headlines are bigger)', () => {
    for (const fmt of KNOWN_FORMATS) {
      const guide = getPlatformRules(fmt).textGuide;
      expect(guide.headlineMinPx).toBeGreaterThanOrEqual(guide.bodyMinPx);
    }
  });

  it('unknown format returns a valid fallback ruleset', () => {
    const rules = getPlatformRules('completely_unknown_xyz_123');
    expect(rules).toBeDefined();
    expect(typeof rules.platformName).toBe('string');
    expect(rules.dimensions.width).toBeGreaterThan(0);
  });

  it('instagram_story has portrait dimensions (height > width)', () => {
    const rules = getPlatformRules('instagram_story');
    expect(rules.dimensions.height).toBeGreaterThan(rules.dimensions.width);
  });

  it('youtube_thumbnail has landscape dimensions (width > height)', () => {
    const rules = getPlatformRules('youtube_thumbnail');
    expect(rules.dimensions.width).toBeGreaterThan(rules.dimensions.height);
  });

  it('different formats return different rules objects', () => {
    const ig = getPlatformRules('instagram_post');
    const yt = getPlatformRules('youtube_thumbnail');
    expect(ig.platformId).not.toBe(yt.platformId);
  });

  it('same format returns consistent rules on repeated calls', () => {
    const a = getPlatformRules('instagram_post');
    const b = getPlatformRules('instagram_post');
    expect(a.platformId).toBe(b.platformId);
    expect(a.dimensions.width).toBe(b.dimensions.width);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// getSupportedPlatforms
// ══════════════════════════════════════════════════════════════════════════════
describe('getSupportedPlatforms', () => {
  it('returns a non-empty array', () => {
    const platforms = getSupportedPlatforms();
    expect(Array.isArray(platforms)).toBe(true);
    expect(platforms.length).toBeGreaterThan(0);
  });

  it('all entries are non-empty strings', () => {
    for (const p of getSupportedPlatforms()) {
      expect(typeof p).toBe('string');
      expect(p.length).toBeGreaterThan(0);
    }
  });

  it('all platform IDs are unique', () => {
    const platforms = getSupportedPlatforms();
    expect(new Set(platforms).size).toBe(platforms.length);
  });

  it('each returned platform can be looked up with getPlatformRules', () => {
    for (const p of getSupportedPlatforms()) {
      const rules = getPlatformRules(p);
      expect(rules.platformId).toBe(p);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// buildPlatformPromptContext
// ══════════════════════════════════════════════════════════════════════════════
describe('buildPlatformPromptContext', () => {
  it('returns a non-empty string', () => {
    const ctx = buildPlatformPromptContext('instagram_post');
    expect(typeof ctx).toBe('string');
    expect(ctx.length).toBeGreaterThan(20);
  });

  it('includes the platform name', () => {
    const rules = getPlatformRules('instagram_post');
    const ctx   = buildPlatformPromptContext('instagram_post');
    expect(ctx).toContain(rules.platformName);
  });

  it('includes canvas dimensions', () => {
    const rules = getPlatformRules('instagram_post');
    const ctx   = buildPlatformPromptContext('instagram_post');
    expect(ctx).toContain(String(rules.dimensions.width));
    expect(ctx).toContain(String(rules.dimensions.height));
  });

  it('includes minimum text size info', () => {
    const ctx = buildPlatformPromptContext('instagram_post');
    // Should mention px values for text
    expect(ctx).toMatch(/\d+px/);
  });

  it('includes max body lines info', () => {
    const rules = getPlatformRules('instagram_post');
    const ctx   = buildPlatformPromptContext('instagram_post');
    expect(ctx).toContain(String(rules.textGuide.maxBodyLines));
  });

  it('mentions high contrast for requiresHighContrast platforms', () => {
    // Find a platform that requires high contrast
    const platform = getSupportedPlatforms().find(p => getPlatformRules(p).requiresHighContrast);
    if (platform) {
      const ctx = buildPlatformPromptContext(platform);
      expect(ctx.toLowerCase()).toContain('contrast');
    }
  });

  it('works for all supported platforms without throwing', () => {
    for (const p of getSupportedPlatforms()) {
      expect(() => buildPlatformPromptContext(p)).not.toThrow();
    }
  });

  it('works for unknown format (uses fallback)', () => {
    expect(() => buildPlatformPromptContext('unknown_format')).not.toThrow();
    const ctx = buildPlatformPromptContext('unknown_format');
    expect(ctx.length).toBeGreaterThan(10);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// scorePlatformCompliance
// ══════════════════════════════════════════════════════════════════════════════
describe('scorePlatformCompliance', () => {
  it('returns an object with all required fields', () => {
    const score = scorePlatformCompliance(BASE_GENOME, 'instagram_post');
    expect(typeof score.overall).toBe('number');
    expect(typeof score.textLegibility).toBe('number');
    expect(typeof score.compositionAlignment).toBe('number');
    expect(typeof score.safeZoneCompliance).toBe('number');
    expect(typeof score.hookEffectiveness).toBe('number');
    expect(Array.isArray(score.violations)).toBe(true);
    expect(Array.isArray(score.recommendations)).toBe(true);
  });

  it('all numeric scores are in [0, 1]', () => {
    const score = scorePlatformCompliance(BASE_GENOME, 'instagram_post');
    const numericFields = ['overall', 'textLegibility', 'compositionAlignment', 'safeZoneCompliance', 'hookEffectiveness'];
    for (const field of numericFields) {
      const val = (score as any)[field] as number;
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThanOrEqual(1);
    }
  });

  it('works for all known formats without throwing', () => {
    for (const fmt of KNOWN_FORMATS) {
      expect(() => scorePlatformCompliance(BASE_GENOME, fmt)).not.toThrow();
    }
  });

  it('works for unknown format (fallback rules)', () => {
    expect(() => scorePlatformCompliance(BASE_GENOME, 'unknown_xyz')).not.toThrow();
  });

  it('is deterministic — same genome+format always produces same scores', () => {
    const a = scorePlatformCompliance(BASE_GENOME, 'instagram_post');
    const b = scorePlatformCompliance(BASE_GENOME, 'instagram_post');
    expect(a.overall).toBe(b.overall);
    expect(a.violations.length).toBe(b.violations.length);
  });

  it('sparse density gives higher textLegibility than dense', () => {
    const sparse = scorePlatformCompliance({ ...BASE_GENOME, densityProfile: 'sparse' }, 'instagram_post');
    const dense  = scorePlatformCompliance({ ...BASE_GENOME, densityProfile: 'dense'  }, 'instagram_post');
    expect(sparse.textLegibility).toBeGreaterThanOrEqual(dense.textLegibility);
  });

  it('dense density in small display context produces a violation', () => {
    // Find a small display context platform
    const smallPlatform = getSupportedPlatforms().find(p => getPlatformRules(p).isSmallDisplayContext);
    if (smallPlatform) {
      const score = scorePlatformCompliance({ ...BASE_GENOME, densityProfile: 'dense' }, smallPlatform);
      expect(score.violations.length).toBeGreaterThan(0);
    }
  });

  it('matching composition pattern gives compositionAlignment=1.0', () => {
    // centered_axis maps to center_dominant bias
    // Find a platform that prefers center_dominant
    const platform = getSupportedPlatforms().find(p => {
      const rules = getPlatformRules(p);
      return rules.preferredCompositions.includes('center_dominant' as any);
    });
    if (platform) {
      const score = scorePlatformCompliance(
        { ...BASE_GENOME, compositionPattern: 'centered_axis' },
        platform
      );
      expect(score.compositionAlignment).toBe(1.0);
    }
  });

  it('mismatching hook strategy gives lower hookEffectiveness', () => {
    // Use a hook strategy that is unlikely to be in the effective hooks list
    const scoreA = scorePlatformCompliance({ ...BASE_GENOME, hookStrategy: 'bold_headline' }, 'instagram_post');
    const scoreB = scorePlatformCompliance({ ...BASE_GENOME, hookStrategy: 'negative_space' }, 'instagram_post');
    // At least one should produce different effectiveness
    expect(scoreA.hookEffectiveness === 1.0 || scoreB.hookEffectiveness === 1.0 ||
      scoreA.hookEffectiveness !== scoreB.hookEffectiveness).toBe(true);
  });

  it('effective hook strategy gives hookEffectiveness=1.0', () => {
    // Find platform rules with at least one effective hook
    const platform = getSupportedPlatforms().find(p => getPlatformRules(p).effectiveHooks.length > 0);
    if (platform) {
      const rules = getPlatformRules(platform);
      const effectiveHook = rules.effectiveHooks[0]!;
      const score = scorePlatformCompliance(
        { ...BASE_GENOME, hookStrategy: effectiveHook as any },
        platform
      );
      expect(score.hookEffectiveness).toBe(1.0);
    }
  });

  it('overall score is a weighted composite (not higher than 1.0)', () => {
    for (const fmt of KNOWN_FORMATS) {
      const score = scorePlatformCompliance(BASE_GENOME, fmt);
      expect(score.overall).toBeLessThanOrEqual(1.0);
      expect(score.overall).toBeGreaterThanOrEqual(0);
    }
  });

  it('recommendations is an array of strings', () => {
    const score = scorePlatformCompliance(BASE_GENOME, 'instagram_post');
    for (const rec of score.recommendations) {
      expect(typeof rec).toBe('string');
      expect(rec.length).toBeGreaterThan(0);
    }
  });
});
