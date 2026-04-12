// src/engines/exploration/engine.ts
// Creative Exploration AI Engine — Main Orchestrator
// ─────────────────────────────────────────────────────────────────────────────
//
// Top-level entry point for the Creative Exploration AI Engine.
// Operates as a strict sandbox AFTER the existing 8-stage core pipeline
// (Intent → Layout → Variation → Audience → Density → Brand → Render → Archetype)
// and BEFORE final rendering, injecting a curated set of creative candidates
// back into the pipeline.
//
// Execution Order:
//   Stage E1: Genome Pool Generation  — deterministic seed-based candidate pool
//   Stage E2: Constraint & Repair     — validate + auto-repair violations
//   Stage E3: Multi-Objective Scoring — 6-dimension deterministic evaluation
//   Stage E4: Novelty & Diversity     — feature-space diversity maximisation
//   Stage E5: Curation                — split high-confidence + experimental
//
// Execution Contract:
//   ✓ Same seed + context ALWAYS produces the same ExploreResult (idempotent)
//   ✓ All stages execute sequentially with schema-validated hand-off
//   ✓ Every stage has a deterministic fallback — engine NEVER throws
//   ✓ All timing, errors, and fallbacks are emitted to observability channel
//   ✓ No mutations across stages — each stage returns a new immutable set
//   ✓ Pool sizes, diversity parameters, and confidence thresholds are configurable
//
// Integration Points:
//   • Input:  OrchestratorResult from pipeline-orchestrator.ts (Stages 1–8)
//   • Output: ExploreResult with ranked candidates ready for renderer selection
//   • Feedback: ExploreResult.rankedResults feed into the Learning System

import { createHash } from "crypto";
import { generateGenomePool } from "./genome-generator";
import { checkAndRepairBatch } from "./constraint-repair";
import { evaluateBatch, buildRankedCandidates } from "./evaluator";
import { runNoveltyPipeline, diversityFilter } from "./novelty-diversity";
import { buildDefaultPriors } from "./learning-memory";
// Integration bridge — must be at top with all other imports
import type { OrchestratorResult, OrchestratorInput } from "../ai/pipeline-orchestrator";
import type {
  ExploreInput,
  ExploreResult,
  ExploreStats,
  RankedCandidate,
  CandidateDesignPlan,
  ExploreObservabilityEmitter,
  ExploreObservabilityEvent,
} from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// § 1  DEFAULT PARAMETERS
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_POOL_SIZE           = 48;
const DEFAULT_TARGET_RESULT_COUNT = 12;
const DEFAULT_HIGH_CONFIDENCE_RATIO = 0.60;

