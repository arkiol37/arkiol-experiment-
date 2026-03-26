// src/engines/index.ts
// Arkiol Engine Registry — canonical barrel export for all engines
//
// Import from here rather than directly from individual engine files
// to ensure consistent API surface and avoid circular dependency issues.

// ── Exploration Engine ──────────────────────────────────────────────────────
export {
  runExploration,
  buildExploreInput,
  deriveExploreSeed,
} from "./exploration/engine";

export {
  generateGenomePool,
  GENOME_SPACE,
} from "./exploration/genome-generator";

export {
  checkAndRepairBatch,
} from "./exploration/constraint-repair";

export {
  evaluateBatch,
  buildRankedCandidates,
} from "./exploration/evaluator";

export {
  runNoveltyPipeline,
  diversityFilter,
} from "./exploration/novelty-diversity";

export {
  buildDefaultPriors,
  applyFeedback,
  applyFeedbackBatch,
  buildFeedbackSignal,
  buildPriorsDiagnostic,
  migratePriors,
} from "./exploration/learning-memory";

export type {
  DesignGenome,
  CandidateDesignPlan,
  RankedCandidate,
  ExploreInput,
  ExploreResult,
  ExploreStats,
  ExplorationPriors,
  FeedbackSignal,
  FeedbackSignalType,
  DensityProfileLevel,
  HookStrategy,
  CompositionPattern,
  ConfidenceTier,
  EvaluationScores,
  FeatureVector,
  DiversityCluster,
  ExplorePipelineContext,
} from "./exploration/types";

// ── Platform Intelligence Engine ────────────────────────────────────────────
export {
  getPlatformRules,
  scorePlatformCompliance,
  getSupportedPlatforms,
  buildPlatformPromptContext,
} from "./platform/intelligence";

export type {
  PlatformRules,
  SafeZone,
  TextSizeGuide,
  CompositionBias,
  PlatformComplianceScore,
} from "./platform/intelligence";

// ── Asset Library ───────────────────────────────────────────────────────────
export {
  retrieveAssets,
  listAssetPacks,
  getAssetPack,
  generateParametricBackground,
  buildRetrievalContext,
} from "./assets/asset-library";

export type {
  AssetDescriptor,
  AssetPack,
  AssetIndustry,
  AssetMediaType,
  AssetMood,
  RetrievalContext,
  RetrievedAsset,
} from "./assets/asset-library";

// ── Campaign Creative Director ──────────────────────────────────────────────
export {
  buildCampaignPlan,
  campaignFormatToGenerationPayload,
} from "./campaign/creative-director";

export type {
  CampaignPlan,
  CampaignFormatPlan,
  VisualIdentity,
  CampaignObjective,
  CampaignTone,
  DirectorInput,
} from "./campaign/creative-director";

// ── Render Queue Intelligence ───────────────────────────────────────────────
export {
  calculateRetryDelay,
  shouldRetry,
  withTimeout,
  buildProviderChain,
  ProviderHealthTracker,
  CostMonitor,
  computeJobSortKey,
  sortJobsByPriority,
  inferJobPriority,
  checkComputeSafety,
  buildRenderJobSpec,
  RenderTimeoutError,
  PROVIDER_CONFIGS,
  DEFAULT_RETRY_POLICIES,
  PRIORITY_WEIGHTS,
  COMPUTE_LIMITS,
} from "./queue/render-queue";

export type {
  RenderJobSpec,
  RetryPolicy,
  ProviderResult,
  CostAccumulation,
  ComputeBudgetStatus,
  SafetyCheckResult,
  JobPriority,
  ProviderName,
  JobOutcome,
  ProviderConfig,
} from "./queue/render-queue";

// ── Stage Validation ────────────────────────────────────────────────────────
export {
  validateDesignGenome,
  validateEvaluationScores,
  validatePipelineContext,
  validateExplorationPriors,
  validateFormat,
  VALID_ARCHETYPES,
  VALID_PRESETS,
  VALID_DENSITY_PROFILES,
  VALID_HOOK_STRATEGIES,
  VALID_COMPOSITION_PATTERNS,
  VALID_FORMATS,
} from "./validation/stage-validator";

export type {
  ValidationResult,
} from "./validation/stage-validator";
