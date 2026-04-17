// src/engines/agents/design-agents.ts
//
// Lightweight AI agent orchestration — the "thinking layer."
// Three deterministic roles coordinate design decisions before and after generation:
//
//   1. Creative Director — interprets the brief → decides category, tone, visual strategy
//   2. Designer          — takes creative direction → selects theme preferences, typography, spacing
//   3. Critic            — pre-generation: validates plan coherence; post-generation: evaluates output
//
// All agents are pure functions (no GPT calls). They coordinate existing signals
// (style intent, learning bias, brand context) into structured decisions that
// the pipeline and SVG builder consume.

import type { BriefAnalysis } from "../ai/brief-analyzer";
import type { StyleIntent } from "../style/style-intelligence";
import { analyzeStyleIntent, deriveStyleDirective, type StyleDirective } from "../style/style-intelligence";
import { detectCategoryPack, type CategoryStylePack } from "../style/category-style-packs";
import { computeLearningBias, applyThemeBias, type LearningBias } from "../memory/learning-signals";

// ── Shared types ────────────────────────────────────────────────────────────

export type VisualStrategy = "hero_text" | "image_led" | "balanced" | "minimal_clean" | "data_driven";
export type HookApproach = "urgency" | "curiosity" | "benefit" | "social_proof" | "emotional" | "direct";
export type ColorTemperature = "cool" | "neutral" | "warm";
export type VisualComplexity = "low" | "medium" | "high";

// ── Creative Direction ──────────────────────────────────────────────────────

export interface CreativeDirection {
  category: string;
  tone: string;
  visualStrategy: VisualStrategy;
  hookApproach: HookApproach;
  colorTemperature: ColorTemperature;
  contentDensity: "sparse" | "balanced" | "dense";
  audienceFormality: "casual" | "neutral" | "formal";
  keyMessage: string;
}

// ── Design Plan ─────────────────────────────────────────────────────────────

export interface DesignPlan {
  themePreferences: string[];
  typographyScale: "compact" | "standard" | "dramatic";
  colorTemperature: ColorTemperature;
  spacingDensity: "airy" | "balanced" | "compact";
  visualComplexity: VisualComplexity;
  decorationLevel: "minimal" | "moderate" | "rich";
  styleDirective: StyleDirective;
}

// ── Critic Verdict ──────────────────────────────────────────────────────────

export type CriticAction = "approve" | "refine" | "regenerate";

export interface CriticVerdict {
  action: CriticAction;
  coherenceScore: number;
  intentAlignment: number;
  visualBalance: number;
  issues: string[];
  suggestions: string[];
}

// ═══════════════════════════════════════════════════════════════════════════════
// § 1  CREATIVE DIRECTOR
// ═══════════════════════════════════════════════════════════════════════════════

const URGENCY_WORDS = new Set([
  "sale", "free", "now", "limited", "hurry", "today", "exclusive",
  "discount", "flash", "last chance", "ending", "save", "deal", "offer",
]);

const CURIOSITY_WORDS = new Set([
  "discover", "secret", "unlock", "reveal", "hidden", "surprising", "new",
]);

const BENEFIT_WORDS = new Set([
  "improve", "boost", "transform", "upgrade", "better", "faster", "easier",
]);

const SOCIAL_PROOF_WORDS = new Set([
  "trusted", "million", "favorite", "rated", "recommended", "proven", "popular",
]);

export function runCreativeDirector(
  brief: BriefAnalysis,
  format: string,
  brand?: { primaryColor: string; secondaryColor: string },
): CreativeDirection {
  const categoryPack = detectCategoryPack(brief);
  const category = categoryPack?.id ?? inferCategory(brief);

  const tone = brief.tone ?? "professional";

  const allText = `${brief.headline ?? ""} ${brief.subhead ?? ""} ${brief.body ?? ""} ${brief.cta ?? ""} ${(brief.keywords ?? []).join(" ")}`.toLowerCase();

  const visualStrategy = decideVisualStrategy(brief, format, categoryPack);
  const hookApproach = decideHookApproach(allText, tone);
  const colorTemperature = decideColorTemperature(brief, brand);
  const contentDensity = decideContentDensity(brief, format);
  const audienceFormality = decideFormality(tone, category);

  const keyMessage = brief.headline ?? brief.subhead ?? "";

  return {
    category,
    tone,
    visualStrategy,
    hookApproach,
    colorTemperature,
    contentDensity,
    audienceFormality,
    keyMessage,
  };
}

