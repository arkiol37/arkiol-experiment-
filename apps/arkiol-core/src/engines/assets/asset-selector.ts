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
  ASSET_CATEGORIES,
  type Asset,
  type AssetCategory,
  type AssetKind,
} from "../../lib/asset-library";
import {
  KIND_PLACEMENT_RULES,
  roleForKind,
  resolveAnchorForKind,
  clampScaleForKind,
  resolveLayerForKind,
  maxInstancesPerLayout,
  describePlacement,
} from "./asset-placement";
import { composeDecorativeRoster } from "./decorative-components";

// ── Composition plan ──────────────────────────────────────────────────────────

// Intentional purpose of an asset in the layout. Drives positioning, scale,
// and layering so assets enhance the design rather than cluttering it.
export type AssetRole =
  | "background"   // full-bleed surface (bg fill, texture, atmospheric)
  | "accent"       // small decorative touch near text (badge, icon accent, logo)
  | "divider"      // separator / ribbon / banner between blocks
  | "icon-group"   // row of icons that belong with a text zone
  | "support";     // hero image / illustration that supports the headline

// Coarse position hint relative to the chosen zone (or canvas for full-bleed).
export type Anchor =
  | "full-bleed"
  | "top-left"     | "top-center"    | "top-right"
  | "center-left"  | "center"        | "center-right"
  | "bottom-left"  | "bottom-center" | "bottom-right"
  | "edge-top"     | "edge-bottom";

export interface ElementPlacement {
  type:         AssetElementType;
  zone:         ZoneId;
  prompt:       string;   // AI image generation prompt fragment for this element
  motion:       boolean;  // should animate in GIF?
  weight:       number;   // contract hierarchy weight (from contract.ts)
  coverageHint: number;   // 0–1 area coverage hint for AI
  url?:         string;   // resolved CDN URL (populated during asset resolution stage)
  // ── Composition rules ────────────────────────────────────────────────
  role:         AssetRole;
  anchor:       Anchor;
  scale:        number;              // 0.5–1.5 multiplier applied to the role's base coverage
  alignment:    "left" | "center" | "right";
  layer:        number;              // final render z-order (lower → behind)
}

