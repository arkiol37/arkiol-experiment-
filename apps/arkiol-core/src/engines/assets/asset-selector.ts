// src/engines/assets/asset-selector.ts
// Asset Selector Engine
//
// Given a brief analysis and resolved layout spec, determines which asset
// elements to include in the composition, classifies them by type, and maps
// them to valid zones according to their contracts.
//
// This runs BEFORE the SVG build prompt is constructed so the AI is given
// a precise element roster rather than hallucinating placement.

import { BriefAnalysis } from "../ai/brief-analyzer";
import { LayoutSpec }     from "../layout/authority";
import { ZoneId }         from "../layout/families";
import {
  AssetElementType, AssetContract, ASSET_CONTRACTS,
  validatePlacement, remapToAllowedZone, totalDensityScore,
  motionCompatibleElements,
} from "./contract";
import {
  selectAssetsForCategory,
  inferCategoryFromText,
  assetToImageSrc,
  type Asset,
  type AssetCategory,
  type AssetKind,
} from "../../lib/asset-library";

// ── Composition plan ──────────────────────────────────────────────────────────
export interface ElementPlacement {
  type:        AssetElementType;
  zone:        ZoneId;
  prompt:      string;   // AI image generation prompt fragment for this element
  motion:      boolean;  // should animate in GIF?
  weight:      number;   // render z-index (from contract)
  coverageHint:number;   // 0–1 area coverage hint for AI
  url?:        string;   // resolved CDN URL (populated during asset resolution stage)
}

export interface CompositionPlan {
  elements:        ElementPlacement[];
  totalDensity:    number;
  hasImageElement: boolean;
  isGifCompatible: boolean;
  reasoning:       string[];  // explanation of decisions
}

// ── Style preset → element preferences ───────────────────────────────────────
const PRESET_PREFERENCES: Record<string, {
  preferHuman: boolean;
  preferTexture: boolean;
  preferAtmospheric: boolean;
  allowOverlay: boolean;
}> = {
  modern_minimal:   { preferHuman: false, preferTexture: false, preferAtmospheric: false, allowOverlay: false },
  bold_lifestyle:   { preferHuman: true,  preferTexture: false, preferAtmospheric: false, allowOverlay: true  },
  dark_luxury:      { preferHuman: false, preferTexture: true,  preferAtmospheric: true,  allowOverlay: true  },
  clean_product:    { preferHuman: false, preferTexture: false, preferAtmospheric: false, allowOverlay: false },
  vibrant_social:   { preferHuman: true,  preferTexture: false, preferAtmospheric: false, allowOverlay: false },
  editorial:        { preferHuman: true,  preferTexture: true,  preferAtmospheric: false, allowOverlay: true  },
  tech_forward:     { preferHuman: false, preferTexture: false, preferAtmospheric: true,  allowOverlay: false },
  natural_organic:  { preferHuman: false, preferTexture: true,  preferAtmospheric: true,  allowOverlay: false },
};

