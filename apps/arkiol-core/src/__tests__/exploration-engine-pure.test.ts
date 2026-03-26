/**
 * apps/arkiol-core/src/__tests__/exploration-engine-pure.test.ts
 *
 * Unit tests for the pure/synchronous exports of engines/exploration/engine.ts
 *
 * Tests:
 *  - deriveExploreSeed — determinism, format, uniqueness
 *  - buildExploreInput — field mapping, seed derivation, defaults
 */

import {
  deriveExploreSeed,
  buildExploreInput,
} from '../engines/exploration/engine';
import type { OrchestratorInput, OrchestratorResult } from '../engines/ai/pipeline-orchestrator';

// ── Fixtures ──────────────────────────────────────────────────────────────────
function makeOrchestratorInput(overrides: Partial<OrchestratorInput> = {}): OrchestratorInput {
  return {
    jobId:   'job-explore-001',
    orgId:   'org-001',
    userId:  'user-001',
    format:  'instagram_post',
    brief:   { prompt: 'Launch our fitness app targeting athletes' } as any,
    ...overrides,
  };
}

function makeOrchestratorResult(overrides: Partial<OrchestratorResult> = {}): OrchestratorResult {
  return {
    jobId:       'job-explore-001',
    format:      'instagram_post',
    svgOutput:   '<svg></svg>',
    stageMs:     100,
    totalMs:     200,
    tokensUsed:  500,
    provider:    'openai' as any,
    stages: {
      intent: {
        stage: 'intent',
        ok: true,
        data: { prompt: 'Launch our fitness app', objective: 'awareness', sentiment: 'positive', keyThemes: [] },
        ms: 50,
      },
      layout: {
        stage: 'layout',
        ok: true,
        data: { layoutType: 'split', zones: [], compositionPattern: 'centered_axis' },
        ms: 30,
      },
      audience: {
        stage: 'audience',
        ok: true,
        data: { segment: 'athletes', tonePreference: 'energetic', demographics: {} as any },
        ms: 20,
      },
      density: {
        stage: 'density',
        ok: true,
        data: { densityProfile: 'balanced', textBlockCount: 3, wordCount: 50 },
        ms: 15,
      },
      brand: {
        stage: 'brand',
        ok: true,
        data: { prefersDarkBg: false, toneKeywords: ['bold', 'energetic'], primaryColorExtracted: '#FF5733' },
        ms: 10,
      },
    } as any,
    ...overrides,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// deriveExploreSeed
// ══════════════════════════════════════════════════════════════════════════════
describe('deriveExploreSeed', () => {
  it('returns a string', () => {
    expect(typeof deriveExploreSeed('job-1', 'instagram_post', 'launch campaign')).toBe('string');
  });

  it('returns exactly 32 characters', () => {
    const seed = deriveExploreSeed('job-1', 'instagram_post', 'launch campaign');
    expect(seed.length).toBe(32);
  });

  it('is a hex string', () => {
    const seed = deriveExploreSeed('job-1', 'instagram_post', 'launch campaign');
    expect(seed).toMatch(/^[0-9a-f]{32}$/);
  });

  it('is deterministic — same inputs always produce same seed', () => {
    const a = deriveExploreSeed('job-abc', 'flyer', 'product launch');
    const b = deriveExploreSeed('job-abc', 'flyer', 'product launch');
    expect(a).toBe(b);
  });

  it('different jobIds produce different seeds', () => {
    const a = deriveExploreSeed('job-1', 'instagram_post', 'same intent');
    const b = deriveExploreSeed('job-2', 'instagram_post', 'same intent');
    expect(a).not.toBe(b);
  });

  it('different formats produce different seeds', () => {
    const a = deriveExploreSeed('job-1', 'instagram_post', 'same intent');
    const b = deriveExploreSeed('job-1', 'youtube_thumbnail', 'same intent');
    expect(a).not.toBe(b);
  });

  it('different intents produce different seeds', () => {
    const a = deriveExploreSeed('job-1', 'instagram_post', 'launch campaign');
    const b = deriveExploreSeed('job-1', 'instagram_post', 'brand awareness');
    expect(a).not.toBe(b);
  });

  it('handles empty strings without throwing', () => {
    expect(() => deriveExploreSeed('', '', '')).not.toThrow();
    expect(deriveExploreSeed('', '', '').length).toBe(32);
  });

  it('handles long strings without throwing', () => {
    const long = 'x'.repeat(1000);
    expect(() => deriveExploreSeed(long, long, long)).not.toThrow();
    expect(deriveExploreSeed(long, long, long).length).toBe(32);
  });

  it('handles unicode without throwing', () => {
    expect(() => deriveExploreSeed('job-1', '中文格式', '🎯 Brand Launch')).not.toThrow();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// buildExploreInput
// ══════════════════════════════════════════════════════════════════════════════
describe('buildExploreInput', () => {
  const oi = makeOrchestratorInput();
  const or = makeOrchestratorResult();

  it('returns an object without throwing', () => {
    expect(() => buildExploreInput(oi, or)).not.toThrow();
  });

  it('runId is "explore:{jobId}"', () => {
    const input = buildExploreInput(oi, or);
    expect(input.runId).toBe(`explore:${oi.jobId}`);
  });

  it('format matches orchestratorInput.format', () => {
    const input = buildExploreInput(oi, or);
    expect(input.format).toBe(oi.format);
  });

  it('seed is a 32-char hex string derived from job/format/intent', () => {
    const input = buildExploreInput(oi, or);
    expect(input.seed).toMatch(/^[0-9a-f]{32}$/);
  });

  it('seed matches deriveExploreSeed(jobId, format, prompt)', () => {
    const input = buildExploreInput(oi, or);
    const expected = deriveExploreSeed(
      oi.jobId,
      oi.format,
      or.stages.intent.data.prompt ?? ''
    );
    expect(input.seed).toBe(expected);
  });

  it('pipelineContext.intent matches intent stage prompt', () => {
    const input = buildExploreInput(oi, or);
    expect(input.pipelineContext.intent).toBe(or.stages.intent.data.prompt);
  });

  it('pipelineContext.audienceSegment matches audience stage', () => {
    const input = buildExploreInput(oi, or);
    expect(input.pipelineContext.audienceSegment).toBe(or.stages.audience.data.segment);
  });

  it('pipelineContext.tonePreference matches audience stage', () => {
    const input = buildExploreInput(oi, or);
    expect(input.pipelineContext.tonePreference).toBe(or.stages.audience.data.tonePreference);
  });

  it('pipelineContext.layoutType matches layout stage', () => {
    const input = buildExploreInput(oi, or);
    expect(input.pipelineContext.layoutType).toBe(or.stages.layout.data.layoutType);
  });

  it('pipelineContext.prefersDarkBg matches brand stage', () => {
    const input = buildExploreInput(oi, or);
    expect(input.pipelineContext.brandPrefersDarkBg).toBe(or.stages.brand.data.prefersDarkBg);
  });

  it('pipelineContext.brandToneKeywords matches brand stage', () => {
    const input = buildExploreInput(oi, or);
    expect(input.pipelineContext.brandToneKeywords).toEqual(or.stages.brand.data.toneKeywords);
  });

  it('noveltyArchive defaults to empty array', () => {
    const input = buildExploreInput(oi, or);
    expect(Array.isArray(input.noveltyArchive)).toBe(true);
    expect(input.noveltyArchive!.length).toBe(0);
  });

  it('poolSize defaults to a positive number', () => {
    const input = buildExploreInput(oi, or);
    expect(typeof input.poolSize).toBe('number');
    expect(input.poolSize).toBeGreaterThan(0);
  });

  it('targetResultCount defaults to a positive number', () => {
    const input = buildExploreInput(oi, or);
    expect(typeof input.targetResultCount).toBe('number');
    expect(input.targetResultCount).toBeGreaterThan(0);
  });

  it('highConfidenceRatio defaults to a value in (0, 1)', () => {
    const input = buildExploreInput(oi, or);
    expect(input.highConfidenceRatio).toBeGreaterThan(0);
    expect(input.highConfidenceRatio).toBeLessThan(1);
  });

  it('custom poolSize from opts is applied', () => {
    const input = buildExploreInput(oi, or, { poolSize: 42 });
    expect(input.poolSize).toBe(42);
  });

  it('custom targetResultCount from opts is applied', () => {
    const input = buildExploreInput(oi, or, { targetResultCount: 7 });
    expect(input.targetResultCount).toBe(7);
  });

  it('custom noveltyArchive from opts is applied', () => {
    const archive = [{ genomeHash: 'hash1' }] as any[];
    const input = buildExploreInput(oi, or, { noveltyArchive: archive });
    expect(input.noveltyArchive).toBe(archive);
  });

  it('imageProvided is true when brief.imageUrl is set', () => {
    const oi2 = makeOrchestratorInput({ brief: { prompt: 'test', imageUrl: 'https://cdn/img.jpg' } as any });
    const input = buildExploreInput(oi2, or);
    expect(input.pipelineContext.imageProvided).toBe(true);
  });

  it('imageProvided is false when brief.imageUrl is absent', () => {
    const input = buildExploreInput(oi, or); // no imageUrl
    expect(input.pipelineContext.imageProvided).toBe(false);
  });

  it('different jobs produce different runIds', () => {
    const a = buildExploreInput(makeOrchestratorInput({ jobId: 'job-A' }), or);
    const b = buildExploreInput(makeOrchestratorInput({ jobId: 'job-B' }), or);
    expect(a.runId).not.toBe(b.runId);
  });
});
