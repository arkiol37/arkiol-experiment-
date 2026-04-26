// src/engines/design-brain/index.ts
// ─────────────────────────────────────────────────────────────────────────────
// Design Brain — the deterministic creative-direction stage.
//
// Replaces the old "explore many random variations and filter later" approach
// with a single, fast plan that pins every downstream decision (palette,
// layout, asset domain, typography) BEFORE any rendering happens.
//
// Contract:
//   • Pure function. No I/O, no OpenAI, no DB. Same prompt → same plan.
//   • Returns under 5ms on a cold Node process.
//   • Output is consumed by inlineGenerate.ts: it caps the candidate count
//     to 3-4, biases the orchestrator toward the chosen domain/style/layout,
//     and is used to reject any rendered candidate whose subject category
//     drifts away from the brief's domain.
//
// Why this exists: the previous pipeline picked colour palettes, layout
// types and asset families independently per attempt, which produced
// gallery batches that mixed unrelated styles ("fitness ad with floral
// pastel decoration"). The Design Brain locks one creative direction at
// the top of the run so every variation that follows differs only in
// composition, never in domain or feel.
// ─────────────────────────────────────────────────────────────────────────────
import { inferCategoryFromText } from "../../lib/asset-library/category-recipes";
import type { AssetCategory } from "../../lib/asset-library/types";

/** The nine business-domain buckets the rest of the system already knows.
 *  Mirrors AssetCategory exactly so the Design Brain's domain field can
 *  be passed straight to the asset library / category-recipes. */
export type DesignDomain = AssetCategory;

/** High-level visual personality. Determines decoration intensity, contrast,
 *  and the overall feel of every candidate produced under this plan. */
export type VisualStyle =
  | "bold"      // high-contrast, energetic, strong CTAs (fitness, marketing)
  | "minimal"   // calm, restrained, lots of whitespace (productivity, business)
  | "luxury"    // refined, premium, deep + accent palette (beauty, business)
  | "playful"   // bright, friendly, rounded (motivation, education)
  | "warm"      // soft, inviting, organic (wellness, food, travel)
  | "modern";   // clean editorial, neutral fallback

/** Composition skeleton. Drives where the focal element sits and how text
 *  zones stack. Maps onto the layoutType strings the existing layout
 *  engines already support, with one addition (`split`). */
export type LayoutType =
  | "hero"      // centred focal subject, headline below
  | "split"     // 50/50 image | text
  | "card"      // contained, framed composition
  | "grid"      // multi-cell, list-driven
  | "stack";    // vertical text-heavy stack

/** What the dominant visual subject should depict. The asset library
 *  already groups assets under these categories, so the Design Brain just
 *  picks one and the asset selector resolves the actual files. */
export type AssetType =
  | "fitness_visuals"     // gym, workout, action sports
  | "wellness_visuals"    // meditation, nature, calm
  | "business_visuals"    // charts, growth, professional
  | "education_visuals"   // books, learning, ideas
  | "travel_visuals"      // destinations, scenery
  | "beauty_visuals"      // skincare, cosmetics, glow
  | "food_visuals"        // food, drink, lifestyle
  | "marketing_visuals"   // sales, offers, promo
  | "motivation_visuals"  // mindset, achievement, abstract
  | "productivity_visuals" // tasks, time, structure
  | "generic_modern";     // safe fallback when domain is unknown

/** Typography personality. Maps onto pack-level font choices already in
 *  the codebase; the Design Brain just decides which family is correct
 *  for this brief and pins it for every variation in the run. */
export type TypographyStyle =
  | "bold_headline"
  | "modern_sans"
  | "editorial_serif"
  | "script_accent"
  | "rounded_friendly";

/** A simple 3-stop palette. Every Design Brain run produces one and one
 *  only; per-variation tweaking is restricted to layout + composition. */
export interface DesignPalette {
  background: string;
  primary:    string;
  accent:     string;
}

/** Composition rules that downstream layout / spacing engines should obey.
 *  These are advisory (the layout engine still picks pixel positions) but
 *  they pin the *feel* across the gallery so two variations don't read as
 *  belonging to different campaigns. */
export interface CompositionRules {
  spacing:     "tight" | "balanced" | "airy";
  hierarchy:   "single_focal" | "dual_zone" | "multi_card";
  emphasis:    "headline" | "subject" | "cta";
  whitespace:  "minimal" | "normal" | "generous";
  contrast:    "high" | "medium" | "soft";
}

