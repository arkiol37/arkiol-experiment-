// src/engines/evaluation/index.ts
//
// Evaluation module — quality scoring, refinement, and candidate ranking.

export {
  scoreThemeQuality,
  scoreCandidateQuality,
  isBlandCandidate,
  areTooSimilar,
  rankThemeCandidates,
  pickBestTheme,
  type CandidateQualityScore,
  type RankedThemeCandidate,
} from "./candidate-quality";

export {
  REJECTION_RULES,
  evaluateRejection,
  filterCandidateBatch,
  type RejectionRule,
  type RejectionSeverity,
  type RejectionVerdict,
  type BatchFilterItem,
  type BatchFilterOptions,
  type BatchFilterResult,
} from "./rejection-rules";

export {
  assessDesignQuality,
  refineDesign,
  runRefinementPasses,
  type DesignQualityReport,
  type QualityIssue,
  type RefinementResult,
  type RefinementPassOptions,
  type RefinementPassResult,
} from "./candidate-refinement";

export {
  themeFingerprint,
  recordOutputFingerprint,
  isRecentDuplicate,
} from "../memory/output-history";

export {
  polishOutput,
  type PolishResult,
  type PolishAction,
} from "./output-polish";

export {
  assessProductionReadiness,
  selectStrongestCandidate,
  type ProductionReadinessReport,
  type ReadinessVerdict,
  type CandidateComparison,
} from "./production-readiness";
