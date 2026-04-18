// src/engines/style/category-style-packs.ts
//
// Category-specific style packs for social media templates.
// Each pack defines palette behavior, typography mood, background treatment,
// accent style, and composition flavor so templates feel meaningfully
// different across content categories.
//
// Detection: brief text (intent + headline + subhead + keywords) is scanned
// for category keywords. The first matching pack is returned; packs are
// ordered by specificity so narrower categories match before broader ones.

import type { BriefAnalysis } from "../ai/brief-analyzer";
import type { BgTreatment, ThemeFont } from "../render/design-themes";

// ── CategoryStylePack interface ──────────────────────────────────────────────

export interface CategoryStylePack {
  /** Unique identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** Keywords scanned against brief text for detection (lowercase) */
  keywords: string[];

  // ── Palette behavior ──────────────────────────────────────────────────────
  /** Which design-theme IDs are best for this category (relevance boost) */
  preferredThemeIds: string[];
  /** Overall palette mood — guides theme scoring */
  paletteMood: "dark" | "light" | "vibrant" | "muted" | "warm" | "cool";

  // ── Typography mood ───────────────────────────────────────────────────────
  /** Preferred display font families (first match wins from available set) */
  preferredDisplayFonts: ThemeFont[];
  /** Preferred body font families */
  preferredBodyFonts: ThemeFont[];
  /** Headline size boost multiplier (applied on top of theme's own multiplier) */
  headlineSizeBoost: number;
  /** Whether headlines should prefer uppercase */
  preferUppercase: boolean;
  /** Letter-spacing adjustment for headlines (-0.03 = tight, 0.02 = tracked out) */
  headlineLetterSpacing: number;

  // ── Background treatment ──────────────────────────────────────────────────
  /** Which background kinds work best for this category */
  preferredBgKinds: BgTreatment["kind"][];

  // ── Accent style ──────────────────────────────────────────────────────────
  /** How strong the decorative accents should feel */
  accentIntensity: "subtle" | "moderate" | "bold";
  /** CTA button shape preference */
  ctaRadiusBias: "sharp" | "rounded" | "pill";

  // ── Composition flavor ────────────────────────────────────────────────────
  /** Preferred composition style (hint for layout engine) */
  compositionBias: "hero" | "editorial" | "poster" | "stacked" | "split" | "minimal";
  /** Preferred whitespace density */
  spacingDensity: "airy" | "balanced" | "compact";

  // ── Typography personality ──────────────────────────────────────────────
  /** Subhead contrast: how visually different the subhead should be from the headline */
  subheadContrast: "subtle" | "moderate" | "strong";
  /** Subhead letter spacing override (-0.02 = tight, 0.1 = tracked out) */
  subheadLetterSpacing: number;
  /** Subhead weight override (0 = use theme default) */
  subheadWeight: 0 | 300 | 400 | 500 | 600;
}

// ── Style Pack definitions ───────────────────────────────────────────────────
// 9 core categories + 1 generic fallback. Ordered by specificity for detection.

const PRODUCTIVITY_PACK: CategoryStylePack = {
  id: "productivity",
  name: "Productivity",
  keywords: ["productivity", "organize", "planner", "time management", "task", "workflow", "efficiency", "habit", "routine", "schedule", "notion", "to-do", "checklist"],
  preferredThemeIds: ["navy_pro", "clean_minimal", "sky_fresh", "modern_editorial"],
  paletteMood: "cool",
  preferredDisplayFonts: ["DM Sans", "Montserrat", "Poppins"],
  preferredBodyFonts: ["Lato", "DM Sans"],
  headlineSizeBoost: 1.0,
  preferUppercase: false,
  headlineLetterSpacing: -0.02,
  preferredBgKinds: ["solid", "linear_gradient"],
  accentIntensity: "subtle",
  ctaRadiusBias: "rounded",
  compositionBias: "stacked",
  spacingDensity: "airy",
  subheadContrast: "moderate",
  subheadLetterSpacing: 0.02,
  subheadWeight: 400,
};

const WELLNESS_PACK: CategoryStylePack = {
  id: "wellness",
  name: "Wellness",
  keywords: ["wellness", "self-care", "selfcare", "mindfulness", "meditation", "mental health", "calm", "relax", "breathing", "therapy", "healing", "balance", "holistic", "spiritual", "yoga"],
  preferredThemeIds: ["sage_wellness", "lavender_dream", "peach_bliss", "floral_romance"],
  paletteMood: "muted",
  preferredDisplayFonts: ["DM Sans", "Cormorant Garamond", "Nunito"],
  preferredBodyFonts: ["Lato", "Nunito"],
  headlineSizeBoost: 0.95,
  preferUppercase: false,
  headlineLetterSpacing: -0.01,
  preferredBgKinds: ["linear_gradient", "solid"],
  accentIntensity: "subtle",
  ctaRadiusBias: "pill",
  compositionBias: "minimal",
  spacingDensity: "airy",
  subheadContrast: "subtle",
  subheadLetterSpacing: 0.03,
  subheadWeight: 300,
};

