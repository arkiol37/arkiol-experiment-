// src/engines/inspiration/pattern-library.ts
//
// Curated library of abstract design patterns extracted from high-quality
// real-world references. Each pattern captures relationships (color strategy,
// type hierarchy, spacing rhythm) — never specific assets or copy.
//
// Patterns are grouped by source and category so the matcher can quickly
// narrow candidates based on brief context.

import type {
  DesignPattern,
  PatternSource,
  PatternCategory,
  ColorRelationship,
  TypographyPattern,
  SpacingPattern,
  DecorationPattern,
  LayoutStructurePattern,
} from "./pattern-types";

// ── Pattern Registry ───────────────────────────────────────────────────────

const PATTERNS: DesignPattern[] = [

  // ═══════════════════════════════════════════════════════════════════════════
  // § SOCIAL AD PATTERNS
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: "bold_sale_burst",
    name: "Bold Sale Burst",
    source: "social_ad",
    categories: ["ecommerce", "fashion"],
    tones: ["urgent", "bold", "energetic"],
    colorRelationship: {
      strategy: "complementary",
      dominantRole: "background",
      contrastLevel: "extreme",
      warmth: "warm",
      saturationProfile: "vivid",
    },
    typography: {
      headlineStyle: "ultra_bold",
      bodyStyle: "medium",
      pairingType: "sans_sans",
      headlineCase: "uppercase",
      trackingProfile: "tight",
      sizeRatio: 3.2,
    },
    spacing: {
      density: "compact",
      verticalRhythm: "dramatic",
      marginStyle: "tight",
      contentAlignment: "center",
    },
    decoration: {
      complexity: "moderate",
      primaryShapes: ["geometric", "line"],
      placementStrategy: "corner",
      opacity: "solid",
    },
    layout: {
      flow: "centered",
      heroElement: "text",
      ctaPlacement: "bottom",
      whitespaceUsage: "minimal",
    },
    engagementSignals: ["urgency", "price_anchor", "scarcity"],
    freshness: 0.85,
  },

  {
    id: "lifestyle_minimal",
    name: "Lifestyle Minimal",
    source: "social_ad",
    categories: ["wellness", "fashion", "food"],
    tones: ["calm", "elegant", "premium"],
    colorRelationship: {
      strategy: "monochrome",
      dominantRole: "background",
      contrastLevel: "medium",
      warmth: "neutral",
      saturationProfile: "muted",
    },
    typography: {
      headlineStyle: "light",
      bodyStyle: "light",
      pairingType: "serif_sans",
      headlineCase: "sentence_case",
      trackingProfile: "wide",
      sizeRatio: 2.0,
    },
    spacing: {
      density: "airy",
      verticalRhythm: "even",
      marginStyle: "generous",
      contentAlignment: "center",
    },
    decoration: {
      complexity: "none",
      primaryShapes: [],
      placementStrategy: "edge",
      opacity: "subtle",
    },
    layout: {
      flow: "centered",
      heroElement: "image",
      ctaPlacement: "bottom",
      whitespaceUsage: "dramatic",
    },
    engagementSignals: ["aspiration", "simplicity"],
    freshness: 0.78,
  },

  {
    id: "neon_gradient_pop",
    name: "Neon Gradient Pop",
    source: "social_ad",
    categories: ["tech", "events", "creative"],
    tones: ["bold", "energetic", "playful"],
    colorRelationship: {
      strategy: "analogous",
      dominantRole: "background",
      contrastLevel: "high",
      warmth: "cool",
      saturationProfile: "vivid",
    },
    typography: {
      headlineStyle: "bold",
      bodyStyle: "regular",
      pairingType: "sans_sans",
      headlineCase: "title_case",
      trackingProfile: "normal",
      sizeRatio: 2.8,
    },
    spacing: {
      density: "balanced",
      verticalRhythm: "progressive",
      marginStyle: "standard",
      contentAlignment: "center",
    },
    decoration: {
      complexity: "rich",
      primaryShapes: ["gradient_blob", "line", "dot"],
      placementStrategy: "layered",
      opacity: "semi_transparent",
    },
    layout: {
      flow: "centered",
      heroElement: "graphic",
      ctaPlacement: "bottom",
      whitespaceUsage: "balanced",
    },
    engagementSignals: ["novelty", "visual_impact"],
    freshness: 0.92,
  },

  {
    id: "social_proof_card",
    name: "Social Proof Card",
    source: "social_ad",
    categories: ["saas", "education", "finance"],
    tones: ["professional", "trustworthy", "informative"],
    colorRelationship: {
      strategy: "light_accent",
      dominantRole: "background",
      contrastLevel: "high",
      warmth: "cool",
      saturationProfile: "balanced",
    },
    typography: {
      headlineStyle: "bold",
      bodyStyle: "regular",
      pairingType: "sans_sans",
      headlineCase: "sentence_case",
      trackingProfile: "normal",
      sizeRatio: 2.2,
    },
    spacing: {
      density: "balanced",
      verticalRhythm: "even",
      marginStyle: "standard",
      contentAlignment: "left",
    },
    decoration: {
      complexity: "minimal",
      primaryShapes: ["line", "geometric"],
      placementStrategy: "edge",
      opacity: "solid",
    },
    layout: {
      flow: "top_down",
      heroElement: "text",
      ctaPlacement: "bottom",
      whitespaceUsage: "balanced",
    },
    engagementSignals: ["social_proof", "authority", "data"],
    freshness: 0.74,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // § SOCIAL ORGANIC PATTERNS
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: "carousel_educational",
    name: "Carousel Educational",
    source: "social_organic",
    categories: ["education", "saas", "tech"],
    tones: ["informative", "friendly", "professional"],
    colorRelationship: {
      strategy: "analogous",
      dominantRole: "background",
      contrastLevel: "high",
      warmth: "neutral",
      saturationProfile: "balanced",
    },
    typography: {
      headlineStyle: "bold",
      bodyStyle: "regular",
      pairingType: "sans_sans",
      headlineCase: "sentence_case",
      trackingProfile: "normal",
      sizeRatio: 2.4,
    },
    spacing: {
      density: "balanced",
      verticalRhythm: "progressive",
      marginStyle: "standard",
      contentAlignment: "left",
    },
    decoration: {
      complexity: "minimal",
      primaryShapes: ["geometric", "line"],
      placementStrategy: "corner",
      opacity: "solid",
    },
    layout: {
      flow: "top_down",
      heroElement: "text",
      ctaPlacement: "none",
      whitespaceUsage: "balanced",
    },
    engagementSignals: ["value", "clarity", "save_worthy"],
    freshness: 0.80,
  },

  {
    id: "quote_spotlight",
    name: "Quote Spotlight",
    source: "social_organic",
    categories: ["wellness", "creative", "education"],
    tones: ["inspiring", "calm", "thoughtful"],
    colorRelationship: {
      strategy: "monochrome",
      dominantRole: "background",
      contrastLevel: "medium",
      warmth: "warm",
      saturationProfile: "muted",
    },
    typography: {
      headlineStyle: "light",
      bodyStyle: "light",
      pairingType: "serif_sans",
      headlineCase: "sentence_case",
      trackingProfile: "wide",
      sizeRatio: 1.8,
    },
    spacing: {
      density: "airy",
      verticalRhythm: "even",
      marginStyle: "generous",
      contentAlignment: "center",
    },
    decoration: {
      complexity: "minimal",
      primaryShapes: ["line", "frame"],
      placementStrategy: "framing",
      opacity: "subtle",
    },
    layout: {
      flow: "centered",
      heroElement: "text",
      ctaPlacement: "none",
      whitespaceUsage: "generous",
    },
    engagementSignals: ["emotional", "share_worthy"],
    freshness: 0.68,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // § LANDING PAGE PATTERNS
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: "saas_hero_clean",
    name: "SaaS Hero Clean",
    source: "landing_page",
    categories: ["saas", "tech"],
    tones: ["professional", "trustworthy", "modern"],
    colorRelationship: {
      strategy: "light_accent",
      dominantRole: "background",
      contrastLevel: "high",
      warmth: "cool",
      saturationProfile: "balanced",
    },
    typography: {
      headlineStyle: "bold",
      bodyStyle: "regular",
      pairingType: "sans_sans",
      headlineCase: "sentence_case",
      trackingProfile: "tight",
      sizeRatio: 2.6,
    },
    spacing: {
      density: "airy",
      verticalRhythm: "progressive",
      marginStyle: "generous",
      contentAlignment: "center",
    },
    decoration: {
      complexity: "moderate",
      primaryShapes: ["gradient_blob", "dot"],
      placementStrategy: "layered",
      opacity: "semi_transparent",
    },
    layout: {
      flow: "split",
      heroElement: "both",
      ctaPlacement: "inline",
      whitespaceUsage: "generous",
    },
    engagementSignals: ["clarity", "trust", "demo_cta"],
    freshness: 0.82,
  },

  {
    id: "ecommerce_product_hero",
    name: "E-commerce Product Hero",
    source: "landing_page",
    categories: ["ecommerce", "fashion"],
    tones: ["bold", "premium", "confident"],
    colorRelationship: {
      strategy: "dark_accent",
      dominantRole: "background",
      contrastLevel: "extreme",
      warmth: "neutral",
      saturationProfile: "balanced",
    },
    typography: {
      headlineStyle: "condensed",
      bodyStyle: "light",
      pairingType: "display_sans",
      headlineCase: "uppercase",
      trackingProfile: "wide",
      sizeRatio: 3.0,
    },
    spacing: {
      density: "balanced",
      verticalRhythm: "dramatic",
      marginStyle: "standard",
      contentAlignment: "left",
    },
    decoration: {
      complexity: "minimal",
      primaryShapes: ["line", "geometric"],
      placementStrategy: "edge",
      opacity: "solid",
    },
    layout: {
      flow: "split",
      heroElement: "image",
      ctaPlacement: "inline",
      whitespaceUsage: "balanced",
    },
    engagementSignals: ["desire", "premium_feel", "product_focus"],
    freshness: 0.76,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // § EMAIL HERO PATTERNS
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: "email_announcement",
    name: "Email Announcement",
    source: "email_hero",
    categories: ["saas", "ecommerce", "tech"],
    tones: ["energetic", "friendly", "informative"],
    colorRelationship: {
      strategy: "complementary",
      dominantRole: "accent",
      contrastLevel: "high",
      warmth: "warm",
      saturationProfile: "vivid",
    },
    typography: {
      headlineStyle: "bold",
      bodyStyle: "regular",
      pairingType: "sans_sans",
      headlineCase: "title_case",
      trackingProfile: "normal",
      sizeRatio: 2.0,
    },
    spacing: {
      density: "compact",
      verticalRhythm: "even",
      marginStyle: "tight",
      contentAlignment: "center",
    },
    decoration: {
      complexity: "minimal",
      primaryShapes: ["geometric"],
      placementStrategy: "edge",
      opacity: "solid",
    },
    layout: {
      flow: "top_down",
      heroElement: "text",
      ctaPlacement: "center",
      whitespaceUsage: "minimal",
    },
    engagementSignals: ["urgency", "news", "click_through"],
    freshness: 0.71,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // § POSTER PATTERNS
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: "concert_poster_bold",
    name: "Concert Poster Bold",
    source: "poster",
    categories: ["events", "creative"],
    tones: ["bold", "energetic", "edgy"],
    colorRelationship: {
      strategy: "split_complementary",
      dominantRole: "background",
      contrastLevel: "extreme",
      warmth: "warm",
      saturationProfile: "vivid",
    },
    typography: {
      headlineStyle: "ultra_bold",
      bodyStyle: "medium",
      pairingType: "display_sans",
      headlineCase: "uppercase",
      trackingProfile: "tight",
      sizeRatio: 4.0,
    },
    spacing: {
      density: "tight",
      verticalRhythm: "dramatic",
      marginStyle: "bleed",
      contentAlignment: "center",
    },
    decoration: {
      complexity: "rich",
      primaryShapes: ["geometric", "texture", "line"],
      placementStrategy: "layered",
      opacity: "solid",
    },
    layout: {
      flow: "centered",
      heroElement: "text",
      ctaPlacement: "bottom",
      whitespaceUsage: "minimal",
    },
    engagementSignals: ["excitement", "visual_impact", "memorability"],
    freshness: 0.88,
  },

  {
    id: "minimalist_exhibition",
    name: "Minimalist Exhibition",
    source: "poster",
    categories: ["creative", "events", "education"],
    tones: ["elegant", "modern", "sophisticated"],
    colorRelationship: {
      strategy: "monochrome",
      dominantRole: "text",
      contrastLevel: "high",
      warmth: "cool",
      saturationProfile: "muted",
    },
    typography: {
      headlineStyle: "light",
      bodyStyle: "light",
      pairingType: "serif_sans",
      headlineCase: "uppercase",
      trackingProfile: "ultra_wide",
      sizeRatio: 2.5,
    },
    spacing: {
      density: "airy",
      verticalRhythm: "even",
      marginStyle: "generous",
      contentAlignment: "left",
    },
    decoration: {
      complexity: "none",
      primaryShapes: [],
      placementStrategy: "edge",
      opacity: "subtle",
    },
    layout: {
      flow: "top_down",
      heroElement: "text",
      ctaPlacement: "none",
      whitespaceUsage: "dramatic",
    },
    engagementSignals: ["sophistication", "brand_prestige"],
    freshness: 0.70,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // § PRODUCT PAGE PATTERNS
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: "food_delivery_vibrant",
    name: "Food Delivery Vibrant",
    source: "product_page",
    categories: ["food", "ecommerce"],
    tones: ["playful", "energetic", "warm"],
    colorRelationship: {
      strategy: "triadic",
      dominantRole: "background",
      contrastLevel: "high",
      warmth: "warm",
      saturationProfile: "vivid",
    },
    typography: {
      headlineStyle: "bold",
      bodyStyle: "regular",
      pairingType: "sans_sans",
      headlineCase: "title_case",
      trackingProfile: "normal",
      sizeRatio: 2.6,
    },
    spacing: {
      density: "balanced",
      verticalRhythm: "progressive",
      marginStyle: "standard",
      contentAlignment: "center",
    },
    decoration: {
      complexity: "moderate",
      primaryShapes: ["organic", "dot", "geometric"],
      placementStrategy: "scattered",
      opacity: "solid",
    },
    layout: {
      flow: "z_pattern",
      heroElement: "both",
      ctaPlacement: "floating",
      whitespaceUsage: "balanced",
    },
    engagementSignals: ["appetite_appeal", "convenience", "fun"],
    freshness: 0.84,
  },

  {
    id: "fintech_trust",
    name: "Fintech Trust",
    source: "product_page",
    categories: ["finance", "saas"],
    tones: ["trustworthy", "professional", "modern"],
    colorRelationship: {
      strategy: "analogous",
      dominantRole: "background",
      contrastLevel: "medium",
      warmth: "cool",
      saturationProfile: "balanced",
    },
    typography: {
      headlineStyle: "medium",
      bodyStyle: "regular",
      pairingType: "sans_sans",
      headlineCase: "sentence_case",
      trackingProfile: "normal",
      sizeRatio: 2.2,
    },
    spacing: {
      density: "airy",
      verticalRhythm: "even",
      marginStyle: "generous",
      contentAlignment: "center",
    },
    decoration: {
      complexity: "minimal",
      primaryShapes: ["line", "geometric"],
      placementStrategy: "edge",
      opacity: "subtle",
    },
    layout: {
      flow: "f_pattern",
      heroElement: "both",
      ctaPlacement: "inline",
      whitespaceUsage: "generous",
    },
    engagementSignals: ["security", "trust_signals", "clarity"],
    freshness: 0.73,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // § EDITORIAL PATTERNS
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: "magazine_feature",
    name: "Magazine Feature",
    source: "editorial",
    categories: ["fashion", "creative", "wellness"],
    tones: ["elegant", "premium", "sophisticated"],
    colorRelationship: {
      strategy: "monochrome",
      dominantRole: "background",
      contrastLevel: "high",
      warmth: "neutral",
      saturationProfile: "muted",
    },
    typography: {
      headlineStyle: "condensed",
      bodyStyle: "regular",
      pairingType: "serif_sans",
      headlineCase: "uppercase",
      trackingProfile: "wide",
      sizeRatio: 3.5,
    },
    spacing: {
      density: "balanced",
      verticalRhythm: "dramatic",
      marginStyle: "generous",
      contentAlignment: "mixed",
    },
    decoration: {
      complexity: "minimal",
      primaryShapes: ["line", "frame"],
      placementStrategy: "framing",
      opacity: "solid",
    },
    layout: {
      flow: "diagonal",
      heroElement: "image",
      ctaPlacement: "none",
      whitespaceUsage: "generous",
    },
    engagementSignals: ["aspiration", "brand_prestige", "visual_storytelling"],
    freshness: 0.77,
  },

  {
    id: "blog_card_modern",
    name: "Blog Card Modern",
    source: "editorial",
    categories: ["tech", "education", "saas"],
    tones: ["informative", "friendly", "modern"],
    colorRelationship: {
      strategy: "light_accent",
      dominantRole: "background",
      contrastLevel: "high",
      warmth: "neutral",
      saturationProfile: "balanced",
    },
    typography: {
      headlineStyle: "bold",
      bodyStyle: "regular",
      pairingType: "sans_sans",
      headlineCase: "sentence_case",
      trackingProfile: "normal",
      sizeRatio: 2.0,
    },
    spacing: {
      density: "balanced",
      verticalRhythm: "even",
      marginStyle: "standard",
      contentAlignment: "left",
    },
    decoration: {
      complexity: "minimal",
      primaryShapes: ["geometric", "line"],
      placementStrategy: "corner",
      opacity: "solid",
    },
    layout: {
      flow: "top_down",
      heroElement: "both",
      ctaPlacement: "inline",
      whitespaceUsage: "balanced",
    },
    engagementSignals: ["readability", "click_through", "value"],
    freshness: 0.72,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // § BRANDING PATTERNS
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: "luxury_brand_dark",
    name: "Luxury Brand Dark",
    source: "branding",
    categories: ["fashion", "creative"],
    tones: ["premium", "elegant", "sophisticated"],
    colorRelationship: {
      strategy: "dark_accent",
      dominantRole: "background",
      contrastLevel: "extreme",
      warmth: "neutral",
      saturationProfile: "muted",
    },
    typography: {
      headlineStyle: "light",
      bodyStyle: "light",
      pairingType: "serif_sans",
      headlineCase: "uppercase",
      trackingProfile: "ultra_wide",
      sizeRatio: 2.0,
    },
    spacing: {
      density: "airy",
      verticalRhythm: "even",
      marginStyle: "generous",
      contentAlignment: "center",
    },
    decoration: {
      complexity: "none",
      primaryShapes: [],
      placementStrategy: "edge",
      opacity: "subtle",
    },
    layout: {
      flow: "centered",
      heroElement: "text",
      ctaPlacement: "none",
      whitespaceUsage: "dramatic",
    },
    engagementSignals: ["prestige", "exclusivity", "memorability"],
    freshness: 0.65,
  },

  {
    id: "startup_fresh",
    name: "Startup Fresh",
    source: "branding",
    categories: ["saas", "tech", "creative"],
    tones: ["friendly", "modern", "playful"],
    colorRelationship: {
      strategy: "complementary",
      dominantRole: "background",
      contrastLevel: "high",
      warmth: "cool",
      saturationProfile: "vivid",
    },
    typography: {
      headlineStyle: "bold",
      bodyStyle: "regular",
      pairingType: "sans_sans",
      headlineCase: "sentence_case",
      trackingProfile: "normal",
      sizeRatio: 2.4,
    },
    spacing: {
      density: "balanced",
      verticalRhythm: "progressive",
      marginStyle: "standard",
      contentAlignment: "center",
    },
    decoration: {
      complexity: "moderate",
      primaryShapes: ["geometric", "gradient_blob", "dot"],
      placementStrategy: "scattered",
      opacity: "semi_transparent",
    },
    layout: {
      flow: "centered",
      heroElement: "both",
      ctaPlacement: "center",
      whitespaceUsage: "balanced",
    },
    engagementSignals: ["approachability", "innovation", "fun"],
    freshness: 0.86,
  },

  {
    id: "wellness_organic",
    name: "Wellness Organic",
    source: "branding",
    categories: ["wellness", "food"],
    tones: ["calm", "natural", "warm"],
    colorRelationship: {
      strategy: "analogous",
      dominantRole: "background",
      contrastLevel: "medium",
      warmth: "warm",
      saturationProfile: "muted",
    },
    typography: {
      headlineStyle: "medium",
      bodyStyle: "light",
      pairingType: "serif_sans",
      headlineCase: "sentence_case",
      trackingProfile: "wide",
      sizeRatio: 2.0,
    },
    spacing: {
      density: "airy",
      verticalRhythm: "even",
      marginStyle: "generous",
      contentAlignment: "center",
    },
    decoration: {
      complexity: "moderate",
      primaryShapes: ["organic", "line"],
      placementStrategy: "framing",
      opacity: "subtle",
    },
    layout: {
      flow: "centered",
      heroElement: "both",
      ctaPlacement: "bottom",
      whitespaceUsage: "generous",
    },
    engagementSignals: ["calm", "trust", "naturalness"],
    freshness: 0.75,
  },

  {
    id: "event_countdown",
    name: "Event Countdown",
    source: "social_ad",
    categories: ["events", "education"],
    tones: ["urgent", "energetic", "bold"],
    colorRelationship: {
      strategy: "split_complementary",
      dominantRole: "background",
      contrastLevel: "extreme",
      warmth: "warm",
      saturationProfile: "vivid",
    },
    typography: {
      headlineStyle: "ultra_bold",
      bodyStyle: "medium",
      pairingType: "display_sans",
      headlineCase: "uppercase",
      trackingProfile: "tight",
      sizeRatio: 3.5,
    },
    spacing: {
      density: "compact",
      verticalRhythm: "dramatic",
      marginStyle: "tight",
      contentAlignment: "center",
    },
    decoration: {
      complexity: "rich",
      primaryShapes: ["geometric", "line", "dot"],
      placementStrategy: "layered",
      opacity: "solid",
    },
    layout: {
      flow: "centered",
      heroElement: "text",
      ctaPlacement: "bottom",
      whitespaceUsage: "minimal",
    },
    engagementSignals: ["urgency", "fomo", "excitement"],
    freshness: 0.90,
  },

];

// ── Lookup API ─────────────────────────────────────────────────────────────

export function getAllPatterns(): readonly DesignPattern[] {
  return PATTERNS;
}

export function getPatternById(id: string): DesignPattern | undefined {
  return PATTERNS.find(p => p.id === id);
}

export function getPatternsBySource(source: PatternSource): DesignPattern[] {
  return PATTERNS.filter(p => p.source === source);
}

export function getPatternsByCategory(category: PatternCategory): DesignPattern[] {
  return PATTERNS.filter(p => p.categories.includes(category));
}

export function getPatternsByTone(tone: string): DesignPattern[] {
  return PATTERNS.filter(p => p.tones.includes(tone));
}

export function getFreshPatterns(minFreshness = 0.75): DesignPattern[] {
  return PATTERNS.filter(p => p.freshness >= minFreshness)
    .sort((a, b) => b.freshness - a.freshness);
}
