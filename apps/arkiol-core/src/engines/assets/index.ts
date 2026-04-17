// src/engines/assets/index.ts
//
// Assets module — composition planning, contract validation, and asset library.

export {
  buildCompositionPlan,
  compositionToPromptFragment,
  type ElementPlacement,
  type CompositionPlan,
} from "./asset-selector";

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
