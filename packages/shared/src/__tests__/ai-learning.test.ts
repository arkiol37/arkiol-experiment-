/**
 * packages/shared/src/__tests__/ai-learning.test.ts
 *
 * Unit tests for aiLearning.ts pure functions and constants.
 *
 * Pure — no DB, no HTTP, no Prisma.
 *
 * Covers:
 *  - EXPERIMENTS        — shape, variants non-empty
 *  - assignABVariant    — determinism, always returns a variant from the list,
 *                         different orgIds may get different variants,
 *                         consistent across identical inputs
 *  - computeBenchmarkScore — < 3 samples → insufficient_data,
 *                            improving/stable/declining trend detection,
 *                            score is average of inputs, sampleCount correct
 *  - deriveRefinementSignals — empty history → empty signals,
 *                              < 5 events → empty signals,
 *                              low acceptance → increase variation_count,
 *                              high acceptance → maintain layout,
 *                              high edit rate → decrease density
 *  - computeExportIdempotencyKey — deterministic, format, sorted assetIds
 *  - ConcurrencyLimitError       — instanceof, code, statusCode, message
 */

import {
  EXPERIMENTS,
  assignABVariant,
  computeBenchmarkScore,
  deriveRefinementSignals,
  type ABExperiment,
  type FeedbackEvent,
} from '../aiLearning';

import {
  computeExportIdempotencyKey,
} from '../exportIdempotency';

import {
  ConcurrencyLimitError,
} from '../concurrencyEnforcer';

// ── Fixtures ──────────────────────────────────────────────────────────────────
const EXPERIMENT: ABExperiment = {
  name:     'test_exp_v1',
  variants: ['control', 'variant_a', 'variant_b'],
};

