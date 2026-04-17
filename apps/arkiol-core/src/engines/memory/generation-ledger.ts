// src/engines/memory/generation-ledger.ts
//
// In-memory ledger of recent generation outcomes.
// Stores quality signals, theme/layout choices, and optional user feedback
// so the system can learn from past outputs and gradually improve.
// Circular buffer — retains the most recent MAX_RECORDS entries.

const MAX_RECORDS = 200;

// ── Generation record ───────────────────────────────────────────────────────

export interface GenerationRecord {
  assetId: string;
  timestamp: number;
  format: string;
  campaignId: string;
  themeId: string;
  layoutFamily: string;
  layoutVariation: string;
  qualityScore: number;
  designQualityScore: number;
  brandScore: number;
  hierarchyValid: boolean;
  violationCount: number;
  recoveryCount: number;
  feedback?: "positive" | "negative" | "neutral";
}

// ── Ledger storage ──────────────────────────────────────────────────────────

const _ledger: GenerationRecord[] = [];

export function recordGeneration(record: GenerationRecord): void {
  _ledger.unshift(record);
  if (_ledger.length > MAX_RECORDS) {
    _ledger.length = MAX_RECORDS;
  }
}

export function recordFeedback(
  assetId: string,
  feedback: "positive" | "negative" | "neutral",
): boolean {
  const entry = _ledger.find(r => r.assetId === assetId);
  if (!entry) return false;
  entry.feedback = feedback;
  return true;
}

// ── Query ───────────────────────────────────────────────────────────────────

export interface LedgerFilter {
  format?: string;
  campaignId?: string;
  themeId?: string;
  layoutFamily?: string;
  feedbackOnly?: boolean;
  minQuality?: number;
}

export function getRecentGenerations(
  filter: LedgerFilter = {},
  limit = 50,
): GenerationRecord[] {
  let results = _ledger;

  if (filter.format) {
    results = results.filter(r => r.format === filter.format);
  }
  if (filter.campaignId) {
    results = results.filter(r => r.campaignId === filter.campaignId);
  }
  if (filter.themeId) {
    results = results.filter(r => r.themeId === filter.themeId);
  }
  if (filter.layoutFamily) {
    results = results.filter(r => r.layoutFamily === filter.layoutFamily);
  }
  if (filter.feedbackOnly) {
    results = results.filter(r => r.feedback != null);
  }
  if (filter.minQuality != null) {
    results = results.filter(r => r.qualityScore >= filter.minQuality!);
  }

  return results.slice(0, limit);
}

export function getLedgerSize(): number {
  return _ledger.length;
}

// ── Aggregate statistics ────────────────────────────────────────────────────

export interface LedgerStats {
  totalGenerations: number;
  avgQualityScore: number;
  avgDesignQualityScore: number;
  avgBrandScore: number;
  hierarchyValidRate: number;
  avgViolationCount: number;
  feedbackBreakdown: { positive: number; negative: number; neutral: number; none: number };
  topThemes: Array<{ themeId: string; count: number; avgQuality: number }>;
  topLayouts: Array<{ layoutFamily: string; count: number; avgQuality: number }>;
}

export function getLedgerStats(filter: LedgerFilter = {}): LedgerStats {
  const records = getRecentGenerations(filter, MAX_RECORDS);
  const n = records.length;

  if (n === 0) {
    return {
      totalGenerations: 0,
      avgQualityScore: 0,
      avgDesignQualityScore: 0,
      avgBrandScore: 0,
      hierarchyValidRate: 0,
      avgViolationCount: 0,
      feedbackBreakdown: { positive: 0, negative: 0, neutral: 0, none: 0 },
      topThemes: [],
      topLayouts: [],
    };
  }

  const sumQuality = records.reduce((s, r) => s + r.qualityScore, 0);
  const sumDesign = records.reduce((s, r) => s + r.designQualityScore, 0);
  const sumBrand = records.reduce((s, r) => s + r.brandScore, 0);
  const validCount = records.filter(r => r.hierarchyValid).length;
  const sumViolations = records.reduce((s, r) => s + r.violationCount, 0);

  const fb = { positive: 0, negative: 0, neutral: 0, none: 0 };
  for (const r of records) {
    if (r.feedback === "positive") fb.positive++;
    else if (r.feedback === "negative") fb.negative++;
    else if (r.feedback === "neutral") fb.neutral++;
    else fb.none++;
  }

  const themeMap = new Map<string, { count: number; totalQ: number }>();
  const layoutMap = new Map<string, { count: number; totalQ: number }>();

  for (const r of records) {
    const tm = themeMap.get(r.themeId) ?? { count: 0, totalQ: 0 };
    tm.count++;
    tm.totalQ += r.qualityScore;
    themeMap.set(r.themeId, tm);

    const lm = layoutMap.get(r.layoutFamily) ?? { count: 0, totalQ: 0 };
    lm.count++;
    lm.totalQ += r.qualityScore;
    layoutMap.set(r.layoutFamily, lm);
  }

  const topThemes = [...themeMap.entries()]
    .map(([themeId, d]) => ({ themeId, count: d.count, avgQuality: d.totalQ / d.count }))
    .sort((a, b) => b.avgQuality - a.avgQuality)
    .slice(0, 10);

  const topLayouts = [...layoutMap.entries()]
    .map(([layoutFamily, d]) => ({ layoutFamily, count: d.count, avgQuality: d.totalQ / d.count }))
    .sort((a, b) => b.avgQuality - a.avgQuality)
    .slice(0, 10);

  return {
    totalGenerations: n,
    avgQualityScore: sumQuality / n,
    avgDesignQualityScore: sumDesign / n,
    avgBrandScore: sumBrand / n,
    hierarchyValidRate: validCount / n,
    avgViolationCount: sumViolations / n,
    feedbackBreakdown: fb,
    topThemes,
    topLayouts,
  };
}