function inferCategory(brief: BriefAnalysis): string {
  const text = `${brief.headline ?? ""} ${brief.body ?? ""} ${(brief.keywords ?? []).join(" ")}`.toLowerCase();

  if (text.match(/sale|discount|shop|buy|price|deal/)) return "ecommerce";
  if (text.match(/wellness|health|yoga|fitness|gym/)) return "wellness";
  if (text.match(/food|recipe|restaurant|menu|chef/)) return "food";
  if (text.match(/fashion|style|outfit|wear|collection/)) return "fashion";
  if (text.match(/tech|software|app|digital|code/)) return "tech";
  if (text.match(/beauty|skincare|cosmetic|makeup/)) return "beauty";
  if (text.match(/business|corporate|finance|invest/)) return "business";
  if (text.match(/travel|destination|trip|explore/)) return "travel";
  if (text.match(/education|learn|course|study/)) return "education";
  if (text.match(/event|party|celebrate|festival/)) return "events";
  return "general";
}

function decideVisualStrategy(
  brief: BriefAnalysis,
  format: string,
  pack: CategoryStylePack | null,
): VisualStrategy {
  if (brief.imageStyle === "none" || brief.imageStyle === "abstract") return "hero_text";
  if (brief.imageStyle === "product" || brief.imageStyle === "lifestyle") return "image_led";

  if (format.includes("story") || format.includes("reel")) return "hero_text";
  if (format.includes("banner") || format.includes("cover")) return "balanced";

  if (pack?.spacingDensity === "airy") return "minimal_clean";

  const textLength = (brief.headline?.length ?? 0) + (brief.subhead?.length ?? 0) + (brief.body?.length ?? 0);
  if (textLength > 200) return "balanced";
  if (textLength < 50) return "hero_text";

  return "balanced";
}

function decideHookApproach(text: string, tone: string): HookApproach {
  const words = text.split(/\s+/);

  let urgencyHits = 0, curiosityHits = 0, benefitHits = 0, socialHits = 0;
  for (const w of words) {
    if (URGENCY_WORDS.has(w)) urgencyHits++;
    if (CURIOSITY_WORDS.has(w)) curiosityHits++;
    if (BENEFIT_WORDS.has(w)) benefitHits++;
    if (SOCIAL_PROOF_WORDS.has(w)) socialHits++;
  }

  if (tone === "urgent" || urgencyHits >= 2) return "urgency";
  if (curiosityHits >= 2) return "curiosity";
  if (socialHits >= 2) return "social_proof";
  if (benefitHits >= 2) return "benefit";
  if (tone === "warm" || tone === "playful") return "emotional";
  return "direct";
}

function decideColorTemperature(
  brief: BriefAnalysis,
  brand?: { primaryColor: string; secondaryColor: string },
): ColorTemperature {
  if (brand) {
    const hue = hexToHue(brand.primaryColor);
    if (hue >= 0 && hue < 60) return "warm";
    if (hue >= 60 && hue < 150) return "neutral";
    if (hue >= 150 && hue < 270) return "cool";
    return "warm";
  }

  const mood = brief.colorMood;
  if (mood === "warm") return "warm";
  if (mood === "cool") return "cool";
  if (mood === "dark" || mood === "muted") return "cool";
  if (mood === "light" || mood === "vibrant") return "warm";
  return "neutral";
}

function decideContentDensity(brief: BriefAnalysis, format: string): "sparse" | "balanced" | "dense" {
  const textLength = (brief.headline?.length ?? 0) + (brief.subhead?.length ?? 0) + (brief.body?.length ?? 0);
  const hasCta = !!brief.cta;
  const hasBadge = !!brief.badge;
  const hasPrice = !!brief.priceText;

  const elementCount = [hasCta, hasBadge, hasPrice, !!brief.subhead, !!brief.body].filter(Boolean).length;

  if (format.includes("story") || format.includes("reel")) return "sparse";
  if (elementCount >= 4 || textLength > 300) return "dense";
  if (elementCount <= 1 && textLength < 80) return "sparse";
  return "balanced";
}

function decideFormality(tone: string, category: string): "casual" | "neutral" | "formal" {
  if (tone === "luxury" || tone === "professional" || tone === "minimal") return "formal";
  if (tone === "playful" || tone === "energetic") return "casual";
  if (category === "business" || category === "finance") return "formal";
  if (category === "events" || category === "food") return "casual";
  return "neutral";
}

