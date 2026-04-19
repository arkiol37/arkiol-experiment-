// Asset library — public surface.
//
// Consumers should import from "@/lib/asset-library" only. Internal modules
// (data.ts) are intentionally not re-exported to keep the API tight.

export type {
  Asset,
  AssetCategory,
  AssetKind,
  AssetStyle,
  AssetPayload,
  AssetQuery,
} from "./types";

export {
  ASSET_CATEGORIES,
  ASSET_KINDS,
  getAssetById,
  getAssetsByCategory,
  getAssetsByKind,
  getAllAssets,
  queryAssets,
  pickAsset,
  assetToImageSrc,
  libraryStats,
} from "./registry";

export type {
  CategoryRecipe,
  RecipeEntry,
  SelectOptions,
} from "./category-recipes";

export {
  CATEGORY_RECIPES,
  selectAssetsForCategory,
  inferCategoryFromText,
} from "./category-recipes";

export type {
  CategoryProfile,
} from "./category-profile";

export {
  CATEGORY_PROFILES,
  scoreAssetForCategory,
  rankAssetsForCategory,
  filterAssetsForCategory,
} from "./category-profile";
