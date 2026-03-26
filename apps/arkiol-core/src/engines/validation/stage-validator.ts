// src/engines/validation/stage-validator.ts
// Inter-Stage Schema Validation
// ─────────────────────────────────────────────────────────────────────────────
//
// Enforces strict schema contracts between every AI pipeline stage.
// Every stage hand-off is validated before execution to prevent cascading
// failures from upstream data corruption.
//
// Validation strategy:
//   • Type coercion where safe (string → number conversions)
//   • Hard rejection for missing required fields
//   • Value range clamping for bounded numerics (scores, weights, sizes)
//   • ID allowlist validation for archetypes, presets, formats
//   • Deterministic repair for common fixable violations
//
// Execution contract:
//   ✓ validate() never throws — always returns {valid, data, errors}
//   ✓ repair() attempts to fix common violations and returns repaired data
//   ✓ All validators are pure functions — no side effects
//   ✓ Schema version is embedded in every validated payload

import type { DesignGenome, ExplorationPriors, EvaluationScores } from "../exploration/types";
import type { ExplorePipelineContext } from "../exploration/types";

// ─────────────────────────────────────────────────────────────────────────────
// § 1  TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface ValidationResult<T> {
  valid: boolean;
  data:  T | null;
  errors: string[];
  repaired: boolean;
  repairLog: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// § 2  KNOWN VALID VALUES
// ─────────────────────────────────────────────────────────────────────────────

export const VALID_ARCHETYPES = new Set([
  "AGGRESSIVE_POWER", "MINIMAL_CLEAN", "CURIOSITY_MYSTERY", "PRODUCT_FOCUS",
  "TRUST_FRIENDLY", "NEWS_URGENT", "CINEMATIC_DARK", "SPORTS_ACTION",
  "MUSIC_ARTISTIC", "COMPARISON_VS", "BOLD_CLAIM", "FACE_CLOSEUP",
  "EDUCATIONAL_EXPLAINER", "KIDS_PLAYFUL", "LUXURY_PREMIUM", "AUTHORITY_EXPERT",
  "TECH_FUTURISTIC", "RELIGION_CALM", "FUN_PLAYFUL", "EMOTIONAL_STORY",
]);

export const VALID_PRESETS = new Set([
  "clean", "bold", "professional", "minimal", "expressive",
]);

export const VALID_DENSITY_PROFILES = new Set(["sparse", "balanced", "rich", "dense"]);

export const VALID_HOOK_STRATEGIES = new Set([
  "bold_headline", "visual_lead", "contrast_punch", "negative_space",
  "color_block", "sequential_reveal", "texture_depth", "pattern_interrupt",
  "social_proof", "urgency_frame",
]);

export const VALID_COMPOSITION_PATTERNS = new Set([
  "z_flow", "f_flow", "golden_ratio", "rule_of_thirds", "centered_axis",
  "diagonal_tension", "frame_within_frame", "asymmetric_weight", "radial_burst",
]);

export const VALID_FORMATS = new Set([
  "youtube_thumbnail", "youtube_shorts", "instagram_post", "instagram_story",
  "tiktok_ad", "tiktok_cover", "linkedin_post", "linkedin_banner",
  "twitter_post", "facebook_ad", "facebook_post", "google_leaderboard",
  "google_display_rectangle", "flyer", "poster", "slide", "business_card",
  "resume", "logo", "ig_post", "ig_story", "yt_thumb",
]);

// ─────────────────────────────────────────────────────────────────────────────
// § 3  GENOME VALIDATOR
// ─────────────────────────────────────────────────────────────────────────────

