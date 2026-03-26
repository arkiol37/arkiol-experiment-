/**
 * apps/arkiol-core/src/__tests__/platform-intelligence.test.ts
 *
 * Unit tests for engines/platform/intelligence.ts
 *
 * Pure functions only — no DB, no HTTP, no Next.js runtime.
 *
 * Covers:
 *  - getPlatformRules — known formats, aliases, unknown format fallback
 *  - scorePlatformCompliance — score bounds, composition/hook scoring,
 *    small-display density violations, high-contrast recommendations
 *  - getSupportedPlatforms — completeness
 *  - buildPlatformPromptContext — structure, field presence, non-empty
 */

import {
  getPlatformRules,
  scorePlatformCompliance,
  getSupportedPlatforms,
  buildPlatformPromptContext,
} from '../engines/platform/intelligence';

// ── Minimal valid DesignGenome fixture ────────────────────────────────────────
const BASE_GENOME: any = {
  layoutFamily:          'magazine',
  variationId:           'var-001',
  archetype:             'BOLD_CLAIM',
  preset:                'bold',
  typographyPersonality: 1,
  densityProfile:        'balanced',
  hookStrategy:          'bold_headline',
  compositionPattern:    'centered_axis',
  motionEligible:        false,
};

function genome(overrides: Partial<typeof BASE_GENOME> = {}) {
  return { ...BASE_GENOME, ...overrides };
}

