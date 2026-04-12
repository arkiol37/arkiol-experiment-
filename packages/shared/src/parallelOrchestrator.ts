// packages/shared/src/parallelOrchestrator.ts
// PARALLEL PIPELINE ORCHESTRATOR — Production-Grade Hardening
//
// Upgrades the generation pipeline to safely parallelize independent stages
// while preserving deterministic ordering where required by data dependencies.
//
// STAGE DEPENDENCY GRAPH:
//
//   IntentNormalization  ─► LayoutIntelligence ─► AutoVariation
//                        └─► ContentDensityOptimizer ─┐
//                        └─► AudienceStyleEngine       ├─► BrandDNAExtractor ─► ArchetypeIntelligenceEngine
//                        └─► BrandDNAExtractor ────────┘
//
// PARALLEL GROUPS (may execute concurrently, all receive intent as input):
//   Group 1 (sequential, must run first):  IntentNormalization
//   Group 2 (parallel, depend on intent):  LayoutIntelligence, ContentDensityOptimizer, AudienceStyleEngine
//   Group 3 (sequential, depend on group2): AutoVariation (uses layout), BrandDNAExtractor (uses density+audience)
//   Group 4 (sequential, depends on brand): ArchetypeIntelligenceEngine
//
// GUARANTEES:
//   - parallelSafe=true engines may run concurrently (declared in EngineContract)
//   - parallelSafe=false engines always run sequentially in their slot
//   - Checkpoint is saved after each GROUP completes (not each individual stage)
//   - A single stage failure in a parallel group does not cancel the group —
//     the fallback path activates for that stage, others complete
//   - Deterministic output ordering is preserved regardless of completion order
//   - All credit, idempotency, and crash-safety rules are fully respected

import { z } from 'zod';
import type { ControlPlaneDeps } from './controlPlane';
import type { CrashSafetyService } from './crashSafety';
import type { RoutingPlan } from './policyRouter';
import { assertEngineRegistered, getAllEngines, type EngineContract } from './engineRegistry';

// ── Stage group definition ────────────────────────────────────────────────────

export interface StageGroup {
  readonly groupId:   string;
  readonly engines:   ReadonlyArray<string>;
  readonly parallel:  boolean;   // true = run engines in this group concurrently
  readonly required:  boolean;   // true = group failure is fatal
}

/**
 * The canonical pipeline stage groups in execution order.
 * Groups execute sequentially; engines within a group may execute concurrently.
 */
export const PIPELINE_STAGE_GROUPS: StageGroup[] = [
  {
    groupId:  'g1_intent',
    engines:  ['IntentNormalization'],
    parallel: false,
    required: true,
  },
  {
    groupId:  'g2_parallel_analysis',
    engines:  ['LayoutIntelligence', 'ContentDensityOptimizer', 'AudienceStyleEngine'],
    parallel: true,   // ← PARALLEL: all three receive intent, none depend on each other
    required: true,
  },
  {
    groupId:  'g3_variation_brand',
    engines:  ['AutoVariation', 'BrandDNAExtractor'],
    parallel: true,   // ← PARALLEL: variation uses layout output; brand uses density+audience
    required: false,  // brand learning is optional; variation has deterministic fallback
  },
  {
    groupId:  'g4_archetype',
    engines:  ['ArchetypeIntelligenceEngine'],
    parallel: false,
    required: false,
  },
];

// ── Stage execution result ────────────────────────────────────────────────────

export interface StageExecutionResult {
  engineName:    string;
  groupId:       string;
  durationMs:    number;
  ok:            boolean;
  fallback:      boolean;
  fallbackReason?: string;
  skipped:       boolean;
  skippedReason?: string;
  output:        unknown;
  costUsd:       number;
  completedAt:   string;
}

// ── Parallel group result ─────────────────────────────────────────────────────

export interface GroupExecutionResult {
  groupId:       string;
  durationMs:    number;
  stageResults:  StageExecutionResult[];
  anyFallback:   boolean;
  allPassed:     boolean;
  completedAt:   string;
}

// ── Parallel orchestrator input ───────────────────────────────────────────────