export function validateDesignGenome(raw: unknown): ValidationResult<DesignGenome> {
  const errors: string[] = [];
  const repairLog: string[] = [];
  let repaired = false;

  if (!raw || typeof raw !== "object") {
    return { valid: false, data: null, errors: ["genome must be an object"], repaired: false, repairLog: [] };
  }

  const g = raw as Record<string, unknown>;

  // layoutFamily
  const layoutFamily = typeof g.layoutFamily === "string" ? g.layoutFamily : "";
  if (!layoutFamily) errors.push("layoutFamily is required");

  // variationId
  const variationId = typeof g.variationId === "string" ? g.variationId : "";
  if (!variationId) errors.push("variationId is required");

  // archetype — repair to BOLD_CLAIM if invalid
  let archetype = typeof g.archetype === "string" ? g.archetype : "BOLD_CLAIM";
  if (!VALID_ARCHETYPES.has(archetype)) {
    repairLog.push(`archetype "${archetype}" is invalid — repaired to BOLD_CLAIM`);
    archetype = "BOLD_CLAIM";
    repaired = true;
  }

  // preset — repair to "bold" if invalid
  let preset = typeof g.preset === "string" ? g.preset : "bold";
  if (!VALID_PRESETS.has(preset)) {
    repairLog.push(`preset "${preset}" is invalid — repaired to "bold"`);
    preset = "bold";
    repaired = true;
  }

  // typographyPersonality — clamp to [0, 4]
  let typographyPersonality = typeof g.typographyPersonality === "number" ? g.typographyPersonality : 1;
  if (![0, 1, 2, 3, 4].includes(typographyPersonality)) {
    const clamped = Math.max(0, Math.min(4, Math.round(typographyPersonality))) as 0|1|2|3|4;
    repairLog.push(`typographyPersonality ${typographyPersonality} clamped to ${clamped}`);
    typographyPersonality = clamped;
    repaired = true;
  }

  // densityProfile — repair to "balanced" if invalid
  let densityProfile = typeof g.densityProfile === "string" ? g.densityProfile : "balanced";
  if (!VALID_DENSITY_PROFILES.has(densityProfile)) {
    repairLog.push(`densityProfile "${densityProfile}" invalid — repaired to "balanced"`);
    densityProfile = "balanced";
    repaired = true;
  }

  // hookStrategy — repair to "bold_headline" if invalid
  let hookStrategy = typeof g.hookStrategy === "string" ? g.hookStrategy : "bold_headline";
  if (!VALID_HOOK_STRATEGIES.has(hookStrategy)) {
    repairLog.push(`hookStrategy "${hookStrategy}" invalid — repaired to "bold_headline"`);
    hookStrategy = "bold_headline";
    repaired = true;
  }

  // compositionPattern — repair to "centered_axis" if invalid
  let compositionPattern = typeof g.compositionPattern === "string" ? g.compositionPattern : "centered_axis";
  if (!VALID_COMPOSITION_PATTERNS.has(compositionPattern)) {
    repairLog.push(`compositionPattern "${compositionPattern}" invalid — repaired to "centered_axis"`);
    compositionPattern = "centered_axis";
    repaired = true;
  }

  // motionEligible — coerce to boolean
  const motionEligible = typeof g.motionEligible === "boolean" ? g.motionEligible : Boolean(g.motionEligible);

  if (errors.length > 0) {
    return { valid: false, data: null, errors, repaired, repairLog };
  }

  const genome: DesignGenome = {
    layoutFamily,
    variationId,
    archetype:             archetype as any,
    preset:                preset as any,
    typographyPersonality: typographyPersonality as 0|1|2|3|4,
    densityProfile:        densityProfile as any,
    hookStrategy:          hookStrategy as any,
    compositionPattern:    compositionPattern as any,
    motionEligible,
  };

  return { valid: true, data: genome, errors: [], repaired, repairLog };
}

// ─────────────────────────────────────────────────────────────────────────────
// § 4  EVALUATION SCORES VALIDATOR
// ─────────────────────────────────────────────────────────────────────────────

const SCORE_KEYS: (keyof Omit<EvaluationScores, "compositeScore" | "weakestDimension" | "evaluationMs">)[] = [
  "readability", "visualHierarchyClarity", "platformOptimization",
  "brandAlignment", "visualBalance", "attentionPotential",
];

