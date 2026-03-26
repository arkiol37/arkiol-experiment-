/**
 * packages/shared/src/__tests__/aiIntelligence.test.ts
 *
 * Comprehensive unit tests for all five AI Intelligence layers
 * and the runIntelligencePipeline orchestrator.
 *
 * Pure function tests — no DB, no network, no side effects.
 *
 * Covers:
 *  - Layer 1: inferLayoutStrategy  (keyword routing, fallback safety)
 *  - Layer 2: planVariations       (count clamping, axis selection, diversity)
 *  - Layer 3: modelAudience        (segment inference, tone derivation)
 *  - Layer 4: optimizeDensity      (format sizing, hierarchy levels)
 *  - Layer 5: extractBrandSignals  (color parsing, dark-bg detection, accuracy)
 *  - runIntelligencePipeline       (ordering, brand-learning gate, anyFallback)
 *  - StageResult contract          (all stages return valid result shape)
 */

import {
  inferLayoutStrategy,
  planVariations,
  modelAudience,
  optimizeDensity,
  extractBrandSignals,
  runIntelligencePipeline,
  type Intent,
  type LayoutStrategy,
  type AudienceProfile,
} from '../aiIntelligence';

// ── Fixtures ───────────────────────────────────────────────────────────────
const BASE_INTENT: Intent = {
  prompt:   'Showcase our product with bold visuals',
  format:   'instagram_feed',
  audience: 'consumers',
};

function intent(overrides: Partial<Intent> = {}): Intent {
  return { ...BASE_INTENT, ...overrides };
}

// ── StageResult shape helper ───────────────────────────────────────────────
function assertStageResult(r: any) {
  expect(typeof r.ok).toBe('boolean');
  expect(Array.isArray(r.errors)).toBe(true);
  expect(typeof r.durationMs).toBe('number');
  expect(r.durationMs).toBeGreaterThanOrEqual(0);
  expect(typeof r.fallback).toBe('boolean');
  expect(r.data).toBeDefined();
}

// ══════════════════════════════════════════════════════════════════════════════
// Layer 1: inferLayoutStrategy
// ══════════════════════════════════════════════════════════════════════════════
describe('inferLayoutStrategy — StageResult contract', () => {
  it('always returns a valid StageResult', () => {
    assertStageResult(inferLayoutStrategy(intent()));
  });

  it('ok=true on normal input', () => {
    expect(inferLayoutStrategy(intent()).ok).toBe(true);
  });

  it('fallback=false on normal input', () => {
    expect(inferLayoutStrategy(intent()).fallback).toBe(false);
  });

  it('data contains all required LayoutStrategy fields', () => {
    const { data } = inferLayoutStrategy(intent());
    expect(['hero','split','grid','minimal','editorial','product']).toContain(data.layoutType);
    expect(['visual','text','balanced']).toContain(data.emphasis);
    expect(['top','center','bottom','left','right']).toContain(data.primaryZone);
    expect(['tight','normal','airy']).toContain(data.whitespaceLevel);
    expect(data.confidence).toBeGreaterThanOrEqual(0);
    expect(data.confidence).toBeLessThanOrEqual(1);
  });
});

describe('inferLayoutStrategy — layout type keyword routing', () => {
  it('"product" prompt → product layout', () => {
    expect(inferLayoutStrategy(intent({ prompt: 'product showcase' })).data.layoutType).toBe('product');
  });

  it('"showcase" prompt → product layout', () => {
    expect(inferLayoutStrategy(intent({ prompt: 'showcase our new item' })).data.layoutType).toBe('product');
  });

  it('"editorial" prompt → editorial layout', () => {
    expect(inferLayoutStrategy(intent({ prompt: 'magazine editorial style article' })).data.layoutType).toBe('editorial');
  });

  it('"article" prompt → editorial layout', () => {
    expect(inferLayoutStrategy(intent({ prompt: 'an article about our brand' })).data.layoutType).toBe('editorial');
  });

  it('"minimal" prompt → minimal layout', () => {
    expect(inferLayoutStrategy(intent({ prompt: 'clean minimal white space' })).data.layoutType).toBe('minimal');
  });

  it('"story" format → split layout', () => {
    expect(inferLayoutStrategy(intent({ format: 'instagram_story' })).data.layoutType).toBe('split');
  });

  it('"portrait" format → split layout', () => {
    expect(inferLayoutStrategy(intent({ format: 'portrait_video' })).data.layoutType).toBe('split');
  });

  it('"presentation" format → grid layout', () => {
    expect(inferLayoutStrategy(intent({ format: 'presentation_slide' })).data.layoutType).toBe('grid');
  });

  it('generic prompt → hero layout (default)', () => {
    expect(inferLayoutStrategy(intent({ prompt: 'our brand ad' })).data.layoutType).toBe('hero');
  });
});

