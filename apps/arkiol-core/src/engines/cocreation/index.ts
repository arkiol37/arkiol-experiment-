// src/engines/cocreation/index.ts
//
// Real-time co-creation — parse natural language edits and apply them
// to existing designs without full regeneration.

export {
  parseInstruction,
  resolveNamedColor,
  type EditCategory,
  type EditIntent,
  type EditOperation,
  type ParsedInstruction,
} from "./instruction-parser";

export {
  applyInstructions,
  type MutationResult,
  type MutationAction,
} from "./design-mutator";
