// src/engines/ai/pipeline-orchestrator.ts
// Advanced AI Engine — Live Generation Pipeline Orchestrator
// ─────────────────────────────────────────────────────────────────────────────
//
// Wires 7 stages in strict execution order with zero cross-stage mutation,
// schema validation at every boundary, deterministic fallbacks, idempotent
// safety, structured logging, and full observability:
//
//   Stage 1: Intent Analysis          — extract structured intent from brief
//   Stage 2: Layout Intelligence      — derive layout strategy from intent
//   Stage 3: Auto-Variation           — plan variation strategy
//   Stage 4: Audience Modeling        — persona-aware adaptation signals
//   Stage 5: Content Density/Hierarchy — optimize content density + hierarchy
//   Stage 6: Brand Learning            — extract brand signals, apply to spec
//   Stage 7: Asset Engine              — final render via unified pipeline
//   Stage 8: Archetype + Preset Intelligence — select archetype & style preset
//
// Execution contract:
//   ✓ Stages execute sequentially: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8
//   ✓ No stage may mutate the output of a previous stage
//   ✓ All stage outputs are schema-validated before passing downstream
//   ✓ Every stage has a deterministic fallback — pipeline NEVER throws
//   ✓ Same inputs always produce structurally identical outputs (idempotent)
//   ✓ All stage timings, errors, and fallbacks are emitted to structured log
//   ✓ Benchmark record is built and returned for external persistence
//   ✓ A/B variant assignments are captured at execution time

// Framework-neutral: imported by both Next (apps/arkiol-core) and plain
// Node (apps/render-backend). Do not add `import "server-only"`.
import {
  // Intelligence layers (Stages 1–6)
  Intent, IntentSchema,
  LayoutStrategy, LayoutStrategySchema, inferLayoutStrategy,
  VariationStrategy, VariationStrategySchema, planVariations,
  AudienceProfile, AudienceProfileSchema, modelAudience,
  DensityProfile, DensityProfileSchema, optimizeDensity,
  BrandSignals, BrandSignalsSchema, extractBrandSignals,
  StageResult,
  // Stage 8: Archetype + Preset Intelligence
  selectArchetypeAndPreset, buildArchetypeMetadata,
  ArchetypeIntelligenceResult, ArchetypePresetOverride,
  ArchetypeId, StylePresetId,
} from "@arkiol/shared";

import {
  StagePerf,
  ScoreInputs,
  buildAssetBenchmark,
  emitObservabilityEvents,
  checkKillSwitch,
  type AssetBenchmark,
  type ObservabilityEmitter,
} from "@arkiol/shared";

// Stage 7: Unified render pipeline
import { renderAsset, PipelineInput, PipelineResult } from "../render/pipeline";
import { BriefAnalysis }                              from "./brief-analyzer";
import { logger as rootLogger }                       from "../../lib/logger";

// ─────────────────────────────────────────────────────────────────────────────
// Structured error types — these propagate up to the worker which marks the
// job as FAILED and triggers credit handling. No placeholder outputs are ever
// returned; every failure surfaces a clean error with a user-facing message.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Thrown when GENERATION_KILL_SWITCH=true.
 * Worker catches this, marks job FAILED with code KILL_SWITCH_ACTIVE,
 * refunds credits, and sends a user-facing 503 message.
 */
export class KillSwitchError extends Error {
  readonly code = "KILL_SWITCH_ACTIVE";
  readonly httpStatus = 503;
  readonly userMessage = "Generation is temporarily paused for maintenance. Please try again shortly.";
  constructor(jobId: string, format: string) {
    super(`[kill-switch] Generation blocked for job=${jobId} format=${format}`);
    this.name = "KillSwitchError";
  }
}

/**
 * Thrown when Stage 7 render AND its SVG fallback both fail.
 * Worker catches this, marks job FAILED with code RENDER_HARD_FAILURE,
 * refunds credits, and returns a structured error to the client.
 */
