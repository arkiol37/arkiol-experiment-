// packages/shared/src/aiLearning.ts
// V16: AI Performance Feedback Loops, A/B Learning, Benchmarking, Adaptive Refinement
//
// Design:
//   - Passive, non-blocking — never delays generation
//   - Structured event log for observability
//   - A/B test assignment is deterministic (hash-based, not random)
//   - Benchmark scoring normalizes across contexts
//   - Adaptive refinement updates are additive, never destructive
//   - All writes are fire-and-forget (errors are logged, never rethrown)
//   - No PII stored — only orgId + aggregated signals

import { z } from 'zod';

// ── Feedback event schema ─────────────────────────────────────────────────────

export const FeedbackEventTypeSchema = z.enum([
  'generation_completed',
  'asset_accepted',
  'asset_rejected',
  'variation_selected',
  'export_completed',
  'user_edited_output',
  'template_applied',
]);

export type FeedbackEventType = z.infer<typeof FeedbackEventTypeSchema>;

export const FeedbackEventSchema = z.object({
  eventType:   FeedbackEventTypeSchema,
  orgId:       z.string(),
  sessionId:   z.string(),
  jobId:       z.string().optional(),
  assetId:     z.string().optional(),
  variationIdx: z.number().int().min(0).optional(),
  format:      z.string().optional(),
  planKey:     z.string().optional(),
  durationMs:  z.number().optional(),
  qualityScore: z.number().min(0).max(1).optional(),
  metadata:    z.record(z.unknown()).default({}),
  occurredAt:  z.string().default(() => new Date().toISOString()),
});

export type FeedbackEvent = z.infer<typeof FeedbackEventSchema>;

// ── A/B variant assignment (deterministic, not random) ───────────────────────

export interface ABExperiment {
  name:     string;
  variants: string[];
}

/**
 * Assign an A/B variant deterministically based on orgId + experiment name.
 * Same orgId always gets the same variant — no state needed.
 */
