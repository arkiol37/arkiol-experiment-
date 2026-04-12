// src/engines/platform/intelligence.ts
// Platform Intelligence Engine
// ─────────────────────────────────────────────────────────────────────────────
//
// Provides platform-specific composition rules, safe zone definitions,
// readability constraints, and format-aware scoring adjustments for every
// major design platform.
//
// Supported platforms:
//   • YouTube (thumbnail, shorts)
//   • Instagram (post, story, reel)
//   • TikTok (ad, video cover)
//   • LinkedIn (post, banner, article)
//   • Twitter/X (post, header)
//   • Facebook (post, ad, cover)
//   • Google Display Ads (leaderboard, rectangle, skyscraper)
//   • Print (flyer, poster, business card)
//   • Presentation (slide, pitch deck)
//
// Execution contract:
//   ✓ Every platform rule is deterministic — no randomness
//   ✓ getPlatformRules() always returns a valid PlatformRules object
//   ✓ scorePlatformCompliance() returns a normalised [0, 1] score
//   ✓ All rules are purely functional — no side effects

import type { DesignGenome, EvaluationScores } from "../exploration/types";
import type { ArkiolLayoutCategory } from "../layout/families";

// ─────────────────────────────────────────────────────────────────────────────
// § 1  TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface SafeZone {
  /** Distance from edge as fraction of dimension [0, 0.5] */
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export type TextSizeGuide = {
  headlineMinPx: number;
  bodyMinPx: number;
  /** Maximum lines of body text before truncation is expected */
  maxBodyLines: number;
  /** Whether text must be on a solid/semi-opaque background */
  requiresTextBackground: boolean;
};

export type CompositionBias =
  | "face_right"        // Face/subject pushed to right; text on left
  | "face_left"         // Face/subject pushed to left; text on right
  | "top_text"          // Text block at top of frame
  | "bottom_text"       // Text block at bottom of frame
  | "center_dominant"   // Central focal point
  | "left_heavy"        // Visual weight skewed left
  | "right_heavy"       // Visual weight skewed right
  | "full_bleed"        // Image fills entire canvas, text overlaid
  | "asymmetric_weight"; // Deliberate asymmetric visual weight distribution

export interface PlatformRules {
  platformId: string;
  platformName: string;
  /** Canonical dimensions in pixels */
  dimensions: { width: number; height: number };
  /** Safe zone — keep important content inside these bounds */
  safeZone: SafeZone;
  /** Typography guidelines */
  textGuide: TextSizeGuide;
  /** Preferred composition biases for this platform */
  preferredCompositions: CompositionBias[];
  /** Whether this platform commonly crops thumbnails (affects face safe-zone) */
  usesFaceCropping: boolean;
  /** Maximum recommended text coverage as fraction of canvas */
  maxTextCoverageRatio: number;
  /** Whether bold/high contrast is critical for discoverability */
  requiresHighContrast: boolean;
  /** Platforms that display at small sizes — text must be very legible */
  isSmallDisplayContext: boolean;
  /** Hook strategies that perform well on this platform */
  effectiveHooks: string[];
  /** Archetypes that perform well on this platform */
  effectiveArchetypes: string[];
  /** Platform-specific quality notes (shown in diagnostics) */
  qualityNotes: string[];
}

