// src/engines/render/index.ts
//
// Render module — SVG/PNG/GIF rendering pipeline and content generation.

export {
  renderAsset,
  SpendGuardError,
  type PipelineInput,
  type PipelineResult,
  type InjectedAssetMap,
} from "./pipeline";

export {
  buildUltimateSvgContent,
  renderUltimateSvg,
  getSvgContentCacheStats,
  type SvgContent,
  type BuildResult,
} from "./svg-builder-ultimate";

export {
  runSafeStage,
  healZoneGeometry,
  healContent,
  buildSafetyNetSvg,
  buildDegradedResult,
  retryWithBackoff,
  runResilientRender,
  recoverMissingAssets,
  type RecoveryAction,
  type RetryOptions,
  type ResilientRenderOptions,
  type AssetCarrier,
} from "./self-healing";

// Step 39: micro-polish — final pass that snaps font sizes, normalizes
// colors, and rounds CTA padding/radius to the 8 px grid.
export {
  runMicroPolish,
  MICRO_POLISH_MODULAR_SCALE,
  MICRO_POLISH_LINE_HEIGHT_BAND,
  MICRO_POLISH_DEFAULT_SPACING_UNIT,
  type PolishAction,
  type MicroPolishResult,
  type MicroPolishOptions,
} from "./micro-polish";

// Step 60: typography hierarchy — final-output validator that enforces
// headline dominance, CTA prominence, flat-hierarchy rejection, per-zone
// weight bands, subhead bridging, and font-pair harmony.
export {
  ZONE_TYPOGRAPHY_DEFAULTS,
  HEADLINE_DOMINANCE_RATIO,
  FLAT_HIERARCHY_MIN_COUNT,
  SUBHEAD_MAX_FRACTION_OF_HEADLINE,
  SUBHEAD_MIN_MULTIPLIER_OF_BODY,
  PAIR_SCORE_HARMONY_FLOOR,
  SINGLE_FONT_ZONE_THRESHOLD,
  validateTypographyHierarchy,
  buildTypographyProfile,
  sizeBandOrdinal,
  type TextZoneStyle,
  type TypographyProfile,
  type TypographyViolation,
  type ZoneTypographyProfile,
  type SizeBand,
} from "./typography-hierarchy";

export {
  createPipelineContext,
  type PipelineContext,
  type PipelineStage,
  type EnrichedBrief,
  type GuardCheckResult,
  type LayoutStageResult,
  type DensityStageResult,
  type CompositionStageResult,
  type AssetStageResult,
  type ResolvedAsset,
  type RenderStageResult,
  type QualityGateResult,
  type HierarchyStageResult,
  type StyleStageResult,
  type OutputStageResult,
} from "./pipeline-types";