const EDUCATION_PACK: CategoryStylePack = {
  id: "education",
  name: "Education",
  keywords: ["education", "learn", "course", "tutorial", "study", "student", "teacher", "school", "university", "training", "workshop", "webinar", "class", "lesson", "knowledge", "tips", "how to", "howto", "guide"],
  preferredThemeIds: ["sky_fresh", "lavender_dream", "clean_minimal", "navy_pro"],
  paletteMood: "light",
  preferredDisplayFonts: ["Poppins", "DM Sans", "Montserrat"],
  preferredBodyFonts: ["Lato", "DM Sans"],
  headlineSizeBoost: 1.05,
  preferUppercase: false,
  headlineLetterSpacing: -0.015,
  preferredBgKinds: ["solid", "linear_gradient"],
  accentIntensity: "moderate",
  ctaRadiusBias: "rounded",
  compositionBias: "stacked",
  spacingDensity: "balanced",
  subheadContrast: "moderate",
  subheadLetterSpacing: 0.01,
  subheadWeight: 400,
};

const BUSINESS_PACK: CategoryStylePack = {
  id: "business",
  name: "Business",
  keywords: ["business", "corporate", "b2b", "saas", "startup", "enterprise", "consulting", "finance", "investment", "strategy", "roi", "revenue", "growth", "leadership", "ceo", "founder", "pitch", "meeting"],
  preferredThemeIds: ["navy_pro", "dark_luxe", "clean_minimal", "modern_editorial"],
  paletteMood: "dark",
  preferredDisplayFonts: ["Montserrat", "Raleway", "Playfair Display"],
  preferredBodyFonts: ["Lato", "DM Sans"],
  headlineSizeBoost: 1.05,
  preferUppercase: false,
  headlineLetterSpacing: -0.025,
  preferredBgKinds: ["linear_gradient", "solid"],
  accentIntensity: "subtle",
  ctaRadiusBias: "sharp",
  compositionBias: "editorial",
  spacingDensity: "airy",
  subheadContrast: "strong",
  subheadLetterSpacing: 0.04,
  subheadWeight: 500,
};

const BEAUTY_PACK: CategoryStylePack = {
  id: "beauty",
  name: "Beauty",
  keywords: ["beauty", "skincare", "skin care", "makeup", "cosmetic", "glow", "serum", "moisturizer", "facial", "hair care", "haircare", "nail", "spa", "salon", "aesthetic", "derma"],
  preferredThemeIds: ["floral_romance", "peach_bliss", "lavender_dream", "clean_minimal"],
  paletteMood: "warm",
  preferredDisplayFonts: ["Cormorant Garamond", "Playfair Display", "Nunito"],
  preferredBodyFonts: ["Lato", "Nunito"],
  headlineSizeBoost: 0.95,
  preferUppercase: false,
  headlineLetterSpacing: -0.005,
  preferredBgKinds: ["linear_gradient", "solid", "radial_gradient"],
  accentIntensity: "subtle",
  ctaRadiusBias: "pill",
  compositionBias: "editorial",
  spacingDensity: "airy",
  subheadContrast: "subtle",
  subheadLetterSpacing: 0.02,
  subheadWeight: 300,
};

const FITNESS_PACK: CategoryStylePack = {
  id: "fitness",
  name: "Fitness",
  keywords: ["fitness", "workout", "gym", "exercise", "training", "muscle", "bodybuilding", "cardio", "hiit", "crossfit", "strength", "protein", "athlete", "sport", "run", "marathon"],
  preferredThemeIds: ["vibrant_burst", "power_black", "coral_energy", "sunset_warm"],
  paletteMood: "vibrant",
  preferredDisplayFonts: ["Oswald", "Montserrat", "Raleway"],
  preferredBodyFonts: ["Lato", "Poppins"],
  headlineSizeBoost: 1.15,
  preferUppercase: true,
  headlineLetterSpacing: 0.02,
  preferredBgKinds: ["mesh", "linear_gradient", "solid"],
  accentIntensity: "bold",
  ctaRadiusBias: "sharp",
  compositionBias: "hero",
  spacingDensity: "compact",
  subheadContrast: "strong",
  subheadLetterSpacing: 0.04,
  subheadWeight: 600,
};

