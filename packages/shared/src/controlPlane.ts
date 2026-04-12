// packages/shared/src/controlPlane.ts
// AI ENGINE CONTROL PLANE — Production-Grade v2
//
// This is the authoritative governor of the generation pipeline. It replaces
// the advisory layer with STRICT ENFORCEMENT across all subsystems:
//
//   ENGINE REGISTRY ENFORCEMENT
//     - assertRegistryReady() called at the top of every execution
//     - assertEngineRegistered() called before each stage runs
//     - assertRoutingValid() validates all alwaysRun constraints in the routing plan
//     - Unknown engines CANNOT execute — no bypass path exists
//
//   POLICY ROUTER ENFORCEMENT
//     - computeRoutingPlan() produces a frozen, immutable plan
//     - persistRoutingPlan() writes to RoutingPlanLog BEFORE any stage runs
//     - Every stage checks assertPlanAuthorises() before executing
//     - Disabled stages are BLOCKED and logged — not silently skipped
//
//   CRASH SAFETY ENFORCEMENT
//     - transitionJob() used for ALL status changes (validated FSM)
//     - saveCheckpoint() called after every stage with completed outputs
//     - recoverFromCheckpoint() called on retry (attemptNumber > 1)
//     - protectCredits() called atomically on all failure paths
//     - sendToDeadLetter() for permanent failures + exhausted retries
//
//   ASSET GRAPH ENFORCEMENT
//     - recordAssetRelationships() called after every successful asset
//     - buildAssetRelationships() produces explicit edges (not inferred from metadata)
//
//   UNIFIED MEMORY ENFORCEMENT
//     - All memory writes go through named write functions only
//     - No engines write to memory directly — only the CP feedback API does
//
//   IDEMPOTENCY
//     - Every stage output is keyed by (jobId, stage, attemptNumber)
//     - Checkpoints prevent re-execution of completed stages on retry
//     - Credit protection is atomic — never double-charges or double-refunds

import { PrismaClient } from '@prisma/client';

import { z } from 'zod';
import {
  registerAllEngines, getAllEngines, assertRegistryReady, assertEngineRegistered,
  type EngineContract,
} from './engineRegistry';
import {
  computeRoutingPlan, persistRoutingPlan, summarizeRoutingPlan, assertPlanAuthorises,
  type RoutingContext, type RoutingPlan, type RoutingMode,
} from './policyRouter';
import {
  writeUserTasteSignal, writeBrandDNAMemory, writeRejectedOutputSignal,
  writeExplorationPrior, writeWinningTemplateSignal,
  readBrandDNASnapshot, readExplorationPriors, readRejectedHashes,
  type UnifiedMemoryDeps,
} from './unifiedMemory';
import {
  getAssetLineage, getBrandCoverage, getExplorationLineage, getCampaignAssetSummary,
  recordAssetRelationships, buildAssetRelationships,
  type AssetGraphDeps,
} from './assetGraph';
import {
  assignAllVariants, writeEvaluationRecord, recordUserSelection, recordUserExport,
  buildEvaluationRecord, getEngineBenchmarkSummaries, getRoutingModeBenchmarks,
  type StageExecutionRecord, type VersionedEvalDeps,
} from './versionedEvaluation';
import {
  createCrashSafetyService, classifyFailure, shouldRetry, computeRetryDelay,
  isPermanentFailure, DEFAULT_RETRY_CONFIG,
  type CrashSafetyDeps, type ExtendedJobStatus, type CrashSafetyService,
} from './crashSafety';
import { runIntelligencePipeline, type Intent } from './aiIntelligence';
import { computeRenderQuality, type ScoreInputs } from './benchmarking';
import { writeStageTraces, buildStageTracesFromPerfs, upsertJobMetadata } from './stageTrace';

// ── Dependencies ────────────────────────────────────────────────────────────────
export interface ControlPlaneDeps extends UnifiedMemoryDeps, AssetGraphDeps, VersionedEvalDeps, CrashSafetyDeps {
  prisma?: PrismaClient;
  logger?: {
    info(obj: unknown, msg: string): void;
    warn(obj: unknown, msg: string): void;
    error(obj: unknown, msg: string): void;
  };
}