export function assignABVariant(orgId: string, experiment: ABExperiment): string {
  let hash = 0;
  const key = `${orgId}:${experiment.name}`;
  for (let i = 0; i < key.length; i++) {
    hash = ((hash << 5) - hash + key.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(hash) % experiment.variants.length;
  return experiment.variants[idx];
}

// Active V16 experiments
export const EXPERIMENTS = {
  LAYOUT_STRATEGY:   { name: 'layout_strategy_v1',   variants: ['intent_based', 'format_based'] },
  VARIATION_AXES:    { name: 'variation_axes_v1',     variants: ['color_first', 'layout_first'] },
  GENERATION_MODEL:  { name: 'generation_model_v1',   variants: ['fast_default', 'quality_default'] },
} as const;

// ── Benchmark scoring ─────────────────────────────────────────────────────────

export interface BenchmarkScore {
  category:     string;
  score:        number; // 0–1
  sampleCount:  number;
  trend:        'improving' | 'stable' | 'declining' | 'insufficient_data';
}

/**
 * Compute a benchmark score from an array of quality scores.
 * Returns a normalized score with trend analysis.
 */
export function computeBenchmarkScore(
  scores: number[],
  category: string
): BenchmarkScore {
  if (scores.length < 3) {
    return { category, score: 0, sampleCount: scores.length, trend: 'insufficient_data' };
  }

  const avg = scores.reduce((s, v) => s + v, 0) / scores.length;

  // Trend: compare last third vs first third of samples
  const third = Math.floor(scores.length / 3);
  const early = scores.slice(0, third);
  const late  = scores.slice(-third);
  const earlyAvg = early.reduce((s, v) => s + v, 0) / early.length;
  const lateAvg  = late.reduce((s, v) => s + v, 0) / late.length;
  const delta    = lateAvg - earlyAvg;

  const trend =
    delta > 0.05  ? 'improving' :
    delta < -0.05 ? 'declining' : 'stable';

  return {
    category,
    score:       Math.round(avg * 1000) / 1000,
    sampleCount: scores.length,
    trend,
  };
}

// ── Adaptive refinement signals ───────────────────────────────────────────────

export interface RefinementSignal {
  dimension:  'layout' | 'color' | 'typography' | 'density' | 'variation_count';
  direction:  'increase' | 'decrease' | 'maintain';
  confidence: number; // 0–1
  basis:      string; // human-readable reason
}

/**
 * Derive adaptive refinement signals from feedback history.
 * These signals are SUGGESTIONS — they never override user intent or plan limits.
 * Callers must validate signals against plan enforcement before applying.
 */
export function deriveRefinementSignals(
  feedbackHistory: FeedbackEvent[]
): RefinementSignal[] {
  const signals: RefinementSignal[] = [];

  // Insufficient data — return empty
  if (feedbackHistory.length < 5) return signals;

  // Acceptance rate
  const accepted = feedbackHistory.filter(e => e.eventType === 'asset_accepted').length;
  const rejected = feedbackHistory.filter(e => e.eventType === 'asset_rejected').length;
  const total    = accepted + rejected;

  if (total >= 5) {
    const acceptRate = accepted / total;

    if (acceptRate < 0.4) {
      // Low acceptance → try more variation
      signals.push({
        dimension:  'variation_count',
        direction:  'increase',
        confidence: 0.7,
        basis:      `Acceptance rate ${(acceptRate * 100).toFixed(0)}% — more variation may improve fit`,
      });
    }

    if (acceptRate > 0.8) {
      signals.push({
        dimension:  'layout',
        direction:  'maintain',
        confidence: 0.8,
        basis:      `High acceptance rate ${(acceptRate * 100).toFixed(0)}% — current layout strategy working well`,
      });
    }
  }

  // Edit rate — if users frequently edit outputs, density or hierarchy may be off
  const edited = feedbackHistory.filter(e => e.eventType === 'user_edited_output').length;
  const total2 = feedbackHistory.length;
  if (total2 >= 10 && edited / total2 > 0.6) {
    signals.push({
      dimension:  'density',
      direction:  'decrease',
      confidence: 0.6,
      basis:      `High edit rate (${(edited / total2 * 100).toFixed(0)}%) — reducing content density may improve first-use quality`,
    });
  }

  return signals;
}

// ── Passive feedback logger ───────────────────────────────────────────────────

export type FeedbackLogger = (event: Partial<FeedbackEvent>) => void;

/**
 * createFeedbackLogger
 *
 * Returns a fire-and-forget logger. Errors are swallowed — feedback logging
 * must NEVER block or degrade the generation pipeline.
 *
 * In production: pass a function that writes to your analytics sink
 * (e.g., PostHog, Mixpanel, or a Prisma table).
 */
export function createFeedbackLogger(
  sink: (event: FeedbackEvent) => Promise<void>
): FeedbackLogger {
  return (partial: Partial<FeedbackEvent>) => {
    const parsed = FeedbackEventSchema.safeParse({
      ...partial,
      occurredAt: partial.occurredAt ?? new Date().toISOString(),
      metadata:   partial.metadata ?? {},
    });

    if (!parsed.success) {
      console.warn('[ai-feedback] Invalid event schema:', parsed.error.flatten());
      return;
    }

    // Fire-and-forget
    sink(parsed.data).catch(err =>
      console.warn('[ai-feedback] Sink write failed (non-fatal):', err.message)
    );
  };
}

// ── Contextual memory (per-org signal accumulator) ───────────────────────────

export interface ContextualMemory {
  orgId:              string;
  preferredFormats:   string[];
  preferredStyles:    string[];
  avgQualityScore:    number;
  totalGenerations:   number;
  topVariationAxis:   string;
  lastActiveAt:       string;
}

/**
 * buildContextualMemory
 *
 * Aggregates feedback history into a lightweight memory object.
 * This is read-only input to the generation pipeline — never mutates plan/credit state.
 */
export function buildContextualMemory(
  orgId: string,
  feedbackHistory: FeedbackEvent[]
): ContextualMemory {
  const formats  = feedbackHistory.filter(e => e.format).map(e => e.format!);
  const scores   = feedbackHistory.filter(e => e.qualityScore != null).map(e => e.qualityScore!);

  // Count format frequency
  const formatCounts: Record<string, number> = {};
  for (const f of formats) formatCounts[f] = (formatCounts[f] ?? 0) + 1;
  const preferredFormats = Object.entries(formatCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .map(([f]) => f);

  const avgQualityScore = scores.length
    ? scores.reduce((s, v) => s + v, 0) / scores.length
    : 0.5;

  return {
    orgId,
    preferredFormats,
    preferredStyles:  [], // enriched in future iterations
    avgQualityScore:  Math.round(avgQualityScore * 1000) / 1000,
    totalGenerations: feedbackHistory.filter(e => e.eventType === 'generation_completed').length,
    topVariationAxis: 'color', // default; updated from A/B results
    lastActiveAt:     feedbackHistory[feedbackHistory.length - 1]?.occurredAt ?? new Date().toISOString(),
  };
}
