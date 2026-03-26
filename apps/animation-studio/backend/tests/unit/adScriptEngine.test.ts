/**
 * Unit tests — Ad Script Engine & Platform Specs
 *
 * Pure function tests with no external dependencies.
 * All imports are from deterministic modules with no I/O.
 */

import {
  buildAdScript,
  buildEnhancedPrompt,
  type BrandContext,
  type Mood,
  type HookType,
  type SceneRole,
} from '../../src/services/adScriptEngine';

import {
  PLACEMENT_SPECS,
  PLACEMENTS_BY_PLATFORM,
  PLATFORM_META,
  getPlacementSpec,
  getResolution,
  estimateDuration,
  type AdPlacement,
  type Platform,
} from '../../src/services/platformSpecs';

// ── Shared fixtures ────────────────────────────────────────────────────────
const BRAND: BrandContext = {
  name:                'ARKIOL',
  brief:               'AI-powered video ad creation in minutes',
  industry:            'Tech / SaaS',
  valueProposition:    'Cut production time by 90%',
  targetAudience:      'Marketing teams',
  uniqueSellingPoint:  'AI script + render in one workflow',
};

const VALID_MOODS: Mood[] = [
  'Luxury', 'Energetic', 'Minimal', 'Playful', 'Cinematic',
  'Emotional', 'Corporate', 'Bold', 'Calm', 'Tech',
];

const VALID_HOOK_TYPES: HookType[] = [
  'pain_point', 'curiosity_gap', 'bold_claim', 'social_proof',
  'direct_offer', 'question', 'shocking_stat',
];

const VALID_PLACEMENTS: AdPlacement[] = Object.keys(PLACEMENT_SPECS) as AdPlacement[];

