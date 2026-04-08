// src/engines/exploration/evaluator.ts
// Creative Exploration AI Engine — Multi-Objective Evaluation Engine
// ─────────────────────────────────────────────────────────────────────────────
//
// Scores every valid candidate across 6 evaluation dimensions using
// deterministic heuristics. NO external API calls. ALL scoring <1ms/candidate.
//
// Evaluation Dimensions:
//   D1: Readability              — typographic clarity, density fit
//   D2: Visual Hierarchy Clarity — headline > subhead > body distinction
//   D3: Platform Optimization    — format-specific safe zones, aspect ratios
//   D4: Brand Alignment          — color/font/tone compatibility with brand
//   D5: Visual Balance           — weight distribution, whitespace balance
//   D6: Attention Potential      — hook strength, first-impression stopping power
//
// FIXES:
//   - ARCHETYPE_PRESET_SYNERGY now uses correct ArchetypeId (SCREAMING_SNAKE)
//     and StylePresetId (clean | bold | professional | minimal | expressive) values
//   - scoreBrandAlignment tone bonus checks use correct ArchetypeId keys
//   - darkBgPresets updated to use presets that actually exist in STYLE_PRESET_IDS

import type {
  CandidateDesignPlan,
  EvaluationScores,
  RankedCandidate,
  ConfidenceTier,
  DesignGenome,
  DensityProfileLevel,
  HookStrategy,
  CompositionPattern,
  ExplorePipelineContext,
} from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// § 1  THRESHOLDS & WEIGHTS
// ─────────────────────────────────────────────────────────────────────────────

const HIGH_CONFIDENCE_THRESHOLD = 0.70;
const EXPERIMENTAL_THRESHOLD    = 0.45;

const DEFAULT_DIMENSION_WEIGHTS = {
  readability:            0.20,
  visualHierarchyClarity: 0.20,
  platformOptimization:   0.18,
  brandAlignment:         0.16,
  visualBalance:          0.14,
  attentionPotential:     0.12,
};

