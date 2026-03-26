// src/engines/assets/asset-library.ts
// Structured AI-Driven Asset Library
// ─────────────────────────────────────────────────────────────────────────────
//
// Provides:
//   • Curated style packs — industry-specific asset sets (tech, fitness, food, etc.)
//   • Parametric asset generation — backgrounds, patterns, decorative elements
//   • Semantic asset tagging — structured metadata for retrieval
//   • Intelligent retrieval — context-aware asset selection based on layout,
//     palette, audience type and brand style
//
// Architecture:
//   • AssetPack:       curated collection of asset descriptors for an industry
//   • AssetDescriptor: a single retrievable asset with semantic tags
//   • AssetRetriever:  scores and ranks assets against a RetrievalContext
//   • ParametricGen:   generates SVG patterns/backgrounds inline (no external deps)
//
// Execution contract:
//   ✓ retrieveAssets() always returns >= 1 result (fallback chain guarantees this)
//   ✓ All generation is deterministic from a seed — same seed = same output
//   ✓ No HTTP calls — all generation is inline SVG or prompt strings
//   ✓ Semantic scoring uses only arithmetic — no ML inference

import { createHash } from "crypto";
import type { ExplorePipelineContext } from "../exploration/types";

// ─────────────────────────────────────────────────────────────────────────────
// § 1  TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type AssetIndustry =
  | "tech" | "fitness" | "food_beverage" | "fashion" | "finance" | "healthcare"
  | "education" | "entertainment" | "real_estate" | "travel" | "ecommerce" | "generic";

export type AssetMediaType = "background" | "pattern" | "texture" | "decoration" | "icon_set" | "gradient";

export type AssetMood = "energetic" | "calm" | "luxury" | "playful" | "professional" | "dark" | "minimal";

export interface AssetDescriptor {
  id: string;
  packId: string;
  mediaType: AssetMediaType;
  industry: AssetIndustry;
  moods: AssetMood[];
  /** Semantic tags for retrieval */
  tags: string[];
  /** Human-readable label */
  label: string;
  /** AI image generation prompt (used when external generation is available) */
  generationPrompt: string;
  /** Inline SVG fallback (returned when AI gen is unavailable) */
  inlineSvg?: string;
  /** Colour affinity — hex colours this asset pairs well with */
  colourAffinity: string[];
  /** Audience segments this asset resonates with */
  audienceAffinity: string[];
  /** Brand tones this asset aligns with */
  toneAffinity: string[];
  /** Whether this asset works on dark backgrounds */
  darkBgCompatible: boolean;
  /** Preferred zone placement */
  preferredZones: string[];
}

export interface AssetPack {
  packId: string;
  name: string;
  industry: AssetIndustry;
  assets: AssetDescriptor[];
  description: string;
}

export interface RetrievalContext {
  industry?: AssetIndustry;
  layoutType?: string;
  primaryColor?: string;
  audienceSegment?: string;
  toneKeywords?: string[];
  prefersDarkBg?: boolean;
  format?: string;
  mood?: AssetMood;
  seed?: string;
}

