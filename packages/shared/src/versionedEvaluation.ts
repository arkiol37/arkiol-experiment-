// packages/shared/src/versionedEvaluation.ts
// VERSIONED EVALUATION AND BENCHMARKING SYSTEM
//
// Records engine versions, routing decisions, scores, latency, fallback events,
// and user selections for A/B testing, performance regression detection, and
// audit trail production.
//
// Each generation job produces an EvaluationRecord that contains:
//   - Which engine version ran at each stage
//   - The routing mode and engine routing decisions
//   - Per-stage latency and fallback events
//   - Quality scores across all dimensions
//   - User selection signals (which output was chosen)
//   - A/B variant assignments for this request
//
// Design guarantees:
//   - All writes are fire-and-forget (never block generation)
//   - Schema-validated at every write boundary
//   - Engine version + routing decision pairs are immutable once recorded
//   - Benchmark queries are read-only aggregations (never touch active job data)
//   - A/B assignment is deterministic (same orgId + experiment = same variant)

import { z } from 'zod';
import { assignABVariant, EXPERIMENTS } from './aiLearning';
import { computeRenderQuality, RenderQuality } from './benchmarking';

// ── Stage execution record ──────────────────────────────────────────────────────

export const StageExecutionRecordSchema = z.object({
  engineName:      z.string(),
  engineVersion:   z.string(),
  stage:           z.string(),
  durationMs:      z.number().int().nonnegative(),
  ok:              z.boolean(),
  fallback:        z.boolean(),
  fallbackReason:  z.string().optional(),
  fallbackStrategy: z.string().optional(),
  costUsd:         z.number().nonnegative().optional(),
  errorMessage:    z.string().optional(),
});

export type StageExecutionRecord = z.infer<typeof StageExecutionRecordSchema>;

// ── Full evaluation record ──────────────────────────────────────────────────────

export const EvaluationRecordSchema = z.object({
  id:              z.string(),
  jobId:           z.string(),
  assetId:         z.string(),
  orgId:           z.string(),
  format:          z.string(),
  variationIdx:    z.number().int().nonnegative(),
  routingMode:     z.string(),
  // Stage-level records
  stageExecutions: z.array(StageExecutionRecordSchema),
  // Quality
  quality:         z.object({
    brandAlignment:     z.number().min(0).max(1),
    hierarchyIntegrity: z.number().min(0).max(1),
    densityFit:         z.number().min(0).max(1),
    contrastCompliance: z.number().min(0).max(1),
    violationPenalty:   z.number().min(0).max(1),
    overallScore:       z.number().min(0).max(1),
  }),
  // Pipeline summary
  totalPipelineMs: z.number().int().nonnegative(),
  anyFallback:     z.boolean(),
  fallbackCount:   z.number().int().nonnegative(),
  totalCostUsd:    z.number().nonnegative(),
  // A/B variants
  abVariants:      z.record(z.string()),
  // User selection
  userSelected:    z.boolean().default(false),
  userSelectedAt:  z.string().optional(),
  userExported:    z.boolean().default(false),
  // Routing decisions summary (engine → enabled/disabled)
  routingDecisions: z.record(z.boolean()),
  // Timestamps
  evaluatedAt:     z.string(),
});

export type EvaluationRecord = z.infer<typeof EvaluationRecordSchema>;

// ── Benchmark summary (aggregated across multiple records) ─────────────────────

export interface EngineBenchmarkSummary {
  engineName:      string;
  engineVersion:   string;
  sampleCount:     number;
  avgDurationMs:   number;
  p95DurationMs:   number;
  fallbackRate:    number;  // 0–1
  avgQualityScore: number;  // 0–1
  errorRate:       number;  // 0–1
  trend:           'improving' | 'stable' | 'declining' | 'insufficient_data';
}