// ── Brief analysis → element roster ──────────────────────────────────────────
export function buildCompositionPlan(
  brief:      BriefAnalysis,
  spec:       LayoutSpec,
  forGif:     boolean = false
): CompositionPlan {
  const reasoning: string[] = [];
  const activeZoneIds = spec.activeZoneIds;
  const prefs = PRESET_PREFERENCES[brief.tone] ??
                PRESET_PREFERENCES["modern_minimal"]!;
  const hasImageZone = activeZoneIds.includes("image");

  const elements: ElementPlacement[] = [];

  // ── 1. Background is always present ────────────────────────────────────
  elements.push({
    type:         "background",
    zone:         "background",
    prompt:       buildBackgroundPrompt(brief),
    motion:       false,
    weight:       ASSET_CONTRACTS.background.hierarchyWeight,
    coverageHint: 1.0,
  });
  reasoning.push("background: always required");

  // ── 2. Main image element (human or object) ─────────────────────────────
  if (hasImageZone) {
    const imageType = selectImageType(brief, prefs);
    elements.push({
      type:         imageType,
      zone:         "image",
      prompt:       buildImagePrompt(brief, imageType),
      motion:       forGif && ASSET_CONTRACTS[imageType].motionCompatible,
      weight:       ASSET_CONTRACTS[imageType].hierarchyWeight,
      coverageHint: 0.85,
    });
    reasoning.push(`image: selected ${imageType} based on tone="${brief.tone}" imageStyle="${brief.imageStyle}"`);
  } else {
    reasoning.push("image: no image zone in layout — skipping main image element");
  }

  // ── 3. Atmospheric layer (if style warrants it) ─────────────────────────
  if (prefs.preferAtmospheric && !forGif) {
    // Atmospherics go in background zone alongside background fill
    elements.push({
      type:         "atmospheric",
      zone:         "background",
      prompt:       buildAtmosphericPrompt(brief),
      motion:       false,
      weight:       1,
      coverageHint: 0.6,
    });
    reasoning.push("atmospheric: added for dark_luxury/tech_forward style");
  }

  // ── 4. Overlay for legibility ───────────────────────────────────────────
  if (prefs.allowOverlay && hasImageZone) {
    elements.push({
      type:         "overlay",
      zone:         "background",
      prompt:       "semi-transparent dark scrim for text legibility",
      motion:       false,
      weight:       1,
      coverageHint: 0.9,
    });
    reasoning.push("overlay: added to ensure text legibility over image");
  }

  // ── 5. Texture (if style + format compatible) ───────────────────────────
  if (prefs.preferTexture) {
    const contract = ASSET_CONTRACTS.texture;
    const formatOk = contract.allowedFormats === "*" ||
                     contract.allowedFormats.includes(spec.family.formats[0]);
    if (formatOk && !forGif) {
      elements.push({
        type:         "texture",
        zone:         "background",
        prompt:       buildTexturePrompt(brief),
        motion:       false,
        weight:       1,
        coverageHint: 0.3,
      });
      reasoning.push("texture: added subtle surface texture for editorial/dark_luxury");
    }
  }

  // ── 6. Category-matched library assets ──────────────────────────────────
  // Pull curated assets for the inferred content category so the template is
  // never visually empty. Each library asset carries its own URL, so these
  // placements skip the AI-generation path downstream.
  const category = resolveCategory(brief);
  if (category) {
    const seed = `${brief.headline ?? ""}::${brief.tone}::${category}`;
    const libraryAssets = selectAssetsForCategory(category, { seed, limit: 4 });
    const usedZones = new Set<ZoneId>(elements.map(e => e.zone));
    const usedTypes = new Set<AssetElementType>(elements.map(e => e.type));

    for (const asset of libraryAssets) {
      const placement = libraryAssetToPlacement(asset, activeZoneIds, usedZones, usedTypes, forGif);
      if (placement) {
        elements.push(placement);
        usedTypes.add(placement.type);
        reasoning.push(`category:${category}: added ${asset.kind} "${asset.label}" → ${placement.zone}`);
      }
    }
  }

  // ── Validate all placements ─────────────────────────────────────────────
  for (const el of elements) {
    const violations = validatePlacement(el.type, el.zone, spec.family.formats[0], el.coverageHint);
    for (const v of violations) {
      if (v.severity === "error") {
        // Remap to allowed zone
        const remapped = remapToAllowedZone(el.type, activeZoneIds);
        if (remapped) {
          reasoning.push(`[CONTRACT FIX] ${el.type} remapped from ${el.zone} to ${remapped}`);
          el.zone = remapped;
        } else {
          reasoning.push(`[CONTRACT DROP] ${el.type} dropped — no valid zone available`);
          el.motion = false; // mark for removal
        }
      }
    }
  }

  // Remove dropped elements
  const valid = elements.filter(e => !(e.type !== "background" && !activeZoneIds.includes(e.zone)));

  // ── GIF: filter to motion-compatible only ───────────────────────────────
  const finalElements = forGif
    ? valid.filter(e => e.type === "background" ||
                        e.motion ||
                        ["overlay"].includes(e.type))
    : valid;

  const density = totalDensityScore(finalElements.map(e => e.type));
  const gifOk   = finalElements.every(e => ASSET_CONTRACTS[e.type].motionCompatible);

  return {
    elements:        finalElements,
    totalDensity:    density,
    hasImageElement: finalElements.some(e => ["human", "object", "atmospheric"].includes(e.type)),
    isGifCompatible: gifOk,
    reasoning,
  };
}

