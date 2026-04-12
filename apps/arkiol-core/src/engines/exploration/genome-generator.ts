// src/engines/exploration/genome-generator.ts
// Creative Exploration AI Engine — Design Genome Generator
// ─────────────────────────────────────────────────────────────────────────────
//
// Generates a large pool of structured CandidateDesignPlans using a controlled
// "design genome" composed of 9 genes. All generation is DETERMINISTIC from a
// seed — the same seed + context always produces the same candidate pool.
//
// Architecture:
//   • SeededRNG: Correct Mulberry32 PRNG seeded with sha256(seed + index)
//   • GenomeSpace: finite enumerated universe of valid gene values
//   • PriorWeightedSampler: weighted sampling blended with exploration priors
//   • CandidateBuilder: assembles genome into a full CandidateDesignPlan
//
// Invariants:
//   ✓ genome(seed, i) is always identical regardless of call order
//   ✓ All gene values drawn from GENOME_SPACE (type-safe, no hallucinated values)
//   ✓ Archetype IDs match ARCHETYPE_IDS in @arkiol/shared exactly (SCREAMING_SNAKE)
//   ✓ Style Preset IDs match STYLE_PRESET_IDS in @arkiol/shared exactly (lowercase)
//   ✓ motionEligible derived deterministically from format + hookStrategy
//   ✓ candidateId is sha256('candidate:' + seed + ':' + generationIndex)

import { createHash } from "crypto";
import type {
  DesignGenome,
  CandidateDesignPlan,
  DensityProfileLevel,
  HookStrategy,
  CompositionPattern,
  ExplorationPriors,
  ExplorePipelineContext,
} from "./types";
import type { ArchetypeId, StylePresetId } from "@arkiol/shared";
import type { ArkiolLayoutCategory } from "../layout/families";
import { GIF_ELIGIBLE_FORMATS } from "../../lib/types";

// ─────────────────────────────────────────────────────────────────────────────
// § 1  GENOME SPACE — all valid gene values
// ─────────────────────────────────────────────────────────────────────────────
//
// CRITICAL: archetypes must match ARCHETYPE_IDS in @arkiol/shared (all caps + underscores).
// CRITICAL: presets must match STYLE_PRESET_IDS in @arkiol/shared (lowercase).
// Any deviation will cause TypeScript type errors and runtime mismatches.

