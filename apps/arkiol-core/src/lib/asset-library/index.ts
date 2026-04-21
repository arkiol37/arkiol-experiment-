// Asset library — public surface.
//
// Consumers should import from "@/lib/asset-library" only. Internal modules
// (data.ts) are intentionally not re-exported to keep the API tight.

export type {
  Asset,
  AssetCategory,
  AssetKind,
  AssetStyle,
  AssetRealm,
  AssetVisualStyle,
  AssetQualityTier,
  AssetPayload,
  AssetQuery,
} from "./types";

export {
  ASSET_CATEGORIES,
  ASSET_KINDS,
  ASSET_REALMS,
  getAssetById,
  getAssetsByCategory,
  getAssetsByKind,
  getAssetsByRealm,
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
  resolveVisualStyleForCategory,
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

// Step 57: category → realm affinity
export type {
  CategoryRealmAffinity,
} from "./category-realm-affinity";

export {
  CATEGORY_REALM_AFFINITY,
  scoreRealmForCategory,
  realmsForCategory,
  compareAssetsByRealmAffinity,
  asset3dSlugsForCategory,
} from "./category-realm-affinity";