// ── Prompt builders ───────────────────────────────────────────────────────────
function selectImageType(
  brief: BriefAnalysis,
  prefs: { preferHuman: boolean }
): AssetElementType {
  const styleMap: Record<string, AssetElementType> = {
    photography:    prefs.preferHuman ? "human" : "object",
    illustration:   "object",
    "3d_render":    "object",
    flat_design:    "object",
    abstract:       "atmospheric",
    lifestyle:      "human",
    product_shot:   "object",
  };
  return styleMap[brief.imageStyle] ?? (prefs.preferHuman ? "human" : "object");
}

function buildBackgroundPrompt(brief: BriefAnalysis): string {
  // v9: Try to enrich the background prompt with asset library style data
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { retrieveAssets, buildRetrievalContext } = require("./asset-library");
    const ctx = buildRetrievalContext({
      intent:            brief.headline ?? "design",
      format:            "generic",
      tonePreference:    brief.tone,
      brandPrimaryColor: brief.colorMood?.includes("dark") ? "#1a1a2e" : "#4f6ef7",
      brandPrefersDarkBg:brief.colorMood?.includes("dark") ?? false,
      brandToneKeywords: brief.keywords?.slice(0, 3) ?? [],
    });
    const assets = retrieveAssets(ctx, 1) as Array<{ generationPrompt: string }>;
    if (assets.length > 0 && assets[0]?.generationPrompt) {
      return `${assets[0].generationPrompt}, ${brief.colorMood} color mood, ${brief.tone} brand tone`;
    }
  } catch {
    // Fallback silently
  }
  return `${brief.colorMood} color mood, ${brief.tone} brand tone, abstract background design`;
}

function buildImagePrompt(brief: BriefAnalysis, type: AssetElementType): string {
  const base = brief.imageStyle === "photography"
    ? `professional ${type === "human" ? "lifestyle photography" : "product photography"}`
    : brief.imageStyle.replace("_", " ");

  const audience = brief.audience ? `targeting ${brief.audience}` : "";
  const keywords = brief.keywords.slice(0, 3).join(", ");

  return `${base}, ${brief.colorMood} aesthetic, ${keywords}, ${audience}, high quality, no text`.trim();
}

function buildAtmosphericPrompt(brief: BriefAnalysis): string {
  const map: Record<string, string> = {
    vibrant:   "colorful bokeh light effects",
    dark:      "subtle dark fog and depth haze",
    warm:      "warm golden light rays",
    cool:      "cool blue atmospheric haze",
    natural:   "soft organic light diffusion",
    luxury:    "dark vignette with subtle glow",
    minimal:   "clean white light bloom",
  };
  return map[brief.colorMood] ?? "subtle depth atmospheric effect";
}

function buildTexturePrompt(brief: BriefAnalysis): string {
  const map: Record<string, string> = {
    editorial:   "fine paper grain texture, subtle",
    dark_luxury: "dark brushed metal or fabric texture",
    natural_organic: "natural linen or wood grain texture",
  };
  return map[brief.tone] ?? "subtle surface texture overlay";
}

// ── Category → library asset integration ─────────────────────────────────────

