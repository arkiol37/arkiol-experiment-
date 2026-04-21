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

// Step 61: color harmony — palette-level validator that catches
// disharmony, saturation clashes, harsh gradients, text hues orphaned
// from the palette, category drift, and indistinct accents.
export {
  CATEGORY_PALETTE_TARGETS,
  MAX_SATURATION_SPREAD,
  HARSH_GRADIENT_HUE_DISTANCE,
  HARSH_GRADIENT_LIGHTNESS_DELTA,
  TEXT_PALETTE_MAX_HUE_DISTANCE,
  ACCENT_MIN_HUE_DISTANCE,
  ACCENT_MIN_SATURATION_DELTA,
  ACCENT_MIN_LIGHTNESS_DELTA,
  NEUTRAL_SATURATION_THRESHOLD,
  hexToHsl,
  hueDistance,
  hueFamily,
  warmthOf,
  detectHarmonic,
  validateColorHarmony,
  type Hsl,
  type HueFamily,
  type Warmth,
  type HarmonicRelation,
  type PaletteInput,
  type ColorHarmonyViolation,
  type CategoryPaletteTarget,
} from "./color-harmony";

// Step 62: final refinement pass — late auto-fixes (3-digit hex
// expansion, opacity tidy, empty-text pruning, weight snap) plus an
// aggregate polish verdict that rejects unfinished outputs.
export {
  runFinishPass,
  summarizeViolations,
  expandShortHex,
  nearestStandardWeight,
  FINISH_SCORE_FINISHED,
  FINISH_SCORE_ROUGH,
  FINISH_ERROR_WEIGHT,
  FINISH_WARNING_WEIGHT,
  FINISH_ROUGH_MAX_ERRORS,
  FINISH_OPACITY_MIN,
  FINISH_OPACITY_MAX,
  type FinishAction,
  type FinishVerdict,
  type FinishVerdictSummary,
  type FinishPassInput,
  type FinishPassResult,
} from "./final-polish";

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
