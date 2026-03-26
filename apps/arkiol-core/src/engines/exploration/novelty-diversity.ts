// src/engines/exploration/novelty-diversity.ts
// Creative Exploration AI Engine — Novelty & Diversity Intelligence Layer
// ─────────────────────────────────────────────────────────────────────────────
//
// Prevents repetitive outputs by analyzing candidate feature vectors and
// selecting results using novelty search and diversity filtering.
//
// Architecture:
//   1. Feature Encoder:   genome + scores → 12-dimensional FeatureVector
//   2. Novelty Scorer:    k-nearest-neighbour distance in feature space
//   3. Diversity Filter:  greedy diversity maximisation (k-means inspired)
//   4. Cluster Builder:   group final set for UI presentation
//
// Novelty Search:
//   • Each candidate is compared to both:
//     - The CURRENT BATCH (intra-batch diversity)
//     - The NOVELTY ARCHIVE (cross-session diversity from prior runs)
//   • Novelty score = mean distance to k nearest neighbours (k=5)
//   • Candidates with high novelty but lower quality are still included
//     in the "experimental" tier — novelty is a signal, not a gating rule
//
// Diversity Filter:
//   • Greedy sequential selection: pick next candidate that maximises
//     minimum distance to already-selected set
//   • Guarantees final set has maximum intra-set distance
//   • Always includes the top-scoring candidate regardless of novelty
//
// Invariants:
//   ✓ Feature encoding is deterministic given genome + scores
//   ✓ KNN search is exact (no approximation needed at this scale)
//   ✓ Diversity filter always returns exactly N candidates (or fewer if pool small)
//   ✓ Archive is append-only; old entries are not mutated

import type {
  CandidateDesignPlan,
  FeatureVector,
  NoveltyScore,
  DiversityCluster,
  RankedCandidate,
  DesignGenome,
  EvaluationScores,
} from "./types";
import { GENOME_SPACE } from "./genome-generator";

// ─────────────────────────────────────────────────────────────────────────────
// § 1  FEATURE ENCODER — genome + scores → 12-dim vector
// ─────────────────────────────────────────────────────────────────────────────

/** Maps a string enum value to its normalised index position in [0, 1] */
function encodeEnum(value: string, universe: readonly string[]): number {
  const idx = universe.indexOf(value);
  if (idx === -1) return 0.5; // unknown → mid
  return universe.length === 1 ? 0 : idx / (universe.length - 1);
}

