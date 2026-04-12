// src/engines/campaign/creative-director.ts
// Campaign Creative Director AI
// ─────────────────────────────────────────────────────────────────────────────
//
// Generates coherent multi-design campaigns from a single prompt, producing
// ads, social posts, thumbnails and banners with consistent visual identity.
//
// Architecture:
//   1. CampaignBriefAnalyzer  — extract campaign strategy from prompt
//   2. VisualIdentityPlanner  — define shared identity system (palette, type, tone)
//   3. FormatPlanner          — select which formats to generate and their roles
//   4. CohesionEnforcer       — ensures all formats share the same visual DNA
//   5. CampaignAssembler      — builds the final CampaignPlan
//
// Execution contract:
//   ✓ Same prompt + brandId + seed always produces the same CampaignPlan
//   ✓ All generated formats share identical colour palette and tone
//   ✓ Every format plan is schema-valid and ready to feed into generation pipeline
//   ✓ Engine never throws — deterministic fallbacks for every stage

import { createHash } from "crypto";
import type { DesignGenome } from "../exploration/types";
import type { ArkiolLayoutCategory } from "../layout/families";

// ─────────────────────────────────────────────────────────────────────────────
// § 1  TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type CampaignObjective =
  | "awareness"       // Brand visibility, reach
  | "engagement"      // Likes, shares, comments
  | "conversion"      // Clicks, purchases, sign-ups
  | "retention"       // Loyalty, re-engagement
  | "announcement";   // Launch, news, event

export type CampaignTone =
  | "urgent"
  | "inspirational"
  | "educational"
  | "playful"
  | "premium"
  | "authoritative"
  | "friendly"
  | "mysterious";

export interface VisualIdentity {
  /** Primary campaign colour */
  primaryColor: string;
  /** Secondary/accent colour */
  accentColor: string;
  /** Background colour for light-mode formats */
  bgLight: string;
  /** Background colour for dark-mode formats */
  bgDark: string;
  /** Typography personality (0-4) applied across all formats */
  typographyPersonality: 0 | 1 | 2 | 3 | 4;
  /** Campaign tone (drives copy direction) */
  tone: CampaignTone;
  /** Campaign headline (used as base across all formats) */
  headline: string;
  /** Sub-message (shorter for small formats) */
  subMessage: string;
  /** CTA text */
  ctaText: string;
  /** Composition style — shared across all formats */
  compositionPattern: DesignGenome["compositionPattern"];
  /** Hook strategy — shared across all formats */
  hookStrategy: DesignGenome["hookStrategy"];
}

export interface CampaignFormatPlan {
  format: string;
  role: "hero" | "supporting" | "cta" | "awareness";
  /** Platform this format targets */
  platform: string;
  /** Adapted headline for this format size */
  headline: string;
  /** Adapted sub-message */
  subMessage: string;
  /** CTA text (may be empty for awareness formats) */
  ctaText: string;
  /** Whether to include motion (GIF) for this format */
  includeMotion: boolean;
  /** Override archetype for this specific format */
  archetypeId: string;
  /** Override preset for this specific format */
  presetId: string;
  /** Priority order for generation */
  generationPriority: number;
}

