// src/engines/style/index.ts
//
// Style module — visual style intelligence and category-specific style packs.

export {
  analyzeStyleIntent,
  deriveStyleDirective,
  applyStyleDirective,
  type StyleIntent,
  type StyleDirective,
  type PaletteDirective,
  type TypographyDirective,
  type SpacingDirective,
  type MoodDirective,
} from "./style-intelligence";

export {
  detectCategoryPack,
  paletteMoodToColorMoods,
  type CategoryStylePack,
} from "./category-style-packs";

export {
  getTypographyPersonality,
  listTypographyPersonalities,
  type TypographyPersonality,
  type RolePersonality,
} from "./category-typography-personality";

export {
  selectFontPair,
  scoreFontPair,
  getFontMetadata,
  type FontMetadata,
  type FontClassification,
  type FontPersonality,
  type FontRole,
  type FontPairOptions,
  type FontPairResult,
  type PairScore,
} from "./font-pairing";

export {
  getCategoryKit,
  getAllCategoryKits,
  mergeKitDecorations,
  type CategoryTemplateKit,
} from "./category-template-kits";

export {
  getCategoryLayoutProfile,
  selectCategoryVariationIndex,
  applyCategoryZoneOverrides,
  applyCategoryAlignment,
  applyHeadlineProportion,
  type CategoryLayoutProfile,
  type CompositionApproach,
  type RhythmProfile,
  type AlignmentRhythm,
  type FormatZoneOverrides,
} from "./category-layout-profiles";

// Step 39: pack coherence — shared palette / typography / spacing /
// corner radius across a batch of candidate templates so the gallery
// reads as one curated pack.
export {
  PACK_COHERENCE_FLOOR,
  extractPackAnchor,
  extractPackAnchorFrom,
  lockThemeToAnchor,
  scorePackCoherence,
  filterCoherentPack,
  type PackAnchor,
  type PackCoherenceReport,
  type CoherenceFilterResult,
} from "./pack-coherence";

// Step 63: pack consistency — decoration-style fingerprint, tone
// consensus, layout-variation floor, and an aggregate curated / loose /
// fragmented verdict on top of pack-coherence.
export {
  PACK_COHESION_CURATED,
  PACK_COHESION_FRAGMENTED,
  PACK_DECORATION_MIN_CORE_OVERLAP,
  PACK_LAYOUT_MIN_VARIATION,
  PACK_TONE_CONSENSUS_FLOOR,
  PACK_MEMBER_OUTLIER_FLOOR,
  extractDecorationFingerprint,
  buildPackCohesionProfile,
  scorePackCohesion,
  filterFragmentedMembers,
  annotatePackCohesion,
  enforcePackConsistency,
  type DecorationFingerprint,
  type PackCohesionProfile,
  type PackCohesionReport,
  type PackCohesionSubscores,
  type PackCohesionVerdict,
  type PackMemberReport,
  type PackMemberFilterResult,
  type PackCohesionSignal,
  type EnforcePackConsistencyInput,
  type EnforcePackConsistencyResult,
} from "./pack-consistency";
