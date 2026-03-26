/**
 * apps/arkiol-core/src/__tests__/learning-memory.test.ts
 *
 * Unit tests for engines/exploration/learning-memory.ts
 *
 * Pure functions — no DB, no HTTP, no Next.js.
 *
 * Covers:
 *  - buildDefaultPriors — shape, uniform weights, temperature, totalSignals
 *  - applyFeedback — immutability, reward directions, temperature decay,
 *    totalSignals increment, weight normalisation
 *  - applyFeedbackBatch — fold behaviour, batch=1 matches single
 *  - buildFeedbackSignal — shape, signalId format, weight from SIGNAL_REWARDS
 *  - buildPriorsDiagnostic — shape, topN sorting, exploitationLevel thresholds
 *  - migratePriors — null/bad input → defaults, version mismatch → rebuild,
 *    valid priors pass through
 */

import {
  buildDefaultPriors,
  applyFeedback,
  applyFeedbackBatch,
  buildFeedbackSignal,
  buildPriorsDiagnostic,
  migratePriors,
} from '../engines/exploration/learning-memory';
import type {
  ExplorationPriors,
  FeedbackSignal,
  DesignGenome,
  EvaluationScores,
} from '../engines/exploration/types';

// ── Fixtures ──────────────────────────────────────────────────────────────────
const ORG_ID   = 'org-001';
const BRAND_ID = 'brand-001';

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

const BASE_SCORES: EvaluationScores = {
  readability: 0.8, visualHierarchyClarity: 0.7, platformOptimization: 0.75,
  brandAlignment: 0.8, visualBalance: 0.85, attentionPotential: 0.65,
  compositeScore: 0.76, weakestDimension: 'attentionPotential', evaluationMs: 5,
};

