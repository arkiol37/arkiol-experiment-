// src/engines/index.ts
// Arkiol Engine Registry — canonical barrel export for all engines.
//
// ─── Core pipeline arc ─────────────────────────────────────────────────────
//
//   intent  →  layout  →  style  →  assets  →  render  →  evaluation  →  memory
//     │         │          │         │          │            │             │
//     │         │          │         │          │            │             └─ output history,
//     │         │          │         │          │            │                generation ledger,
//     │         │          │         │          │            │                learning signals
//     │         │          │         │          │            └─ quality scoring,
//     │         │          │         │          │               refinement, rejection,
//     │         │          │         │          │               marketplace gate
//     │         │          │         │          └─ SVG/PNG/GIF pipeline,
//     │         │          │         │             self-healing, context threading
//     │         │          │         └─ composition planning, asset placement,
//     │         │          │            decorative components, backgrounds,
//     │         │          │            depth, balance, contracts
//     │         │          └─ style intelligence, category packs, typography,
//     │         │             font pairing, template kits, layout profiles
//     │         └─ zone geometry, density, adaptive layout, constraints,
//     │            style enforcement, families, grid
//     └─ prompt analysis, brief extraction (hierarchy rules live alongside
//        as a support module consumed by layout / render)
//
// Every core stage has its own module directory with an index.ts that is
// the authoritative public surface for that stage. Changing internal file
// layout inside a module does not ripple through consumers as long as the
// module's barrel stays stable.
//
// ─── Support modules ───────────────────────────────────────────────────────
//
//   hierarchy/       typographic hierarchy enforcement (used by render)
//   exploration/     genetic algorithm over design genomes, learning memory
//   campaign/        campaign planning, narrative arcs, coherence checks
//   brand/           brand memory and learning
//   platform/        platform-specific rule intelligence
//   queue/           render job orchestration, retries, cost / compute safety
//   validation/      cross-stage typed validation
//   agents/          AI agent orchestration (director, designer, critic)
//   cocreation/      instruction parsing + design mutation (real-time editing)
//   inspiration/     pattern library + matching + style overrides
//   personalization/ Design DNA profiles, feedback, bias application
//   multi-output/    coordinated multi-format generation and variations
//   intelligence/    creative loop, adaptive strategy, improvement reports
//
// ─── Re-export convention ──────────────────────────────────────────────────
//
//   • Core stages (intent, layout, style, assets, render, evaluation, memory,
//     hierarchy) are re-exported as namespaces below so consumers can write
//     `import { evaluation } from "@/engines"` and call
//     `evaluation.scoreCandidateQuality(...)`. This avoids name collisions
//     across stages (ZoneId, ValidationResult, etc.) and makes pipeline
//     stage ownership explicit at the call site.
//   • Support modules keep their existing flat re-exports below for
//     backwards compatibility with call sites that imported pre-Step 30.

// ── Core pipeline namespaces ───────────────────────────────────────────────
export * as intent      from "./intent";
export * as layout      from "./layout";
export * as style       from "./style";
export * as assets      from "./assets";
export * as render      from "./render";
export * as evaluation  from "./evaluation";
export * as memory      from "./memory";
export * as hierarchy   from "./hierarchy";

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

// ── Personalization Engine ─────────────────────────────────────────────────
export {
  getDesignDNA,
  setDesignDNA,
  hasDesignDNA,
  deleteDesignDNA,
  applyDNAFeedback,
  applyDNAFeedbackBatch,
  buildDNADiagnostic,
  computeDNAThemeBias,
  computeDNATypographyOverrides,
  computeDNAColorOverrides,
  computeDNALayoutBias,
  computeDNACtaBias,
  buildPersonalizationContext,
  extractTraitsFromTheme,
} from "./personalization";

export type {
  DesignDNA,
  StyleAffinities,
  ThemePreferences,
  DNAFeedbackType,
  DNAFeedbackSignal,
  StyleTraitObservation,
  DNADiagnostic,
  DNAThemeBias,
  DNATypographyOverrides,
  DNAColorOverrides,
  DNALayoutBias,
  DNACtaBias,
  PersonalizationContext,
} from "./personalization";

// ── Multi-Output Generation ────────────────────────────────────────────────
export {
  generateMultiOutput,
  generateVariations,
  buildMultiOutputPipelineInputs,
  extractStyleAnchor,
  extractStyleAnchorFromIdentity,
  anchorToBrand,
  deriveVariationIndex,
  checkOutputConsistency,
} from "./multi-output";

export type {
  MultiOutputRequest,
  MultiOutputResult,
  FormatRenderResult,
  VariationRequest,
  VariationResult,
  StyleAnchor,
  ConsistencyCheck,
} from "./multi-output";

// ── Creative Intelligence Loop ─────────────────────────────────────────────
export {
  processFeedback,
  processFeedbackBatch,
  computeSystemInsights,
  computeAdaptiveStrategy,
  recordQualitySignal,
  getQualityWindow,
  computeImprovementReport,
  buildThemeFilter,
  isThemeAllowed,
  isThemePreferred,
  buildQualityGateConfig,
  buildExplorationConfig,
  buildIntelligenceContext,
} from "./intelligence";

export type {
  FeedbackAction,
  CreativeFeedback,
  FeedbackResult,
  SystemInsights,
  AdaptiveStrategy,
  QualityWindow,
  ImprovementReport,
  ThemeFilter,
  QualityGateConfig,
  ExplorationConfig,
  IntelligenceContext,
} from "./intelligence";

// ── Category Template Kits ────────────────────────────────────────────────
export {
  getCategoryKit,
  getAllCategoryKits,
  mergeKitDecorations,
} from "./style/category-template-kits";

export type {
  CategoryTemplateKit,
} from "./style/category-template-kits";
