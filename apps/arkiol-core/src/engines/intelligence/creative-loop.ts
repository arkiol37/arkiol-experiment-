// src/engines/intelligence/creative-loop.ts
//
// Creative Intelligence Loop — the self-improving feedback cycle that
// connects user actions back into every learning system.
//
// Provides a single entry point (processFeedback) that fans out to:
//   • Generation Ledger — records raw feedback on past outputs
//   • Learning Signals  — updates theme/layout boosts for svg-builder
//   • Design DNA        — updates per-user style profile
//   • Exploration Priors — updates bandit arm weights for genome generation
//
// Also computes system-wide performance insights and adaptive strategies
// that bias future generation toward proven patterns.

import {
  recordFeedback as ledgerRecordFeedback,
  getRecentGenerations,
  getLedgerStats,
  type GenerationRecord,
  type LedgerFilter,
  type LedgerStats,
} from "../memory/generation-ledger";
import {
  computeLearningBias,
  type LearningBias,
} from "../memory/learning-signals";
import {
  getDesignDNA,
  applyDNAFeedback,
  type DesignDNA,
  type DNAFeedbackSignal,
  type DNAFeedbackType,
} from "../personalization/design-dna";
import { extractTraitsFromTheme } from "../personalization/dna-applicator";

// ── Unified feedback event ─────────────────────────────────────────────────

export type FeedbackAction =
  | "selected"
  | "exported"
  | "favorited"
  | "dismissed"
  | "regenerated"
  | "edited"
  | "style_override"
  | "time_spent_high"
  | "time_spent_low";

export interface CreativeFeedback {
  userId: string;
  brandId?: string;
  assetId: string;
  action: FeedbackAction;
  format: string;
  themeId?: string;
  layoutFamily?: string;
  themeSnapshot?: {
    id: string;
    palette?: { background: string };
    typography?: { headline?: { fontWeight: number; letterSpacing?: number } };
    decorations?: Array<{ kind: string }>;
    ctaStyle?: { borderRadius: number; shadow?: boolean };
    overlayOpacity?: number;
    headlineSizeMultiplier?: number;
  };
}

// ── Feedback result ────────────────────────────────────────────────────────

export interface FeedbackResult {
  ledgerUpdated: boolean;
  dnaUpdated: boolean;
  updatedDNA?: DesignDNA;
  systemInsights: SystemInsights;
}

// ── Action → ledger feedback mapping ───────────────────────────────────────

const ACTION_TO_LEDGER: Record<FeedbackAction, "positive" | "negative" | "neutral"> = {
  selected: "positive",
  exported: "positive",
  favorited: "positive",
  dismissed: "negative",
  regenerated: "neutral",
  edited: "positive",
  style_override: "neutral",
  time_spent_high: "positive",
  time_spent_low: "negative",
};

const ACTION_TO_DNA: Record<FeedbackAction, DNAFeedbackType | null> = {
  selected: "selected",
  exported: "exported",
  favorited: "favorited",
  dismissed: "dismissed",
  regenerated: "regenerated",
  edited: "edited",
  style_override: "style_override",
  time_spent_high: null,
  time_spent_low: null,
};

// ── Main feedback processor ────────────────────────────────────────────────

export function processFeedback(feedback: CreativeFeedback): FeedbackResult {
  // 1. Update generation ledger
  const ledgerFeedback = ACTION_TO_LEDGER[feedback.action];
  const ledgerUpdated = ledgerRecordFeedback(feedback.assetId, ledgerFeedback);

  // 2. Update Design DNA (if user-identifiable action)
  let dnaUpdated = false;
  let updatedDNA: DesignDNA | undefined;

  const dnaAction = ACTION_TO_DNA[feedback.action];
  if (dnaAction) {
    const dna = getDesignDNA(feedback.userId, feedback.brandId);
    const traits = feedback.themeSnapshot
      ? extractTraitsFromTheme(feedback.themeSnapshot)
      : {};

    const signal: DNAFeedbackSignal = {
      userId: feedback.userId,
      brandId: feedback.brandId,
      feedbackType: dnaAction,
      themeId: feedback.themeId,
      layoutFamily: feedback.layoutFamily,
      styleTraits: traits,
    };

    updatedDNA = applyDNAFeedback(dna, signal);
    dnaUpdated = true;
  }

  // 3. Compute current system insights
  const systemInsights = computeSystemInsights(feedback.format);

  return { ledgerUpdated, dnaUpdated, updatedDNA, systemInsights };
}

