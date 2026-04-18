// src/engines/personalization/index.ts
//
// Personalization engine — Design DNA profiles and generation overrides.

export {
  getDesignDNA,
  setDesignDNA,
  hasDesignDNA,
  deleteDesignDNA,
  applyDNAFeedback,
  applyDNAFeedbackBatch,
  buildDNADiagnostic,
  type DesignDNA,
  type StyleAffinities,
  type ThemePreferences,
  type DNAFeedbackType,
  type DNAFeedbackSignal,
  type StyleTraitObservation,
  type DNADiagnostic,
} from "./design-dna";

export {
  computeDNAThemeBias,
  computeDNATypographyOverrides,
  computeDNAColorOverrides,
  computeDNALayoutBias,
  computeDNACtaBias,
  buildPersonalizationContext,
  extractTraitsFromTheme,
  type DNAThemeBias,
  type DNATypographyOverrides,
  type DNAColorOverrides,
  type DNALayoutBias,
  type DNACtaBias,
  type PersonalizationContext,
} from "./dna-applicator";