export class PipelineHardFailureError extends Error {
  readonly code = "RENDER_HARD_FAILURE";
  readonly httpStatus = 500;
  readonly userMessage = "Asset generation failed. Your credits have been refunded. Our team has been notified.";
  constructor(jobId: string, format: string, cause: string) {
    super(`[pipeline] Hard failure for job=${jobId} format=${format}: ${cause}`);
    this.name = "PipelineHardFailureError";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Pipeline context (immutable input to every stage)
// ─────────────────────────────────────────────────────────────────────────────

export interface OrchestratorInput {
  // Job context
  jobId:        string;
  orgId:        string;
  campaignId:   string;

  // Render parameters
  format:       string;
  variationIdx: number;
  stylePreset:  string;
  outputFormat: "svg" | "png" | "gif";
  gifStyle?:    "kinetic_text" | "fade" | "pulse_cta";
  pngScale?:    number;

  // Content
  brief:        BriefAnalysis;
  brand?: {
    primaryColor:   string;
    secondaryColor: string;
    fontDisplay:    string;
    fontBody:       string;
    voiceAttribs?:  Record<string, number>;
    // Raw brand kit for Stage 6 signal extraction
    colors?:        string[];
    fonts?:         Array<{ family: string }>;
    tone?:          string[];
    logoUrl?:       string;
  };

  // Variation planning (for Stage 3)
  requestedVariations:   number;
  maxAllowedVariations:  number;

  // Observability hook (optional — if absent, logs to root logger)
  observabilityEmitter?: ObservabilityEmitter;

  // ── On-Demand Asset Engine context ──────────────────────────────────────
  // Populated by the generation worker from org/plan DB data.
  // When present, the render pipeline will detect missing composition elements
  // and call generateAssetOnDemand() before the SVG build stage.
  assetEngine?: PipelineInput['assetEngine'];

  // ── Image context ───────────────────────────────────────────────────────
  // Optional — set by the caller when the user attaches an image to the brief.
  imageUrl?:      string;
  faceDetected?:  boolean;

  // ── Stage 8: Archetype + Preset Intelligence ─────────────────────────────
  // Optional manual override from editor UI. 'auto' = engine decides.
  archetypeOverride?: ArchetypePresetOverride;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pipeline result
// ─────────────────────────────────────────────────────────────────────────────

export interface OrchestratorResult {
  // Stage 7 render output (the asset)
  render:       PipelineResult;

  // Stage execution traces (for observability + benchmarking)
  stages: {
    intent:    StageResult<Intent>;
    layout:    StageResult<LayoutStrategy>;
    variation: StageResult<VariationStrategy>;
    audience:  StageResult<AudienceProfile>;
    density:   StageResult<DensityProfile>;
    brand:     StageResult<BrandSignals>;
    // Stage 7 has its own metrics inside `render`
    // Stage 8: Archetype + Preset Intelligence
    archetypeIntelligence: ArchetypeIntelligenceResult;
  };

  // Stage 8 metadata (stored for benchmarking and learning)
  archetypeMetadata: ReturnType<typeof buildArchetypeMetadata>;

  // Benchmark record (caller persists this — no DB access inside orchestrator)
  benchmark:     AssetBenchmark;

  // Aggregate state
  totalPipelineMs:  number;
  anyFallback:      boolean;
  allStagesPassed:  boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Wrap any synchronous stage fn to capture timing + errors uniformly */
function runStage<T>(
  stageId: StagePerf['stageId'],
  fn: () => StageResult<T>,
  fallback: T
): { result: StageResult<T>; perf: StagePerf } {
  const t0 = Date.now();
  try {
    const result = fn();
    const perf: StagePerf = {
      stageId,
      durationMs: Date.now() - t0,
      ok:         result.ok,
      fallback:   result.fallback,
      errorCount: result.errors.length,
    };
    return { result, perf };
  } catch (err: any) {
    const durationMs = Date.now() - t0;
    rootLogger.warn({ stageId, err: err.message }, `[orchestrator] Stage ${stageId} threw — using fallback`);
    const result: StageResult<T> = {
      ok:         false,
      data:       fallback,
      errors:     [err.message],
      durationMs,
      fallback:   true,
    };
    const perf: StagePerf = { stageId, durationMs, ok: false, fallback: true, errorCount: 1 };
    return { result, perf };
  }
}

// Validate a stage output against its Zod schema before passing downstream.
// Returns validated data or logs a warning and uses the fallback.
function validateStageOutput<T>(
  stageId: string,
  data: T,
  schema: { safeParse(v: unknown): { success: true; data: T } | { success: false; error: { message: string } } },
  fallback: T
): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    rootLogger.warn(
      { stageId, issue: (parsed as any).error?.message },
      `[orchestrator] Stage ${stageId} output failed schema — using fallback`
    );
    return fallback;
  }
  return (parsed as any).data;
}

// ─────────────────────────────────────────────────────────────────────────────
// Default fallbacks (deterministic — never random)
// ─────────────────────────────────────────────────────────────────────────────

const LAYOUT_FALLBACK: LayoutStrategy = {
  layoutType: 'hero', emphasis: 'balanced', primaryZone: 'center',
  whitespaceLevel: 'normal', confidence: 0.4,
};
const VARIATION_FALLBACK: VariationStrategy = {
  count: 1, axes: ['color'], diversity: 'low', seedBase: 'fallback',
};
const AUDIENCE_FALLBACK: AudienceProfile = {
  segment: 'consumer', tonePreference: 'casual', visualComplexity: 'moderate',
  colorSensitivity: 'vibrant', confidence: 0.3,
};
const DENSITY_FALLBACK: DensityProfile = {
  textBlockCount: 2, maxCharsPerBlock: 120, hierarchyLevels: '2',
  primaryFontSize: 'large', lineHeightScale: 1.5,
};
const BRAND_FALLBACK: BrandSignals = {
  dominantColors: ['#000000', '#FFFFFF'], fontFamily: undefined,
  toneKeywords: [], logoPosition: 'top-left', prefersDarkBg: false, historicalAccuracy: 0,
};

// ─────────────────────────────────────────────────────────────────────────────
// Stage 1: Intent Analysis
// ─────────────────────────────────────────────────────────────────────────────

const INTENT_FALLBACK: Intent = {
  prompt: 'Generate a creative asset',
  format: 'instagram_post',
};

function analyzeIntent(input: Readonly<OrchestratorInput>): StageResult<Intent> {
  const t0 = Date.now();
  try {
    const raw: Intent = {
      prompt:      input.brief.intent ?? `${input.brief.headline} ${input.brief.subhead ?? ''}`.trim(),
      format:      input.format,
      audience:    input.brief.audience,
      brandId:     undefined,  // never expose internal IDs to AI
      stylePreset: input.stylePreset,
      campaignId:  undefined,  // never expose internal IDs to AI
    };

    const parsed = IntentSchema.safeParse(raw);
    if (!parsed.success) {
      return { ok: false, data: INTENT_FALLBACK, errors: [parsed.error.message], durationMs: Date.now() - t0, fallback: true };
    }
    return { ok: true, data: parsed.data, errors: [], durationMs: Date.now() - t0, fallback: false };
  } catch (err: any) {
    return { ok: false, data: INTENT_FALLBACK, errors: [err.message], durationMs: Date.now() - t0, fallback: true };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage 6: Brand Learning → synthesize brand signals into render hints
// ─────────────────────────────────────────────────────────────────────────────

/**
 * applyBrandSignals
 *
 * Merges brand signals from Stage 6 into the PipelineInput brand spec.
 * Only ADDITIVE — never overrides values already set by the caller.
 * Returns a new object (no mutation).
 */
function applyBrandSignals(
  brand: OrchestratorInput['brand'] | undefined,
  signals: BrandSignals
): PipelineInput['brand'] {
  if (!brand) return undefined;

  return {
    primaryColor:   brand.primaryColor,
    secondaryColor: brand.secondaryColor,
    fontDisplay:    signals.fontFamily ?? brand.fontDisplay,
    fontBody:       brand.fontBody,
    voiceAttribs:   brand.voiceAttribs,
    // Brand signal enrichments (additive only)
    ...(signals.dominantColors.length ? { _brandDominantColors: signals.dominantColors } as any : {}),
    ...(signals.toneKeywords.length   ? { _brandToneKeywords:   signals.toneKeywords   } as any : {}),
    ...(signals.prefersDarkBg         ? { _brandPrefersDarkBg:  true                   } as any : {}),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main orchestrator
// ─────────────────────────────────────────────────────────────────────────────

/**
 * runGenerationPipeline
 *
 * Executes all 7 stages in strict order. Never throws — every error
 * is captured, logged, and resolved via deterministic fallback.
 * Returns a fully structured OrchestratorResult with benchmark data.
 */
export async function runGenerationPipeline(
  input: OrchestratorInput
): Promise<OrchestratorResult> {
  const pipelineStart = Date.now();
  const stagePerfs: StagePerf[] = [];
  const allErrors: string[] = [];
  const log = rootLogger;

  log.info(
    { jobId: input.jobId, format: input.format, variationIdx: input.variationIdx },
    '[orchestrator] Pipeline start'
  );

  // ── Stage 1: Intent Analysis ─────────────────────────────────────────────
  const { result: intentResult, perf: intentPerf } = runStage(
    'intent',
    () => analyzeIntent(Object.freeze({ ...input })),
    INTENT_FALLBACK
  );
  stagePerfs.push(intentPerf);
  allErrors.push(...intentResult.errors);

  const validIntent = validateStageOutput('intent', intentResult.data, IntentSchema as any, INTENT_FALLBACK);

  // ── Stage 2: Layout Intelligence ─────────────────────────────────────────
  const { result: layoutResult, perf: layoutPerf } = runStage(
    'layout',
    () => inferLayoutStrategy(Object.freeze({ ...validIntent })),
    LAYOUT_FALLBACK
  );
  stagePerfs.push(layoutPerf);
  allErrors.push(...layoutResult.errors);

  const validLayout = validateStageOutput('layout', layoutResult.data, LayoutStrategySchema as any, LAYOUT_FALLBACK);

  // ── Stage 3: Auto-Variation ───────────────────────────────────────────────
  const { result: variationResult, perf: variationPerf } = runStage(
    'variation',
    () => planVariations(
      Object.freeze({ ...validIntent }),
      input.requestedVariations,
      input.maxAllowedVariations
    ),
    VARIATION_FALLBACK
  );
  stagePerfs.push(variationPerf);
  allErrors.push(...variationResult.errors);

  const validVariation = validateStageOutput('variation', variationResult.data, VariationStrategySchema as any, VARIATION_FALLBACK);

  // ── Stage 4: Audience Modeling ────────────────────────────────────────────
  const { result: audienceResult, perf: audiencePerf } = runStage(
    'audience',
    () => modelAudience(Object.freeze({ ...validIntent })),
    AUDIENCE_FALLBACK
  );
  stagePerfs.push(audiencePerf);
  allErrors.push(...audienceResult.errors);

  const validAudience = validateStageOutput('audience', audienceResult.data, AudienceProfileSchema as any, AUDIENCE_FALLBACK);

  // ── Stage 5: Content Density / Hierarchy Optimization ────────────────────
  const { result: densityResult, perf: densityPerf } = runStage(
    'density',
    () => optimizeDensity(
      Object.freeze({ ...validLayout }),
      Object.freeze({ ...validAudience }),
      input.format
    ),
    DENSITY_FALLBACK
  );
  stagePerfs.push(densityPerf);
  allErrors.push(...densityResult.errors);

  const validDensity = validateStageOutput('density', densityResult.data, DensityProfileSchema as any, DENSITY_FALLBACK);

  // ── Stage 6: Brand Learning ───────────────────────────────────────────────
  const brandKit: Record<string, unknown> | null = input.brand
    ? {
        colors:   input.brand.colors   ?? [input.brand.primaryColor, input.brand.secondaryColor],
        fonts:    input.brand.fonts    ?? (input.brand.fontDisplay ? [{ family: input.brand.fontDisplay }] : []),
        tone:     input.brand.tone     ?? (input.brand.voiceAttribs ? Object.keys(input.brand.voiceAttribs) : []),
        logoUrl:  input.brand.logoUrl  ?? null,
      }
    : null;

  const { result: brandResult, perf: brandPerf } = runStage(
    'brand',
    () => extractBrandSignals(brandKit),
    BRAND_FALLBACK
  );
  stagePerfs.push(brandPerf);
  allErrors.push(...brandResult.errors);

  const validBrand = validateStageOutput('brand', brandResult.data, BrandSignalsSchema as any, BRAND_FALLBACK);

  // ── Stage 8: Archetype + Preset Intelligence ─────────────────────────────
  // This stage synthesizes all upstream signals (Stage 1–6) to deterministically
  // select the best archetype and style preset. It runs after brand learning
  // so brand signals (prefersDarkBg, dominant colors) can influence preset choice.
  const archetypeIntelligenceResult = selectArchetypeAndPreset({
    prompt:           validIntent.prompt,
    format:           input.format,
    campaignIntent:   input.brief.intent,
    audienceSegment:  validAudience.segment,
    tonePreference:   validAudience.tonePreference,
    layoutType:       validLayout.layoutType,
    imageProvided:    !!input.imageUrl,
    faceDetected:     input.faceDetected ?? false,
    brandHasDarkBg:   validBrand.prefersDarkBg,
    userOverride:     input.archetypeOverride,
  });

  const archetypeMetadata = buildArchetypeMetadata(archetypeIntelligenceResult);

  const archetypeStagePerf: StagePerf = {
    stageId:    'archetype_intelligence',
    durationMs: archetypeIntelligenceResult.stageMs,
    ok:         !archetypeIntelligenceResult.archetype.fallback,
    fallback:   archetypeIntelligenceResult.archetype.fallback,
    errorCount: archetypeIntelligenceResult.archetype.fallback ? 1 : 0,
  };
  stagePerfs.push(archetypeStagePerf);

  // Resolve final stylePreset: Stage 8 preset overrides input.stylePreset
  // only when input.stylePreset is missing/auto, preserving explicit caller overrides.
  const resolvedStylePreset = (
    !input.stylePreset ||
    input.stylePreset === 'auto' ||
    input.stylePreset === ''
  )
    ? archetypeIntelligenceResult.preset.presetId
    : input.stylePreset;

  // Log Stage 1–6 telemetry before Stage 7 (heaviest stage)
  log.info({
    jobId:        input.jobId,
    format:       input.format,
    variationIdx: input.variationIdx,
    intelligenceMs: stagePerfs.reduce((s, p) => s + p.durationMs, 0),
    anyFallback:    stagePerfs.some(p => p.fallback),
    layoutType:     validLayout.layoutType,
    audienceSegment:validAudience.segment,
    densityBlocks:  validDensity.textBlockCount,
    brandAccuracy:  validBrand.historicalAccuracy,
    variationAxes:  validVariation.axes.join(','),
  }, '[orchestrator] Stages 1–6 complete');

  // ── Stage 7: Asset Engine (Unified Render Pipeline) ───────────────────────
  // Thread validated outputs from all previous stages into the render input.
  // This is the critical wiring step — Stage 7 must consume Stage 1–6 signals.

  const brandForRender = applyBrandSignals(input.brand, validBrand);

  // Apply density optimization to brief (additive enrichment — no mutation of input.brief)
  const enrichedBrief: BriefAnalysis = {
    ...input.brief,
    // Stage 5: Density hints — injected as AI-guidance metadata
    // (pipeline.ts reads these from _densitySuggestions/_compositionFragment)
    ...(validDensity.maxCharsPerBlock < 80 ? {
      // Compact format: truncate body/subhead to density budget
      subhead: input.brief.subhead?.slice(0, validDensity.maxCharsPerBlock) ?? input.brief.subhead,
      body:    input.brief.body?.slice(0, validDensity.maxCharsPerBlock * 2)    ?? input.brief.body,
    } : {}),
    // Stage 4: Audience tone injection into headline style
    // (non-destructive: only adjusts if existing tone is neutral)
    ...(validAudience.tonePreference === 'playful' && !input.brief.tone
      ? { tone: 'playful' } as any
      : {}),
  };

  // Variation index modulated by Stage 3 diversity signal
  // High diversity → use variationIdx as-is; low diversity → clamp closer to seed
  const effectiveVariationIdx = validVariation.diversity === 'low'
    ? Math.min(input.variationIdx, 1)
    : input.variationIdx;

  const pipelineInput: PipelineInput = {
    format:       input.format,
    stylePreset:  resolvedStylePreset,
    variationIdx: effectiveVariationIdx,
    campaignId:   input.campaignId,
    brief:        enrichedBrief,
    brand:        brandForRender,
    outputFormat: input.outputFormat,
    gifStyle:     input.gifStyle,
    pngScale:     input.pngScale ?? 1,
    // Thread asset engine context from orchestrator input into render pipeline.
    // This enables Stage 3c/3d (detect + generate missing elements) inside renderAsset().
    ...(input.assetEngine ? { assetEngine: input.assetEngine } : {}),
  };

  const assetStageStart = Date.now();
  let renderResult: PipelineResult;
  let assetOk = true;
  let assetErrors: string[] = [];

  // ── Strict cost gate — check kill-switch before every asset render ────────
  // Enforced inside Stage 7 (per asset), not only at job enqueue.
  // This means even if kill-switch is set mid-job, remaining assets are blocked.
  // We throw KillSwitchError — NO placeholder outputs are ever returned.
  // The worker catches this, marks the job FAILED, and refunds credits.
  {
    const killResult = checkKillSwitch();
    if (!killResult.allowed) {
      log.error(
        { jobId: input.jobId, format: input.format, variationIdx: input.variationIdx },
        '[orchestrator] KILL SWITCH ACTIVE — throwing KillSwitchError (no placeholder outputs)'
      );
      throw new KillSwitchError(input.jobId, input.format);
    }
  }

  try {
    renderResult = await renderAsset(pipelineInput);
  } catch (err: any) {
    // Stage 7 fallback: attempt SVG-only render (lighter path)
    log.warn(
      { jobId: input.jobId, err: err.message, format: input.format },
      '[orchestrator] Stage 7 primary render failed — attempting SVG fallback'
    );
    try {
      renderResult = await renderAsset({ ...pipelineInput, outputFormat: 'svg' });
      assetErrors.push(`Primary render failed (${err.message}), fell back to SVG`);
      assetOk = false;
    } catch (fallbackErr: any) {
      // Both primary PNG and SVG fallback failed.
      // We throw PipelineHardFailureError — NO placeholder outputs are returned.
      // The worker catches this, marks the job FAILED, and refunds credits.
      log.error(
        { jobId: input.jobId, err: fallbackErr.message, primaryErr: err.message },
        '[orchestrator] Stage 7 total failure — throwing PipelineHardFailureError (no placeholder outputs)'
      );
      throw new PipelineHardFailureError(
        input.jobId,
        input.format,
        `primary: ${err.message} | fallback: ${fallbackErr.message}`
      );
    }
  }

  const assetPerf: StagePerf = {
    stageId:    'asset_engine',
    durationMs: Date.now() - assetStageStart,
    ok:         assetOk,
    fallback:   !assetOk,
    errorCount: assetErrors.length,
  };
  stagePerfs.push(assetPerf);
  allErrors.push(...assetErrors, ...renderResult.violations);

  const totalPipelineMs = Date.now() - pipelineStart;
  const anyFallback     = stagePerfs.some(p => p.fallback);
  const allStagesPassed = stagePerfs.every(p => p.ok) && !renderResult.violations.some(v => v.startsWith('contract:'));

  // ── Build benchmark record ────────────────────────────────────────────────
  const scoreInputs: ScoreInputs = {
    brandScore:      renderResult.brandScore,
    hierarchyValid:  renderResult.hierarchyValid,
    violations:      renderResult.violations,
    densityAnalysis: {
      isOverloaded:      validDensity.textBlockCount > 6,
      totalDensityScore: validDensity.textBlockCount * 15,
    },
    hasBrand: !!input.brand,
  };

  const benchmark = buildAssetBenchmark({
    assetId:         renderResult.assetId,
    jobId:           input.jobId,
    orgId:           input.orgId,
    format:          input.format,
    variationIdx:    input.variationIdx,
    stylePreset:     resolvedStylePreset,
    outputFormat:    input.outputFormat,
    stagePerfs,
    scoreInputs,
    totalPipelineMs,
    anyFallback,
    violationCount:  renderResult.violations.length,
    layoutFamily:    renderResult.layoutFamily,
  });

  // ── Emit observability events (non-blocking) ──────────────────────────────
  const emitter = input.observabilityEmitter ?? ((event) => {
    log.info({ observability: event }, `[orchestrator:obs] ${event.eventType}`);
  });
  emitObservabilityEvents(benchmark, emitter);

  // ── Final structured log ──────────────────────────────────────────────────
  log.info({
    jobId:           input.jobId,
    format:          input.format,
    variationIdx:    input.variationIdx,
    totalPipelineMs,
    anyFallback,
    allStagesPassed,
    overallQuality:  benchmark.quality.overallScore,
    violations:      renderResult.violations.length,
    layoutFamily:    renderResult.layoutFamily,
    brandScore:      renderResult.brandScore,
    hierarchyValid:  renderResult.hierarchyValid,
    stages:          stagePerfs.map(p => `${p.stageId}(${p.durationMs}ms${p.fallback ? ' FALLBACK' : ''})`).join(' → '),
  }, '[orchestrator] Pipeline complete');

  return {
    render:          renderResult,
    stages: {
      intent:    intentResult,
      layout:    layoutResult,
      variation: variationResult,
      audience:  audienceResult,
      density:   densityResult,
      brand:     brandResult,
      archetypeIntelligence: archetypeIntelligenceResult,
    },
    benchmark,
    archetypeMetadata,
    totalPipelineMs,
    anyFallback,
    allStagesPassed,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Convenience: run a full format × variation matrix
// ─────────────────────────────────────────────────────────────────────────────

export interface MatrixInput extends Omit<OrchestratorInput, 'format' | 'variationIdx' | 'outputFormat'> {
  formats:      string[];
  variationCount: number;
  includeGif:   boolean;
  gifStyle?:    "kinetic_text" | "fade" | "pulse_cta";
}

export interface MatrixResult {
  results:      OrchestratorResult[];
  benchmarks:   AssetBenchmark[];
  totalMs:      number;
  anyFallback:  boolean;
  errorCount:   number;
}

/**
 * runGenerationMatrix
 *
 * Runs the full pipeline for every format × variation combination.
 * Format-level failures are non-fatal — all errors are collected and returned.
 * Returns all successful results + their benchmark records.
 */
export async function runGenerationMatrix(
  matrixInput: MatrixInput
): Promise<MatrixResult> {
  const t0 = Date.now();
  const results:    OrchestratorResult[] = [];
  const benchmarks: AssetBenchmark[]     = [];
  let   errorCount = 0;

  for (const format of matrixInput.formats) {
    for (let vi = 0; vi < matrixInput.variationCount; vi++) {
      // PNG variant
      try {
        const result = await runGenerationPipeline({
          ...matrixInput,
          format,
          variationIdx:  vi,
          outputFormat:  'png',
        });
        results.push(result);
        benchmarks.push(result.benchmark);
      } catch (err: any) {
        errorCount++;
        rootLogger.error({ jobId: matrixInput.jobId, format, vi, err: err.message }, '[orchestrator:matrix] Variant failed');
      }

      // GIF variant (only for eligible formats)
      if (matrixInput.includeGif) {
        try {
          const gifResult = await runGenerationPipeline({
            ...matrixInput,
            format,
            variationIdx:  vi,
            outputFormat:  'gif',
            gifStyle:      matrixInput.gifStyle ?? 'kinetic_text',
          });
          results.push(gifResult);
          benchmarks.push(gifResult.benchmark);
        } catch (err: any) {
          errorCount++;
          rootLogger.warn({ jobId: matrixInput.jobId, format, vi, err: err.message }, '[orchestrator:matrix] GIF variant failed (non-fatal)');
        }
      }
    }
  }

  return {
    results,
    benchmarks,
    totalMs:     Date.now() - t0,
    anyFallback: results.some(r => r.anyFallback),
    errorCount,
  };
}
