// src/engines/campaign/template-packs.ts
// ══════════════════════════════════════════════════════════════════════════════
// TEMPLATE PACKS — Canonical Pack Catalog
// ══════════════════════════════════════════════════════════════════════════════
//
// A TemplatePack is a curated collection of formats optimised for a specific
// use case. The user supplies only a prompt + optional brandId and gets back
// a full multi-format generation batch.
//
// Packs are consumed by POST /api/generate/pack, which:
//   1. Looks up the pack by ID
//   2. Runs buildCampaignPlan() with the pack's forced objective + formats
//   3. Creates a BatchJob (PRO/STUDIO) or a single campaign Job (CREATOR)
//   4. Returns batchId + estimated credits
//
// Pack formats use the same format keys as /api/generate (validated against
// FORMAT_DIMS). Unrecognised format keys are filtered at the route level.

export interface TemplatePack {
  id:                 string;
  name:               string;
  description:        string;
  emoji:              string;
  category:           "social" | "marketing" | "brand" | "print" | "ecommerce" | "event";
  formats:            string[];                         // ordered — hero first
  defaultVariations:  number;
  objective:          "awareness" | "engagement" | "conversion" | "retention" | "announcement";
  recommendedTones:   string[];
  accentColor:        string;                           // UI display color
  examplePrompt:      string;                           // shown in picker UI
  requiredPlan:       "CREATOR" | "PRO" | "STUDIO";    // minimum plan to use
  estimatedCredits:   number;                           // base (1 variation, no GIF, no HQ)
}