// ═══════════════════════════════════════════════════════════════════════════════
// § 2  DESIGNER
// ═══════════════════════════════════════════════════════════════════════════════

const THEME_AFFINITY: Record<string, Partial<Record<VisualStrategy | ColorTemperature | string, string[]>>> = {
  warm: {
    hero_text:     ["vibrant_burst", "sunset_warm", "golden_hour", "coral_energy"],
    image_led:     ["floral_romance", "peach_bliss", "tropical_paradise"],
    balanced:      ["earth_coffee", "sage_wellness", "lush_green"],
    minimal_clean: ["clean_minimal", "sky_fresh"],
  },
  cool: {
    hero_text:     ["cosmic_purple", "ocean_blue", "lavender_dream"],
    image_led:     ["dark_luxe", "navy_pro", "power_black"],
    balanced:      ["modern_editorial", "sky_fresh", "ocean_blue"],
    minimal_clean: ["clean_minimal", "navy_pro"],
  },
  neutral: {
    hero_text:     ["retro_pop", "modern_editorial", "vibrant_burst"],
    image_led:     ["dark_luxe", "lush_green", "tropical_paradise"],
    balanced:      ["clean_minimal", "sage_wellness", "navy_pro"],
    minimal_clean: ["clean_minimal", "modern_editorial"],
  },
};

export function runDesigner(
  direction: CreativeDirection,
  format: string,
  brief: BriefAnalysis,
  brand?: { primaryColor: string; secondaryColor: string },
): DesignPlan {
  const themePreferences = selectThemePreferences(direction);
  const typographyScale = decideTypographyScale(direction);
  const spacingDensity = decideSpacingDensity(direction);
  const visualComplexity = decideVisualComplexity(direction);
  const decorationLevel = decideDecorationLevel(direction, visualComplexity);

  const categoryPack = detectCategoryPack(brief);
  const styleIntent = analyzeStyleIntent(brief, categoryPack?.id);
  const styleDirective = deriveStyleDirective(
    styleIntent,
    categoryPack,
    brand ? { primaryColor: brand.primaryColor, secondaryColor: brand.secondaryColor } : undefined,
  );

  return {
    themePreferences,
    typographyScale,
    colorTemperature: direction.colorTemperature,
    spacingDensity,
    visualComplexity,
    decorationLevel,
    styleDirective,
  };
}

function selectThemePreferences(direction: CreativeDirection): string[] {
  const tempAffinity = THEME_AFFINITY[direction.colorTemperature];
  if (!tempAffinity) return ["clean_minimal", "modern_editorial"];

  const strategyThemes = tempAffinity[direction.visualStrategy] ?? [];

  const bias = computeLearningBias({});
  if (bias.confidence > 0 && strategyThemes.length > 1) {
    return [...strategyThemes].sort((a, b) => {
      const aBias = bias.themeBoosts[a] ?? 0;
      const bBias = bias.themeBoosts[b] ?? 0;
      return bBias - aBias;
    });
  }

  return strategyThemes.length > 0 ? strategyThemes : ["clean_minimal", "modern_editorial"];
}

function decideTypographyScale(direction: CreativeDirection): "compact" | "standard" | "dramatic" {
  if (direction.visualStrategy === "hero_text") return "dramatic";
  if (direction.contentDensity === "dense") return "compact";
  if (direction.audienceFormality === "formal" && direction.contentDensity === "sparse") return "dramatic";
  return "standard";
}

function decideSpacingDensity(direction: CreativeDirection): "airy" | "balanced" | "compact" {
  if (direction.visualStrategy === "minimal_clean") return "airy";
  if (direction.contentDensity === "dense") return "compact";
  if (direction.contentDensity === "sparse") return "airy";
  return "balanced";
}

function decideVisualComplexity(direction: CreativeDirection): VisualComplexity {
  if (direction.visualStrategy === "minimal_clean") return "low";
  if (direction.contentDensity === "dense") return "high";
  if (direction.hookApproach === "urgency") return "high";
  if (direction.audienceFormality === "formal") return "low";
  return "medium";
}

