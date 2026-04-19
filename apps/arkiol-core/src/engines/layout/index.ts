// src/engines/layout/index.ts
//
// Layout module — zone geometry, density analysis, adaptive layout, and style enforcement.

export {
  resolveLayoutSpec,
  getFormatCategory,
  validateZoneGeometry,
  describeSpec,
  type FormatCategory,
  type DensityProfile,
  type LayoutSpec,
  type AuthorityContext,
  type GeometryViolation,
} from "./authority";

export {
  adaptLayout,
  type LayoutIntent,
  type AdaptiveLayoutOptions,
  type AdaptiveLayoutResult,
} from "./adaptive-layout";

export {
  analyzeDensity,
  enforceDensityBudget,
  modularScale,
  type ZoneDensitySpec,
  type DensityAnalysis,
} from "./density";

export {
  enforceStyle,
  contrastRatio,
  meetsWcag,
  ensureContrast,
  scoreBrandTone,
  applyPresetToEnforcement,
  type BrandToneProfile,
  type ContentToneSignals,
  type TextContentForEnforcement,
  type StyleEnforcementResult,
} from "./style-enforcer";

export {
  selectLayout,
  resolveZones,
  LAYOUT_FAMILIES,
  FAMILIES_BY_FORMAT,
  type Zone,
  type ZoneId,
  type ZoneConstraints,
  type LayoutVariation,
  type LayoutFamily,
  type ArkiolLayoutCategory,
  type SelectionContext,
  type LayoutSelection,
} from "./families";

export {
  getArtboardGrid,
  computeGridGeometry,
  snapZoneToGrid,
  snapZonesToGrid,
  type ArtboardGrid,
  type GridGeometry,
  type GridSnapOptions,
} from "./artboard-grid";

export {
  applyContentResponse,
  classifyContentLength,
  buildResponseInput,
  type ContentLengthTier,
  type ContentResponseInput,
  type ContentResponseResult,
} from "./content-response";

export {
  evaluateConstraints,
  resolveOverlaps,
  LayoutConstraintError,
  type ConstraintCategory,
  type ConstraintViolation,
  type ConstraintReport,
  type EvaluateConstraintsResult,
} from "./layout-constraints";
