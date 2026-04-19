// src/engines/hierarchy/index.ts
//
// Hierarchy module — typographic hierarchy rule enforcement.

export {
  enforceHierarchy,
  type TextContent,
  type HierarchyViolation,
  type HierarchyResult,
} from "./enforcer";

export {
  enforceStrictTypographyHierarchy,
  getZoneTier,
  type TypographyItem,
  type HierarchyAdjustment,
  type StrictHierarchyResult,
} from "./strict-typography";
