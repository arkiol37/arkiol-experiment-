// packages/shared/src/metadataStore.ts
// V16: Structured Metadata Storage — Continuous Improvement Engine
//
// Stores and retrieves structured intelligence signals so results improve
// over time in a measurable way. All operations are:
//   - Schema-validated at every boundary
//   - Non-blocking (fire-and-forget writes)
//   - Idempotent (safe to call multiple times with same inputs)
//   - Append-only for the core learning records (never destructive)
//   - Isolated from plan/credit/billing logic
//
// Data model (Prisma-agnostic — uses injected client):
//   AIBenchmarkRecord   — per-asset render quality record
//   AIJobSummary        — per-job aggregated summary
//   AIStylePerformance  — per stylePreset performance accumulator
//   AIFormatPerformance — per format performance accumulator
//   AIABResult          — A/B experiment variant performance record

import { z } from 'zod';
import type { AssetBenchmark, JobBenchmarkSummary } from './benchmarking';

// ─────────────────────────────────────────────────────────────────────────────
// Style performance record (rolling aggregate per stylePreset × org)
// ─────────────────────────────────────────────────────────────────────────────

export const StylePerformanceSchema = z.object({
  id:              z.string(),
  orgId:           z.string(),
  stylePreset:     z.string(),
  sampleCount:     z.number().int().nonnegative(),
  avgQualityScore: z.number().min(0).max(1),
  avgPipelineMs:   z.number().nonnegative(),
  avgViolations:   z.number().nonnegative(),
  trend:           z.enum(['improving', 'stable', 'declining', 'insufficient_data']),
  lastUpdated:     z.string(),
});
export type StylePerformance = z.infer<typeof StylePerformanceSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Format performance record (rolling aggregate per format × org)
// ─────────────────────────────────────────────────────────────────────────────

export const FormatPerformanceSchema = z.object({
  id:              z.string(),
  orgId:           z.string(),
  format:          z.string(),
  sampleCount:     z.number().int().nonnegative(),
  avgQualityScore: z.number().min(0).max(1),
  fallbackRate:    z.number().min(0).max(1),
  topLayoutFamily: z.string().optional(),
  lastUpdated:     z.string(),
});
export type FormatPerformance = z.infer<typeof FormatPerformanceSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// A/B experiment result record
// ─────────────────────────────────────────────────────────────────────────────

export const ABResultSchema = z.object({
  id:              z.string(),
  orgId:           z.string(),
  experimentName:  z.string(),
  variant:         z.string(),
  sampleCount:     z.number().int().nonnegative(),
  avgQualityScore: z.number().min(0).max(1),
  avgPipelineMs:   z.number().nonnegative(),
  lastUpdated:     z.string(),
});
export type ABResult = z.infer<typeof ABResultSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Injected dependency interface (Prisma-agnostic)
// ─────────────────────────────────────────────────────────────────────────────

export interface MetadataStoreDeps {
  /** Prisma client — typed as any to prevent cross-package version conflicts */
  prisma?: any;
  /** Optional structured logger (pino-compatible) */
  logger?: { warn(obj: unknown, msg: string): void; error(obj: unknown, msg: string): void };
}

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic record IDs
// ─────────────────────────────────────────────────────────────────────────────

function makeStyleId(orgId: string, stylePreset: string): string {
  return `sp_${orgId}_${stylePreset}`.slice(0, 64).replace(/[^a-zA-Z0-9_]/g, '_');
}

function makeFormatId(orgId: string, format: string): string {
  return `fp_${orgId}_${format}`.slice(0, 64).replace(/[^a-zA-Z0-9_]/g, '_');
}

function makeABId(orgId: string, experimentName: string, variant: string): string {
  return `ab_${orgId}_${experimentName}_${variant}`.slice(0, 80).replace(/[^a-zA-Z0-9_]/g, '_');
}

// ─────────────────────────────────────────────────────────────────────────────
// Trend calculation helper
// ─────────────────────────────────────────────────────────────────────────────