const TRAVEL_PACK: CategoryStylePack = {
  id: "travel",
  name: "Travel",
  keywords: ["travel", "vacation", "holiday", "destination", "adventure", "explore", "trip", "flight", "hotel", "beach", "island", "cruise", "backpack", "tourism", "wanderlust", "passport"],
  preferredThemeIds: ["ocean_blue", "tropical_paradise", "sky_fresh", "sunset_warm"],
  paletteMood: "vibrant",
  preferredDisplayFonts: ["Poppins", "Raleway", "Montserrat"],
  preferredBodyFonts: ["Lato", "Nunito"],
  headlineSizeBoost: 1.1,
  preferUppercase: false,
  headlineLetterSpacing: -0.02,
  preferredBgKinds: ["linear_gradient", "mesh"],
  accentIntensity: "moderate",
  ctaRadiusBias: "pill",
  compositionBias: "hero",
  spacingDensity: "balanced",
  subheadContrast: "moderate",
  subheadLetterSpacing: 0.01,
  subheadWeight: 400,
};

const MOTIVATION_PACK: CategoryStylePack = {
  id: "motivation",
  name: "Motivation",
  keywords: ["motivation", "motivational", "inspire", "inspiration", "quote", "mindset", "success", "hustle", "grind", "dream", "believe", "goals", "affirmation", "positivity", "empower", "discipline"],
  preferredThemeIds: ["golden_hour", "power_black", "dark_luxe", "cosmic_purple"],
  paletteMood: "dark",
  preferredDisplayFonts: ["Raleway", "Playfair Display", "Oswald"],
  preferredBodyFonts: ["Lato"],
  headlineSizeBoost: 1.2,
  preferUppercase: true,
  headlineLetterSpacing: 0.01,
  preferredBgKinds: ["linear_gradient", "mesh", "solid"],
  accentIntensity: "moderate",
  ctaRadiusBias: "sharp",
  compositionBias: "poster",
  spacingDensity: "balanced",
  subheadContrast: "strong",
  subheadLetterSpacing: 0.05,
  subheadWeight: 300,
};

const MARKETING_PACK: CategoryStylePack = {
  id: "marketing",
  name: "Marketing",
  keywords: ["marketing", "sale", "promo", "promotion", "discount", "offer", "deal", "campaign", "ads", "advertising", "launch", "announcement", "flash sale", "limited", "exclusive", "new arrival", "shop now", "buy"],
  preferredThemeIds: ["vibrant_burst", "coral_energy", "retro_pop", "sunset_warm", "power_black"],
  paletteMood: "vibrant",
  preferredDisplayFonts: ["Montserrat", "Oswald", "Poppins"],
  preferredBodyFonts: ["Lato", "Poppins"],
  headlineSizeBoost: 1.15,
  preferUppercase: true,
  headlineLetterSpacing: 0.0,
  preferredBgKinds: ["mesh", "linear_gradient"],
  accentIntensity: "bold",
  ctaRadiusBias: "pill",
  compositionBias: "hero",
  spacingDensity: "compact",
  subheadContrast: "strong",
  subheadLetterSpacing: 0.03,
  subheadWeight: 600,
};

const FOOD_PACK: CategoryStylePack = {
  id: "food",
  name: "Food & Beverage",
  keywords: ["food", "restaurant", "recipe", "cooking", "chef", "menu", "dinner", "lunch", "breakfast", "brunch", "cafe", "bakery", "pizza", "sushi", "vegan", "dessert", "cocktail", "coffee", "tea", "drink", "beverage"],
  preferredThemeIds: ["sunset_warm", "earth_coffee", "peach_bliss", "vibrant_burst"],
  paletteMood: "warm",
  preferredDisplayFonts: ["Playfair Display", "Poppins", "Nunito"],
  preferredBodyFonts: ["Lato", "Nunito"],
  headlineSizeBoost: 1.05,
  preferUppercase: false,
  headlineLetterSpacing: -0.01,
  preferredBgKinds: ["linear_gradient", "solid", "mesh"],
  accentIntensity: "moderate",
  ctaRadiusBias: "rounded",
  compositionBias: "hero",
  spacingDensity: "balanced",
  subheadContrast: "moderate",
  subheadLetterSpacing: 0.01,
  subheadWeight: 400,
};

const FASHION_PACK: CategoryStylePack = {
  id: "fashion",
  name: "Fashion",
  keywords: ["fashion", "style", "outfit", "clothing", "apparel", "collection", "runway", "designer", "couture", "streetwear", "trend", "wardrobe", "accessories", "luxury brand"],
  preferredThemeIds: ["dark_luxe", "modern_editorial", "clean_minimal", "floral_romance"],
  paletteMood: "dark",
  preferredDisplayFonts: ["Cormorant Garamond", "Playfair Display", "Oswald"],
  preferredBodyFonts: ["Lato", "DM Sans"],
  headlineSizeBoost: 1.1,
  preferUppercase: true,
  headlineLetterSpacing: 0.02,
  preferredBgKinds: ["solid", "linear_gradient"],
  accentIntensity: "subtle",
  ctaRadiusBias: "sharp",
  compositionBias: "editorial",
  spacingDensity: "airy",
  subheadContrast: "strong",
  subheadLetterSpacing: 0.06,
  subheadWeight: 300,
};

