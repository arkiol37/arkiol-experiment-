// src/engines/memory/visual-patterns.ts
//
// Visual-pattern memory (Step 33).
//
// The generation ledger already records coarse signals per render
// (themeId, layoutFamily, quality). This module sits on top and captures
// *which concrete visual patterns* are working: which decoration kinds
// show up in high-scoring outputs, what background treatments users pick
// from the gallery, which palette seeds recur in selections. The bias it
// produces nudges future selection toward proven combinations without
// eliminating exploration.
//
// Three input signals drive the memory:
//
//   1. recordSuccessfulPattern(signature, score, context)
//        Called automatically after each generation when the quality
//        score crosses a floor. No user action required.
//
//   2. recordSelection (see generation-ledger.ts)
//        Strongest positive signal: the user actually picked this
//        design from the gallery. Carries ~3× the weight of a
//        high-score auto-record.
//
//   3. Feedback (positive / negative) on the ledger record.
//        Weakest signal but still folded in.
//
// The module is intentionally in-memory and resettable (same lifecycle
// as the generation ledger). Nothing here blocks future persistence —
// the types are plain JSON-serializable.

import type { LedgerFilter } from "./generation-ledger";
import { getRecentGenerations, type GenerationRecord } from "./generation-ledger";

// ── Pattern signature ────────────────────────────────────────────────────────
// Compact fingerprint of a generated design. Every field is optional so
// callers can supply whatever's available — pattern mining degrades
// gracefully when data is partial. Stored in the ledger via the new
// `patternSignature` field on GenerationRecord.

export interface VisualPatternSignature {
  // Which content bucket the brief landed in (Step 14 category profile).
  categoryPackId?:        string;
  // Named layout family (e.g. "hero_centered", "split_vertical").
  layoutFamily?:          string;
  // Named theme id from design-themes.ts.
  themeId?:               string;
  // Coarse background treatment — one of the 6 kinds from Step 18.
  backgroundTreatment?:   string;
  // Primary and accent palette colors (normalized lowercase hex).
  palette?: {
    primary?:   string;
    accent?:    string;
    background?:string;
  };
  // Sorted decoration-kind list so equal sets produce equal fingerprints.
  decorationKinds?:       string[];
  // Depth-tier distribution (Step 19) — tier → count.
  depthTierMix?:          Record<string, number>;
  // Asset usage band: "low" | "mid" | "high". Derived from assetUsage
  // score so we can bias future picks toward successful density levels.
  assetUsageBand?:        "low" | "mid" | "high";
}

// ── Pattern memory store ─────────────────────────────────────────────────────
// Ring buffer of observed-successful patterns, each tagged with the
// signal that caused it to land here. Reset lifecycle matches the
// generation ledger (process memory; cleared on restart).

interface StoredPattern {
  signature: VisualPatternSignature;
  signal:    number;               // weighted score (higher = more trustworthy)
  source:    "quality" | "selection" | "positive_feedback";
  timestamp: number;
}

const MAX_PATTERNS = 200;
const _patterns: StoredPattern[] = [];

// Auto-record floor — only signatures from generations above this
// quality score are stored. Keeps the memory focused on genuinely good
// examples rather than every attempt.
const QUALITY_AUTO_RECORD_FLOOR = 0.60;

// Per-signal weights. Selection (user actually picked it) dominates; a
// high auto-score is a mid-strength signal; positive feedback is a soft
// nudge because it applies after the fact and not every user leaves it.
const SIGNAL_WEIGHTS = {
  quality:           1.0,
  selection:         3.0,
  positive_feedback: 1.5,
} as const;

// ── Recording ────────────────────────────────────────────────────────────────

/**
 * Record a successful pattern. Safe to call on every generation — the
 * quality floor filters out mediocre outputs. Selection and feedback
 * signals should also call this (with source="selection" /
 * "positive_feedback") so a single pattern can gain strength from
 * multiple independent signals.
 */