function computeTrend(existing: number, incoming: number, sampleCount: number): StylePerformance['trend'] {
  if (sampleCount < 5) return 'insufficient_data';
  const delta = incoming - existing;
  if (delta > 0.03)  return 'improving';
  if (delta < -0.03) return 'declining';
  return 'stable';
}

// ─────────────────────────────────────────────────────────────────────────────
// Primary storage operations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * persistBenchmark
 *
 * Writes a single asset benchmark record and updates rolling aggregates.
 * Fire-and-forget — all errors are logged, never rethrown.
 *
 * Updates:
 *   1. AIBenchmarkRecord (per-asset, append-only)
 *   2. AIStylePerformance (rolling aggregate, upsert)
 *   3. AIFormatPerformance (rolling aggregate, upsert)
 *   4. AIABResult for each active A/B variant (rolling aggregate, upsert)
 */
export async function persistBenchmark(
  benchmark: AssetBenchmark,
  deps: MetadataStoreDeps
): Promise<void> {
  const { prisma, logger } = deps;
  if (!prisma) return;

  const score = benchmark.quality.overallScore;
  const now   = new Date().toISOString();

  try {
    // 1. Append per-asset benchmark record
    await prisma.aIBenchmarkRecord?.create?.({
      data: {
        id:              `bm_${benchmark.assetId}`,
        assetId:         benchmark.assetId,
        jobId:           benchmark.jobId,
        orgId:           benchmark.orgId,
        format:          benchmark.format,
        variationIdx:    benchmark.variationIdx,
        stylePreset:     benchmark.stylePreset,
        outputFormat:    benchmark.outputFormat,
        overallScore:    score,
        brandAlignment:  benchmark.quality.brandAlignment,
        hierarchyScore:  benchmark.quality.hierarchyIntegrity,
        densityScore:    benchmark.quality.densityFit,
        contrastScore:   benchmark.quality.contrastCompliance,
        violationCount:  benchmark.violationCount,
        pipelineMs:      benchmark.totalPipelineMs,
        anyFallback:     benchmark.anyFallback,
        layoutFamily:    benchmark.layoutFamily,
        abVariants:      benchmark.abVariants,
        stagePerfs:      benchmark.stagePerfs,
        renderedAt:      new Date(benchmark.renderedAt),
      },
    }).catch((e: Error) => logger?.warn({ err: e.message }, '[metadata] benchmark record write failed (non-fatal)'));

  } catch (e: any) {
    logger?.warn({ err: e.message }, '[metadata] persistBenchmark outer catch');
  }

  // 2. Upsert style performance (non-blocking — best-effort)
  upsertStylePerformance(benchmark.stylePreset, benchmark.orgId, score, benchmark.totalPipelineMs, prisma, logger).catch(() => {});

  // 3. Upsert format performance (non-blocking — best-effort)
  upsertFormatPerformance(benchmark.format, benchmark.orgId, score, benchmark.anyFallback, benchmark.layoutFamily, prisma, logger).catch(() => {});

  // 4. Upsert A/B results for each active variant (non-blocking — best-effort)
  for (const [experimentName, variant] of Object.entries(benchmark.abVariants)) {
    upsertABResult(experimentName, variant, benchmark.orgId, score, benchmark.totalPipelineMs, prisma, logger).catch(() => {});
  }
}