export const TEMPLATE_PACKS: TemplatePack[] = [
  // ── Social ─────────────────────────────────────────────────────────────────
  {
    id:               "social_full_set",
    name:             "Social Media Full Set",
    description:      "Complete organic social kit: square post + story + YouTube thumbnail",
    emoji:            "📱",
    category:         "social",
    formats:          ["instagram_post", "instagram_story", "youtube_thumbnail"],
    defaultVariations: 2,
    objective:        "engagement",
    recommendedTones: ["bold", "playful", "energetic"],
    accentColor:      "#f472b6",
    examplePrompt:    "Announce our new product line with vibrant bold graphics",
    requiredPlan:     "CREATOR",
    estimatedCredits: 3,
  },
  {
    id:               "launch_bundle",
    name:             "Product Launch Bundle",
    description:      "Everything for a launch day: post + story + flyer + YouTube thumbnail",
    emoji:            "🚀",
    category:         "marketing",
    formats:          ["instagram_post", "instagram_story", "flyer", "youtube_thumbnail"],
    defaultVariations: 2,
    objective:        "announcement",
    recommendedTones: ["bold", "urgent", "energetic"],
    accentColor:      "#818cf8",
    examplePrompt:    "Launch our new SaaS platform — bold, tech-forward, dark theme",
    requiredPlan:     "PRO",
    estimatedCredits: 4,
  },
  {
    id:               "seasonal_sale",
    name:             "Seasonal Sale Campaign",
    description:      "High-conversion sale pack: post + story + flyer + poster",
    emoji:            "🛍️",
    category:         "ecommerce",
    formats:          ["instagram_post", "instagram_story", "flyer", "poster"],
    defaultVariations: 3,
    objective:        "conversion",
    recommendedTones: ["urgent", "bold"],
    accentColor:      "#f59e0b",
    examplePrompt:    "Summer sale 50% off everything — warm golden tones, high energy",
    requiredPlan:     "PRO",
    estimatedCredits: 4,
  },
  {
    id:               "brand_identity_kit",
    name:             "Brand Identity Kit",
    description:      "Build a cohesive visual identity: logo + business card + presentation slide",
    emoji:            "◈",
    category:         "brand",
    formats:          ["logo", "business_card", "presentation_slide"],
    defaultVariations: 2,
    objective:        "awareness",
    recommendedTones: ["professional", "minimal", "luxury"],
    accentColor:      "#22d3ee",
    examplePrompt:    "Premium consulting agency — dark navy, gold accents, authoritative",
    requiredPlan:     "CREATOR",
    estimatedCredits: 3,
  },
  {
    id:               "agency_pitch_pack",
    name:             "Agency Pitch Pack",
    description:      "Full agency creative package: post + story + slide + flyer + poster",
    emoji:            "💼",
    category:         "marketing",
    formats:          ["instagram_post", "instagram_story", "presentation_slide", "flyer", "poster"],
    defaultVariations: 2,
    objective:        "awareness",
    recommendedTones: ["professional", "bold", "authoritative"],
    accentColor:      "#a5b4fc",
    examplePrompt:    "Pitch deck visuals for our creative agency — dark, sophisticated",
    requiredPlan:     "PRO",
    estimatedCredits: 5,
  },
  {
    id:               "event_promo",
    name:             "Event Promo Kit",
    description:      "Drive event attendance: poster + flyer + story + post",
    emoji:            "🎵",
    category:         "event",
    formats:          ["poster", "flyer", "instagram_story", "instagram_post"],
    defaultVariations: 2,
    objective:        "announcement",
    recommendedTones: ["energetic", "bold", "playful"],
    accentColor:      "#f87171",
    examplePrompt:    "Music festival weekend — vibrant neon palette, high energy",
    requiredPlan:     "CREATOR",
    estimatedCredits: 4,
  },
  {
    id:               "print_collateral",
    name:             "Print Collateral Set",
    description:      "Professional print materials: business card + flyer + poster",
    emoji:            "🖨️",
    category:         "print",
    formats:          ["business_card", "flyer", "poster"],
    defaultVariations: 2,
    objective:        "awareness",
    recommendedTones: ["professional", "minimal"],
    accentColor:      "#8b8ca6",
    examplePrompt:    "Professional services firm — clean, minimal, dark navy",
    requiredPlan:     "CREATOR",
    estimatedCredits: 3,
  },
  {
    id:               "content_creator_kit",
    name:             "Content Creator Kit",
    description:      "YouTube-focused: thumbnail + post + story with matching identity",
    emoji:            "🎙️",
    category:         "social",
    formats:          ["youtube_thumbnail", "instagram_post", "instagram_story"],
    defaultVariations: 3,
    objective:        "engagement",
    recommendedTones: ["playful", "bold", "energetic"],
    accentColor:      "#fbbf24",
    examplePrompt:    "Tech review YouTube channel — dark background, electric accent colors",
    requiredPlan:     "CREATOR",
    estimatedCredits: 3,
  },
  {
    id:               "studio_mega_pack",
    name:             "Studio Mega Pack",
    description:      "Maximum coverage: 7 formats, every major platform in one batch",
    emoji:            "⚡",
    category:         "marketing",
    formats:          [
      "instagram_post", "instagram_story", "youtube_thumbnail",
      "flyer", "poster", "business_card", "presentation_slide",
    ],
    defaultVariations: 2,
    objective:        "announcement",
    recommendedTones: ["bold", "professional"],
    accentColor:      "#4ade80",
    examplePrompt:    "Full brand campaign — consistent identity across all channels",
    requiredPlan:     "STUDIO",
    estimatedCredits: 7,
  },
  {
    id:               "ecommerce_ads",
    name:             "E-commerce Ads Pack",
    description:      "Drive purchases: post + story + flyer, conversion-optimised copy",
    emoji:            "🛒",
    category:         "ecommerce",
    formats:          ["instagram_post", "instagram_story", "flyer"],
    defaultVariations: 3,
    objective:        "conversion",
    recommendedTones: ["urgent", "warm", "playful"],
    accentColor:      "#fb923c",
    examplePrompt:    "Online fashion store — warm tones, product-focused, lifestyle feel",
    requiredPlan:     "CREATOR",
    estimatedCredits: 3,
  },
];

export function getPackById(id: string): TemplatePack | undefined {
  return TEMPLATE_PACKS.find(p => p.id === id);
}

export function getPacksByPlan(plan: string): TemplatePack[] {
  const PLAN_ORDER: Record<string, number> = { FREE: 0, CREATOR: 1, PRO: 2, STUDIO: 3 };
  const planRank = PLAN_ORDER[plan.toUpperCase()] ?? 0;
  return TEMPLATE_PACKS.filter(p => (PLAN_ORDER[p.requiredPlan] ?? 99) <= planRank);
}
