// src/engines/inspiration/pattern-matcher.ts
//
// Matches design patterns from the library to a given brief and format,
// then converts the best-matching pattern into concrete theme modifiers
// that the SVG builder can apply.
//
// Scoring is deterministic — no GPT calls.

import type { BriefAnalysis } from "../ai/brief-analyzer";
import type {
  DesignPattern,
  PatternApplicationHint,
  DecorationPattern,
  SpacingPattern,
} from "./pattern-types";
import { getAllPatterns } from "./pattern-library";

// ── Tone mapping — brief tones → pattern tones ────────────────────────────

const TONE_ALIASES: Record<string, string[]> = {
  professional: ["professional", "trustworthy", "modern", "informative"],
  playful:      ["playful", "friendly", "fun", "energetic"],
  urgent:       ["urgent", "bold", "energetic", "edgy"],
  warm:         ["warm", "friendly", "natural", "calm"],
  bold:         ["bold", "energetic", "confident", "edgy"],
  minimal:      ["elegant", "modern", "sophisticated", "calm"],
  luxury:       ["premium", "elegant", "sophisticated", "exclusive"],
  energetic:    ["energetic", "bold", "playful", "fun"],
};

// ── Category inference — brief keywords/intent → pattern categories ───────

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  ecommerce: ["shop", "buy", "sale", "discount", "price", "product", "store", "deal", "offer", "cart"],
  saas:      ["app", "software", "platform", "dashboard", "api", "cloud", "startup", "tool", "subscribe"],
  food:      ["food", "restaurant", "recipe", "menu", "chef", "delivery", "pizza", "coffee", "bakery", "cafe"],
  fashion:   ["fashion", "clothing", "style", "outfit", "wear", "collection", "designer", "trend"],
  wellness:  ["wellness", "health", "yoga", "meditation", "spa", "fitness", "mindful", "organic", "natural"],
  tech:      ["tech", "ai", "data", "digital", "innovation", "code", "cyber", "smart", "blockchain"],
  events:    ["event", "concert", "festival", "conference", "webinar", "meetup", "party", "launch"],
  education: ["learn", "course", "tutorial", "training", "academy", "class", "teach", "student", "workshop"],
  finance:   ["finance", "bank", "invest", "money", "insurance", "credit", "loan", "crypto", "trading"],
  creative:  ["design", "art", "creative", "portfolio", "studio", "photography", "illustration", "brand"],
};

// ── Format → source mapping ───────────────────────────────────────────────

function inferPatternSources(format: string): string[] {
  const f = format.toLowerCase();
  if (f.includes("story") || f.includes("reel") || f.includes("tiktok"))   return ["social_ad", "social_organic"];
  if (f.includes("post") || f.includes("square") || f.includes("carousel")) return ["social_ad", "social_organic"];
  if (f.includes("banner") || f.includes("leaderboard") || f.includes("ad")) return ["social_ad", "landing_page"];
  if (f.includes("email") || f.includes("newsletter"))                      return ["email_hero"];
  if (f.includes("poster") || f.includes("flyer"))                          return ["poster"];
  if (f.includes("thumbnail"))                                               return ["social_ad", "social_organic"];
  if (f.includes("card") || f.includes("logo"))                             return ["branding"];
  return ["social_ad", "landing_page", "branding"];
}

// ── Scoring ────────────────────────────────────────────────────────────────

interface PatternScore {
  pattern: DesignPattern;
  score: number;
}

function scorePattern(
  pattern: DesignPattern,
  brief: BriefAnalysis,
  format: string,
  inferredCategories: Set<string>,
  preferredSources: Set<string>,
): number {
  let score = 0;

  // Tone match (0–0.30)
  const expandedTones = TONE_ALIASES[brief.tone] ?? [brief.tone];
  const toneOverlap = pattern.tones.filter(t => expandedTones.includes(t)).length;
  score += Math.min(0.30, toneOverlap * 0.12);

  // Category match (0–0.25)
  const catOverlap = pattern.categories.filter(c => inferredCategories.has(c)).length;
  score += Math.min(0.25, catOverlap * 0.12);

  // Source match (0–0.15)
  if (preferredSources.has(pattern.source)) {
    score += 0.15;
  }

  // Color mood alignment (0–0.15)
  score += scoreColorMoodMatch(pattern, brief) * 0.15;

  // Freshness bonus (0–0.10)
  score += pattern.freshness * 0.10;

  // Engagement signal bonus (0–0.05)
  if (brief.tone === "urgent" && pattern.engagementSignals.includes("urgency")) score += 0.05;
  if (brief.cta && pattern.layout.ctaPlacement !== "none") score += 0.03;
  if (!brief.cta && pattern.layout.ctaPlacement === "none") score += 0.02;

  return Math.min(1, score);
}