async function upsertStylePerformance(
  stylePreset: string, orgId: string, score: number, pipelineMs: number,
  prisma: any, logger?: MetadataStoreDeps['logger']
): Promise<void> {
  try {
    const id       = makeStyleId(orgId, stylePreset);
    const existing = await prisma.aIStylePerformance?.findUnique?.({ where: { id } });

    const existingScore = existing?.avgQualityScore ?? score;
    const newCount      = (existing?.sampleCount ?? 0) + 1;
    // Exponential moving average (α = 0.1) for smooth convergence
    const alpha         = 0.1;
    const newScore      = existing ? (1 - alpha) * existingScore + alpha * score : score;
    const newMs         = existing ? (1 - alpha) * (existing.avgPipelineMs ?? pipelineMs) + alpha * pipelineMs : pipelineMs;
    const trend         = computeTrend(existingScore, newScore, newCount);

    await prisma.aIStylePerformance?.upsert?.({
      where:  { id },
      create: { id, orgId, stylePreset, sampleCount: 1, avgQualityScore: score, avgPipelineMs: pipelineMs, avgViolations: 0, trend, lastUpdated: new Date() },
      update: { sampleCount: { increment: 1 }, avgQualityScore: newScore, avgPipelineMs: newMs, trend, lastUpdated: new Date() },
    });
  } catch (e: any) {
    logger?.warn({ err: e.message }, '[metadata] style performance upsert failed (non-fatal)');
  }
}

async function upsertFormatPerformance(
  format: string, orgId: string, score: number, isFallback: boolean, layoutFamily: string,
  prisma: any, logger?: MetadataStoreDeps['logger']
): Promise<void> {
  try {
    const id       = makeFormatId(orgId, format);
    const existing = await prisma.aIFormatPerformance?.findUnique?.({ where: { id } });

    const newCount      = (existing?.sampleCount ?? 0) + 1;
    const alpha         = 0.1;
    const existingScore = existing?.avgQualityScore ?? score;
    const newScore      = existing ? (1 - alpha) * existingScore + alpha * score : score;
    const existingFbRate = existing?.fallbackRate ?? (isFallback ? 1 : 0);
    const newFbRate     = (1 - alpha) * existingFbRate + alpha * (isFallback ? 1 : 0);

    await prisma.aIFormatPerformance?.upsert?.({
      where:  { id },
      create: { id, orgId, format, sampleCount: 1, avgQualityScore: score, fallbackRate: isFallback ? 1 : 0, topLayoutFamily: layoutFamily, lastUpdated: new Date() },
      update: { sampleCount: { increment: 1 }, avgQualityScore: newScore, fallbackRate: newFbRate, topLayoutFamily: layoutFamily, lastUpdated: new Date() },
    });
  } catch (e: any) {
    logger?.warn({ err: e.message }, '[metadata] format performance upsert failed (non-fatal)');
  }
}

