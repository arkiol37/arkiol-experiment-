// src/engines/memory/learning-signals.ts
//
// Extracts evaluation signals from pipeline results and computes
// lightweight learning biases that influence future generation.
// Uses the generation ledger to identify which themes and layouts
// produce the best outcomes, nudging selection toward proven choices
// while still allowing exploration of new options.

import {
  getRecentGenerations,
  type LedgerFilter,
  type GenerationRecord,
} from "./generation-ledger";

// ── Learning bias ───────────────────────────────────────────────────────────

export interface LearningBias {
  themeBoosts: Record<string, number>;
  layoutBoosts: Record<string, number>;
  // Step 33: category-specific quality signal. Positive if the
  // categoryPackId's recent generations outperformed the global mean.
  // Callers can use it to boost the confidence they apply when a brief
  // lands in a historically-strong category.
  categoryBoosts: Record<string, number>;
  confidence: number;
}

const MIN_RECORDS_FOR_BIAS = 5;
const MAX_BOOST = 0.15;
const FEEDBACK_WEIGHT = { positive: 1.5, negative: -1.0, neutral: 0 } as const;

// ── Compute bias ────────────────────────────────────────────────────────────

export function computeLearningBias(filter: LedgerFilter = {}): LearningBias {
  const records = getRecentGenerations(filter, 100);

  if (records.length < MIN_RECORDS_FOR_BIAS) {
    return { themeBoosts: {}, layoutBoosts: {}, categoryBoosts: {}, confidence: 0 };
  }

  const themeBoosts    = computeBoosts(records, r => r.themeId);
  const layoutBoosts   = computeBoosts(records, r => r.layoutFamily);
  // Records without a categoryPackId are skipped via empty-string guard
  // inside computeBoosts; empty keys don't surface in the returned map.
  const categoryBoosts = computeBoosts(records, r => r.categoryPackId ?? "");

  const confidence = Math.min(1, records.length / 50);

  return { themeBoosts, layoutBoosts, categoryBoosts, confidence };
}

function computeBoosts(
  records: GenerationRecord[],
  keyFn: (r: GenerationRecord) => string,
): Record<string, number> {
  const grouped = new Map<string, { totalSignal: number; count: number }>();

  for (const r of records) {
    const key = keyFn(r);
    // Skip empty keys so the category-boost map doesn't accumulate an ""
    // bucket for records without a categoryPackId.
    if (!key) continue;
    const entry = grouped.get(key) ?? { totalSignal: 0, count: 0 };
    entry.count++;

    let signal = r.qualityScore;

    if (r.feedback) {
      signal += FEEDBACK_WEIGHT[r.feedback];
    }

    // Step 33: user-selected records carry the strongest signal — they
    // tell us the user actively chose this output from the candidate
    // batch, which is a stronger statement than any auto-score.
    if (r.selected) signal += 0.30;

    if (r.recoveryCount > 0) signal -= 0.1;
    if (!r.hierarchyValid) signal -= 0.15;

    entry.totalSignal += signal;
    grouped.set(key, entry);
  }

  if (grouped.size === 0) return {};

  const avgSignals = new Map<string, number>();
  for (const [key, data] of grouped) {
    avgSignals.set(key, data.totalSignal / data.count);
  }

  const allAvgs = [...avgSignals.values()];
  const globalMean = allAvgs.reduce((s, v) => s + v, 0) / allAvgs.length;

  const boosts: Record<string, number> = {};
  for (const [key, avg] of avgSignals) {
    const count = grouped.get(key)!.count;
    const countWeight = Math.min(1, count / 5);
    const rawBoost = (avg - globalMean) * countWeight;
    boosts[key] = clamp(rawBoost, -MAX_BOOST, MAX_BOOST);
  }

  return boosts;
}

// ── Apply bias to theme scoring ─────────────────────────────────────────────

export function applyThemeBias(
  themeId: string,
  baseScore: number,
  bias: LearningBias,
): number {
  const boost = bias.themeBoosts[themeId] ?? 0;
  return clamp(baseScore + boost * bias.confidence, 0, 1);
}

export function applyLayoutBias(
  layoutFamily: string,
  baseScore: number,
  bias: LearningBias,
): number {
  const boost = bias.layoutBoosts[layoutFamily] ?? 0;
  return clamp(baseScore + boost * bias.confidence, 0, 1);
}

// ── Signal extraction from pipeline result ──────────────────────────────────

export interface EvaluationSignals {
  qualityScore: number;
  designQualityScore: number;
  brandScore: number;
  hierarchyValid: boolean;
  violationCount: number;
  recoveryCount: number;
}

export function extractEvaluationSignals(result: {
  brandScore: number;
  hierarchyValid: boolean;
  violations: string[];
  recoveryActions?: Array<{ severity: string }>;
}): EvaluationSignals {
  return {
    qualityScore: 0,
    designQualityScore: 0,
    brandScore: result.brandScore,
    hierarchyValid: result.hierarchyValid,
    violationCount: result.violations.length,
    recoveryCount: result.recoveryActions?.length ?? 0,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
