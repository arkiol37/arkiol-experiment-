// src/engines/intent/index.ts
//
// Intent module — prompt analysis and brief extraction.
// Facade over the AI brief analyzer to provide a clean module boundary.

export {
  analyzeBrief,
  BriefAnalysisSchema,
  type BriefAnalysis,
  type BriefAnalysisOptions,
} from "../ai/brief-analyzer";