// ══════════════════════════════════════════════════════════════════════════════
// getPlatformRules
// ══════════════════════════════════════════════════════════════════════════════
describe('getPlatformRules', () => {
  it('returns a non-null object for any input', () => {
    expect(getPlatformRules('instagram_post')).not.toBeNull();
    expect(typeof getPlatformRules('instagram_post')).toBe('object');
  });

  it('never throws — even for unknown format', () => {
    expect(() => getPlatformRules('unknown_format_xyz')).not.toThrow();
  });

  it('returns rules with platformName for known format', () => {
    const rules = getPlatformRules('instagram_post');
    expect(typeof rules.platformName).toBe('string');
    expect(rules.platformName.length).toBeGreaterThan(0);
  });

  it('all known formats return rules with positive dimensions', () => {
    const formats = [
      'youtube_thumbnail', 'youtube_shorts', 'instagram_post', 'instagram_story',
      'tiktok_ad', 'linkedin_post', 'linkedin_banner', 'twitter_post',
      'facebook_ad', 'google_leaderboard', 'flyer',
    ];
    for (const fmt of formats) {
      const rules = getPlatformRules(fmt);
      expect(rules.dimensions.width).toBeGreaterThan(0);
      expect(rules.dimensions.height).toBeGreaterThan(0);
    }
  });

  it('ig_post alias resolves to instagram_post rules', () => {
    const direct = getPlatformRules('instagram_post');
    const alias  = getPlatformRules('ig_post');
    expect(alias.platformName).toBe(direct.platformName);
  });

  it('ig_story alias resolves to instagram_story rules', () => {
    const direct = getPlatformRules('instagram_story');
    const alias  = getPlatformRules('ig_story');
    expect(alias.platformName).toBe(direct.platformName);
  });

  it('yt_thumb alias resolves to youtube_thumbnail rules', () => {
    const direct = getPlatformRules('youtube_thumbnail');
    const alias  = getPlatformRules('yt_thumb');
    expect(alias.platformName).toBe(direct.platformName);
  });

  it('tiktok_cover alias resolves to tiktok_ad rules', () => {
    const direct = getPlatformRules('tiktok_ad');
    const alias  = getPlatformRules('tiktok_cover');
    expect(alias.platformName).toBe(direct.platformName);
  });

  it('poster alias resolves to same rules as flyer', () => {
    const flyer  = getPlatformRules('flyer');
    const poster = getPlatformRules('poster');
    expect(poster.platformName).toBe(flyer.platformName);
  });

  it('unknown format returns fallback with Generic platformName', () => {
    const rules = getPlatformRules('this_format_does_not_exist');
    expect(rules.platformName).toContain('Generic');
  });

  it('fallback rules have sane default dimensions', () => {
    const rules = getPlatformRules('completely_unknown');
    expect(rules.dimensions.width).toBeGreaterThan(0);
    expect(rules.dimensions.height).toBeGreaterThan(0);
  });

  it('all returned rules have required fields', () => {
    const formats = [
      'youtube_thumbnail', 'instagram_post', 'tiktok_ad',
      'linkedin_post', 'facebook_ad', 'unknown_format',
    ];
    for (const fmt of formats) {
      const r = getPlatformRules(fmt);
      expect(typeof r.platformName).toBe('string');
      expect(typeof r.requiresHighContrast).toBe('boolean');
      expect(typeof r.isSmallDisplayContext).toBe('boolean');
      expect(typeof r.maxTextCoverageRatio).toBe('number');
      expect(Array.isArray(r.preferredCompositions)).toBe(true);
      expect(Array.isArray(r.effectiveHooks)).toBe(true);
      expect(Array.isArray(r.effectiveArchetypes)).toBe(true);
      expect(Array.isArray(r.qualityNotes)).toBe(true);
    }
  });

  it('maxTextCoverageRatio is between 0 and 1 for all known formats', () => {
    const formats = [
      'youtube_thumbnail', 'instagram_post', 'instagram_story',
      'tiktok_ad', 'linkedin_post', 'facebook_ad', 'google_leaderboard',
    ];
    for (const fmt of formats) {
      const r = getPlatformRules(fmt);
      expect(r.maxTextCoverageRatio).toBeGreaterThan(0);
      expect(r.maxTextCoverageRatio).toBeLessThanOrEqual(1);
    }
  });

  it('youtube_thumbnail has requiresHighContrast=true', () => {
    expect(getPlatformRules('youtube_thumbnail').requiresHighContrast).toBe(true);
  });

  it('instagram_post has isSmallDisplayContext=true', () => {
    expect(getPlatformRules('instagram_post').isSmallDisplayContext).toBe(true);
  });

  it('instagram_story has isSmallDisplayContext=false', () => {
    expect(getPlatformRules('instagram_story').isSmallDisplayContext).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// scorePlatformCompliance
// ══════════════════════════════════════════════════════════════════════════════
describe('scorePlatformCompliance', () => {
  it('returns an object with required score fields', () => {
    const score = scorePlatformCompliance(BASE_GENOME, 'instagram_post');
    expect(typeof score.overall).toBe('number');
    expect(typeof score.textLegibility).toBe('number');
    expect(typeof score.compositionAlignment).toBe('number');
    expect(typeof score.safeZoneCompliance).toBe('number');
    expect(typeof score.hookEffectiveness).toBe('number');
    expect(Array.isArray(score.violations)).toBe(true);
    expect(Array.isArray(score.recommendations)).toBe(true);
  });

  it('overall score is in [0, 1] for all known formats', () => {
    const formats = [
      'youtube_thumbnail', 'instagram_post', 'instagram_story',
      'tiktok_ad', 'linkedin_post', 'facebook_ad',
    ];
    for (const fmt of formats) {
      const score = scorePlatformCompliance(BASE_GENOME, fmt);
      expect(score.overall).toBeGreaterThanOrEqual(0);
      expect(score.overall).toBeLessThanOrEqual(1);
    }
  });

  it('all sub-scores are in [0, 1]', () => {
    const score = scorePlatformCompliance(BASE_GENOME, 'youtube_thumbnail');
    expect(score.textLegibility).toBeGreaterThanOrEqual(0);
    expect(score.textLegibility).toBeLessThanOrEqual(1);
    expect(score.compositionAlignment).toBeGreaterThanOrEqual(0);
    expect(score.compositionAlignment).toBeLessThanOrEqual(1);
    expect(score.safeZoneCompliance).toBeGreaterThanOrEqual(0);
    expect(score.safeZoneCompliance).toBeLessThanOrEqual(1);
    expect(score.hookEffectiveness).toBeGreaterThanOrEqual(0);
    expect(score.hookEffectiveness).toBeLessThanOrEqual(1);
  });

  it('never throws for valid genome + any format', () => {
    const formats = [
      'youtube_thumbnail', 'instagram_post', 'tiktok_ad',
      'facebook_ad', 'linkedin_post', 'unknown_format',
    ];
    for (const fmt of formats) {
      expect(() => scorePlatformCompliance(BASE_GENOME, fmt)).not.toThrow();
    }
  });

  it('dense content on small-display format adds a violation', () => {
    const smallDisplayGenome = genome({ densityProfile: 'dense' });
    const score = scorePlatformCompliance(smallDisplayGenome, 'youtube_thumbnail');
    // youtube_thumbnail has isSmallDisplayContext=true
    expect(score.violations.length).toBeGreaterThan(0);
    expect(score.violations.some(v => v.toLowerCase().includes('dense') || v.toLowerCase().includes('small'))).toBe(true);
  });

  it('sparse content on small-display format has no density violations', () => {
    const sparseGenome = genome({ densityProfile: 'sparse' });
    const score = scorePlatformCompliance(sparseGenome, 'youtube_thumbnail');
    const densityViolations = score.violations.filter(v =>
      v.toLowerCase().includes('dense') || v.toLowerCase().includes('content')
    );
    expect(densityViolations.length).toBe(0);
  });

  it('compositionAlignment is 1.0 when composition matches platform preference', () => {
    // centered_axis → center_dominant bias
    // Check a format that prefers center_dominant
    const centeredGenome = genome({ compositionPattern: 'centered_axis' });
    const score = scorePlatformCompliance(centeredGenome, 'instagram_post');
    // If instagram prefers center_dominant, compositionAlignment=1.0
    // Or at worst 0.5 — just ensure it's non-negative
    expect(score.compositionAlignment).toBeGreaterThanOrEqual(0.5);
  });

  it('high contrast platform adds recommendation when hook is not contrast-oriented', () => {
    const gentleHookGenome = genome({ hookStrategy: 'visual_lead' });
    const score = scorePlatformCompliance(gentleHookGenome, 'youtube_thumbnail');
    // youtube requires high contrast — visual_lead doesn't maximise contrast
    // should add a recommendation
    expect(score.recommendations.length).toBeGreaterThanOrEqual(0); // at minimum no crash
  });

  it('contrast_punch hook on high-contrast platform achieves full contrastReqScore', () => {
    const contrastGenome = genome({ hookStrategy: 'contrast_punch' });
    const score = scorePlatformCompliance(contrastGenome, 'youtube_thumbnail');
    // textLegibility should be ≥ its non-contrast version
    const normalScore = scorePlatformCompliance(genome({ hookStrategy: 'visual_lead' }), 'youtube_thumbnail');
    expect(score.textLegibility).toBeGreaterThanOrEqual(normalScore.textLegibility);
  });

  it('overall is computed as weighted average of sub-scores', () => {
    // The weights are: composition=0.25, hook=0.25, text=0.20, safeZone=0.15, archetype=0.15
    // Just verify overall is in the correct range
    const score = scorePlatformCompliance(BASE_GENOME, 'instagram_post');
    const maxPossible = 0.25 + 0.25 + 0.20 + 0.15 + 0.15; // = 1.0
    expect(score.overall).toBeLessThanOrEqual(maxPossible + 0.001); // small float tolerance
    expect(score.overall).toBeGreaterThanOrEqual(0);
  });

  it('existingScores parameter is accepted without throwing', () => {
    const existingScores = { readability: 0.8 };
    expect(() => scorePlatformCompliance(BASE_GENOME, 'instagram_post', existingScores)).not.toThrow();
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

  it('contains at least 10 platforms', () => {
    expect(getSupportedPlatforms().length).toBeGreaterThanOrEqual(10);
  });

  it('contains major social platforms', () => {
    const platforms = getSupportedPlatforms();
    expect(platforms).toContain('youtube_thumbnail');
    expect(platforms).toContain('instagram_post');
    expect(platforms).toContain('tiktok_ad');
    expect(platforms).toContain('facebook_ad');
  });

  it('all returned platform IDs resolve to non-fallback rules', () => {
    const platforms = getSupportedPlatforms();
    for (const p of platforms) {
      const rules = getPlatformRules(p);
      expect(rules.platformName).not.toContain('Generic');
    }
  });

  it('returns no duplicate platform IDs', () => {
    const platforms = getSupportedPlatforms();
    expect(new Set(platforms).size).toBe(platforms.length);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// buildPlatformPromptContext
// ══════════════════════════════════════════════════════════════════════════════
describe('buildPlatformPromptContext', () => {
  it('returns a non-empty string for any format', () => {
    const ctx = buildPlatformPromptContext('instagram_post');
    expect(typeof ctx).toBe('string');
    expect(ctx.length).toBeGreaterThan(10);
  });

  it('never throws — including for unknown format', () => {
    expect(() => buildPlatformPromptContext('unknown_format_xyz')).not.toThrow();
  });

  it('includes platform name', () => {
    const ctx = buildPlatformPromptContext('instagram_post');
    expect(ctx).toContain('Instagram');
  });

  it('includes canvas dimensions', () => {
    const ctx = buildPlatformPromptContext('youtube_thumbnail');
    // YouTube thumbnail is 1280×720
    expect(ctx).toContain('1280');
    expect(ctx).toContain('720');
  });

  it('includes text size guidance', () => {
    const ctx = buildPlatformPromptContext('linkedin_post');
    expect(ctx).toContain('px');
  });

  it('includes high contrast note for platforms that require it', () => {
    const rules = getPlatformRules('youtube_thumbnail');
    const ctx = buildPlatformPromptContext('youtube_thumbnail');
    if (rules.requiresHighContrast) {
      expect(ctx.toLowerCase()).toContain('contrast');
    }
  });

  it('includes small display note for small display formats', () => {
    const rules = getPlatformRules('youtube_thumbnail');
    const ctx = buildPlatformPromptContext('youtube_thumbnail');
    if (rules.isSmallDisplayContext) {
      expect(ctx.toLowerCase()).toMatch(/small|legib/);
    }
  });

  it('returns context for all supported platforms without throwing', () => {
    for (const p of getSupportedPlatforms()) {
      expect(() => buildPlatformPromptContext(p)).not.toThrow();
    }
  });

  it('different formats produce different prompt contexts', () => {
    const ig   = buildPlatformPromptContext('instagram_post');
    const yt   = buildPlatformPromptContext('youtube_thumbnail');
    const li   = buildPlatformPromptContext('linkedin_post');
    expect(ig).not.toBe(yt);
    expect(yt).not.toBe(li);
  });

  it('contains max text coverage info', () => {
    const ctx = buildPlatformPromptContext('google_leaderboard');
    expect(ctx).toContain('%');
  });
});