export function recordSuccessfulPattern(
  signature: VisualPatternSignature,
  qualityScore: number,
  source: StoredPattern["source"] = "quality",
): boolean {
  // Quality-sourced records respect the floor. Selection / feedback-
  // sourced records always go in — the user's vote is the signal.
  if (source === "quality" && qualityScore < QUALITY_AUTO_RECORD_FLOOR) {
    return false;
  }

  const signal = qualityScore * SIGNAL_WEIGHTS[source];
  _patterns.unshift({ signature, signal, source, timestamp: Date.now() });
  if (_patterns.length > MAX_PATTERNS) _patterns.length = MAX_PATTERNS;
  return true;
}

export function getPatternMemorySize(): number {
  return _patterns.length;
}

export function clearPatternMemory(): void {
  _patterns.length = 0;
}

// ── Category preferences ─────────────────────────────────────────────────────
// "Users who liked productivity designs tended to go with framed
// info-cards, dot-grid textures, and structured bands." Derived on
// demand from the pattern store. Aggregates over the N most recent
// patterns that match the category.

export interface CategoryPreferences {
  categoryPackId:  string;
  sampleSize:      number;
  topThemes:       Array<{ themeId: string; signal: number; count: number }>;
  topLayouts:      Array<{ layoutFamily: string; signal: number; count: number }>;
  topDecorationKinds: Array<{ kind: string; signal: number; count: number }>;
  topBackgrounds:  Array<{ backgroundTreatment: string; signal: number; count: number }>;
  preferredAssetUsage?: "low" | "mid" | "high";
}

export function getCategoryPreferences(
  categoryPackId: string,
): CategoryPreferences | null {
  const matches = _patterns.filter(p => p.signature.categoryPackId === categoryPackId);
  if (matches.length === 0) return null;

  const tally = <K extends keyof VisualPatternSignature>(
    key: K,
  ) => {
    const m = new Map<string, { signal: number; count: number }>();
    for (const p of matches) {
      const v = p.signature[key];
      if (typeof v !== "string") continue;
      const e = m.get(v) ?? { signal: 0, count: 0 };
      e.signal += p.signal;
      e.count  += 1;
      m.set(v, e);
    }
    return [...m.entries()]
      .map(([name, d]) => ({ name, signal: d.signal, count: d.count }))
      .sort((a, b) => b.signal - a.signal);
  };

  // Decoration kinds are an array → accumulate across all signatures.
  const decoMap = new Map<string, { signal: number; count: number }>();
  for (const p of matches) {
    const kinds = p.signature.decorationKinds ?? [];
    for (const kind of kinds) {
      const e = decoMap.get(kind) ?? { signal: 0, count: 0 };
      e.signal += p.signal;
      e.count  += 1;
      decoMap.set(kind, e);
    }
  }
  const topDecorationKinds = [...decoMap.entries()]
    .map(([kind, d]) => ({ kind, signal: d.signal, count: d.count }))
    .sort((a, b) => b.signal - a.signal)
    .slice(0, 10);

  // Asset-usage band — pick the most-weighted band as the preference.
  const bandTotals: Record<"low" | "mid" | "high", number> = { low: 0, mid: 0, high: 0 };
  for (const p of matches) {
    const b = p.signature.assetUsageBand;
    if (b) bandTotals[b] += p.signal;
  }
  const rankedBands = (
    Object.entries(bandTotals) as Array<["low" | "mid" | "high", number]>
  ).sort((a, b) => b[1] - a[1]);
  const preferredAssetUsage = rankedBands[0]?.[1] > 0 ? rankedBands[0][0] : undefined;

  const topThemes     = tally("themeId").slice(0, 5)
    .map(t => ({ themeId: t.name, signal: t.signal, count: t.count }));
  const topLayouts    = tally("layoutFamily").slice(0, 5)
    .map(t => ({ layoutFamily: t.name, signal: t.signal, count: t.count }));
  const topBackgrounds = tally("backgroundTreatment").slice(0, 5)
    .map(t => ({ backgroundTreatment: t.name, signal: t.signal, count: t.count }));

  return {
    categoryPackId,
    sampleSize: matches.length,
    topThemes,
    topLayouts,
    topDecorationKinds,
    topBackgrounds,
    preferredAssetUsage,
  };
}