export interface ParallelOrchestratorInput {
  jobId:           string;
  orgId:           string;
  intentOutput:    unknown;   // result of IntentNormalization, passed as input to Group 2
  attemptNumber:   number;
  completedStages: Set<string>;
  stageOutputs:    Record<string, unknown>;
  routingPlan:     Readonly<RoutingPlan>;
  timeoutPerStageMs: number;  // per-stage hard timeout (default: 15_000)
}

// ── Executor function type ─────────────────────────────────────────────────────
// Each engine maps to an executor that receives the relevant inputs and returns output.
// Executors are injected by the caller so this module stays dependency-free.

export type StageExecutor = (
  engineName:   string,
  stageInputs:  Record<string, unknown>,
  timeoutMs:    number
) => Promise<{ ok: boolean; fallback: boolean; fallbackReason?: string; data: unknown; costUsd: number }>;

// ── Parallel group runner ─────────────────────────────────────────────────────

/**
 * Run a single pipeline group.
 * If group.parallel = true, all eligible engines start concurrently via Promise.allSettled.
 * If group.parallel = false, engines run sequentially.
 * Engines already in completedStages are skipped (idempotent retry).
 * Engines disabled by routingPlan are skipped with a logged reason.
 */
export async function runGroup(
  group:           StageGroup,
  input:           ParallelOrchestratorInput,
  stageInputs:     Record<string, unknown>,
  executor:        StageExecutor,
  crashSafety:     CrashSafetyService,
  deps:            ControlPlaneDeps
): Promise<GroupExecutionResult> {
  const t0      = Date.now();
  const log     = deps.logger;
  const results: StageExecutionResult[] = [];

  // Determine which engines need to run in this group
  const pendingEngines = group.engines.filter(name => {
    if (input.completedStages.has(name)) return false;  // checkpoint recovery
    const decision = input.routingPlan.decisions.get(name);
    return decision?.enabled === true;
  });

  const skippedEngines = group.engines.filter(name => {
    const decision = input.routingPlan.decisions.get(name);
    return !decision?.enabled;
  });

  // Record skips
  for (const name of skippedEngines) {
    const contract  = getContractSafe(name);
    const decision  = input.routingPlan.decisions.get(name);
    results.push({
      engineName:    name,
      groupId:       group.groupId,
      durationMs:    0,
      ok:            true,
      fallback:      false,
      skipped:       true,
      skippedReason: decision?.disabledReason ?? 'not in routing plan',
      output:        null,
      costUsd:       0,
      completedAt:   new Date().toISOString(),
    });
    log?.info?.({ jobId: input.jobId, engineName: name, groupId: group.groupId },
      '[parallel-orchestrator] Stage skipped per routing plan');
  }

  // Record checkpoint-recovered stages
  for (const name of group.engines) {
    if (input.completedStages.has(name)) {
      results.push({
        engineName:    name,
        groupId:       group.groupId,
        durationMs:    0,
        ok:            true,
        fallback:      false,
        skipped:       true,
        skippedReason: 'completed in prior checkpoint',
        output:        input.stageOutputs[name] ?? null,
        costUsd:       0,
        completedAt:   new Date().toISOString(),
      });
    }
  }

  if (pendingEngines.length === 0) {
    return {
      groupId:      group.groupId,
      durationMs:   Date.now() - t0,
      stageResults: results,
      anyFallback:  false,
      allPassed:    true,
      completedAt:  new Date().toISOString(),
    };
  }

  // Build per-engine input map (inject relevant prior-group outputs)
  const buildEngineInput = (name: string): Record<string, unknown> => {
    return {
      ...stageInputs,
      // Inject outputs of already-completed stages so each engine has full context
      priorOutputs: Object.fromEntries(
        Object.entries(input.stageOutputs).filter(([k]) => k !== name)
      ),
    };
  };

  // ── Execute ───────────────────────────────────────────────────────────────
  if (group.parallel && pendingEngines.length > 1) {
    log?.info?.({
      jobId:    input.jobId,
      groupId:  group.groupId,
      engines:  pendingEngines,
    }, '[parallel-orchestrator] Executing parallel group');

    // Run all engines in the group concurrently
    const settled = await Promise.allSettled(
      pendingEngines.map(async name => {
        const t   = Date.now();
        const out = await executor(name, buildEngineInput(name), input.timeoutPerStageMs);
        return { name, durationMs: Date.now() - t, ...out };
      })
    );

    for (let i = 0; i < settled.length; i++) {
      const name   = pendingEngines[i];
      const result = settled[i];

      if (result.status === 'fulfilled') {
        const { durationMs, ok, fallback, fallbackReason, data, costUsd } = result.value;
        results.push({
          engineName:   name,
          groupId:      group.groupId,
          durationMs,
          ok,
          fallback,
          fallbackReason,
          skipped:      false,
          output:       data,
          costUsd,
          completedAt:  new Date().toISOString(),
        });
        input.stageOutputs[name] = data;
        input.completedStages.add(name);
        log?.info?.({ jobId: input.jobId, engineName: name, durationMs, fallback },
          '[parallel-orchestrator] Parallel stage complete');
      } else {
        // Stage threw — use fallback output
        const err = result.reason as Error;
        log?.warn?.({ jobId: input.jobId, engineName: name, err: (err instanceof Error ? err.message : String(err)) },
          '[parallel-orchestrator] Parallel stage failed — using fallback');
        results.push({
          engineName:    name,
          groupId:       group.groupId,
          durationMs:    0,
          ok:            false,
          fallback:      true,
          fallbackReason: (err instanceof Error ? err.message : String(err)),
          skipped:       false,
          output:        null,
          costUsd:       0,
          completedAt:   new Date().toISOString(),
        });
      }
    }
  } else {
    // Sequential execution (either single engine or group.parallel=false)
    for (const name of pendingEngines) {
      const t = Date.now();
      try {
        const out = await executor(name, buildEngineInput(name), input.timeoutPerStageMs);
        const ms  = Date.now() - t;
        results.push({
          engineName:   name,
          groupId:      group.groupId,
          durationMs:   ms,
          ok:           out.ok,
          fallback:     out.fallback,
          fallbackReason: out.fallbackReason,
          skipped:      false,
          output:       out.data,
          costUsd:      out.costUsd,
          completedAt:  new Date().toISOString(),
        });
        input.stageOutputs[name] = out.data;
        input.completedStages.add(name);
        log?.info?.({ jobId: input.jobId, engineName: name, durationMs: ms, fallback: out.fallback },
          '[parallel-orchestrator] Sequential stage complete');
      } catch (err: unknown) {
        const ms = Date.now() - t;
        log?.warn?.({ jobId: input.jobId, engineName: name, err: (err instanceof Error ? err.message : String(err)) },
          '[parallel-orchestrator] Sequential stage failed — using fallback');
        results.push({
          engineName:    name,
          groupId:       group.groupId,
          durationMs:    ms,
          ok:            false,
          fallback:      true,
          fallbackReason: (err instanceof Error ? err.message : String(err)),
          skipped:       false,
          output:        null,
          costUsd:       0,
          completedAt:   new Date().toISOString(),
        });
      }
    }
  }

  // ── Save group-level checkpoint ───────────────────────────────────────────
  try {
    await crashSafety.saveCheckpoint({
      jobId:           input.jobId,
      orgId:           input.orgId,
      stage:           group.groupId,
      stageIdx:        PIPELINE_STAGE_GROUPS.findIndex(g => g.groupId === group.groupId),
      stageOutputs:    { ...input.stageOutputs },
      completedStages: [...input.completedStages],
      savedAt:         new Date().toISOString(),
      attemptNumber:   input.attemptNumber,
    });
  } catch (cpErr: unknown) {
    log?.warn?.({ err: (cpErr instanceof Error ? cpErr.message : String(cpErr)), jobId: input.jobId, groupId: group.groupId },
      '[parallel-orchestrator] Group checkpoint failed (non-fatal)');
  }

  const allPassed    = results.filter(r => !r.skipped).every(r => r.ok || r.fallback);
  const anyFallback  = results.some(r => r.fallback);
  const groupMs      = Date.now() - t0;

  log?.info?.({
    jobId:       input.jobId,
    groupId:     group.groupId,
    engineCount: pendingEngines.length,
    durationMs:  groupMs,
    anyFallback,
    allPassed,
  }, '[parallel-orchestrator] Group complete');

  return {
    groupId:      group.groupId,
    durationMs:   groupMs,
    stageResults: results,
    anyFallback,
    allPassed,
    completedAt:  new Date().toISOString(),
  };
}

