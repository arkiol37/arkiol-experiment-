// packages/shared/src/benchmarking.ts
// V16: Advanced AI Engine — Benchmarking, Performance Scoring & A/B Learning Hooks
//
// Design principles:
//   - All scoring is deterministic and schema-validated
//   - A/B variant assignment uses stable hashing (no random — same org/experiment = same variant)
//   - Benchmark scores are computed incrementally, never blocking the hot path
//   - Performance metrics emit structured log events for external observability (Datadog, Grafana, etc.)
//   - All writes are fire-and-forget — benchmarking NEVER delays generation
//   - Score history is capped to prevent unbounded growth
//   - Stage-level timing enables targeted optimization

import { z } from 'zod';
import { assignABVariant, EXPERIMENTS } from './aiLearning';

// ─────────────────────────────────────────────────────────────────────────────
// Stage performance record
// ─────────────────────────────────────────────────────────────────────────────

export const StagePerfSchema = z.object({
  stageId:     z.enum(['intent', 'layout', 'variation', 'audience', 'density', 'brand', 'archetype_intelligence', 'asset_engine']),
  durationMs:  z.number().nonnegative(),
  ok:          z.boolean(),
  fallback:    z.boolean(),
  errorCount:  z.number().int().nonnegative(),
});
export type StagePerf = z.infer<typeof StagePerfSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Render quality dimensions
// ─────────────────────────────────────────────────────────────────────────────

export const RenderQualitySchema = z.object({
  // 0–1 scores for each quality dimension
  brandAlignment:      z.number().min(0).max(1),  // brand color/font adherence
  hierarchyIntegrity:  z.number().min(0).max(1),  // type hierarchy correctness
  densityFit:          z.number().min(0).max(1),  // content density vs target
  contrastCompliance:  z.number().min(0).max(1),  // WCAG contrast ratio pass rate
  violationPenalty:    z.number().min(0).max(1),  // 1 - (violations / total_checks)
  // Composite
  overallScore:        z.number().min(0).max(1),  // weighted composite
});
export type RenderQuality = z.infer<typeof RenderQualitySchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Full benchmark record (one per rendered asset)
// ─────────────────────────────────────────────────────────────────────────────

export const AssetBenchmarkSchema = z.object({
  assetId:          z.string(),
  jobId:            z.string(),
  orgId:            z.string(),
  format:           z.string(),
  variationIdx:     z.number().int().nonnegative(),
  stylePreset:      z.string(),
  outputFormat:     z.enum(['svg', 'png', 'gif']),
  // Stage breakdown
  stagePerfs:       z.array(StagePerfSchema),
  // Render quality
  quality:          RenderQualitySchema,
  // End-to-end
  totalPipelineMs:  z.number().nonnegative(),
  // A/B variants active during this render
  abVariants:       z.record(z.string()),
  // Pipeline metadata
  anyFallback:      z.boolean(),
  violationCount:   z.number().int().nonnegative(),
  layoutFamily:     z.string(),
  // Timestamps
  renderedAt:       z.string(),  // ISO
});
export type AssetBenchmark = z.infer<typeof AssetBenchmarkSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Quality scoring
// ─────────────────────────────────────────────────────────────────────────────

export interface ScoreInputs {
  brandScore:      number;       // 0–100 from pipeline
  hierarchyValid:  boolean;
  violations:      string[];
  densityAnalysis: {
    isOverloaded: boolean;
    totalDensityScore: number;
  };
  hasBrand:        boolean;
}

/**
 * computeRenderQuality
 *
 * Converts raw pipeline outputs into normalized 0–1 quality dimensions.
 * Deterministic — same inputs always produce same scores.
 */