export interface RoutingModeBenchmark {
  mode:              string;
  sampleCount:       number;
  avgPipelineMs:     number;
  avgQualityScore:   number;
  userSelectionRate: number;  // % of outputs actually selected by users
  exportRate:        number;
  fallbackRate:      number;
}

// ── Dependencies ──────────────────────────────────────────────────────────────

export interface VersionedEvalDeps {
  prisma?: any;
  logger?: {
    warn(obj: unknown, msg: string): void;
    error(obj: unknown, msg: string): void;
  };
}

// ── Assign A/B variants for a request ─────────────────────────────────────────

/**
 * Assign all active A/B experiments for an org.
 * Deterministic — same orgId always gets the same variants.
 */
export function assignAllVariants(orgId: string): Record<string, string> {
  return {
    [EXPERIMENTS.LAYOUT_STRATEGY.name]:  assignABVariant(orgId, EXPERIMENTS.LAYOUT_STRATEGY),
    [EXPERIMENTS.VARIATION_AXES.name]:   assignABVariant(orgId, EXPERIMENTS.VARIATION_AXES),
    [EXPERIMENTS.GENERATION_MODEL.name]: assignABVariant(orgId, EXPERIMENTS.GENERATION_MODEL),
  };
}

// ── Write evaluation record ────────────────────────────────────────────────────

/**
 * Persist a full evaluation record for a rendered asset.
 * Fire-and-forget — never blocks the generation pipeline.
 */
export async function writeEvaluationRecord(
  record: EvaluationRecord,
  deps: VersionedEvalDeps
): Promise<void> {
  if (!deps.prisma) return;
  const parsed = EvaluationRecordSchema.safeParse(record);
  if (!parsed.success) {
    deps.logger?.warn({ issues: parsed.error.issues }, '[eval] Invalid EvaluationRecord, skipping');
    return;
  }
  try {
    const d = parsed.data;
    await deps.prisma.aIBenchmarkRecord?.create?.({
      data: {
        id:              d.id,
        jobId:           d.jobId,
        assetId:         d.assetId,
        orgId:           d.orgId,
        format:          d.format,
        variationIdx:    d.variationIdx,
        routingMode:     d.routingMode,
        stageBreakdown:  d.stageExecutions as any,
        qualityScores:   d.quality as any,
        totalPipelineMs: d.totalPipelineMs,
        anyFallback:     d.anyFallback,
        fallbackCount:   d.fallbackCount,
        totalCostUsd:    d.totalCostUsd,
        abVariants:      d.abVariants as any,
        userSelected:    d.userSelected,
        userSelectedAt:  d.userSelectedAt ? new Date(d.userSelectedAt) : null,
        userExported:    d.userExported,
        routingDecisions: d.routingDecisions as any,
        overallScore:    d.quality.overallScore,
        evaluatedAt:     new Date(d.evaluatedAt),
      },
    });
  } catch (e: any) {
    deps.logger?.warn({ err: e.message, jobId: record.jobId }, '[eval] writeEvaluationRecord failed (non-fatal)');
  }
}

/**
 * Record that a user selected a specific output variant.
 * Updates the existing EvaluationRecord if found; otherwise a no-op.
 */
export async function recordUserSelection(
  assetId: string,
  orgId: string,
  deps: VersionedEvalDeps
): Promise<void> {
  if (!deps.prisma) return;
  try {
    await deps.prisma.aIBenchmarkRecord?.updateMany?.({
      where: { assetId, orgId },
      data: {
        userSelected:   true,
        userSelectedAt: new Date(),
      },
    });
  } catch (e: any) {
    deps.logger?.warn({ err: e.message, assetId }, '[eval] recordUserSelection failed (non-fatal)');
  }
}

/**
 * Record that a user exported an output.
 */