// ─────────────────────────────────────────────────────────────────────────────
// § 2  OBSERVABILITY HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function emit(
  emitter: ExploreObservabilityEmitter | undefined,
  eventType: ExploreObservabilityEvent["eventType"],
  runId: string,
  data: Record<string, unknown>
): void {
  if (!emitter) return;
  try {
    emitter({
      eventType,
      runId,
      timestamp: new Date().toISOString(),
      data,
    });
  } catch {
    // Observability must never throw
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// § 3  SEED DERIVATION — deterministic run identity
// ─────────────────────────────────────────────────────────────────────────────

export function deriveExploreSeed(
  jobId: string,
  format: string,
  intent: string
): string {
  return createHash("sha256")
    .update(`explore:${jobId}:${format}:${intent}`)
    .digest("hex")
    .slice(0, 32);
}

// ─────────────────────────────────────────────────────────────────────────────
// § 4  CURATION SPLITTER — splits ranked results into high-confidence + experimental
// ─────────────────────────────────────────────────────────────────────────────

function splitCuratedResults(
  ranked: RankedCandidate[],
  targetCount: number,
  highConfidenceRatio: number
): {
  highConfidence: RankedCandidate[];
  experimental:   RankedCandidate[];
  all:            RankedCandidate[];
} {
  const targetHigh = Math.round(targetCount * highConfidenceRatio);
  const targetExp  = targetCount - targetHigh;

  // Separate by confidence tier, preserving rank order
  const highConf = ranked.filter(c => c.confidenceTier === "high_confidence");
  const expConf  = ranked.filter(c => c.confidenceTier !== "high_confidence");

  // Fill high-confidence slot; if not enough HC candidates, backfill with experimental
  const selectedHigh = highConf.slice(0, targetHigh);
  const backfill     = targetHigh - selectedHigh.length;
  const selectedExp  = expConf.slice(0, targetExp + backfill);

  // If we still don't have enough total, take remaining from any tier
  const all = [...selectedHigh, ...selectedExp].slice(0, targetCount);

  return {
    highConfidence: selectedHigh,
    experimental:   selectedExp,
    all,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// § 5  EMPTY RESULT FALLBACK — returned on catastrophic failure
// ─────────────────────────────────────────────────────────────────────────────

function buildEmptyResult(input: ExploreInput, error: string): ExploreResult {
  return {
    runId:              input.runId,
    seed:               input.seed,
    format:             input.format,
    validCandidates:    [],
    rankedResults:      [],
    highConfidence:     [],
    experimental:       [],
    clusters:           [],
    noveltyArchiveDelta:[],
    stats: {
      poolGenerated:         0,
      poolAfterConstraints:  0,
      poolAfterDiversity:    0,
      finalCurated:          0,
      discardedByConstraints:0,
      repairedCandidates:    0,
      totalExploreMs:        0,
      genomeGenMs:           0,
      constraintMs:          0,
      evaluationMs:          0,
      noveltyMs:             0,
      curationMs:            0,
      averageCompositeScore: 0,
      averageNoveltyScore:   0,
      explorationTemperature: input.priors?.explorationTemperature ?? 0.75,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// § 6  MAIN ENGINE — runExploration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * runExploration
 *
 * Executes the full Creative Exploration pipeline:
 * E1 → E2 → E3 → E4 → E5
 *
 * Never throws. All errors are captured and resolved via fallbacks.
 * Returns a fully structured ExploreResult with ranked candidates.
 */
export async function runExploration(input: ExploreInput): Promise<ExploreResult> {
  const pipelineStart = Date.now();
  const {
    runId,
    seed,
    format,
    poolSize             = DEFAULT_POOL_SIZE,
    targetResultCount    = DEFAULT_TARGET_RESULT_COUNT,
    highConfidenceRatio  = DEFAULT_HIGH_CONFIDENCE_RATIO,
    pipelineContext,
    priors               = buildDefaultPriors(pipelineContext.audienceSegment ?? "unknown"),
    noveltyArchive       = [],
    onEvent,
  } = input;

  emit(onEvent, "explore_start", runId, { seed, format, poolSize, targetResultCount });

  let genomeGenMs    = 0;
  let constraintMs   = 0;
  let evaluationMs   = 0;
  let noveltyMs      = 0;
  let curationMs     = 0;

  // ── Stage E1: Genome Pool Generation ─────────────────────────────────────
  let poolCandidates: CandidateDesignPlan[] = [];
  try {
    const poolResult = generateGenomePool({
      masterSeed: seed,
      format,
      poolSize,
      context: pipelineContext,
      priors,
    });
    poolCandidates = poolResult.candidates;
    genomeGenMs    = poolResult.generationMs;

    emit(onEvent, "genome_pool_generated", runId, {
      poolSize:   poolCandidates.length,
      genomeGenMs,
    });
  } catch (err: any) {
    emit(onEvent, "explore_complete", runId, {
      error: `E1 genome generation failed: ${err?.message}`,
      totalMs: Date.now() - pipelineStart,
    });
    return buildEmptyResult(input, `Genome generation failed: ${err?.message}`);
  }

  // ── Stage E2: Constraint & Repair ─────────────────────────────────────────
  let validCandidates: CandidateDesignPlan[] = [];
  let totalDiscarded  = 0;
  let totalRepairs    = 0;
  try {
    const batchResult = checkAndRepairBatch(poolCandidates);
    validCandidates  = batchResult.validCandidates;
    totalDiscarded   = batchResult.totalDiscarded;
    totalRepairs     = batchResult.totalRepairs;
    constraintMs     = batchResult.checkDurationMs;

    emit(onEvent, "constraints_checked", runId, {
      valid:     validCandidates.length,
      discarded: totalDiscarded,
      repaired:  totalRepairs,
      constraintMs,
    });

    // If we lost too many candidates, regenerate a small supplementary batch
    if (validCandidates.length < targetResultCount * 2) {
      const supplementSeed = createHash("sha256").update(`${seed}:supplement`).digest("hex").slice(0, 32);
      const supplementPool = generateGenomePool({
        masterSeed:  supplementSeed,
        format,
        poolSize:    Math.min(poolSize, targetResultCount * 3),
        context:     pipelineContext,
        priors,
      });
      const supplementResult = checkAndRepairBatch(supplementPool.candidates);
      validCandidates.push(...supplementResult.validCandidates);
      totalRepairs += supplementResult.totalRepairs;
    }
  } catch (err: any) {
    // Fallback: use all pool candidates as-is
    validCandidates = poolCandidates.map(c => ({ ...c, constraintsPassed: true }));
    emit(onEvent, "constraints_checked", runId, {
      fallback: true,
      error:    err?.message,
      valid:    validCandidates.length,
    });
  }

  if (validCandidates.length === 0) {
    emit(onEvent, "explore_complete", runId, {
      error: "No valid candidates after constraint check",
      totalMs: Date.now() - pipelineStart,
    });
    return buildEmptyResult(input, "No valid candidates after constraint check");
  }

  // ── Stage E3: Multi-Objective Evaluation ──────────────────────────────────
  let evaluatedCandidates: Array<CandidateDesignPlan & { scores: any }> = [];
  let avgCompositeScore = 0;
  try {
    const evalResult = evaluateBatch(validCandidates, pipelineContext);
    evaluatedCandidates = evalResult.evaluatedCandidates;
    avgCompositeScore   = evalResult.averageCompositeScore;
    evaluationMs        = evalResult.evaluationMs;

    emit(onEvent, "evaluation_complete", runId, {
      evaluated:          evaluatedCandidates.length,
      avgCompositeScore,
      highConfidenceCount:evalResult.highConfidenceCount,
      experimentalCount:  evalResult.experimentalCount,
      evaluationMs,
    });
  } catch (err: any) {
    emit(onEvent, "evaluation_complete", runId, {
      fallback: true,
      error:    err?.message,
    });
    // Fallback: assign neutral scores
    evaluatedCandidates = validCandidates.map(c => ({
      ...c,
      scores: {
        readability:            0.5,
        visualHierarchyClarity: 0.5,
        platformOptimization:   0.5,
        brandAlignment:         0.5,
        visualBalance:          0.5,
        attentionPotential:     0.5,
        compositeScore:         0.5,
        weakestDimension:       "readability" as const,
        evaluationMs:           0,
      },
    }));
  }

  // Build initial ranked set (before novelty)
  const initialRanked = buildRankedCandidates(
    evaluatedCandidates,
    new Map(), // no novelty scores yet
    0.70       // pure quality ranking for initial set
  );

  // ── Stage E4: Novelty & Diversity ─────────────────────────────────────────
  let noveltyScores    = new Map<string, number>();
  let archiveDelta: any[] = [];
  let clusters: any[]  = [];
  let rankedWithNovelty: RankedCandidate[] = initialRanked;
  let avgNoveltyScore  = 0;
  try {
    const noveltyResult  = runNoveltyPipeline(initialRanked, noveltyArchive);
    noveltyScores        = noveltyResult.noveltyScores;
    archiveDelta         = noveltyResult.archiveDelta;
    clusters             = noveltyResult.clusters;
    rankedWithNovelty    = noveltyResult.candidates;
    noveltyMs            = noveltyResult.noveltyMs;

    avgNoveltyScore = rankedWithNovelty.length > 0
      ? rankedWithNovelty.reduce((s, c) => s + c.noveltyScore, 0) / rankedWithNovelty.length
      : 0;

    emit(onEvent, "novelty_scored", runId, {
      avgNoveltyScore,
      archiveDeltaSize: archiveDelta.length,
      clusterCount:     clusters.length,
      noveltyMs,
    });
  } catch (err: any) {
    emit(onEvent, "novelty_scored", runId, {
      fallback: true,
      error:    err?.message,
    });
    rankedWithNovelty = initialRanked;
  }

  // ── Stage E5: Curation — Diversity Filter + High-Confidence / Experimental Split
  const curationStart = Date.now();
  let finalRanked: RankedCandidate[] = [];
  let highConfidence: RankedCandidate[] = [];
  let experimental:   RankedCandidate[] = [];

  try {
    // Apply diversity filter to ensure non-redundant results
    const diversified = diversityFilter(rankedWithNovelty, targetResultCount * 2);

    // Split into high-confidence and experimental
    const split = splitCuratedResults(diversified, targetResultCount, highConfidenceRatio);
    highConfidence = split.highConfidence;
    experimental   = split.experimental;
    finalRanked    = split.all;

    curationMs = Date.now() - curationStart;

    emit(onEvent, "curation_complete", runId, {
      totalCurated:     finalRanked.length,
      highConfidenceCount: highConfidence.length,
      experimentalCount:   experimental.length,
      curationMs,
    });
  } catch (err: any) {
    // Fallback: take top N from ranked set
    finalRanked    = rankedWithNovelty.slice(0, targetResultCount);
    highConfidence = finalRanked.filter(c => c.confidenceTier === "high_confidence");
    experimental   = finalRanked.filter(c => c.confidenceTier !== "high_confidence");
    curationMs     = Date.now() - curationStart;

    emit(onEvent, "curation_complete", runId, {
      fallback: true,
      error:    err?.message,
      totalCurated: finalRanked.length,
    });
  }

  const totalExploreMs = Date.now() - pipelineStart;

  const stats: ExploreStats = {
    poolGenerated:          poolCandidates.length,
    poolAfterConstraints:   validCandidates.length,
    poolAfterDiversity:     rankedWithNovelty.length,
    finalCurated:           finalRanked.length,
    discardedByConstraints: totalDiscarded,
    repairedCandidates:     totalRepairs,
    totalExploreMs,
    genomeGenMs,
    constraintMs,
    evaluationMs,
    noveltyMs,
    curationMs,
    averageCompositeScore:  avgCompositeScore,
    averageNoveltyScore:    avgNoveltyScore,
    explorationTemperature: priors.explorationTemperature,
  };

  emit(onEvent, "explore_complete", runId, {
    totalExploreMs,
    finalCurated:    finalRanked.length,
    highConfidence:  highConfidence.length,
    experimental:    experimental.length,
    avgCompositeScore,
    avgNoveltyScore,
  });

  return {
    runId,
    seed,
    format,
    validCandidates,
    rankedResults:      finalRanked,
    highConfidence,
    experimental,
    clusters,
    noveltyArchiveDelta: archiveDelta,
    stats,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// § 7  CONVENIENCE: build ExploreInput from OrchestratorResult
// ─────────────────────────────────────────────────────────────────────────────

/**
 * buildExploreInput
 *
 * Bridges the existing OrchestratorResult (Stages 1–8) into ExploreInput.
 * Call this directly after runGenerationPipeline() to kick off exploration.
 */
export function buildExploreInput(
  orchestratorInput:  OrchestratorInput,
  orchestratorResult: OrchestratorResult,
  opts?: {
    poolSize?:             number;
    targetResultCount?:    number;
    highConfidenceRatio?:  number;
    priors?:               any;
    noveltyArchive?:       any[];
    onEvent?:              ExploreObservabilityEmitter;
  }
): ExploreInput {
  const { jobId, format, brief, brand } = orchestratorInput;
  const {
    stages: { intent, layout, audience, density, brand: brandStage },
  } = orchestratorResult;

  const seed = deriveExploreSeed(jobId, format, intent.data.prompt ?? "");

  return {
    runId:    `explore:${jobId}`,
    seed,
    format,
    poolSize:            opts?.poolSize             ?? DEFAULT_POOL_SIZE,
    targetResultCount:   opts?.targetResultCount    ?? DEFAULT_TARGET_RESULT_COUNT,
    highConfidenceRatio: opts?.highConfidenceRatio  ?? DEFAULT_HIGH_CONFIDENCE_RATIO,
    pipelineContext: {
      intent:               intent.data.prompt ?? "",
      format,
      audienceSegment:      audience.data.segment,
      tonePreference:       audience.data.tonePreference,
      layoutType:           layout.data.layoutType,
      brandPrimaryColor:    brand?.primaryColor,
      brandSecondaryColor:  brand?.secondaryColor,
      brandFontDisplay:     brand?.fontDisplay,
      brandPrefersDarkBg:   brandStage.data.prefersDarkBg,
      brandToneKeywords:    brandStage.data.toneKeywords,
      densityTextBlockCount:density.data.textBlockCount,
      imageProvided:        !!orchestratorInput.imageUrl,
      stylePreset:          orchestratorInput.stylePreset,
      archetypeId:          orchestratorResult.archetypeMetadata?.archetypeId as any,
    },
    priors:         opts?.priors,
    noveltyArchive: opts?.noveltyArchive ?? [],
    onEvent:        opts?.onEvent,
  };
}