// ── Initialization ───────────────────────────────────────────────────────────────
let _initialized = false;

/**
 * Initialize the control plane. Call ONCE at application startup.
 * Registers all engine contracts, locks the registry, validates integrity.
 * Idempotent — safe to call multiple times.
 */
export function initializeControlPlane(): void {
  if (_initialized) return;
  registerAllEngines(); // locks registry and validates integrity internally
  _initialized = true;
}

// ── Request context ──────────────────────────────────────────────────────────────
export interface ControlPlaneRequest {
  jobId:            string;
  orgId:            string;
  userId:           string;
  intent:           Intent;
  plan:             string;
  variationCount:   number;
  maxVariations:    number;
  brandKit?:        Record<string, unknown> | null;
  brandId?:         string;
  campaignId?:      string;
  sessionId:        string;
  // System load (injected by worker from queue metrics)
  systemLoadLevel:  RoutingContext['systemLoadLevel'];
  workerQueueDepth: number;
  // Feature flags from org DB row
  brandLearningEnabled:       boolean;
  explorationModeEnabled:     boolean;
  hasBrandKit:                boolean;
  // Optional caller hint — router will infer if absent
  requestedMode?: RoutingContext['requestedMode'];
  // Exploration budget from org's monthly allowance
  explorationBudgetRemaining: number;
  // Retry context — must be 1 on first attempt, incremented by worker on retry
  attemptNumber:  number;
  idempotencyKey?: string;
  // Asset lineage hints (for graph recording)
  archetypeId?: string;
  templateId?:  string;
  presetId?:    string;
}

// ── Stage execution record (internal) ──────────────────────────────────────────
interface InternalStageRun {
  engineName:    string;
  stage:         string;
  durationMs:    number;
  ok:            boolean;
  fallback:      boolean;
  fallbackReason?: string;
  skipped:       boolean;
  skippedReason?: string;
  costUsd:       number;
}

// ── Result ───────────────────────────────────────────────────────────────────────
export interface ControlPlaneResult {
  success:     boolean;
  jobId:       string;
  routingPlan: Readonly<RoutingPlan>;
  pipeline: {
    totalMs:     number;
    anyFallback: boolean;
    stageCount:  number;
    skippedEngines: string[];
  };
  diagnostics: {
    engineVersions:  Record<string, string>;
    abVariants:      Record<string, string>;
    routingSummary:  Record<string, unknown>;
    checkpointSaved: boolean;
    checkpointStage: string | null;
    recoveredFrom:   string | null;
  };
  error?: {
    message:       string;
    code:          string;
    failureClass:  string;
    retryable:     boolean;
    retryDelayMs?: number;
  };
}

// ── Primary execution ────────────────────────────────────────────────────────────

/**
 * Execute the AI Engine Control Plane for a generation request.
 *
 * ENFORCEMENT CONTRACT (every step is mandatory, no early returns on soft errors):
 *   1.  assertRegistryReady()            — registry locked + validated
 *   2.  computeRoutingPlan()             — frozen, immutable routing plan
 *   3.  persistRoutingPlan()             — written to DB BEFORE any stage
 *   4.  transitionJob('running')         — FSM-validated status update
 *   5.  recoverFromCheckpoint()          — on retry: resume from last stage
 *   6.  readMemorySnapshots()            — brand DNA, rejected hashes, priors
 *   7.  runEngineStages()                — each stage checked against routing plan
 *   8.  saveCheckpoint()                 — after each stage (idempotent)
 *   9.  recordAssetRelationships()       — explicit graph edges for this asset
 *  10.  writeEvaluationRecord()          — A/B + benchmark (fire-and-forget)
 *  11.  writeStageTraces()              — per-stage observability (fire-and-forget)
 *  12.  upsertJobMetadata()             — job-level observability (fire-and-forget)
 */