async function upsertABResult(
  experimentName: string, variant: string, orgId: string, score: number, pipelineMs: number,
  prisma: any, logger?: MetadataStoreDeps['logger']
): Promise<void> {
  try {
    const id       = makeABId(orgId, experimentName, variant);
    const existing = await prisma.aIABResult?.findUnique?.({ where: { id } });

    const alpha         = 0.1;
    const existingScore = existing?.avgQualityScore ?? score;
    const newScore      = existing ? (1 - alpha) * existingScore + alpha * score : score;
    const existingMs    = existing?.avgPipelineMs ?? pipelineMs;
    const newMs         = existing ? (1 - alpha) * existingMs + alpha * pipelineMs : pipelineMs;

    await prisma.aIABResult?.upsert?.({
      where:  { id },
      create: { id, orgId, experimentName, variant, sampleCount: 1, avgQualityScore: score, avgPipelineMs: pipelineMs, lastUpdated: new Date() },
      update: { sampleCount: { increment: 1 }, avgQualityScore: newScore, avgPipelineMs: newMs, lastUpdated: new Date() },
    });
  } catch (e: any) {
    logger?.warn({ err: e.message }, '[metadata] A/B result upsert failed (non-fatal)');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Job summary persistence
// ─────────────────────────────────────────────────────────────────────────────

export async function persistJobSummary(
  summary: JobBenchmarkSummary,
  deps: MetadataStoreDeps
): Promise<void> {
  const { prisma, logger } = deps;
  if (!prisma) return;

  try {
    await prisma.aIJobSummary?.upsert?.({
      where:  { jobId: summary.jobId },
      create: {
        jobId:            summary.jobId,
        orgId:            summary.orgId,
        assetCount:       summary.assetCount,
        avgOverallScore:  summary.avgOverallScore,
        avgPipelineMs:    summary.avgPipelineMs,
        avgBrandScore:    summary.avgBrandAlignment,
        avgHierarchyScore:summary.avgHierarchyScore,
        fallbackRate:     summary.fallbackRate,
        violationRate:    summary.violationRate,
        worstStage:       summary.worstStage ?? null,
        abVariants:       summary.abVariants,
        completedAt:      new Date(summary.completedAt),
      },
      update: {
        avgOverallScore:  summary.avgOverallScore,
        avgPipelineMs:    summary.avgPipelineMs,
        fallbackRate:     summary.fallbackRate,
        violationRate:    summary.violationRate,
        worstStage:       summary.worstStage ?? null,
        completedAt:      new Date(summary.completedAt),
      },
    });
  } catch (e: any) {
    logger?.warn({ err: e.message }, '[metadata] job summary upsert failed (non-fatal)');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Read-side: retrieve performance signals for adaptive feedback
// ─────────────────────────────────────────────────────────────────────────────

export interface OrgPerformanceSnapshot {
  orgId:                string;
  topStyles:            Array<{ style: string; avgScore: number; trend: string }>;
  worstFormats:         Array<{ format: string; avgScore: number; fallbackRate: number }>;
  abWinners:            Array<{ experiment: string; winner: string; avgScore: number }>;
  globalAvgScore:       number;
  totalAssetCount:      number;
}

export async function getOrgPerformanceSnapshot(
  orgId: string,
  deps: MetadataStoreDeps
): Promise<OrgPerformanceSnapshot | null> {
  const { prisma, logger } = deps;
  if (!prisma) return null;

  try {
    const [styles, formats, abResults, jobs] = await Promise.all([
      prisma.aIStylePerformance?.findMany?.({ where: { orgId }, orderBy: { avgQualityScore: 'desc' }, take: 5 }) ?? [],
      prisma.aIFormatPerformance?.findMany?.({ where: { orgId }, orderBy: { avgQualityScore: 'asc' }, take: 5 }) ?? [],
      prisma.aIABResult?.findMany?.({ where: { orgId } }) ?? [],
      prisma.aIJobSummary?.findMany?.({ where: { orgId }, orderBy: { completedAt: 'desc' }, take: 20 }) ?? [],
    ]);

    // Aggregate A/B winners per experiment
    const abByExperiment: Record<string, { winner: string; avgScore: number }> = {};
    for (const r of abResults as any[]) {
      const cur = abByExperiment[r.experimentName];
      if (!cur || r.avgQualityScore > cur.avgScore) {
        abByExperiment[r.experimentName] = { winner: r.variant, avgScore: r.avgQualityScore };
      }
    }

    const allScores = (jobs as any[]).map(j => j.avgOverallScore).filter(Boolean);
    const globalAvg = allScores.length ? allScores.reduce((s: number, v: number) => s + v, 0) / allScores.length : 0;
    const totalCount = (jobs as any[]).reduce((s: number, j: any) => s + (j.assetCount ?? 0), 0);

    return {
      orgId,
      topStyles:   (styles as any[]).map(s => ({ style: s.stylePreset, avgScore: s.avgQualityScore, trend: s.trend })),
      worstFormats:(formats as any[]).map(f => ({ format: f.format, avgScore: f.avgQualityScore, fallbackRate: f.fallbackRate })),
      abWinners:   Object.entries(abByExperiment).map(([experiment, { winner, avgScore }]) => ({ experiment, winner, avgScore })),
      globalAvgScore: Math.round(globalAvg * 1000) / 1000,
      totalAssetCount: totalCount,
    };
  } catch (e: any) {
    logger?.warn({ err: e.message }, '[metadata] getOrgPerformanceSnapshot failed');
    return null;
  }
}
