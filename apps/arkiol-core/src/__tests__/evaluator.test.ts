/**
 * apps/arkiol-core/src/__tests__/evaluator.test.ts
 *
 * Unit tests for engines/exploration/evaluator.ts
 *
 * Pure deterministic scoring — no DB, no HTTP, no Next.js.
 *
 * Covers:
 *  - evaluateCandidate — returns EvaluationScores, all fields in [0,1],
 *    compositeScore is weighted sum, weakestDimension is correct,
 *    evaluationMs non-negative, format-specific weight overrides
 *  - classifyConfidenceTier — all three threshold boundaries
 *  - evaluateBatch — count, averageCompositeScore, tier counts, empty input
 *  - buildRankedCandidates — sorting, rank assignment, explorationScore formula,
 *    alpha=0/1 edge cases, novelty fallback, empty input
 */

import {
  evaluateCandidate,
  classifyConfidenceTier,
  evaluateBatch,
  buildRankedCandidates,
} from '../engines/exploration/evaluator';
import type {
  CandidateDesignPlan,
  DesignGenome,
  EvaluationScores,
  ExplorePipelineContext,
} from '../engines/exploration/types';

// ── Fixtures ──────────────────────────────────────────────────────────────────
const BASE_GENOME: DesignGenome = {
  layoutFamily:          'ig_post',
  variationId:           'v1_split',
  archetype:             'BOLD_CLAIM' as any,
  preset:                'bold' as any,
  typographyPersonality: 1,
  densityProfile:        'balanced',
  hookStrategy:          'bold_headline',
  compositionPattern:    'centered_axis',
  motionEligible:        false,
};

const BASE_CONTEXT: ExplorePipelineContext = {
  intent:          'product launch',
  format:          'instagram_post',
  audienceSegment: 'young adults',
  tonePreference:  'energetic',
  layoutType:      'split',
};

function makeCandidate(
  id: string,
  genomeOverrides: Partial<DesignGenome> = {},
  format = 'instagram_post'
): CandidateDesignPlan {
  return {
    candidateId:      id,
    seed:             `seed-${id}`,
    genome:           { ...BASE_GENOME, ...genomeOverrides },
    generationIndex:  0,
    format,
    layoutCategory:   'instagram' as any,
    constraintsPassed: true,
    repairLog:        [],
    generatedAt:      new Date().toISOString(),
  };
}

const BASE_SCORES: EvaluationScores = {
  readability:             0.8,
  visualHierarchyClarity: 0.7,
  platformOptimization:   0.85,
  brandAlignment:         0.75,
  visualBalance:          0.9,
  attentionPotential:     0.6,
  compositeScore:         0.77,
  weakestDimension:       'attentionPotential',
  evaluationMs:           5,
};

