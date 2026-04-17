// src/engines/memory/index.ts
//
// Memory module — output history, generation ledger, and learning signals.

export {
  themeFingerprint,
  recordOutputFingerprint,
  isRecentDuplicate,
} from "./output-history";

export {
  recordGeneration,
  recordFeedback,
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