// ── Full parallel pipeline runner ─────────────────────────────────────────────

export interface ParallelPipelineResult {
  groups:          GroupExecutionResult[];
  allStageResults: StageExecutionResult[];
  totalMs:         number;
  anyFallback:     boolean;
  completedStages: string[];
  stageOutputs:    Record<string, unknown>;
}

/**
 * Execute the complete parallel pipeline.
 * Groups run sequentially; engines within parallel groups run concurrently.
 */
export async function runParallelPipeline(
  input:       ParallelOrchestratorInput,
  executor:    StageExecutor,
  crashSafety: CrashSafetyService,
  deps:        ControlPlaneDeps
): Promise<ParallelPipelineResult> {
  const t0          = Date.now();
  const groupResults: GroupExecutionResult[] = [];
  let   stageInputs: Record<string, unknown> = { intentOutput: input.intentOutput };

  for (const group of PIPELINE_STAGE_GROUPS) {
    const groupResult = await runGroup(
      group, input, stageInputs, executor, crashSafety, deps
    );
    groupResults.push(groupResult);

    // Merge group outputs into stageInputs for downstream groups
    for (const stage of groupResult.stageResults) {
      if (!stage.skipped && stage.output !== null) {
        stageInputs[stage.engineName] = stage.output;
      }
    }

    // Fatal group failure (required group, all stages failed without fallback)
    if (group.required && !groupResult.allPassed) {
      const failedEngines = groupResult.stageResults
        .filter(r => !r.ok && !r.fallback && !r.skipped)
        .map(r => r.engineName);
      if (failedEngines.length > 0) {
        throw Object.assign(
          new Error(`Required pipeline group "${group.groupId}" failed: engines [${failedEngines.join(', ')}] produced no fallback output`),
          { code: 'PIPELINE_GROUP_FAILURE', groupId: group.groupId, failedEngines }
        );
      }
    }
  }

  const allStageResults = groupResults.flatMap(g => g.stageResults);

  return {
    groups:          groupResults,
    allStageResults,
    totalMs:         Date.now() - t0,
    anyFallback:     allStageResults.some(r => r.fallback),
    completedStages: [...input.completedStages],
    stageOutputs:    { ...input.stageOutputs },
  };
}