function makeFeedback(eventType: FeedbackEvent['eventType']): FeedbackEvent {
  return {
    orgId:      'org-001',
    userId:     'user-001',
    assetId:    'asset-001',
    jobId:      'job-001',
    eventType,
    occurredAt: new Date().toISOString(),
    metadata:   {},
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// EXPERIMENTS
// ══════════════════════════════════════════════════════════════════════════════
describe('EXPERIMENTS', () => {
  it('has at least 1 experiment', () => {
    expect(Object.keys(EXPERIMENTS).length).toBeGreaterThan(0);
  });

  it('all experiments have name and variants', () => {
    for (const [, exp] of Object.entries(EXPERIMENTS)) {
      expect(typeof (exp as any).name).toBe('string');
      expect(Array.isArray((exp as any).variants)).toBe(true);
      expect((exp as any).variants.length).toBeGreaterThan(0);
    }
  });

  it('LAYOUT_STRATEGY experiment exists with 2 variants', () => {
    expect(EXPERIMENTS.LAYOUT_STRATEGY.variants.length).toBe(2);
  });

  it('VARIATION_AXES experiment exists', () => {
    expect(EXPERIMENTS.VARIATION_AXES).toBeDefined();
  });

  it('GENERATION_MODEL experiment exists', () => {
    expect(EXPERIMENTS.GENERATION_MODEL).toBeDefined();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// assignABVariant
// ══════════════════════════════════════════════════════════════════════════════
describe('assignABVariant', () => {
  it('returns a string', () => {
    expect(typeof assignABVariant('org-001', EXPERIMENT)).toBe('string');
  });

  it('returns a variant from the experiment variants list', () => {
    const variant = assignABVariant('org-001', EXPERIMENT);
    expect(EXPERIMENT.variants).toContain(variant);
  });

  it('is deterministic — same orgId + experiment always produces same variant', () => {
    const a = assignABVariant('org-abc', EXPERIMENT);
    const b = assignABVariant('org-abc', EXPERIMENT);
    expect(a).toBe(b);
  });

  it('produces a valid variant for many different orgIds', () => {
    for (let i = 0; i < 20; i++) {
      const variant = assignABVariant(`org-${i}`, EXPERIMENT);
      expect(EXPERIMENT.variants).toContain(variant);
    }
  });

  it('distributes variants across a population (not all same)', () => {
    const orgIds = Array.from({ length: 50 }, (_, i) => `org-${i}`);
    const assigned = new Set(orgIds.map(id => assignABVariant(id, EXPERIMENT)));
    // With 50 orgIds and 3 variants, we expect at least 2 distinct assignments
    expect(assigned.size).toBeGreaterThan(1);
  });

  it('different experiments produce independent assignments', () => {
    const expA: ABExperiment = { name: 'exp_a', variants: ['a1', 'a2'] };
    const expB: ABExperiment = { name: 'exp_b', variants: ['b1', 'b2'] };
    const variantA = assignABVariant('org-001', expA);
    const variantB = assignABVariant('org-001', expB);
    // They're different experiments — results should be distinct at least conceptually
    expect(['a1', 'a2']).toContain(variantA);
    expect(['b1', 'b2']).toContain(variantB);
  });

  it('single-variant experiment always returns that variant', () => {
    const single: ABExperiment = { name: 'single', variants: ['only_one'] };
    expect(assignABVariant('any-org', single)).toBe('only_one');
  });

  it('works with real EXPERIMENTS constants', () => {
    const variant = assignABVariant('org-test', EXPERIMENTS.LAYOUT_STRATEGY);
    expect(EXPERIMENTS.LAYOUT_STRATEGY.variants).toContain(variant);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// computeBenchmarkScore
// ══════════════════════════════════════════════════════════════════════════════
describe('computeBenchmarkScore', () => {
  it('returns object with category, score, sampleCount, trend', () => {
    const result = computeBenchmarkScore([0.8, 0.7, 0.9, 0.75, 0.85], 'layout');
    expect(typeof result.category).toBe('string');
    expect(typeof result.score).toBe('number');
    expect(typeof result.sampleCount).toBe('number');
    expect(typeof result.trend).toBe('string');
  });

  it('fewer than 3 samples → insufficient_data', () => {
    expect(computeBenchmarkScore([], 'layout').trend).toBe('insufficient_data');
    expect(computeBenchmarkScore([0.5], 'layout').trend).toBe('insufficient_data');
    expect(computeBenchmarkScore([0.5, 0.6], 'layout').trend).toBe('insufficient_data');
  });

  it('insufficient_data score is 0', () => {
    expect(computeBenchmarkScore([0.9], 'layout').score).toBe(0);
  });

  it('sampleCount matches input array length', () => {
    const scores = [0.8, 0.7, 0.9, 0.75, 0.85];
    expect(computeBenchmarkScore(scores, 'cat').sampleCount).toBe(5);
  });

  it('category is preserved', () => {
    expect(computeBenchmarkScore([0.8, 0.7, 0.9], 'my_category').category).toBe('my_category');
  });

  it('score is average of inputs (rounded to 3 decimals)', () => {
    const scores = [0.8, 0.8, 0.8, 0.8, 0.8, 0.8]; // avg = 0.8
    const result = computeBenchmarkScore(scores, 'cat');
    expect(result.score).toBeCloseTo(0.8, 3);
  });

  it('trend is "improving" when late scores significantly exceed early scores', () => {
    // early: [0.3, 0.3, 0.3], late: [0.9, 0.9, 0.9] — delta > 0.05
    const scores = [0.3, 0.3, 0.3, 0.6, 0.9, 0.9, 0.9, 0.9, 0.9];
    const result = computeBenchmarkScore(scores, 'cat');
    expect(result.trend).toBe('improving');
  });

  it('trend is "declining" when late scores significantly below early scores', () => {
    // early: [0.9, 0.9, 0.9], late: [0.3, 0.3, 0.3]
    const scores = [0.9, 0.9, 0.9, 0.9, 0.6, 0.3, 0.3, 0.3, 0.3];
    const result = computeBenchmarkScore(scores, 'cat');
    expect(result.trend).toBe('declining');
  });

  it('trend is "stable" when early and late scores are within 5% delta', () => {
    const scores = [0.7, 0.72, 0.68, 0.71, 0.70, 0.72, 0.69, 0.71, 0.70];
    const result = computeBenchmarkScore(scores, 'cat');
    expect(result.trend).toBe('stable');
  });

  it('score is in [0, 1] for valid inputs', () => {
    const scores = [0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
    const result = computeBenchmarkScore(scores, 'cat');
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(1);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// deriveRefinementSignals
// ══════════════════════════════════════════════════════════════════════════════
describe('deriveRefinementSignals', () => {
  it('returns empty array for empty history', () => {
    expect(deriveRefinementSignals([])).toEqual([]);
  });

  it('returns empty array for fewer than 5 events', () => {
    const history = Array.from({ length: 4 }, () => makeFeedback('asset_accepted'));
    expect(deriveRefinementSignals(history)).toEqual([]);
  });

  it('returns an array', () => {
    const history = Array.from({ length: 5 }, () => makeFeedback('asset_accepted'));
    expect(Array.isArray(deriveRefinementSignals(history))).toBe(true);
  });

  it('low acceptance rate → increase variation_count signal', () => {
    // 1 accepted, 4 rejected = 20% acceptance (below 0.4 threshold)
    const history = [
      makeFeedback('asset_accepted'),
      ...Array.from({ length: 4 }, () => makeFeedback('asset_rejected')),
      makeFeedback('asset_viewed'), // non-acceptance event
    ];
    const signals = deriveRefinementSignals(history);
    const variationSignal = signals.find(s => s.dimension === 'variation_count');
    expect(variationSignal).toBeDefined();
    expect(variationSignal!.direction).toBe('increase');
  });

  it('high acceptance rate → maintain layout signal', () => {
    // 9 accepted, 1 rejected = 90% acceptance (above 0.8 threshold)
    const history = [
      ...Array.from({ length: 9 }, () => makeFeedback('asset_accepted')),
      makeFeedback('asset_rejected'),
    ];
    const signals = deriveRefinementSignals(history);
    const layoutSignal = signals.find(s => s.dimension === 'layout' && s.direction === 'maintain');
    expect(layoutSignal).toBeDefined();
  });

  it('high edit rate → decrease density signal', () => {
    // 7 edits, 3 other = 70% edit rate (above 0.6 threshold)
    // Need 10+ total events
    const history = [
      ...Array.from({ length: 7 }, () => makeFeedback('user_edited_output')),
      ...Array.from({ length: 3 }, () => makeFeedback('asset_viewed')),
      makeFeedback('asset_accepted'),
      makeFeedback('asset_accepted'),
    ];
    const signals = deriveRefinementSignals(history);
    const densitySignal = signals.find(s => s.dimension === 'density' && s.direction === 'decrease');
    expect(densitySignal).toBeDefined();
  });

  it('all signals have required fields', () => {
    const history = [
      makeFeedback('asset_accepted'),
      ...Array.from({ length: 4 }, () => makeFeedback('asset_rejected')),
      makeFeedback('asset_viewed'),
    ];
    const signals = deriveRefinementSignals(history);
    for (const s of signals) {
      expect(typeof s.dimension).toBe('string');
      expect(typeof s.direction).toBe('string');
      expect(typeof s.confidence).toBe('number');
      expect(typeof s.basis).toBe('string');
      expect(s.confidence).toBeGreaterThanOrEqual(0);
      expect(s.confidence).toBeLessThanOrEqual(1);
    }
  });

  it('does not throw for any valid input', () => {
    const allTypes: FeedbackEvent['eventType'][] = [
      'asset_accepted', 'asset_rejected', 'asset_viewed',
      'user_edited_output', 'export_triggered',
    ];
    const history = allTypes.map(makeFeedback);
    expect(() => deriveRefinementSignals(history)).not.toThrow();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// computeExportIdempotencyKey
// ══════════════════════════════════════════════════════════════════════════════
describe('computeExportIdempotencyKey', () => {
  const BASE = { userId: 'user-001', assetIds: ['a1', 'a2', 'a3'], format: 'zip' };

  it('returns a string', () => {
    expect(typeof computeExportIdempotencyKey(BASE)).toBe('string');
  });

  it('starts with "exp_"', () => {
    expect(computeExportIdempotencyKey(BASE)).toMatch(/^exp_/);
  });

  it('is deterministic — same inputs produce same key', () => {
    expect(computeExportIdempotencyKey(BASE)).toBe(computeExportIdempotencyKey(BASE));
  });

  it('key length is consistent (exp_ + 40 hex chars = 44)', () => {
    const key = computeExportIdempotencyKey(BASE);
    expect(key.length).toBe(44);
  });

  it('contains only alphanumeric chars after exp_ prefix', () => {
    const key = computeExportIdempotencyKey(BASE);
    const suffix = key.slice(4); // remove "exp_"
    expect(suffix).toMatch(/^[0-9a-f]+$/);
  });

  it('different userId produces different key', () => {
    const a = computeExportIdempotencyKey({ ...BASE, userId: 'user-001' });
    const b = computeExportIdempotencyKey({ ...BASE, userId: 'user-002' });
    expect(a).not.toBe(b);
  });

  it('different format produces different key', () => {
    const a = computeExportIdempotencyKey({ ...BASE, format: 'zip' });
    const b = computeExportIdempotencyKey({ ...BASE, format: 'png' });
    expect(a).not.toBe(b);
  });

  it('different assetIds produce different key', () => {
    const a = computeExportIdempotencyKey({ ...BASE, assetIds: ['x1'] });
    const b = computeExportIdempotencyKey({ ...BASE, assetIds: ['x2'] });
    expect(a).not.toBe(b);
  });

  it('assetId order does not matter (sorted before hashing)', () => {
    const a = computeExportIdempotencyKey({ ...BASE, assetIds: ['a1', 'a2', 'a3'] });
    const b = computeExportIdempotencyKey({ ...BASE, assetIds: ['a3', 'a1', 'a2'] });
    expect(a).toBe(b);
  });

  it('does not mutate the input assetIds array', () => {
    const assetIds = ['c', 'b', 'a'];
    computeExportIdempotencyKey({ ...BASE, assetIds });
    expect(assetIds).toEqual(['c', 'b', 'a']); // original order preserved
  });

  it('empty assetIds array does not throw', () => {
    expect(() => computeExportIdempotencyKey({ ...BASE, assetIds: [] })).not.toThrow();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ConcurrencyLimitError
// ══════════════════════════════════════════════════════════════════════════════
describe('ConcurrencyLimitError', () => {
  it('is an instance of Error', () => {
    expect(new ConcurrencyLimitError(3, 5)).toBeInstanceOf(Error);
  });

  it('is an instance of ConcurrencyLimitError', () => {
    expect(new ConcurrencyLimitError(3, 5)).toBeInstanceOf(ConcurrencyLimitError);
  });

  it('code is CONCURRENCY_LIMIT', () => {
    expect(new ConcurrencyLimitError(3, 5).code).toBe('CONCURRENCY_LIMIT');
  });

  it('statusCode is 429', () => {
    expect(new ConcurrencyLimitError(3, 5).statusCode).toBe(429);
  });

  it('current and limit are set', () => {
    const err = new ConcurrencyLimitError(3, 5);
    expect(err.current).toBe(3);
    expect(err.limit).toBe(5);
  });

  it('message contains the limit number', () => {
    const err = new ConcurrencyLimitError(3, 5);
    expect(err.message).toContain('5');
  });

  it('org scope message mentions organization', () => {
    const err = new ConcurrencyLimitError(3, 5, 'org');
    expect(err.message.toLowerCase()).toContain('org');
  });

  it('user scope message mentions personal limit', () => {
    const err = new ConcurrencyLimitError(2, 3, 'user');
    expect(err.message.toLowerCase()).toMatch(/personal|user/);
  });

  it('default scope is org (no third argument)', () => {
    const err = new ConcurrencyLimitError(3, 5);
    expect(err.message.toLowerCase()).toMatch(/org/);
  });

  it('can be thrown and caught as Error', () => {
    expect(() => { throw new ConcurrencyLimitError(1, 1); }).toThrow(Error);
  });
});
