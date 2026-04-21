// src/engines/assets/index.ts
//
// Assets module — composition planning + all the subsystems that decide
// what goes on the canvas and where:
//
//   asset-selector          Composition plan builder + prompt fragment.
//   contract                Per-type zone / coverage contracts.
//   asset-placement         Kind → role/scale/anchor/layer rules.
//   decorative-components   Composed decorative units (ribbons, badges, ...).
//   background-treatments   Layered surface recipes.
//   depth-layering          Depth tiers, shadows, separation vignette.
//   composition-balance     Text/visual balance metric + targeted rebalance.
//   asset-library           (Legacy parametric/retrieval engine.)
//
// This barrel is the one place downstream code should import from. The
// individual files stay internal — adding a new asset subsystem means
// wiring its public surface here, nothing else.

// ── Composition plan ─────────────────────────────────────────────────────
export {
  buildCompositionPlan,
  compositionToPromptFragment,
  enrichForPresence,
  validateAssetPresence,
  validateHeroComposition,
  resolveCompositionMode,
  MIN_VISIBLE_ELEMENT_COVERAGE,
  MIN_TOTAL_VISUAL_COVERAGE,
  MIN_VISIBLE_VISUAL_ELEMENTS,
  MIN_PRIMARY_VISUAL_COVERAGE,
  MIN_SUPPORTING_DECORATIVE_ELEMENTS,
  type ElementPlacement,
  type CompositionPlan,
  type CompositionMode,
  type AssetRole,
  type Anchor,
  type AssetPresenceViolation,
  type HeroCompositionIssue,
} from "./asset-selector";

// ── Element contracts ────────────────────────────────────────────────────
export {
  validatePlacement,
  remapToAllowedZone,
  totalDensityScore,
  motionCompatibleElements,
  buildZoneOwnershipMap,
  ASSET_CONTRACTS,
  type AssetElementType,
  type AssetContract,
  type ContractViolation,
} from "./contract";

// ── Placement rules (Step 15) ────────────────────────────────────────────
export {
  KIND_PLACEMENT_RULES,
  PURPOSE_LAYER_BAND,
  ruleForKind,
  purposeForKind,
  roleForKind,
  maxInstancesPerLayout,
  clampScaleForKind,
  resolveAnchorForKind,
  resolveLayerForKind,
  describePlacement,
  type PlacementPurpose,
  type KindPlacementRule,
  type ScaleRange,
} from "./asset-placement";

// ── Structural placement slots (Step 56) ─────────────────────────────────
export {
  PLACEMENT_GRID_COLUMNS,
  SLOT_COMPATIBLE_MODES,
  SLOT_MIN_EDGE_MARGIN,
  slotForPlacement,
  occupiedSlots,
  anchorsForSlot,
  validatePlacementStructure,
  type PlacementSlot,
  type PlacementStructureViolation,
} from "./placement-rules";

// ── Visual dominance enforcement (Step 58) ───────────────────────────────
export {
  MIN_DOMINANCE_RATIO,
  MIN_FOREGROUND_COVERAGE,
  COMPETING_FOCAL_RATIO,
  validateVisualDominance,
  type DominanceViolation,
} from "./visual-dominance";

// ── Decorative components (Step 16) ──────────────────────────────────────
export {
  DECORATIVE_COMPONENTS,
  getComponentById,
  listComponentsByKind,
  buildComponent,
  composeDecorativeRoster,
  type DecorativeComponentKind,
  type ComponentProps,
  type DecorativeComponentDefinition,
  type ComposeOptions,
} from "./decorative-components";

// ── Background treatments (Step 18) ──────────────────────────────────────
export {
  resolveBackgroundTreatment,
  treatmentKindForTone,
  type BackgroundTreatmentKind,
  type BackgroundLayerSpec,
  type BackgroundTreatment,
} from "./background-treatments";

// ── Depth & layering (Step 19) ───────────────────────────────────────────
export {
  TIER_PROFILE,
  DEPTH_TIERS,
  tierForRole,
  tierForKind,
  shadowForTier,
  shadowForRole,
  shadowForKind,
  shadowToCssFilter,
  shadowToSvgFilter,
  buildDepthSeparationLayer,
  summarizeDepthStack,
  type DepthTier,
  type ShadowSpec,
  type TierProfile,
  type DepthSeparationLayer,
} from "./depth-layering";

// ── Text / visual balance (Step 20) ──────────────────────────────────────
export {
  analyzeBalance,
  planRebalance,
  BALANCE_MIN_RATIO,
  BALANCE_MAX_RATIO,
  type BalanceBand,
  type BalanceReport,
  type BalanceInput,
  type BalanceElement,
  type RebalanceSuggestion,
  type RebalancePlan,
  type RebalanceOptions,
} from "./composition-balance";

// ── Parametric asset-library (legacy retrieval engine) ───────────────────
export {
  retrieveAssets,
  listAssetPacks,
  getAssetPack,
  generateParametricBackground,
  buildRetrievalContext,
  type AssetDescriptor,
  type AssetPack,
  type AssetIndustry,
  type AssetMediaType,
  type AssetMood,
  type RetrievalContext,
  type RetrievedAsset,
} from "./asset-library";

// ── 3D asset manifest (deployment contract) ──────────────────────────────
export {
  ASSET_3D_MANIFEST,
  asset3dBaseUrl,
  asset3dUrl,
  isAsset3dConfigured,
  asset3dManifestStats,
  is3dManifestPremiumOnly,
  asset3dSlugsByQualityTier,
  asset3dSlugsByRealm,
  natureAsset3dSlugs,
  lifestyleAsset3dSlugs,
  objectAsset3dSlugs,
  decorativeAsset3dSlugs,
  getAsset3dSlug,
  type Asset3DSlug,
} from "./3d-asset-manifest";
