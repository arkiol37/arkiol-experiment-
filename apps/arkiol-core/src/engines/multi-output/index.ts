// src/engines/multi-output/index.ts
//
// Multi-output generation — coordinated multi-format design sets.

export {
  generateMultiOutput,
  generateVariations,
  buildMultiOutputPipelineInputs,
  type MultiOutputRequest,
  type MultiOutputResult,
  type FormatRenderResult,
  type VariationRequest,
  type VariationResult,
} from "./coordinator";

export {
  extractStyleAnchor,
  extractStyleAnchorFromIdentity,
  anchorToBrand,
  deriveVariationIndex,
  checkOutputConsistency,
  type StyleAnchor,
  type ConsistencyCheck,
} from "./style-anchor";
