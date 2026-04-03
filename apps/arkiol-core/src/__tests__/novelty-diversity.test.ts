/**
 * apps/arkiol-core/src/__tests__/novelty-diversity.test.ts
 *
 * Unit tests for engines/exploration/novelty-diversity.ts
 *
 * Pure math/algorithmic functions — no DB, no HTTP, no Next.js.
 *
 * Covers:
 *  - encodeFeatureVector — 12 dimensions, values in [0,1], motionEligible
 *  - euclideanDistance — identity, symmetry, triangle inequality, known values
 *  - computeNoveltyScores — bounds, archive distance, addedToArchive threshold
 *  - diversityFilter — returns ≤ targetCount, top-ranked first, quality floor,
 *    edge cases (empty, small pool)
 *  - buildDiversityClusters — cluster count, membership exhaustive, centroid shape
 */

import {
  encodeFeatureVector,
  euclideanDistance,
  computeNoveltyScores,
  diversityFilter,
  buildDiversityClusters,
  type FeatureVector,
} from '../engines/exploration/novelty-diversity';
import type { DesignGenome, EvaluationScores, RankedCandidate, CandidateDesignPlan } from '../engines/exploration/types';

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

const BASE_SCORES: EvaluationScores = {
  readability:             0.8,
  visualHierarchyClarity: 0.7,
  platformOptimization:   0.85,
  brandAlignment:         0.75,
  visualBalance:          0.9,
  attentionPotential:     0.6,
  compositeScore:         0.77,
  weakestDimension:       'attentionPotential',
  evaluationMs:           12,
};

function fv(...vals: number[]): FeatureVector {
  return vals as FeatureVector;
}

function makeRanked(
  id: string,
  rank: number,
  compositeScore: number,
  featureVector?: FeatureVector
): RankedCandidate {
  const base: CandidateDesignPlan = {
    candidateId:      id,
    seed:             `seed-${id}`,
    genome:           { ...BASE_GENOME },
    generationIndex:  0,
    format:           'instagram_post',
    layoutCategory:   'instagram' as any,
    constraintsPassed: true,
    repairLog:        [],
    generatedAt:      new Date().toISOString(),
  };
  return {
    ...base,
    scores: { ...BASE_SCORES, compositeScore },
    noveltyScore: 0.5,
    explorationScore: compositeScore * 0.6 + 0.5 * 0.4,
    confidenceTier: 'high_confidence',
    rank,
    featureVector: featureVector ?? makeZeroVec(),
  };
}