export async function recordUserExport(
  assetId: string,
  orgId: string,
  deps: VersionedEvalDeps
): Promise<void> {
  if (!deps.prisma) return;
  try {
    await deps.prisma.aIBenchmarkRecord?.updateMany?.({
      where: { assetId, orgId },
      data: { userExported: true },
    });
  } catch (e: any) {
    deps.logger?.warn({ err: e.message, assetId }, '[eval] recordUserExport failed (non-fatal)');
  }
}

// ── Benchmark aggregation queries ──────────────────────────────────────────────

/**
 * Compute per-engine benchmark summary over the last N days.
 * Returns summaries sorted by highest fallback rate (most at-risk engines first).
 */
export async function getEngineBenchmarkSummaries(
  orgId: string,
  lookbackDays: number,
  deps: VersionedEvalDeps
): Promise<EngineBenchmarkSummary[]> {
  if (!deps.prisma) return [];
  try {
    const since = new Date(Date.now() - lookbackDays * 86_400_000);
    const records = await deps.prisma.aIBenchmarkRecord?.findMany?.({
      where:   { orgId, evaluatedAt: { gte: since } },
      select:  { stageBreakdown: true, qualityScores: true, evaluatedAt: true },
      orderBy: { evaluatedAt: 'asc' },
      take:    5000,
    });

    if (!records || records.length === 0) return [];

    // Group stage executions by engineName+version
    const engineMap = new Map<string, {
      durations: number[]; fallbacks: number[]; errors: number[]; qualityScores: number[];
    }>();

    for (const rec of records) {
      const stages = (rec.stageBreakdown as StageExecutionRecord[]) ?? [];
      const quality = rec.qualityScores as { overallScore?: number } | null;
      for (const s of stages) {
        const key = `${s.engineName}@${s.engineVersion}`;
        if (!engineMap.has(key)) {
          engineMap.set(key, { durations: [], fallbacks: [], errors: [], qualityScores: [] });
        }
        const entry = engineMap.get(key)!;
        entry.durations.push(s.durationMs);
        entry.fallbacks.push(s.fallback ? 1 : 0);
        entry.errors.push(s.ok ? 0 : 1);
        if (quality?.overallScore !== undefined) {
          entry.qualityScores.push(quality.overallScore);
        }
      }
    }

    const summaries: EngineBenchmarkSummary[] = [];
    for (const [key, data] of engineMap) {
      const [engineName, engineVersion] = key.split('@');
      const n = data.durations.length;
      const avgDurationMs = data.durations.reduce((a, b) => a + b, 0) / n;
      const sorted = [...data.durations].sort((a, b) => a - b);
      const p95DurationMs = sorted[Math.floor(n * 0.95)] ?? sorted[sorted.length - 1] ?? 0;
      const fallbackRate = data.fallbacks.reduce((a, b) => a + b, 0) / n;
      const errorRate = data.errors.reduce((a, b) => a + b, 0) / n;
      const avgQualityScore = data.qualityScores.length
        ? data.qualityScores.reduce((a, b) => a + b, 0) / data.qualityScores.length
        : 0;

      // Trend: compare first third vs last third
      const third = Math.floor(n / 3);
      let trend: EngineBenchmarkSummary['trend'] = 'insufficient_data';
      if (third > 0) {
        const earlyFR = data.fallbacks.slice(0, third).reduce((a, b) => a + b, 0) / third;
        const lateFR  = data.fallbacks.slice(-third).reduce((a, b) => a + b, 0) / third;
        const delta = lateFR - earlyFR;
        trend = delta < -0.05 ? 'improving' : delta > 0.05 ? 'declining' : 'stable';
      }

      summaries.push({
        engineName, engineVersion, sampleCount: n,
        avgDurationMs: Math.round(avgDurationMs),
        p95DurationMs: Math.round(p95DurationMs),
        fallbackRate, avgQualityScore, errorRate, trend,
      });
    }

    return summaries.sort((a, b) => b.fallbackRate - a.fallbackRate);
  } catch (e: any) {
    deps.logger?.warn({ err: e.message }, '[eval] getEngineBenchmarkSummaries failed');
    return [];
  }
}