export function computeRenderQuality(inputs: ScoreInputs): RenderQuality {
  const brandAlignment = inputs.hasBrand
    ? Math.min(1, inputs.brandScore / 100)
    : 0.7; // no brand = neutral baseline

  const hierarchyIntegrity = inputs.hierarchyValid ? 1.0 : 0.5;

  const densityFit = inputs.densityAnalysis.isOverloaded ? 0.4
    : inputs.densityAnalysis.totalDensityScore > 100 ? 0.6 : 1.0;

  // Classify violations by type
  const contrastViolations = inputs.violations.filter(v => v.startsWith('style:')).length;
  const totalViolations    = inputs.violations.length;
  const contrastCompliance = totalViolations === 0 ? 1.0
    : Math.max(0, 1 - (contrastViolations / Math.max(1, totalViolations)));

  // Penalty: any violation reduces score
  const violationPenalty = totalViolations === 0 ? 1.0
    : Math.max(0, 1 - Math.min(1, totalViolations / 10));

  // Weighted composite:
  //   brand       15%
  //   hierarchy   25%
  //   density     20%
  //   contrast    25%
  //   violations  15%
  const overallScore = (
    brandAlignment      * 0.15 +
    hierarchyIntegrity  * 0.25 +
    densityFit          * 0.20 +
    contrastCompliance  * 0.25 +
    violationPenalty    * 0.15
  );

  const raw = { brandAlignment, hierarchyIntegrity, densityFit, contrastCompliance, violationPenalty, overallScore };
  const parsed = RenderQualitySchema.safeParse(raw);
  return parsed.success ? parsed.data : {
    brandAlignment: 0.5, hierarchyIntegrity: 0.5, densityFit: 0.5,
    contrastCompliance: 0.5, violationPenalty: 0.5, overallScore: 0.5,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// A/B variant capture
// ─────────────────────────────────────────────────────────────────────────────

/**
 * captureABVariants
 *
 * Reads the active A/B experiment assignments for this org.
 * All assignments are deterministic (hash-based) so no state is needed.
 */
export function captureABVariants(orgId: string): Record<string, string> {
  const variants: Record<string, string> = {};
  for (const [key, experiment] of Object.entries(EXPERIMENTS)) {
    try {
      variants[key] = assignABVariant(orgId, experiment);
    } catch {
      variants[key] = experiment.variants[0]; // safe default
    }
  }
  return variants;
}

// ─────────────────────────────────────────────────────────────────────────────
// Benchmark builder
// ─────────────────────────────────────────────────────────────────────────────

export interface BuildBenchmarkParams {
  assetId:         string;
  jobId:           string;
  orgId:           string;
  format:          string;
  variationIdx:    number;
  stylePreset:     string;
  outputFormat:    'svg' | 'png' | 'gif';
  stagePerfs:      StagePerf[];
  scoreInputs:     ScoreInputs;
  totalPipelineMs: number;
  anyFallback:     boolean;
  violationCount:  number;
  layoutFamily:    string;
}

export function buildAssetBenchmark(params: BuildBenchmarkParams): AssetBenchmark {
  const quality    = computeRenderQuality(params.scoreInputs);
  const abVariants = captureABVariants(params.orgId);

  const raw: AssetBenchmark = {
    assetId:         params.assetId,
    jobId:           params.jobId,
    orgId:           params.orgId,
    format:          params.format,
    variationIdx:    params.variationIdx,
    stylePreset:     params.stylePreset,
    outputFormat:    params.outputFormat,
    stagePerfs:      params.stagePerfs,
    quality,
    totalPipelineMs: params.totalPipelineMs,
    abVariants,
    anyFallback:     params.anyFallback,
    violationCount:  params.violationCount,
    layoutFamily:    params.layoutFamily,
    renderedAt:      new Date().toISOString(),
  };

  const parsed = AssetBenchmarkSchema.safeParse(raw);
  if (!parsed.success) {
    // Safe fallback — never throw from benchmarking
    console.warn('[benchmarking] Schema validation failed:', parsed.error.flatten());
    return raw; // return unvalidated — better than blocking the caller
  }
  return parsed.data;
}

// ─────────────────────────────────────────────────────────────────────────────
// Job-level summary
// ─────────────────────────────────────────────────────────────────────────────

export const JobBenchmarkSummarySchema = z.object({
  jobId:               z.string(),
  orgId:               z.string(),
  assetCount:          z.number().int().nonnegative(),
  avgOverallScore:     z.number().min(0).max(1),
  avgPipelineMs:       z.number().nonnegative(),
  avgBrandAlignment:   z.number().min(0).max(1),
  avgHierarchyScore:   z.number().min(0).max(1),
  fallbackRate:        z.number().min(0).max(1),
  violationRate:       z.number().min(0).max(1),   // avg violations per asset / 10 (normalized)
  worstStage:          z.string().optional(),       // stage with highest avg durationMs
  abVariants:          z.record(z.string()),
  completedAt:         z.string(),
});
export type JobBenchmarkSummary = z.infer<typeof JobBenchmarkSummarySchema>;

export function summarizeJobBenchmarks(
  jobId:      string,
  orgId:      string,
  benchmarks: AssetBenchmark[]
): JobBenchmarkSummary {
  if (benchmarks.length === 0) {
    return {
      jobId, orgId, assetCount: 0, avgOverallScore: 0, avgPipelineMs: 0,
      avgBrandAlignment: 0, avgHierarchyScore: 0, fallbackRate: 0,
      violationRate: 0, abVariants: captureABVariants(orgId),
      completedAt: new Date().toISOString(),
    };
  }

  const avg = (arr: number[]) => arr.reduce((s, v) => s + v, 0) / arr.length;

  const avgOverallScore    = avg(benchmarks.map(b => b.quality.overallScore));
  const avgPipelineMs      = avg(benchmarks.map(b => b.totalPipelineMs));
  const avgBrandAlignment  = avg(benchmarks.map(b => b.quality.brandAlignment));
  const avgHierarchyScore  = avg(benchmarks.map(b => b.quality.hierarchyIntegrity));
  const fallbackRate       = benchmarks.filter(b => b.anyFallback).length / benchmarks.length;
  const violationRate      = avg(benchmarks.map(b => Math.min(1, b.violationCount / 10)));

  // Find slowest stage across all benchmarks
  const stageTotals: Record<string, number> = {};
  for (const b of benchmarks) {
    for (const s of b.stagePerfs) {
      stageTotals[s.stageId] = (stageTotals[s.stageId] ?? 0) + s.durationMs;
    }
  }
  const worstStage = Object.keys(stageTotals).length
    ? Object.entries(stageTotals).sort(([, a], [, b]) => b - a)[0][0]
    : undefined;

  const raw: JobBenchmarkSummary = {
    jobId, orgId,
    assetCount:       benchmarks.length,
    avgOverallScore:  Math.round(avgOverallScore   * 1000) / 1000,
    avgPipelineMs:    Math.round(avgPipelineMs),
    avgBrandAlignment:Math.round(avgBrandAlignment * 1000) / 1000,
    avgHierarchyScore:Math.round(avgHierarchyScore * 1000) / 1000,
    fallbackRate:     Math.round(fallbackRate      * 1000) / 1000,
    violationRate:    Math.round(violationRate     * 1000) / 1000,
    worstStage,
    abVariants:       captureABVariants(orgId),
    completedAt:      new Date().toISOString(),
  };

  const parsed = JobBenchmarkSummarySchema.safeParse(raw);
  return parsed.success ? parsed.data : raw;
}

// ─────────────────────────────────────────────────────────────────────────────
// Structured observability event emitter
// ─────────────────────────────────────────────────────────────────────────────

export type ObservabilityEmitter = (event: ObservabilityEvent) => void;

export interface ObservabilityEvent {
  eventType:  'asset_scored' | 'job_summarized' | 'stage_slow' | 'quality_degraded';
  jobId:      string;
  orgId:      string;
  payload:    Record<string, unknown>;
  timestamp:  string;
}

/**
 * emitObservabilityEvents
 *
 * Fires structured events to any configured sink (Datadog, Grafana, console).
 * Never throws — observability must not degrade production.
 */
export function emitObservabilityEvents(
  benchmark: AssetBenchmark,
  emit: ObservabilityEmitter
): void {
  try {
    emit({
      eventType: 'asset_scored',
      jobId:     benchmark.jobId,
      orgId:     benchmark.orgId,
      payload: {
        assetId:        benchmark.assetId,
        format:         benchmark.format,
        overallScore:   benchmark.quality.overallScore,
        brandAlignment: benchmark.quality.brandAlignment,
        violationCount: benchmark.violationCount,
        pipelineMs:     benchmark.totalPipelineMs,
        anyFallback:    benchmark.anyFallback,
        abVariants:     benchmark.abVariants,
      },
      timestamp: benchmark.renderedAt,
    });

    // Slow stage alert (> 5s for any single stage)
    for (const s of benchmark.stagePerfs) {
      if (s.durationMs > 5000) {
        emit({
          eventType: 'stage_slow',
          jobId:     benchmark.jobId,
          orgId:     benchmark.orgId,
          payload:   { stageId: s.stageId, durationMs: s.durationMs },
          timestamp: new Date().toISOString(),
        });
      }
    }

    // Quality degradation alert
    if (benchmark.quality.overallScore < 0.4) {
      emit({
        eventType: 'quality_degraded',
        jobId:     benchmark.jobId,
        orgId:     benchmark.orgId,
        payload: {
          assetId:      benchmark.assetId,
          overallScore: benchmark.quality.overallScore,
          violations:   benchmark.violationCount,
          fallback:     benchmark.anyFallback,
          layoutFamily: benchmark.layoutFamily,
        },
        timestamp: new Date().toISOString(),
      });
    }
  } catch {
    // Observability must never throw
  }
}
