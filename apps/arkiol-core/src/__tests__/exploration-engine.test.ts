// src/__tests__/exploration-engine.test.ts
// Creative Exploration AI Engine — Comprehensive Test Suite
// ─────────────────────────────────────────────────────────────────────────────
//
// Tests cover all 5 sub-modules:
//   1. Genome Generator     — determinism, gene validity, prior weighting
//   2. Constraint Repair    — violation detection, repair strategies, discard
//   3. Evaluator            — score correctness, tier classification, ranking
//   4. Novelty & Diversity  — feature encoding, KNN distance, diversity filter
//   5. Learning Memory      — feedback application, weight normalisation, migration
//   6. Engine Orchestrator  — end-to-end, idempotency, empty results, fallbacks

import { describe, it, expect } from "@jest/globals";

// ─── Module imports ───────────────────────────────────────────────────────────
import {
  buildGenome,
  buildCandidate,
  generateGenomePool,
  GENOME_SPACE,
} from "../engines/exploration/genome-generator";

import {
  checkAndRepairCandidate,
  checkAndRepairBatch,
} from "../engines/exploration/constraint-repair";

import {
  evaluateCandidate,
  evaluateBatch,
  classifyConfidenceTier,
  buildRankedCandidates,
} from "../engines/exploration/evaluator";

import {
  encodeFeatureVector,
  euclideanDistance,
  computeNoveltyScores,
  diversityFilter,
  buildDiversityClusters,
  runNoveltyPipeline,
} from "../engines/exploration/novelty-diversity";

import {
  buildDefaultPriors,
  applyFeedback,
  applyFeedbackBatch,
  buildFeedbackSignal,
  buildPriorsDiagnostic,
  migratePriors,
} from "../engines/exploration/learning-memory";

import {
  runExploration,
  buildExploreInput,
  deriveExploreSeed,
} from "../engines/exploration/engine";

import type {
  DesignGenome,
  CandidateDesignPlan,
  EvaluationScores,
  ExploreInput,
  ExplorePipelineContext,
  ExplorationPriors,
  FeatureVector,
} from "../engines/exploration/types";

// ─────────────────────────────────────────────────────────────────────────────
// § TEST FIXTURES
// ─────────────────────────────────────────────────────────────────────────────

const MOCK_CONTEXT: ExplorePipelineContext = {
  intent:               "Promote summer sale",
  format:               "instagram_post",
  audienceSegment:      "consumer",
  tonePreference:       "playful",
  layoutType:           "hero",
  brandPrimaryColor:    "#FF6B35",
  brandSecondaryColor:  "#004E89",
  brandPrefersDarkBg:   false,
  brandToneKeywords:    ["fun", "energetic"],
  densityTextBlockCount: 3,
  imageProvided:         true,
};

const MOCK_SEED = "test-seed-abc123";

function makeCandidate(overrides: Partial<DesignGenome> = {}): CandidateDesignPlan {
  const genome: DesignGenome = {
    layoutFamily:          "ig_post",
    variationId:           "v1_split",
    archetype:             "BOLD_CLAIM",      // correct ArchetypeId (was "bold_hero")
    preset:                "bold",            // correct StylePresetId (was "bold_impact")
    typographyPersonality: 0,
    densityProfile:        "balanced",
    hookStrategy:          "visual_lead",
    compositionPattern:    "rule_of_thirds",
    motionEligible:        false,
    ...overrides,
  };
  return {
    candidateId:       `test-${Math.random().toString(36).slice(2)}`,
    seed:              MOCK_SEED,
    genome,
    generationIndex:   0,
    format:            "instagram_post",
    layoutCategory:    "instagram" as any,
    constraintsPassed: false,
    repairLog:         [],
    generatedAt:       new Date().toISOString(),
  };
}