/**
 * Compute routing mode performance benchmarks.
 * Used to validate that mode selection improvements are actually working.
 */
export async function getRoutingModeBenchmarks(
  orgId: string,
  lookbackDays: number,
  deps: VersionedEvalDeps
): Promise<RoutingModeBenchmark[]> {
  if (!deps.prisma) return [];
  try {
    const since = new Date(Date.now() - lookbackDays * 86_400_000);
    const agg = await deps.prisma.aIBenchmarkRecord?.groupBy?.({
      by:      ['routingMode'],
      where:   { orgId, evaluatedAt: { gte: since } },
      _count:  { id: true },
      _avg: {
        totalPipelineMs: true,
        overallScore:    true,
      },
    }).catch(() => []);

    if (!agg || agg.length === 0) return [];

    const results: RoutingModeBenchmark[] = [];
    for (const row of agg) {
      const mode = row.routingMode ?? 'unknown';
      const count = row._count.id;

      // Get selection and export rates separately
      const [selectedCount, exportedCount, fallbackCount] = await Promise.all([
        deps.prisma.aIBenchmarkRecord?.count?.({
          where: { orgId, routingMode: mode, userSelected: true, evaluatedAt: { gte: since } },
        }).catch(() => 0),
        deps.prisma.aIBenchmarkRecord?.count?.({
          where: { orgId, routingMode: mode, userExported: true, evaluatedAt: { gte: since } },
        }).catch(() => 0),
        deps.prisma.aIBenchmarkRecord?.count?.({
          where: { orgId, routingMode: mode, anyFallback: true, evaluatedAt: { gte: since } },
        }).catch(() => 0),
      ]);

      results.push({
        mode,
        sampleCount:       count,
        avgPipelineMs:     Math.round(row._avg.totalPipelineMs ?? 0),
        avgQualityScore:   row._avg.overallScore ?? 0,
        userSelectionRate: count > 0 ? (selectedCount ?? 0) / count : 0,
        exportRate:        count > 0 ? (exportedCount ?? 0) / count : 0,
        fallbackRate:      count > 0 ? (fallbackCount ?? 0) / count : 0,
      });
    }

    return results.sort((a, b) => b.avgQualityScore - a.avgQualityScore);
  } catch (e: any) {
    deps.logger?.warn({ err: e.message }, '[eval] getRoutingModeBenchmarks failed');
    return [];
  }
}

// ── Build evaluation record from pipeline outputs ──────────────────────────────

export interface EvaluationBuildInput {
  jobId:        string;
  assetId:      string;
  orgId:        string;
  format:       string;
  variationIdx: number;
  routingMode:  string;
  stageExecutions: StageExecutionRecord[];
  quality:      RenderQuality;
  totalPipelineMs: number;
  totalCostUsd: number;
  abVariants:   Record<string, string>;
  routingDecisions: Record<string, boolean>;
}

export function buildEvaluationRecord(input: EvaluationBuildInput): EvaluationRecord {
  const anyFallback  = input.stageExecutions.some(s => s.fallback);
  const fallbackCount = input.stageExecutions.filter(s => s.fallback).length;

  return {
    id:              `eval_${input.jobId}_${input.assetId}_${input.variationIdx}`,
    jobId:           input.jobId,
    assetId:         input.assetId,
    orgId:           input.orgId,
    format:          input.format,
    variationIdx:    input.variationIdx,
    routingMode:     input.routingMode,
    stageExecutions: input.stageExecutions,
    quality:         input.quality,
    totalPipelineMs: input.totalPipelineMs,
    anyFallback,
    fallbackCount,
    totalCostUsd:    input.totalCostUsd,
    abVariants:      input.abVariants,
    userSelected:    false,
    userExported:    false,
    routingDecisions: input.routingDecisions,
    evaluatedAt:     new Date().toISOString(),
  };
}
