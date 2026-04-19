// src/engines/memory/index.ts
//
// Memory module — output history, generation ledger, learning signals,
// and visual-pattern memory. Stores lightweight signals from past
// generations so future selection and scoring can nudge toward proven
// combinations without becoming deterministic.

export {
  themeFingerprint,
  recordOutputFingerprint,
  isRecentDuplicate,
} from "./output-history";

export {
  recordGeneration,
  recordFeedback,
  recordSelection,
  isSelected,
  getRecentGenerations,
  getLedgerSize,
  getLedgerStats,
  type GenerationRecord,
  type LedgerFilter,
  type LedgerStats,
} from "./generation-ledger";

export {
  computeLearningBias,
  applyThemeBias,
  applyLayoutBias,
  extractEvaluationSignals,
  type LearningBias,
  type EvaluationSignals,
} from "./learning-signals";

// Step 33: visual-pattern memory — richer per-category signals derived
// from successful generations. Feeds into selection scoring as a small
// confidence-weighted boost so future picks lean toward patterns that
// have historically worked.
export {
  recordSuccessfulPattern,
  getCategoryPreferences,
  computePatternBias,
  applyThemeBoostFromPatterns,
  applyLayoutBoostFromPatterns,
  rebuildPatternMemoryFromLedger,
  clearPatternMemory,
  getPatternMemorySize,
  type VisualPatternSignature,
  type CategoryPreferences,
  type PatternBias,
} from "./visual-patterns";