const TECH_PACK: CategoryStylePack = {
  id: "tech",
  name: "Technology",
  keywords: ["tech", "technology", "software", "app", "digital", "ai", "artificial intelligence", "machine learning", "crypto", "blockchain", "web3", "data", "cloud", "cyber", "code", "developer", "programming"],
  preferredThemeIds: ["cosmic_purple", "navy_pro", "power_black", "clean_minimal"],
  paletteMood: "dark",
  preferredDisplayFonts: ["Raleway", "Montserrat", "Poppins"],
  preferredBodyFonts: ["Lato", "DM Sans"],
  headlineSizeBoost: 1.1,
  preferUppercase: false,
  headlineLetterSpacing: -0.025,
  preferredBgKinds: ["mesh", "linear_gradient"],
  accentIntensity: "moderate",
  ctaRadiusBias: "rounded",
  compositionBias: "split",
  spacingDensity: "balanced",
  subheadContrast: "moderate",
  subheadLetterSpacing: 0.02,
  subheadWeight: 400,
};

const REALESTATE_PACK: CategoryStylePack = {
  id: "realestate",
  name: "Real Estate",
  keywords: ["real estate", "realestate", "property", "home", "house", "apartment", "condo", "listing", "open house", "realtor", "broker", "mortgage", "interior", "architecture"],
  preferredThemeIds: ["clean_minimal", "modern_editorial", "navy_pro", "earth_coffee"],
  paletteMood: "light",
  preferredDisplayFonts: ["Playfair Display", "Montserrat", "DM Sans"],
  preferredBodyFonts: ["Lato", "DM Sans"],
  headlineSizeBoost: 1.0,
  preferUppercase: false,
  headlineLetterSpacing: -0.01,
  preferredBgKinds: ["solid", "linear_gradient"],
  accentIntensity: "subtle",
  ctaRadiusBias: "sharp",
  compositionBias: "editorial",
  spacingDensity: "airy",
  subheadContrast: "subtle",
  subheadLetterSpacing: 0.01,
  subheadWeight: 500,
};

// ── Registry ─────────────────────────────────────────────────────────────────
// Ordered from most specific to most generic for keyword matching.

export const CATEGORY_STYLE_PACKS: readonly CategoryStylePack[] = [
  PRODUCTIVITY_PACK,
  WELLNESS_PACK,
  EDUCATION_PACK,
  BEAUTY_PACK,
  FITNESS_PACK,
  TRAVEL_PACK,
  MOTIVATION_PACK,
  FOOD_PACK,
  FASHION_PACK,
  TECH_PACK,
  REALESTATE_PACK,
  BUSINESS_PACK,     // broad — should match after narrower categories
  MARKETING_PACK,    // broad — should match after narrower categories
];

// ── Detection ────────────────────────────────────────────────────────────────

/**
 * Detect the best-matching category style pack from the brief.
 * Scans intent, headline, subhead, and keywords for category keyword matches.
 * Returns the pack with the most keyword hits, or null if no match.
 */
export function detectCategoryPack(brief: BriefAnalysis): CategoryStylePack | null {
  const briefText = [
    brief.intent ?? "",
    brief.headline ?? "",
    brief.subhead ?? "",
    brief.body ?? "",
    ...(brief.keywords ?? []),
  ].join(" ").toLowerCase();

  let bestPack: CategoryStylePack | null = null;
  let bestScore = 0;

  for (const pack of CATEGORY_STYLE_PACKS) {
    let score = 0;
    for (const keyword of pack.keywords) {
      if (briefText.includes(keyword)) {
        // Longer keywords are more specific, give them more weight
        score += keyword.length >= 8 ? 3 : keyword.length >= 5 ? 2 : 1;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestPack = pack;
    }
  }

  return bestPack;
}

/**
 * Get a category style pack by ID. Returns null if not found.
 */
export function getCategoryPack(id: string): CategoryStylePack | null {
  return CATEGORY_STYLE_PACKS.find(p => p.id === id) ?? null;
}

/**
 * Map a paletteMood to the corresponding BriefAnalysis colorMood values
 * that would boost matching themes.
 */
export function paletteMoodToColorMoods(mood: CategoryStylePack["paletteMood"]): BriefAnalysis["colorMood"][] {
  switch (mood) {
    case "dark":    return ["dark", "monochrome"];
    case "light":   return ["light", "muted"];
    case "vibrant": return ["vibrant", "warm"];
    case "muted":   return ["muted", "light"];
    case "warm":    return ["warm", "light"];
    case "cool":    return ["cool", "muted"];
  }
}