// ── Batch feedback processor ───────────────────────────────────────────────

export function processFeedbackBatch(feedbacks: CreativeFeedback[]): FeedbackResult[] {
  return feedbacks.map(processFeedback);
}

// ═══════════════════════════════════════════════════════════════════════════
// § SYSTEM INSIGHTS — cross-cutting intelligence from all learning systems
// ═══════════════════════════════════════════════════════════════════════════

export interface SystemInsights {
  performanceTrend: "improving" | "stable" | "declining";
  avgQualityRecent: number;
  avgQualityOlder: number;
  qualityDelta: number;
  feedbackRate: number;
  positiveRatio: number;
  topPerformingThemes: Array<{ themeId: string; avgQuality: number; count: number }>;
  underperformingThemes: Array<{ themeId: string; avgQuality: number; count: number }>;
  topPerformingLayouts: Array<{ layoutFamily: string; avgQuality: number; count: number }>;
  formatStrengths: Array<{ format: string; avgQuality: number; count: number }>;
  learningBias: LearningBias;
  recommendedActions: string[];
}

export function computeSystemInsights(formatFilter?: string): SystemInsights {
  const filter: LedgerFilter = formatFilter ? { format: formatFilter } : {};
  const stats = getLedgerStats(filter);
  const learningBias = computeLearningBias(filter);

  // Split recent vs older for trend detection
  const allRecords = getRecentGenerations(filter, 100);
  const midpoint = Math.floor(allRecords.length / 2);
  const recentHalf = allRecords.slice(0, Math.max(1, midpoint));
  const olderHalf = allRecords.slice(midpoint);

  const avgQualityRecent = recentHalf.length > 0
    ? recentHalf.reduce((s, r) => s + r.qualityScore, 0) / recentHalf.length
    : 0;
  const avgQualityOlder = olderHalf.length > 0
    ? olderHalf.reduce((s, r) => s + r.qualityScore, 0) / olderHalf.length
    : 0;
  const qualityDelta = avgQualityRecent - avgQualityOlder;

  let performanceTrend: SystemInsights["performanceTrend"] = "stable";
  if (qualityDelta > 0.05) performanceTrend = "improving";
  else if (qualityDelta < -0.05) performanceTrend = "declining";

  // Feedback engagement rate
  const totalWithFeedback = stats.feedbackBreakdown.positive + stats.feedbackBreakdown.negative + stats.feedbackBreakdown.neutral;
  const feedbackRate = stats.totalGenerations > 0
    ? totalWithFeedback / stats.totalGenerations
    : 0;
  const positiveRatio = totalWithFeedback > 0
    ? stats.feedbackBreakdown.positive / totalWithFeedback
    : 0;

  // Theme performance analysis
  const topPerformingThemes = stats.topThemes
    .filter(t => t.count >= 2 && t.avgQuality > stats.avgQualityScore)
    .slice(0, 5);

  const underperformingThemes = stats.topThemes
    .filter(t => t.count >= 2 && t.avgQuality < stats.avgQualityScore * 0.8)
    .sort((a, b) => a.avgQuality - b.avgQuality)
    .slice(0, 5);

  const topPerformingLayouts = stats.topLayouts
    .filter(l => l.count >= 2 && l.avgQuality > stats.avgQualityScore)
    .slice(0, 5);

  // Per-format quality analysis
  const formatStrengths = computeFormatStrengths(allRecords);

  // Adaptive recommendations
  const recommendedActions = buildRecommendations(
    stats, performanceTrend, feedbackRate, positiveRatio, learningBias,
  );

  return {
    performanceTrend,
    avgQualityRecent,
    avgQualityOlder,
    qualityDelta,
    feedbackRate,
    positiveRatio,
    topPerformingThemes,
    underperformingThemes,
    topPerformingLayouts,
    formatStrengths,
    learningBias,
    recommendedActions,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// § ADAPTIVE STRATEGY — recommendations that bias future generation
// ═══════════════════════════════════════════════════════════════════════════

export interface AdaptiveStrategy {
  themeBlacklist: string[];
  themeWhitelist: string[];
  layoutPreferences: string[];
  qualityFloor: number;
  explorationBudget: number;
  variationCount: number;
}

export function computeAdaptiveStrategy(
  formatFilter?: string,
): AdaptiveStrategy {
  const insights = computeSystemInsights(formatFilter);

  // Blacklist consistently underperforming themes
  const themeBlacklist = insights.underperformingThemes
    .filter(t => t.avgQuality < 0.3)
    .map(t => t.themeId);

  // Whitelist consistently high-performing themes
  const themeWhitelist = insights.topPerformingThemes
    .filter(t => t.avgQuality > 0.6)
    .map(t => t.themeId);

  // Preferred layouts from top performers
  const layoutPreferences = insights.topPerformingLayouts
    .map(l => l.layoutFamily);

  // Dynamic quality floor — raise it as the system improves
  let qualityFloor = 0.32;
  if (insights.performanceTrend === "improving" && insights.avgQualityRecent > 0.5) {
    qualityFloor = Math.min(0.45, insights.avgQualityRecent * 0.7);
  }

  // Exploration budget — reduce when feedback is strong, increase when stale
  let explorationBudget = 0.3;
  if (insights.feedbackRate > 0.5 && insights.positiveRatio > 0.6) {
    explorationBudget = 0.15;
  } else if (insights.feedbackRate < 0.1) {
    explorationBudget = 0.4;
  }

  // Variation count — generate more candidates when quality is volatile
  let variationCount = 4;
  if (insights.performanceTrend === "declining") variationCount = 6;
  else if (insights.performanceTrend === "improving" && insights.avgQualityRecent > 0.6) variationCount = 3;

  return {
    themeBlacklist,
    themeWhitelist,
    layoutPreferences,
    qualityFloor,
    explorationBudget,
    variationCount,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// § QUALITY TREND TRACKING — lightweight time-series
// ═══════════════════════════════════════════════════════════════════════════

export interface QualityWindow {
  windowSize: number;
  entries: Array<{ timestamp: number; quality: number; format: string }>;
  movingAverage: number;
  volatility: number;
}

const _qualityWindows = new Map<string, QualityWindow>();
const WINDOW_SIZE = 50;

export function recordQualitySignal(
  format: string,
  quality: number,
): QualityWindow {
  const key = format || "_global";
  let window = _qualityWindows.get(key);

  if (!window) {
    window = { windowSize: WINDOW_SIZE, entries: [], movingAverage: 0, volatility: 0 };
    _qualityWindows.set(key, window);
  }

  window.entries.unshift({ timestamp: Date.now(), quality, format });
  if (window.entries.length > WINDOW_SIZE) {
    window.entries.length = WINDOW_SIZE;
  }

  // Recompute moving average and volatility
  const qualities = window.entries.map(e => e.quality);
  window.movingAverage = qualities.reduce((s, q) => s + q, 0) / qualities.length;

  if (qualities.length >= 2) {
    const variance = qualities.reduce((s, q) => s + (q - window!.movingAverage) ** 2, 0) / qualities.length;
    window.volatility = Math.sqrt(variance);
  }

  return window;
}

export function getQualityWindow(format?: string): QualityWindow | undefined {
  return _qualityWindows.get(format || "_global");
}

// ═══════════════════════════════════════════════════════════════════════════
// § IMPROVEMENT RATE — measures how much the system has learned
// ═══════════════════════════════════════════════════════════════════════════

export interface ImprovementReport {
  totalGenerations: number;
  totalFeedbackSignals: number;
  qualityBaseline: number;
  qualityCurrent: number;
  improvementPercent: number;
  hierarchyValidRate: number;
  violationTrend: "decreasing" | "stable" | "increasing";
  strongestFormat: string | null;
  weakestFormat: string | null;
}

export function computeImprovementReport(): ImprovementReport {
  const stats = getLedgerStats();
  const allRecords = getRecentGenerations({}, 200);

  if (allRecords.length < 4) {
    return {
      totalGenerations: allRecords.length,
      totalFeedbackSignals: 0,
      qualityBaseline: 0,
      qualityCurrent: 0,
      improvementPercent: 0,
      hierarchyValidRate: 0,
      violationTrend: "stable",
      strongestFormat: null,
      weakestFormat: null,
    };
  }

  // Baseline = oldest quarter, Current = newest quarter
  const quarter = Math.floor(allRecords.length / 4);
  const oldestQuarter = allRecords.slice(-quarter);
  const newestQuarter = allRecords.slice(0, quarter);

  const qualityBaseline = oldestQuarter.reduce((s, r) => s + r.qualityScore, 0) / oldestQuarter.length;
  const qualityCurrent = newestQuarter.reduce((s, r) => s + r.qualityScore, 0) / newestQuarter.length;
  const improvementPercent = qualityBaseline > 0
    ? ((qualityCurrent - qualityBaseline) / qualityBaseline) * 100
    : 0;

  // Violation trend
  const oldViolations = oldestQuarter.reduce((s, r) => s + r.violationCount, 0) / oldestQuarter.length;
  const newViolations = newestQuarter.reduce((s, r) => s + r.violationCount, 0) / newestQuarter.length;
  let violationTrend: ImprovementReport["violationTrend"] = "stable";
  if (newViolations < oldViolations - 0.5) violationTrend = "decreasing";
  else if (newViolations > oldViolations + 0.5) violationTrend = "increasing";

  // Feedback signal count
  const totalFeedbackSignals = allRecords.filter(r => r.feedback != null).length;

  // Per-format performance
  const formatStrengths = computeFormatStrengths(allRecords);
  const strongestFormat = formatStrengths.length > 0 ? formatStrengths[0].format : null;
  const weakestFormat = formatStrengths.length > 1
    ? formatStrengths[formatStrengths.length - 1].format
    : null;

  return {
    totalGenerations: stats.totalGenerations,
    totalFeedbackSignals,
    qualityBaseline,
    qualityCurrent,
    improvementPercent,
    hierarchyValidRate: stats.hierarchyValidRate,
    violationTrend,
    strongestFormat,
    weakestFormat,
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────

function computeFormatStrengths(records: GenerationRecord[]): Array<{ format: string; avgQuality: number; count: number }> {
  const formatMap = new Map<string, { total: number; count: number }>();

  for (const r of records) {
    const entry = formatMap.get(r.format) ?? { total: 0, count: 0 };
    entry.total += r.qualityScore;
    entry.count++;
    formatMap.set(r.format, entry);
  }

  return [...formatMap.entries()]
    .filter(([, d]) => d.count >= 2)
    .map(([format, d]) => ({ format, avgQuality: d.total / d.count, count: d.count }))
    .sort((a, b) => b.avgQuality - a.avgQuality);
}

function buildRecommendations(
  stats: LedgerStats,
  trend: SystemInsights["performanceTrend"],
  feedbackRate: number,
  positiveRatio: number,
  bias: LearningBias,
): string[] {
  const actions: string[] = [];

  if (stats.totalGenerations < 10) {
    actions.push("System is in early learning phase — quality will improve with more generations");
    return actions;
  }

  if (trend === "declining") {
    actions.push("Quality trending down — consider increasing variation candidates");
  }

  if (feedbackRate < 0.15) {
    actions.push("Low feedback rate — user engagement would accelerate learning");
  }

  if (positiveRatio < 0.4 && feedbackRate > 0.2) {
    actions.push("Low approval rate — system should increase exploration of new styles");
  }

  if (positiveRatio > 0.7 && feedbackRate > 0.3) {
    actions.push("High approval rate — system can safely reduce exploration budget");
  }

  if (stats.hierarchyValidRate < 0.8) {
    actions.push("Typography hierarchy issues detected — bias toward proven layouts");
  }

  if (stats.avgViolationCount > 2) {
    actions.push("High violation rate — prioritize quality gate strictness");
  }

  if (bias.confidence > 0.6) {
    const strongBoosts = Object.values(bias.themeBoosts).filter(b => b > 0.1);
    if (strongBoosts.length > 0) {
      actions.push("Strong theme preferences learned — personalization active");
    }
  }

  if (actions.length === 0) {
    actions.push("System is performing well — maintaining current strategy");
  }

  return actions;
}
