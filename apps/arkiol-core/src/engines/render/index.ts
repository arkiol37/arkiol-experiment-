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
