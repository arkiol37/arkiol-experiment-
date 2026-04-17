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