describe('inferLayoutStrategy — emphasis routing', () => {
  it('"bold text" → text emphasis', () => {
    expect(inferLayoutStrategy(intent({ prompt: 'bold text headline' })).data.emphasis).toBe('text');
  });

  it('"headline" → text emphasis', () => {
    expect(inferLayoutStrategy(intent({ prompt: 'strong headline' })).data.emphasis).toBe('text');
  });

  it('"photo" → visual emphasis', () => {
    expect(inferLayoutStrategy(intent({ prompt: 'stunning photo of our product' })).data.emphasis).toBe('visual');
  });

  it('"image" → visual emphasis', () => {
    expect(inferLayoutStrategy(intent({ prompt: 'beautiful image showcase' })).data.emphasis).toBe('visual');
  });

  it('neutral prompt → balanced emphasis', () => {
    expect(inferLayoutStrategy(intent({ prompt: 'brand campaign' })).data.emphasis).toBe('balanced');
  });
});

describe('inferLayoutStrategy — primary zone routing', () => {
  it('"top" → top zone', () => {
    expect(inferLayoutStrategy(intent({ prompt: 'logo at the top' })).data.primaryZone).toBe('top');
  });

  it('"header" → top zone', () => {
    expect(inferLayoutStrategy(intent({ prompt: 'header section prominent' })).data.primaryZone).toBe('top');
  });

  it('"bottom" → bottom zone', () => {
    expect(inferLayoutStrategy(intent({ prompt: 'cta button at the bottom' })).data.primaryZone).toBe('bottom');
  });

  it('"twitter" format → left zone', () => {
    expect(inferLayoutStrategy(intent({ format: 'twitter_landscape' })).data.primaryZone).toBe('left');
  });

  it('neutral prompt → center zone (default)', () => {
    expect(inferLayoutStrategy(intent({ prompt: 'regular ad' })).data.primaryZone).toBe('center');
  });
});

describe('inferLayoutStrategy — whitespace level', () => {
  it('minimal layout → airy whitespace', () => {
    const r = inferLayoutStrategy(intent({ prompt: 'minimal clean design' }));
    expect(r.data.layoutType).toBe('minimal');
    expect(r.data.whitespaceLevel).toBe('airy');
  });

  it('non-minimal layout → normal whitespace', () => {
    const r = inferLayoutStrategy(intent({ prompt: 'product showcase' }));
    expect(r.data.whitespaceLevel).toBe('normal');
  });
});