function scoreColorMoodMatch(pattern: DesignPattern, brief: BriefAnalysis): number {
  const cr = pattern.colorRelationship;
  const mood = brief.colorMood;

  const moodMap: Record<string, { warmth: string[]; saturation: string[]; contrast: string[] }> = {
    vibrant:     { warmth: ["warm", "neutral"], saturation: ["vivid"],    contrast: ["high", "extreme"] },
    muted:       { warmth: ["neutral", "cool"], saturation: ["muted"],    contrast: ["low", "medium"] },
    dark:        { warmth: ["cool", "neutral"], saturation: ["balanced", "muted"], contrast: ["extreme", "high"] },
    light:       { warmth: ["warm", "neutral"], saturation: ["balanced"], contrast: ["medium", "high"] },
    monochrome:  { warmth: ["neutral", "cool"], saturation: ["muted"],    contrast: ["high"] },
    warm:        { warmth: ["warm"],            saturation: ["balanced", "vivid"], contrast: ["medium", "high"] },
    cool:        { warmth: ["cool"],            saturation: ["balanced"],  contrast: ["medium", "high"] },
  };

  const expected = moodMap[mood];
  if (!expected) return 0.5;

  let match = 0;
  if (expected.warmth.includes(cr.warmth)) match += 0.4;
  if (expected.saturation.includes(cr.saturationProfile)) match += 0.35;
  if (expected.contrast.includes(cr.contrastLevel)) match += 0.25;
  return match;
}

// ── Category inference from brief ─────────────────────────────────────────

function inferCategories(brief: BriefAnalysis): Set<string> {
  const text = [
    brief.headline,
    brief.subhead ?? "",
    brief.body ?? "",
    brief.intent,
    ...(brief.keywords ?? []),
  ].join(" ").toLowerCase();

  const matched = new Set<string>();
  for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    for (const kw of keywords) {
      if (text.includes(kw)) {
        matched.add(cat);
        break;
      }
    }
  }

  if (matched.size === 0) matched.add("creative");
  return matched;
}

// ── Main matching API ──────────────────────────────────────────────────────

export interface PatternMatchResult {
  topPattern: DesignPattern;
  topScore: number;
  hint: PatternApplicationHint;
  runnerUp?: DesignPattern;
  candidateCount: number;
}

export function matchPatternToBrief(
  brief: BriefAnalysis,
  format: string,
): PatternMatchResult {
  const patterns = getAllPatterns();
  const inferredCategories = inferCategories(brief);
  const preferredSources = new Set(inferPatternSources(format));

  const scored: PatternScore[] = patterns.map(pattern => ({
    pattern,
    score: scorePattern(pattern, brief, format, inferredCategories, preferredSources),
  }));

  scored.sort((a, b) => b.score - a.score);

  const top = scored[0];
  const runnerUp = scored.length > 1 ? scored[1].pattern : undefined;

  return {
    topPattern: top.pattern,
    topScore: top.score,
    hint: buildApplicationHint(top.pattern, top.score),
    runnerUp,
    candidateCount: scored.length,
  };
}

export function matchTopPatterns(
  brief: BriefAnalysis,
  format: string,
  count = 3,
): PatternMatchResult[] {
  const patterns = getAllPatterns();
  const inferredCategories = inferCategories(brief);
  const preferredSources = new Set(inferPatternSources(format));

  const scored: PatternScore[] = patterns.map(pattern => ({
    pattern,
    score: scorePattern(pattern, brief, format, inferredCategories, preferredSources),
  }));

  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, count).map((s, i) => ({
    topPattern: s.pattern,
    topScore: s.score,
    hint: buildApplicationHint(s.pattern, s.score),
    runnerUp: scored[i + 1]?.pattern,
    candidateCount: scored.length,
  }));
}

// ── Hint builder — converts a pattern into actionable theme modifiers ──────