function makeZeroVec(): FeatureVector {
  return [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
}

function makeOneVec(): FeatureVector {
  return [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1];
}

// ══════════════════════════════════════════════════════════════════════════════
// encodeFeatureVector
// ══════════════════════════════════════════════════════════════════════════════
describe('encodeFeatureVector', () => {
  it('returns an array of length 12', () => {
    const vec = encodeFeatureVector(BASE_GENOME, BASE_SCORES);
    expect(vec.length).toBe(12);
  });

  it('all values are in [0, 1]', () => {
    const vec = encodeFeatureVector(BASE_GENOME, BASE_SCORES);
    for (const v of vec) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('is deterministic for the same inputs', () => {
    const a = encodeFeatureVector(BASE_GENOME, BASE_SCORES);
    const b = encodeFeatureVector(BASE_GENOME, BASE_SCORES);
    expect(a).toEqual(b);
  });

  it('different genomes produce different vectors', () => {
    const g2: DesignGenome = { ...BASE_GENOME, archetype: 'MINIMAL_CLEAN' as any };
    const a = encodeFeatureVector(BASE_GENOME, BASE_SCORES);
    const b = encodeFeatureVector(g2, BASE_SCORES);
    expect(a).not.toEqual(b);
  });

  it('motionEligible=true encodes to 1 at index 8', () => {
    const motionGenome = { ...BASE_GENOME, motionEligible: true };
    const vec = encodeFeatureVector(motionGenome, BASE_SCORES);
    expect(vec[8]).toBe(1);
  });

  it('motionEligible=false encodes to 0 at index 8', () => {
    const vec = encodeFeatureVector({ ...BASE_GENOME, motionEligible: false }, BASE_SCORES);
    expect(vec[8]).toBe(0);
  });

  it('readability score is at index 9', () => {
    const scores = { ...BASE_SCORES, readability: 0.42 };
    const vec = encodeFeatureVector(BASE_GENOME, scores);
    expect(vec[9]).toBe(0.42);
  });

  it('attentionPotential score is at index 10', () => {
    const scores = { ...BASE_SCORES, attentionPotential: 0.77 };
    const vec = encodeFeatureVector(BASE_GENOME, scores);
    expect(vec[10]).toBe(0.77);
  });

  it('brandAlignment score is at index 11', () => {
    const scores = { ...BASE_SCORES, brandAlignment: 0.33 };
    const vec = encodeFeatureVector(BASE_GENOME, scores);
    expect(vec[11]).toBe(0.33);
  });

  it('typographyPersonality / 4 is at index 4', () => {
    for (const tp of [0, 1, 2, 3, 4] as const) {
      const genome = { ...BASE_GENOME, typographyPersonality: tp };
      const vec = encodeFeatureVector(genome, BASE_SCORES);
      expect(vec[4]).toBeCloseTo(tp / 4, 6);
    }
  });

  it('all 9 layout families produce distinct index-0 values', () => {
    const families = ['ig_post', 'ig_story', 'yt_thumb', 'flyer', 'poster', 'slide', 'business_card', 'resume', 'logo'];
    const vals = families.map(lf => {
      const g = { ...BASE_GENOME, layoutFamily: lf, variationId: 'v1_default' };
      return encodeFeatureVector(g, BASE_SCORES)[0];
    });
    expect(new Set(vals).size).toBe(families.length);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// euclideanDistance
// ══════════════════════════════════════════════════════════════════════════════
describe('euclideanDistance', () => {
  it('distance from a vector to itself is 0', () => {
    const v = fv(0.1, 0.5, 0.9, 0, 1, 0.3, 0.7, 0.2, 0, 0.8, 0.4, 0.6);
    expect(euclideanDistance(v, v)).toBeCloseTo(0, 10);
  });

  it('is symmetric: d(a,b) === d(b,a)', () => {
    const a = fv(0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 0.0, 0.5);
    const b = fv(0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1, 0.0, 1.0, 0.5);
    expect(euclideanDistance(a, b)).toBeCloseTo(euclideanDistance(b, a), 10);
  });

  it('is always non-negative', () => {
    const a = fv(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
    const b = fv(1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1);
    expect(euclideanDistance(a, b)).toBeGreaterThanOrEqual(0);
  });

  it('all-zero vs all-one = sqrt(12)', () => {
    const a = makeZeroVec();
    const b = makeOneVec();
    expect(euclideanDistance(a, b)).toBeCloseTo(Math.sqrt(12), 8);
  });

  it('1D-like: two 12-vecs differing by 1 in one dim = 1', () => {
    const a = makeZeroVec();
    const b = [...makeZeroVec()] as FeatureVector;
    b[0] = 1;
    expect(euclideanDistance(a, b)).toBeCloseTo(1, 8);
  });

  it('satisfies triangle inequality', () => {
    const a = fv(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
    const b = fv(0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5);
    const c = fv(1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1);
    expect(euclideanDistance(a, c)).toBeLessThanOrEqual(
      euclideanDistance(a, b) + euclideanDistance(b, c) + 1e-10
    );
  });

  it('different genomes have non-zero distance', () => {
    const g1 = { ...BASE_GENOME };
    const g2 = { ...BASE_GENOME, archetype: 'MINIMAL_CLEAN' as any, hookStrategy: 'visual_lead' as any };
    const a = encodeFeatureVector(g1, BASE_SCORES);
    const b = encodeFeatureVector(g2, BASE_SCORES);
    expect(euclideanDistance(a, b)).toBeGreaterThan(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// computeNoveltyScores
// ══════════════════════════════════════════════════════════════════════════════
describe('computeNoveltyScores', () => {
  it('returns an array with same length as candidates', () => {
    const candidates = [
      { candidateId: 'c1', featureVector: makeZeroVec() },
      { candidateId: 'c2', featureVector: makeOneVec() },
    ];
    const results = computeNoveltyScores(candidates, []);
    expect(results.length).toBe(2);
  });

  it('each result has candidateId, novelty, archiveDistance, addedToArchive', () => {
    const candidates = [{ candidateId: 'c1', featureVector: makeZeroVec() }];
    const result = computeNoveltyScores(candidates, [])[0]!;
    expect(typeof result.candidateId).toBe('string');
    expect(typeof result.novelty).toBe('number');
    expect(typeof result.archiveDistance).toBe('number');
    expect(typeof result.addedToArchive).toBe('boolean');
  });

  it('novelty scores are in [0, 1]', () => {
    const candidates = [
      { candidateId: 'a', featureVector: makeZeroVec() },
      { candidateId: 'b', featureVector: makeOneVec() },
      { candidateId: 'c', featureVector: fv(0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5) },
    ];
    const results = computeNoveltyScores(candidates, []);
    for (const r of results) {
      expect(r.novelty).toBeGreaterThanOrEqual(0);
      expect(r.novelty).toBeLessThanOrEqual(1);
    }
  });

  it('archiveDistance is in [0, 1]', () => {
    const archive = [makeZeroVec()];
    const candidates = [{ candidateId: 'c1', featureVector: makeOneVec() }];
    const results = computeNoveltyScores(candidates, archive);
    expect(results[0]!.archiveDistance).toBeGreaterThanOrEqual(0);
    expect(results[0]!.archiveDistance).toBeLessThanOrEqual(1);
  });

  it('preserves candidateId in results', () => {
    const candidates = [
      { candidateId: 'alpha', featureVector: makeZeroVec() },
      { candidateId: 'beta',  featureVector: makeOneVec() },
    ];
    const results = computeNoveltyScores(candidates, []);
    const ids = results.map(r => r.candidateId);
    expect(ids).toContain('alpha');
    expect(ids).toContain('beta');
  });

  it('empty candidates returns empty array', () => {
    expect(computeNoveltyScores([], [])).toEqual([]);
  });

  it('candidate far from archive has archiveDistance > 0', () => {
    const archive = [makeZeroVec()];
    const candidates = [{ candidateId: 'far', featureVector: makeOneVec() }];
    const results = computeNoveltyScores(candidates, archive);
    expect(results[0]!.archiveDistance).toBeGreaterThan(0);
  });

  it('candidate identical to archive has archiveDistance near 0', () => {
    const archive = [makeZeroVec()];
    const candidates = [{ candidateId: 'same', featureVector: makeZeroVec() }];
    const results = computeNoveltyScores(candidates, archive);
    expect(results[0]!.archiveDistance).toBeCloseTo(0, 4);
  });

  it('very novel candidate (far from all others) addedToArchive=true', () => {
    // 5 candidates all clustered near zero, one at all-ones (maximally novel)
    const clustered = Array.from({ length: 5 }, (_, i) => ({
      candidateId: `c${i}`,
      featureVector: fv(i * 0.01, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0),
    }));
    const outlier = { candidateId: 'outlier', featureVector: makeOneVec() };
    const results = computeNoveltyScores([...clustered, outlier], []);
    const outlierResult = results.find(r => r.candidateId === 'outlier')!;
    expect(outlierResult.addedToArchive).toBe(true);
  });

  it('archiveDistance=1 when archive is empty', () => {
    const candidates = [{ candidateId: 'c1', featureVector: makeZeroVec() }];
    const results = computeNoveltyScores(candidates, []);
    expect(results[0]!.archiveDistance).toBe(1);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// diversityFilter
// ══════════════════════════════════════════════════════════════════════════════
describe('diversityFilter', () => {
  it('returns empty array when candidates is empty', () => {
    expect(diversityFilter([], 5)).toEqual([]);
  });

  it('returns all candidates when count <= targetCount', () => {
    const candidates = [makeRanked('a', 1, 0.9), makeRanked('b', 2, 0.8)];
    const result = diversityFilter(candidates, 5);
    expect(result.length).toBe(2);
  });

  it('returns exactly targetCount when pool is large enough', () => {
    const candidates = Array.from({ length: 10 }, (_, i) =>
      makeRanked(`c${i}`, i + 1, 0.8 - i * 0.05,
        fv(i/10, i/10, 0, 0, 0, 0, 0, 0, 0, 0.8, 0.7, 0.75)
      )
    );
    const result = diversityFilter(candidates, 4);
    expect(result.length).toBe(4);
  });

  it('first selected candidate is the highest-ranked (rank=1)', () => {
    const candidates = [
      makeRanked('low', 3, 0.5),
      makeRanked('mid', 2, 0.7),
      makeRanked('top', 1, 0.9),
    ];
    const result = diversityFilter(candidates, 2);
    expect(result[0]!.candidateId).toBe('top');
  });

  it('no duplicates in result', () => {
    const candidates = Array.from({ length: 8 }, (_, i) =>
      makeRanked(`c${i}`, i + 1, 0.9 - i * 0.05,
        fv(i/8, 0, i/8, 0, 0, 0, 0, 0, 0, 0.8, 0.6, 0.7)
      )
    );
    const result = diversityFilter(candidates, 4);
    const ids = result.map(r => r.candidateId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('all returned candidates are from the original input', () => {
    const candidates = Array.from({ length: 6 }, (_, i) =>
      makeRanked(`c${i}`, i + 1, 0.8)
    );
    const result = diversityFilter(candidates, 3);
    for (const r of result) {
      expect(candidates).toContain(r);
    }
  });

  it('respects quality floor — candidates below floor excluded when pool allows', () => {
    const good = Array.from({ length: 5 }, (_, i) =>
      makeRanked(`good${i}`, i + 1, 0.8, fv(i/5,0,0,0,0,0,0,0,0,0.8,0.7,0.75))
    );
    const bad = [makeRanked('bad', 10, 0.1, makeZeroVec())];
    const result = diversityFilter([...good, ...bad], 3);
    expect(result.every(r => r.candidateId !== 'bad')).toBe(true);
  });

  it('falls back to all candidates when too few pass quality floor', () => {
    const candidates = [
      makeRanked('a', 1, 0.2),
      makeRanked('b', 2, 0.15),
    ];
    // Both below default floor of 0.30 — should still return up to targetCount
    const result = diversityFilter(candidates, 2);
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  it('targetCount=1 always returns the top-ranked candidate', () => {
    const candidates = [
      makeRanked('a', 2, 0.6),
      makeRanked('b', 1, 0.9),
      makeRanked('c', 3, 0.5),
    ];
    const result = diversityFilter(candidates, 1);
    expect(result.length).toBe(1);
    expect(result[0]!.candidateId).toBe('b');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// buildDiversityClusters
// ══════════════════════════════════════════════════════════════════════════════
describe('buildDiversityClusters', () => {
  it('returns empty array when candidates is empty', () => {
    expect(buildDiversityClusters([])).toEqual([]);
  });

  it('returns exactly k clusters when k <= candidates.length', () => {
    const candidates = Array.from({ length: 9 }, (_, i) =>
      makeRanked(`c${i}`, i + 1, 0.8,
        fv(i/9, i/9, i/9, i/9, 0.5, 0.5, 0.5, 0.5, 0, 0.7, 0.8, 0.75))
    );
    const clusters = buildDiversityClusters(candidates, 3);
    expect(clusters.length).toBe(3);
  });

  it('k larger than candidates returns min(k, candidates.length) clusters', () => {
    const candidates = [makeRanked('a', 1, 0.8), makeRanked('b', 2, 0.7)];
    const clusters = buildDiversityClusters(candidates, 5);
    expect(clusters.length).toBeLessThanOrEqual(2);
  });

  it('every candidate appears in exactly one cluster', () => {
    const candidates = Array.from({ length: 6 }, (_, i) =>
      makeRanked(`c${i}`, i + 1, 0.8,
        fv(i/6, 0, i/6, 0, 0, 0, 0, 0, 0, 0.8, 0.7, 0.75))
    );
    const clusters = buildDiversityClusters(candidates, 3);
    const allMembers = clusters.flatMap(c => c.members);
    expect(new Set(allMembers).size).toBe(candidates.length);
    for (const c of candidates) {
      expect(allMembers).toContain(c.candidateId);
    }
  });

  it('each cluster has a unique clusterId', () => {
    const candidates = Array.from({ length: 6 }, (_, i) =>
      makeRanked(`c${i}`, i + 1, 0.8, makeZeroVec())
    );
    const clusters = buildDiversityClusters(candidates, 3);
    const ids = clusters.map(c => c.clusterId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('each cluster has at least 1 member', () => {
    const candidates = Array.from({ length: 6 }, (_, i) =>
      makeRanked(`c${i}`, i + 1, 0.8, makeZeroVec())
    );
    const clusters = buildDiversityClusters(candidates, 3);
    for (const cluster of clusters) {
      expect(cluster.members.length).toBeGreaterThan(0);
    }
  });

  it('centroid is a 12-element array', () => {
    const candidates = Array.from({ length: 4 }, (_, i) =>
      makeRanked(`c${i}`, i + 1, 0.8, makeZeroVec())
    );
    const clusters = buildDiversityClusters(candidates, 2);
    for (const cluster of clusters) {
      expect(cluster.centroid.length).toBe(12);
    }
  });

  it('intraClusterDistance is a non-negative number', () => {
    const candidates = Array.from({ length: 4 }, (_, i) =>
      makeRanked(`c${i}`, i + 1, 0.8, makeZeroVec())
    );
    const clusters = buildDiversityClusters(candidates, 2);
    for (const cluster of clusters) {
      expect(cluster.intraClusterDistance).toBeGreaterThanOrEqual(0);
    }
  });

  it('single candidate forms one cluster', () => {
    const candidates = [makeRanked('solo', 1, 0.9, makeZeroVec())];
    const clusters = buildDiversityClusters(candidates, 3);
    expect(clusters.length).toBe(1);
    expect(clusters[0]!.members).toContain('solo');
  });
});