// ── Bias computation ─────────────────────────────────────────────────────────
// Turns the pattern memory into per-key numeric boosts usable by scorers
// and selectors. Boosts are small (±0.10 max) so learning is a nudge, not
// an override — exploration stays open.

const MAX_PATTERN_BOOST = 0.10;
const MIN_PATTERNS_FOR_BIAS = 3;   // need a minimum sample to avoid noise

export interface PatternBias {
  categoryPackId?:     string;
  themeBoosts:         Record<string, number>;
  layoutBoosts:        Record<string, number>;
  decorationKindBias:  Record<string, number>;
  backgroundBoosts:    Record<string, number>;
  confidence:          number;      // 0..1 — scales how strongly caller applies the bias
}

export function computePatternBias(ctx: { categoryPackId?: string } = {}): PatternBias {
  const prefs = ctx.categoryPackId
    ? getCategoryPreferences(ctx.categoryPackId)
    : null;

  if (!prefs || prefs.sampleSize < MIN_PATTERNS_FOR_BIAS) {
    return {
      categoryPackId:    ctx.categoryPackId,
      themeBoosts:       {},
      layoutBoosts:      {},
      decorationKindBias:{},
      backgroundBoosts:  {},
      confidence:        0,
    };
  }

  // Normalize each top list so the #1 entry gets MAX_PATTERN_BOOST and
  // later entries taper linearly. Entries beyond top N get 0.
  const normalize = (
    items: Array<{ signal: number }>,
    keyFn: (i: any) => string,
  ): Record<string, number> => {
    const maxSig = items[0]?.signal ?? 0;
    if (maxSig <= 0) return {};
    const out: Record<string, number> = {};
    for (const it of items) {
      const key   = keyFn(it);
      const ratio = it.signal / maxSig;
      out[key]    = ratio * MAX_PATTERN_BOOST;
    }
    return out;
  };

  const confidence = Math.min(1, prefs.sampleSize / 20);

  return {
    categoryPackId:    ctx.categoryPackId,
    themeBoosts:       normalize(prefs.topThemes,       (t: any) => t.themeId),
    layoutBoosts:      normalize(prefs.topLayouts,      (t: any) => t.layoutFamily),
    decorationKindBias:normalize(prefs.topDecorationKinds, (t: any) => t.kind),
    backgroundBoosts:  normalize(prefs.topBackgrounds,  (t: any) => t.backgroundTreatment),
    confidence,
  };
}

// ── Convenience helpers ──────────────────────────────────────────────────────

export function applyThemeBoostFromPatterns(
  themeId:   string,
  baseScore: number,
  bias:      PatternBias,
): number {
  const boost = (bias.themeBoosts[themeId] ?? 0) * bias.confidence;
  return Math.max(0, Math.min(1, baseScore + boost));
}

export function applyLayoutBoostFromPatterns(
  layoutFamily: string,
  baseScore:    number,
  bias:         PatternBias,
): number {
  const boost = (bias.layoutBoosts[layoutFamily] ?? 0) * bias.confidence;
  return Math.max(0, Math.min(1, baseScore + boost));
}

// ── Rebuild from ledger (optional) ───────────────────────────────────────────
// When the ledger has data but the pattern store is cold (e.g. after a
// server restart before persistence lands), rebuild() walks the ledger
// and re-ingests signatures from records that stored them.

export function rebuildPatternMemoryFromLedger(filter: LedgerFilter = {}): number {
  clearPatternMemory();
  const records: GenerationRecord[] = getRecentGenerations(filter, 500);
  let ingested = 0;
  for (const r of records) {
    const sig = r.patternSignature as VisualPatternSignature | undefined;
    if (!sig) continue;

    // Quality-sourced record for every stored signature.
    if (recordSuccessfulPattern(sig, r.qualityScore, "quality")) ingested++;

    // Selection signal trumps quality — apply extra weight.
    if (r.selected) {
      recordSuccessfulPattern(sig, Math.max(r.qualityScore, 0.5), "selection");
      ingested++;
    }

    // Positive feedback folds in as a mid-weight signal.
    if (r.feedback === "positive") {
      recordSuccessfulPattern(sig, Math.max(r.qualityScore, 0.5), "positive_feedback");
      ingested++;
    }
  }
  return ingested;
}