export interface CampaignPlan {
  campaignId: string;
  seed: string;
  prompt: string;
  objective: CampaignObjective;
  identity: VisualIdentity;
  formats: CampaignFormatPlan[];
  /** Shared prompt context injected into every format's generation */
  sharedPromptContext: string;
  /** Total estimated credit cost */
  estimatedCredits: number;
  /** Generation order for the worker */
  generationOrder: string[];
  createdAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// § 2  CAMPAIGN OBJECTIVE DETECTION
// ─────────────────────────────────────────────────────────────────────────────

const OBJECTIVE_SIGNALS: Record<CampaignObjective, string[]> = {
  awareness:    ["launch", "introduce", "announce brand", "awareness", "visibility", "reach", "new"],
  engagement:   ["engage", "viral", "share", "community", "conversation", "trending"],
  conversion:   ["buy", "sale", "discount", "offer", "limited", "cta", "click", "sign up", "convert", "purchase"],
  retention:    ["loyalty", "thank you", "reward", "exclusive", "member", "returning", "vip"],
  announcement: ["announce", "launch", "event", "webinar", "release", "coming soon", "introducing"],
};

function detectObjective(prompt: string): CampaignObjective {
  const lower = prompt.toLowerCase();
  let best: CampaignObjective = "awareness";
  let bestScore = 0;

  for (const [obj, signals] of Object.entries(OBJECTIVE_SIGNALS)) {
    const score = signals.filter(s => lower.includes(s)).length;
    if (score > bestScore) {
      bestScore = score;
      best = obj as CampaignObjective;
    }
  }
  return best;
}

// ─────────────────────────────────────────────────────────────────────────────
// § 3  TONE DETECTION
// ─────────────────────────────────────────────────────────────────────────────

const TONE_SIGNALS: Record<CampaignTone, string[]> = {
  urgent:        ["urgent", "limited", "now", "fast", "last chance", "deadline", "hurry"],
  inspirational: ["inspire", "dream", "achieve", "transform", "believe", "success", "journey"],
  educational:   ["learn", "tips", "guide", "how to", "discover", "understand", "tutorial"],
  playful:       ["fun", "playful", "exciting", "enjoy", "celebrate", "party", "vibrant"],
  premium:       ["luxury", "premium", "exclusive", "elite", "premium", "sophisticated", "refined"],
  authoritative: ["expert", "proven", "trusted", "certified", "authority", "industry leading"],
  friendly:      ["friendly", "warm", "welcome", "community", "together", "join us", "easy"],
  mysterious:    ["secret", "reveal", "discover", "mystery", "hidden", "exclusive preview"],
};

function detectTone(prompt: string, objective: CampaignObjective): CampaignTone {
  const lower = prompt.toLowerCase();
  let best: CampaignTone = "friendly";
  let bestScore = 0;

  for (const [tone, signals] of Object.entries(TONE_SIGNALS)) {
    const score = signals.filter(s => lower.includes(s)).length;
    if (score > bestScore) {
      bestScore = score;
      best = tone as CampaignTone;
    }
  }

  // Objective-based defaults when no strong signal
  if (bestScore === 0) {
    const defaults: Record<CampaignObjective, CampaignTone> = {
      awareness:    "friendly",
      engagement:   "playful",
      conversion:   "urgent",
      retention:    "friendly",
      announcement: "inspirational",
    };
    return defaults[objective];
  }

  return best;
}

// ─────────────────────────────────────────────────────────────────────────────
// § 4  VISUAL IDENTITY BUILDER
// ─────────────────────────────────────────────────────────────────────────────

const TONE_PALETTES: Record<CampaignTone, { primary: string; accent: string; bgLight: string; bgDark: string }> = {
  urgent:        { primary: "#e63946", accent: "#ffb703", bgLight: "#fff9f9", bgDark: "#1a0505" },
  inspirational: { primary: "#457b9d", accent: "#f4a261", bgLight: "#f8faff", bgDark: "#0d1b2a" },
  educational:   { primary: "#2b6cb0", accent: "#38b2ac", bgLight: "#f7faff", bgDark: "#0a1628" },
  playful:       { primary: "#ff6b6b", accent: "#4ecdc4", bgLight: "#fff8f0", bgDark: "#0f0f1a" },
  premium:       { primary: "#c9a96e", accent: "#1a1a1a", bgLight: "#fffff8", bgDark: "#0a0a0a" },
  authoritative: { primary: "#1e3a6e", accent: "#c0b090", bgLight: "#f8f9fc", bgDark: "#0a0f1e" },
  friendly:      { primary: "#4caf50", accent: "#2196f3", bgLight: "#f8fff8", bgDark: "#0a1a0a" },
  mysterious:    { primary: "#6c63ff", accent: "#ff6b9d", bgLight: "#f8f7ff", bgDark: "#0a0a14" },
};

const TONE_HOOKS: Record<CampaignTone, DesignGenome["hookStrategy"]> = {
  urgent:        "urgency_frame",
  inspirational: "visual_lead",
  educational:   "bold_headline",
  playful:       "color_block",
  premium:       "negative_space",
  authoritative: "social_proof",
  friendly:      "contrast_punch",
  mysterious:    "pattern_interrupt",
};

const TONE_COMPOSITIONS: Record<CampaignTone, DesignGenome["compositionPattern"]> = {
  urgent:        "z_flow",
  inspirational: "golden_ratio",
  educational:   "f_flow",
  playful:       "radial_burst",
  premium:       "frame_within_frame",
  authoritative: "centered_axis",
  friendly:      "rule_of_thirds",
  mysterious:    "diagonal_tension",
};

const TONE_TYPOGRAPHY: Record<CampaignTone, 0 | 1 | 2 | 3 | 4> = {
  urgent:        1,
  inspirational: 2,
  educational:   0,
  playful:       3,
  premium:       4,
  authoritative: 0,
  friendly:      1,
  mysterious:    2,
};

function seededRand(seed: string, idx: number): number {
  const h = createHash("sha256").update(`${seed}:vis:${idx}`).digest("hex");
  return parseInt(h.slice(0, 8), 16) / 0xffffffff;
}

function buildVisualIdentity(
  prompt: string,
  tone: CampaignTone,
  seed: string,
  brandPrimaryColor?: string
): VisualIdentity {
  const palette = TONE_PALETTES[tone];

  // Extract a concise headline from the prompt
  const words = prompt.split(/\s+/).slice(0, 8).join(" ");
  const headline = words.charAt(0).toUpperCase() + words.slice(1);
  const subMessage = prompt.split(".")[0]?.slice(0, 80) ?? prompt.slice(0, 80);

  const ctaMap: Record<CampaignTone, string> = {
    urgent:        "Get It Now",
    inspirational: "Start Today",
    educational:   "Learn More",
    playful:       "Try It Free",
    premium:       "Explore",
    authoritative: "See Results",
    friendly:      "Join Us",
    mysterious:    "Discover More",
  };

  return {
    primaryColor:          brandPrimaryColor ?? palette.primary,
    accentColor:           palette.accent,
    bgLight:               palette.bgLight,
    bgDark:                palette.bgDark,
    typographyPersonality: TONE_TYPOGRAPHY[tone],
    tone,
    headline:              headline.length > 60 ? headline.slice(0, 57) + "…" : headline,
    subMessage:            subMessage.length > 100 ? subMessage.slice(0, 97) + "…" : subMessage,
    ctaText:               ctaMap[tone],
    compositionPattern:    TONE_COMPOSITIONS[tone],
    hookStrategy:          TONE_HOOKS[tone],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// § 5  FORMAT PLANNER
// ─────────────────────────────────────────────────────────────────────────────

const OBJECTIVE_FORMAT_SETS: Record<CampaignObjective, Array<{ format: string; role: CampaignFormatPlan["role"]; platform: string }>> = {
  awareness: [
    { format: "youtube_thumbnail", role: "hero", platform: "YouTube" },
    { format: "instagram_post",    role: "hero", platform: "Instagram" },
    { format: "instagram_story",   role: "supporting", platform: "Instagram" },
    { format: "twitter_post",      role: "supporting", platform: "Twitter/X" },
    { format: "linkedin_post",     role: "awareness", platform: "LinkedIn" },
  ],
  engagement: [
    { format: "instagram_post",    role: "hero", platform: "Instagram" },
    { format: "instagram_story",   role: "cta", platform: "Instagram" },
    { format: "tiktok_ad",         role: "hero", platform: "TikTok" },
    { format: "twitter_post",      role: "supporting", platform: "Twitter/X" },
  ],
  conversion: [
    { format: "facebook_ad",       role: "hero", platform: "Facebook" },
    { format: "instagram_post",    role: "cta", platform: "Instagram" },
    { format: "instagram_story",   role: "cta", platform: "Instagram" },
    { format: "google_display_rectangle", role: "cta", platform: "Google Display" },
    { format: "youtube_thumbnail", role: "supporting", platform: "YouTube" },
  ],
  retention: [
    { format: "instagram_post",    role: "hero", platform: "Instagram" },
    { format: "instagram_story",   role: "cta", platform: "Instagram" },
    { format: "linkedin_post",     role: "supporting", platform: "LinkedIn" },
  ],
  announcement: [
    { format: "youtube_thumbnail", role: "hero", platform: "YouTube" },
    { format: "instagram_post",    role: "hero", platform: "Instagram" },
    { format: "instagram_story",   role: "cta", platform: "Instagram" },
    { format: "twitter_post",      role: "supporting", platform: "Twitter/X" },
    { format: "linkedin_post",     role: "awareness", platform: "LinkedIn" },
    { format: "facebook_ad",       role: "cta", platform: "Facebook" },
  ],
};

const ROLE_ARCHETYPES: Record<CampaignFormatPlan["role"], string> = {
  hero:       "BOLD_CLAIM",
  supporting: "TRUST_FRIENDLY",
  cta:        "NEWS_URGENT",
  awareness:  "EMOTIONAL_STORY",
};

const TONE_ARCHETYPES: Record<CampaignTone, string> = {
  urgent:        "NEWS_URGENT",
  inspirational: "EMOTIONAL_STORY",
  educational:   "EDUCATIONAL_EXPLAINER",
  playful:       "FUN_PLAYFUL",
  premium:       "LUXURY_PREMIUM",
  authoritative: "AUTHORITY_EXPERT",
  friendly:      "TRUST_FRIENDLY",
  mysterious:    "CURIOSITY_MYSTERY",
};

const SHORT_HEADLINES: Record<CampaignTone, string[]> = {
  urgent:        ["Act Now!", "Limited Time", "Don't Miss Out"],
  inspirational: ["Transform Today", "Your Journey Starts", "Achieve More"],
  educational:   ["Learn How", "Discover", "Master It"],
  playful:       ["Let's Go!", "It's Time", "Join the Fun"],
  premium:       ["Excellence", "Premium Quality", "Crafted for You"],
  authoritative: ["Trusted by Experts", "Proven Results", "Industry Leading"],
  friendly:      ["Welcome!", "Join Us", "We're Here"],
  mysterious:    ["Discover the Secret", "Uncover", "What's Inside?"],
};

function buildFormatPlans(
  objective: CampaignObjective,
  identity: VisualIdentity,
  tone: CampaignTone,
  requestedFormats?: string[]
): CampaignFormatPlan[] {
  const formatSet = requestedFormats
    ? requestedFormats.map((format, i) => ({
        format,
        role: (i === 0 ? "hero" : "supporting") as CampaignFormatPlan["role"],
        platform: format.replace(/_/g, " "),
      }))
    : OBJECTIVE_FORMAT_SETS[objective];

  const shortlines = SHORT_HEADLINES[tone];

  return formatSet.map((fs, i) => {
    const isSmallFormat = ["google_leaderboard", "google_display_rectangle", "linkedin_banner"].includes(fs.format);
    const headline = isSmallFormat
      ? shortlines[i % shortlines.length]
      : identity.headline;

    const subMessage = isSmallFormat ? identity.ctaText : identity.subMessage;

    const archetype = fs.role === "hero"
      ? (TONE_ARCHETYPES[tone] ?? ROLE_ARCHETYPES[fs.role])
      : ROLE_ARCHETYPES[fs.role];

    const motionFormats = ["instagram_post", "instagram_story", "tiktok_ad"];
    const includeMotion = fs.role === "hero" && motionFormats.includes(fs.format);

    return {
      format:              fs.format,
      role:                fs.role,
      platform:            fs.platform,
      headline,
      subMessage,
      ctaText:             identity.ctaText,
      includeMotion,
      archetypeId:         archetype,
      presetId:            tone === "premium" ? "minimal" : tone === "playful" ? "expressive" : "bold",
      generationPriority:  i,
    } satisfies CampaignFormatPlan;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// § 6  MAIN DIRECTOR API
// ─────────────────────────────────────────────────────────────────────────────

export interface DirectorInput {
  prompt: string;
  brandId?: string;
  brandPrimaryColor?: string;
  requestedFormats?: string[];
  seed?: string;
}

/**
 * Builds a complete CampaignPlan from a single prompt.
 * Never throws — returns a valid plan with fallback values on any error.
 */
export function buildCampaignPlan(input: DirectorInput): CampaignPlan {
  const seed = input.seed
    ?? createHash("sha256").update(`campaign:${input.prompt}:${input.brandId ?? "none"}`).digest("hex").slice(0, 32);

  const campaignId = createHash("sha256")
    .update(`arkiol:campaign:${seed}`)
    .digest("hex")
    .slice(0, 24);

  try {
    const objective = detectObjective(input.prompt);
    const tone      = detectTone(input.prompt, objective);
    const identity  = buildVisualIdentity(input.prompt, tone, seed, input.brandPrimaryColor);
    const formats   = buildFormatPlans(objective, identity, tone, input.requestedFormats);

    const sharedPromptContext = [
      `Campaign tone: ${tone}`,
      `Visual identity: primary colour ${identity.primaryColor}, accent ${identity.accentColor}`,
      `Typography personality: ${identity.typographyPersonality}`,
      `Headline theme: "${identity.headline}"`,
      `Hook strategy: ${identity.hookStrategy}`,
      `Composition: ${identity.compositionPattern}`,
      `Brand: ${input.brandId ? `brand=${input.brandId}` : "no brand override"}`,
    ].join(". ");

    const estimatedCredits = formats.length * 2 + formats.filter(f => f.includeMotion).length * 3;

    return {
      campaignId,
      seed,
      prompt: input.prompt,
      objective,
      identity,
      formats,
      sharedPromptContext,
      estimatedCredits,
      generationOrder: formats
        .sort((a, b) => a.generationPriority - b.generationPriority)
        .map(f => f.format),
      createdAt: new Date().toISOString(),
    };
  } catch {
    // Deterministic fallback
    const fallbackFormats: CampaignFormatPlan[] = (input.requestedFormats ?? ["instagram_post", "youtube_thumbnail"]).map((f, i) => ({
      format: f, role: "hero", platform: f, headline: "Campaign Design",
      subMessage: input.prompt.slice(0, 80), ctaText: "Learn More",
      includeMotion: false, archetypeId: "BOLD_CLAIM", presetId: "bold",
      generationPriority: i,
    }));

    return {
      campaignId,
      seed,
      prompt: input.prompt,
      objective: "awareness",
      identity: {
        primaryColor: input.brandPrimaryColor ?? "#4f6ef7",
        accentColor: "#ff6b6b",
        bgLight: "#f8faff",
        bgDark: "#0a0a1a",
        typographyPersonality: 1,
        tone: "friendly",
        headline: input.prompt.slice(0, 60),
        subMessage: input.prompt.slice(0, 100),
        ctaText: "Learn More",
        compositionPattern: "centered_axis",
        hookStrategy: "bold_headline",
      },
      formats: fallbackFormats,
      sharedPromptContext: input.prompt,
      estimatedCredits: fallbackFormats.length * 2,
      generationOrder: fallbackFormats.map(f => f.format),
      createdAt: new Date().toISOString(),
    };
  }
}

/**
 * Converts a CampaignPlan format into a generation-ready payload.
 */
export function campaignFormatToGenerationPayload(
  plan: CampaignPlan,
  formatPlan: CampaignFormatPlan,
  userId: string,
  orgId: string
): Record<string, unknown> {
  return {
    prompt:      `${plan.sharedPromptContext}. Format headline: "${formatPlan.headline}". ${formatPlan.subMessage}`,
    formats:     [formatPlan.format],
    stylePreset: formatPlan.presetId,
    includeGif:  formatPlan.includeMotion,
    archetypeOverride: {
      archetypeId: formatPlan.archetypeId,
      presetId:    formatPlan.presetId,
    },
    campaignId:  plan.campaignId,
    brandId:     undefined,
    userId,
    orgId,
    _campaignMeta: {
      objective: plan.objective,
      role:      formatPlan.role,
      platform:  formatPlan.platform,
      seed:      plan.seed,
    },
  };
}