export interface PlatformComplianceScore {
  overall: number;
  textLegibility: number;
  compositionAlignment: number;
  safeZoneCompliance: number;
  hookEffectiveness: number;
  violations: string[];
  recommendations: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// § 2  PLATFORM RULES DATABASE
// ─────────────────────────────────────────────────────────────────────────────

const PLATFORM_RULES_MAP: Record<string, PlatformRules> = {

  // ── YouTube ─────────────────────────────────────────────────────────────
  youtube_thumbnail: {
    platformId: "youtube_thumbnail",
    platformName: "YouTube Thumbnail",
    dimensions: { width: 1280, height: 720 },
    safeZone: { top: 0.04, bottom: 0.04, left: 0.04, right: 0.04 },
    textGuide: {
      headlineMinPx: 72,
      bodyMinPx: 36,
      maxBodyLines: 2,
      requiresTextBackground: false,
    },
    preferredCompositions: ["face_right", "face_left", "left_heavy"],
    usesFaceCropping: true,
    maxTextCoverageRatio: 0.35,
    requiresHighContrast: true,
    isSmallDisplayContext: true,
    effectiveHooks: ["bold_headline", "contrast_punch", "visual_lead", "color_block"],
    effectiveArchetypes: [
      "AGGRESSIVE_POWER", "CURIOSITY_MYSTERY", "BOLD_CLAIM",
      "FACE_CLOSEUP", "NEWS_URGENT", "COMPARISON_VS",
    ],
    qualityNotes: [
      "Thumbnails render at ~168×94px in search — keep text extremely large",
      "Face + text split (60/40) consistently outperforms text-only",
      "High saturation and contrast outperform pastel/muted palettes",
      "Avoid cluttered backgrounds; keep subject isolated or blurred",
    ],
  },

  youtube_shorts: {
    platformId: "youtube_shorts",
    platformName: "YouTube Shorts Cover",
    dimensions: { width: 1080, height: 1920 },
    safeZone: { top: 0.15, bottom: 0.20, left: 0.06, right: 0.06 },
    textGuide: {
      headlineMinPx: 80,
      bodyMinPx: 40,
      maxBodyLines: 3,
      requiresTextBackground: true,
    },
    preferredCompositions: ["center_dominant", "top_text", "bottom_text"],
    usesFaceCropping: false,
    maxTextCoverageRatio: 0.30,
    requiresHighContrast: true,
    isSmallDisplayContext: true,
    effectiveHooks: ["bold_headline", "visual_lead", "sequential_reveal"],
    effectiveArchetypes: [
      "BOLD_CLAIM", "FUN_PLAYFUL", "KIDS_PLAYFUL", "EMOTIONAL_STORY",
    ],
    qualityNotes: [
      "UI overlays cover top 15% and bottom 20% — respect safe zones",
      "Full-bleed vertical image with text overlay performs best",
    ],
  },

  // ── Instagram ────────────────────────────────────────────────────────────
  instagram_post: {
    platformId: "instagram_post",
    platformName: "Instagram Post",
    dimensions: { width: 1080, height: 1080 },
    safeZone: { top: 0.05, bottom: 0.05, left: 0.05, right: 0.05 },
    textGuide: {
      headlineMinPx: 60,
      bodyMinPx: 28,
      maxBodyLines: 4,
      requiresTextBackground: false,
    },
    preferredCompositions: ["center_dominant", "full_bleed", "asymmetric_weight"],
    usesFaceCropping: false,
    maxTextCoverageRatio: 0.40,
    requiresHighContrast: false,
    isSmallDisplayContext: true,
    effectiveHooks: ["negative_space", "color_block", "texture_depth", "visual_lead"],
    effectiveArchetypes: [
      "MINIMAL_CLEAN", "LUXURY_PREMIUM", "MUSIC_ARTISTIC",
      "EMOTIONAL_STORY", "PRODUCT_FOCUS",
    ],
    qualityNotes: [
      "Feed images display at 293×293px — mid-size; moderate text legibility",
      "Aesthetic cohesion with feed matters more than clickbait on Instagram",
      "Avoid more than 20% text coverage to prevent reach reduction",
    ],
  },

  instagram_story: {
    platformId: "instagram_story",
    platformName: "Instagram Story",
    dimensions: { width: 1080, height: 1920 },
    safeZone: { top: 0.14, bottom: 0.20, left: 0.06, right: 0.06 },
    textGuide: {
      headlineMinPx: 80,
      bodyMinPx: 40,
      maxBodyLines: 4,
      requiresTextBackground: false,
    },
    preferredCompositions: ["center_dominant", "top_text", "bottom_text"],
    usesFaceCropping: false,
    maxTextCoverageRatio: 0.50,
    requiresHighContrast: false,
    isSmallDisplayContext: false,
    effectiveHooks: ["bold_headline", "sequential_reveal", "urgency_frame"],
    effectiveArchetypes: [
      "BOLD_CLAIM", "TRUST_FRIENDLY", "FUN_PLAYFUL",
      "EMOTIONAL_STORY", "LUXURY_PREMIUM",
    ],
    qualityNotes: [
      "Profile name and icons occupy top ~14% — stay clear",
      "Reply bar occupies bottom ~20% — keep CTAs above this zone",
      "Full-bleed imagery with semi-transparent text backgrounds converts well",
    ],
  },

  // ── TikTok ───────────────────────────────────────────────────────────────
  tiktok_ad: {
    platformId: "tiktok_ad",
    platformName: "TikTok Ad Cover",
    dimensions: { width: 1080, height: 1920 },
    safeZone: { top: 0.10, bottom: 0.25, left: 0.04, right: 0.04 },
    textGuide: {
      headlineMinPx: 80,
      bodyMinPx: 40,
      maxBodyLines: 3,
      requiresTextBackground: true,
    },
    preferredCompositions: ["center_dominant", "full_bleed", "bottom_text"],
    usesFaceCropping: false,
    maxTextCoverageRatio: 0.35,
    requiresHighContrast: true,
    isSmallDisplayContext: false,
    effectiveHooks: ["bold_headline", "visual_lead", "pattern_interrupt", "urgency_frame"],
    effectiveArchetypes: [
      "FUN_PLAYFUL", "BOLD_CLAIM", "KIDS_PLAYFUL",
      "SPORTS_ACTION", "EMOTIONAL_STORY",
    ],
    qualityNotes: [
      "TikTok UI covers bottom ~25% on mobile — critical safe zone",
      "Fast-paced platform favours high energy and immediate visual hooks",
      "Native-feeling content outperforms polished ads; keep it raw",
    ],
  },

  // ── LinkedIn ─────────────────────────────────────────────────────────────
  linkedin_post: {
    platformId: "linkedin_post",
    platformName: "LinkedIn Post",
    dimensions: { width: 1200, height: 627 },
    safeZone: { top: 0.06, bottom: 0.06, left: 0.06, right: 0.06 },
    textGuide: {
      headlineMinPx: 52,
      bodyMinPx: 24,
      maxBodyLines: 4,
      requiresTextBackground: false,
    },
    preferredCompositions: ["left_heavy", "center_dominant", "top_text"],
    usesFaceCropping: false,
    maxTextCoverageRatio: 0.50,
    requiresHighContrast: false,
    isSmallDisplayContext: true,
    effectiveHooks: ["bold_headline", "social_proof", "contrast_punch", "color_block"],
    effectiveArchetypes: [
      "AUTHORITY_EXPERT", "TRUST_FRIENDLY", "EDUCATIONAL_EXPLAINER",
      "PROFESSIONAL", "BOLD_CLAIM",
    ],
    qualityNotes: [
      "Professional audience — avoid hyper-casual or clickbait aesthetics",
      "Data visualisations and quote cards perform extremely well",
      "Blue + white or dark navy consistently outperforms other palettes",
    ],
  },

  linkedin_banner: {
    platformId: "linkedin_banner",
    platformName: "LinkedIn Company Banner",
    dimensions: { width: 1128, height: 191 },
    safeZone: { top: 0.10, bottom: 0.10, left: 0.05, right: 0.05 },
    textGuide: {
      headlineMinPx: 32,
      bodyMinPx: 18,
      maxBodyLines: 2,
      requiresTextBackground: false,
    },
    preferredCompositions: ["left_heavy", "full_bleed"],
    usesFaceCropping: false,
    maxTextCoverageRatio: 0.45,
    requiresHighContrast: false,
    isSmallDisplayContext: true,
    effectiveHooks: ["bold_headline", "color_block"],
    effectiveArchetypes: ["AUTHORITY_EXPERT", "TRUST_FRIENDLY"],
    qualityNotes: [
      "Extremely wide aspect ratio — horizontal layouts only",
      "Profile photo overlaps bottom-left — keep important content away",
    ],
  },

  // ── Twitter/X ────────────────────────────────────────────────────────────
  twitter_post: {
    platformId: "twitter_post",
    platformName: "Twitter/X Post",
    dimensions: { width: 1200, height: 675 },
    safeZone: { top: 0.05, bottom: 0.05, left: 0.05, right: 0.05 },
    textGuide: {
      headlineMinPx: 56,
      bodyMinPx: 26,
      maxBodyLines: 3,
      requiresTextBackground: false,
    },
    preferredCompositions: ["left_heavy", "center_dominant", "full_bleed"],
    usesFaceCropping: false,
    maxTextCoverageRatio: 0.50,
    requiresHighContrast: true,
    isSmallDisplayContext: true,
    effectiveHooks: ["bold_headline", "contrast_punch", "pattern_interrupt"],
    effectiveArchetypes: [
      "NEWS_URGENT", "BOLD_CLAIM", "CURIOSITY_MYSTERY",
      "COMPARISON_VS", "AUTHORITY_EXPERT",
    ],
    qualityNotes: [
      "Fast-scroll context — visual hook must land in <0.5 seconds",
      "Strong opinions and controversial takes drive engagement",
      "Dark backgrounds with white text perform consistently",
    ],
  },

  // ── Facebook ─────────────────────────────────────────────────────────────
  facebook_ad: {
    platformId: "facebook_ad",
    platformName: "Facebook Ad",
    dimensions: { width: 1200, height: 628 },
    safeZone: { top: 0.05, bottom: 0.05, left: 0.05, right: 0.05 },
    textGuide: {
      headlineMinPx: 52,
      bodyMinPx: 22,
      maxBodyLines: 3,
      requiresTextBackground: false,
    },
    preferredCompositions: ["left_heavy", "center_dominant", "full_bleed"],
    usesFaceCropping: false,
    maxTextCoverageRatio: 0.30,
    requiresHighContrast: false,
    isSmallDisplayContext: true,
    effectiveHooks: ["visual_lead", "social_proof", "urgency_frame", "color_block"],
    effectiveArchetypes: [
      "TRUST_FRIENDLY", "PRODUCT_FOCUS", "BOLD_CLAIM",
      "EMOTIONAL_STORY", "COMPARISON_VS",
    ],
    qualityNotes: [
      "Facebook penalises ads with >20% text coverage in reach",
      "Lifestyle imagery + single CTA outperforms product-only shots",
      "Warm colours (orange, red) drive higher CTR in most categories",
    ],
  },

  // ── Google Display ───────────────────────────────────────────────────────
  google_leaderboard: {
    platformId: "google_leaderboard",
    platformName: "Google Display Leaderboard",
    dimensions: { width: 728, height: 90 },
    safeZone: { top: 0.08, bottom: 0.08, left: 0.03, right: 0.03 },
    textGuide: {
      headlineMinPx: 18,
      bodyMinPx: 12,
      maxBodyLines: 1,
      requiresTextBackground: false,
    },
    preferredCompositions: ["left_heavy", "right_heavy"],
    usesFaceCropping: false,
    maxTextCoverageRatio: 0.60,
    requiresHighContrast: true,
    isSmallDisplayContext: true,
    effectiveHooks: ["bold_headline", "urgency_frame", "color_block"],
    effectiveArchetypes: ["BOLD_CLAIM", "TRUST_FRIENDLY", "NEWS_URGENT"],
    qualityNotes: [
      "Extreme horizontal aspect — logo left, CTA right pattern dominates",
      "Single benefit + CTA only — no room for body text",
    ],
  },

  google_display_rectangle: {
    platformId: "google_display_rectangle",
    platformName: "Google Display Medium Rectangle",
    dimensions: { width: 300, height: 250 },
    safeZone: { top: 0.05, bottom: 0.05, left: 0.05, right: 0.05 },
    textGuide: {
      headlineMinPx: 24,
      bodyMinPx: 14,
      maxBodyLines: 2,
      requiresTextBackground: false,
    },
    preferredCompositions: ["center_dominant", "top_text", "bottom_text"],
    usesFaceCropping: false,
    maxTextCoverageRatio: 0.50,
    requiresHighContrast: true,
    isSmallDisplayContext: true,
    effectiveHooks: ["bold_headline", "urgency_frame", "visual_lead"],
    effectiveArchetypes: ["BOLD_CLAIM", "PRODUCT_FOCUS", "TRUST_FRIENDLY"],
    qualityNotes: [
      "Most common display ad size — highest competition for attention",
      "Single clear message + branded CTA button drives conversions",
    ],
  },

  // ── Print / Flyer ────────────────────────────────────────────────────────
  flyer_a4: {
    platformId: "flyer_a4",
    platformName: "Flyer / Poster (A4)",
    dimensions: { width: 2480, height: 3508 },
    safeZone: { top: 0.03, bottom: 0.03, left: 0.03, right: 0.03 },
    textGuide: {
      headlineMinPx: 120,
      bodyMinPx: 48,
      maxBodyLines: 12,
      requiresTextBackground: false,
    },
    preferredCompositions: ["center_dominant", "top_text", "full_bleed"],
    usesFaceCropping: false,
    maxTextCoverageRatio: 0.70,
    requiresHighContrast: false,
    isSmallDisplayContext: false,
    effectiveHooks: ["bold_headline", "visual_lead", "color_block", "texture_depth"],
    effectiveArchetypes: [
      "BOLD_CLAIM", "MUSIC_ARTISTIC", "LUXURY_PREMIUM",
      "TRUST_FRIENDLY", "SPORTS_ACTION",
    ],
    qualityNotes: [
      "Print bleeds — use full safe-zone coverage; design beyond canvas edges",
      "CMYK colour accuracy matters — avoid pure digital RGB",
      "Hierarchy: headline reads at arm's length; body at reading distance",
    ],
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// § 3  FORMAT-TO-PLATFORM MAPPING
// ─────────────────────────────────────────────────────────────────────────────

const FORMAT_TO_PLATFORM: Record<string, string> = {
  youtube_thumbnail:          "youtube_thumbnail",
  youtube_shorts:             "youtube_shorts",
  instagram_post:             "instagram_post",
  instagram_story:            "instagram_story",
  tiktok_ad:                  "tiktok_ad",
  tiktok_cover:               "tiktok_ad",
  linkedin_post:              "linkedin_post",
  linkedin_banner:            "linkedin_banner",
  twitter_post:               "twitter_post",
  twitter_header:             "twitter_post",
  facebook_ad:                "facebook_ad",
  facebook_post:              "facebook_ad",
  google_leaderboard:         "google_leaderboard",
  google_display_rectangle:   "google_display_rectangle",
  flyer:                      "flyer_a4",
  poster:                     "flyer_a4",
  ig_post:                    "instagram_post",
  ig_story:                   "instagram_story",
  yt_thumb:                   "youtube_thumbnail",
  business_card:              "flyer_a4",
};

// Fallback rules for unknown formats
const FALLBACK_RULES: PlatformRules = {
  platformId: "generic",
  platformName: "Generic Format",
  dimensions: { width: 1200, height: 628 },
  safeZone: { top: 0.05, bottom: 0.05, left: 0.05, right: 0.05 },
  textGuide: {
    headlineMinPx: 48,
    bodyMinPx: 24,
    maxBodyLines: 4,
    requiresTextBackground: false,
  },
  preferredCompositions: ["center_dominant", "left_heavy"],
  usesFaceCropping: false,
  maxTextCoverageRatio: 0.50,
  requiresHighContrast: false,
  isSmallDisplayContext: false,
  effectiveHooks: ["bold_headline", "visual_lead", "color_block"],
  effectiveArchetypes: [],
  qualityNotes: [],
};

// ─────────────────────────────────────────────────────────────────────────────
// § 4  PUBLIC API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns platform rules for a given format string.
 * Always returns a valid object — never throws.
 */
export function getPlatformRules(format: string): PlatformRules {
  const platformId = FORMAT_TO_PLATFORM[format] ?? format;
  return PLATFORM_RULES_MAP[platformId] ?? FALLBACK_RULES;
}

/**
 * Scores how well a design genome complies with platform-specific rules.
 * Returns a normalised [0, 1] score with detailed violation reporting.
 */
export function scorePlatformCompliance(
  genome: DesignGenome,
  format: string,
  existingScores?: Partial<EvaluationScores>
): PlatformComplianceScore {
  const rules = getPlatformRules(format);
  const violations: string[] = [];
  const recommendations: string[] = [];

  // ── Composition alignment score ───────────────────────────────────────────
  const compositionMap: Record<string, CompositionBias[]> = {
    z_flow:            ["left_heavy", "top_text"],
    f_flow:            ["left_heavy", "top_text"],
    golden_ratio:      ["face_right", "face_left", "asymmetric_weight"],
    rule_of_thirds:    ["face_right", "face_left", "left_heavy"],
    centered_axis:     ["center_dominant"],
    diagonal_tension:  ["asymmetric_weight"],
    frame_within_frame:["center_dominant"],
    asymmetric_weight: ["asymmetric_weight", "left_heavy"],
    radial_burst:      ["center_dominant"],
  };

  const genomeBiases = compositionMap[genome.compositionPattern] ?? ["center_dominant"];
  const compositionMatch = genomeBiases.some(b => rules.preferredCompositions.includes(b));
  const compositionScore = compositionMatch ? 1.0 : 0.5;
  if (!compositionMatch) {
    recommendations.push(
      `Platform "${rules.platformName}" prefers ${rules.preferredCompositions.slice(0, 2).join(" or ")} compositions`
    );
  }

  // ── Hook effectiveness score ──────────────────────────────────────────────
  const hookEffectiveScore = rules.effectiveHooks.includes(genome.hookStrategy) ? 1.0 : 0.55;
  if (!rules.effectiveHooks.includes(genome.hookStrategy)) {
    recommendations.push(
      `Hook "${genome.hookStrategy}" underperforms on ${rules.platformName}; consider ${rules.effectiveHooks[0]}`
    );
  }

  // ── Archetype effectiveness score ─────────────────────────────────────────
  const archetypeScore = rules.effectiveArchetypes.length === 0
    ? 0.75
    : rules.effectiveArchetypes.includes(genome.archetype) ? 1.0 : 0.6;
  if (rules.effectiveArchetypes.length > 0 && !rules.effectiveArchetypes.includes(genome.archetype)) {
    recommendations.push(
      `Archetype "${genome.archetype}" may underperform — try ${rules.effectiveArchetypes[0]}`
    );
  }

  // ── Text legibility score ──────────────────────────────────────────────────
  const densityScoreMap: Record<string, number> = { sparse: 1.0, balanced: 0.9, rich: 0.7, dense: 0.45 };
  let textLegibility = densityScoreMap[genome.densityProfile] ?? 0.7;
  if (rules.isSmallDisplayContext && genome.densityProfile === "dense") {
    violations.push(`Dense content overloads small display context (${rules.platformName})`);
    textLegibility = 0.3;
  }

  // ── Safe zone compliance ──────────────────────────────────────────────────
  // Without full render context, estimate from density and composition
  const safeZoneScore = genome.densityProfile === "sparse" || genome.densityProfile === "balanced"
    ? 0.90 : 0.70;

  // ── High contrast requirement ─────────────────────────────────────────────
  const contrastReqScore = rules.requiresHighContrast
    ? (genome.hookStrategy === "contrast_punch" || genome.hookStrategy === "color_block" ? 1.0 : 0.75)
    : 1.0;
  if (rules.requiresHighContrast && contrastReqScore < 1.0) {
    recommendations.push(`${rules.platformName} requires high contrast — consider "contrast_punch" hook`);
  }

  // ── Motion eligibility check ──────────────────────────────────────────────
  // For very small display formats, motion adds little value
  if (genome.motionEligible && rules.isSmallDisplayContext && format.includes("leaderboard")) {
    recommendations.push("Motion GIF has low impact on banner ads; consider static version");
  }

  // ── Aggregate score ───────────────────────────────────────────────────────
  const weights = { composition: 0.25, hook: 0.25, text: 0.20, safeZone: 0.15, archetype: 0.15 };
  const overall =
    compositionScore   * weights.composition +
    hookEffectiveScore * weights.hook +
    textLegibility     * weights.text +
    safeZoneScore      * weights.safeZone +
    archetypeScore     * weights.archetype;

  return {
    overall:              Math.min(1, Math.max(0, overall)),
    textLegibility:       Math.min(1, textLegibility * contrastReqScore),
    compositionAlignment: compositionScore,
    safeZoneCompliance:   safeZoneScore,
    hookEffectiveness:    hookEffectiveScore,
    violations,
    recommendations,
  };
}

/**
 * Returns a list of all supported platform IDs.
 */
export function getSupportedPlatforms(): string[] {
  return Object.keys(PLATFORM_RULES_MAP);
}

/**
 * Returns platform-specific prompt additions to guide AI content generation.
 */
export function buildPlatformPromptContext(format: string): string {
  const rules = getPlatformRules(format);
  const parts: string[] = [
    `Platform: ${rules.platformName}`,
    `Canvas: ${rules.dimensions.width}×${rules.dimensions.height}px`,
    `Text minimum: headline ${rules.textGuide.headlineMinPx}px, body ${rules.textGuide.bodyMinPx}px`,
    `Max body lines: ${rules.textGuide.maxBodyLines}`,
    `Max text coverage: ${Math.round(rules.maxTextCoverageRatio * 100)}%`,
  ];
  if (rules.requiresHighContrast) parts.push("High contrast is critical for discoverability");
  if (rules.isSmallDisplayContext) parts.push("Content renders small — prioritise extreme legibility");
  if (rules.qualityNotes.length > 0) parts.push(`Notes: ${rules.qualityNotes[0]}`);
  return parts.join(". ");
}
