// src/engines/inspiration/index.ts
//
// Inspiration engine — pattern-based design intelligence from real-world references.

export {
  getAllPatterns,
  getPatternById,
  getPatternsBySource,
  getPatternsByCategory,
  getPatternsByTone,
  getFreshPatterns,
} from "./pattern-library";

export {
  matchPatternToBrief,
  matchTopPatterns,
  buildInspirationOverrides,
  type PatternMatchResult,
  type InspirationOverrides,
} from "./pattern-matcher";

export type {
  DesignPattern,
  PatternApplicationHint,
  PatternSource,
  PatternCategory,
  ColorRelationship,
  TypographyPattern,
  SpacingPattern,
  DecorationPattern,
  LayoutStructurePattern,
} from "./pattern-types";
