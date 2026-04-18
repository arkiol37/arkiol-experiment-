// src/engines/intelligence/index.ts
//
// Creative Intelligence — self-improving feedback loop and adaptive strategy.

export {
  processFeedback,
  processFeedbackBatch,
  computeSystemInsights,
  computeAdaptiveStrategy,
  recordQualitySignal,
  getQualityWindow,
  computeImprovementReport,
  type FeedbackAction,
  type CreativeFeedback,
  type FeedbackResult,
  type SystemInsights,
  type AdaptiveStrategy,
  type QualityWindow,
  type ImprovementReport,
} from "./creative-loop";

export {
  buildThemeFilter,
  isThemeAllowed,
  isThemePreferred,
  buildQualityGateConfig,
  buildExplorationConfig,
  buildIntelligenceContext,
  type ThemeFilter,
  type QualityGateConfig,
  type ExplorationConfig,
  type IntelligenceContext,
} from "./strategy-applier";
