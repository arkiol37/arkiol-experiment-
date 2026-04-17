// src/engines/index.ts
// Arkiol Engine Registry — canonical barrel export for all engines
//
// Module structure:
//   intent/      — prompt analysis and brief extraction
//   layout/      — zone geometry, density, adaptive layout
//   style/       — visual style intelligence, category packs
//   assets/      — composition planning, asset contracts
//   render/      — SVG/PNG/GIF pipeline and content generation
//   evaluation/  — quality scoring, refinement, candidate ranking, output polish, readiness
//   memory/      — output history and cross-request dedup
//   hierarchy/   — typographic rule enforcement
//   exploration/ — genetic algorithm, learning-memory
//   campaign/    — campaign planning, creative direction, narrative arcs, coherence
//   brand/       — brand memory and learning
//   platform/    — platform-specific intelligence
//   queue/       — render job orchestration
//   validation/  — stage validation
//   agents/     — AI agent orchestration (creative director, designer, critic)
//   cocreation/ — real-time co-creation (instruction parsing, design mutation)
//   inspiration/ — web-scale pattern intelligence (pattern library, matching, overrides)

// ── Co-Creation ────────────────────────────────────────────────────────────
export {
  parseInstruction,
  applyInstructions,
  resolveNamedColor,
} from "./cocreation";

export type {
  EditCategory,
  EditIntent,
  EditOperation,
  ParsedInstruction,
  MutationResult,
  MutationAction,
} from "./cocreation";

// ── Agent Orchestration ────────────────────────────────────────────────────
export {
  runCreativeDirector,
  runDesigner,
  runCriticPreFlight,
  runCriticPostGeneration,
  orchestrateDesignAgents,
} from "./agents/design-agents";

export type {
  CreativeDirection,
  DesignPlan,
  CriticVerdict,
  CriticAction,
  AgentOrchestrationResult,
  VisualStrategy,
  HookApproach,
  ColorTemperature,
  VisualComplexity,
} from "./agents/design-agents";

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

// ── Narrative Arc + Campaign Coherence ──────────────────────────────────────
export {
  selectNarrativeArc,
  assignNarrativeBeats,
  buildNarrativePromptContext,
  getBeatMessagingGuide,
  adaptHeadlineForBeat,
} from "./campaign/narrative-arc";

export type {
  NarrativeBeat,
  NarrativeBeatSpec,
  NarrativeArc,
  ArcType,
  FormatNarrativeAssignment,
  BeatMessagingGuide,
} from "./campaign/narrative-arc";

export {
  checkCampaignCoherence,
  extractStyleDNA,
  analyzeMessagingProgression,
  buildCoherenceContext,
} from "./campaign/campaign-coherence";

export type {
  CoherenceReport,
  CoherenceIssue,
  CampaignStyleDNA,
  MessagingProgression,
} from "./campaign/campaign-coherence";

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

// ── Inspiration Intelligence ───────────────────────────────────────────────
export {
  getAllPatterns,
  getPatternById,
  getPatternsBySource,
  getPatternsByCategory,
  getPatternsByTone,
  getFreshPatterns,
  matchPatternToBrief,
  matchTopPatterns,
  buildInspirationOverrides,
} from "./inspiration";

export type {
  DesignPattern,
  PatternApplicationHint,
  PatternSource,
  PatternCategory,
  ColorRelationship,
  TypographyPattern,
  SpacingPattern,
  DecorationPattern,
  LayoutStructurePattern,
  PatternMatchResult,
  InspirationOverrides,
} from "./inspiration";