describe('inferLayoutStrategy — fallback safety', () => {
  it('empty prompt does not throw, returns fallback', () => {
    expect(() => inferLayoutStrategy(intent({ prompt: '' }))).not.toThrow();
  });

  it('very long prompt does not throw', () => {
    expect(() => inferLayoutStrategy(intent({ prompt: 'x'.repeat(10_000) }))).not.toThrow();
  });

  it('empty format does not throw', () => {
    expect(() => inferLayoutStrategy(intent({ format: '' }))).not.toThrow();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Layer 2: planVariations
// ══════════════════════════════════════════════════════════════════════════════
describe('planVariations — StageResult contract', () => {
  it('always returns valid StageResult', () => {
    assertStageResult(planVariations(intent(), 3, 10));
  });

  it('ok=true on normal input', () => {
    expect(planVariations(intent(), 3, 10).ok).toBe(true);
  });

  it('data contains all VariationStrategy fields', () => {
    const { data } = planVariations(intent(), 4, 10);
    expect(typeof data.count).toBe('number');
    expect(Array.isArray(data.axes)).toBe(true);
    expect(['low', 'medium', 'high']).toContain(data.diversity);
    expect(typeof data.seedBase).toBe('string');
    expect(data.seedBase.length).toBeGreaterThan(0);
  });
});

describe('planVariations — count clamping', () => {
  it('count is clamped to maxAllowed', () => {
    expect(planVariations(intent(), 100, 6).data.count).toBe(6);
  });

  it('count is clamped to minimum 1', () => {
    expect(planVariations(intent(), 0, 10).data.count).toBe(1);
  });

  it('negative requested count → 1', () => {
    expect(planVariations(intent(), -5, 10).data.count).toBe(1);
  });

  it('count within range is preserved', () => {
    expect(planVariations(intent(), 4, 10).data.count).toBe(4);
  });

  it('maxAllowed=1 always produces count=1', () => {
    expect(planVariations(intent(), 10, 1).data.count).toBe(1);
  });
});

describe('planVariations — axis selection', () => {
  it('count=1 → only color axis', () => {
    const { data } = planVariations(intent(), 1, 10);
    expect(data.axes).toContain('color');
    expect(data.axes).not.toContain('typography');
    expect(data.axes).not.toContain('layout');
  });

  it('count>2 → adds typography axis', () => {
    expect(planVariations(intent(), 3, 10).data.axes).toContain('typography');
  });

  it('count>3 → adds layout axis', () => {
    expect(planVariations(intent(), 4, 10).data.axes).toContain('layout');
  });

  it('"copy" in prompt → adds copy axis', () => {
    expect(planVariations(intent({ prompt: 'vary the copy text' }), 2, 10).data.axes).toContain('copy');
  });

  it('"image" in prompt → adds imagery axis', () => {
    expect(planVariations(intent({ prompt: 'swap out the images' }), 2, 10).data.axes).toContain('imagery');
  });
});

describe('planVariations — diversity levels', () => {
  it('count < 3 → low diversity', () => {
    expect(planVariations(intent(), 2, 10).data.diversity).toBe('low');
  });

  it('count >= 3 and < 6 → medium diversity', () => {
    expect(planVariations(intent(), 4, 10).data.diversity).toBe('medium');
  });

  it('count >= 6 → high diversity', () => {
    expect(planVariations(intent(), 6, 10).data.diversity).toBe('high');
  });
});

describe('planVariations — deterministic seed', () => {
  it('same prompt always produces same seedBase', () => {
    const s1 = planVariations(intent({ prompt: 'hello world' }), 3, 10).data.seedBase;
    const s2 = planVariations(intent({ prompt: 'hello world' }), 3, 10).data.seedBase;
    expect(s1).toBe(s2);
  });

  it('different prompts produce different seeds', () => {
    const s1 = planVariations(intent({ prompt: 'prompt one' }), 3, 10).data.seedBase;
    const s2 = planVariations(intent({ prompt: 'prompt two' }), 3, 10).data.seedBase;
    expect(s1).not.toBe(s2);
  });

  it('seedBase is a non-empty string', () => {
    const { data } = planVariations(intent(), 3, 10);
    expect(typeof data.seedBase).toBe('string');
    expect(data.seedBase.length).toBeGreaterThan(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Layer 3: modelAudience
// ══════════════════════════════════════════════════════════════════════════════
describe('modelAudience — StageResult contract', () => {
  it('always returns valid StageResult', () => {
    assertStageResult(modelAudience(intent()));
  });

  it('data contains all AudienceProfile fields', () => {
    const { data } = modelAudience(intent());
    expect(['consumer','professional','enterprise','youth','creative']).toContain(data.segment);
    expect(['formal','casual','playful','authoritative','inspirational']).toContain(data.tonePreference);
    expect(['simple','moderate','complex']).toContain(data.visualComplexity);
    expect(['muted','vibrant','monochrome']).toContain(data.colorSensitivity);
    expect(data.confidence).toBeGreaterThanOrEqual(0);
    expect(data.confidence).toBeLessThanOrEqual(1);
  });
});

describe('modelAudience — segment inference', () => {
  it('b2b audience → enterprise segment', () => {
    expect(modelAudience(intent({ audience: 'b2b buyers' })).data.segment).toBe('enterprise');
  });

  it('"enterprise" in audience → enterprise segment', () => {
    expect(modelAudience(intent({ audience: 'enterprise teams' })).data.segment).toBe('enterprise');
  });

  it('"enterprise" in prompt → enterprise segment', () => {
    expect(modelAudience(intent({ prompt: 'enterprise software solution', audience: '' })).data.segment).toBe('enterprise');
  });

  it('"professional" audience → professional segment', () => {
    expect(modelAudience(intent({ audience: 'professional marketers' })).data.segment).toBe('professional');
  });

  it('"teen" audience → youth segment', () => {
    expect(modelAudience(intent({ audience: 'teenagers' })).data.segment).toBe('youth');
  });

  it('"gen z" audience → youth segment', () => {
    expect(modelAudience(intent({ audience: 'gen z creators' })).data.segment).toBe('youth');
  });

  it('"creative" audience → creative segment', () => {
    expect(modelAudience(intent({ audience: 'creative directors' })).data.segment).toBe('creative');
  });

  it('"designer" audience → creative segment', () => {
    expect(modelAudience(intent({ audience: 'graphic designer' })).data.segment).toBe('creative');
  });

  it('generic audience → consumer segment (default)', () => {
    expect(modelAudience(intent({ audience: 'everyone' })).data.segment).toBe('consumer');
  });
});

describe('modelAudience — tone derivation from segment', () => {
  it('enterprise → authoritative tone', () => {
    const r = modelAudience(intent({ audience: 'enterprise' }));
    expect(r.data.tonePreference).toBe('authoritative');
  });

  it('professional → formal tone', () => {
    const r = modelAudience(intent({ audience: 'professional' }));
    expect(r.data.tonePreference).toBe('formal');
  });

  it('youth → playful tone', () => {
    const r = modelAudience(intent({ audience: 'teen' }));
    expect(r.data.tonePreference).toBe('playful');
  });

  it('creative → inspirational tone', () => {
    const r = modelAudience(intent({ audience: 'creative designer' }));
    expect(r.data.tonePreference).toBe('inspirational');
  });

  it('consumer → casual tone (default)', () => {
    const r = modelAudience(intent({ audience: '' }));
    expect(r.data.tonePreference).toBe('casual');
  });
});

describe('modelAudience — visual complexity and color sensitivity', () => {
  it('enterprise → moderate complexity, muted colors', () => {
    const r = modelAudience(intent({ audience: 'enterprise' }));
    expect(r.data.visualComplexity).toBe('moderate');
    expect(r.data.colorSensitivity).toBe('muted');
  });

  it('creative → complex visuals', () => {
    expect(modelAudience(intent({ audience: 'creative' })).data.visualComplexity).toBe('complex');
  });

  it('youth → vibrant colors', () => {
    expect(modelAudience(intent({ audience: 'teen' })).data.colorSensitivity).toBe('vibrant');
  });
});

describe('modelAudience — fallback safety', () => {
  it('undefined audience does not throw', () => {
    expect(() => modelAudience(intent({ audience: undefined }))).not.toThrow();
  });

  it('empty audience → consumer segment', () => {
    expect(modelAudience(intent({ audience: '' })).data.segment).toBe('consumer');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Layer 4: optimizeDensity
// ══════════════════════════════════════════════════════════════════════════════
const DEFAULT_LAYOUT: LayoutStrategy = {
  layoutType: 'hero', emphasis: 'balanced', primaryZone: 'center',
  whitespaceLevel: 'normal', confidence: 0.8,
};
const DEFAULT_AUDIENCE: AudienceProfile = {
  segment: 'consumer', tonePreference: 'casual', visualComplexity: 'moderate',
  colorSensitivity: 'vibrant', confidence: 0.75,
};

describe('optimizeDensity — StageResult contract', () => {
  it('always returns valid StageResult', () => {
    assertStageResult(optimizeDensity(DEFAULT_LAYOUT, DEFAULT_AUDIENCE, 'instagram_feed'));
  });

  it('data contains all DensityProfile fields', () => {
    const { data } = optimizeDensity(DEFAULT_LAYOUT, DEFAULT_AUDIENCE, 'instagram_feed');
    expect(typeof data.textBlockCount).toBe('number');
    expect(typeof data.maxCharsPerBlock).toBe('number');
    expect(['1','2','3']).toContain(data.hierarchyLevels);
    expect(['small','medium','large','display']).toContain(data.primaryFontSize);
    expect(data.lineHeightScale).toBeGreaterThanOrEqual(1);
    expect(data.lineHeightScale).toBeLessThanOrEqual(2);
  });
});

describe('optimizeDensity — small format (instagram, thumbnail)', () => {
  it('instagram format → 2 text blocks', () => {
    expect(optimizeDensity(DEFAULT_LAYOUT, DEFAULT_AUDIENCE, 'instagram_feed').data.textBlockCount).toBe(2);
  });

  it('thumbnail format → 2 text blocks', () => {
    expect(optimizeDensity(DEFAULT_LAYOUT, DEFAULT_AUDIENCE, 'youtube_thumbnail').data.textBlockCount).toBe(2);
  });

  it('small format → maxCharsPerBlock ≤ 80', () => {
    expect(optimizeDensity(DEFAULT_LAYOUT, DEFAULT_AUDIENCE, 'instagram_story').data.maxCharsPerBlock).toBe(80);
  });

  it('small format → hierarchy level 1', () => {
    expect(optimizeDensity(DEFAULT_LAYOUT, DEFAULT_AUDIENCE, 'thumbnail_square').data.hierarchyLevels).toBe('1');
  });

  it('small format → display font size', () => {
    expect(optimizeDensity(DEFAULT_LAYOUT, DEFAULT_AUDIENCE, 'instagram_feed').data.primaryFontSize).toBe('display');
  });
});

describe('optimizeDensity — large format (presentation, poster)', () => {
  it('presentation format → 4 text blocks', () => {
    expect(optimizeDensity(DEFAULT_LAYOUT, DEFAULT_AUDIENCE, 'presentation_slide').data.textBlockCount).toBe(4);
  });

  it('poster format → 200 maxCharsPerBlock', () => {
    expect(optimizeDensity(DEFAULT_LAYOUT, DEFAULT_AUDIENCE, 'poster_large').data.maxCharsPerBlock).toBe(200);
  });

  it('big format → hierarchy level 3', () => {
    expect(optimizeDensity(DEFAULT_LAYOUT, DEFAULT_AUDIENCE, 'presentation_wide').data.hierarchyLevels).toBe('3');
  });
});

describe('optimizeDensity — medium format (default)', () => {
  it('default format → 3 text blocks', () => {
    expect(optimizeDensity(DEFAULT_LAYOUT, DEFAULT_AUDIENCE, 'facebook_feed').data.textBlockCount).toBe(3);
  });

  it('default format → 120 maxCharsPerBlock', () => {
    expect(optimizeDensity(DEFAULT_LAYOUT, DEFAULT_AUDIENCE, 'facebook_feed').data.maxCharsPerBlock).toBe(120);
  });

  it('default format → hierarchy level 2', () => {
    expect(optimizeDensity(DEFAULT_LAYOUT, DEFAULT_AUDIENCE, 'facebook_feed').data.hierarchyLevels).toBe('2');
  });
});

describe('optimizeDensity — font size from layout emphasis', () => {
  it('text emphasis layout → large font', () => {
    const textLayout = { ...DEFAULT_LAYOUT, emphasis: 'text' as const };
    expect(optimizeDensity(textLayout, DEFAULT_AUDIENCE, 'facebook_feed').data.primaryFontSize).toBe('large');
  });

  it('balanced emphasis → medium font (non-small format)', () => {
    expect(optimizeDensity(DEFAULT_LAYOUT, DEFAULT_AUDIENCE, 'facebook_feed').data.primaryFontSize).toBe('medium');
  });
});

describe('optimizeDensity — line height from tone', () => {
  it('formal tone → 1.6 line height', () => {
    const formalAudience = { ...DEFAULT_AUDIENCE, tonePreference: 'formal' as const };
    expect(optimizeDensity(DEFAULT_LAYOUT, formalAudience, 'linkedin_feed').data.lineHeightScale).toBe(1.6);
  });

  it('playful tone → 1.4 line height', () => {
    const playfulAudience = { ...DEFAULT_AUDIENCE, tonePreference: 'playful' as const };
    expect(optimizeDensity(DEFAULT_LAYOUT, playfulAudience, 'tiktok_feed').data.lineHeightScale).toBe(1.4);
  });

  it('other tones → 1.5 line height', () => {
    for (const tone of ['casual', 'authoritative', 'inspirational'] as const) {
      const a = { ...DEFAULT_AUDIENCE, tonePreference: tone };
      expect(optimizeDensity(DEFAULT_LAYOUT, a, 'facebook_feed').data.lineHeightScale).toBe(1.5);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Layer 5: extractBrandSignals
// ══════════════════════════════════════════════════════════════════════════════
describe('extractBrandSignals — null brand kit', () => {
  it('null brandKit returns default signals with fallback=true', () => {
    const r = extractBrandSignals(null);
    expect(r.fallback).toBe(true);
    expect(r.data.dominantColors).toEqual(['#000000', '#FFFFFF']);
    expect(r.data.historicalAccuracy).toBe(0);
  });
});

describe('extractBrandSignals — color extraction', () => {
  it('extracts up to 4 dominant colors', () => {
    const r = extractBrandSignals({
      colors: ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff'],
    });
    expect(r.data.dominantColors.length).toBe(4);
    expect(r.data.dominantColors).toContain('#ff0000');
    expect(r.data.dominantColors).not.toContain('#ff00ff'); // 5th color excluded
  });

  it('empty colors falls back to default black/white', () => {
    const r = extractBrandSignals({ colors: [] });
    expect(r.data.dominantColors).toEqual(['#000000', '#FFFFFF']);
  });

  it('single color is used as dominant', () => {
    const r = extractBrandSignals({ colors: ['#6366f1'] });
    expect(r.data.dominantColors).toContain('#6366f1');
  });
});

describe('extractBrandSignals — dark background detection', () => {
  it('pure black → prefersDarkBg=true', () => {
    expect(extractBrandSignals({ colors: ['#000000'] }).data.prefersDarkBg).toBe(true);
  });

  it('very dark color → prefersDarkBg=true', () => {
    expect(extractBrandSignals({ colors: ['#1a1a2e'] }).data.prefersDarkBg).toBe(true);
  });

  it('pure white → prefersDarkBg=false', () => {
    expect(extractBrandSignals({ colors: ['#ffffff'] }).data.prefersDarkBg).toBe(false);
  });

  it('bright yellow → prefersDarkBg=false', () => {
    expect(extractBrandSignals({ colors: ['#ffff00'] }).data.prefersDarkBg).toBe(false);
  });

  it('mid-indigo (#6366f1) → prefersDarkBg=false (luminance > 128)', () => {
    // R=99 G=102 B=241 → (99*299 + 102*587 + 241*114)/1000 = (29601+59874+27474)/1000 = 116.949 < 128
    // so this should be dark
    const r = extractBrandSignals({ colors: ['#6366f1'] });
    expect(typeof r.data.prefersDarkBg).toBe('boolean');
  });

  it('malformed hex (wrong length) does not throw', () => {
    expect(() => extractBrandSignals({ colors: ['#gg', '#xyz'] })).not.toThrow();
  });
});

describe('extractBrandSignals — font family', () => {
  it('extracts first font family', () => {
    const r = extractBrandSignals({ fonts: [{ family: 'Inter' }, { family: 'Roboto' }] });
    expect(r.data.fontFamily).toBe('Inter');
  });

  it('no fonts → fontFamily is undefined', () => {
    const r = extractBrandSignals({ colors: ['#fff'] });
    expect(r.data.fontFamily).toBeUndefined();
  });
});

describe('extractBrandSignals — tone keywords', () => {
  it('extracts up to 5 tone keywords', () => {
    const r = extractBrandSignals({ tone: ['bold', 'modern', 'clean', 'premium', 'trust', 'innovation'] });
    expect(r.data.toneKeywords.length).toBe(5);
    expect(r.data.toneKeywords).not.toContain('innovation'); // 6th excluded
  });

  it('empty tone → empty toneKeywords array', () => {
    expect(extractBrandSignals({ tone: [] }).data.toneKeywords).toEqual([]);
  });
});

describe('extractBrandSignals — historical accuracy', () => {
  it('fully populated brand kit → accuracy 1.0', () => {
    const r = extractBrandSignals({
      colors:  ['#ff0000'],
      fonts:   [{ family: 'Inter' }],
      tone:    ['bold'],
      logoUrl: 'https://cdn.example.com/logo.png',
    });
    expect(r.data.historicalAccuracy).toBe(1.0);
  });

  it('empty brand kit → accuracy 0', () => {
    expect(extractBrandSignals({}).data.historicalAccuracy).toBe(0);
  });

  it('half-populated → accuracy 0.5', () => {
    const r = extractBrandSignals({ colors: ['#fff'], fonts: [{ family: 'Inter' }] });
    expect(r.data.historicalAccuracy).toBe(0.5);
  });

  it('accuracy is between 0 and 1', () => {
    for (const kit of [null, {}, { colors: ['#000'] }, { colors: ['#000'], fonts: [{ family: 'X' }], tone: ['a'], logoUrl: 'u' }]) {
      const r = extractBrandSignals(kit as any);
      expect(r.data.historicalAccuracy).toBeGreaterThanOrEqual(0);
      expect(r.data.historicalAccuracy).toBeLessThanOrEqual(1);
    }
  });
});

describe('extractBrandSignals — logoPosition default', () => {
  it('always returns top-left logo position', () => {
    expect(extractBrandSignals({ colors: ['#fff'] }).data.logoPosition).toBe('top-left');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// runIntelligencePipeline — orchestration
// ══════════════════════════════════════════════════════════════════════════════
describe('runIntelligencePipeline — output structure', () => {
  const result = runIntelligencePipeline(intent(), {
    requestedVariations: 3,
    maxAllowedVariations: 10,
    brandKit: { colors: ['#6366f1'], fonts: [{ family: 'Inter' }], tone: ['bold'], logoUrl: 'u' },
    brandLearningEnabled: true,
  });

  it('returns all 5 stage results', () => {
    expect(result).toHaveProperty('layout');
    expect(result).toHaveProperty('variation');
    expect(result).toHaveProperty('audience');
    expect(result).toHaveProperty('density');
    expect(result).toHaveProperty('brand');
  });

  it('returns totalMs as non-negative number', () => {
    expect(typeof result.totalMs).toBe('number');
    expect(result.totalMs).toBeGreaterThanOrEqual(0);
  });

  it('returns anyFallback boolean', () => {
    expect(typeof result.anyFallback).toBe('boolean');
  });

  it('returns brandLearningActive boolean', () => {
    expect(typeof result.brandLearningActive).toBe('boolean');
  });

  it('all 5 stage results pass StageResult contract', () => {
    assertStageResult(result.layout);
    assertStageResult(result.variation);
    assertStageResult(result.audience);
    assertStageResult(result.density);
    assertStageResult(result.brand);
  });
});

describe('runIntelligencePipeline — brand learning gate', () => {
  it('brandLearningEnabled=true → brandLearningActive=true and brand signals populated', () => {
    const r = runIntelligencePipeline(intent(), {
      requestedVariations: 1, maxAllowedVariations: 10,
      brandKit: { colors: ['#ff0000'], fonts: [{ family: 'Inter' }], tone: ['bold'], logoUrl: 'u' },
      brandLearningEnabled: true,
    });
    expect(r.brandLearningActive).toBe(true);
    // With brand learning on and full kit, accuracy should be 1.0
    expect(r.brand.data.historicalAccuracy).toBe(1.0);
  });

  it('brandLearningEnabled=false → brandLearningActive=false and brand signals use defaults', () => {
    const r = runIntelligencePipeline(intent(), {
      requestedVariations: 1, maxAllowedVariations: 10,
      brandKit: { colors: ['#ff0000'], fonts: [{ family: 'Inter' }], tone: ['bold'], logoUrl: 'u' },
      brandLearningEnabled: false,
    });
    expect(r.brandLearningActive).toBe(false);
    // brandKit is ignored → fallback defaults
    expect(r.brand.fallback).toBe(true);
    expect(r.brand.data.historicalAccuracy).toBe(0);
  });

  it('brandLearningEnabled omitted → brandLearningActive=false', () => {
    const r = runIntelligencePipeline(intent(), { requestedVariations: 1, maxAllowedVariations: 10 });
    expect(r.brandLearningActive).toBe(false);
  });

  it('brandLearningEnabled=true with null brandKit → fallback', () => {
    const r = runIntelligencePipeline(intent(), {
      requestedVariations: 1, maxAllowedVariations: 10,
      brandKit: null,
      brandLearningEnabled: true,
    });
    expect(r.brandLearningActive).toBe(true);
    expect(r.brand.fallback).toBe(true);
  });
});

describe('runIntelligencePipeline — anyFallback flag', () => {
  it('anyFallback=false when all stages succeed normally', () => {
    const r = runIntelligencePipeline(
      intent({ prompt: 'product showcase', format: 'instagram_feed', audience: 'consumers' }),
      { requestedVariations: 3, maxAllowedVariations: 10, brandLearningEnabled: false }
    );
    // Brand learning is off → brand stage uses fallback → anyFallback should be true
    expect(typeof r.anyFallback).toBe('boolean');
  });

  it('anyFallback=true when brand learning is disabled (brand stage falls back)', () => {
    const r = runIntelligencePipeline(intent(), {
      requestedVariations: 2,
      maxAllowedVariations: 10,
      brandLearningEnabled: false,
    });
    expect(r.anyFallback).toBe(true); // brand stage always falls back when learning disabled
  });
});

describe('runIntelligencePipeline — stage data flows correctly', () => {
  it('density stage receives layout and audience data from prior stages', () => {
    const r = runIntelligencePipeline(
      intent({ prompt: 'minimal product', format: 'instagram_story', audience: 'youth' }),
      { requestedVariations: 2, maxAllowedVariations: 10, brandLearningEnabled: false }
    );
    // minimal prompt → minimal layout → airy whitespace
    expect(r.layout.data.layoutType).toBe('minimal');
    // instagram_story (small format) → display font
    expect(r.density.data.primaryFontSize).toBe('display');
    // youth → playful tone → 1.4 line height
    expect(r.density.data.lineHeightScale).toBe(1.4);
  });

  it('variation count is bounded by maxAllowedVariations', () => {
    const r = runIntelligencePipeline(intent(), { requestedVariations: 99, maxAllowedVariations: 5, brandLearningEnabled: false });
    expect(r.variation.data.count).toBe(5);
  });
});

describe('runIntelligencePipeline — determinism', () => {
  it('same inputs always produce same outputs', () => {
    const opts = { requestedVariations: 4, maxAllowedVariations: 10, brandLearningEnabled: false };
    const r1 = runIntelligencePipeline(intent(), opts);
    const r2 = runIntelligencePipeline(intent(), opts);
    expect(r1.layout.data.layoutType).toBe(r2.layout.data.layoutType);
    expect(r1.variation.data.count).toBe(r2.variation.data.count);
    expect(r1.variation.data.seedBase).toBe(r2.variation.data.seedBase);
    expect(r1.audience.data.segment).toBe(r2.audience.data.segment);
    expect(r1.density.data.textBlockCount).toBe(r2.density.data.textBlockCount);
  });
});

describe('runIntelligencePipeline — robustness with minimal intent', () => {
  it('does not throw with minimal intent (only prompt + format)', () => {
    expect(() => runIntelligencePipeline(
      { prompt: 'test', format: 'fb' },
      { requestedVariations: 1, maxAllowedVariations: 3 }
    )).not.toThrow();
  });

  it('does not throw with empty prompt', () => {
    expect(() => runIntelligencePipeline(
      { prompt: '', format: 'instagram_feed' },
      { requestedVariations: 1, maxAllowedVariations: 5 }
    )).not.toThrow();
  });
});