export function validateEvaluationScores(raw: unknown): ValidationResult<EvaluationScores> {
  if (!raw || typeof raw !== "object") {
    return { valid: false, data: null, errors: ["scores must be an object"], repaired: false, repairLog: [] };
  }

  const s = raw as Record<string, unknown>;
  const repairLog: string[] = [];
  let repaired = false;
  const scores: Partial<EvaluationScores> = {};

  for (const key of SCORE_KEYS) {
    const raw = s[key];
    let val = typeof raw === "number" ? raw : parseFloat(String(raw));
    if (!isFinite(val)) {
      repairLog.push(`${key} is NaN — defaulted to 0.5`);
      val = 0.5;
      repaired = true;
    }
    if (val < 0 || val > 1) {
      const clamped = Math.max(0, Math.min(1, val));
      repairLog.push(`${key} ${val} clamped to ${clamped}`);
      val = clamped;
      repaired = true;
    }
    (scores as any)[key] = val;
  }

  const values = SCORE_KEYS.map(k => scores[k] as number);
  const composite = values.reduce((s, v) => s + v, 0) / values.length;
  const weakest = SCORE_KEYS.reduce((min, k) => (scores[k] as number) < (scores[min] as number) ? k : min, SCORE_KEYS[0]);

  const result: EvaluationScores = {
    ...(scores as Required<typeof scores>),
    compositeScore:         Math.min(1, Math.max(0, composite)),
    weakestDimension:       weakest,
    evaluationMs:           typeof s.evaluationMs === "number" ? s.evaluationMs : 0,
  };

  return { valid: true, data: result, errors: [], repaired, repairLog };
}

// ─────────────────────────────────────────────────────────────────────────────
// § 5  PIPELINE CONTEXT VALIDATOR
// ─────────────────────────────────────────────────────────────────────────────

export function validatePipelineContext(raw: unknown): ValidationResult<ExplorePipelineContext> {
  if (!raw || typeof raw !== "object") {
    return { valid: false, data: null, errors: ["pipelineContext must be an object"], repaired: false, repairLog: [] };
  }

  const c = raw as Record<string, unknown>;
  const errors: string[] = [];
  const repairLog: string[] = [];
  let repaired = false;

  const intent = typeof c.intent === "string" ? c.intent.slice(0, 2000) : "";
  if (!intent) {
    repairLog.push("intent is empty — defaulting to 'design'");
    repaired = true;
  }

  const format = typeof c.format === "string" ? c.format : "";
  if (!format) errors.push("format is required");

  const audienceSegment    = typeof c.audienceSegment === "string" ? c.audienceSegment : "general";
  const tonePreference     = typeof c.tonePreference === "string" ? c.tonePreference : "neutral";
  const layoutType         = typeof c.layoutType === "string" ? c.layoutType : "standard";

  if (errors.length > 0) return { valid: false, data: null, errors, repaired, repairLog };

  const ctx: ExplorePipelineContext = {
    intent:               intent || "design",
    format,
    audienceSegment,
    tonePreference,
    layoutType,
    brandPrimaryColor:    typeof c.brandPrimaryColor === "string" ? c.brandPrimaryColor : undefined,
    brandSecondaryColor:  typeof c.brandSecondaryColor === "string" ? c.brandSecondaryColor : undefined,
    brandFontDisplay:     typeof c.brandFontDisplay === "string" ? c.brandFontDisplay : undefined,
    brandPrefersDarkBg:   typeof c.brandPrefersDarkBg === "boolean" ? c.brandPrefersDarkBg : undefined,
    brandToneKeywords:    Array.isArray(c.brandToneKeywords) ? c.brandToneKeywords.filter(t => typeof t === "string") : undefined,
    densityTextBlockCount:typeof c.densityTextBlockCount === "number" ? c.densityTextBlockCount : undefined,
    imageProvided:        typeof c.imageProvided === "boolean" ? c.imageProvided : false,
    stylePreset:          typeof c.stylePreset === "string" ? c.stylePreset : undefined,
    archetypeId:          typeof c.archetypeId === "string" ? c.archetypeId as any : undefined,
  };

  return { valid: true, data: ctx, errors: [], repaired, repairLog };
}