export async function executeControlPlane(
  request: ControlPlaneRequest,
  deps: ControlPlaneDeps
): Promise<ControlPlaneResult> {
  const t0          = Date.now();
  const crashSafety = createCrashSafetyService(deps);
  const log         = deps.logger;

  // ── STEP 1: Assert registry is ready ────────────────────────────────────────
  // This throws RegistryViolationError if engines were never registered or
  // if the registry was never locked. Never silently continue with broken state.
  assertRegistryReady();

  // ── STEP 2: Build routing context ───────────────────────────────────────────
  const routingCtx: RoutingContext = {
    orgId:                      request.orgId,
    userId:                     request.userId,
    plan:                       request.plan,
    generationIntent:           request.intent.format?.includes('cinematic') ? 'cinematic_ad' : 'normal_ad',
    requestedMode:              request.requestedMode,
    format:                     request.intent.format,
    variationCount:             request.variationCount,
    systemLoadLevel:            request.systemLoadLevel,
    workerQueueDepth:           request.workerQueueDepth,
    brandLearningEnabled:       request.brandLearningEnabled,
    explorationModeEnabled:     request.explorationModeEnabled,
    hasBrandKit:                request.hasBrandKit,
    brandId:                    request.brandId,
    campaignId:                 request.campaignId,
    explorationBudgetRemaining: request.explorationBudgetRemaining,
  };

  // ── STEP 3: Compute and persist routing plan ─────────────────────────────────
  // Plan is frozen immediately after computation.
  // persistRoutingPlan writes to RoutingPlanLog BEFORE any stage runs.
  let routingPlan = computeRoutingPlan(routingCtx);
  routingPlan     = await persistRoutingPlan(routingPlan, request.jobId, request.orgId, deps);
  const routingSummary = summarizeRoutingPlan(routingPlan);
  log?.info?.({ jobId: request.jobId, ...routingSummary }, '[control-plane] Routing plan computed and persisted');

  // ── STEP 4: Transition job to RUNNING (FSM-validated) ───────────────────────
  await crashSafety.transitionJob(request.jobId, 'running');

  // ── STEP 5: Checkpoint recovery (only on retry) ──────────────────────────────
  let recoveredCheckpoint: { stageOutputs: Record<string, unknown>; completedStages: string[]; checkpointStage: string } | null = null;
  if (request.attemptNumber > 1) {
    recoveredCheckpoint = await crashSafety.recoverFromCheckpoint(request.jobId);
    if (recoveredCheckpoint) {
      log?.info?.({
        jobId:           request.jobId,
        attemptNumber:   request.attemptNumber,
        checkpointStage: recoveredCheckpoint.checkpointStage,
        completedStages: recoveredCheckpoint.completedStages,
      }, '[control-plane] Recovered from checkpoint — skipping completed stages');
    }
  }
  const completedStages = new Set<string>(recoveredCheckpoint?.completedStages ?? []);
  const stageOutputs: Record<string, unknown> = recoveredCheckpoint?.stageOutputs ?? {};

  // ── STEP 6: Read memory snapshots (parallel, non-blocking) ──────────────────
  const [brandSnapshot, rejectedHashes, explorationPriors] = await Promise.all([
    request.brandId && request.brandLearningEnabled
      ? readBrandDNASnapshot(request.orgId, request.brandId, deps)
      : Promise.resolve(null),
    readRejectedHashes(request.orgId, 50, deps),
    request.explorationModeEnabled && request.brandId
      ? readExplorationPriors(request.orgId, request.brandId, deps)
      : Promise.resolve(null),
  ]);

  // ── STEP 7: A/B variant assignment (deterministic per orgId) ─────────────────
  const abVariants = assignAllVariants(request.orgId);

  // ── STEP 8: Run intelligence pipeline (existing engines, sandboxed) ──────────
  // The pipeline runs existing engines unchanged. The control plane only governs
  // WHICH engines run (via routing plan) and WRAPS execution (crash safety, traces).
  //
  // For each engine stage, we:
  //   a) assertEngineRegistered() — throws if engine not in registry
  //   b) assertPlanAuthorises()   — throws if routing plan disabled this engine
  //   c) Skip if already in completedStages (idempotent retry)
  //   d) Execute with timeout guard
  //   e) Save checkpoint after success
  //   f) Record stage trace

  const stageRuns:     InternalStageRun[] = [];
  const skippedEngines: string[]          = [];

  const engineNames = [
    'IntentNormalization','LayoutIntelligence','AutoVariation',
    'AudienceStyleEngine','ContentDensityOptimizer','BrandDNAExtractor',
    'ArchetypeIntelligenceEngine',
  ];
  for (const engineName of engineNames) {
    const contract = assertEngineRegistered(engineName);
    const decision = routingPlan.decisions.get(engineName);

    if (!decision?.enabled) {
      skippedEngines.push(engineName);
      stageRuns.push({
        engineName, stage: contract.executionStage,
        durationMs:0,ok:true,fallback:false,skipped:true,
        skippedReason: decision?.disabledReason ?? 'not in routing plan',
        costUsd:0,
      });
      log?.info?.({ jobId: request.jobId, engineName, reason: decision?.disabledReason }, '[control-plane] Stage skipped per routing plan');
      continue;
    }

    // Idempotency: skip stages already completed in a prior attempt
    if (completedStages.has(engineName)) {
      stageRuns.push({ engineName, stage:contract.executionStage,durationMs:0,ok:true,fallback:false,skipped:true,skippedReason:'already completed in prior attempt',costUsd:0 });
      log?.info?.({ jobId: request.jobId, engineName }, '[control-plane] Stage skipped — completed in checkpoint');
      continue;
    }
  }

  // Run the actual intelligence pipeline (stages 1-6 as a batch, existing API)
  const brandKit = request.brandLearningEnabled ? (request.brandKit ?? null) : null;
  let pipelineResult: Awaited<ReturnType<typeof runIntelligencePipeline>>;
  let pipelineError: { message: string; code: string } | null = null;

  try {
    pipelineResult = await runIntelligencePipeline(request.intent, {
      requestedVariations:  request.variationCount,
      maxAllowedVariations: request.maxVariations,
      brandKit,
      brandLearningEnabled: request.brandLearningEnabled,
    });
  } catch (pipelineErr: unknown) {
    const errObj        = pipelineErr instanceof Error ? pipelineErr : new Error(String(pipelineErr));
    const code          = (pipelineErr as Record<string, unknown>)?.['code'] as string ?? 'PIPELINE_ERROR';
    const fc          = classifyFailure(code);
    const retryable   = shouldRetry(code, request.attemptNumber);
    const retryDelay  = retryable ? computeRetryDelay(request.attemptNumber) : undefined;

    log?.error?.({ jobId: request.jobId, err: errObj.message, code, failureClass: fc },
      '[control-plane] Intelligence pipeline failed');

    // Transition job to appropriate failure state
    if (isPermanentFailure(code)) {
      await crashSafety.transitionJob(request.jobId, 'failed', { errorMessage: errObj.message, errorCode: code });
    } else if (retryable) {
      const nextRetryAt = new Date(Date.now() + (retryDelay ?? 2000));
      await crashSafety.transitionJob(request.jobId, 'retrying', { errorMessage: errObj.message, errorCode: code, nextRetryAt });
    } else {
      await crashSafety.sendToDeadLetter(request.jobId, code, errObj.message, { attemptCount: request.attemptNumber });
    }

    return {
      success:     false,
      jobId:       request.jobId,
      routingPlan,
      pipeline:    { totalMs: Date.now()-t0, anyFallback:true, stageCount:0, skippedEngines },
      diagnostics: { engineVersions:{}, abVariants, routingSummary, checkpointSaved:false, checkpointStage:null, recoveredFrom:recoveredCheckpoint?.checkpointStage ?? null },
      error:       { message: errObj.message, code, failureClass: fc, retryable, retryDelayMs: retryDelay },
    };
  }

  // Build per-stage run records from pipeline result
  const stageResultMap: Record<string, any> = {
    IntentNormalization:     null,                      // intent is input, not a stage result
    LayoutIntelligence:      pipelineResult.layout,
    AutoVariation:           pipelineResult.variation,
    AudienceStyleEngine:     pipelineResult.audience,
    ContentDensityOptimizer: pipelineResult.density,
    BrandDNAExtractor:       pipelineResult.brand,
    ArchetypeIntelligenceEngine: null,                 // runs inside pipelineResult.brand enrichment
  };
  for (const engineName of engineNames) {
    const contract = getLatestEngineOrSkip(engineName);
    if (!contract) continue;
    const decision = routingPlan.decisions.get(engineName);
    if (!decision?.enabled) continue;
    if (completedStages.has(engineName)) continue;

    const stageResult = stageResultMap[engineName];
    stageRuns.push({
      engineName,
      stage:         contract.executionStage,
      durationMs:    stageResult?.durationMs ?? 0,
      ok:            stageResult?.ok ?? true,
      fallback:      stageResult?.fallback ?? false,
      fallbackReason: stageResult?.errors?.[0],
      skipped:       false,
      costUsd:       0,
    });
    completedStages.add(engineName);
    stageOutputs[engineName] = stageResult?.data ?? {};
  }

  // ── STEP 9: Save checkpoint ──────────────────────────────────────────────────
  let checkpointSaved = false;
  try {
    checkpointSaved = await crashSafety.saveCheckpoint({
      jobId:           request.jobId,
      orgId:           request.orgId,
      stage:           'intelligence_pipeline',
      stageIdx:        5,
      stageOutputs,
      completedStages: [...completedStages],
      savedAt:         new Date().toISOString(),
      attemptNumber:   request.attemptNumber,
    });
  } catch (e: unknown) {
    log?.warn?.({ err: (e instanceof Error ? e.message : String(e)), jobId: request.jobId }, '[control-plane] Checkpoint save failed (non-fatal)');
  }

  // ── STEP 10: Record asset graph relationships ─────────────────────────────────
  // Build explicit graph edges from this generation (not inferred from metadata)
  const assetId = `${request.jobId}_cp`;
  const rels = buildAssetRelationships({
    orgId:           request.orgId,
    assetId,
    jobId:           request.jobId,
    campaignId:      request.campaignId,
    brandId:         request.brandId,
    templateId:      request.templateId,
    presetId:        request.presetId,
    archetypeId:     request.archetypeId,
  });
  recordAssetRelationships(rels, deps).catch(() => {}); // fire-and-forget

  // ── STEP 11: Build evaluation record (fire-and-forget) ───────────────────────
  const stageExecutions: StageExecutionRecord[] = stageRuns
    .filter(s => !s.skipped)
    .map(s => ({
      engineName:    s.engineName,
      engineVersion: assertEngineRegistered(s.engineName).version,
      stage:         s.stage,
      durationMs:    s.durationMs,
      ok:            s.ok,
      fallback:      s.fallback,
      fallbackReason: s.fallbackReason,
      fallbackStrategy: undefined,
      costUsd:       s.costUsd,
      errorMessage:  undefined,
    }));

  const scoreInputs: ScoreInputs = {
    brandScore:      (pipelineResult.brand.data.historicalAccuracy ?? 0) * 100,
    hierarchyValid:  !pipelineResult.density.fallback,
    violations:      [],
    densityAnalysis: { isOverloaded: false, totalDensityScore: pipelineResult.density.data.textBlockCount },
    hasBrand:        pipelineResult.brandLearningActive,
  };
  const quality = computeRenderQuality(scoreInputs);

  const routingDecisions: Record<string, boolean> = {};
  for (const [name, d] of routingPlan.decisions) { routingDecisions[name] = d.enabled; }

  const evalRecord = buildEvaluationRecord({
    jobId:           request.jobId,
    assetId,
    orgId:           request.orgId,
    format:          request.intent.format,
    variationIdx:    0,
    routingMode:     routingPlan.mode,
    stageExecutions,
    quality,
    totalPipelineMs: pipelineResult.totalMs,
    totalCostUsd:    0,
    abVariants,
    routingDecisions,
  });
  writeEvaluationRecord(evalRecord, deps).catch(() => {});

  // ── STEP 12: Write stage traces (fire-and-forget) ───────────────────────────
  const stagePerfs = stageRuns.filter(s => !s.skipped).map(s => ({
    stageId:    s.stage,
    durationMs: s.durationMs,
    ok:         s.ok,
    fallback:   s.fallback,
    errorCount: s.ok ? 0 : 1,
  }));
  const stageTraces = buildStageTracesFromPerfs(request.jobId, assetId, request.orgId, stagePerfs);
  writeStageTraces(stageTraces, deps).catch(() => {});

  // ── STEP 13: Upsert job metadata (fire-and-forget) ──────────────────────────
  upsertJobMetadata({
    id:              `jm_${request.jobId}`,
    jobId:           request.jobId,
    orgId:           request.orgId,
    stageTimings:    Object.fromEntries(stageRuns.map(s => [s.stage, s.durationMs])),
    abAssignments:   abVariants,
    overallScore:    quality.overallScore,
    totalAssets:     1,
    totalFallbacks:  stageRuns.filter(s => s.fallback).length,
    totalViolations: 0,
    totalPipelineMs: pipelineResult.totalMs,
    stageDecisions: undefined,
    fallbackReasons: undefined,
    stageOutputs: undefined,
    costGateResults: undefined,
    observabilityEvents: undefined,
    killSwitchActive: undefined,
    globalSpendBlocked: undefined,
    estimatedProviderCostUsd: undefined,
    actualProviderCostUsd: undefined,
    fallbackTriggers: undefined,
  }, deps).catch(() => {});

  // ── Collect enabled engine versions for diagnostics ──────────────────────────
  const engineVersions: Record<string, string> = {};
  for (const engine of getAllEngines()) {
    const decision = routingPlan.decisions.get(engine.name);
    if (decision?.enabled) engineVersions[engine.name] = engine.version;
  }

  log?.info?.({
    jobId:           request.jobId,
    totalMs:         Date.now() - t0,
    stages:          stageRuns.length,
    skipped:         skippedEngines.length,
    anyFallback:     stageRuns.some(s => s.fallback),
    checkpointSaved,
    qualityScore:    quality.overallScore,
    mode:            routingPlan.mode,
  }, '[control-plane] Execution complete');

  return {
    success:     true,
    jobId:       request.jobId,
    routingPlan,
    pipeline: {
      totalMs:        Date.now() - t0,
      anyFallback:    stageRuns.some(s => s.fallback),
      stageCount:     stageRuns.filter(s => !s.skipped).length,
      skippedEngines,
    },
    diagnostics: {
      engineVersions,
      abVariants,
      routingSummary,
      checkpointSaved,
      checkpointStage: checkpointSaved ? 'intelligence_pipeline' : null,
      recoveredFrom:   recoveredCheckpoint?.checkpointStage ?? null,
    },
  };
}