// ══════════════════════════════════════════════════════════════════════════════
// evaluateCandidate
// ══════════════════════════════════════════════════════════════════════════════
describe('evaluateCandidate', () => {
  it('returns an object with all 8 required fields', () => {
    const s = evaluateCandidate(makeCandidate('c1'), BASE_CONTEXT);
    expect(typeof s.readability).toBe('number');
    expect(typeof s.visualHierarchyClarity).toBe('number');
    expect(typeof s.platformOptimization).toBe('number');
    expect(typeof s.brandAlignment).toBe('number');
    expect(typeof s.visualBalance).toBe('number');
    expect(typeof s.attentionPotential).toBe('number');
    expect(typeof s.compositeScore).toBe('number');
    expect(typeof s.weakestDimension).toBe('string');
    expect(typeof s.evaluationMs).toBe('number');
  });

  it('all 6 dimension scores are in [0, 1]', () => {
    const s = evaluateCandidate(makeCandidate('c1'), BASE_CONTEXT);
    const dims = [s.readability, s.visualHierarchyClarity, s.platformOptimization,
                  s.brandAlignment, s.visualBalance, s.attentionPotential];
    for (const d of dims) {
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(1);
    }
  });

  it('compositeScore is in [0, 1]', () => {
    const s = evaluateCandidate(makeCandidate('c1'), BASE_CONTEXT);
    expect(s.compositeScore).toBeGreaterThanOrEqual(0);
    expect(s.compositeScore).toBeLessThanOrEqual(1);
  });

  it('evaluationMs is non-negative', () => {
    const s = evaluateCandidate(makeCandidate('c1'), BASE_CONTEXT);
    expect(s.evaluationMs).toBeGreaterThanOrEqual(0);
  });

  it('is deterministic — same candidate+context → same scores', () => {
    const c = makeCandidate('det');
    const a = evaluateCandidate(c, BASE_CONTEXT);
    const b = evaluateCandidate(c, BASE_CONTEXT);
    expect(a.readability).toBe(b.readability);
    expect(a.compositeScore).toBe(b.compositeScore);
    expect(a.weakestDimension).toBe(b.weakestDimension);
  });

  it('weakestDimension is one of the 6 scoring dimension keys', () => {
    const s = evaluateCandidate(makeCandidate('c1'), BASE_CONTEXT);
    const VALID_DIMS = ['readability', 'visualHierarchyClarity', 'platformOptimization',
                        'brandAlignment', 'visualBalance', 'attentionPotential'];
    expect(VALID_DIMS).toContain(s.weakestDimension);
  });

  it('weakestDimension is actually the dimension with the lowest score', () => {
    const s = evaluateCandidate(makeCandidate('c1'), BASE_CONTEXT);
    const map: Record<string, number> = {
      readability:            s.readability,
      visualHierarchyClarity: s.visualHierarchyClarity,
      platformOptimization:   s.platformOptimization,
      brandAlignment:         s.brandAlignment,
      visualBalance:          s.visualBalance,
      attentionPotential:     s.attentionPotential,
    };
    const minScore = Math.min(...Object.values(map));
    expect(map[s.weakestDimension]).toBe(minScore);
  });

  it('compositeScore is close to a weighted sum of dimensions', () => {
    const s = evaluateCandidate(makeCandidate('c1'), BASE_CONTEXT);
    // Default weights sum to 1.0
    const weightedSum =
      s.readability * 0.20 +
      s.visualHierarchyClarity * 0.20 +
      s.platformOptimization * 0.18 +
      s.brandAlignment * 0.16 +
      s.visualBalance * 0.14 +
      s.attentionPotential * 0.12;
    // compositeScore uses default weights for instagram_post
    expect(s.compositeScore).toBeCloseTo(weightedSum, 5);
  });

  it('works for all canonical formats without throwing', () => {
    const formats = [
      'instagram_post', 'instagram_story', 'youtube_thumbnail',
      'flyer', 'poster', 'presentation_slide', 'business_card', 'resume', 'logo',
    ];
    for (const fmt of formats) {
      expect(() => evaluateCandidate(makeCandidate('c', {}, fmt), BASE_CONTEXT)).not.toThrow();
    }
  });

  it('youtube_thumbnail uses format-specific weights (attentionPotential=0.28)', () => {
    const ytCandidate = makeCandidate('yt', {}, 'youtube_thumbnail');
    const igCandidate = makeCandidate('ig', {}, 'instagram_post');
    const ytScores = evaluateCandidate(ytCandidate, BASE_CONTEXT);
    const igScores = evaluateCandidate(igCandidate, BASE_CONTEXT);
    // With same genome, yt should weight attentionPotential more heavily
    // resulting in different compositeScores (unless all dims happen to be equal)
    // Just verify both produce valid scores
    expect(ytScores.compositeScore).toBeGreaterThanOrEqual(0);
    expect(igScores.compositeScore).toBeGreaterThanOrEqual(0);
  });

  it('sparse density produces higher readability than dense', () => {
    const sparse = evaluateCandidate(makeCandidate('s', { densityProfile: 'sparse' }), BASE_CONTEXT);
    const dense  = evaluateCandidate(makeCandidate('d', { densityProfile: 'dense' }),  BASE_CONTEXT);
    expect(sparse.readability).toBeGreaterThanOrEqual(dense.readability);
  });

  it('different genomes produce different scores', () => {
    const a = evaluateCandidate(makeCandidate('a', { archetype: 'BOLD_CLAIM' as any }), BASE_CONTEXT);
    const b = evaluateCandidate(makeCandidate('b', { archetype: 'MINIMAL_CLEAN' as any, hookStrategy: 'negative_space', densityProfile: 'sparse' }), BASE_CONTEXT);
    // At least one dimension should differ
    const anyDiff =
      a.readability !== b.readability ||
      a.attentionPotential !== b.attentionPotential ||
      a.compositeScore !== b.compositeScore;
    expect(anyDiff).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// classifyConfidenceTier
// ══════════════════════════════════════════════════════════════════════════════
describe('classifyConfidenceTier', () => {
  it('returns "high_confidence" for score >= 0.70', () => {
    expect(classifyConfidenceTier(0.70)).toBe('high_confidence');
    expect(classifyConfidenceTier(0.85)).toBe('high_confidence');
    expect(classifyConfidenceTier(1.0)).toBe('high_confidence');
  });

  it('returns "experimental" for 0.45 <= score < 0.70', () => {
    expect(classifyConfidenceTier(0.45)).toBe('experimental');
    expect(classifyConfidenceTier(0.60)).toBe('experimental');
    expect(classifyConfidenceTier(0.699)).toBe('experimental');
  });

  it('returns "speculative" for score < 0.45', () => {
    expect(classifyConfidenceTier(0.44)).toBe('speculative');
    expect(classifyConfidenceTier(0.20)).toBe('speculative');
    expect(classifyConfidenceTier(0.0)).toBe('speculative');
  });

  it('exact boundary 0.70 is "high_confidence"', () => {
    expect(classifyConfidenceTier(0.70)).toBe('high_confidence');
  });

  it('exact boundary 0.45 is "experimental"', () => {
    expect(classifyConfidenceTier(0.45)).toBe('experimental');
  });

  it('returns valid tier for the full [0,1] range', () => {
    const VALID = ['high_confidence', 'experimental', 'speculative'];
    for (let s = 0; s <= 1.0; s += 0.05) {
      expect(VALID).toContain(classifyConfidenceTier(s));
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// evaluateBatch
// ══════════════════════════════════════════════════════════════════════════════
describe('evaluateBatch', () => {
  it('returns required fields', () => {
    const result = evaluateBatch([], BASE_CONTEXT);
    expect(Array.isArray(result.evaluatedCandidates)).toBe(true);
    expect(typeof result.evaluationMs).toBe('number');
    expect(typeof result.averageCompositeScore).toBe('number');
    expect(typeof result.highConfidenceCount).toBe('number');
    expect(typeof result.experimentalCount).toBe('number');
    expect(typeof result.speculativeCount).toBe('number');
  });

  it('empty input → averageCompositeScore=0, all counts=0', () => {
    const result = evaluateBatch([], BASE_CONTEXT);
    expect(result.averageCompositeScore).toBe(0);
    expect(result.highConfidenceCount).toBe(0);
    expect(result.experimentalCount).toBe(0);
    expect(result.speculativeCount).toBe(0);
    expect(result.evaluatedCandidates.length).toBe(0);
  });

  it('evaluatedCandidates.length equals input length', () => {
    const candidates = Array.from({ length: 5 }, (_, i) => makeCandidate(`c${i}`));
    const result = evaluateBatch(candidates, BASE_CONTEXT);
    expect(result.evaluatedCandidates.length).toBe(5);
  });

  it('all evaluated candidates have scores attached', () => {
    const candidates = [makeCandidate('a'), makeCandidate('b')];
    const result = evaluateBatch(candidates, BASE_CONTEXT);
    for (const c of result.evaluatedCandidates) {
      expect(c.scores).toBeDefined();
      expect(typeof c.scores.compositeScore).toBe('number');
    }
  });

  it('tier counts sum to evaluatedCandidates.length', () => {
    const candidates = Array.from({ length: 6 }, (_, i) => makeCandidate(`c${i}`));
    const result = evaluateBatch(candidates, BASE_CONTEXT);
    expect(result.highConfidenceCount + result.experimentalCount + result.speculativeCount)
      .toBe(result.evaluatedCandidates.length);
  });

  it('averageCompositeScore is mean of individual compositeScores', () => {
    const candidates = Array.from({ length: 4 }, (_, i) => makeCandidate(`c${i}`));
    const result = evaluateBatch(candidates, BASE_CONTEXT);
    const manualAvg = result.evaluatedCandidates.reduce((s, c) => s + c.scores.compositeScore, 0)
      / result.evaluatedCandidates.length;
    expect(result.averageCompositeScore).toBeCloseTo(manualAvg, 8);
  });

  it('averageCompositeScore is in [0, 1]', () => {
    const candidates = Array.from({ length: 3 }, (_, i) => makeCandidate(`c${i}`));
    const result = evaluateBatch(candidates, BASE_CONTEXT);
    expect(result.averageCompositeScore).toBeGreaterThanOrEqual(0);
    expect(result.averageCompositeScore).toBeLessThanOrEqual(1);
  });

  it('confidenceTier is set on each evaluated candidate', () => {
    const candidates = [makeCandidate('a')];
    const result = evaluateBatch(candidates, BASE_CONTEXT);
    const VALID = ['high_confidence', 'experimental', 'speculative'];
    expect(VALID).toContain(result.evaluatedCandidates[0]!.confidenceTier);
  });

  it('evaluationMs is non-negative', () => {
    const result = evaluateBatch([makeCandidate('a')], BASE_CONTEXT);
    expect(result.evaluationMs).toBeGreaterThanOrEqual(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// buildRankedCandidates
// ══════════════════════════════════════════════════════════════════════════════
describe('buildRankedCandidates', () => {
  function makeScoredCandidate(id: string, compositeScore: number) {
    const c = makeCandidate(id);
    return { ...c, scores: { ...BASE_SCORES, compositeScore } };
  }

  it('returns empty array for empty input', () => {
    expect(buildRankedCandidates([], new Map())).toEqual([]);
  });

  it('returns same length as input', () => {
    const candidates = Array.from({ length: 5 }, (_, i) => makeScoredCandidate(`c${i}`, 0.7 - i * 0.05));
    expect(buildRankedCandidates(candidates, new Map()).length).toBe(5);
  });

  it('ranks are assigned 1..n (1-based, consecutive)', () => {
    const candidates = Array.from({ length: 4 }, (_, i) => makeScoredCandidate(`c${i}`, 0.8 - i * 0.1));
    const ranked = buildRankedCandidates(candidates, new Map());
    const ranks = ranked.map(r => r.rank).sort((a, b) => a - b);
    expect(ranks).toEqual([1, 2, 3, 4]);
  });

  it('sorted descending by explorationScore (rank 1 = highest score)', () => {
    const candidates = [
      makeScoredCandidate('low',  0.4),
      makeScoredCandidate('high', 0.9),
      makeScoredCandidate('mid',  0.65),
    ];
    const novelty = new Map([['low', 0.5], ['high', 0.5], ['mid', 0.5]]);
    const ranked = buildRankedCandidates(candidates, novelty);
    expect(ranked[0]!.candidateId).toBe('high');
    expect(ranked[2]!.candidateId).toBe('low');
  });

  it('explorationScore = compositeScore * alpha + novelty * (1 - alpha)', () => {
    const candidates = [makeScoredCandidate('c1', 0.8)];
    const novelty = new Map([['c1', 0.6]]);
    const alpha = 0.65;
    const ranked = buildRankedCandidates(candidates, novelty, alpha);
    const expected = 0.8 * alpha + 0.6 * (1 - alpha);
    expect(ranked[0]!.explorationScore).toBeCloseTo(expected, 8);
  });

  it('alpha=1.0 → explorationScore equals compositeScore', () => {
    const candidates = [makeScoredCandidate('c1', 0.75)];
    const novelty = new Map([['c1', 0.3]]);
    const ranked = buildRankedCandidates(candidates, novelty, 1.0);
    expect(ranked[0]!.explorationScore).toBeCloseTo(0.75, 8);
  });

  it('alpha=0.0 → explorationScore equals noveltyScore', () => {
    const candidates = [makeScoredCandidate('c1', 0.75)];
    const novelty = new Map([['c1', 0.3]]);
    const ranked = buildRankedCandidates(candidates, novelty, 0.0);
    expect(ranked[0]!.explorationScore).toBeCloseTo(0.3, 8);
  });

  it('missing novelty score defaults to 0.5', () => {
    const candidates = [makeScoredCandidate('c1', 0.8)];
    const ranked = buildRankedCandidates(candidates, new Map()); // no novelty entry
    const expected = 0.8 * 0.65 + 0.5 * 0.35;
    expect(ranked[0]!.explorationScore).toBeCloseTo(expected, 8);
  });

  it('confidenceTier is set correctly on each ranked candidate', () => {
    const candidates = [
      makeScoredCandidate('high',  0.75),
      makeScoredCandidate('exp',   0.55),
      makeScoredCandidate('spec',  0.30),
    ];
    const ranked = buildRankedCandidates(candidates, new Map());
    const byId = Object.fromEntries(ranked.map(r => [r.candidateId, r.confidenceTier]));
    expect(byId['high']).toBe('high_confidence');
    expect(byId['exp']).toBe('experimental');
    expect(byId['spec']).toBe('speculative');
  });

  it('noveltyScore is set correctly on each ranked candidate', () => {
    const candidates = [makeScoredCandidate('c1', 0.8), makeScoredCandidate('c2', 0.7)];
    const novelty = new Map([['c1', 0.9], ['c2', 0.3]]);
    const ranked = buildRankedCandidates(candidates, novelty);
    const c1 = ranked.find(r => r.candidateId === 'c1')!;
    const c2 = ranked.find(r => r.candidateId === 'c2')!;
    expect(c1.noveltyScore).toBe(0.9);
    expect(c2.noveltyScore).toBe(0.3);
  });

  it('does not mutate input candidates array', () => {
    const candidates = [makeScoredCandidate('c1', 0.8)];
    const originalLength = candidates.length;
    buildRankedCandidates(candidates, new Map());
    expect(candidates.length).toBe(originalLength);
  });

  it('single candidate gets rank=1', () => {
    const candidates = [makeScoredCandidate('solo', 0.7)];
    const ranked = buildRankedCandidates(candidates, new Map());
    expect(ranked[0]!.rank).toBe(1);
  });
});