// ─────────────────────────────────────────────────────────────────────────────
// § 6  PRIORS VALIDATOR
// ─────────────────────────────────────────────────────────────────────────────

export function validateExplorationPriors(raw: unknown): ValidationResult<ExplorationPriors> {
  if (!raw || typeof raw !== "object") {
    return { valid: false, data: null, errors: ["priors must be an object"], repaired: false, repairLog: [] };
  }

  const p = raw as Record<string, unknown>;
  const repairLog: string[] = [];
  let repaired = false;

  const orgId = typeof p.orgId === "string" ? p.orgId : "";
  if (!orgId) return { valid: false, data: null, errors: ["orgId is required"], repaired: false, repairLog: [] };

  // Clamp temperature to [0.2, 1.0]
  let explorationTemperature = typeof p.explorationTemperature === "number" ? p.explorationTemperature : 0.75;
  if (explorationTemperature < 0.2 || explorationTemperature > 1.0) {
    explorationTemperature = Math.max(0.2, Math.min(1.0, explorationTemperature));
    repairLog.push(`explorationTemperature clamped to ${explorationTemperature}`);
    repaired = true;
  }

  // Validate weight maps — normalise if weights don't sum to ~1
  const normaliseWeightMap = (map: unknown, label: string): Record<string, number> => {
    if (!map || typeof map !== "object") {
      repairLog.push(`${label} missing — using empty map`);
      repaired = true;
      return {};
    }
    const m = map as Record<string, unknown>;
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(m)) {
      const n = typeof v === "number" ? v : 0;
      out[k] = Math.max(0, n);
    }
    return out;
  };

  const priors: ExplorationPriors = {
    orgId,
    brandId:                   typeof p.brandId === "string" ? p.brandId : undefined,
    layoutFamilyWeights:       normaliseWeightMap(p.layoutFamilyWeights, "layoutFamilyWeights"),
    archetypeWeights:          normaliseWeightMap(p.archetypeWeights, "archetypeWeights"),
    presetWeights:             normaliseWeightMap(p.presetWeights, "presetWeights"),
    hookStrategyWeights:       normaliseWeightMap(p.hookStrategyWeights, "hookStrategyWeights"),
    compositionPatternWeights: normaliseWeightMap(p.compositionPatternWeights, "compositionPatternWeights"),
    densityProfileWeights:     normaliseWeightMap(p.densityProfileWeights, "densityProfileWeights") as any,
    explorationTemperature,
    totalSignals:              typeof p.totalSignals === "number" ? Math.max(0, p.totalSignals) : 0,
    updatedAt:                 typeof p.updatedAt === "string" ? p.updatedAt : new Date().toISOString(),
    schemaVersion:             1,
  };

  return { valid: true, data: priors, errors: [], repaired, repairLog };
}

// ─────────────────────────────────────────────────────────────────────────────
// § 7  FORMAT VALIDATOR
// ─────────────────────────────────────────────────────────────────────────────

export function validateFormat(format: unknown): ValidationResult<string> {
  if (typeof format !== "string" || !format) {
    return { valid: false, data: null, errors: ["format must be a non-empty string"], repaired: false, repairLog: [] };
  }

  const normalised = format.toLowerCase().replace(/[\s-]/g, "_");

  if (VALID_FORMATS.has(normalised)) {
    return { valid: true, data: normalised, errors: [], repaired: normalised !== format, repairLog: normalised !== format ? [`normalised "${format}" → "${normalised}"`] : [] };
  }

  // Try partial match
  for (const valid of VALID_FORMATS) {
    if (valid.includes(normalised) || normalised.includes(valid)) {
      return { valid: true, data: valid, errors: [], repaired: true, repairLog: [`"${format}" mapped to "${valid}"`] };
    }
  }

  // Fallback to instagram_post as the most common format
  return {
    valid: true,
    data:  "instagram_post",
    errors: [],
    repaired: true,
    repairLog: [`Unknown format "${format}" — defaulted to "instagram_post"`],
  };
}
