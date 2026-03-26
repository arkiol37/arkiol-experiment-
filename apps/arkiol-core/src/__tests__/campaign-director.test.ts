/**
 * apps/arkiol-core/src/__tests__/campaign-director.test.ts
 *
 * Unit tests for engines/campaign/creative-director.ts
 *
 * Pure functions only — no DB, no HTTP, no Next.js runtime.
 *
 * Covers:
 *  - buildCampaignPlan — never throws, return shape, determinism via seed,
 *    campaignId/seed are hex strings, objective detection from prompt,
 *    identity fields are valid, formats are populated, estimatedCredits,
 *    generationOrder matches formats, createdAt is ISO, fallback on minimal input
 *  - campaignFormatToGenerationPayload — prompt composition, field propagation,
 *    required fields, meta fields
 */

import {
  buildCampaignPlan,
  campaignFormatToGenerationPayload,
  type DirectorInput,
  type CampaignPlan,
  type CampaignFormatPlan,
} from '../engines/campaign/creative-director';

// ── Fixtures ─────────────────────────────────────────────────────────────────
const BASE_INPUT: DirectorInput = {
  prompt:           'Launch our new fitness app targeting young professionals',
  requestedFormats: ['instagram_post', 'youtube_thumbnail'],
};

const AWARENESS_INPUT: DirectorInput = {
  prompt: 'Introduce our brand and build visibility with a new audience',
};

const CONVERSION_INPUT: DirectorInput = {
  prompt: 'Limited time sale — buy now and save 40% — click here to convert',
};

const SEEDED_INPUT: DirectorInput = {
  prompt: 'Test campaign',
  seed:   'deterministic-seed-abc123',
};