function buildApplicationHint(
  pattern: DesignPattern,
  relevanceScore: number,
): PatternApplicationHint {
  const typo = pattern.typography;
  const color = pattern.colorRelationship;
  const spacing = pattern.spacing;
  const deco = pattern.decoration;
  const layout = pattern.layout;

  return {
    patternId: pattern.id,
    patternName: pattern.name,
    relevanceScore,

    themeModifiers: {
      headlineSizeMultiplier: typoSizeMultiplier(typo),
      headlineWeight: typoWeight(typo.headlineStyle),
      headlineLetterSpacing: typoLetterSpacing(typo.trackingProfile),
      headlineCase: typo.headlineCase === "uppercase" ? "uppercase" : "none",
      saturationBias: saturationBias(color.saturationProfile),
      warmthShift: warmthShift(color.warmth),
      contrastBoost: contrastBoost(color.contrastLevel),
      overlayOpacity: layout.heroElement === "image" ? 0.35 : 0,
    },

    decorationHints: {
      targetComplexity: deco.complexity,
      preferredShapes: deco.primaryShapes,
      placementStrategy: deco.placementStrategy,
    },

    spacingHints: {
      density: spacing.density,
      alignment: spacing.contentAlignment,
    },

    ctaHints: {
      radiusBias: inferCtaRadius(layout, pattern.tones),
      shadow: color.contrastLevel === "extreme" || layout.heroElement === "image",
      emphasis: layout.ctaPlacement === "center" || layout.ctaPlacement === "floating" ? "strong" : "subtle",
    },
  };
}

// ── Modifier helpers ───────────────────────────────────────────────────────

function typoSizeMultiplier(typo: DesignPattern["typography"]): number {
  const base: Record<string, number> = {
    ultra_bold: 1.5,
    bold: 1.3,
    medium: 1.15,
    light: 1.05,
    condensed: 1.35,
  };
  const mult = base[typo.headlineStyle] ?? 1.15;
  return mult * (typo.sizeRatio > 3 ? 1.1 : typo.sizeRatio > 2.5 ? 1.05 : 1.0);
}

function typoWeight(style: string): number {
  const map: Record<string, number> = {
    ultra_bold: 900,
    bold: 700,
    medium: 500,
    light: 300,
    condensed: 700,
  };
  return map[style] ?? 600;
}

function typoLetterSpacing(profile: string): number {
  const map: Record<string, number> = {
    tight: -0.02,
    normal: 0,
    wide: 0.06,
    ultra_wide: 0.14,
  };
  return map[profile] ?? 0;
}

function saturationBias(profile: string): number {
  return profile === "vivid" ? 0.15 : profile === "muted" ? -0.15 : 0;
}

function warmthShift(warmth: string): number {
  return warmth === "warm" ? 0.1 : warmth === "cool" ? -0.1 : 0;
}

function contrastBoost(level: string): number {
  return level === "extreme" ? 0.2 : level === "high" ? 0.1 : level === "low" ? -0.1 : 0;
}

function inferCtaRadius(
  layout: DesignPattern["layout"],
  tones: string[],
): "sharp" | "rounded" | "pill" {
  if (tones.some(t => ["playful", "friendly", "fun"].includes(t))) return "pill";
  if (tones.some(t => ["premium", "elegant", "luxury", "sophisticated"].includes(t))) return "sharp";
  return "rounded";
}

// ── Apply hint to existing theme properties ────────────────────────────────
// This produces a partial override object that svg-builder-ultimate can merge.

export interface InspirationOverrides {
  headlineSizeMultiplier?: number;
  headlineWeight?: number;
  headlineLetterSpacing?: number;
  headlineTextTransform?: "uppercase" | "none";
  ctaBorderRadius?: number;
  ctaShadow?: boolean;
  overlayOpacity?: number;
}

export function buildInspirationOverrides(
  hint: PatternApplicationHint,
): InspirationOverrides {
  if (hint.relevanceScore < 0.25) return {};

  const strength = Math.min(1, hint.relevanceScore / 0.7);

  const overrides: InspirationOverrides = {};

  const hm = hint.themeModifiers;
  if (hm.headlineSizeMultiplier && hm.headlineSizeMultiplier !== 1.0) {
    overrides.headlineSizeMultiplier = 1.0 + (hm.headlineSizeMultiplier - 1.0) * strength;
  }
  if (hm.headlineWeight) {
    overrides.headlineWeight = hm.headlineWeight;
  }
  if (hm.headlineLetterSpacing && hm.headlineLetterSpacing !== 0) {
    overrides.headlineLetterSpacing = hm.headlineLetterSpacing * strength;
  }
  if (hm.headlineCase === "uppercase") {
    overrides.headlineTextTransform = "uppercase";
  }

  const cta = hint.ctaHints;
  if (cta.radiusBias === "pill")    overrides.ctaBorderRadius = 50;
  else if (cta.radiusBias === "sharp") overrides.ctaBorderRadius = 4;
  else overrides.ctaBorderRadius = 12;

  if (cta.shadow) overrides.ctaShadow = true;

  if (hm.overlayOpacity && hm.overlayOpacity > 0) {
    overrides.overlayOpacity = hm.overlayOpacity * strength;
  }

  return overrides;
}