/** The full plan. Persisted to job.result for ops + UI debugging. */
export interface DesignBrainPlan {
  domain:      DesignDomain | "general";
  visualStyle: VisualStyle;
  palette:     DesignPalette;
  layout:      LayoutType;
  assetType:   AssetType;
  typography:  TypographyStyle;
  composition: CompositionRules;
  /** Direct, domain-correct CTA copy (e.g. "JOIN NOW", "BOOK NOW"). */
  ctaSuggestion: string;
  /** How many templates the inline pipeline should produce. The Design
   *  Brain hard-clamps this to 3-4 per the strict-quality contract. */
  templateCount: number;
  /** Confidence in the domain inference (1.0 = direct keyword hit, 0.0 =
   *  fallback to general). Surfaced for ops; not used for branching. */
  confidence:    number;
  /** Stage timing for logging (filled by buildDesignBrain itself). */
  elapsedMs:     number;
}

/** Per-domain creative defaults. Ordered so the priority CTA, palette and
 *  asset-type for "fitness" are obvious at a glance and easy to audit. */
const DOMAIN_PROFILES: Record<DesignDomain, {
  visualStyle: VisualStyle;
  palette:     DesignPalette;
  layout:      LayoutType;
  assetType:   AssetType;
  typography:  TypographyStyle;
  composition: CompositionRules;
  cta:         string;
}> = {
  fitness: {
    visualStyle: "bold",
    palette:     { background: "#0A0A0F", primary: "#FF3B30", accent: "#FFD60A" },
    layout:      "hero",
    assetType:   "fitness_visuals",
    typography:  "bold_headline",
    composition: { spacing: "tight", hierarchy: "single_focal", emphasis: "headline",
                   whitespace: "minimal", contrast: "high" },
    cta:         "JOIN NOW",
  },
  wellness: {
    visualStyle: "warm",
    palette:     { background: "#F5EFE6", primary: "#3B5D50", accent: "#D9A36C" },
    layout:      "split",
    assetType:   "wellness_visuals",
    typography:  "editorial_serif",
    composition: { spacing: "airy", hierarchy: "dual_zone", emphasis: "subject",
                   whitespace: "generous", contrast: "soft" },
    cta:         "BEGIN",
  },
  business: {
    visualStyle: "minimal",
    palette:     { background: "#FFFFFF", primary: "#0A2540", accent: "#1F7AE0" },
    layout:      "split",
    assetType:   "business_visuals",
    typography:  "modern_sans",
    composition: { spacing: "balanced", hierarchy: "dual_zone", emphasis: "headline",
                   whitespace: "normal", contrast: "high" },
    cta:         "GET STARTED",
  },
  education: {
    visualStyle: "playful",
    palette:     { background: "#FFF8E7", primary: "#1E40AF", accent: "#F59E0B" },
    layout:      "card",
    assetType:   "education_visuals",
    typography:  "rounded_friendly",
    composition: { spacing: "balanced", hierarchy: "multi_card", emphasis: "headline",
                   whitespace: "normal", contrast: "medium" },
    cta:         "LEARN MORE",
  },
  travel: {
    visualStyle: "warm",
    palette:     { background: "#0E2742", primary: "#F97316", accent: "#FACC15" },
    layout:      "hero",
    assetType:   "travel_visuals",
    typography:  "editorial_serif",
    composition: { spacing: "balanced", hierarchy: "single_focal", emphasis: "subject",
                   whitespace: "normal", contrast: "high" },
    cta:         "BOOK NOW",
  },
  beauty: {
    visualStyle: "luxury",
    palette:     { background: "#1A0E14", primary: "#E8C4B0", accent: "#C7A17A" },
    layout:      "split",
    assetType:   "beauty_visuals",
    typography:  "editorial_serif",
    composition: { spacing: "airy", hierarchy: "single_focal", emphasis: "subject",
                   whitespace: "generous", contrast: "medium" },
    cta:         "DISCOVER",
  },
  marketing: {
    visualStyle: "bold",
    palette:     { background: "#FFD60A", primary: "#0A0A0F", accent: "#FF3B30" },
    layout:      "hero",
    assetType:   "marketing_visuals",
    typography:  "bold_headline",
    composition: { spacing: "tight", hierarchy: "single_focal", emphasis: "cta",
                   whitespace: "minimal", contrast: "high" },
    cta:         "SHOP NOW",
  },
  motivation: {
    visualStyle: "playful",
    palette:     { background: "#0F172A", primary: "#A855F7", accent: "#FACC15" },
    layout:      "stack",
    assetType:   "motivation_visuals",
    typography:  "bold_headline",
    composition: { spacing: "balanced", hierarchy: "single_focal", emphasis: "headline",
                   whitespace: "normal", contrast: "high" },
    cta:         "RISE",
  },
  productivity: {
    visualStyle: "minimal",
    palette:     { background: "#F5F5F4", primary: "#0F172A", accent: "#10B981" },
    layout:      "grid",
    assetType:   "productivity_visuals",
    typography:  "modern_sans",
    composition: { spacing: "balanced", hierarchy: "multi_card", emphasis: "headline",
                   whitespace: "normal", contrast: "medium" },
    cta:         "TRY IT",
  },
};