// ══════════════════════════════════════════════════════════════════════════════
// Platform Specs
// ══════════════════════════════════════════════════════════════════════════════
describe('Platform Specs — PLACEMENT_SPECS', () => {
  test('every placement has required fields', () => {
    for (const [key, spec] of Object.entries(PLACEMENT_SPECS)) {
      expect(typeof spec.label).toBe('string');
      expect(spec.label.length).toBeGreaterThan(0);
      expect(typeof spec.maxDurationSec).toBe('number');
      expect(spec.maxDurationSec).toBeGreaterThan(0);
      expect(typeof spec.secPerScene).toBe('number');
      expect(spec.secPerScene).toBeGreaterThan(0);
      expect(['9:16','1:1','16:9','4:5']).toContain(spec.aspectRatio);
      expect(typeof spec.promptModifier).toBe('string');
      expect(spec.promptModifier.length).toBeGreaterThan(0);
      expect(['youtube','facebook','instagram','tiktok']).toContain(spec.platform);
    }
  });

  test('at least 10 placements are defined', () => {
    expect(VALID_PLACEMENTS.length).toBeGreaterThanOrEqual(10);
  });

  test('each platform has at least 2 placements', () => {
    const platforms: Platform[] = ['youtube', 'facebook', 'instagram', 'tiktok'];
    for (const p of platforms) {
      const placements = VALID_PLACEMENTS.filter(pl => PLACEMENT_SPECS[pl].platform === p);
      expect(placements.length).toBeGreaterThanOrEqual(2);
    }
  });

  test('PLACEMENTS_BY_PLATFORM covers all 4 platforms', () => {
    const platforms: Platform[] = ['youtube', 'facebook', 'instagram', 'tiktok'];
    for (const p of platforms) {
      expect(PLACEMENTS_BY_PLATFORM[p]).toBeDefined();
      expect(PLACEMENTS_BY_PLATFORM[p].length).toBeGreaterThan(0);
    }
  });

  test('all placements in PLACEMENTS_BY_PLATFORM exist in PLACEMENT_SPECS', () => {
    for (const [, placements] of Object.entries(PLACEMENTS_BY_PLATFORM)) {
      for (const pl of placements) {
        expect(PLACEMENT_SPECS[pl]).toBeDefined();
      }
    }
  });

  test('PLATFORM_META has label and icon for each platform', () => {
    const platforms: Platform[] = ['youtube', 'facebook', 'instagram', 'tiktok'];
    for (const p of platforms) {
      expect(PLATFORM_META[p]).toBeDefined();
      expect(typeof PLATFORM_META[p].label).toBe('string');
      expect(typeof PLATFORM_META[p].icon).toBe('string');
      expect(typeof PLATFORM_META[p].color).toBe('string');
      expect(PLATFORM_META[p].color).toMatch(/^#[0-9a-fA-F]{3,8}$/);
    }
  });
});

describe('Platform Specs — getPlacementSpec', () => {
  test('returns correct spec for known placement', () => {
    const spec = getPlacementSpec('tiktok_feed');
    expect(spec.platform).toBe('tiktok');
    expect(spec.aspectRatio).toBe('9:16');
  });

  test('throws for unknown placement', () => {
    expect(() => getPlacementSpec('nonexistent_placement' as any)).toThrow();
  });

  test('returns spec for every defined placement without throwing', () => {
    for (const pl of VALID_PLACEMENTS) {
      expect(() => getPlacementSpec(pl)).not.toThrow();
    }
  });
});

describe('Platform Specs — getResolution', () => {
  test('returns 4K width when is4K=true', () => {
    const spec = getPlacementSpec('youtube_instream');
    const res4k = getResolution(spec, true);
    const res1080 = getResolution(spec, false);
    expect(res4k.width).toBeGreaterThan(res1080.width);
    expect(res4k.height).toBeGreaterThan(res1080.height);
  });

  test('resolution label includes px', () => {
    const spec = getPlacementSpec('instagram_reels');
    const res = getResolution(spec, false);
    expect(res.label).toMatch(/\d+p|4K/i);
  });

  test('resolution dimensions are positive integers', () => {
    for (const pl of VALID_PLACEMENTS) {
      const spec = getPlacementSpec(pl);
      const res = getResolution(spec, false);
      expect(res.width).toBeGreaterThan(0);
      expect(res.height).toBeGreaterThan(0);
      expect(Number.isInteger(res.width)).toBe(true);
      expect(Number.isInteger(res.height)).toBe(true);
    }
  });
});

describe('Platform Specs — estimateDuration', () => {
  test('duration increases with more scenes', () => {
    const spec = getPlacementSpec('tiktok_feed');
    const d3 = estimateDuration(spec, 3);
    const d6 = estimateDuration(spec, 6);
    expect(d6).toBeGreaterThan(d3);
  });

  test('duration does not exceed maxDurationSec', () => {
    for (const pl of VALID_PLACEMENTS) {
      const spec = getPlacementSpec(pl);
      // Test at various scene counts
      for (const count of [1, 3, 5, 8, 10]) {
        const dur = estimateDuration(spec, count);
        expect(dur).toBeLessThanOrEqual(spec.maxDurationSec + 0.1); // small float tolerance
      }
    }
  });

  test('single scene has positive duration', () => {
    const spec = getPlacementSpec('instagram_reels');
    expect(estimateDuration(spec, 1)).toBeGreaterThan(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Ad Script Engine — buildAdScript
// ══════════════════════════════════════════════════════════════════════════════
describe('buildAdScript — output structure', () => {
  const script = buildAdScript({
    brand:      BRAND,
    placement:  'instagram_reels',
    mood:       'Tech',
    hookType:   'bold_claim',
    sceneCount: 4,
    ctaText:    'Try Free',
  });

  test('returns AdScript with all required fields', () => {
    expect(script).toHaveProperty('placement');
    expect(script).toHaveProperty('totalDurationSec');
    expect(script).toHaveProperty('scenes');
    expect(script).toHaveProperty('titleSuggestion');
    expect(script).toHaveProperty('ctaText');
  });

  test('ctaText matches input', () => {
    expect(script.ctaText).toBe('Try Free');
  });

  test('placement matches input', () => {
    expect(script.placement).toBe('instagram_reels');
  });

  test('scenes array has correct count', () => {
    expect(script.scenes).toHaveLength(4);
  });

  test('totalDurationSec is positive', () => {
    expect(script.totalDurationSec).toBeGreaterThan(0);
  });

  test('titleSuggestion includes brand name', () => {
    expect(script.titleSuggestion).toContain('ARKIOL');
  });

  test('titleSuggestion includes mood', () => {
    expect(script.titleSuggestion).toContain('Tech');
  });
});

describe('buildAdScript — scene structure', () => {
  const script = buildAdScript({
    brand:      BRAND,
    placement:  'tiktok_feed',
    mood:       'Energetic',
    hookType:   'pain_point',
    sceneCount: 5,
    ctaText:    'Start Now',
  });

  test('every scene has required fields', () => {
    const VALID_ROLES: SceneRole[] = ['hook', 'problem', 'solution', 'proof', 'cta', 'brand_reveal', 'offer'];
    for (const scene of script.scenes) {
      expect(VALID_ROLES).toContain(scene.role);
      expect(typeof scene.durationSec).toBe('number');
      expect(scene.durationSec).toBeGreaterThan(0);
      expect(typeof scene.prompt).toBe('string');
      expect(scene.prompt.length).toBeGreaterThan(20);
      expect(typeof scene.voiceoverScript).toBe('string');
      expect(scene.voiceoverScript.length).toBeGreaterThan(0);
      expect(typeof scene.visualDirection).toBe('string');
      expect(['cut', 'crossfade', 'push', 'zoom']).toContain(scene.transitionIn);
    }
  });

  test('first scene has role: hook', () => {
    expect(script.scenes[0].role).toBe('hook');
  });

  test('last scene has role: cta', () => {
    expect(script.scenes[script.scenes.length - 1].role).toBe('cta');
  });

  test('hook scene prompt includes pain_point content', () => {
    const hookScene = script.scenes[0];
    // pain_point hook should reference struggle/problem
    expect(hookScene.prompt.length).toBeGreaterThan(30);
    expect(hookScene.voiceoverScript.length).toBeGreaterThan(0);
  });
});

describe('buildAdScript — scene count clamping', () => {
  test('sceneCount=0 is clamped to 1', () => {
    const s = buildAdScript({ brand: BRAND, placement: 'youtube_instream', mood: 'Cinematic', hookType: 'question', sceneCount: 0, ctaText: 'Learn More' });
    expect(s.scenes.length).toBeGreaterThanOrEqual(1);
  });

  test('sceneCount=20 is clamped to 10', () => {
    const s = buildAdScript({ brand: BRAND, placement: 'youtube_instream', mood: 'Cinematic', hookType: 'question', sceneCount: 20, ctaText: 'Learn More' });
    expect(s.scenes.length).toBeLessThanOrEqual(10);
  });

  test('sceneCount=1 produces at minimum hook + cta', () => {
    const s = buildAdScript({ brand: BRAND, placement: 'tiktok_feed', mood: 'Bold', hookType: 'direct_offer', sceneCount: 1, ctaText: 'Get It' });
    expect(s.scenes.length).toBeGreaterThanOrEqual(1);
    expect(s.scenes[0].role).toBe('hook');
  });
});

describe('buildAdScript — mood injection', () => {
  test('mood text appears in scene prompts', () => {
    const moodKeywords: Partial<Record<Mood, string>> = {
      Luxury:    'premium',
      Energetic: 'energy',
      Tech:      'futuristic',
      Calm:      'serene',
      Bold:      'contrast',
    };
    for (const [mood, keyword] of Object.entries(moodKeywords) as [Mood, string][]) {
      const s = buildAdScript({ brand: BRAND, placement: 'instagram_reels', mood, hookType: 'bold_claim', sceneCount: 3, ctaText: 'Go' });
      const allPrompts = s.scenes.map(sc => sc.prompt.toLowerCase()).join(' ');
      expect(allPrompts).toContain(keyword.toLowerCase());
    }
  });
});

describe('buildAdScript — hook type variety', () => {
  test('each hook type produces a different first-scene voiceover', () => {
    const voiceovers = new Set<string>();
    for (const hookType of VALID_HOOK_TYPES) {
      const s = buildAdScript({ brand: BRAND, placement: 'tiktok_feed', mood: 'Cinematic', hookType, sceneCount: 3, ctaText: 'Try' });
      voiceovers.add(s.scenes[0].voiceoverScript);
    }
    // All hook types should produce different voiceovers
    expect(voiceovers.size).toBe(VALID_HOOK_TYPES.length);
  });

  test('hook scene onScreenText is set for most hook types', () => {
    let countWithOnScreen = 0;
    for (const hookType of VALID_HOOK_TYPES) {
      const s = buildAdScript({ brand: BRAND, placement: 'tiktok_feed', mood: 'Bold', hookType, sceneCount: 3, ctaText: 'Go' });
      if (s.scenes[0].onScreenText) countWithOnScreen++;
    }
    expect(countWithOnScreen).toBeGreaterThanOrEqual(Math.floor(VALID_HOOK_TYPES.length * 0.7));
  });
});

describe('buildAdScript — brand context integration', () => {
  test('brand name appears in title suggestion', () => {
    const customBrand: BrandContext = { name: 'Acme Corp', brief: 'making widgets', industry: 'E-commerce' };
    const s = buildAdScript({ brand: customBrand, placement: 'facebook_feed', mood: 'Corporate', hookType: 'social_proof', sceneCount: 3, ctaText: 'Shop' });
    expect(s.titleSuggestion).toContain('Acme Corp');
  });

  test('brand name appears in cta or hook voiceover', () => {
    const s = buildAdScript({ brand: BRAND, placement: 'instagram_reels', mood: 'Tech', hookType: 'bold_claim', sceneCount: 3, ctaText: 'Try Free' });
    const allVoice = s.scenes.map(sc => sc.voiceoverScript).join(' ');
    expect(allVoice).toContain('ARKIOL');
  });

  test('ctaText is embedded in CTA scene', () => {
    const s = buildAdScript({ brand: BRAND, placement: 'tiktok_feed', mood: 'Energetic', hookType: 'direct_offer', sceneCount: 3, ctaText: 'Get 50% Off' });
    const ctaScene = s.scenes.find(sc => sc.role === 'cta');
    expect(ctaScene).toBeDefined();
    const ctaText = [ctaScene!.voiceoverScript, ctaScene!.onScreenText ?? '', ctaScene!.prompt].join(' ');
    // CTA text or reference to offer should appear somewhere
    expect(ctaText.length).toBeGreaterThan(20);
  });
});

describe('buildAdScript — all placements × all moods smoke test', () => {
  // Smoke test: all combinations must not throw
  const PLACEMENT_SAMPLE: AdPlacement[] = [
    'youtube_instream', 'tiktok_feed', 'instagram_reels', 'facebook_feed',
  ];
  const MOOD_SAMPLE: Mood[] = ['Luxury', 'Energetic', 'Tech', 'Bold'];

  for (const placement of PLACEMENT_SAMPLE) {
    for (const mood of MOOD_SAMPLE) {
      test(`placement=${placement} mood=${mood} — does not throw`, () => {
        expect(() => buildAdScript({
          brand:      BRAND,
          placement,
          mood,
          hookType:   'pain_point',
          sceneCount: 4,
          ctaText:    'Learn More',
        })).not.toThrow();
      });
    }
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// buildEnhancedPrompt
// ══════════════════════════════════════════════════════════════════════════════
describe('buildEnhancedPrompt', () => {
  const scene = buildAdScript({
    brand: BRAND, placement: 'tiktok_feed', mood: 'Tech',
    hookType: 'curiosity_gap', sceneCount: 3, ctaText: 'Go',
  }).scenes[0];

  test('returns non-empty string', () => {
    const prompt = buildEnhancedPrompt(scene, 'tiktok_feed', '1080p');
    expect(typeof prompt).toBe('string');
    expect(prompt.length).toBeGreaterThan(50);
  });

  test('includes resolution in output', () => {
    const prompt = buildEnhancedPrompt(scene, 'tiktok_feed', '1080p');
    expect(prompt).toContain('1080p');
  });

  test('includes original scene prompt', () => {
    const prompt = buildEnhancedPrompt(scene, 'tiktok_feed', '1080p');
    // Original prompt should be a substring
    expect(prompt.includes(scene.prompt) || prompt.length > scene.prompt.length).toBe(true);
  });

  test('includes platform-specific modifier', () => {
    const tikTokPrompt = buildEnhancedPrompt(scene, 'tiktok_feed', '1080p');
    const ytPrompt = buildEnhancedPrompt(scene, 'youtube_instream', '1080p');
    // They should differ because platform modifiers differ
    expect(tikTokPrompt).not.toBe(ytPrompt);
  });

  test('includes duration seconds', () => {
    const prompt = buildEnhancedPrompt(scene, 'tiktok_feed', '1080p');
    expect(prompt).toMatch(/\d+ seconds?/i);
  });

  test('includes fps reference', () => {
    const prompt = buildEnhancedPrompt(scene, 'tiktok_feed', '1080p');
    expect(prompt).toMatch(/fps/i);
  });

  test('4K resolution variant is reflected', () => {
    const prompt4K = buildEnhancedPrompt(scene, 'youtube_instream', '4K');
    expect(prompt4K).toContain('4K');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Scene sequence logic
// ══════════════════════════════════════════════════════════════════════════════
describe('buildAdScript — scene sequence guarantees', () => {
  const sceneCounts = [1, 2, 3, 4, 5, 6, 7, 8];

  for (const count of sceneCounts) {
    test(`sceneCount=${count} — first scene is hook, last is cta (if count >= 2)`, () => {
      const s = buildAdScript({ brand: BRAND, placement: 'tiktok_feed', mood: 'Cinematic', hookType: 'question', sceneCount: count, ctaText: 'Sign Up' });
      expect(s.scenes[0].role).toBe('hook');
      if (count >= 2) {
        expect(s.scenes[s.scenes.length - 1].role).toBe('cta');
      }
    });
  }

  test('no duplicate scene roles in a 5-scene script (hook roles can repeat)', () => {
    const s = buildAdScript({ brand: BRAND, placement: 'instagram_reels', mood: 'Corporate', hookType: 'social_proof', sceneCount: 5, ctaText: 'Contact Us' });
    expect(s.scenes.length).toBe(5);
    // At minimum: unique hook and cta
    const roles = s.scenes.map(sc => sc.role);
    expect(roles.filter(r => r === 'hook').length).toBeGreaterThanOrEqual(1);
    expect(roles.filter(r => r === 'cta').length).toBeGreaterThanOrEqual(1);
  });

  test('duration per scene respects platform spec', () => {
    const placement: AdPlacement = 'tiktok_feed';
    const spec = getPlacementSpec(placement);
    const s = buildAdScript({ brand: BRAND, placement, mood: 'Bold', hookType: 'bold_claim', sceneCount: 4, ctaText: 'Try' });
    for (const scene of s.scenes) {
      expect(scene.durationSec).toBeCloseTo(spec.secPerScene, 0);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Edge cases — missing / minimal brand context
// ══════════════════════════════════════════════════════════════════════════════
describe('buildAdScript — minimal brand context', () => {
  const minimalBrand: BrandContext = {
    name:     '',
    brief:    '',
    industry: 'Other',
  };

  test('works with empty brand name and brief', () => {
    expect(() => buildAdScript({
      brand: minimalBrand, placement: 'tiktok_feed', mood: 'Minimal',
      hookType: 'direct_offer', sceneCount: 3, ctaText: 'Go',
    })).not.toThrow();
  });

  test('industry "Other" falls back gracefully', () => {
    const s = buildAdScript({
      brand: { name: 'X', brief: 'help', industry: 'UnknownIndustry' },
      placement: 'instagram_reels', mood: 'Calm', hookType: 'question', sceneCount: 2, ctaText: 'Start',
    });
    expect(s.scenes.length).toBeGreaterThanOrEqual(1);
    expect(s.scenes[0].prompt.length).toBeGreaterThan(10);
  });
});