function makeSignal(
  signalType: any = 'selected',
  genomeOverrides: Partial<DesignGenome> = {}
): FeedbackSignal {
  return buildFeedbackSignal({
    userId:      'user-001',
    orgId:       ORG_ID,
    candidateId: 'cand-001',
    genome:      { ...BASE_GENOME, ...genomeOverrides },
    scores:      BASE_SCORES,
    signalType,
    format:      'instagram_post',
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// buildDefaultPriors
// ══════════════════════════════════════════════════════════════════════════════
describe('buildDefaultPriors', () => {
  it('returns an object with orgId set', () => {
    expect(buildDefaultPriors(ORG_ID).orgId).toBe(ORG_ID);
  });

  it('brandId is set when provided', () => {
    expect(buildDefaultPriors(ORG_ID, BRAND_ID).brandId).toBe(BRAND_ID);
  });

  it('brandId is undefined when not provided', () => {
    expect(buildDefaultPriors(ORG_ID).brandId).toBeUndefined();
  });

  it('has all required priors fields', () => {
    const priors = buildDefaultPriors(ORG_ID);
    expect(typeof priors.explorationTemperature).toBe('number');
    expect(typeof priors.totalSignals).toBe('number');
    expect(typeof priors.schemaVersion).toBe('number');
    expect(typeof priors.updatedAt).toBe('string');
    expect(priors.archetypeWeights).toBeDefined();
    expect(priors.presetWeights).toBeDefined();
    expect(priors.hookStrategyWeights).toBeDefined();
    expect(priors.compositionPatternWeights).toBeDefined();
    expect(priors.densityProfileWeights).toBeDefined();
    expect(priors.layoutFamilyWeights).toBeDefined();
  });

  it('totalSignals starts at 0', () => {
    expect(buildDefaultPriors(ORG_ID).totalSignals).toBe(0);
  });

  it('explorationTemperature starts at 0.75', () => {
    expect(buildDefaultPriors(ORG_ID).explorationTemperature).toBe(0.75);
  });

  it('all archetype weights sum to ~1.0', () => {
    const priors = buildDefaultPriors(ORG_ID);
    const sum = Object.values(priors.archetypeWeights).reduce((a: number, b) => a + (b as number), 0);
    expect(sum).toBeCloseTo(1.0, 5);
  });

  it('all preset weights sum to ~1.0', () => {
    const priors = buildDefaultPriors(ORG_ID);
    const sum = Object.values(priors.presetWeights).reduce((a: number, b) => a + (b as number), 0);
    expect(sum).toBeCloseTo(1.0, 5);
  });

  it('all hook weights sum to ~1.0', () => {
    const priors = buildDefaultPriors(ORG_ID);
    const sum = Object.values(priors.hookStrategyWeights).reduce((a: number, b) => a + (b as number), 0);
    expect(sum).toBeCloseTo(1.0, 5);
  });

  it('density weights are uniform (0.25 each)', () => {
    const priors = buildDefaultPriors(ORG_ID);
    const dw = priors.densityProfileWeights;
    expect(dw.sparse).toBe(0.25);
    expect(dw.balanced).toBe(0.25);
    expect(dw.rich).toBe(0.25);
    expect(dw.dense).toBe(0.25);
  });

  it('updatedAt is a valid ISO timestamp', () => {
    const priors = buildDefaultPriors(ORG_ID);
    expect(() => new Date(priors.updatedAt)).not.toThrow();
    expect(new Date(priors.updatedAt).toISOString()).toBe(priors.updatedAt);
  });

  it('schemaVersion is 1', () => {
    expect(buildDefaultPriors(ORG_ID).schemaVersion).toBe(1);
  });

  it('all individual archetype weights are equal (uniform)', () => {
    const priors = buildDefaultPriors(ORG_ID);
    const values = Object.values(priors.archetypeWeights) as number[];
    const firstVal = values[0]!;
    for (const v of values) {
      expect(v).toBeCloseTo(firstVal, 8);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// applyFeedback
// ══════════════════════════════════════════════════════════════════════════════
describe('applyFeedback', () => {
  it('returns a new priors object (does not mutate input)', () => {
    const priors = buildDefaultPriors(ORG_ID);
    const original = JSON.stringify(priors);
    applyFeedback(priors, makeSignal('selected'));
    expect(JSON.stringify(priors)).toBe(original);
  });

  it('increments totalSignals by 1', () => {
    const priors = buildDefaultPriors(ORG_ID);
    const updated = applyFeedback(priors, makeSignal('selected'));
    expect(updated.totalSignals).toBe(1);
  });

  it('totalSignals increments cumulatively', () => {
    let priors = buildDefaultPriors(ORG_ID);
    for (let i = 0; i < 5; i++) priors = applyFeedback(priors, makeSignal('selected'));
    expect(priors.totalSignals).toBe(5);
  });

  it('selected signal increases archetype weight for the selected genome', () => {
    const priors = buildDefaultPriors(ORG_ID);
    const before = priors.archetypeWeights['BOLD_CLAIM'] as number;
    const updated = applyFeedback(priors, makeSignal('selected', { archetype: 'BOLD_CLAIM' as any }));
    const after = updated.archetypeWeights['BOLD_CLAIM'] as number;
    expect(after).toBeGreaterThan(before);
  });

  it('dismissed signal decreases archetype weight', () => {
    const priors = buildDefaultPriors(ORG_ID);
    const before = priors.archetypeWeights['BOLD_CLAIM'] as number;
    const updated = applyFeedback(priors, makeSignal('dismissed', { archetype: 'BOLD_CLAIM' as any }));
    const after = updated.archetypeWeights['BOLD_CLAIM'] as number;
    expect(after).toBeLessThan(before);
  });

  it('exported signal (reward=1.5) has larger effect than selected (reward=1.0)', () => {
    const priors = buildDefaultPriors(ORG_ID);
    const beforeVal = priors.archetypeWeights['BOLD_CLAIM'] as number;
    const afterSelected = applyFeedback(priors, makeSignal('selected')).archetypeWeights['BOLD_CLAIM'] as number;
    const afterExported = applyFeedback(priors, makeSignal('exported')).archetypeWeights['BOLD_CLAIM'] as number;
    expect(afterExported - beforeVal).toBeGreaterThan(afterSelected - beforeVal);
  });

  it('archetype weights still sum to ~1.0 after update', () => {
    const priors = buildDefaultPriors(ORG_ID);
    const updated = applyFeedback(priors, makeSignal('selected'));
    const sum = Object.values(updated.archetypeWeights).reduce((a: number, b) => a + (b as number), 0);
    expect(sum).toBeCloseTo(1.0, 5);
  });

  it('hook weights still sum to ~1.0 after update', () => {
    const priors = buildDefaultPriors(ORG_ID);
    const updated = applyFeedback(priors, makeSignal('selected'));
    const sum = Object.values(updated.hookStrategyWeights).reduce((a: number, b) => a + (b as number), 0);
    expect(sum).toBeCloseTo(1.0, 5);
  });

  it('no weight drops below WEIGHT_FLOOR (0.02) after many dismiss signals', () => {
    let priors = buildDefaultPriors(ORG_ID);
    for (let i = 0; i < 20; i++) {
      priors = applyFeedback(priors, makeSignal('dismissed', { archetype: 'BOLD_CLAIM' as any }));
    }
    for (const v of Object.values(priors.archetypeWeights)) {
      expect(v as number).toBeGreaterThanOrEqual(0.02 - 0.0001); // floor
    }
  });

  it('temperature is unchanged for the first 9 signals', () => {
    let priors = buildDefaultPriors(ORG_ID);
    const initialTemp = priors.explorationTemperature;
    for (let i = 0; i < 9; i++) {
      priors = applyFeedback(priors, makeSignal('selected'));
    }
    expect(priors.explorationTemperature).toBe(initialTemp);
  });

  it('temperature decreases on the 10th signal', () => {
    let priors = buildDefaultPriors(ORG_ID);
    const initialTemp = priors.explorationTemperature;
    for (let i = 0; i < 10; i++) {
      priors = applyFeedback(priors, makeSignal('selected'));
    }
    expect(priors.explorationTemperature).toBeLessThan(initialTemp);
  });

  it('temperature never goes below 0.20', () => {
    let priors = buildDefaultPriors(ORG_ID);
    for (let i = 0; i < 500; i++) {
      priors = applyFeedback(priors, makeSignal('selected'));
    }
    expect(priors.explorationTemperature).toBeGreaterThanOrEqual(0.20);
  });

  it('density profile weight for balanced increases after selected signal', () => {
    const priors = buildDefaultPriors(ORG_ID);
    const before = priors.densityProfileWeights.balanced;
    const updated = applyFeedback(priors, makeSignal('selected', { densityProfile: 'balanced' }));
    expect(updated.densityProfileWeights.balanced).toBeGreaterThan(before);
  });

  it('updatedAt is updated to a new ISO timestamp', () => {
    const priors = buildDefaultPriors(ORG_ID);
    const updated = applyFeedback(priors, makeSignal('selected'));
    expect(updated.updatedAt).not.toBe(priors.updatedAt);
    expect(() => new Date(updated.updatedAt)).not.toThrow();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// applyFeedbackBatch
// ══════════════════════════════════════════════════════════════════════════════
describe('applyFeedbackBatch', () => {
  it('empty batch returns identical priors shape', () => {
    const priors = buildDefaultPriors(ORG_ID);
    const updated = applyFeedbackBatch(priors, []);
    expect(updated.totalSignals).toBe(0);
    expect(updated.orgId).toBe(ORG_ID);
  });

  it('batch of 1 matches single applyFeedback result', () => {
    const priors = buildDefaultPriors(ORG_ID);
    const signal = makeSignal('selected');
    const single = applyFeedback(priors, signal);
    const batch  = applyFeedbackBatch(priors, [signal]);
    expect(batch.totalSignals).toBe(single.totalSignals);
    expect(batch.archetypeWeights['BOLD_CLAIM']).toBeCloseTo(
      single.archetypeWeights['BOLD_CLAIM'] as number, 8
    );
  });

  it('batch of N increments totalSignals by N', () => {
    const priors = buildDefaultPriors(ORG_ID);
    const signals = Array.from({ length: 5 }, () => makeSignal('selected'));
    const updated = applyFeedbackBatch(priors, signals);
    expect(updated.totalSignals).toBe(5);
  });

  it('does not mutate input priors', () => {
    const priors = buildDefaultPriors(ORG_ID);
    const original = JSON.stringify(priors);
    applyFeedbackBatch(priors, [makeSignal('selected'), makeSignal('exported')]);
    expect(JSON.stringify(priors)).toBe(original);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// buildFeedbackSignal
// ══════════════════════════════════════════════════════════════════════════════
describe('buildFeedbackSignal', () => {
  it('returns an object with all required fields', () => {
    const s = makeSignal('selected');
    expect(typeof s.signalId).toBe('string');
    expect(typeof s.userId).toBe('string');
    expect(typeof s.orgId).toBe('string');
    expect(typeof s.candidateId).toBe('string');
    expect(s.genome).toBeDefined();
    expect(s.scores).toBeDefined();
    expect(typeof s.signalType).toBe('string');
    expect(typeof s.weight).toBe('number');
    expect(typeof s.timestamp).toBe('string');
    expect(typeof s.format).toBe('string');
  });

  it('signalId is a 24-char hex string', () => {
    expect(makeSignal('selected').signalId).toMatch(/^[0-9a-f]{24}$/);
  });

  it('weight for selected is 1.0', () => {
    expect(makeSignal('selected').weight).toBe(1.0);
  });

  it('weight for exported is 1.5', () => {
    expect(makeSignal('exported').weight).toBe(1.5);
  });

  it('weight for dismissed is -0.8', () => {
    expect(makeSignal('dismissed').weight).toBe(-0.8);
  });

  it('weight for regenerated is 0.5', () => {
    expect(makeSignal('regenerated').weight).toBe(0.5);
  });

  it('weight for time_spent_high is 0.3', () => {
    expect(makeSignal('time_spent_high').weight).toBe(0.3);
  });

  it('weight for time_spent_low is -0.2', () => {
    expect(makeSignal('time_spent_low').weight).toBe(-0.2);
  });

  it('timestamp is a valid ISO string', () => {
    const s = makeSignal('selected');
    expect(new Date(s.timestamp).toISOString()).toBe(s.timestamp);
  });

  it('genome is preserved on the signal', () => {
    const s = makeSignal('selected', { archetype: 'BOLD_CLAIM' as any });
    expect(s.genome.archetype).toBe('BOLD_CLAIM');
  });

  it('brandId is optional and preserved when set', () => {
    const s = buildFeedbackSignal({
      userId: 'u', orgId: 'o', brandId: 'b-123',
      candidateId: 'c', genome: BASE_GENOME, scores: BASE_SCORES,
      signalType: 'selected', format: 'flyer',
    });
    expect(s.brandId).toBe('b-123');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// buildPriorsDiagnostic
// ══════════════════════════════════════════════════════════════════════════════
describe('buildPriorsDiagnostic', () => {
  it('returns all required diagnostic fields', () => {
    const d = buildPriorsDiagnostic(buildDefaultPriors(ORG_ID));
    expect(typeof d.orgId).toBe('string');
    expect(typeof d.totalSignals).toBe('number');
    expect(typeof d.explorationTemperature).toBe('number');
    expect(Array.isArray(d.topArchetypes)).toBe(true);
    expect(Array.isArray(d.topPresets)).toBe(true);
    expect(Array.isArray(d.topHooks)).toBe(true);
    expect(d.densityDistribution).toBeDefined();
    expect(typeof d.exploitationLevel).toBe('string');
  });

  it('topArchetypes has at most 3 entries', () => {
    expect(buildPriorsDiagnostic(buildDefaultPriors(ORG_ID)).topArchetypes.length).toBeLessThanOrEqual(3);
  });

  it('topPresets has at most 3 entries', () => {
    expect(buildPriorsDiagnostic(buildDefaultPriors(ORG_ID)).topPresets.length).toBeLessThanOrEqual(3);
  });

  it('topHooks has at most 3 entries', () => {
    expect(buildPriorsDiagnostic(buildDefaultPriors(ORG_ID)).topHooks.length).toBeLessThanOrEqual(3);
  });

  it('topArchetypes sorted descending by weight', () => {
    const d = buildPriorsDiagnostic(buildDefaultPriors(ORG_ID));
    for (let i = 0; i < d.topArchetypes.length - 1; i++) {
      expect(d.topArchetypes[i]![1]).toBeGreaterThanOrEqual(d.topArchetypes[i + 1]![1]);
    }
  });

  it('exploitationLevel is "low" for temperature >= 0.60 (default 0.75)', () => {
    expect(buildPriorsDiagnostic(buildDefaultPriors(ORG_ID)).exploitationLevel).toBe('low');
  });

  it('exploitationLevel is "medium" for temperature 0.35–0.59', () => {
    const priors = { ...buildDefaultPriors(ORG_ID), explorationTemperature: 0.50 };
    expect(buildPriorsDiagnostic(priors).exploitationLevel).toBe('medium');
  });

  it('exploitationLevel is "high" for temperature < 0.35', () => {
    const priors = { ...buildDefaultPriors(ORG_ID), explorationTemperature: 0.25 };
    expect(buildPriorsDiagnostic(priors).exploitationLevel).toBe('high');
  });

  it('orgId matches priors.orgId', () => {
    const priors = buildDefaultPriors('my-org-xyz');
    expect(buildPriorsDiagnostic(priors).orgId).toBe('my-org-xyz');
  });

  it('totalSignals matches priors.totalSignals', () => {
    let priors = buildDefaultPriors(ORG_ID);
    priors = applyFeedback(priors, makeSignal('selected'));
    priors = applyFeedback(priors, makeSignal('selected'));
    expect(buildPriorsDiagnostic(priors).totalSignals).toBe(2);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// migratePriors
// ══════════════════════════════════════════════════════════════════════════════
describe('migratePriors', () => {
  it('null input returns default priors for the orgId', () => {
    const priors = migratePriors(null, ORG_ID);
    expect(priors.orgId).toBe(ORG_ID);
    expect(priors.totalSignals).toBe(0);
  });

  it('undefined input returns default priors', () => {
    const priors = migratePriors(undefined, ORG_ID);
    expect(priors.orgId).toBe(ORG_ID);
  });

  it('non-object input returns default priors', () => {
    expect(migratePriors('bad-string', ORG_ID).orgId).toBe(ORG_ID);
    expect(migratePriors(42, ORG_ID).orgId).toBe(ORG_ID);
  });

  it('object with wrong schemaVersion returns rebuilt defaults', () => {
    const stale = { schemaVersion: 0, totalSignals: 5 };
    const priors = migratePriors(stale, ORG_ID);
    // Should rebuild from defaults but preserve totalSignals
    expect(priors.totalSignals).toBe(5);
    expect(priors.orgId).toBe(ORG_ID);
  });

  it('object missing schemaVersion returns rebuilt defaults', () => {
    const raw = { orgId: ORG_ID, totalSignals: 3 };
    const priors = migratePriors(raw, ORG_ID);
    expect(priors.totalSignals).toBe(3);
    expect(priors.orgId).toBe(ORG_ID);
  });

  it('valid priors with correct schemaVersion pass through unchanged', () => {
    const valid = buildDefaultPriors(ORG_ID);
    const result = migratePriors(valid, ORG_ID);
    expect(result).toBe(valid); // same reference
  });

  it('brandId is passed to default priors on rebuild', () => {
    const priors = migratePriors(null, ORG_ID, BRAND_ID);
    expect(priors.brandId).toBe(BRAND_ID);
  });
});