/** The "general" fallback profile — used when no domain keyword matched.
 *  Deliberately a strong, modern, contrast-rich preset rather than a
 *  pastel template, because the strict-quality contract forbids weak
 *  fallbacks even when the prompt is ambiguous. */
const GENERAL_PROFILE = {
  visualStyle: "modern" as VisualStyle,
  palette:     { background: "#0F172A", primary: "#FFFFFF", accent: "#3B82F6" },
  layout:      "hero" as LayoutType,
  assetType:   "generic_modern" as AssetType,
  typography:  "modern_sans" as TypographyStyle,
  composition: {
    spacing:    "balanced" as const,
    hierarchy:  "single_focal" as const,
    emphasis:   "headline" as const,
    whitespace: "normal" as const,
    contrast:   "high" as const,
  },
  cta:         "GET STARTED",
};

/** How many candidates the inline pipeline should produce. Hard-clamped
 *  to the 3-4 range — strict quality contract; never generate more in
 *  the hope of filtering later. */
export const DESIGN_BRAIN_TEMPLATE_COUNT = 4;
export const DESIGN_BRAIN_MIN_TEMPLATE_COUNT = 3;

/** Build a deterministic design plan for the given prompt. Optional
 *  briefCategory, when provided, lets a caller that already ran
 *  brief analysis skip the keyword inference and pin the domain
 *  directly — used by inlineGenerate when the brief stage already
 *  produced a category. Caller-supplied requestedCount is clamped
 *  to the strict 3-4 floor/ceiling. */
export function buildDesignBrain(opts: {
  prompt:           string;
  briefCategory?:   AssetCategory | null;
  requestedCount?:  number;
}): DesignBrainPlan {
  const t0 = Date.now();
  const prompt = (opts.prompt ?? "").trim();

  // Domain inference: prefer the brief's already-stamped category, fall
  // back to the same keyword inference the asset library uses so the
  // Design Brain and the asset selector never disagree.
  const domain: DesignDomain | null =
    opts.briefCategory ??
    inferCategoryFromText(prompt) ??
    null;

  const profile = domain ? DOMAIN_PROFILES[domain] : GENERAL_PROFILE;

  const requested = opts.requestedCount ?? DESIGN_BRAIN_TEMPLATE_COUNT;
  const templateCount = Math.max(
    DESIGN_BRAIN_MIN_TEMPLATE_COUNT,
    Math.min(DESIGN_BRAIN_TEMPLATE_COUNT, Math.floor(requested)),
  );

  // Confidence: 1.0 when the brief already gave us a domain, 0.85 when
  // we inferred it from the prompt directly, 0.0 when we fell back to
  // the general profile. Surfaced in the log so ops can see at a
  // glance whether a weak gallery came from a weak prompt.
  const confidence =
    opts.briefCategory ? 1.0 :
    domain             ? 0.85 :
                         0.0;

  return {
    domain:        domain ?? "general",
    visualStyle:   profile.visualStyle,
    palette:       profile.palette,
    layout:        profile.layout,
    assetType:     profile.assetType,
    typography:    profile.typography,
    composition:   profile.composition,
    ctaSuggestion: profile.cta,
    templateCount,
    confidence,
    elapsedMs:     Date.now() - t0,
  };
}

/** Decide whether a rendered candidate's subject category matches the
 *  Design Brain's chosen domain. Used to reject off-domain candidates
 *  before they're admitted to the gallery — the strict contract says
 *  a fitness brief never ships floral/wedding visuals.
 *
 *  Mismatch is only flagged when:
 *    1. Design Brain pinned a real domain (not "general"),
 *    2. the candidate carried a non-empty subject category, AND
 *    3. that subject category disagrees with the domain.
 *
 *  Candidates with no subject (text-only fallback) are caught earlier
 *  by the existing rules engine; this gate is specifically for
 *  visually-rich candidates that ended up depicting the wrong thing. */
export function isDomainMatch(
  plan:             Pick<DesignBrainPlan, "domain">,
  subjectCategory:  string | null | undefined,
): boolean {
  if (plan.domain === "general") return true;
  const c = (subjectCategory ?? "").toLowerCase().trim();
  if (!c) return true; // no subject → not a domain mismatch (other gates apply)
  return c === plan.domain;
}
