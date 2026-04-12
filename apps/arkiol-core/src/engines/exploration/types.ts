// src/engines/exploration/types.ts
// Creative Exploration AI Engine — Canonical Type Definitions
// ─────────────────────────────────────────────────────────────────────────────
//
// All types used across the 5 sub-modules of the Creative Exploration Engine:
//   1. Design Genome Generator      — DesignGenome, CandidateDesignPlan
//   2. Constraint & Repair Module   — ConstraintReport, RepairResult
//   3. Multi-Objective Evaluator    — EvaluationScores, RankedCandidate
//   4. Novelty & Diversity Layer    — FeatureVector, NoveltyScore, DiversitySet
//   5. Learning & Memory System     — FeedbackSignal, ExplorationPriors
//
// Execution contract:
//   ✓ All types are plain serialisable objects (no class instances, no Symbols)
//   ✓ All numeric scores are normalised [0, 1] unless explicitly annotated
//   ✓ All IDs are deterministic strings (never random UUIDs)
//   ✓ Zod schemas are co-located in schemas.ts, not in this file

import type { ArchetypeId, StylePresetId } from "@arkiol/shared";
import type { ArkiolLayoutCategory }        from "../layout/families";

// ─────────────────────────────────────────────────────────────────────────────
// § 1  DESIGN GENOME
// ─────────────────────────────────────────────────────────────────────────────

/** The 9 genes that define a complete creative direction. */
export interface DesignGenome {
  /** Canonical layout family identifier (e.g. "ig_post", "yt_thumb") */
  layoutFamily: string;
  /** Variation ID within the layout family (e.g. "v1_split", "v3_full_bleed") */
  variationId: string;
  /** Archetype driving visual personality (e.g. "BOLD_CLAIM", "MINIMAL_CLEAN") */
  archetype: ArchetypeId;
  /** Style preset (e.g. "bold", "minimal", "professional") */
  preset: StylePresetId;
  /** Typography personality: 0=clean, 1=expressive, 2=editorial, 3=playful, 4=luxury */
  typographyPersonality: 0 | 1 | 2 | 3 | 4;
  /** Density profile: "sparse" | "balanced" | "rich" | "dense" */
  densityProfile: DensityProfileLevel;
  /** Hook strategy: primary attention mechanism this design uses */
  hookStrategy: HookStrategy;
  /** Composition pattern: visual flow/structure meta-pattern */
  compositionPattern: CompositionPattern;
  /** Whether this genome is eligible for GIF motion */
  motionEligible: boolean;
}

export type DensityProfileLevel = "sparse" | "balanced" | "rich" | "dense";

export type HookStrategy =
  | "bold_headline"     // Giant type dominates
  | "visual_lead"       // Image/visual commands attention first
  | "contrast_punch"    // High contrast text-on-image
  | "negative_space"    // Strategic emptiness draws eye
  | "color_block"       // Color regions create instant hierarchy
  | "sequential_reveal" // Eye follows a deliberate path
  | "texture_depth"     // Background texture creates dimension
  | "pattern_interrupt" // Unexpected compositional break
  | "social_proof"      // Badge/credibility elements front and centre
  | "urgency_frame"      // CTA urgency signals dominate composition
  | "frame_within_frame"; // Nested framing draws eye inward

export type CompositionPattern =
  | "z_flow"        // Z reading pattern
  | "f_flow"        // F reading pattern  
  | "golden_ratio"  // Subject placed at golden ratio intersections
  | "rule_of_thirds"// Classic rule-of-thirds grid
  | "centered_axis" // Perfect symmetry on vertical axis
  | "diagonal_tension" // Elements arranged on a diagonal
  | "frame_within_frame" // Border/margin framing device
  | "asymmetric_weight" // Deliberate visual imbalance
  | "radial_burst";  // Elements radiate from central point

// ─────────────────────────────────────────────────────────────────────────────
// § 2  CANDIDATE DESIGN PLAN
// ─────────────────────────────────────────────────────────────────────────────

/** Confidence tier assigned after evaluation */
export type ConfidenceTier = "high_confidence" | "experimental" | "speculative";