// ══════════════════════════════════════════════════════════════════════════════
// buildCampaignPlan — never throws
// ══════════════════════════════════════════════════════════════════════════════
describe('buildCampaignPlan — never throws', () => {
  it('returns a plan for a normal prompt', () => {
    expect(() => buildCampaignPlan(BASE_INPUT)).not.toThrow();
  });

  it('returns a plan for an empty prompt (edge case)', () => {
    expect(() => buildCampaignPlan({ prompt: '' })).not.toThrow();
  });

  it('returns a plan for a very long prompt (>500 chars)', () => {
    const long = 'a'.repeat(1000);
    expect(() => buildCampaignPlan({ prompt: long })).not.toThrow();
  });

  it('returns a plan when requestedFormats is omitted', () => {
    expect(() => buildCampaignPlan({ prompt: 'hello world' })).not.toThrow();
  });

  it('returns a plan with unusual prompt characters', () => {
    expect(() => buildCampaignPlan({ prompt: '🎯 Sale! ¡Oferta! 中文 Русский' })).not.toThrow();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// buildCampaignPlan — return shape
// ══════════════════════════════════════════════════════════════════════════════
describe('buildCampaignPlan — return shape', () => {
  let plan: CampaignPlan;
  beforeAll(() => { plan = buildCampaignPlan(BASE_INPUT); });

  it('has all required top-level fields', () => {
    expect(typeof plan.campaignId).toBe('string');
    expect(typeof plan.seed).toBe('string');
    expect(typeof plan.prompt).toBe('string');
    expect(typeof plan.objective).toBe('string');
    expect(plan.identity).toBeDefined();
    expect(Array.isArray(plan.formats)).toBe(true);
    expect(typeof plan.sharedPromptContext).toBe('string');
    expect(typeof plan.estimatedCredits).toBe('number');
    expect(Array.isArray(plan.generationOrder)).toBe(true);
    expect(typeof plan.createdAt).toBe('string');
  });

  it('campaignId is a 24-character hex string', () => {
    expect(plan.campaignId).toMatch(/^[0-9a-f]{24}$/);
  });

  it('seed is a non-empty string', () => {
    expect(plan.seed.length).toBeGreaterThan(0);
  });

  it('prompt is preserved in the plan', () => {
    expect(plan.prompt).toBe(BASE_INPUT.prompt);
  });

  it('objective is a valid campaign objective', () => {
    const VALID = ['awareness', 'engagement', 'conversion', 'retention', 'announcement'];
    expect(VALID).toContain(plan.objective);
  });

  it('createdAt is a valid ISO timestamp', () => {
    expect(() => new Date(plan.createdAt)).not.toThrow();
    expect(new Date(plan.createdAt).toISOString()).toBe(plan.createdAt);
  });

  it('estimatedCredits is a positive integer', () => {
    expect(Number.isInteger(plan.estimatedCredits)).toBe(true);
    expect(plan.estimatedCredits).toBeGreaterThan(0);
  });

  it('formats array has at least 1 entry', () => {
    expect(plan.formats.length).toBeGreaterThan(0);
  });

  it('generationOrder contains same formats as formats array (same count)', () => {
    expect(plan.generationOrder.length).toBe(plan.formats.length);
  });

  it('every generationOrder entry is a format in plan.formats', () => {
    const formatNames = new Set(plan.formats.map(f => f.format));
    for (const fmt of plan.generationOrder) {
      expect(formatNames.has(fmt)).toBe(true);
    }
  });

  it('sharedPromptContext is non-empty', () => {
    expect(plan.sharedPromptContext.length).toBeGreaterThan(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// buildCampaignPlan — visual identity
// ══════════════════════════════════════════════════════════════════════════════
describe('buildCampaignPlan — visual identity', () => {
  let plan: CampaignPlan;
  beforeAll(() => { plan = buildCampaignPlan(BASE_INPUT); });

  it('identity has primaryColor and accentColor', () => {
    expect(typeof plan.identity.primaryColor).toBe('string');
    expect(plan.identity.primaryColor.length).toBeGreaterThan(0);
    expect(typeof plan.identity.accentColor).toBe('string');
  });

  it('identity has bgLight and bgDark', () => {
    expect(typeof plan.identity.bgLight).toBe('string');
    expect(typeof plan.identity.bgDark).toBe('string');
  });

  it('identity typographyPersonality is 0–4', () => {
    expect([0, 1, 2, 3, 4]).toContain(plan.identity.typographyPersonality);
  });

  it('identity has tone, headline, subMessage, ctaText', () => {
    expect(typeof plan.identity.tone).toBe('string');
    expect(typeof plan.identity.headline).toBe('string');
    expect(typeof plan.identity.subMessage).toBe('string');
    expect(typeof plan.identity.ctaText).toBe('string');
  });

  it('identity has hookStrategy and compositionPattern', () => {
    expect(typeof plan.identity.hookStrategy).toBe('string');
    expect(typeof plan.identity.compositionPattern).toBe('string');
  });

  it('brandPrimaryColor overrides identity.primaryColor', () => {
    const plan = buildCampaignPlan({ ...BASE_INPUT, brandPrimaryColor: '#ABCDEF' });
    expect(plan.identity.primaryColor).toBe('#ABCDEF');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// buildCampaignPlan — format plans
// ══════════════════════════════════════════════════════════════════════════════
describe('buildCampaignPlan — format plans', () => {
  it('each format plan has required fields', () => {
    const plan = buildCampaignPlan(BASE_INPUT);
    for (const f of plan.formats) {
      expect(typeof f.format).toBe('string');
      expect(typeof f.role).toBe('string');
      expect(typeof f.headline).toBe('string');
      expect(typeof f.ctaText).toBe('string');
      expect(typeof f.includeMotion).toBe('boolean');
      expect(typeof f.archetypeId).toBe('string');
      expect(typeof f.presetId).toBe('string');
      expect(typeof f.generationPriority).toBe('number');
    }
  });

  it('requested formats appear in plan.formats', () => {
    const plan = buildCampaignPlan({ ...BASE_INPUT, requestedFormats: ['instagram_post', 'flyer'] });
    const formatNames = plan.formats.map(f => f.format);
    expect(formatNames).toContain('instagram_post');
    expect(formatNames).toContain('flyer');
  });

  it('generationPriority values are non-negative integers', () => {
    const plan = buildCampaignPlan(BASE_INPUT);
    for (const f of plan.formats) {
      expect(Number.isInteger(f.generationPriority)).toBe(true);
      expect(f.generationPriority).toBeGreaterThanOrEqual(0);
    }
  });

  it('estimatedCredits increases with more formats', () => {
    const small = buildCampaignPlan({ prompt: 'test', requestedFormats: ['instagram_post'] });
    const large = buildCampaignPlan({ prompt: 'test', requestedFormats: ['instagram_post', 'flyer', 'youtube_thumbnail', 'poster'] });
    expect(large.estimatedCredits).toBeGreaterThan(small.estimatedCredits);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// buildCampaignPlan — determinism and seed
// ══════════════════════════════════════════════════════════════════════════════
describe('buildCampaignPlan — determinism via explicit seed', () => {
  it('same seed → same campaignId', () => {
    const a = buildCampaignPlan(SEEDED_INPUT);
    const b = buildCampaignPlan(SEEDED_INPUT);
    expect(a.campaignId).toBe(b.campaignId);
  });

  it('same seed → same seed in result', () => {
    const a = buildCampaignPlan(SEEDED_INPUT);
    expect(a.seed).toBe(SEEDED_INPUT.seed);
  });

  it('different prompts without seed → different campaignIds', () => {
    const a = buildCampaignPlan({ prompt: 'prompt alpha' });
    const b = buildCampaignPlan({ prompt: 'prompt beta' });
    expect(a.campaignId).not.toBe(b.campaignId);
  });

  it('explicit seed overrides auto-generated seed', () => {
    const plan = buildCampaignPlan({ prompt: 'anything', seed: 'my-fixed-seed' });
    expect(plan.seed).toBe('my-fixed-seed');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// buildCampaignPlan — objective detection
// ══════════════════════════════════════════════════════════════════════════════
describe('buildCampaignPlan — objective detection', () => {
  it('prompt with "launch" keyword → awareness or announcement objective', () => {
    const plan = buildCampaignPlan({ prompt: 'Launch our new brand awareness campaign' });
    expect(['awareness', 'announcement']).toContain(plan.objective);
  });

  it('prompt with "buy", "sale", "discount" → conversion objective', () => {
    const plan = buildCampaignPlan(CONVERSION_INPUT);
    expect(plan.objective).toBe('conversion');
  });

  it('prompt with "engage", "viral" → engagement objective', () => {
    const plan = buildCampaignPlan({ prompt: 'Engage our community with viral content' });
    expect(plan.objective).toBe('engagement');
  });

  it('prompt with "loyalty", "reward", "vip" → retention objective', () => {
    const plan = buildCampaignPlan({ prompt: 'Reward our loyal VIP members with exclusive benefits' });
    expect(plan.objective).toBe('retention');
  });

  it('minimal prompt defaults to awareness', () => {
    const plan = buildCampaignPlan({ prompt: 'xyzzy' }); // no known signals
    expect(plan.objective).toBe('awareness');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// campaignFormatToGenerationPayload
// ══════════════════════════════════════════════════════════════════════════════
describe('campaignFormatToGenerationPayload', () => {
  let plan: CampaignPlan;
  let formatPlan: CampaignFormatPlan;

  beforeAll(() => {
    plan = buildCampaignPlan({ ...BASE_INPUT, requestedFormats: ['instagram_post'] });
    formatPlan = plan.formats[0]!;
  });

  it('returns an object with required fields', () => {
    const payload = campaignFormatToGenerationPayload(plan, formatPlan, 'user-1', 'org-1');
    expect(typeof payload.prompt).toBe('string');
    expect(Array.isArray(payload.formats)).toBe(true);
    expect(typeof payload.stylePreset).toBe('string');
    expect(typeof payload.includeGif).toBe('boolean');
    expect(payload.archetypeOverride).toBeDefined();
    expect(typeof payload.campaignId).toBe('string');
    expect(payload._campaignMeta).toBeDefined();
  });

  it('prompt includes sharedPromptContext', () => {
    const payload = campaignFormatToGenerationPayload(plan, formatPlan, 'user-1', 'org-1');
    expect((payload.prompt as string)).toContain(plan.sharedPromptContext.substring(0, 20));
  });

  it('formats array contains the formatPlan.format', () => {
    const payload = campaignFormatToGenerationPayload(plan, formatPlan, 'user-1', 'org-1');
    expect(payload.formats as string[]).toContain(formatPlan.format);
  });

  it('campaignId matches plan.campaignId', () => {
    const payload = campaignFormatToGenerationPayload(plan, formatPlan, 'user-1', 'org-1');
    expect(payload.campaignId).toBe(plan.campaignId);
  });

  it('archetypeOverride has archetypeId and presetId', () => {
    const payload = campaignFormatToGenerationPayload(plan, formatPlan, 'user-1', 'org-1');
    const override = payload.archetypeOverride as any;
    expect(override.archetypeId).toBe(formatPlan.archetypeId);
    expect(override.presetId).toBe(formatPlan.presetId);
  });

  it('_campaignMeta has objective, role, platform, seed', () => {
    const payload = campaignFormatToGenerationPayload(plan, formatPlan, 'user-1', 'org-1');
    const meta = payload._campaignMeta as any;
    expect(meta.objective).toBe(plan.objective);
    expect(meta.role).toBe(formatPlan.role);
    expect(meta.platform).toBe(formatPlan.platform);
    expect(meta.seed).toBe(plan.seed);
  });

  it('includeGif matches formatPlan.includeMotion', () => {
    const payload = campaignFormatToGenerationPayload(plan, formatPlan, 'user-1', 'org-1');
    expect(payload.includeGif).toBe(formatPlan.includeMotion);
  });

  it('stylePreset matches formatPlan.presetId', () => {
    const payload = campaignFormatToGenerationPayload(plan, formatPlan, 'user-1', 'org-1');
    expect(payload.stylePreset).toBe(formatPlan.presetId);
  });

  it('works for every format in the plan', () => {
    const plan = buildCampaignPlan({
      prompt: 'multi-format campaign',
      requestedFormats: ['instagram_post', 'flyer', 'youtube_thumbnail'],
    });
    for (const fmt of plan.formats) {
      expect(() => campaignFormatToGenerationPayload(plan, fmt, 'u', 'o')).not.toThrow();
    }
  });
});
