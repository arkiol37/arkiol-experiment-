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