/** A fully resolved design candidate ready for evaluation */
export interface CandidateDesignPlan {
  /** Deterministic ID: sha256(seed + genome hash) */
  candidateId: string;
  /** The seed that generated this genome */
  seed: string;
  /** The design genome (immutable after generation) */
  genome: DesignGenome;
  /** Generation index within the exploration batch */
  generationIndex: number;
  /** Format this candidate targets */
  format: string;
  /** Layout category */
  layoutCategory: ArkiolLayoutCategory;
  /** Whether this candidate passed constraint checks */
  constraintsPassed: boolean;
  /** Constraint repair log (empty = no repairs needed) */
  repairLog: string[];
  /** Evaluation scores (populated by evaluator) */
  scores?: EvaluationScores;
  /** Novelty score (populated by diversity layer) */
  noveltyScore?: number;
  /** Final confidence tier (populated after full evaluation) */
  confidenceTier?: ConfidenceTier;
  /** Feature vector used for novelty/diversity calculations */
  featureVector?: FeatureVector;
  /** ISO timestamp when candidate was generated */
  generatedAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// § 3  CONSTRAINT & REPAIR
// ─────────────────────────────────────────────────────────────────────────────

export type ConstraintViolationType =
  | "layout_geometry_invalid"
  | "asset_contract_violation"
  | "text_fit_overflow"
  | "contrast_ratio_fail"
  | "spacing_integrity_fail"
  | "platform_safety_threshold"
  | "motion_incompatible"
  | "density_overload"
  | "zone_overlap_conflict";

export interface ConstraintViolation {
  type: ConstraintViolationType;
  severity: "fatal" | "warning";
  detail: string;
  zone?: string;
  /** Whether this violation was auto-repaired */
  repaired: boolean;
  /** Description of repair applied (empty if not repaired) */
  repairAction: string;
}

export interface ConstraintReport {
  candidateId: string;
  passed: boolean;       // true = no fatal violations remain
  violations: ConstraintViolation[];
  repairCount: number;
  discarded: boolean;    // true = fatal violations could not be repaired
  checkDurationMs: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// § 4  MULTI-OBJECTIVE EVALUATION
// ─────────────────────────────────────────────────────────────────────────────

/** Six evaluation dimensions, each [0, 1] */
export interface EvaluationScores {
  /** Text legibility, contrast, sizing, line-height */
  readability: number;
  /** Headline > subhead > body hierarchy clarity */
  visualHierarchyClarity: number;
  /** Format-specific safe-zone compliance, aspect ratio fit */
  platformOptimization: number;
  /** Color, font, tone alignment with brand signals */
  brandAlignment: number;
  /** Visual weight distribution, whitespace balance */
  visualBalance: number;
  /** Hook strength, first-impression stopping power */
  attentionPotential: number;
  /** Weighted aggregate: [0, 1] */
  compositeScore: number;
  /** Which dimension is weakest (explainability) */
  weakestDimension: keyof Omit<EvaluationScores, "compositeScore" | "weakestDimension">;
  /** Milliseconds to compute */
  evaluationMs: number;
}

export interface RankedCandidate extends CandidateDesignPlan {
  scores: EvaluationScores;
  noveltyScore: number;
  /** Combined exploration score: compositeScore * alpha + noveltyScore * (1 - alpha) */
  explorationScore: number;
  confidenceTier: ConfidenceTier;
  rank: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// § 5  NOVELTY & DIVERSITY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 12-dimensional feature vector encoding the creative fingerprint of a candidate.
 * Used for novelty search (compare to archive) and diversity filtering (compare within batch).
 */
export type FeatureVector = [
  number, // 0: layoutFamily (encoded 0–1)
  number, // 1: variationId (encoded 0–1)
  number, // 2: archetype (encoded 0–1)
  number, // 3: preset (encoded 0–1)
  number, // 4: typographyPersonality (0–0.8, step 0.2)
  number, // 5: densityProfile (0=sparse, 0.33=balanced, 0.66=rich, 1=dense)
  number, // 6: hookStrategy (encoded 0–1)
  number, // 7: compositionPattern (encoded 0–1)
  number, // 8: motionEligible (0 or 1)
  number, // 9: readabilityScore
  number, // 10: attentionPotential
  number, // 11: brandAlignment
];

export interface NoveltyScore {
  candidateId: string;
  /** Mean distance to k-nearest neighbors in feature space (higher = more novel) */
  novelty: number;
  /** Minimum distance to archive (behavioural novelty) */
  archiveDistance: number;
  /** Whether candidate was added to the novelty archive */
  addedToArchive: boolean;
}

export interface DiversityCluster {
  clusterId: number;
  members: string[]; // candidateIds
  centroid: FeatureVector;
  /** Spread within cluster (lower = more similar members) */
  intraClusterDistance: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// § 6  LEARNING & MEMORY
// ─────────────────────────────────────────────────────────────────────────────

export type FeedbackSignalType =
  | "selected"       // User clicked / chose this design
  | "exported"       // User downloaded / exported
  | "regenerated"    // User regenerated from this as base
  | "dismissed"      // User explicitly dismissed
  | "time_spent_high" // User spent >10s inspecting
  | "time_spent_low"; // User spent <2s inspecting

export interface FeedbackSignal {
  signalId: string;
  userId: string;
  orgId: string;
  brandId?: string;
  campaignId?: string;
  candidateId: string;
  genome: DesignGenome;
  scores: EvaluationScores;
  signalType: FeedbackSignalType;
  weight: number;           // positive or negative; magnitude encodes signal strength
  timestamp: string;        // ISO
  format: string;
}

/** Per-dimension prior weights updated by bandit learning */
export interface ExplorationPriors {
  orgId: string;
  brandId?: string;
  /** Bandit arm weights per layout family (sum to 1) */
  layoutFamilyWeights: Record<string, number>;
  /** Bandit arm weights per archetype */
  archetypeWeights: Record<string, number>;
  /** Bandit arm weights per preset */
  presetWeights: Record<string, number>;
  /** Bandit arm weights per hookStrategy */
  hookStrategyWeights: Record<string, number>;
  /** Bandit arm weights per compositionPattern */
  compositionPatternWeights: Record<string, number>;
  /** Bandit arm weights per densityProfile */
  densityProfileWeights: Record<DensityProfileLevel, number>;
  /** Exploration temperature: 0=exploit, 1=explore fully */
  explorationTemperature: number;
  /** Total feedback signals processed */
  totalSignals: number;
  /** Last update timestamp */
  updatedAt: string;
  /** Schema version for forward-compatibility */
  schemaVersion: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// § 7  ENGINE INPUT / OUTPUT
// ─────────────────────────────────────────────────────────────────────────────

export interface ExploreInput {
  /** Unique run identifier (deterministic from jobId + exploreMode) */
  runId: string;
  /** Master seed for reproducibility */
  seed: string;
  /** Target format */
  format: string;
  /** Number of candidates to generate (before constraint filtering) */
  poolSize: number;
  /** Final curated results to return */
  targetResultCount: number;
  /** Split between high-confidence and experimental results */
  highConfidenceRatio: number; // 0–1; e.g. 0.6 = 60% high-confidence
  /** Upstream pipeline context (from Stage 1–6 + 8 outputs) */
  pipelineContext: ExplorePipelineContext;
  /** Priors from learning system (optional — defaults used if absent) */
  priors?: ExplorationPriors;
  /** Feature novelty archive from previous runs (for cross-session novelty) */
  noveltyArchive?: FeatureVector[];
  /** Observability emitter */
  onEvent?: ExploreObservabilityEmitter;
}

export interface ExplorePipelineContext {
  intent: string;
  format: string;
  audienceSegment: string;
  tonePreference: string;
  layoutType: string;
  brandPrimaryColor?: string;
  brandSecondaryColor?: string;
  brandFontDisplay?: string;
  brandPrefersDarkBg?: boolean;
  brandToneKeywords?: string[];
  densityTextBlockCount?: number;
  variationAxes?: string[];
  imageProvided?: boolean;
  faceDetected?: boolean;
  stylePreset?: string;
  archetypeId?: ArchetypeId;
}

export interface ExploreResult {
  runId: string;
  seed: string;
  format: string;
  /** All valid candidates after constraint + repair */
  validCandidates: CandidateDesignPlan[];
  /** Ranked and curated final selection */
  rankedResults: RankedCandidate[];
  /** High-confidence slice (ready for direct use) */
  highConfidence: RankedCandidate[];
  /** Experimental slice (creative stretch, may surprise) */
  experimental: RankedCandidate[];
  /** Diversity clusters (for UI grouping) */
  clusters: DiversityCluster[];
  /** Novelty archive to persist for future runs */
  noveltyArchiveDelta: FeatureVector[];
  /** Stats for observability */
  stats: ExploreStats;
}

export interface ExploreStats {
  poolGenerated: number;
  poolAfterConstraints: number;
  poolAfterDiversity: number;
  finalCurated: number;
  discardedByConstraints: number;
  repairedCandidates: number;
  totalExploreMs: number;
  genomeGenMs: number;
  constraintMs: number;
  evaluationMs: number;
  noveltyMs: number;
  curationMs: number;
  averageCompositeScore: number;
  averageNoveltyScore: number;
  explorationTemperature: number;
}

export type ExploreObservabilityEmitter = (event: ExploreObservabilityEvent) => void;

export interface ExploreObservabilityEvent {
  eventType:
    | "explore_start"
    | "genome_pool_generated"
    | "constraints_checked"
    | "evaluation_complete"
    | "novelty_scored"
    | "curation_complete"
    | "explore_complete"
    | "feedback_recorded"
    | "priors_updated";
  runId: string;
  timestamp: string;
  data: Record<string, unknown>;
}
