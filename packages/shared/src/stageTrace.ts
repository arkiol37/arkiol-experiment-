// packages/shared/src/stageTrace.ts
// Stage Trace Persistence — writes structured per-stage traces and job metadata
// to AIStageTrace and AIJobMetadata tables for admin observability.
//
// Contract:
//   - All writes are fire-and-forget (never throw, never delay generation)
//   - Idempotent: safe to call multiple times with same jobId
//   - Schema-validated inputs at boundaries
//   - Works with any injected Prisma-compatible client

import { z } from 'zod';

// ── Stage trace input ──────────────────────────────────────────────────────────

export const StageTraceInputSchema = z.object({
  id:             z.string(),
  jobId:          z.string(),
  assetId:        z.string(),
  orgId:          z.string(),
  stageId:        z.string(),
  stageIdx:       z.number().int().min(0),
  durationMs:     z.number().int().nonnegative(),
  ok:             z.boolean(),
  fallback:       z.boolean(),
  fallbackReason: z.string().optional(),
  decision:       z.string().optional(),
  inputHash:      z.string().optional(),
  outputSummary:  z.record(z.unknown()).optional(),
  errorMessage:   z.string().optional(),
  // V17: cost impact per stage
  estimatedCostUsd: z.number().nonnegative().optional(),
  actualCostUsd:    z.number().nonnegative().optional(),
});

export type StageTraceInput = z.infer<typeof StageTraceInputSchema>;

// ── Job metadata input ─────────────────────────────────────────────────────────

export const JobMetadataInputSchema = z.object({
  id:                  z.string(),
  jobId:               z.string(),
  orgId:               z.string(),
  stageTimings:        z.record(z.number()).optional(),
  stageDecisions:      z.record(z.string()).optional(),
  fallbackReasons:     z.array(z.object({
    stageId:  z.string(),
    reason:   z.string(),
    assetId:  z.string().optional(),
  })).optional(),
  abAssignments:       z.record(z.string()).optional(),
  stageOutputs:        z.record(z.unknown()).optional(),
  costGateResults:     z.array(z.object({
    assetId:   z.string(),
    passed:    z.boolean(),
    estimateUsd: z.number().optional(),
    reason:    z.string().optional(),
  })).optional(),
  observabilityEvents: z.array(z.unknown()).optional(),
  overallScore:        z.number().min(0).max(1).optional(),
  totalAssets:         z.number().int().nonnegative().optional(),
  totalFallbacks:      z.number().int().nonnegative().optional(),
  totalViolations:     z.number().int().nonnegative().optional(),
  totalPipelineMs:     z.number().int().nonnegative().optional(),
  killSwitchActive:    z.boolean().optional(),
  globalSpendBlocked:  z.boolean().optional(),
  // V17: aggregate cost impact for the job
  estimatedProviderCostUsd: z.number().nonnegative().optional(),
  actualProviderCostUsd:    z.number().nonnegative().optional(),
  // V17: named fallback triggers (e.g. COST_GATE_BLOCKED, KILL_SWITCH_ACTIVE)
  fallbackTriggers: z.array(z.string()).optional(),
});

export type JobMetadataInput = z.infer<typeof JobMetadataInputSchema>;

// ── Deps ───────────────────────────────────────────────────────────────────────

export interface StageTraceDeps {
  prisma?: any;
  logger?: {
    warn(obj: unknown, msg: string): void;
    error(obj: unknown, msg: string): void;
  };
}

// ── Write a single stage trace ──────────────────────────────────────────────────

export async function writeStageTrace(
  input: StageTraceInput,
  deps: StageTraceDeps
): Promise<void> {
  const { prisma, logger } = deps;
  if (!prisma) return;

  const parsed = StageTraceInputSchema.safeParse(input);
  if (!parsed.success) {
    logger?.warn({ issues: parsed.error.issues }, '[stage-trace] Invalid input, skipping write');
    return;
  }

  try {
    await prisma.aIStageTrace?.create?.({
      data: {
        id:             parsed.data.id,
        jobId:          parsed.data.jobId,
        assetId:        parsed.data.assetId,
        orgId:          parsed.data.orgId,
        stageId:        parsed.data.stageId,
        stageIdx:       parsed.data.stageIdx,
        durationMs:     parsed.data.durationMs,
        ok:             parsed.data.ok,
        fallback:       parsed.data.fallback,
        fallbackReason: parsed.data.fallbackReason ?? null,
        decision:       parsed.data.decision ?? null,
        inputHash:      parsed.data.inputHash ?? null,
        outputSummary:   parsed.data.outputSummary ?? {},
        errorMessage:    parsed.data.errorMessage ?? null,
        estimatedCostUsd: parsed.data.estimatedCostUsd ?? null,
        actualCostUsd:    parsed.data.actualCostUsd    ?? null,
      },
    });
  } catch (e: any) {
    logger?.warn({ err: e.message, stageId: input.stageId }, '[stage-trace] Write failed (non-fatal)');
  }
}

