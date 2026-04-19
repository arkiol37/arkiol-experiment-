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
