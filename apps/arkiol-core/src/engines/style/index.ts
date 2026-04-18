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
  getCategoryKit,
  getAllCategoryKits,
  mergeKitDecorations,
  type CategoryTemplateKit,
} from "./category-template-kits";