// Role-driven composition rules. Each role has a clear visual purpose, a
// coverage range that keeps it balanced, a default anchor so placement is
// intentional, and a layer that defines back-to-front render order.
const ROLE_RULES: Record<AssetRole, {
  layer:         number;
  coverage:      [number, number];  // [min, max] as fraction of zone area
  defaultAnchor: Anchor;
  alignment:     "left" | "center" | "right";
}> = {
  background:   { layer:  0, coverage: [0.50, 1.00], defaultAnchor: "full-bleed",   alignment: "center" },
  divider:      { layer: 10, coverage: [0.08, 0.25], defaultAnchor: "edge-top",     alignment: "center" },
  support:      { layer: 20, coverage: [0.40, 0.75], defaultAnchor: "center",       alignment: "center" },
  "icon-group": { layer: 30, coverage: [0.02, 0.10], defaultAnchor: "center-left",  alignment: "left"   },
  accent:       { layer: 40, coverage: [0.02, 0.12], defaultAnchor: "top-right",    alignment: "right"  },
};

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
  elements.push(decorate({
    type:         "background",
    zone:         "background",
    prompt:       buildBackgroundPrompt(brief),
    motion:       false,
    weight:       ASSET_CONTRACTS.background.hierarchyWeight,
    coverageHint: 1.0,
  }, "background"));
  reasoning.push("background: always required (role=background, layer=0)");

  // ── 2. Main image element (human or object) ─────────────────────────────
  if (hasImageZone) {
    const imageType = selectImageType(brief, prefs);
    elements.push(decorate({
      type:         imageType,
      zone:         "image",
      prompt:       buildImagePrompt(brief, imageType),
      motion:       forGif && ASSET_CONTRACTS[imageType].motionCompatible,
      weight:       ASSET_CONTRACTS[imageType].hierarchyWeight,
      coverageHint: 0.85,
    }, "support"));
    reasoning.push(`image: ${imageType} as supporting visual (role=support, layer=20)`);
  } else {
    reasoning.push("image: no image zone in layout — skipping main image element");
  }

  // ── 3. Atmospheric layer (if style warrants it) ─────────────────────────
  if (prefs.preferAtmospheric && !forGif) {
    elements.push(decorate({
      type:         "atmospheric",
      zone:         "background",
      prompt:       buildAtmosphericPrompt(brief),
      motion:       false,
      weight:       1,
      coverageHint: 0.6,
    }, "background"));
    reasoning.push("atmospheric: added as background layer (role=background)");
  }

  // ── 4. Overlay for legibility ───────────────────────────────────────────
  if (prefs.allowOverlay && hasImageZone) {
    elements.push(decorate({
      type:         "overlay",
      zone:         "background",
      prompt:       "semi-transparent dark scrim for text legibility",
      motion:       false,
      weight:       1,
      coverageHint: 0.9,
    }, "background"));
    reasoning.push("overlay: added for text legibility over image");
  }

  // ── 5. Texture (if style + format compatible) ───────────────────────────
  if (prefs.preferTexture) {
    const contract = ASSET_CONTRACTS.texture;
    const formatOk = contract.allowedFormats === "*" ||
                     contract.allowedFormats.includes(spec.family.formats[0]);
    if (formatOk && !forGif) {
      elements.push(decorate({
        type:         "texture",
        zone:         "background",
        prompt:       buildTexturePrompt(brief),
        motion:       false,
        weight:       1,
        coverageHint: 0.3,
      }, "background"));
      reasoning.push("texture: added as background surface (role=background)");
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
    const usedZones   = new Set<ZoneId>(elements.map(e => e.zone));
    const usedTypes   = new Set<AssetElementType>(elements.map(e => e.type));
    const usedRoles   = new Set<AssetRole>(elements.map(e => e.role));
    const usedKinds   = new Map<AssetKind, number>();
    const usedAnchors = new Set<Anchor>(elements.map(e => e.anchor));

    for (const asset of libraryAssets) {
      const placement = libraryAssetToPlacement(
        asset, activeZoneIds, usedZones, usedTypes, usedRoles, usedKinds, usedAnchors, forGif,
      );
      if (placement) {
        elements.push(placement);
        usedTypes.add(placement.type);
        usedRoles.add(placement.role);
        usedKinds.set(asset.kind, (usedKinds.get(asset.kind) ?? 0) + 1);
        usedAnchors.add(placement.anchor);
        reasoning.push(
          `category:${category}: ${asset.kind} "${asset.label}" → role=${placement.role}, zone=${placement.zone}, anchor=${placement.anchor}`
        );
      }
    }

    // ── 7. Decorative components ────────────────────────────────────────────
    // Step 16: pull a small curated roster of composed components
    // (ribbons, badges, stickers, checklist blocks, framed info cards,
    // dividers, label chips, accent groups) on top of the raw library
    // picks. Components flow through the same placement pipeline because
    // each one produces an Asset-shaped output; their placement is governed
    // by asset-placement.ts via the component's `placementAs` library kind.
    const componentRoster = composeDecorativeRoster({
      category,
      seed:  `${seed}::components`,
      limit: 3,
    });
    for (const asset of componentRoster) {
      const placement = libraryAssetToPlacement(
        asset, activeZoneIds, usedZones, usedTypes, usedRoles, usedKinds, usedAnchors, forGif,
      );
      if (placement) {
        elements.push(placement);
        usedTypes.add(placement.type);
        usedRoles.add(placement.role);
        usedKinds.set(asset.kind, (usedKinds.get(asset.kind) ?? 0) + 1);
        usedAnchors.add(placement.anchor);
        reasoning.push(
          `component: ${asset.kind} "${asset.label}" → role=${placement.role}, zone=${placement.zone}, anchor=${placement.anchor}`
        );
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
  const gifFiltered = forGif
    ? valid.filter(e => e.type === "background" ||
                        e.motion ||
                        ["overlay"].includes(e.type))
    : valid;

  // ── Balance & ordering ──────────────────────────────────────────────────
  // Cap decorative visuals relative to text zones so templates don't feel
  // cluttered, then stable-sort by role layer (back → front) so downstream
  // rendering receives elements in the correct paint order.
  const balanced = enforceTextVisualBalance(gifFiltered, activeZoneIds, reasoning);
  const finalElements = sortByLayer(balanced);

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
// Per-kind maximum-count enforcement is layered on top of the role caps.
// A ribbon + a divider are both `role=divider`, but the placement rules
// table allows 1 ribbon + 2 dividers in the same layout — so we track
// kind usage separately.
function libraryAssetToPlacement(
  asset:       Asset,
  activeZones: readonly ZoneId[],
  usedZones:   Set<ZoneId>,
  usedTypes:   Set<AssetElementType>,
  usedRoles:   Set<AssetRole>,
  usedKinds:   Map<AssetKind, number>,
  usedAnchors: Set<Anchor>,
  forGif:      boolean,
): ElementPlacement | null {
  // 1. Per-kind cap straight from the placement rule table.
  const kindCount = usedKinds.get(asset.kind) ?? 0;
  if (kindCount >= maxInstancesPerLayout(asset.kind)) return null;

  // 2. Resolve the AssetElementType compatible with the active zones.
  const type = mapKindToElementType(asset.kind, activeZones, usedTypes);
  if (!type) return null;

  const contract = ASSET_CONTRACTS[type];

  // 3. The placement module is the authoritative source for role / scale /
  //    layer / anchor. The only role-based composition cap we still enforce
  //    here is "one accent per layout" — fine-grained per-kind caps above
  //    take care of the rest.
  const role = roleForKind(asset.kind);
  if (role === "accent" && usedRoles.has("accent")) return null;

  const zone = pickZoneForRole(type, role, activeZones, usedZones);
  if (!zone) return null;

  if (forGif && !contract.motionCompatible) return null;

  // 4. Consult the placement rule for scale/coverage, anchor, and layer.
  const rule     = KIND_PLACEMENT_RULES[asset.kind];
  const scale    = clampScaleForKind(asset.kind);
  const anchor   = resolveAnchorForKind(asset.kind, usedAnchors);
  const coverage = Math.min(
    contract.maxAreaCoverage,
    Math.max(contract.minAreaCoverage, rule.scale.default),
  );

  const placement = decorate({
    type,
    zone,
    prompt:       `${asset.label} (${asset.category} library asset — ${describePlacement(asset.kind)})`,
    motion:       forGif && contract.motionCompatible,
    weight:       contract.hierarchyWeight,
    coverageHint: coverage,
    url:          assetToImageSrc(asset),
  }, role, {
    anchor,
    scale,
    alignment: rule.alignment,
  });

  // Override the role-derived layer with the kind-specific layer so a badge
  // always sits above a ribbon, a ribbon above a divider, etc., regardless
  // of the role band they nominally share.
  placement.layer = resolveLayerForKind(asset.kind, contract.hierarchyWeight);
  return placement;
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
    case "sticker":
    case "badge":
      // Stickers and badges are labeled marker assets — always land in the
      // badge zone when one is available.
      return activeZones.includes("badge") && !usedTypes.has("badge")
        ? "badge"
        : null;
    case "ribbon":
    case "divider":
      // Ribbons and dividers are header/section accents. Prefer an accent-
      // style zone (badge / logo) to sit at the top or between blocks.
      if (activeZones.includes("badge") && !usedTypes.has("badge")) return "badge";
      if (activeZones.includes("logo")  && !usedTypes.has("logo"))  return "logo";
      return null;
    case "frame":
      // Framed cards wrap content and live behind text blocks — treat like
      // a soft atmospheric overlay when no image zone is available.
      if (activeZones.includes("image") && !usedTypes.has("human") && !usedTypes.has("object")) return "object";
      return !usedTypes.has("atmospheric") ? "atmospheric" : null;
    default:
      return null;
  }
}

// Role-aware zone selection. Dividers prefer an "accent" zone when available
// so they sit between content blocks; icon-groups prefer being adjacent to
// text (badge/cta zones); accents lean toward badge/logo. Falls back to the
// contract's allowed zones when the preferred zone isn't active.
function pickZoneForRole(
  type:        AssetElementType,
  role:        AssetRole,
  activeZones: readonly ZoneId[],
  usedZones:   Set<ZoneId>,
): ZoneId | null {
  const allowed = ASSET_CONTRACTS[type].allowedZones.filter(z => activeZones.includes(z));
  if (allowed.length === 0) return null;

  const rolePreferences: Record<AssetRole, ZoneId[]> = {
    background:   ["background"],
    divider:      ["accent", "badge", "background"],
    support:      ["image"],
    "icon-group": ["cta", "badge", "logo"],
    accent:       ["badge", "logo", "accent", "cta"],
  };

  const preferred = rolePreferences[role].filter(z => allowed.includes(z));
  // Prefer unused zones first, then used as a last resort.
  return preferred.find(z => !usedZones.has(z))
      ?? preferred[0]
      ?? allowed.find(z => !usedZones.has(z))
      ?? allowed[0]
      ?? null;
}

// Role assignment and coverage defaults for library assets are centralized
// in asset-placement.ts (KIND_PLACEMENT_RULES / roleForKind).

// Fill in role-derived composition fields (anchor, scale, alignment, layer)
// and clamp coverage into the role's allowed range. Every placement in the
// plan goes through this so the rules apply uniformly.
function decorate(
  base: Omit<ElementPlacement, "role" | "anchor" | "scale" | "alignment" | "layer">,
  role: AssetRole,
  overrides?: Partial<Pick<ElementPlacement, "anchor" | "scale" | "alignment">>,
): ElementPlacement {
  const rule = ROLE_RULES[role];
  const scale = overrides?.scale ?? 1;
  const [minCov, maxCov] = rule.coverage;
  const clampedCoverage = Math.min(maxCov, Math.max(minCov, base.coverageHint * scale));
  return {
    ...base,
    role,
    anchor:    overrides?.anchor    ?? rule.defaultAnchor,
    scale,
    alignment: overrides?.alignment ?? rule.alignment,
    // Layer combines role base + contract weight so foreground element types
    // within the same role sit above back-of-role peers without reordering.
    layer:     rule.layer + base.weight,
    coverageHint: clampedCoverage,
  };
}

// Stable sort: lower layer renders first (behind), higher layer renders last.
function sortByLayer(els: ElementPlacement[]): ElementPlacement[] {
  return els
    .map((el, i) => ({ el, i }))
    .sort((a, b) => a.el.layer - b.el.layer || a.i - b.i)
    .map(x => x.el);
}

// A text-zone is any active zone that carries copy. We keep decorative
// visual elements proportional to the amount of text so templates never
// drown text in imagery.
const TEXT_ZONES: ZoneId[] = [
  "headline", "subhead", "body", "cta", "tagline", "badge", "price", "legal",
  "name", "title", "company", "contact", "section_header",
  "bullet_1", "bullet_2", "bullet_3",
];

// Drop the least-essential decorative visuals until there are at most
// ~1.5× as many accent/divider/icon-group visuals as text zones. Core
// elements (background, support hero) are never dropped.
function enforceTextVisualBalance(
  els:         ElementPlacement[],
  activeZones: readonly ZoneId[],
  reasoning:   string[],
): ElementPlacement[] {
  const textZoneCount = activeZones.filter(z => TEXT_ZONES.includes(z)).length;
  const decorativeRoles: AssetRole[] = ["accent", "divider", "icon-group"];
  const isDecorative = (e: ElementPlacement) => decorativeRoles.includes(e.role);
  const maxDecorative = Math.max(1, Math.ceil(textZoneCount * 1.5));

  const result = [...els];
  while (result.filter(isDecorative).length > maxDecorative) {
    // Drop the highest-layer decorative (least structurally important) first.
    const candidates = result.filter(isDecorative)
      .sort((a, b) => b.layer - a.layer);
    const victim = candidates[0];
    if (!victim) break;
    const idx = result.indexOf(victim);
    result.splice(idx, 1);
    reasoning.push(
      `balance: dropped ${victim.type} (role=${victim.role}) — decorative cap ${maxDecorative} for ${textZoneCount} text zones`
    );
  }
  return result;
}

// ── Asset presence enforcement ───────────────────────────────────────────────
// A "complete" template is not just text on a rectangle — it carries at
// minimum a background treatment plus one meaningful visual asset, and
// ideally a combination of supporting + decorative elements. These rules
// are validated in the pipeline so empty-feeling layouts can be rejected.

export interface AssetPresenceViolation {
  rule:     "missing_background"
          | "no_visual_richness"
          | "insufficient_variety"
          | "missing_decorative_accent";
  severity: "error" | "warning";
  message:  string;
}

// Inspect a plan and return violations if visual richness is insufficient.
// - missing_background (error): no background/overlay/texture/atmospheric element
// - no_visual_richness (error): only background + maybe overlays → text on a box
// - missing_decorative_accent (warning): has a hero but no accent/divider/icon-group
// - insufficient_variety (warning): fewer than 2 distinct roles represented
export function validateAssetPresence(plan: CompositionPlan): AssetPresenceViolation[] {
  const violations: AssetPresenceViolation[] = [];

  const roleCounts: Record<AssetRole, number> = {
    background: 0, support: 0, accent: 0, divider: 0, "icon-group": 0,
  };
  for (const el of plan.elements) {
    roleCounts[el.role]++;
  }

  if (roleCounts.background === 0) {
    violations.push({
      rule: "missing_background",
      severity: "error",
      message: "Template has no background treatment — at least a background fill, texture, or atmospheric layer is required.",
    });
  }

  const meaningfulVisuals =
    roleCounts.support + roleCounts.accent + roleCounts.divider + roleCounts["icon-group"];

  if (meaningfulVisuals === 0) {
    violations.push({
      rule: "no_visual_richness",
      severity: "error",
      message: "Template lacks visual richness — only text on a background. Add at least one icon, illustration, shape, or decorative accent.",
    });
  } else if (roleCounts.support > 0 && roleCounts.accent === 0 && roleCounts.divider === 0 && roleCounts["icon-group"] === 0) {
    violations.push({
      rule: "missing_decorative_accent",
      severity: "warning",
      message: "Template has a hero visual but no decorative accent (badge, icon group, or divider) to support it.",
    });
  }

  const distinctRoles = Object.values(roleCounts).filter(c => c > 0).length;
  if (distinctRoles < 2) {
    violations.push({
      rule: "insufficient_variety",
      severity: "warning",
      message: "Template uses only one visual role — add a second role (background + accent, or background + support) for balance.",
    });
  }

  return violations;
}

// Attempt to satisfy presence rules by injecting category-matched library
// assets. Used as a self-heal step before the pipeline hard-rejects a
// template. Tries the inferred category first, then falls back across the
// other categories so a compatible asset can almost always be found.
export function enrichForPresence(
  plan:   CompositionPlan,
  spec:   LayoutSpec,
  brief:  BriefAnalysis,
  forGif: boolean,
): { plan: CompositionPlan; added: string[] } {
  const added: string[] = [];
  const activeZones = spec.activeZoneIds;
  const primary = resolveCategory(brief);
  const ordered: AssetCategory[] = primary
    ? [primary, ...ASSET_CATEGORIES.filter(c => c !== primary)]
    : [...ASSET_CATEGORIES];

  // Stop as soon as presence is satisfied — we only need to fill the gap,
  // not flood the composition.
  for (const category of ordered) {
    if (validateAssetPresence(plan).every(v => v.severity !== "error")) break;

    const picks = selectAssetsForCategory(category, {
      seed:  `${brief.headline ?? ""}::${category}::heal`,
      limit: 4,
    });
    const usedZones   = new Set<ZoneId>(plan.elements.map(e => e.zone));
    const usedTypes   = new Set<AssetElementType>(plan.elements.map(e => e.type));
    const usedRoles   = new Set<AssetRole>(plan.elements.map(e => e.role));
    const usedKinds   = new Map<AssetKind, number>();
    const usedAnchors = new Set<Anchor>(plan.elements.map(e => e.anchor));

    for (const asset of picks) {
      if (validateAssetPresence(plan).every(v => v.severity !== "error")) break;
      const placement = libraryAssetToPlacement(
        asset, activeZones, usedZones, usedTypes, usedRoles, usedKinds, usedAnchors, forGif,
      );
      if (placement) {
        plan.elements.push(placement);
        usedTypes.add(placement.type);
        usedRoles.add(placement.role);
        usedKinds.set(asset.kind, (usedKinds.get(asset.kind) ?? 0) + 1);
        usedAnchors.add(placement.anchor);
        added.push(`${category}:${asset.kind}:${asset.label}`);
      }
    }
  }

  plan.elements = sortByLayer(plan.elements);
  return { plan, added };
}

// ── Composition prompt fragment ───────────────────────────────────────────────
// Builds the element roster text that's injected into the SVG AI prompt.
// Exposes role, anchor, and scale so the AI respects placement intent.
export function compositionToPromptFragment(plan: CompositionPlan): string {
  const lines = [
    "COMPOSITION ELEMENTS (respect these placements exactly):",
  ];

  // Sorted back-to-front so the roster reads in paint order.
  for (const el of sortByLayer(plan.elements)) {
    if (el.type === "overlay") continue; // handled separately in renderer
    const coveragePct = Math.round(el.coverageHint * 100);
    lines.push(
      `  • [${el.type.toUpperCase()} role=${el.role} zone=${el.zone} anchor=${el.anchor} ` +
      `coverage≈${coveragePct}% align=${el.alignment} layer=${el.layer}] ${el.prompt}`
    );
  }

  if (plan.isGifCompatible) {
    lines.push("  Motion: This composition supports GIF animation.");
  }

  return lines.join("\n");
}