// Derive the content category from the brief by combining the most
// category-revealing text fields. Returns null when no keywords hit.
function resolveCategory(brief: BriefAnalysis): AssetCategory | null {
  const text = [brief.intent, brief.headline, ...(brief.keywords ?? [])]
    .filter(Boolean).join(" ");
  return inferCategoryFromText(text);
}

// Map an asset library kind onto an AssetElementType that has a valid
// zone in the current layout. Returns null when there's no clean fit so
// we don't push placements the contract will later reject.
function libraryAssetToPlacement(
  asset:       Asset,
  activeZones: readonly ZoneId[],
  usedZones:   Set<ZoneId>,
  usedTypes:   Set<AssetElementType>,
  forGif:      boolean,
): ElementPlacement | null {
  const type = mapKindToElementType(asset.kind, activeZones, usedTypes);
  if (!type) return null;

  const contract = ASSET_CONTRACTS[type];
  const zone = pickZoneForType(type, activeZones, usedZones);
  if (!zone) return null;

  if (forGif && !contract.motionCompatible) return null;

  return {
    type,
    zone,
    prompt:       `${asset.label} (${asset.category} library asset)`,
    motion:       forGif && contract.motionCompatible,
    weight:       contract.hierarchyWeight,
    coverageHint: defaultCoverageForType(type),
    url:          assetToImageSrc(asset),
  };
}

function mapKindToElementType(
  kind:        AssetKind,
  activeZones: readonly ZoneId[],
  usedTypes:   Set<AssetElementType>,
): AssetElementType | null {
  switch (kind) {
    case "texture":
      // Only one texture per composition — skip if one was already picked.
      return usedTypes.has("texture") ? null : "texture";
    case "icon":
      // Icons sit next to text — need at least one of its allowed zones.
      return ["badge", "cta", "logo"].some(z => activeZones.includes(z as ZoneId))
        ? "icon"
        : null;
    case "illustration":
      // Illustrations replace the hero image when an image zone exists and
      // no hero has been placed yet (avoids duplicating the main image).
      if (!activeZones.includes("image")) return null;
      if (usedTypes.has("human") || usedTypes.has("object")) return null;
      return "object";
    case "shape":
      // Shapes (bursts, ribbons, arrows) read best as badge accents.
      return activeZones.includes("badge") && !usedTypes.has("badge")
        ? "badge"
        : null;
    case "photo":
      // Photos are full-frame — only inject when we have an image zone and
      // no hero yet. Otherwise they'd fight the AI-generated hero image.
      if (!activeZones.includes("image")) return null;
      if (usedTypes.has("human") || usedTypes.has("object")) return null;
      return "object";
    default:
      return null;
  }
}

function pickZoneForType(
  type:        AssetElementType,
  activeZones: readonly ZoneId[],
  usedZones:   Set<ZoneId>,
): ZoneId | null {
  const allowed = ASSET_CONTRACTS[type].allowedZones.filter(z => activeZones.includes(z));
  // Prefer unused zones to avoid stacking assets on top of existing ones.
  return allowed.find(z => !usedZones.has(z)) ?? allowed[0] ?? null;
}

function defaultCoverageForType(type: AssetElementType): number {
  switch (type) {
    case "texture": return 0.6;
    case "icon":    return 0.03;
    case "badge":   return 0.08;
    case "object":  return 0.7;
    default:        return 0.3;
  }
}

// ── Composition prompt fragment ───────────────────────────────────────────────
// Builds the element roster text that's injected into the SVG AI prompt
export function compositionToPromptFragment(plan: CompositionPlan): string {
  const lines = [
    "COMPOSITION ELEMENTS (respect these placements exactly):",
  ];

  for (const el of plan.elements) {
    if (el.type === "overlay") continue; // handled separately in renderer
    lines.push(`  • [${el.type.toUpperCase()} → zone=${el.zone}] ${el.prompt}`);
  }

  if (plan.isGifCompatible) {
    lines.push("  Motion: This composition supports GIF animation.");
  }

  return lines.join("\n");
}