function makeScores(overrides: Partial<EvaluationScores> = {}): EvaluationScores {
  return {
    readability:            0.80,
    visualHierarchyClarity: 0.75,
    platformOptimization:   0.70,
    brandAlignment:         0.78,
    visualBalance:          0.72,
    attentionPotential:     0.85,
    compositeScore:         0.77,
    weakestDimension:       "platformOptimization",
    evaluationMs:           1,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// § 1  GENOME GENERATOR TESTS
// ─────────────────────────────────────────────────────────────────────────────

describe("GenomeGenerator", () => {
  it("produces identical genomes for same seed + index", () => {
    const g1 = buildGenome(MOCK_SEED, 0, "instagram_post", MOCK_CONTEXT);
    const g2 = buildGenome(MOCK_SEED, 0, "instagram_post", MOCK_CONTEXT);
    expect(g1).toEqual(g2);
  });

  it("produces different genomes for different indices", () => {
    const g0 = buildGenome(MOCK_SEED, 0, "instagram_post", MOCK_CONTEXT);
    const g1 = buildGenome(MOCK_SEED, 1, "instagram_post", MOCK_CONTEXT);
    // They should differ in at least one gene (extremely high probability)
    const identical = JSON.stringify(g0) === JSON.stringify(g1);
    expect(identical).toBe(false);
  });

  it("all gene values are from valid universe", () => {
    for (let i = 0; i < 20; i++) {
      const g = buildGenome(MOCK_SEED, i, "instagram_post", MOCK_CONTEXT);
      expect(GENOME_SPACE.archetypes).toContain(g.archetype);
      expect(GENOME_SPACE.presets).toContain(g.preset);
      expect(GENOME_SPACE.hookStrategies).toContain(g.hookStrategy);
      expect(GENOME_SPACE.compositionPatterns).toContain(g.compositionPattern);
      expect(GENOME_SPACE.densityProfiles).toContain(g.densityProfile);
      expect([0, 1, 2, 3, 4]).toContain(g.typographyPersonality);
    }
  });

  it("layoutFamily is always correct for given format", () => {
    const g = buildGenome(MOCK_SEED, 0, "instagram_post", MOCK_CONTEXT);
    expect(g.layoutFamily).toBe("ig_post");

    const g2 = buildGenome(MOCK_SEED, 0, "youtube_thumbnail", MOCK_CONTEXT);
    expect(g2.layoutFamily).toBe("yt_thumb");
  });

  it("motionEligible=false for non-motion formats", () => {
    const ctx = { ...MOCK_CONTEXT, format: "resume" };
    // resume is not in GIF_ELIGIBLE_FORMATS
    for (let i = 0; i < 10; i++) {
      const g = buildGenome(MOCK_SEED, i, "resume", ctx);
      expect(g.motionEligible).toBe(false);
    }
  });

  it("generateGenomePool returns poolSize candidates", () => {
    const result = generateGenomePool({
      masterSeed: MOCK_SEED,
      format:     "instagram_post",
      poolSize:   24,
      context:    MOCK_CONTEXT,
    });
    expect(result.candidates).toHaveLength(24);
  });

  it("pool is deterministic across calls", () => {
    const r1 = generateGenomePool({ masterSeed: MOCK_SEED, format: "instagram_post", poolSize: 10, context: MOCK_CONTEXT });
    const r2 = generateGenomePool({ masterSeed: MOCK_SEED, format: "instagram_post", poolSize: 10, context: MOCK_CONTEXT });
    expect(r1.candidates.map(c => c.candidateId)).toEqual(r2.candidates.map(c => c.candidateId));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// § 2  CONSTRAINT REPAIR TESTS
// ─────────────────────────────────────────────────────────────────────────────

describe("ConstraintRepair", () => {
  it("valid candidate passes without repair", () => {
    const candidate = makeCandidate();
    const { candidate: checked, report } = checkAndRepairCandidate(candidate);
    expect(report.passed).toBe(true);
    expect(report.discarded).toBe(false);
  });

  it("repairs motion on non-motion format", () => {
    const candidate = makeCandidate({ motionEligible: true });
    const nonMotionCandidate = { ...candidate, format: "resume" };
    const { candidate: checked, report } = checkAndRepairCandidate(nonMotionCandidate);
    expect(checked.genome.motionEligible).toBe(false);
    expect(report.repairCount).toBeGreaterThan(0);
  });

  it("repairs dense density overflow for platform", () => {
    const candidate = makeCandidate({ densityProfile: "dense" });
    const logoCandidate = { ...candidate, format: "logo" };
    const { candidate: checked, report } = checkAndRepairCandidate(logoCandidate);
    // Logo maxTextZones=2, dense=7 zones → should be repaired
    expect(["sparse", "balanced", "rich"]).toContain(checked.genome.densityProfile);
  });

  it("batch checker returns valid + discarded split", () => {
    const candidates = [
      makeCandidate(),
      makeCandidate(),
      { ...makeCandidate({ motionEligible: true }), format: "resume" },
    ];
    const result = checkAndRepairBatch(candidates);
    // All should be valid (motion on resume is repairable)
    expect(result.validCandidates.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// § 3  EVALUATOR TESTS
// ─────────────────────────────────────────────────────────────────────────────

describe("Evaluator", () => {
  it("scores are in [0, 1]", () => {
    const candidate = { ...makeCandidate(), constraintsPassed: true };
    const scores = evaluateCandidate(candidate, MOCK_CONTEXT);

    expect(scores.readability).toBeGreaterThanOrEqual(0);
    expect(scores.readability).toBeLessThanOrEqual(1);
    expect(scores.compositeScore).toBeGreaterThanOrEqual(0);
    expect(scores.compositeScore).toBeLessThanOrEqual(1);
  });

  it("evaluation is deterministic", () => {
    const candidate = { ...makeCandidate(), constraintsPassed: true };
    const s1 = evaluateCandidate(candidate, MOCK_CONTEXT);
    const s2 = evaluateCandidate(candidate, MOCK_CONTEXT);
    expect(s1.compositeScore).toBe(s2.compositeScore);
  });

  it("classifies confidence tiers correctly", () => {
    expect(classifyConfidenceTier(0.85)).toBe("high_confidence");
    expect(classifyConfidenceTier(0.60)).toBe("experimental");
    expect(classifyConfidenceTier(0.30)).toBe("speculative");
  });

  it("weakestDimension is always a valid dimension key", () => {
    const validDimensions = [
      "readability", "visualHierarchyClarity", "platformOptimization",
      "brandAlignment", "visualBalance", "attentionPotential",
    ];
    for (let i = 0; i < 10; i++) {
      const candidate = { ...makeCandidate(), constraintsPassed: true };
      const scores = evaluateCandidate(candidate, MOCK_CONTEXT);
      expect(validDimensions).toContain(scores.weakestDimension);
    }
  });

  it("buildRankedCandidates assigns ascending ranks", () => {
    const candidates = Array.from({ length: 5 }, (_, i) => ({
      ...makeCandidate(),
      constraintsPassed: true,
      scores: makeScores({ compositeScore: 0.5 + i * 0.05 }),
      confidenceTier: "high_confidence" as const,
    }));
    const ranked = buildRankedCandidates(candidates, new Map(), 0.7);
    const ranks = ranked.map(c => c.rank);
    expect(ranks).toEqual([1, 2, 3, 4, 5]);
    // Ranks should be descending by explorationScore
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i-1]!.explorationScore).toBeGreaterThanOrEqual(ranked[i]!.explorationScore);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// § 4  NOVELTY & DIVERSITY TESTS
// ─────────────────────────────────────────────────────────────────────────────

describe("NoveltyDiversity", () => {
  it("encodeFeatureVector returns 12-dim array in [0,1]", () => {
    const genome: DesignGenome = {
      layoutFamily: "ig_post", variationId: "v1_split",
      archetype: "BOLD_CLAIM", preset: "bold",   // correct IDs
      typographyPersonality: 2, densityProfile: "balanced",
      hookStrategy: "visual_lead", compositionPattern: "rule_of_thirds",
      motionEligible: false,
    };
    const scores = makeScores();
    const fv = encodeFeatureVector(genome, scores);
    expect(fv).toHaveLength(12);
    for (const v of fv) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("euclideanDistance(x, x) = 0", () => {
    const fv: FeatureVector = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.1, 0.2, 0.3];
    expect(euclideanDistance(fv, fv)).toBe(0);
  });

  it("diversityFilter returns exactly targetCount candidates", () => {
    const candidates = Array.from({ length: 20 }, (_, i) => ({
      ...makeCandidate(),
      constraintsPassed: true,
      scores:         makeScores({ compositeScore: 0.5 + (i % 5) * 0.05 }),
      noveltyScore:   0.5,
      explorationScore: 0.5,
      confidenceTier: "high_confidence" as const,
      rank:           i + 1,
      featureVector:  Array.from({ length: 12 }, () => Math.random()) as FeatureVector,
    }));

    const selected = diversityFilter(candidates, 6);
    expect(selected).toHaveLength(6);
  });

  it("diversityFilter includes top-ranked candidate", () => {
    const topCandidate = {
      ...makeCandidate(),
      constraintsPassed: true,
      scores:         makeScores({ compositeScore: 0.95 }),
      noveltyScore:   0.9,
      explorationScore: 0.93,
      confidenceTier: "high_confidence" as const,
      rank:           1,
      featureVector:  new Array(12).fill(0.1) as FeatureVector,
    };

    const others = Array.from({ length: 10 }, (_, i) => ({
      ...makeCandidate(),
      constraintsPassed: true,
      scores:         makeScores({ compositeScore: 0.5 }),
      noveltyScore:   0.5,
      explorationScore: 0.5,
      confidenceTier: "experimental" as const,
      rank:           i + 2,
      featureVector:  new Array(12).fill(0.5 + i * 0.04) as FeatureVector,
    }));

    const selected = diversityFilter([topCandidate, ...others], 5);
    expect(selected.some(c => c.candidateId === topCandidate.candidateId)).toBe(true);
  });

  it("buildDiversityClusters returns k clusters", () => {
    const candidates = Array.from({ length: 9 }, (_, i) => ({
      ...makeCandidate(),
      constraintsPassed: true,
      scores:         makeScores(),
      noveltyScore:   0.5,
      explorationScore: 0.5,
      confidenceTier: "high_confidence" as const,
      rank:           i + 1,
      featureVector:  Array.from({ length: 12 }, (_, j) => (i + j) / 20) as FeatureVector,
    }));

    const clusters = buildDiversityClusters(candidates, 3);
    expect(clusters.length).toBeLessThanOrEqual(3);
    const allMembers = clusters.flatMap(c => c.members);
    expect(allMembers.length).toBe(9);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// § 5  LEARNING & MEMORY TESTS
// ─────────────────────────────────────────────────────────────────────────────

describe("LearningMemory", () => {
  it("buildDefaultPriors weights sum to 1 per dimension", () => {
    const priors = buildDefaultPriors("org-123");
    const archetypeSum = Object.values(priors.archetypeWeights).reduce((a, b) => a + b, 0);
    expect(Math.abs(archetypeSum - 1)).toBeLessThan(0.001);
  });

  it("applyFeedback increases weight of selected archetype", () => {
    const priors = buildDefaultPriors("org-123");
    const signal = buildFeedbackSignal({
      userId: "user-1",
      orgId: "org-123",
      candidateId: "cand-1",
      genome: makeCandidate().genome,
      scores: makeScores(),
      signalType: "selected",
      format: "instagram_post",
    });

    const updated = applyFeedback(priors, signal);
    const archetype = signal.genome.archetype;
    expect(updated.archetypeWeights[archetype]).toBeGreaterThan(priors.archetypeWeights[archetype]!);
  });

  it("applyFeedback decreases weight for dismissed signal", () => {
    const priors = buildDefaultPriors("org-123");
    const signal = buildFeedbackSignal({
      userId: "user-1",
      orgId: "org-123",
      candidateId: "cand-1",
      genome: makeCandidate().genome,
      scores: makeScores(),
      signalType: "dismissed",
      format: "instagram_post",
    });

    const updated = applyFeedback(priors, signal);
    const archetype = signal.genome.archetype;
    // After dismissal, weight should decrease (or hit floor)
    expect(updated.archetypeWeights[archetype]).toBeLessThanOrEqual(
      priors.archetypeWeights[archetype]!
    );
  });

  it("weights remain normalised after multiple feedback applications", () => {
    let priors = buildDefaultPriors("org-123");
    for (let i = 0; i < 20; i++) {
      const signal = buildFeedbackSignal({
        userId: "user-1",
        orgId: "org-123",
        candidateId: `cand-${i}`,
        genome: makeCandidate().genome,
        scores: makeScores(),
        signalType: i % 3 === 0 ? "dismissed" : "selected",
        format: "instagram_post",
      });
      priors = applyFeedback(priors, signal);
    }

    const archetypeSum = Object.values(priors.archetypeWeights).reduce((a, b) => a + b, 0);
    expect(Math.abs(archetypeSum - 1)).toBeLessThan(0.01);
  });

  it("exploration temperature decreases with more signals", () => {
    let priors = buildDefaultPriors("org-123");
    const initialTemp = priors.explorationTemperature;

    // Process 30 signals (3 batches of 10 to trigger temperature drops)
    for (let i = 0; i < 30; i++) {
      const signal = buildFeedbackSignal({
        userId: "user-1",
        orgId:  "org-123",
        candidateId: `cand-${i}`,
        genome:  makeCandidate().genome,
        scores:  makeScores(),
        signalType: "selected",
        format:  "instagram_post",
      });
      priors = applyFeedback(priors, signal);
    }

    expect(priors.explorationTemperature).toBeLessThanOrEqual(initialTemp);
    expect(priors.explorationTemperature).toBeGreaterThanOrEqual(0.20); // floor
  });

  it("migratePriors returns defaults for invalid input", () => {
    const priors = migratePriors(null, "org-123");
    expect(priors.orgId).toBe("org-123");
    expect(priors.schemaVersion).toBe(1);
  });

  it("migratePriors preserves totalSignals during upgrade", () => {
    const old = { totalSignals: 42, schemaVersion: 0 };
    const priors = migratePriors(old, "org-123");
    expect(priors.totalSignals).toBe(42);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// § 6  ENGINE ORCHESTRATOR TESTS
// ─────────────────────────────────────────────────────────────────────────────

describe("ExplorationEngine", () => {
  it("runExploration returns valid ExploreResult", async () => {
    const input: ExploreInput = {
      runId:               "test-run-1",
      seed:                MOCK_SEED,
      format:              "instagram_post",
      poolSize:            24,
      targetResultCount:   8,
      highConfidenceRatio: 0.60,
      pipelineContext:     MOCK_CONTEXT,
    };

    const result = await runExploration(input);
    expect(result.runId).toBe("test-run-1");
    expect(result.seed).toBe(MOCK_SEED);
    expect(Array.isArray(result.highConfidence)).toBe(true);
    expect(Array.isArray(result.experimental)).toBe(true);
    expect(result.stats.totalExploreMs).toBeGreaterThan(0);
  });

  it("runExploration is idempotent (same seed → same result)", async () => {
    const input: ExploreInput = {
      runId:           "test-idem-1",
      seed:            MOCK_SEED,
      format:          "instagram_post",
      poolSize:        12,
      targetResultCount: 6,
      highConfidenceRatio: 0.5,
      pipelineContext: MOCK_CONTEXT,
    };

    const r1 = await runExploration(input);
    const r2 = await runExploration(input);

    // Same seed → same candidateIds in same order
    expect(r1.rankedResults.map(c => c.candidateId)).toEqual(
      r2.rankedResults.map(c => c.candidateId)
    );
  });

  it("runExploration high-confidence + experimental count ≤ targetResultCount", async () => {
    const input: ExploreInput = {
      runId:               "test-count-1",
      seed:                MOCK_SEED,
      format:              "instagram_post",
      poolSize:            30,
      targetResultCount:   10,
      highConfidenceRatio: 0.6,
      pipelineContext:     MOCK_CONTEXT,
    };

    const result = await runExploration(input);
    const total = result.highConfidence.length + result.experimental.length;
    expect(total).toBeLessThanOrEqual(10);
  });

  it("deriveExploreSeed is deterministic", () => {
    const s1 = deriveExploreSeed("job-abc", "instagram_post", "summer sale");
    const s2 = deriveExploreSeed("job-abc", "instagram_post", "summer sale");
    expect(s1).toBe(s2);
  });

  it("different seeds produce different results", async () => {
    const base: Omit<ExploreInput, "runId" | "seed"> = {
      format:              "instagram_post",
      poolSize:            16,
      targetResultCount:   6,
      highConfidenceRatio: 0.5,
      pipelineContext:     MOCK_CONTEXT,
    };

    const r1 = await runExploration({ ...base, runId: "r1", seed: "seed-aaa" });
    const r2 = await runExploration({ ...base, runId: "r2", seed: "seed-bbb" });

    const ids1 = new Set(r1.rankedResults.map(c => c.candidateId));
    const ids2 = new Set(r2.rankedResults.map(c => c.candidateId));
    const overlap = [...ids1].filter(id => ids2.has(id));
    expect(overlap.length).toBe(0); // completely different candidate sets
  });

  it("noveltyArchiveDelta is an array of FeatureVectors", async () => {
    const result = await runExploration({
      runId:               "test-archive-1",
      seed:                MOCK_SEED,
      format:              "instagram_post",
      poolSize:            20,
      targetResultCount:   8,
      highConfidenceRatio: 0.5,
      pipelineContext:     MOCK_CONTEXT,
    });

    expect(Array.isArray(result.noveltyArchiveDelta)).toBe(true);
    for (const fv of result.noveltyArchiveDelta) {
      expect(fv).toHaveLength(12);
    }
  });

  it("stats.poolGenerated matches poolSize", async () => {
    const result = await runExploration({
      runId:               "test-stats-1",
      seed:                MOCK_SEED,
      format:              "instagram_post",
      poolSize:            20,
      targetResultCount:   8,
      highConfidenceRatio: 0.5,
      pipelineContext:     MOCK_CONTEXT,
    });

    expect(result.stats.poolGenerated).toBe(20);
    expect(result.stats.poolAfterConstraints).toBeLessThanOrEqual(20);
    expect(result.stats.finalCurated).toBeLessThanOrEqual(8);
  });
});