/** Format-specific dimension weight overrides */
const FORMAT_DIMENSION_WEIGHTS: Partial<Record<string, typeof DEFAULT_DIMENSION_WEIGHTS>> = {
  youtube_thumbnail: {
    readability:            0.15,
    visualHierarchyClarity: 0.15,
    platformOptimization:   0.20,
    brandAlignment:         0.10,
    visualBalance:          0.12,
    attentionPotential:     0.28,
  },
  logo: {
    readability:            0.18,
    visualHierarchyClarity: 0.25,
    platformOptimization:   0.15,
    brandAlignment:         0.28,
    visualBalance:          0.10,
    attentionPotential:     0.04,
  },
  resume: {
    readability:            0.35,
    visualHierarchyClarity: 0.30,
    platformOptimization:   0.15,
    brandAlignment:         0.10,
    visualBalance:          0.08,
    attentionPotential:     0.02,
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// § 2  SUB-RULE LOOKUP TABLES
// ─────────────────────────────────────────────────────────────────────────────

// D1: Readability
const DENSITY_READABILITY: Record<DensityProfileLevel, number> = {
  sparse:   0.90,
  balanced: 0.85,
  rich:     0.70,
  dense:    0.55,
};

const TYPO_PERSONALITY_READABILITY: Record<number, number> = {
  0: 0.95, // clean — highest readability
  1: 0.85,
  2: 0.80,
  3: 0.70,
  4: 0.75, // luxury — legible but ornate
};

// D2: Visual Hierarchy Clarity
const HOOK_HIERARCHY_SUPPORT: Record<HookStrategy, number> = {
  bold_headline:     0.95,
  visual_lead:       0.75,
  contrast_punch:    0.85,
  negative_space:    0.90,
  color_block:       0.80,
  sequential_reveal: 0.88,
  texture_depth:     0.65,
  pattern_interrupt: 0.55,
  social_proof:      0.70,
  urgency_frame:     0.80,
  frame_within_frame: 0.78,
};

const COMPOSITION_HIERARCHY_SUPPORT: Record<CompositionPattern, number> = {
  z_flow:                0.88,
  f_flow:                0.85,
  golden_ratio:          0.92,
  rule_of_thirds:        0.90,
  centered_axis:         0.85,
  diagonal_tension:      0.65,
  frame_within_frame:    0.80,
  asymmetric_weight:     0.60,
  radial_burst:          0.70,
};

// D3: Platform Optimization — hook fit per format
const FORMAT_HOOK_FIT: Partial<Record<string, Partial<Record<HookStrategy, number>>>> = {
  youtube_thumbnail: {
    bold_headline:  0.95,
    visual_lead:    0.90,
    contrast_punch: 0.92,
    social_proof:   0.75,
    urgency_frame:  0.80,
  },
  instagram_story: {
    visual_lead:       0.92,
    sequential_reveal: 0.90,
    color_block:       0.85,
  },
  logo: {
    negative_space: 0.95,
    color_block:    0.85,
    bold_headline:  0.80,
  },
};

// D4: Brand Alignment — archetype + preset synergy scores.
//
// FIXED: Keys now use correct ArchetypeId (SCREAMING_SNAKE_CASE) and
// StylePresetId (clean | bold | professional | minimal | expressive) values.
// The old table used fictional names like "bold_hero" and "neon_pulse" that
// don't exist in @arkiol/shared and caused zero-match on every lookup.
const ARCHETYPE_PRESET_SYNERGY: Partial<Record<string, Partial<Record<string, number>>>> = {
  // Power / action archetypes pair well with bold + expressive
  AGGRESSIVE_POWER:      { bold: 0.95, expressive: 0.88 },
  BOLD_CLAIM:            { bold: 0.92, expressive: 0.85 },
  NEWS_URGENT:           { bold: 0.90, professional: 0.82 },
  SPORTS_ACTION:         { bold: 0.92, expressive: 0.80 },

  // Clean / minimal archetypes pair well with clean + minimal + professional
  MINIMAL_CLEAN:         { minimal: 0.97, clean: 0.92, professional: 0.88 },
  PRODUCT_FOCUS:         { clean: 0.90, minimal: 0.85, professional: 0.82 },
  EDUCATIONAL_EXPLAINER: { professional: 0.90, clean: 0.85, minimal: 0.78 },
  AUTHORITY_EXPERT:      { professional: 0.92, clean: 0.85 },

  // Luxury archetypes pair well with minimal + clean (understated elegance)
  LUXURY_PREMIUM:        { minimal: 0.97, clean: 0.88 },
  MUSIC_ARTISTIC:        { expressive: 0.95, bold: 0.82 },
  CINEMATIC_DARK:        { bold: 0.90, expressive: 0.88 },

  // Warm / trust archetypes pair well with clean + professional
  TRUST_FRIENDLY:        { clean: 0.90, professional: 0.85, minimal: 0.78 },
  EMOTIONAL_STORY:       { expressive: 0.88, clean: 0.80 },
  RELIGION_CALM:         { minimal: 0.92, clean: 0.88 },

  // Playful archetypes pair well with bold + expressive
  KIDS_PLAYFUL:          { expressive: 0.95, bold: 0.88 },
  FUN_PLAYFUL:           { expressive: 0.92, bold: 0.85 },

  // Intellectual archetypes pair well with professional + minimal
  CURIOSITY_MYSTERY:     { minimal: 0.88, expressive: 0.82 },
  COMPARISON_VS:         { professional: 0.88, clean: 0.82, bold: 0.78 },
  TECH_FUTURISTIC:       { bold: 0.88, minimal: 0.85, expressive: 0.82 },

  // Face / person archetypes: flexible — pair moderately with most presets
  FACE_CLOSEUP:          { clean: 0.85, bold: 0.80, professional: 0.78 },
};

// D5: Visual Balance
const COMPOSITION_BALANCE: Record<CompositionPattern, number> = {
  z_flow:                0.80,
  f_flow:                0.78,
  golden_ratio:          0.95,
  rule_of_thirds:        0.92,
  centered_axis:         0.90,
  diagonal_tension:      0.62,
  frame_within_frame:    0.85,
  asymmetric_weight:     0.55,
  radial_burst:          0.75,
};

const DENSITY_BALANCE: Record<DensityProfileLevel, number> = {
  sparse:   0.90,
  balanced: 0.95,
  rich:     0.75,
  dense:    0.55,
};

// D6: Attention Potential
const HOOK_ATTENTION: Record<HookStrategy, number> = {
  bold_headline:     0.85,
  visual_lead:       0.90,
  contrast_punch:    0.92,
  negative_space:    0.75,
  color_block:       0.80,
  sequential_reveal: 0.78,
  texture_depth:     0.65,
  pattern_interrupt: 0.88,
  social_proof:      0.72,
  urgency_frame:      0.95,
  frame_within_frame: 0.82,
};

// ─────────────────────────────────────────────────────────────────────────────
// § 3  DIMENSION SCORERS
// ─────────────────────────────────────────────────────────────────────────────

function scoreReadability(genome: DesignGenome): number {
  const densityScore  = DENSITY_READABILITY[genome.densityProfile];
  const typoScore     = TYPO_PERSONALITY_READABILITY[genome.typographyPersonality] ?? 0.8;
  const motionPenalty = genome.motionEligible ? 0.05 : 0;
  return Math.max(0, Math.min(1, densityScore * 0.5 + typoScore * 0.5 - motionPenalty));
}

function scoreVisualHierarchyClarity(genome: DesignGenome): number {
  const hookScore        = HOOK_HIERARCHY_SUPPORT[genome.hookStrategy] ?? 0.7;
  const compositionScore = COMPOSITION_HIERARCHY_SUPPORT[genome.compositionPattern] ?? 0.7;
  const densityPenalty   = genome.densityProfile === "dense" ? 0.1 : 0;
  return Math.max(0, Math.min(1, hookScore * 0.55 + compositionScore * 0.45 - densityPenalty));
}

// ── v9: Import Platform Intelligence for richer D3 scoring ─────────────────
// Lazy-loaded to avoid circular deps; falls back gracefully if unavailable.
let _platformScore: ((genome: DesignGenome, format: string) => { overall: number; hookEffectiveness: number; textLegibility: number }) | null = null;
function getPlatformScorer() {
  if (_platformScore) return _platformScore;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { scorePlatformCompliance } = require("../platform/intelligence");
    _platformScore = scorePlatformCompliance;
  } catch {
    _platformScore = (_g: DesignGenome, _f: string) => ({ overall: 0.75, hookEffectiveness: 0.75, textLegibility: 0.75 });
  }
  return _platformScore!;
}

function scorePlatformOptimization(genome: DesignGenome, format: string): number {
  // Legacy heuristic score (fast, no I/O)
  const formatHookFits = FORMAT_HOOK_FIT[format];
  const hookFit        = formatHookFits?.[genome.hookStrategy] ?? 0.70;
  const motionScore    = genome.motionEligible ? 0.85 : 0.80;
  const legacyScore    = Math.max(0, Math.min(1, hookFit * 0.70 + motionScore * 0.30));

  // v9 enhancement: blend in platform intelligence compliance score (60/40)
  try {
    const scorer  = getPlatformScorer();
    const pResult = scorer(genome, format);
    // Weighted blend: platform intelligence carries more weight when confidence is high
    const blendedScore = pResult.overall * 0.60 + legacyScore * 0.40;
    return Math.max(0, Math.min(1, blendedScore));
  } catch {
    return legacyScore;
  }
}

function scoreBrandAlignment(
  genome: DesignGenome,
  context: ExplorePipelineContext,
): number {
  // Synergy between archetype + preset — now uses correct IDs
  const synergies    = ARCHETYPE_PRESET_SYNERGY[genome.archetype] ?? {};
  const synergyScore = synergies[genome.preset] ?? 0.60;

  // Dark-background preference — uses actual StylePresetIds that exist
  // "bold" and "expressive" are the darker-natured presets in our palette
  const darkishPresets = ["bold", "expressive"];
  const darkBgScore    = context.brandPrefersDarkBg
    ? darkishPresets.includes(genome.preset) ? 0.90 : 0.65
    : darkishPresets.includes(genome.preset) ? 0.72 : 0.87;

  // Tone keyword bonus — uses correct ArchetypeId keys
  let toneBonus = 0;
  if (context.brandToneKeywords && context.brandToneKeywords.length > 0) {
    const kws         = context.brandToneKeywords.map(k => k.toLowerCase());
    const isPlayful   = kws.some(k => ["fun", "playful", "energetic", "bold"].includes(k));
    const isLux       = kws.some(k => ["luxury", "premium", "elegant", "refined"].includes(k));
    const isTech      = kws.some(k => ["modern", "innovative", "tech", "digital", "futuristic"].includes(k));
    const isUrgent    = kws.some(k => ["urgent", "breaking", "news", "fast"].includes(k));

    // Correct ArchetypeId comparisons
    if (isPlayful && (genome.archetype === "FUN_PLAYFUL" || genome.archetype === "KIDS_PLAYFUL")) toneBonus = 0.08;
    if (isLux     && genome.archetype === "LUXURY_PREMIUM")   toneBonus = 0.10;
    if (isTech    && genome.archetype === "TECH_FUTURISTIC")  toneBonus = 0.08;
    if (isUrgent  && genome.archetype === "NEWS_URGENT")      toneBonus = 0.09;
  }

  return Math.max(0, Math.min(1, synergyScore * 0.60 + darkBgScore * 0.40 + toneBonus));
}

function scoreVisualBalance(genome: DesignGenome): number {
  const compositionScore = COMPOSITION_BALANCE[genome.compositionPattern] ?? 0.70;
  const densityScore     = DENSITY_BALANCE[genome.densityProfile];
  return Math.max(0, Math.min(1, compositionScore * 0.60 + densityScore * 0.40));
}

function scoreAttentionPotential(
  genome: DesignGenome,
  context: ExplorePipelineContext,
): number {
  const hookScore   = HOOK_ATTENTION[genome.hookStrategy] ?? 0.70;
  const motionBonus = genome.motionEligible ? 0.08 : 0;
  const imageBonus  = context.imageProvided && genome.hookStrategy === "visual_lead" ? 0.05 : 0;
  return Math.max(0, Math.min(1, hookScore + motionBonus + imageBonus));
}

// ─────────────────────────────────────────────────────────────────────────────
// § 4  COMPOSITE SCORER
// ─────────────────────────────────────────────────────────────────────────────

export function evaluateCandidate(
  candidate: CandidateDesignPlan,
  context: ExplorePipelineContext,
): EvaluationScores {
  const t0 = Date.now();
  const { genome, format } = candidate;
  const weights = FORMAT_DIMENSION_WEIGHTS[format] ?? DEFAULT_DIMENSION_WEIGHTS;

  const readability            = scoreReadability(genome);
  const visualHierarchyClarity = scoreVisualHierarchyClarity(genome);
  const platformOptimization   = scorePlatformOptimization(genome, format);
  const brandAlignment         = scoreBrandAlignment(genome, context);
  const visualBalance          = scoreVisualBalance(genome);
  const attentionPotential     = scoreAttentionPotential(genome, context);

  const compositeScore =
    readability            * weights.readability +
    visualHierarchyClarity * weights.visualHierarchyClarity +
    platformOptimization   * weights.platformOptimization +
    brandAlignment         * weights.brandAlignment +
    visualBalance          * weights.visualBalance +
    attentionPotential     * weights.attentionPotential;

  // Find weakest dimension
  const dimensionMap = {
    readability,
    visualHierarchyClarity,
    platformOptimization,
    brandAlignment,
    visualBalance,
    attentionPotential,
  };
  const weakestDimension = (
    Object.entries(dimensionMap).sort(([, a], [, b]) => a - b)[0]![0]
  ) as keyof typeof dimensionMap;

  return {
    readability,
    visualHierarchyClarity,
    platformOptimization,
    brandAlignment,
    visualBalance,
    attentionPotential,
    compositeScore,
    weakestDimension,
    evaluationMs: Date.now() - t0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// § 5  CONFIDENCE TIER CLASSIFIER
// ─────────────────────────────────────────────────────────────────────────────

export function classifyConfidenceTier(compositeScore: number): ConfidenceTier {
  if (compositeScore >= HIGH_CONFIDENCE_THRESHOLD) return "high_confidence";
  if (compositeScore >= EXPERIMENTAL_THRESHOLD)    return "experimental";
  return "speculative";
}

// ─────────────────────────────────────────────────────────────────────────────
// § 6  BATCH EVALUATOR
// ─────────────────────────────────────────────────────────────────────────────

export interface BatchEvaluationResult {
  evaluatedCandidates: Array<CandidateDesignPlan & { scores: EvaluationScores }>;
  evaluationMs: number;
  averageCompositeScore: number;
  highConfidenceCount: number;
  experimentalCount: number;
  speculativeCount: number;
}

export function evaluateBatch(
  candidates: CandidateDesignPlan[],
  context: ExplorePipelineContext,
): BatchEvaluationResult {
  const t0 = Date.now();
  const evaluated: Array<CandidateDesignPlan & { scores: EvaluationScores }> = [];

  let scoreSum          = 0;
  let highConfidenceCount = 0;
  let experimentalCount   = 0;
  let speculativeCount    = 0;

  for (const candidate of candidates) {
    const scores = evaluateCandidate(candidate, context);
    const tier   = classifyConfidenceTier(scores.compositeScore);

    evaluated.push({ ...candidate, scores, confidenceTier: tier });
    scoreSum += scores.compositeScore;

    if (tier === "high_confidence") highConfidenceCount++;
    else if (tier === "experimental") experimentalCount++;
    else speculativeCount++;
  }

  return {
    evaluatedCandidates:  evaluated,
    evaluationMs:         Date.now() - t0,
    averageCompositeScore: evaluated.length > 0 ? scoreSum / evaluated.length : 0,
    highConfidenceCount,
    experimentalCount,
    speculativeCount,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// § 7  RANKED CANDIDATE BUILDER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Combines quality scores with novelty scores → exploration score.
 * explorationScore = compositeScore * alpha + noveltyScore * (1 - alpha)
 * Default alpha = 0.65 (slight quality bias over novelty).
 */
export function buildRankedCandidates(
  candidates: Array<CandidateDesignPlan & { scores: EvaluationScores }>,
  noveltyScores: Map<string, number>,
  alpha = 0.65,
): RankedCandidate[] {
  const ranked: RankedCandidate[] = candidates.map(c => {
    const noveltyScore    = noveltyScores.get(c.candidateId) ?? 0.5;
    const explorationScore = c.scores.compositeScore * alpha + noveltyScore * (1 - alpha);
    const confidenceTier  = classifyConfidenceTier(c.scores.compositeScore);

    return {
      ...c,
      scores:          c.scores,
      noveltyScore,
      explorationScore,
      confidenceTier,
      rank:            0, // assigned below
    };
  });

  // Sort descending by explorationScore
  ranked.sort((a, b) => b.explorationScore - a.explorationScore);

  // Assign 1-based ranks
  ranked.forEach((c, i) => { c.rank = i + 1; });

  return ranked;
}