function decideDecorationLevel(
  direction: CreativeDirection,
  complexity: VisualComplexity,
): "minimal" | "moderate" | "rich" {
  if (complexity === "low") return "minimal";
  if (complexity === "high") return "rich";
  if (direction.audienceFormality === "formal") return "minimal";
  if (direction.tone === "playful" || direction.tone === "energetic") return "rich";
  return "moderate";
}

// ═══════════════════════════════════════════════════════════════════════════════
// § 3  CRITIC
// ═══════════════════════════════════════════════════════════════════════════════

export function runCriticPreFlight(
  direction: CreativeDirection,
  plan: DesignPlan,
): CriticVerdict {
  const issues: string[] = [];
  const suggestions: string[] = [];

  const coherenceScore = assessCoherence(direction, plan, issues, suggestions);
  const intentAlignment = assessIntentAlignment(direction, plan, issues);
  const visualBalance = assessVisualBalance(plan, issues, suggestions);

  const avgScore = (coherenceScore + intentAlignment + visualBalance) / 3;

  let action: CriticAction = "approve";
  if (avgScore < 0.4) action = "regenerate";
  else if (avgScore < 0.65 || issues.length > 2) action = "refine";

  return { action, coherenceScore, intentAlignment, visualBalance, issues, suggestions };
}

export function runCriticPostGeneration(
  direction: CreativeDirection,
  plan: DesignPlan,
  result: {
    themeId: string;
    qualityScore: number;
    designQualityScore: number;
    brandScore: number;
    hierarchyValid: boolean;
    violations: string[];
    recoveryCount: number;
  },
): CriticVerdict {
  const issues: string[] = [];
  const suggestions: string[] = [];

  let intentAlignment = 0.7;
  if (plan.themePreferences.includes(result.themeId)) {
    intentAlignment += 0.2;
  } else {
    issues.push(`Selected theme "${result.themeId}" was not in preferred list`);
    intentAlignment -= 0.1;
  }

  if (!result.hierarchyValid) {
    issues.push("Typography hierarchy is invalid");
    intentAlignment -= 0.15;
  }

  let visualBalance = (result.qualityScore + result.designQualityScore) / 2;

  if (result.recoveryCount > 0) {
    issues.push(`${result.recoveryCount} recovery actions were needed`);
    visualBalance -= 0.05 * Math.min(result.recoveryCount, 3);
  }

  const criticalViolations = result.violations.filter(v =>
    v.includes("error") || v.includes("critical")
  ).length;
  if (criticalViolations > 0) {
    issues.push(`${criticalViolations} critical violations detected`);
    visualBalance -= 0.1;
  }

  let coherenceScore = 0.7;
  if (result.brandScore >= 80) coherenceScore += 0.2;
  else if (result.brandScore >= 60) coherenceScore += 0.1;
  else {
    issues.push(`Brand score ${result.brandScore} is below acceptable threshold`);
    coherenceScore -= 0.15;
  }

  if (direction.audienceFormality === "formal" && plan.decorationLevel === "rich") {
    suggestions.push("Consider reducing decoration density for formal audience");
  }

  coherenceScore = clamp(coherenceScore, 0, 1);
  intentAlignment = clamp(intentAlignment, 0, 1);
  visualBalance = clamp(visualBalance, 0, 1);

  const avgScore = (coherenceScore + intentAlignment + visualBalance) / 3;

  let action: CriticAction = "approve";
  if (avgScore < 0.35) action = "regenerate";
  else if (avgScore < 0.55 || criticalViolations > 2) action = "refine";

  return { action, coherenceScore, intentAlignment, visualBalance, issues, suggestions };
}

function assessCoherence(
  direction: CreativeDirection,
  plan: DesignPlan,
  issues: string[],
  suggestions: string[],
): number {
  let score = 0.75;

  if (direction.colorTemperature !== plan.colorTemperature) {
    issues.push("Color temperature mismatch between direction and plan");
    score -= 0.2;
  }

  if (direction.contentDensity === "sparse" && plan.spacingDensity === "compact") {
    issues.push("Compact spacing conflicts with sparse content intent");
    suggestions.push("Switch spacing to airy or balanced");
    score -= 0.15;
  }

  if (direction.contentDensity === "dense" && plan.spacingDensity === "airy") {
    issues.push("Airy spacing may not accommodate dense content");
    suggestions.push("Switch spacing to balanced or compact");
    score -= 0.1;
  }

  if (direction.audienceFormality === "formal" && plan.decorationLevel === "rich") {
    suggestions.push("Rich decorations may feel too casual for formal audience");
    score -= 0.1;
  }

  return clamp(score, 0, 1);
}