export const GENOME_SPACE = {
  layoutFamilies: [
    "ig_post", "ig_story", "yt_thumb", "flyer",
    "poster", "slide", "business_card", "resume", "logo",
  ] as const,

  variationIds: {
    ig_post:       ["v1_split", "v2_text_heavy", "v3_full_bleed", "v4_centered", "v5_bottom_third"],
    ig_story:      ["v1_default", "v2_top_text", "v3_minimal", "v4_magazine"],
    yt_thumb:      ["v1_face_right", "v2_face_left", "v3_text_only", "v4_product"],
    flyer:         ["v1_portrait", "v2_event", "v3_promo", "v4_minimalist"],
    poster:        ["v1_bold", "v2_vintage", "v3_typographic", "v4_photo"],
    slide:         ["v1_title", "v2_split", "v3_content_left", "v4_full_bleed"],
    business_card: ["v1_minimal", "v2_bold", "v3_creative"],
    resume:        ["v1_classic", "v2_modern", "v3_creative"],
    logo:          ["v1_stacked", "v2_horizontal", "v3_icon_only"],
  } as Record<string, string[]>,

  // These must exactly match ARCHETYPE_IDS in packages/shared/src/ai/archetypes/types.ts
  archetypes: [
    "AGGRESSIVE_POWER",
    "MINIMAL_CLEAN",
    "CURIOSITY_MYSTERY",
    "PRODUCT_FOCUS",
    "TRUST_FRIENDLY",
    "NEWS_URGENT",
    "CINEMATIC_DARK",
    "SPORTS_ACTION",
    "MUSIC_ARTISTIC",
    "COMPARISON_VS",
    "BOLD_CLAIM",
    "FACE_CLOSEUP",
    "EDUCATIONAL_EXPLAINER",
    "KIDS_PLAYFUL",
    "LUXURY_PREMIUM",
    "AUTHORITY_EXPERT",
    "TECH_FUTURISTIC",
    "RELIGION_CALM",
    "FUN_PLAYFUL",
    "EMOTIONAL_STORY",
  ] as ArchetypeId[],

  // These must exactly match STYLE_PRESET_IDS in packages/shared/src/ai/archetypes/types.ts
  presets: [
    "clean",
    "bold",
    "professional",
    "minimal",
    "expressive",
  ] as StylePresetId[],

  typographyPersonalities: [0, 1, 2, 3, 4] as (0 | 1 | 2 | 3 | 4)[],

  densityProfiles: ["sparse", "balanced", "rich", "dense"] as DensityProfileLevel[],

  hookStrategies: [
    "bold_headline",
    "visual_lead",
    "contrast_punch",
    "negative_space",
    "color_block",
    "sequential_reveal",
    "texture_depth",
    "pattern_interrupt",
    "social_proof",
    "urgency_frame",
  ] as HookStrategy[],

  compositionPatterns: [
    "z_flow",
    "f_flow",
    "golden_ratio",
    "rule_of_thirds",
    "centered_axis",
    "diagonal_tension",
    "frame_within_frame",
    "asymmetric_weight",
    "radial_burst",
  ] as CompositionPattern[],
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// § 2  SEEDED PRNG — Correct Mulberry32 implementation
// ─────────────────────────────────────────────────────────────────────────────
//
// FIXED BUG: Previous version wrote `this.state = t` where `t` is the output
// value — not the state accumulator. Mulberry32 works by incrementing a
// separate accumulator `a` on each call, then deriving the output `t` from `a`.
// The accumulator is the state; the output is NOT fed back into it.
// Reference: https://gist.github.com/tommyettinger/46a874533244883189143505d203312c

function strToSeed(s: string): number {
  const h = createHash("sha256").update(s).digest();
  // Combine 4 bytes into unsigned 32-bit integer
  return ((h[0]! << 24) | (h[1]! << 16) | (h[2]! << 8) | h[3]!) >>> 0;
}

class SeededRNG {
  private a: number; // accumulator (state) — incremented each call

  constructor(seed: string) {
    this.a = strToSeed(seed);
  }

  /** Returns float in [0, 1) using correct Mulberry32 algorithm */
  next(): number {
    // Increment accumulator (this IS the state update — NOT the output)
    this.a = (this.a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(this.a ^ (this.a >>> 15), 1 | this.a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) >>> 0;
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  }

  /** Returns integer in [0, n) */
  nextInt(n: number): number {
    if (n <= 0) return 0;
    return Math.floor(this.next() * n);
  }

  /**
   * Weighted random choice.
   * Uses strict `r < 0` comparison — avoids floating-point edge case where
   * r never reaches exactly 0.0, causing the last item to be unfairly favoured.
   */
  weightedChoice<T>(items: readonly T[], weights: number[]): T {
    const total = weights.reduce((a, b) => a + b, 0);
    let r = this.next() * total;
    for (let i = 0; i < items.length; i++) {
      r -= weights[i]!;
      if (r < 0) return items[i]!;
    }
    // Floating-point rounding guard — return last element
    return items[items.length - 1]!;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// § 3  PRIOR WEIGHT RESOLUTION
// ─────────────────────────────────────────────────────────────────────────────

function buildWeights(
  items: readonly string[],
  priorMap: Record<string, number> | undefined,
  temperature: number,
): number[] {
  const epsilon = 0.05; // minimum weight per arm (epsilon-greedy)
  const uniform = 1 / items.length;
  return items.map(item => {
    const prior   = priorMap?.[item] ?? uniform;
    const blended = temperature * uniform + (1 - temperature) * prior;
    return Math.max(blended, epsilon);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// § 4  FORMAT-AWARE GENE OVERRIDES
// ─────────────────────────────────────────────────────────────────────────────

function resolveLayoutFamily(format: string): string {
  const map: Record<string, string> = {
    instagram_post:     "ig_post",
    instagram_story:    "ig_story",
    youtube_thumbnail:  "yt_thumb",
    flyer:              "flyer",
    poster:             "poster",
    presentation_slide: "slide",
    business_card:      "business_card",
    resume:             "resume",
    logo:               "logo",
  };
  return map[format] ?? "ig_post";
}

function isMotionEligible(format: string, hookStrategy: HookStrategy): boolean {
  if (!GIF_ELIGIBLE_FORMATS.has(format)) return false;
  // These hooks don't benefit from motion
  const staticHooks: HookStrategy[] = ["negative_space", "texture_depth", "frame_within_frame"];
  return !staticHooks.includes(hookStrategy);
}

// ─────────────────────────────────────────────────────────────────────────────
// § 5  CONTEXT → GENE AFFINITY MULTIPLIERS
// ─────────────────────────────────────────────────────────────────────────────
//
// Returns multipliers in [0.5, 2.0] per gene option. Multiplied into prior
// weights before sampling to nudge selection based on upstream pipeline context.
// Uses correct ArchetypeId and StylePresetId values throughout.

function contextAffinities(
  context: ExplorePipelineContext,
  gene: keyof typeof GENOME_SPACE,
): Record<string, number> {
  const aff: Record<string, number> = {};

  if (gene === "hookStrategies") {
    if (context.imageProvided) {
      aff["visual_lead"]    = 1.8;
      aff["contrast_punch"] = 1.4;
    }
    const tone = context.tonePreference?.toLowerCase() ?? "";
    if (tone === "playful" || tone === "casual" || tone === "fun") {
      aff["pattern_interrupt"] = 1.6;
      aff["color_block"]       = 1.5;
    }
    if (tone === "professional" || tone === "corporate" || tone === "formal") {
      aff["bold_headline"]  = 1.6;
      aff["negative_space"] = 1.4;
    }
    if (tone === "urgent" || tone === "news") {
      aff["urgency_frame"] = 2.0;
      aff["bold_headline"] = 1.5;
    }
  }

  if (gene === "archetypes") {
    // Correct ARCHETYPE_IDs — all caps + underscores
    const tone = context.tonePreference?.toLowerCase() ?? "";
    if (context.brandPrefersDarkBg) {
      aff["CINEMATIC_DARK"]  = 1.5;
      aff["TECH_FUTURISTIC"] = 1.4;
      aff["LUXURY_PREMIUM"]  = 1.3;
    }
    if (tone === "playful" || tone === "casual" || tone === "fun") {
      aff["FUN_PLAYFUL"]  = 2.0;
      aff["KIDS_PLAYFUL"] = 1.5;
    }
    if (tone === "luxury" || tone === "premium" || tone === "elegant") {
      aff["LUXURY_PREMIUM"] = 2.0;
    }
    if (tone === "urgent" || tone === "news" || tone === "breaking") {
      aff["NEWS_URGENT"]      = 2.0;
      aff["AGGRESSIVE_POWER"] = 1.8;
    }
    if (tone === "professional" || tone === "corporate" || tone === "formal") {
      aff["AUTHORITY_EXPERT"] = 1.8;
      aff["MINIMAL_CLEAN"]    = 1.5;
    }
    if (context.imageProvided && context.faceDetected) {
      aff["FACE_CLOSEUP"]    = 1.8;
      aff["TRUST_FRIENDLY"]  = 1.4;
      aff["EMOTIONAL_STORY"] = 1.4;
    }
  }

  if (gene === "presets") {
    // Correct StylePresetIds — clean, bold, professional, minimal, expressive
    const tone = context.tonePreference?.toLowerCase() ?? "";
    if (context.brandPrefersDarkBg) {
      aff["bold"]       = 1.4;
      aff["expressive"] = 1.3;
    }
    if (tone === "professional" || tone === "corporate" || tone === "formal") {
      aff["professional"] = 2.0;
      aff["clean"]        = 1.6;
    }
    if (tone === "playful" || tone === "casual" || tone === "fun") {
      aff["expressive"] = 1.8;
      aff["bold"]       = 1.4;
    }
    if (tone === "luxury" || tone === "premium" || tone === "elegant") {
      aff["minimal"] = 1.6;
      aff["clean"]   = 1.4;
    }
  }

  if (gene === "densityProfiles") {
    const count = context.densityTextBlockCount;
    if (count !== undefined) {
      if (count <= 2) {
        aff["sparse"]   = 2.0;
        aff["balanced"] = 1.4;
      } else if (count >= 5) {
        aff["rich"]  = 1.8;
        aff["dense"] = 1.6;
      }
    }
  }

  return aff;
}

function applyAffinities(
  weights: number[],
  items: readonly string[],
  affinities: Record<string, number>,
): number[] {
  return weights.map((w, i) => w * (affinities[items[i]!] ?? 1.0));
}

// ─────────────────────────────────────────────────────────────────────────────
// § 6  GENOME BUILDER
// ─────────────────────────────────────────────────────────────────────────────

export function buildGenome(
  masterSeed: string,
  generationIndex: number,
  format: string,
  context: ExplorePipelineContext,
  priors?: ExplorationPriors,
): DesignGenome {
  // Per-candidate deterministic seed
  const candidateSeed = createHash("sha256")
    .update(`${masterSeed}:${generationIndex}`)
    .digest("hex");

  const rng  = new SeededRNG(candidateSeed);
  const temp = priors?.explorationTemperature ?? 0.7;

  // Gene 1: Layout Family — fully determined by format
  const layoutFamily = resolveLayoutFamily(format);

  // Gene 2: Variation ID
  const variationPool = GENOME_SPACE.variationIds[layoutFamily] ?? ["v1_default"];
  const variationId   = variationPool[rng.nextInt(variationPool.length)]!;

  // Gene 3: Archetype (correct ArchetypeId values)
  const archetypeW = applyAffinities(
    buildWeights(GENOME_SPACE.archetypes, priors?.archetypeWeights, temp),
    GENOME_SPACE.archetypes,
    contextAffinities(context, "archetypes"),
  );
  const archetype = rng.weightedChoice(GENOME_SPACE.archetypes, archetypeW);

  // Gene 4: Style Preset (correct StylePresetId values)
  const presetW = applyAffinities(
    buildWeights(GENOME_SPACE.presets, priors?.presetWeights, temp),
    GENOME_SPACE.presets,
    contextAffinities(context, "presets"),
  );
  const preset = rng.weightedChoice(GENOME_SPACE.presets, presetW);

  // Gene 5: Typography Personality
  const typographyPersonality = GENOME_SPACE.typographyPersonalities[rng.nextInt(5)]!;

  // Gene 6: Density Profile
  const densityW = applyAffinities(
    buildWeights(GENOME_SPACE.densityProfiles, priors?.densityProfileWeights, temp),
    GENOME_SPACE.densityProfiles,
    contextAffinities(context, "densityProfiles"),
  );
  const densityProfile = rng.weightedChoice(GENOME_SPACE.densityProfiles, densityW) as DensityProfileLevel;

  // Gene 7: Hook Strategy
  const hookW = applyAffinities(
    buildWeights(GENOME_SPACE.hookStrategies, priors?.hookStrategyWeights, temp),
    GENOME_SPACE.hookStrategies,
    contextAffinities(context, "hookStrategies"),
  );
  const hookStrategy = rng.weightedChoice(GENOME_SPACE.hookStrategies, hookW) as HookStrategy;

  // Gene 8: Composition Pattern
  const compositionW = buildWeights(GENOME_SPACE.compositionPatterns, priors?.compositionPatternWeights, temp);
  const compositionPattern = rng.weightedChoice(GENOME_SPACE.compositionPatterns, compositionW) as CompositionPattern;

  // Gene 9: Motion Eligibility — deterministic from format + hookStrategy
  const motionEligible = isMotionEligible(format, hookStrategy);

  return {
    layoutFamily,
    variationId,
    archetype,
    preset,
    typographyPersonality,
    densityProfile,
    hookStrategy,
    compositionPattern,
    motionEligible,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// § 7  CANDIDATE BUILDER
// ─────────────────────────────────────────────────────────────────────────────

function deriveCandidateId(seed: string, generationIndex: number): string {
  return createHash("sha256")
    .update(`candidate:${seed}:${generationIndex}`)
    .digest("hex")
    .slice(0, 32);
}

function resolveLayoutCategory(layoutFamily: string): ArkiolLayoutCategory {
  const map: Record<string, ArkiolLayoutCategory> = {
    ig_post:       "instagram",
    ig_story:      "story",
    yt_thumb:      "thumbnail",
    flyer:         "flyer",
    poster:        "poster",
    slide:         "slide",
    business_card: "card",
    resume:        "document",
    logo:          "logo",
  };
  return map[layoutFamily] ?? "instagram";
}

export function buildCandidate(
  masterSeed: string,
  generationIndex: number,
  format: string,
  context: ExplorePipelineContext,
  priors?: ExplorationPriors,
): CandidateDesignPlan {
  const genome = buildGenome(masterSeed, generationIndex, format, context, priors);
  return {
    candidateId:       deriveCandidateId(masterSeed, generationIndex),
    seed:              masterSeed,
    genome,
    generationIndex,
    format,
    layoutCategory:    resolveLayoutCategory(genome.layoutFamily),
    constraintsPassed: false, // set by constraint module
    repairLog:         [],
    generatedAt:       new Date().toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// § 8  POOL GENERATOR
// ─────────────────────────────────────────────────────────────────────────────

export interface GenomePoolOptions {
  masterSeed: string;
  format:     string;
  poolSize:   number;
  context:    ExplorePipelineContext;
  priors?:    ExplorationPriors;
}

export interface GenomePoolResult {
  candidates:   CandidateDesignPlan[];
  generationMs: number;
  masterSeed:   string;
  format:       string;
  poolSize:     number;
}

export function generateGenomePool(opts: GenomePoolOptions): GenomePoolResult {
  const t0 = Date.now();
  const candidates: CandidateDesignPlan[] = [];

  for (let i = 0; i < opts.poolSize; i++) {
    candidates.push(buildCandidate(opts.masterSeed, i, opts.format, opts.context, opts.priors));
  }

  return {
    candidates,
    generationMs: Date.now() - t0,
    masterSeed:   opts.masterSeed,
    format:       opts.format,
    poolSize:     opts.poolSize,
  };
}
