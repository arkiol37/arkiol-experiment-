// src/engines/inspiration/pattern-types.ts
//
// Core types for design inspiration patterns extracted from high-quality
// real-world references (social media templates, ads, landing pages, posters).
//
// Patterns are abstract representations — they capture the "why it works"
// (color relationships, spacing ratios, type hierarchy) not the "what it looks like"
// (specific images, exact copy). This prevents copying while enabling learning.

// ── Pattern source categories ───────────────────────────────────────────────

export type PatternSource =
  | "social_ad"         // Instagram/Facebook/TikTok paid ads
  | "social_organic"    // Organic social posts
  | "landing_page"      // SaaS/ecommerce landing pages
  | "email_hero"        // Email header sections
  | "poster"            // Print/digital posters
  | "product_page"      // Product detail pages
  | "editorial"         // Magazine/blog layouts
  | "branding";         // Brand identity work

export type PatternCategory =
  | "ecommerce"
  | "saas"
  | "food"
  | "fashion"
  | "wellness"
  | "tech"
  | "events"
  | "education"
  | "finance"
  | "creative";

// ── Color relationship pattern ──────────────────────────────────────────────

export interface ColorRelationship {
  strategy: "monochrome" | "complementary" | "analogous" | "triadic" | "split_complementary" | "dark_accent" | "light_accent";
  dominantRole: "background" | "text" | "accent";
  contrastLevel: "low" | "medium" | "high" | "extreme";
  warmth: "cool" | "neutral" | "warm";
  saturationProfile: "muted" | "balanced" | "vivid";
}

// ── Typography pattern ──────────────────────────────────────────────────────

export interface TypographyPattern {
  headlineStyle: "ultra_bold" | "bold" | "medium" | "light" | "condensed";
  bodyStyle: "regular" | "light" | "medium";
  pairingType: "serif_sans" | "sans_sans" | "display_sans" | "mono_sans" | "slab_sans";
  headlineCase: "uppercase" | "title_case" | "sentence_case";
  trackingProfile: "tight" | "normal" | "wide" | "ultra_wide";
  sizeRatio: number;
}

// ── Spacing pattern ─────────────────────────────────────────────────────────

export interface SpacingPattern {
  density: "airy" | "balanced" | "compact" | "tight";
  verticalRhythm: "even" | "progressive" | "dramatic";
  marginStyle: "generous" | "standard" | "tight" | "bleed";
  contentAlignment: "left" | "center" | "right" | "mixed";
}

// ── Decoration pattern ──────────────────────────────────────────────────────

export interface DecorationPattern {
  complexity: "none" | "minimal" | "moderate" | "rich" | "maximalist";
  primaryShapes: Array<"geometric" | "organic" | "line" | "dot" | "gradient_blob" | "frame" | "texture">;
  placementStrategy: "corner" | "edge" | "scattered" | "layered" | "framing";
  opacity: "solid" | "semi_transparent" | "subtle";
}

// ── Layout structure pattern ────────────────────────────────────────────────

export interface LayoutStructurePattern {
  flow: "top_down" | "left_right" | "split" | "centered" | "z_pattern" | "f_pattern" | "diagonal";
  heroElement: "text" | "image" | "both" | "graphic";
  ctaPlacement: "bottom" | "center" | "inline" | "floating" | "none";
  whitespaceUsage: "minimal" | "balanced" | "generous" | "dramatic";
}

// ── Complete design pattern ─────────────────────────────────────────────────

export interface DesignPattern {
  id: string;
  name: string;
  source: PatternSource;
  categories: PatternCategory[];
  tones: string[];
  colorRelationship: ColorRelationship;
  typography: TypographyPattern;
  spacing: SpacingPattern;
  decoration: DecorationPattern;
  layout: LayoutStructurePattern;
  engagementSignals: string[];
  freshness: number;
}

// ── Pattern application hint — what the pattern suggests for generation ──────

export interface PatternApplicationHint {
  patternId: string;
  patternName: string;
  relevanceScore: number;

  themeModifiers: {
    headlineSizeMultiplier?: number;
    headlineWeight?: number;
    headlineLetterSpacing?: number;
    headlineCase?: "uppercase" | "none";
    saturationBias?: number;
    warmthShift?: number;
    contrastBoost?: number;
    overlayOpacity?: number;
  };

  decorationHints: {
    targetComplexity: DecorationPattern["complexity"];
    preferredShapes: DecorationPattern["primaryShapes"];
    placementStrategy: DecorationPattern["placementStrategy"];
  };

  spacingHints: {
    density: SpacingPattern["density"];
    alignment: SpacingPattern["contentAlignment"];
  };

  ctaHints: {
    radiusBias: "sharp" | "rounded" | "pill";
    shadow: boolean;
    emphasis: "strong" | "subtle" | "none";
  };
}
