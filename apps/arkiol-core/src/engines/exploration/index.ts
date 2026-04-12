// src/engines/exploration/index.ts
// Creative Exploration AI Engine — Public API Surface
// ─────────────────────────────────────────────────────────────────────────────
//
// Re-exports the public interface of all 5 sub-modules.
// Internal implementation details (genome encoding helpers, constraint sub-rules,
// distance functions) are NOT exported — only the stable public API is.

// ── Core Engine ───────────────────────────────────────────────────────────────
export {
  runExploration,
  buildExploreInput,
  deriveExploreSeed,
} from "./engine";

// ── Genome Generator ──────────────────────────────────────────────────────────
export {
  buildGenome,
  buildCandidate,
  generateGenomePool,
  GENOME_SPACE,
} from "./genome-generator";
export type { GenomePoolOptions, GenomePoolResult } from "./genome-generator";

// ── Constraint & Repair ───────────────────────────────────────────────────────
export {
  checkAndRepairCandidate,
  checkAndRepairBatch,
} from "./constraint-repair";
export type { BatchConstraintResult } from "./constraint-repair";

// ── Evaluator ─────────────────────────────────────────────────────────────────
export {
  evaluateCandidate,
  evaluateBatch,
  classifyConfidenceTier,
  buildRankedCandidates,
} from "./evaluator";
export type { BatchEvaluationResult } from "./evaluator";

// ── Novelty & Diversity ───────────────────────────────────────────────────────
export {
  encodeFeatureVector,
  euclideanDistance,
  computeNoveltyScores,
  diversityFilter,
  buildDiversityClusters,
  runNoveltyPipeline,
} from "./novelty-diversity";
export type { NoveltyPipelineResult } from "./novelty-diversity";

// ── Learning & Memory ─────────────────────────────────────────────────────────
export {
  buildDefaultPriors,
  applyFeedback,
  applyFeedbackBatch,
  buildFeedbackSignal,
  buildPriorsDiagnostic,
  migratePriors,
} from "./learning-memory";
export type { PriorsDiagnostic } from "./learning-memory";

// ── Types (canonical, re-exported for consumers) ──────────────────────────────
export type {
  // Genome
  DesignGenome,
  DensityProfileLevel,
  HookStrategy,
  CompositionPattern,

  // Candidates
  CandidateDesignPlan,
  ConfidenceTier,

  // Constraints
  ConstraintReport,
  ConstraintViolation,
  ConstraintViolationType,

  // Evaluation
  EvaluationScores,
  RankedCandidate,

  // Novelty
  FeatureVector,
  NoveltyScore,
  DiversityCluster,

  // Learning
  FeedbackSignal,
  FeedbackSignalType,
  ExplorationPriors,

  // Engine I/O
  ExploreInput,
  ExploreResult,
  ExploreStats,
  ExplorePipelineContext,
  ExploreObservabilityEmitter,
  ExploreObservabilityEvent,
} from "./types";