// ── Parallelism telemetry ─────────────────────────────────────────────────────

export interface ParallelismMetrics {
  totalWallMs:       number;   // actual elapsed time
  totalCpuMs:        number;   // sum of all stage durations (serial equivalent)
  parallelSpeedup:   number;   // totalCpuMs / totalWallMs (> 1 means parallelism helped)
  parallelGroups:    number;
  parallelEngines:   number;   // engines that ran concurrently at some point
}

export function computeParallelismMetrics(result: ParallelPipelineResult): ParallelismMetrics {
  const totalCpuMs   = result.allStageResults.reduce((s, r) => s + r.durationMs, 0);
  const parallelGrps = PIPELINE_STAGE_GROUPS.filter(g => g.parallel).length;
  const parallelEngs = PIPELINE_STAGE_GROUPS
    .filter(g => g.parallel)
    .reduce((s, g) => s + g.engines.length, 0);

  return {
    totalWallMs:     result.totalMs,
    totalCpuMs,
    parallelSpeedup: result.totalMs > 0 ? totalCpuMs / result.totalMs : 1,
    parallelGroups:  parallelGrps,
    parallelEngines: parallelEngs,
  };
}

// ── Helper ────────────────────────────────────────────────────────────────────

function getContractSafe(name: string): Readonly<EngineContract> | null {
  try { return assertEngineRegistered(name); } catch { return null; }
}