export interface RetrievedAsset extends AssetDescriptor {
  relevanceScore: number;
  retrievalReason: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// § 2  PARAMETRIC SVG GENERATION
// ─────────────────────────────────────────────────────────────────────────────

function seededRand(seed: string, index: number): number {
  const hash = createHash("sha256").update(`${seed}:${index}`).digest("hex");
  return parseInt(hash.slice(0, 8), 16) / 0xffffffff;
}

export function generateParametricBackground(
  seed: string,
  primaryColor: string = "#4f6ef7",
  style: "gradient" | "mesh" | "dots" | "waves" | "geometric" = "gradient"
): string {
  const r = (i: number) => seededRand(seed, i);

  // Derive complementary colour
  const hue1 = Math.floor(r(0) * 360);
  const hue2 = (hue1 + 30 + Math.floor(r(1) * 60)) % 360;
  const sat  = 40 + Math.floor(r(2) * 30);
  const lit1 = 25 + Math.floor(r(3) * 20);
  const lit2 = 60 + Math.floor(r(4) * 20);

  const c1 = `hsl(${hue1},${sat}%,${lit1}%)`;
  const c2 = `hsl(${hue2},${sat}%,${lit2}%)`;

  if (style === "gradient") {
    const angle = Math.floor(r(5) * 180);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="${Math.round(Math.cos(angle * Math.PI / 180) * 100)}%" y2="${Math.round(Math.sin(angle * Math.PI / 180) * 100)}%">
      <stop offset="0%" stop-color="${c1}"/>
      <stop offset="100%" stop-color="${c2}"/>
    </linearGradient>
  </defs>
  <rect width="1280" height="720" fill="url(#bg)"/>
</svg>`;
  }

  if (style === "geometric") {
    const shapes = Array.from({ length: 6 }, (_, i) => {
      const x = Math.floor(r(10 + i * 3) * 1280);
      const y = Math.floor(r(11 + i * 3) * 720);
      const size = 60 + Math.floor(r(12 + i * 3) * 200);
      const opacity = 0.05 + r(13 + i * 3) * 0.15;
      return `<rect x="${x}" y="${y}" width="${size}" height="${size}"
        fill="${i % 2 === 0 ? c2 : c1}" opacity="${opacity.toFixed(2)}"
        transform="rotate(${Math.floor(r(14 + i) * 45)}, ${x + size / 2}, ${y + size / 2})"/>`;
    }).join("\n  ");

    return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720">
  <rect width="1280" height="720" fill="${c1}"/>
  ${shapes}
</svg>`;
  }

  if (style === "dots") {
    const dotRows = 8;
    const dotCols = 14;
    const dots = Array.from({ length: dotRows * dotCols }, (_, i) => {
      const col = i % dotCols;
      const row = Math.floor(i / dotCols);
      const cx = 46 + col * (1280 / dotCols);
      const cy = 45 + row * (720 / dotRows);
      const r2 = 4 + Math.floor(r(20 + i) * 16);
      const opacity = 0.08 + r(30 + i) * 0.18;
      return `<circle cx="${cx}" cy="${cy}" r="${r2}" fill="${c2}" opacity="${opacity.toFixed(2)}"/>`;
    }).join("\n  ");

    return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720">
  <rect width="1280" height="720" fill="${c1}"/>
  ${dots}
</svg>`;
  }

  if (style === "waves") {
    const waveCount = 4 + Math.floor(r(40) * 3);
    const paths = Array.from({ length: waveCount }, (_, i) => {
      const yBase = 80 + (i * 720) / waveCount;
      const amp = 30 + Math.floor(r(50 + i) * 40);
      const opacity = 0.08 + i * 0.04;
      return `<path d="M0,${yBase} C320,${yBase - amp} 640,${yBase + amp} 960,${yBase} S1280,${yBase - amp} 1280,${yBase} L1280,720 L0,720 Z"
        fill="${c2}" opacity="${opacity.toFixed(2)}"/>`;
    }).join("\n  ");

    return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720">
  <rect width="1280" height="720" fill="${c1}"/>
  ${paths}
</svg>`;
  }

  // mesh fallback
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720">
  <defs>
    <radialGradient id="m1" cx="30%" cy="30%"><stop offset="0%" stop-color="${primaryColor}" stop-opacity="0.6"/><stop offset="100%" stop-color="${c1}" stop-opacity="0"/></radialGradient>
    <radialGradient id="m2" cx="70%" cy="70%"><stop offset="0%" stop-color="${c2}" stop-opacity="0.5"/><stop offset="100%" stop-color="${c1}" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="1280" height="720" fill="${c1}"/>
  <rect width="1280" height="720" fill="url(#m1)"/>
  <rect width="1280" height="720" fill="url(#m2)"/>
</svg>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// § 3  ASSET PACK DEFINITIONS
// ─────────────────────────────────────────────────────────────────────────────

function makeAsset(
  id: string,
  packId: string,
  industry: AssetIndustry,
  mediaType: AssetMediaType,
  label: string,
  moods: AssetMood[],
  tags: string[],
  generationPrompt: string,
  opts: Partial<AssetDescriptor> = {}
): AssetDescriptor {
  return {
    id,
    packId,
    industry,
    mediaType,
    label,
    moods,
    tags,
    generationPrompt,
    colourAffinity: opts.colourAffinity ?? [],
    audienceAffinity: opts.audienceAffinity ?? ["general"],
    toneAffinity: opts.toneAffinity ?? ["neutral"],
    darkBgCompatible: opts.darkBgCompatible ?? false,
    preferredZones: opts.preferredZones ?? ["background", "image"],
    inlineSvg: opts.inlineSvg,
  };
}

const ASSET_PACKS: AssetPack[] = [

  // ── Tech Pack ──────────────────────────────────────────────────────────────
  {
    packId: "tech_core",
    name: "Tech & SaaS",
    industry: "tech",
    description: "Clean digital aesthetics, code patterns, circuit motifs, abstract data",
    assets: [
      makeAsset("tech_bg_circuit", "tech_core", "tech", "background", "Circuit Board Pattern",
        ["professional", "dark"], ["tech", "code", "circuit", "digital", "precision"],
        "Abstract circuit board pattern, dark background, glowing teal/cyan traces, PCB aesthetic, professional, clean",
        { colourAffinity: ["#0a0a0a", "#00d4ff", "#1a1a2e"], darkBgCompatible: true, toneAffinity: ["tech", "modern", "professional"] }),
      makeAsset("tech_bg_data", "tech_core", "tech", "background", "Data Flow Abstract",
        ["professional", "dark", "energetic"], ["data", "flow", "abstract", "digital", "analytics"],
        "Abstract data flow visualization, glowing lines on dark background, blue and purple gradients, data streams",
        { colourAffinity: ["#0f0c29", "#302b63", "#24243e"], darkBgCompatible: true }),
      makeAsset("tech_bg_mesh", "tech_core", "tech", "background", "Mesh Gradient Digital",
        ["professional", "minimal", "calm"], ["gradient", "mesh", "clean", "digital", "saas"],
        "Smooth mesh gradient background, soft blue and purple tones, clean modern tech aesthetic",
        { colourAffinity: ["#4f6ef7", "#6c63ff", "#f8faff"], toneAffinity: ["modern", "clean"] }),
      makeAsset("tech_pattern_grid", "tech_core", "tech", "pattern", "Dot Grid Overlay",
        ["minimal", "professional"], ["grid", "dots", "minimal", "overlay", "blueprint"],
        "Subtle dot grid pattern, light grey on white, minimal blueprint aesthetic",
        { preferredZones: ["background"], toneAffinity: ["minimal", "clean"] }),
    ],
  },

  // ── Fitness Pack ───────────────────────────────────────────────────────────
  {
    packId: "fitness_core",
    name: "Fitness & Sport",
    industry: "fitness",
    description: "High energy athletics, motivational, dynamic motion, bold geometry",
    assets: [
      makeAsset("fit_bg_dynamic", "fitness_core", "fitness", "background", "Dynamic Motion Blur",
        ["energetic"], ["sport", "motion", "blur", "dynamic", "athletic", "speed"],
        "High-speed motion blur background, vibrant orange and red gradients, dynamic athletic energy, abstract",
        { colourAffinity: ["#ff4500", "#ff6b00", "#1a1a1a"], darkBgCompatible: true }),
      makeAsset("fit_bg_grit", "fitness_core", "fitness", "background", "Grit Texture Dark",
        ["energetic", "dark"], ["texture", "grit", "dark", "raw", "gym", "bold"],
        "Dark concrete texture with subtle grain, high contrast, masculine gym aesthetic",
        { colourAffinity: ["#1a1a1a", "#2d2d2d", "#ff4500"], darkBgCompatible: true }),
      makeAsset("fit_bg_light", "fitness_core", "fitness", "background", "Clean White Performance",
        ["minimal", "energetic"], ["clean", "white", "performance", "light", "athletic"],
        "Clean white background with subtle geometric shapes, fresh athletic feel, minimal",
        { colourAffinity: ["#ffffff", "#f5f5f5", "#00c4ff"] }),
      makeAsset("fit_decoration_badge", "fitness_core", "fitness", "decoration", "Challenge Badge Frame",
        ["energetic"], ["badge", "challenge", "award", "bold", "frame"],
        "Bold hexagonal badge frame design, thick borders, achievement aesthetic",
        { preferredZones: ["overlay", "badge"] }),
    ],
  },

  // ── Food & Beverage Pack ───────────────────────────────────────────────────
  {
    packId: "food_core",
    name: "Food & Beverage",
    industry: "food_beverage",
    description: "Appetising textures, warm palettes, fresh ingredients, lifestyle",
    assets: [
      makeAsset("food_bg_warm", "food_core", "food_beverage", "background", "Warm Rustic Wood",
        ["calm", "professional"], ["wood", "rustic", "warm", "food", "restaurant", "cozy"],
        "Warm rustic wooden table texture, shallow depth of field, soft natural lighting, food photography background",
        { colourAffinity: ["#8b5e3c", "#d4a574", "#fff8f0"] }),
      makeAsset("food_bg_dark", "food_core", "food_beverage", "background", "Dark Slate Premium",
        ["luxury", "dark"], ["dark", "slate", "premium", "restaurant", "fine dining"],
        "Dark slate or marble background, premium restaurant aesthetic, subtle light reflection",
        { colourAffinity: ["#1a1a1a", "#2d2d2d", "#c9a96e"], darkBgCompatible: true }),
      makeAsset("food_bg_fresh", "food_core", "food_beverage", "background", "Fresh Green Herbs",
        ["calm", "energetic"], ["fresh", "green", "organic", "healthy", "natural"],
        "Fresh green herb background, basil or parsley, macro photography, vibrant natural colours",
        { colourAffinity: ["#2d5a27", "#4caf50", "#fff9e6"] }),
      makeAsset("food_pattern_brush", "food_core", "food_beverage", "pattern", "Brushstroke Texture",
        ["playful", "calm"], ["brushstroke", "paint", "artisan", "handmade", "texture"],
        "Watercolour brushstroke texture, warm cream and terracotta, artisan aesthetic",
        { preferredZones: ["background"] }),
    ],
  },

  // ── Fashion Pack ───────────────────────────────────────────────────────────
  {
    packId: "fashion_core",
    name: "Fashion & Lifestyle",
    industry: "fashion",
    description: "Editorial aesthetics, luxury materials, minimalist elegance",
    assets: [
      makeAsset("fashion_bg_marble", "fashion_core", "fashion", "background", "White Marble Luxury",
        ["luxury", "minimal", "calm"], ["marble", "luxury", "white", "elegant", "premium"],
        "White Carrara marble texture, subtle grey veining, luxury product background, clean",
        { colourAffinity: ["#ffffff", "#f5f5f5", "#c0b090"] }),
      makeAsset("fashion_bg_fabric", "fashion_core", "fashion", "background", "Silk Fabric Texture",
        ["luxury", "calm"], ["silk", "fabric", "texture", "soft", "luxury", "draped"],
        "Draped silk fabric texture, soft sheen, neutral ivory or champagne colour, editorial",
        { colourAffinity: ["#f5f0e8", "#d4c5a9", "#1a1a1a"] }),
      makeAsset("fashion_bg_dark_edit", "fashion_core", "fashion", "background", "Dark Editorial",
        ["luxury", "dark"], ["editorial", "dark", "high fashion", "contrast", "dramatic"],
        "Dark fashion editorial background, near-black with subtle texture, dramatic lighting",
        { darkBgCompatible: true, colourAffinity: ["#0a0a0a", "#1a1a1a", "#c0b090"] }),
    ],
  },

  // ── Finance Pack ───────────────────────────────────────────────────────────
  {
    packId: "finance_core",
    name: "Finance & Professional",
    industry: "finance",
    description: "Trustworthy blues, corporate precision, data visualisation motifs",
    assets: [
      makeAsset("fin_bg_corporate", "finance_core", "finance", "background", "Corporate Navy",
        ["professional", "calm"], ["corporate", "navy", "professional", "trust", "finance", "banking"],
        "Deep navy blue gradient background, subtle geometric elements, corporate professional aesthetic",
        { darkBgCompatible: true, colourAffinity: ["#0f1c3d", "#1e3a6e", "#ffffff"], toneAffinity: ["professional", "authoritative"] }),
      makeAsset("fin_bg_light_clean", "finance_core", "finance", "background", "Clean White Finance",
        ["minimal", "professional"], ["clean", "white", "minimal", "fintech", "light"],
        "Clean white background with very subtle light blue tint, minimal fintech aesthetic",
        { colourAffinity: ["#f8faff", "#e8f0fe", "#4f6ef7"] }),
      makeAsset("fin_pattern_chart", "finance_core", "finance", "pattern", "Abstract Chart Lines",
        ["professional"], ["chart", "graph", "data", "abstract", "growth", "finance"],
        "Abstract line chart pattern, thin lines on light background, subtle financial data visualization",
        { preferredZones: ["background", "overlay"] }),
    ],
  },

  // ── Education Pack ─────────────────────────────────────────────────────────
  {
    packId: "education_core",
    name: "Education & Learning",
    industry: "education",
    description: "Approachable, clear, knowledge-forward, warm but professional",
    assets: [
      makeAsset("edu_bg_warm", "education_core", "education", "background", "Warm Learning Environment",
        ["calm", "professional"], ["education", "learning", "warm", "book", "knowledge"],
        "Warm educational background, soft yellow and cream tones, subtle book or paper texture",
        { colourAffinity: ["#fff8e1", "#ffecb3", "#5c3317"] }),
      makeAsset("edu_bg_digital", "education_core", "education", "background", "Digital Classroom",
        ["professional", "energetic"], ["digital", "online", "elearning", "modern", "classroom"],
        "Modern digital learning background, clean blue and white, tablet or screen motifs, contemporary",
        { colourAffinity: ["#e3f2fd", "#1565c0", "#ffffff"] }),
    ],
  },

  // ── Entertainment Pack ─────────────────────────────────────────────────────
  {
    packId: "entertainment_core",
    name: "Entertainment & Media",
    industry: "entertainment",
    description: "High drama, cinematic depth, bold colour, crowd energy",
    assets: [
      makeAsset("ent_bg_cinematic", "entertainment_core", "entertainment", "background", "Cinematic Dark",
        ["dark", "luxury"], ["cinematic", "dark", "film", "dramatic", "bokeh", "stage"],
        "Cinematic dark background, bokeh lights, deep shadows, dramatic film aesthetic",
        { darkBgCompatible: true, colourAffinity: ["#0a0a0a", "#1a1a1a", "#ffd700"] }),
      makeAsset("ent_bg_neon", "entertainment_core", "entertainment", "background", "Neon Glow Night",
        ["energetic", "dark", "playful"], ["neon", "glow", "night", "vibrant", "urban", "music"],
        "Neon light glow background, dark urban night aesthetic, magenta and cyan neon, urban energy",
        { darkBgCompatible: true, colourAffinity: ["#0d0d0d", "#ff00ff", "#00ffff"] }),
      makeAsset("ent_bg_concert", "entertainment_core", "entertainment", "background", "Concert Stage Lights",
        ["energetic"], ["concert", "stage", "lights", "music", "live", "energy"],
        "Concert stage lighting background, beams of light on dark, music event energy, vibrant",
        { darkBgCompatible: true }),
    ],
  },

  // ── Generic Pack (universal fallbacks) ────────────────────────────────────
  {
    packId: "generic_core",
    name: "Universal",
    industry: "generic",
    description: "Versatile assets that work across any industry",
    assets: [
      makeAsset("gen_bg_gradient_blue", "generic_core", "generic", "gradient", "Professional Blue Gradient",
        ["professional", "calm"], ["blue", "gradient", "professional", "universal", "clean"],
        "Professional blue gradient background, smooth transition from navy to sky blue",
        { colourAffinity: ["#1565c0", "#42a5f5", "#f8faff"] }),
      makeAsset("gen_bg_dark_premium", "generic_core", "generic", "background", "Premium Dark",
        ["dark", "luxury"], ["dark", "premium", "universal", "sophisticated"],
        "Premium dark background, near-black with subtle gradient, sophisticated minimal",
        { darkBgCompatible: true, colourAffinity: ["#0a0a0a", "#1a1a1a", "#ffffff"] }),
      makeAsset("gen_bg_light_minimal", "generic_core", "generic", "background", "Clean Light Minimal",
        ["minimal", "calm"], ["white", "minimal", "clean", "light", "universal"],
        "Clean light background, pure white or very light grey, minimal professional",
        { colourAffinity: ["#ffffff", "#f8f9fa", "#212121"] }),
      makeAsset("gen_pattern_noise", "generic_core", "generic", "texture", "Film Grain Texture",
        ["energetic", "dark", "luxury"], ["grain", "noise", "texture", "film", "organic"],
        "Subtle film grain noise texture overlay, adds organic depth to any background",
        { preferredZones: ["background"], darkBgCompatible: true }),
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// § 4  INTELLIGENT RETRIEVAL
// ─────────────────────────────────────────────────────────────────────────────

const INDUSTRY_DETECTION_KEYWORDS: Record<AssetIndustry, string[]> = {
  tech:          ["app", "saas", "software", "ai", "api", "code", "developer", "startup", "cloud", "digital", "data", "platform"],
  fitness:       ["gym", "workout", "fitness", "sport", "training", "health", "muscle", "run", "athlete", "exercise"],
  food_beverage: ["food", "restaurant", "meal", "drink", "coffee", "recipe", "chef", "cuisine", "beverage", "snack", "eat"],
  fashion:       ["fashion", "style", "clothing", "brand", "outfit", "luxury", "wear", "apparel", "designer"],
  finance:       ["finance", "invest", "money", "bank", "crypto", "stock", "trade", "wealth", "fund", "insurance"],
  healthcare:    ["health", "medical", "doctor", "clinic", "wellness", "therapy", "hospital", "care"],
  education:     ["learn", "course", "study", "school", "training", "tutorial", "education", "teach", "class"],
  entertainment: ["music", "film", "movie", "event", "concert", "show", "entertainment", "gaming", "stream"],
  real_estate:   ["real estate", "property", "house", "home", "rent", "mortgage", "apartment", "commercial"],
  travel:        ["travel", "tour", "vacation", "hotel", "flight", "destination", "explore", "adventure"],
  ecommerce:     ["shop", "store", "product", "sale", "buy", "ecommerce", "retail", "discount", "offer"],
  generic:       [],
};

function detectIndustry(context: RetrievalContext): AssetIndustry {
  if (context.industry) return context.industry;

  const signal = [
    context.audienceSegment ?? "",
    ...(context.toneKeywords ?? []),
    context.layoutType ?? "",
  ].join(" ").toLowerCase();

  let bestIndustry: AssetIndustry = "generic";
  let bestScore = 0;

  for (const [industry, keywords] of Object.entries(INDUSTRY_DETECTION_KEYWORDS)) {
    const score = keywords.filter(kw => signal.includes(kw)).length;
    if (score > bestScore) {
      bestScore = score;
      bestIndustry = industry as AssetIndustry;
    }
  }

  return bestIndustry;
}

function colourDistance(hex1: string, hex2: string): number {
  const parse = (h: string) => {
    const c = h.replace("#", "");
    return [parseInt(c.slice(0, 2), 16), parseInt(c.slice(2, 4), 16), parseInt(c.slice(4, 6), 16)];
  };
  const [r1, g1, b1] = parse(hex1);
  const [r2, g2, b2] = parse(hex2);
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2) / 441.67;
}

function scoreAssetRelevance(asset: AssetDescriptor, context: RetrievalContext, industry: AssetIndustry): number {
  let score = 0;

  // Industry match (strong signal)
  if (asset.industry === industry) score += 0.35;
  else if (asset.industry === "generic") score += 0.10;

  // Dark background preference
  if (context.prefersDarkBg !== undefined) {
    if (context.prefersDarkBg === asset.darkBgCompatible) score += 0.15;
    else score -= 0.10;
  }

  // Colour affinity (if primary color provided)
  if (context.primaryColor && asset.colourAffinity.length > 0) {
    const minDist = Math.min(...asset.colourAffinity.map(c => colourDistance(c, context.primaryColor!)));
    score += (1 - minDist) * 0.15;
  }

  // Tone keyword alignment
  if (context.toneKeywords && asset.toneAffinity.length > 0) {
    const toneOverlap = context.toneKeywords.filter(t =>
      asset.toneAffinity.some(at => at.toLowerCase().includes(t.toLowerCase()))
    ).length;
    score += Math.min(0.15, toneOverlap * 0.05);
  }

  // Audience affinity
  if (context.audienceSegment && asset.audienceAffinity.length > 0) {
    const seg = context.audienceSegment.toLowerCase();
    if (asset.audienceAffinity.some(a => seg.includes(a) || a.includes(seg))) {
      score += 0.10;
    }
  }

  // Mood match from layout context
  if (context.mood) {
    if (asset.moods.includes(context.mood)) score += 0.10;
  }

  return Math.max(0, Math.min(1, score));
}

/**
 * Retrieves the most relevant assets for a given context.
 * Returns at least 1 asset (guaranteed via generic fallback).
 */
export function retrieveAssets(
  context: RetrievalContext,
  maxResults: number = 3
): RetrievedAsset[] {
  const industry = detectIndustry(context);

  // Flatten all assets from all packs
  const allAssets = ASSET_PACKS.flatMap(p => p.assets);

  // Score all assets
  const scored = allAssets.map(asset => ({
    ...asset,
    relevanceScore: scoreAssetRelevance(asset, context, industry),
    retrievalReason: asset.industry === industry
      ? `Industry match: ${industry}`
      : asset.industry === "generic"
        ? "Generic fallback"
        : "Cross-industry relevance",
  }));

  // Sort by relevance, return top N
  const sorted = scored.sort((a, b) => b.relevanceScore - a.relevanceScore);
  const results = sorted.slice(0, maxResults);

  // Guarantee at least 1 result
  if (results.length === 0) {
    const fallback = allAssets.find(a => a.industry === "generic") ?? allAssets[0];
    if (fallback) {
      results.push({ ...fallback, relevanceScore: 0, retrievalReason: "Emergency fallback" });
    }
  }

  return results;
}

/**
 * Retrieves an asset pack by ID or industry.
 */
export function getAssetPack(packIdOrIndustry: string): AssetPack | undefined {
  return ASSET_PACKS.find(p => p.packId === packIdOrIndustry || p.industry === packIdOrIndustry);
}

/**
 * Returns all available packs.
 */
export function listAssetPacks(): AssetPack[] {
  return ASSET_PACKS;
}

/**
 * Builds a RetrievalContext from an ExplorePipelineContext.
 */
export function buildRetrievalContext(
  pipelineCtx: ExplorePipelineContext,
  seed?: string
): RetrievalContext {
  return {
    layoutType:     pipelineCtx.layoutType,
    primaryColor:   pipelineCtx.brandPrimaryColor,
    audienceSegment:pipelineCtx.audienceSegment,
    toneKeywords:   pipelineCtx.brandToneKeywords,
    prefersDarkBg:  pipelineCtx.brandPrefersDarkBg,
    format:         pipelineCtx.format,
    seed,
  };
}