// ── Write multiple stage traces for one asset ──────────────────────────────────

export async function writeStageTraces(
  traces: StageTraceInput[],
  deps: StageTraceDeps
): Promise<void> {
  // Fire-and-forget all traces in parallel
  await Promise.allSettled(traces.map(t => writeStageTrace(t, deps)));
}

// ── Upsert job metadata ────────────────────────────────────────────────────────

export async function upsertJobMetadata(
  input: JobMetadataInput,
  deps: StageTraceDeps
): Promise<void> {
  const { prisma, logger } = deps;
  if (!prisma) return;

  const parsed = JobMetadataInputSchema.safeParse(input);
  if (!parsed.success) {
    logger?.warn({ issues: parsed.error.issues }, '[stage-trace] Invalid job metadata, skipping upsert');
    return;
  }

  const d = parsed.data;
  try {
    await prisma.aIJobMetadata?.upsert?.({
      where:  { jobId: d.jobId },
      create: {
        id:                  d.id,
        jobId:               d.jobId,
        orgId:               d.orgId,
        stageTimings:        d.stageTimings        ?? {},
        stageDecisions:      d.stageDecisions      ?? {},
        fallbackReasons:     d.fallbackReasons     ?? [],
        abAssignments:       d.abAssignments       ?? {},
        stageOutputs:        d.stageOutputs        ?? {},
        costGateResults:     d.costGateResults     ?? [],
        observabilityEvents: d.observabilityEvents ?? [],
        overallScore:        d.overallScore        ?? 0,
        totalAssets:         d.totalAssets         ?? 0,
        totalFallbacks:      d.totalFallbacks      ?? 0,
        totalViolations:     d.totalViolations     ?? 0,
        totalPipelineMs:     d.totalPipelineMs     ?? 0,
        killSwitchActive:         d.killSwitchActive              ?? false,
        globalSpendBlocked:       d.globalSpendBlocked            ?? false,
        estimatedProviderCostUsd: d.estimatedProviderCostUsd      ?? null,
        actualProviderCostUsd:    d.actualProviderCostUsd         ?? null,
        fallbackTriggers:         d.fallbackTriggers              ?? [],
      },
      update: {
        stageTimings:             d.stageTimings                  ?? {},
        stageDecisions:           d.stageDecisions                ?? {},
        fallbackReasons:          d.fallbackReasons               ?? [],
        abAssignments:            d.abAssignments                 ?? {},
        stageOutputs:             d.stageOutputs                  ?? {},
        costGateResults:          d.costGateResults               ?? [],
        observabilityEvents:      d.observabilityEvents           ?? [],
        overallScore:             d.overallScore                  ?? 0,
        totalAssets:              d.totalAssets                   ?? 0,
        totalFallbacks:           d.totalFallbacks                ?? 0,
        totalViolations:          d.totalViolations               ?? 0,
        totalPipelineMs:          d.totalPipelineMs               ?? 0,
        killSwitchActive:         d.killSwitchActive              ?? false,
        globalSpendBlocked:       d.globalSpendBlocked            ?? false,
        estimatedProviderCostUsd: d.estimatedProviderCostUsd      ?? null,
        actualProviderCostUsd:    d.actualProviderCostUsd         ?? null,
        fallbackTriggers:         d.fallbackTriggers              ?? [],
      },
    });
  } catch (e: any) {
    logger?.warn({ err: e.message, jobId: d.jobId }, '[stage-trace] Job metadata upsert failed (non-fatal)');
  }
}

// ── Build stage traces from orchestrator stagePerfs ───────────────────────────
// Converts the StagePerf[] from the pipeline orchestrator into StageTraceInput[]
// for persistence. Called by the generation worker after each pipeline run.

export interface StagePerf {
  stageId:    string;
  durationMs: number;
  ok:         boolean;
  fallback:   boolean;
  errorCount: number;
  decision?:  string;
  fallbackReason?:  string;
  // V17: cost impact per stage
  estimatedCostUsd?: number;
  actualCostUsd?:    number;
}

export function buildStageTracesFromPerfs(
  jobId:   string,
  assetId: string,
  orgId:   string,
  perfs:   StagePerf[],
): StageTraceInput[] {
  return perfs.map((p, idx) => ({
    id:              `st_${jobId}_${assetId}_${p.stageId}_${idx}`,
    jobId,
    assetId,
    orgId,
    stageId:         p.stageId,
    stageIdx:        idx,
    durationMs:      p.durationMs,
    ok:              p.ok,
    fallback:        p.fallback,
    fallbackReason:  p.fallbackReason,
    decision:        p.decision,
    outputSummary:   { errorCount: p.errorCount },
    estimatedCostUsd: p.estimatedCostUsd,
    actualCostUsd:    p.actualCostUsd,
  }));
}