function assessIntentAlignment(
  direction: CreativeDirection,
  plan: DesignPlan,
  issues: string[],
): number {
  let score = 0.8;

  if (direction.visualStrategy === "hero_text" && plan.typographyScale === "compact") {
    issues.push("Hero text strategy requires dramatic or standard typography, not compact");
    score -= 0.2;
  }

  if (direction.visualStrategy === "minimal_clean" && plan.visualComplexity === "high") {
    issues.push("Minimal clean strategy conflicts with high visual complexity");
    score -= 0.25;
  }

  if (direction.hookApproach === "urgency" && plan.spacingDensity === "airy") {
    issues.push("Urgency hook works better with tighter spacing");
    score -= 0.1;
  }

  return clamp(score, 0, 1);
}

function assessVisualBalance(
  plan: DesignPlan,
  issues: string[],
  suggestions: string[],
): number {
  let score = 0.8;

  if (plan.visualComplexity === "high" && plan.spacingDensity === "airy") {
    issues.push("High complexity with airy spacing creates disjointed layout");
    suggestions.push("Reduce complexity or tighten spacing");
    score -= 0.15;
  }

  if (plan.decorationLevel === "rich" && plan.typographyScale === "dramatic") {
    suggestions.push("Rich decorations may compete with dramatic typography");
    score -= 0.1;
  }

  if (plan.themePreferences.length === 0) {
    issues.push("No theme preferences selected");
    score -= 0.3;
  }

  return clamp(score, 0, 1);
}

// ═══════════════════════════════════════════════════════════════════════════════
// § 4  ORCHESTRATION — runs all three agents in sequence
// ═══════════════════════════════════════════════════════════════════════════════

export interface AgentOrchestrationResult {
  direction: CreativeDirection;
  plan: DesignPlan;
  preFlightVerdict: CriticVerdict;
  adjustmentsApplied: string[];
}

export function orchestrateDesignAgents(
  brief: BriefAnalysis,
  format: string,
  brand?: { primaryColor: string; secondaryColor: string },
): AgentOrchestrationResult {
  const direction = runCreativeDirector(brief, format, brand);

  let plan = runDesigner(direction, format, brief, brand);

  const preFlightVerdict = runCriticPreFlight(direction, plan);
  const adjustmentsApplied: string[] = [];

  if (preFlightVerdict.action !== "approve") {
    plan = applyPreFlightFixes(plan, direction, preFlightVerdict, adjustmentsApplied);
  }

  return { direction, plan, preFlightVerdict, adjustmentsApplied };
}

function applyPreFlightFixes(
  plan: DesignPlan,
  direction: CreativeDirection,
  verdict: CriticVerdict,
  log: string[],
): DesignPlan {
  let fixed = { ...plan };

  if (direction.colorTemperature !== plan.colorTemperature) {
    fixed.colorTemperature = direction.colorTemperature;
    log.push(`Fixed color temperature: ${plan.colorTemperature} → ${direction.colorTemperature}`);
  }

  if (direction.contentDensity === "sparse" && plan.spacingDensity === "compact") {
    fixed.spacingDensity = "balanced";
    log.push("Fixed spacing: compact → balanced (sparse content)");
  }

  if (direction.contentDensity === "dense" && plan.spacingDensity === "airy") {
    fixed.spacingDensity = "balanced";
    log.push("Fixed spacing: airy → balanced (dense content)");
  }

  if (direction.visualStrategy === "hero_text" && plan.typographyScale === "compact") {
    fixed.typographyScale = "dramatic";
    log.push("Fixed typography: compact → dramatic (hero text strategy)");
  }

  if (direction.visualStrategy === "minimal_clean" && plan.visualComplexity === "high") {
    fixed.visualComplexity = "low";
    fixed.decorationLevel = "minimal";
    log.push("Fixed complexity: high → low, decorations: → minimal (minimal clean strategy)");
  }

  if (direction.audienceFormality === "formal" && plan.decorationLevel === "rich") {
    fixed.decorationLevel = "moderate";
    log.push("Fixed decorations: rich → moderate (formal audience)");
  }

  return fixed;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function hexToHue(hex: string): number {
  hex = hex.replace(/^#/, "");
  if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return h * 360;
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