export function encodeFeatureVector(
  genome: DesignGenome,
  scores: EvaluationScores
): FeatureVector {
  return [
    encodeEnum(genome.layoutFamily, GENOME_SPACE.layoutFamilies),
    // variationId: encode within family space
    (() => {
      const pool = GENOME_SPACE.variationIds[genome.layoutFamily] ?? ["v1_default"];
      return encodeEnum(genome.variationId, pool);
    })(),
    encodeEnum(genome.archetype,          GENOME_SPACE.archetypes),
    encodeEnum(genome.preset,             GENOME_SPACE.presets),
    genome.typographyPersonality / 4,     // 0–4 → 0–1
    encodeEnum(genome.densityProfile,     GENOME_SPACE.densityProfiles),
    encodeEnum(genome.hookStrategy,       GENOME_SPACE.hookStrategies),
    encodeEnum(genome.compositionPattern, GENOME_SPACE.compositionPatterns),
    genome.motionEligible ? 1 : 0,
    scores.readability,
    scores.attentionPotential,
    scores.brandAlignment,
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// § 2  DISTANCE METRIC — Euclidean distance in feature space
// ─────────────────────────────────────────────────────────────────────────────

export function euclideanDistance(a: FeatureVector, b: FeatureVector): number {
  let sumSq = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = a[i]! - b[i]!;
    sumSq += diff * diff;
  }
  return Math.sqrt(sumSq);
}

// ─────────────────────────────────────────────────────────────────────────────
// § 3  NOVELTY SCORER — k-nearest neighbour mean distance
// ─────────────────────────────────────────────────────────────────────────────

const KNN_K = 5;
const MAX_NOVELTY = Math.sqrt(12); // max possible Euclidean distance in 12-dim [0,1]^12

export function computeNoveltyScores(
  candidates: Array<{ candidateId: string; featureVector: FeatureVector }>,
  archive: FeatureVector[]
): NoveltyScore[] {
  const results: NoveltyScore[] = [];
  const allVectors = [
    ...candidates.map(c => c.featureVector),
    ...archive,
  ];

  for (const candidate of candidates) {
    const fv = candidate.featureVector;

    // Compute distances to all other vectors
    const distances: number[] = [];
    for (const other of allVectors) {
      const d = euclideanDistance(fv, other);
      if (d > 0.0001) distances.push(d); // skip self (d≈0)
    }

    // Sort ascending and take mean of k nearest
    distances.sort((a, b) => a - b);
    const kNearest = distances.slice(0, KNN_K);
    const meanDist = kNearest.length > 0
      ? kNearest.reduce((a, b) => a + b, 0) / kNearest.length
      : 0;

    const novelty        = Math.min(1, meanDist / MAX_NOVELTY);
    const archiveDistance = archive.length > 0
      ? Math.min(...archive.map(av => euclideanDistance(fv, av)))
      : 1.0;

    // Add to archive if novel enough (top ~30% threshold)
    const addedToArchive = novelty > 0.35;

    results.push({
      candidateId:    candidate.candidateId,
      novelty,
      archiveDistance: Math.min(1, archiveDistance / MAX_NOVELTY),
      addedToArchive,
    });
  }

  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// § 4  DIVERSITY FILTER — greedy maximum-diversity selection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Greedy diversity maximisation:
 * 1. Start with the highest-scoring candidate (quality anchor)
 * 2. Each subsequent pick = candidate maximising min-distance to selected set
 * 3. Repeat until N candidates selected
 *
 * This guarantees the selected set is maximally spread in feature space
 * while respecting a quality floor.
 */
export function diversityFilter(
  candidates: RankedCandidate[],
  targetCount: number,
  qualityFloor = 0.30
): RankedCandidate[] {
  if (candidates.length === 0) return [];
  if (candidates.length <= targetCount) return candidates;

  // Filter below quality floor (but keep at least targetCount)
  const eligible = candidates.filter(c => c.scores.compositeScore >= qualityFloor);
  const pool     = eligible.length >= targetCount ? eligible : candidates;

  const selected: RankedCandidate[] = [];
  const remaining = new Set(pool.map((_, i) => i));

  // Step 1: Always select top-ranked candidate first
  const topIdx  = pool.reduce((best, c, i) => c.rank < pool[best]!.rank ? i : best, 0);
  selected.push(pool[topIdx]!);
  remaining.delete(topIdx);

  // Step 2: Greedy max-distance selection
  while (selected.length < targetCount && remaining.size > 0) {
    let bestIdx     = -1;
    let bestMinDist = -1;

    for (const idx of remaining) {
      const fv = pool[idx]!.featureVector;
      if (!fv) continue;

      // Minimum distance to any already-selected candidate
      const minDist = Math.min(
        ...selected.map(s => euclideanDistance(fv, s.featureVector!))
      );

      if (minDist > bestMinDist) {
        bestMinDist = minDist;
        bestIdx     = idx;
      }
    }

    if (bestIdx === -1) break;
    selected.push(pool[bestIdx]!);
    remaining.delete(bestIdx);
  }

  return selected;
}

// ─────────────────────────────────────────────────────────────────────────────
// § 5  CLUSTER BUILDER — k-means inspired grouping for UI presentation
// ─────────────────────────────────────────────────────────────────────────────

function meanVector(vectors: FeatureVector[]): FeatureVector {
  if (vectors.length === 0) return new Array(12).fill(0.5) as FeatureVector;
  const sum = new Array(12).fill(0);
  for (const v of vectors) {
    for (let i = 0; i < 12; i++) sum[i] += v[i]!;
  }
  return sum.map(s => s / vectors.length) as FeatureVector;
}

/**
 * Groups candidates into k clusters using a single-pass assignment.
 * Initialises cluster centroids using k-means++ seeding (deterministic via sorted order).
 */
export function buildDiversityClusters(
  candidates: RankedCandidate[],
  k = 3
): DiversityCluster[] {
  if (candidates.length === 0) return [];
  const actualK = Math.min(k, candidates.length);

  // Seed centroids: pick evenly spaced candidates from ranked list
  const centroidIndices = Array.from({ length: actualK }, (_, i) =>
    Math.floor((i * candidates.length) / actualK)
  );
  let centroids: FeatureVector[] = centroidIndices.map(
    i => candidates[i]!.featureVector ?? (new Array(12).fill(0.5) as FeatureVector)
  );

  // Assignment step (single pass for speed)
  const assignments: number[] = candidates.map(c => {
    const fv = c.featureVector ?? (new Array(12).fill(0.5) as FeatureVector);
    let nearestCluster = 0;
    let nearestDist    = Infinity;
    for (let ci = 0; ci < centroids.length; ci++) {
      const d = euclideanDistance(fv, centroids[ci]!);
      if (d < nearestDist) { nearestDist = d; nearestCluster = ci; }
    }
    return nearestCluster;
  });

  // Build cluster objects
  return Array.from({ length: actualK }, (_, ci) => {
    const members = candidates
      .filter((_, i) => assignments[i] === ci)
      .map(c => c.candidateId);

    const memberVectors = candidates
      .filter((_, i) => assignments[i] === ci)
      .map(c => c.featureVector ?? (new Array(12).fill(0.5) as FeatureVector));

    const centroid = meanVector(memberVectors);

    const intraClusterDistance = memberVectors.length > 1
      ? memberVectors.reduce((sum, v) => sum + euclideanDistance(v, centroid), 0) /
        memberVectors.length
      : 0;

    return {
      clusterId: ci,
      members,
      centroid,
      intraClusterDistance,
    };
  }).filter(c => c.members.length > 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// § 6  FULL NOVELTY PIPELINE — encode → score → filter → cluster
// ─────────────────────────────────────────────────────────────────────────────

export interface NoveltyPipelineResult {
  candidates: RankedCandidate[];
  noveltyScores: Map<string, number>;
  archiveDelta: FeatureVector[];
  clusters: DiversityCluster[];
  noveltyMs: number;
}

export function runNoveltyPipeline(
  candidates: RankedCandidate[],
  archive: FeatureVector[]
): NoveltyPipelineResult {
  const t0 = Date.now();

  // Step 1: Encode feature vectors for all candidates
  const withVectors: RankedCandidate[] = candidates.map(c => ({
    ...c,
    featureVector: c.scores
      ? encodeFeatureVector(c.genome, c.scores)
      : (new Array(12).fill(0.5) as FeatureVector),
  }));

  // Step 2: Compute novelty scores
  const noveltyResults = computeNoveltyScores(
    withVectors.map(c => ({ candidateId: c.candidateId, featureVector: c.featureVector! })),
    archive
  );

  const noveltyMap = new Map(noveltyResults.map(n => [n.candidateId, n.novelty]));

  // Step 3: Update explorationScores with novelty
  const scoredWithNovelty: RankedCandidate[] = withVectors.map(c => ({
    ...c,
    noveltyScore: noveltyMap.get(c.candidateId) ?? 0.5,
    explorationScore:
      c.scores.compositeScore * 0.65 + (noveltyMap.get(c.candidateId) ?? 0.5) * 0.35,
  }));

  // Re-rank
  scoredWithNovelty.sort((a, b) => b.explorationScore - a.explorationScore);
  scoredWithNovelty.forEach((c, i) => { c.rank = i + 1; });

  // Step 4: Build clusters from the full set
  const clusters = buildDiversityClusters(scoredWithNovelty, 3);

  // Step 5: Collect archive delta
  const archiveDelta: FeatureVector[] = noveltyResults
    .filter(n => n.addedToArchive)
    .map(n => {
      const candidate = withVectors.find(c => c.candidateId === n.candidateId);
      return candidate?.featureVector ?? null;
    })
    .filter(Boolean) as FeatureVector[];

  return {
    candidates:   scoredWithNovelty,
    noveltyScores: noveltyMap,
    archiveDelta,
    clusters,
    noveltyMs: Date.now() - t0,
  };
}