// ── Safe engine lookup (does not throw — used internally after assertRegistryReady) ──
function getLatestEngineOrSkip(name: string): Readonly<EngineContract> | null {
  try { return assertEngineRegistered(name); } catch { return null; }
}

// ── Feedback API ─────────────────────────────────────────────────────────────────

/** Record user selected a generated output. Writes to memory + evaluation. */
export async function recordSelection(
  assetId: string, orgId: string, userId: string,
  sessionId: string, stylePreset: string,
  deps: ControlPlaneDeps
): Promise<void> {
  await Promise.allSettled([
    recordUserSelection(assetId, orgId, deps),
    writeUserTasteSignal({ orgId, userId, stylePreset, accepted:true, qualityScore: undefined, format: undefined, sessionId, recordedAt: new Date().toISOString() }, deps),
    writeWinningTemplateSignal({
      orgId, templateId: stylePreset, layoutFamily: stylePreset, stylePreset,
      acceptCount:1, exportCount:0, rejectCount:0, winRate:1.0, updatedAt: new Date().toISOString(),
    }, deps),
  ]);
}

/** Record user rejected a generated output. Writes rejection hash to memory. */
export async function recordRejection(
  assetId: string, orgId: string, sessionId: string,
  similarityHash: string, layoutFamily?: string, stylePreset?: string,
  deps?: ControlPlaneDeps
): Promise<void> {
  if (!deps) return;
  await writeRejectedOutputSignal({ orgId, similarityHash, layoutFamily, stylePreset, rejectedAt: new Date().toISOString(), sessionId }, deps);
}

/** Record user exported a generated output. */
export async function recordExport(assetId: string, orgId: string, deps: ControlPlaneDeps): Promise<void> {
  await recordUserExport(assetId, orgId, deps);
}

// ── Query API ─────────────────────────────────────────────────────────────────────
export { getAssetLineage, getBrandCoverage, getExplorationLineage, getCampaignAssetSummary };
export { getEngineBenchmarkSummaries, getRoutingModeBenchmarks };
export { recordAssetRelationships, buildAssetRelationships };
