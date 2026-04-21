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
import {
  resolveBackgroundTreatment,
  type BackgroundTreatment,
} from "./background-treatments";
import {
  type DepthTier,
  type ShadowSpec,
  tierForRole,
  tierForKind,
  shadowForTier,
  buildDepthSeparationLayer,
  summarizeDepthStack,
} from "./depth-layering";
import {
  planRebalance,
  BALANCE_MIN_RATIO,
  BALANCE_MAX_RATIO,
} from "./composition-balance";

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

// Composition mode for a primary visual (hero). Controls whether the
// focal element runs full-bleed, occupies a side column, or sits inside
// a framed section. Pinned once per template so the whole composition
// reads as one intentional arrangement.
export type CompositionMode =
  | "background-hero"   // full-bleed backdrop behind text
  | "side-left"         // occupies ~45% of canvas on the left, text right
  | "side-right"        // occupies ~45% of canvas on the right, text left
  | "framed-center";    // centered hero inside an inset frame

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
  // ── Primary-visual promotion (Step 37) ───────────────────────────────
  // Exactly one placement per composition is marked primary — the focal
  // point of the template. Its `compositionMode` declares how it sits
  // relative to text (background / side / framed). Non-primary elements
  // leave both fields unset.
  primary?:        boolean;
  compositionMode?:CompositionMode;
  // ── Depth & layering (Step 19) ───────────────────────────────────────
  // Semantic depth band. The renderer reads this to decide drop shadow
  // strength, parallax hints, and foreground/background separation.
  // Optional so older callers / consumers without depth awareness keep
  // working unchanged.
  depthTier?:   DepthTier;
  shadow?:      ShadowSpec | null;
  // ── Style + quality (Step 47) ────────────────────────────────────────
  // Propagated from the source library asset so the validator can
  // enforce one-style-per-template and refuse to mix hero-grade 3D
  // picks with flat icons or photo fallbacks. Optional because
  // background / overlay / AI-generated elements aren't style-tagged.
  visualStyle?: import("../../lib/asset-library/types").AssetVisualStyle;
  qualityTier?: import("../../lib/asset-library/types").AssetQualityTier;
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

  // ── 1. Background treatment (layered surface stack) ────────────────────
  // Step 18: every template gets a multi-layer background stack rather than
  // a single plain gradient. The treatment catalog (background-treatments.ts)
  // resolves a tone-appropriate recipe — layered gradient, framed zone,
  // patterned region, structured bands, soft texture wash, or subtle image
  // wash — and returns an ordered list of layers. Each layer becomes its
  // own role=background element so the renderer paints them in the right
  // back-to-front order.
  const treatment: BackgroundTreatment = resolveBackgroundTreatment(brief, {
    preferImageWash: hasImageZone,
  });
  for (const layer of treatment.layers) {
    // Fixed (SVG) texture layers are compatible with any format; AI-generated
    // layers follow the global forGif/format gating used by the old code path.
    const isFixedSvg = !!layer.url;
    if (!isFixedSvg && forGif && !ASSET_CONTRACTS[layer.type].motionCompatible) continue;
    if (!isFixedSvg && layer.type === "texture") {
      const c = ASSET_CONTRACTS.texture;
      const formatOk = c.allowedFormats === "*" || c.allowedFormats.includes(spec.family.formats[0]);
      if (!formatOk) continue;
    }
    const placement = decorate({
      type:         layer.type,
      zone:         "background",
      prompt:       layer.prompt ?? `${brief.colorMood} background layer: ${layer.note}`,
      motion:       false,
      weight:       ASSET_CONTRACTS[layer.type].hierarchyWeight + layer.layerHint * 0.01,
      coverageHint: layer.coverageHint,
      url:          layer.url,
    }, "background");
    elements.push(placement);
    reasoning.push(
      `background[${treatment.kind}]: ${layer.type} layer#${layer.layerHint} — ${layer.note}`
    );
  }
  reasoning.push(`background: treatment=${treatment.kind} — ${treatment.description}`);

  // ── 1b. Depth-separation vignette ───────────────────────────────────────
  // Step 19: a soft radial dim sits between the background treatment and
  // the content plane so the foreground reads as foreground without every
  // mid-tier element having to fight for contrast on its own. Image-wash
  // treatments use the stronger flavor because dim photos need extra
  // separation; dark surfaces invert to a lifted-edge highlight so the
  // vignette doesn't crush already-dark designs. "Dark" lives on the
  // colorMood axis; "luxury" lives on the tone axis — both signal a
  // surface that should be lifted with white rather than dimmed further.
  const isDarkMood   = brief.colorMood === "dark" || brief.tone === "luxury";
  const sepFlavor    = treatment.kind === "subtle-image-wash" ? "strong" : "subtle";
  const sepColor     = isDarkMood ? "#FFFFFF" : "#000000";
  const sepLayer     = buildDepthSeparationLayer(sepFlavor, sepColor);
  elements.push({
    ...decorate({
      type:         "overlay",
      zone:         "background",
      prompt:       `depth-separation vignette (${sepFlavor})`,
      motion:       false,
      weight:       1,
      coverageHint: sepLayer.coverageHint,
      url:          sepLayer.url,
    }, "background"),
    // Override depth: the vignette sits at "ground" tier between surface
    // background layers and the mid content plane.
    depthTier: "ground",
    shadow:    null,
    // Boost paint order slightly so the vignette stacks just above the
    // background treatment layers but well below content.
    layer:     ROLE_RULES.background.layer + 8,
  });
  reasoning.push(`depth: ${sepLayer.note} between background and content plane`);

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

  // ── 3. Legibility overlay over hero image ───────────────────────────────
  // Kept as a separate conditional step: the treatment stack already
  // includes a scrim for image-wash treatments, but when the hero image
  // sits on top of a non-image-wash treatment (e.g. patterned-region with
  // bold_lifestyle) the layout still needs a light scrim for text.
  if (prefs.allowOverlay && hasImageZone && treatment.kind !== "subtle-image-wash") {
    elements.push(decorate({
      type:         "overlay",
      zone:         "background",
      prompt:       "semi-transparent dark scrim for text legibility over hero image",
      motion:       false,
      weight:       1,
      coverageHint: 0.9,
    }, "background"));
    reasoning.push("overlay: added for text legibility over image");
  }

  // ── 6. Category-matched library assets ──────────────────────────────────
  // Pull curated assets for the inferred content category so the template is
  // never visually empty. Each library asset carries its own URL, so these
  // placements skip the AI-generation path downstream.
  //
  // Step 47: the selector enforces a single visualStyle per category pass
  // (see resolveVisualStyleForCategory in category-recipes.ts) and drops
  // any draft-tier placeholders. Production templates stay on a single
  // hero-grade 3D style as long as the category has enough coverage.
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

  // ── Step 37: promote exactly one primary visual ─────────────────────────
  // Scan the plan, promote the strongest support-role element to
  // primary, and pin it to a composition mode derived from the brief's
  // tone. Every template now reads as "one hero + supporting elements"
  // rather than a random stack.
  promotePrimaryVisual(valid, brief, activeZoneIds, reasoning);

  // ── GIF: filter to motion-compatible only ───────────────────────────────
  const gifFiltered = forGif
    ? valid.filter(e => e.type === "background" ||
                        e.motion ||
                        ["overlay"].includes(e.type))
    : valid;

  // ── Balance & ordering ──────────────────────────────────────────────────
  // Step 20: before the upper cap runs, run the text/visual *balance*
  // analyzer. When the plan reads as text-heavy (not enough visual support
  // for the text load), inject targeted decorative components — framed
  // cards around body copy, label chips near CTAs, dividers between
  // stacked sections — so the relationship between text and visuals is
  // restored. The upper cap then trims over-decoration as before.
  const preBalanceInput = {
    elements:    gifFiltered.map(e => ({
      role:         e.role,
      coverageHint: e.coverageHint,
      url:          e.url,
      prompt:       e.prompt,
    })),
    activeZones: activeZoneIds,
    brief,
  };
  const rebalance = planRebalance(preBalanceInput, {
    seed: `${brief.headline ?? ""}::${brief.tone}::rebalance`,
    maxAdditions: 2,
  });
  reasoning.push(
    `balance: ${rebalance.report.band} ratio=${rebalance.report.ratio.toFixed(2)} ` +
    `(text=${rebalance.report.textScore.toFixed(1)}, visual=${rebalance.report.visualScore.toFixed(1)}, ` +
    `min=${BALANCE_MIN_RATIO}, max=${BALANCE_MAX_RATIO})`,
  );
  if (rebalance.action === "add-components") {
    const usedZonesR   = new Set<ZoneId>(gifFiltered.map(e => e.zone));
    const usedTypesR   = new Set<AssetElementType>(gifFiltered.map(e => e.type));
    const usedRolesR   = new Set<AssetRole>(gifFiltered.map(e => e.role));
    const usedKindsR   = new Map<AssetKind, number>();
    const usedAnchorsR = new Set<Anchor>(gifFiltered.map(e => e.anchor));
    for (const sug of rebalance.suggestions) {
      const placement = libraryAssetToPlacement(
        sug.asset, activeZoneIds, usedZonesR, usedTypesR, usedRolesR, usedKindsR, usedAnchorsR, forGif,
      );
      if (placement) {
        gifFiltered.push(placement);
        usedTypesR.add(placement.type);
        usedRolesR.add(placement.role);
        usedKindsR.set(sug.asset.kind, (usedKindsR.get(sug.asset.kind) ?? 0) + 1);
        usedAnchorsR.add(placement.anchor);
        reasoning.push(`balance: added ${sug.asset.kind} "${sug.asset.label}" — ${sug.rationale}`);
      }
    }
  }

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
    product:        "object",
    abstract:       "atmospheric",
    geometric:      "atmospheric",
    lifestyle:      "human",
    none:           prefs.preferHuman ? "human" : "object",
  };
  return styleMap[brief.imageStyle] ?? (prefs.preferHuman ? "human" : "object");
}

function buildImagePrompt(brief: BriefAnalysis, type: AssetElementType): string {
  // Step 47: AI-generated fallback hero images target the same modern
  // 3D-forward aesthetic the library catalogue ships, so even when a
  // template falls back to AI generation the template still reads as
  // on-style.
  const base = brief.imageStyle === "photography"
    ? `modern 3D render, claymorphic ${type === "human" ? "character scene" : "product scene"}, studio lighting`
    : `${brief.imageStyle.replace("_", " ")}, modern clean aesthetic, consistent lighting`;

  const audience = brief.audience ? `targeting ${brief.audience}` : "";
  const keywords = brief.keywords.slice(0, 3).join(", ");

  return `${base}, ${brief.colorMood} palette, ${keywords}, ${audience}, high quality, no text`.trim();
}

// Background / atmospheric / texture prompts are now produced by the
// tone-keyed treatment catalog in background-treatments.ts. The single-shot
// helpers that used to live here have been removed in favor of the
// multi-layer treatment stack built during composition.

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
  // Step 19: kind-aware depth override — frames go to "raised", stickers /
  // badges to "floating", textures to "ground", etc., regardless of the
  // role-derived default applied by decorate().
  applyKindDepth(placement, asset.kind);
  // Step 47: propagate the library asset's style + quality metadata onto
  // the placement so the plan-level style-consistency validator can
  // flag templates that mix e.g. "3d" hero with "illustration" accent.
  if (asset.visualStyle) placement.visualStyle = asset.visualStyle;
  if (asset.qualityTier) placement.qualityTier = asset.qualityTier;
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
    // Depth: default to the role's tier and matching shadow preset. Callers
    // (e.g. libraryAssetToPlacement) override via decorateDepth() when an
    // asset kind is known and warrants a kind-specific tier.
    depthTier: tierForRole(role),
    shadow:    shadowForTier(tierForRole(role)),
  };
}

// Apply a kind-specific depth override to an existing placement. Used by
// libraryAssetToPlacement so a frame lands at "raised" rather than the
// generic "support → mid" tier role-based decoration produces.
function applyKindDepth(p: ElementPlacement, kind: AssetKind): ElementPlacement {
  const tier = tierForKind(kind);
  p.depthTier = tier;
  p.shadow    = shadowForTier(tier);
  return p;
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
// ── Primary-visual promotion (Step 37) ───────────────────────────────────
// Every finished template should have exactly one clear focal visual.
// This pass:
//   1. Picks the single best candidate — support-role element with the
//      highest coverage × layer (illustration / photo / frame kinds).
//   2. Marks it `primary: true` and assigns a `compositionMode` chosen
//      from the brief's tone (bold_lifestyle / vibrant_social → side
//      composition; editorial / dark_luxury → framed-center; everything
//      else → background-hero).
//   3. Tunes the hero's anchor + coverage to match the mode so the
//      text zones have breathing room.
//
// Idempotent: if a primary is already set (e.g. in enrichForPresence
// fallback), no-ops.

const COMPOSITION_MODE_BY_TONE: Record<string, CompositionMode> = {
  modern_minimal:  "framed-center",
  bold_lifestyle:  "side-right",
  dark_luxury:     "framed-center",
  clean_product:   "side-right",
  vibrant_social:  "side-left",
  editorial:       "framed-center",
  tech_forward:    "side-left",
  natural_organic: "background-hero",
};

export function resolveCompositionMode(
  tone:           string,
  hasImageZone:   boolean,
): CompositionMode {
  const fallback: CompositionMode = hasImageZone ? "side-right" : "background-hero";
  return COMPOSITION_MODE_BY_TONE[tone] ?? fallback;
}

function promotePrimaryVisual(
  els:         ElementPlacement[],
  brief:       BriefAnalysis,
  activeZones: readonly ZoneId[],
  reasoning:   string[],
): void {
  // Short-circuit if one is already promoted.
  if (els.some(e => e.primary)) return;

  // Candidate = support-role elements (human / object / atmospheric
  // rarely work as hero; the contract restricts support to support
  // kinds). Rank by (coverageHint * weight) so the biggest / most
  // prominent element wins.
  const candidates = els
    .filter(e => e.role === "support")
    .sort((a, b) => (b.coverageHint * b.weight) - (a.coverageHint * a.weight));

  const hero = candidates[0];
  if (!hero) return;  // no hero-eligible element — let presence rules handle it

  const hasImageZone = activeZones.includes("image");
  const mode = resolveCompositionMode(brief.tone, hasImageZone);

  hero.primary         = true;
  hero.compositionMode = mode;

  // Tune anchor + coverage per mode so the text layout actually has
  // room to breathe. Explicit overrides to the role-derived defaults:
  switch (mode) {
    case "background-hero":
      hero.anchor       = "full-bleed";
      hero.coverageHint = Math.max(hero.coverageHint, 0.70);
      break;
    case "side-left":
      hero.anchor       = "center-left";
      hero.coverageHint = Math.min(Math.max(hero.coverageHint, 0.40), 0.50);
      break;
    case "side-right":
      hero.anchor       = "center-right";
      hero.coverageHint = Math.min(Math.max(hero.coverageHint, 0.40), 0.50);
      break;
    case "framed-center":
      hero.anchor       = "center";
      hero.coverageHint = Math.min(Math.max(hero.coverageHint, 0.45), 0.60);
      break;
  }

  reasoning.push(
    `hero: promoted ${hero.type} (zone=${hero.zone}) → mode=${mode}, anchor=${hero.anchor}, coverage≈${hero.coverageHint.toFixed(2)}`
  );
}

// ── Hero composition validation (Step 37) ────────────────────────────────
// Runs after the plan is finalized. Rejects plans where the primary
// visual is missing, too small, has no composition mode, or would
// overlap text zones in a way that kills readability.

export interface HeroCompositionIssue {
  rule:     "hero_missing"
          | "hero_too_small"
          | "hero_no_mode"
          | "hero_overlaps_text";
  severity: "error" | "warning";
  message:  string;
}

// Minimum coverage each mode needs to read as a proper hero (not an
// oversized accent).
const HERO_MIN_COVERAGE: Record<CompositionMode, number> = {
  "background-hero": 0.55,
  "side-left":       0.32,
  "side-right":      0.32,
  "framed-center":   0.35,
};

// Text zones that must stay readable when the hero is placed. A
// side-composition hero that anchors center-right must not overlap a
// body zone that lives on the right side.
const PRIMARY_TEXT_ZONES: ZoneId[] = ["headline", "subhead", "body", "cta"];

export function validateHeroComposition(
  plan:        CompositionPlan,
  activeZones: readonly ZoneId[],
): HeroCompositionIssue[] {
  const issues: HeroCompositionIssue[] = [];

  const primaries = plan.elements.filter(e => e.primary);
  if (primaries.length === 0) {
    issues.push({
      rule:     "hero_missing",
      severity: "error",
      message:  "No primary visual — every template must have exactly one hero element marked primary.",
    });
    return issues;
  }

  const hero = primaries[0];
  if (!hero.compositionMode) {
    issues.push({
      rule:     "hero_no_mode",
      severity: "error",
      message:  `Primary visual (${hero.type}, zone=${hero.zone}) has no compositionMode — can't be composed.`,
    });
  } else {
    const floor = HERO_MIN_COVERAGE[hero.compositionMode];
    if (hero.coverageHint < floor) {
      issues.push({
        rule:     "hero_too_small",
        severity: "error",
        message:  `Primary visual coverage ${hero.coverageHint.toFixed(2)} is below floor ${floor} for mode ${hero.compositionMode}.`,
      });
    }
  }

  // Text-overlap check — side-composition hero must occupy the opposite
  // side of whatever text zones are active.
  if (hero.compositionMode === "side-left" || hero.compositionMode === "side-right") {
    const heroSide = hero.compositionMode === "side-left" ? "left" : "right";
    const textSides = activeZones
      .filter(z => PRIMARY_TEXT_ZONES.includes(z))
      .map(zoneHorizontalSide);

    // If a primary text zone sits on the same side as the hero, they'll
    // collide visually.
    const clash = textSides.includes(heroSide);
    if (clash) {
      issues.push({
        rule:     "hero_overlaps_text",
        severity: "warning",
        message:  `Primary visual anchored ${hero.anchor} clashes with text on the same side — consider swapping mode or text alignment.`,
      });
    }
  }

  return issues;
}

function zoneHorizontalSide(zone: ZoneId): "left" | "center" | "right" {
  // Rough zone-name heuristic — zones don't carry x/width at this layer.
  // Layout families place headline/subhead/cta centered in most cases;
  // this is a best-effort call used only for the overlap warning.
  if (zone === "bullet_1") return "left";
  return "center";
}

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
          | "text_on_background_only"
          | "invisible_meaningful_visuals"
          | "below_minimum_visual_coverage"
          | "missing_decorative_accent"
          | "insufficient_variety"
          | "mixed_visual_styles"              // Step 47 — multiple visual styles in one template
          // Step 55 — strong-presence enforcement. Every template must
          // carry a clearly visible illustrative primary (a 3D object,
          // scene, photo, or illustration) plus at least one supporting
          // decorative asset. Templates that rely only on gradients,
          // abstract shapes, or empty backgrounds are hard-rejected.
          | "primary_visual_missing"
          | "primary_visual_not_illustrative"
          | "primary_visual_too_subtle"
          | "abstract_only_composition"
          | "missing_supporting_decoration";
  severity: "error" | "warning";
  message:  string;
}

// ── Presence thresholds ──────────────────────────────────────────────────────
// These define what "visible" means in the context of a final template.
// Kept here (not hidden inside the function) so downstream callers can
// reason about and surface them.

// Minimum coverageHint for a single element to count as visible. Step 55
// raised the floor from 0.02 → 0.03 — a 2% speck in a corner does not
// read as a visible design element at render time.
export const MIN_VISIBLE_ELEMENT_COVERAGE = 0.03;

// Minimum aggregate coverage of all meaningful (non-background) visuals.
// Prevents templates where the only "visual" is a 1% sparkle in a corner.
export const MIN_TOTAL_VISUAL_COVERAGE    = 0.04;

// Minimum number of visible meaningful visual elements a template must ship
// with. At least one icon / illustration / shape / frame / accent / image.
export const MIN_VISIBLE_VISUAL_ELEMENTS  = 1;

// Step 55: strong-presence thresholds. The primary visual is the focal
// point — it cannot be a sub-10% accent, and it cannot be an abstract
// texture or a bare flat icon. Templates without a real illustrative
// hero get hard-rejected so we never ship "text on gradient" output.

// Minimum coverageHint for the primary visual itself. 15% is the floor
// where a hero element clearly owns a meaningful slice of the canvas
// rather than reading as a supporting accent.
export const MIN_PRIMARY_VISUAL_COVERAGE  = 0.15;

// Minimum number of supporting decorative elements (accents, dividers,
// icon groups, badges, stickers) that must sit alongside the primary.
export const MIN_SUPPORTING_DECORATIVE_ELEMENTS = 1;

// Element types that *depict* something real — the illustrative
// substrate that a primary visual can legitimately be built on.
const ILLUSTRATIVE_ELEMENT_TYPES: readonly AssetElementType[] = [
  "human", "object", "atmospheric", "background",
];

// Element types that are purely abstract surface — textures, overlays,
// flat colour fields. A composition whose only meaningful visuals are
// these types is gradient-only art and must be rejected.
const ABSTRACT_ELEMENT_TYPES: readonly AssetElementType[] = [
  "texture", "overlay",
];

// Visual styles considered illustrative. A hero tagged "3d",
// "illustration" or "photo" carries real subject art. "flat" and
// "outline" describe bare pictograms; "hand-drawn" is borderline but
// still figurative and counted as illustrative.
const ILLUSTRATIVE_VISUAL_STYLES = new Set(["3d", "illustration", "photo", "hand-drawn"]);

// ── Visibility predicates ────────────────────────────────────────────────────

// A meaningful role — i.e. one that produces a supporting visual rather than
// just a background field. Overlays and background fills don't count.
const MEANINGFUL_ROLES: readonly AssetRole[] = ["support", "accent", "divider", "icon-group"];

function isMeaningfulRole(role: AssetRole): boolean {
  return MEANINGFUL_ROLES.includes(role);
}

// An element counts as *visible* when it actually produces something on the
// canvas: has a resolved URL or a non-empty generation prompt, and its
// coverageHint is not effectively zero. Elements that fail this are noted
// as "invisible" and must be remedied before the template ships.
function isVisibleElement(el: ElementPlacement): boolean {
  const hasContent = (typeof el.url === "string" && el.url.length > 0)
                  || (typeof el.prompt === "string" && el.prompt.trim().length > 0);
  return hasContent && el.coverageHint >= MIN_VISIBLE_ELEMENT_COVERAGE;
}

// Total coverage of all meaningful visuals in a plan — used to catch the
// "everything is a 1% corner accent" edge case.
function totalMeaningfulCoverage(plan: CompositionPlan): number {
  return plan.elements
    .filter(e => isMeaningfulRole(e.role) && isVisibleElement(e))
    .reduce((sum, e) => sum + e.coverageHint, 0);
}

// ── Validation ───────────────────────────────────────────────────────────────

// Inspect a plan and return violations if visual richness is insufficient.
//   missing_background              (error)   no background/overlay/texture at all
//   text_on_background_only         (error)   zero visible meaningful visuals —
//                                             template is literally just text
//                                             on a background
//   invisible_meaningful_visuals    (error)   every meaningful element exists
//                                             but none would render (no url /
//                                             no prompt / zero coverage)
//   below_minimum_visual_coverage   (error)   sum of meaningful-visual coverage
//                                             is below MIN_TOTAL_VISUAL_COVERAGE
//                                             — e.g. one 1% corner sparkle
//   primary_visual_missing          (error)   [Step 55] no placement flagged
//                                             primary: true — every template
//                                             must declare its hero element
//   primary_visual_not_illustrative (error)   [Step 55] primary is a texture /
//                                             overlay / flat icon — not a
//                                             real illustrative subject
//   primary_visual_too_subtle       (error)   [Step 55] primary coverage
//                                             below MIN_PRIMARY_VISUAL_COVERAGE
//   abstract_only_composition       (error)   [Step 55] every meaningful
//                                             element is abstract (texture /
//                                             overlay / flat / outline) — no
//                                             real subject matter at all
//   missing_supporting_decoration   (error)   [Step 55] primary exists but no
//                                             decorative accent / divider /
//                                             icon-group / badge / sticker
//   missing_decorative_accent       (error)   [Step 55, upgraded from warning]
//                                             has a hero but no accent/divider
//   insufficient_variety            (warning) fewer than 2 distinct roles
//   mixed_visual_styles             (error)   [Step 47] multiple visualStyles
//                                             in one composition
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

  // Count meaningful elements in two buckets: declared (any role) vs actually
  // visible (has url/prompt + non-trivial coverage). Distinguishing these
  // lets us produce a clearer violation when the issue is "element present
  // but empty" vs "element never added".
  const meaningfulElements = plan.elements.filter(e => isMeaningfulRole(e.role));
  const visibleMeaningful  = meaningfulElements.filter(isVisibleElement);

  if (meaningfulElements.length === 0) {
    violations.push({
      rule: "text_on_background_only",
      severity: "error",
      message: "Template is only text on a background — no icons, illustrations, shapes, frames, decorative accents, or images. Every generated template must carry at least one visible supporting visual.",
    });
  } else if (visibleMeaningful.length < MIN_VISIBLE_VISUAL_ELEMENTS) {
    violations.push({
      rule: "invisible_meaningful_visuals",
      severity: "error",
      message: `Template has ${meaningfulElements.length} meaningful element(s) but none would render visibly (missing url/prompt or coverage < ${MIN_VISIBLE_ELEMENT_COVERAGE}). At least ${MIN_VISIBLE_VISUAL_ELEMENTS} visible supporting visual is required.`,
    });
  } else {
    const coverage = totalMeaningfulCoverage(plan);
    if (coverage < MIN_TOTAL_VISUAL_COVERAGE) {
      violations.push({
        rule: "below_minimum_visual_coverage",
        severity: "error",
        message: `Meaningful visuals cover only ${(coverage * 100).toFixed(1)}% of the template — below the ${(MIN_TOTAL_VISUAL_COVERAGE * 100).toFixed(1)}% minimum. Add a larger supporting visual (illustration, frame, photo) or scale up the existing ones.`,
      });
    }

    // Step 55: hero decoration is a hard requirement, not a soft nudge.
    if (roleCounts.support > 0 &&
        roleCounts.accent === 0 &&
        roleCounts.divider === 0 &&
        roleCounts["icon-group"] === 0) {
      violations.push({
        rule: "missing_decorative_accent",
        severity: "error",
        message: "Template has a hero visual but no decorative accent (badge, icon group, or divider) to support it. Every composition must pair the hero with at least one decorative support element.",
      });
    }
  }

  // ── Step 55: strong-presence rules ───────────────────────────────────
  // Every template must commit to a real illustrative hero (a 3D object,
  // scene, photo, or illustration) that clearly owns the composition,
  // plus at least one supporting decorative asset. Gradient-only or
  // shape-only output is hard-rejected.

  const primary = plan.elements.find(e => e.primary);

  if (!primary) {
    // Only surface primary_visual_missing when the template actually
    // carries *some* meaningful content — otherwise text_on_background_only
    // above has already caught the "empty composition" case and a
    // duplicate error is noise.
    if (meaningfulElements.length > 0) {
      violations.push({
        rule: "primary_visual_missing",
        severity: "error",
        message:
          "No primary visual — every template must declare exactly one hero element " +
          "(primary: true) that carries a 3D object, scene, illustration, or photo.",
      });
    }
  } else {
    const typeIsIllustrative  = ILLUSTRATIVE_ELEMENT_TYPES.includes(primary.type);
    const typeIsAbstract      = ABSTRACT_ELEMENT_TYPES.includes(primary.type);
    const styleIsIllustrative = primary.visualStyle === undefined
      ? true  // unset styles default-pass (AI-generated hero with no tag)
      : ILLUSTRATIVE_VISUAL_STYLES.has(primary.visualStyle);

    if (typeIsAbstract || !typeIsIllustrative || !styleIsIllustrative) {
      violations.push({
        rule: "primary_visual_not_illustrative",
        severity: "error",
        message:
          `Primary visual (type=${primary.type}, visualStyle=${primary.visualStyle ?? "unset"}) ` +
          `is not a real illustrative subject — a template cannot rely on a texture, ` +
          `overlay, flat pictogram, or outline accent as its hero. Promote a 3D object, ` +
          `scene, illustration, or photo to primary.`,
      });
    }

    if (primary.coverageHint < MIN_PRIMARY_VISUAL_COVERAGE) {
      violations.push({
        rule: "primary_visual_too_subtle",
        severity: "error",
        message:
          `Primary visual coverage ${(primary.coverageHint * 100).toFixed(1)}% is below ` +
          `the ${(MIN_PRIMARY_VISUAL_COVERAGE * 100).toFixed(0)}% minimum — the hero must be ` +
          `clearly visible, not a subtle corner accent. Scale the primary up or promote a ` +
          `larger supporting element to hero.`,
      });
    }
  }

  // Abstract-only check: if the template's meaningful visuals are *all*
  // textures / overlays / flat / outline, the output is effectively a
  // gradient with pictograms — reject outright.
  if (meaningfulElements.length > 0) {
    const anyIllustrative = meaningfulElements.some(el => {
      const typeOk  = ILLUSTRATIVE_ELEMENT_TYPES.includes(el.type);
      const styleOk = el.visualStyle === undefined
        ? true
        : ILLUSTRATIVE_VISUAL_STYLES.has(el.visualStyle);
      return typeOk && styleOk;
    });
    if (!anyIllustrative) {
      violations.push({
        rule: "abstract_only_composition",
        severity: "error",
        message:
          "Composition carries only abstract elements (textures, overlays, flat icons, or " +
          "outline shapes) — no real illustrative subject. Every template must include at " +
          "least one 3D object, scene, photo, or illustration as its visual anchor.",
      });
    }
  }

  // Supporting-decoration requirement: a primary without any decorative
  // companion reads as a lonely centerpiece. Covered separately from
  // missing_decorative_accent so the error message names the hero
  // explicitly and the rule fires even when the role layout would
  // otherwise silence the older check.
  const supportingCount =
    roleCounts.accent + roleCounts.divider + roleCounts["icon-group"];
  if (primary && supportingCount < MIN_SUPPORTING_DECORATIVE_ELEMENTS) {
    // Don't double-fire when missing_decorative_accent is already queued
    // for the same underlying state.
    const alreadyFlagged = violations.some(v => v.rule === "missing_decorative_accent");
    if (!alreadyFlagged) {
      violations.push({
        rule: "missing_supporting_decoration",
        severity: "error",
        message:
          `Primary visual (${primary.type}) has no supporting decoration — every template ` +
          `must pair the hero with at least ${MIN_SUPPORTING_DECORATIVE_ELEMENTS} decorative ` +
          `element (badge, sticker, ribbon, divider, or icon group) to anchor it in the layout.`,
      });
    }
  }

  const distinctRoles = Object.values(roleCounts).filter(c => c > 0).length;
  if (distinctRoles < 2) {
    violations.push({
      rule: "insufficient_variety",
      severity: "warning",
      message: "Template uses only one visual role — add a second role (background + accent, or background + support) for balance.",
    });
  }

  // Step 47: style consistency. Every template must commit to a single
  // visual style for all its non-background elements. Mixing "3d" hero
  // + "illustration" accent + "photo" subject is the exact regression
  // we're blocking — it produces templates that read as assembled from
  // multiple stock libraries rather than one coherent design.
  const styleMix = new Set<string>();
  for (const el of plan.elements) {
    // Only meaningful roles carry a visualStyle contract — background
    // overlays and AI-generated fills can legitimately be untagged.
    if (isMeaningfulRole(el.role) && el.visualStyle) {
      styleMix.add(el.visualStyle);
    }
  }
  if (styleMix.size > 1) {
    violations.push({
      rule: "mixed_visual_styles",
      severity: "error",
      message:
        `Template mixes ${styleMix.size} visual styles (${[...styleMix].sort().join(", ")}) in the same composition. ` +
        `Every template must commit to a single rendering style — pin visualStyle at selection time or drop the off-style picks.`,
    });
  }

  return violations;
}

// Attempt to satisfy presence rules by injecting category-matched library
// assets and, if those aren't enough, composed decorative components. Used
// as a self-heal step before the pipeline hard-rejects a template. Tries
// the inferred category first, falls back across other categories, and
// finally pulls from the decorative-component roster so a compatible
// visible visual can almost always be found.
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

  const hasPresenceErrors = () =>
    validateAssetPresence(plan).some(v => v.severity === "error");

  // Shared trackers so every heal attempt respects the caps already
  // accumulated in the plan.
  const mkTrackers = () => ({
    usedZones:   new Set<ZoneId>(plan.elements.map(e => e.zone)),
    usedTypes:   new Set<AssetElementType>(plan.elements.map(e => e.type)),
    usedRoles:   new Set<AssetRole>(plan.elements.map(e => e.role)),
    usedKinds:   new Map<AssetKind, number>(),
    usedAnchors: new Set<Anchor>(plan.elements.map(e => e.anchor)),
  });

  const tryPlace = (asset: Asset, tag: string): void => {
    const t = mkTrackers();
    const placement = libraryAssetToPlacement(
      asset, activeZones, t.usedZones, t.usedTypes, t.usedRoles, t.usedKinds, t.usedAnchors, forGif,
    );
    if (placement) {
      plan.elements.push(placement);
      added.push(tag);
    }
  };

  // Step 47: if the plan already carries elements with a visualStyle,
  // every healed pick must match that style so the repair pass doesn't
  // re-introduce the mixed-style violation it was meant to clear.
  const existingStyles = new Set(
    plan.elements
      .filter(e => isMeaningfulRole(e.role) && e.visualStyle)
      .map(e => e.visualStyle!),
  );
  const healStyle = existingStyles.size === 1
    ? [...existingStyles][0]
    : undefined;

  // ── Pass 1: library assets, primary category first ────────────────────────
  for (const category of ordered) {
    if (!hasPresenceErrors()) break;

    const picks = selectAssetsForCategory(category, {
      seed:  `${brief.headline ?? ""}::${category}::heal`,
      limit: 4,
      visualStyle: healStyle,
    });

    for (const asset of picks) {
      if (!hasPresenceErrors()) break;
      tryPlace(asset, `lib:${category}:${asset.kind}:${asset.label}`);
    }
  }

  // ── Pass 2: decorative components as final-resort ─────────────────────────
  // When the library can't provide a placeable asset for the active layout
  // (e.g. no image zone + no badge zone), composed components are guaranteed
  // to carry their own SVG payload and degrade gracefully — making them a
  // reliable last line of defense against "text on background" outputs.
  if (hasPresenceErrors()) {
    const componentCategory = primary ?? "marketing";
    const roster = composeDecorativeRoster({
      category: componentCategory,
      seed:     `${brief.headline ?? ""}::components::heal`,
      limit:    3,
    });
    for (const asset of roster) {
      if (!hasPresenceErrors()) break;
      tryPlace(asset, `component:${asset.kind}:${asset.label}`);
    }
  }

  // Step 37: once the self-heal has brought presence back to compliance,
  // promote a primary visual on the patched plan. The heal often pulls in
  // a new illustration / photo — that's our best hero candidate, so we
  // re-run promotion here rather than leaving the plan without a hero.
  const heroReason: string[] = [];
  promotePrimaryVisual(plan.elements, brief, activeZones, heroReason);
  added.push(...heroReason);

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

  // Step 37: hero line first so the renderer / AI reads the primary
  // composition intent before any per-element details.
  const hero = plan.elements.find(e => e.primary);
  if (hero && hero.compositionMode) {
    lines.push(
      `  PRIMARY VISUAL: ${hero.type} (${hero.prompt}) — composition=${hero.compositionMode}, ` +
      `anchor=${hero.anchor}, coverage≈${Math.round(hero.coverageHint * 100)}%`,
    );
  }

  // Sorted back-to-front so the roster reads in paint order.
  for (const el of sortByLayer(plan.elements)) {
    if (el.type === "overlay") continue; // handled separately in renderer
    const coveragePct = Math.round(el.coverageHint * 100);
    const tier   = el.depthTier ? ` tier=${el.depthTier}` : "";
    const shadow = el.shadow
      ? ` shadow=y${el.shadow.offsetY.toFixed(3)}b${el.shadow.blur.toFixed(3)}o${el.shadow.opacity.toFixed(2)}`
      : "";
    const primary = el.primary ? " PRIMARY" : "";
    lines.push(
      `  • [${el.type.toUpperCase()} role=${el.role}${primary} zone=${el.zone} anchor=${el.anchor} ` +
      `coverage≈${coveragePct}% align=${el.alignment} layer=${el.layer}${tier}${shadow}] ${el.prompt}`
    );
  }

  // Step 19: surface the composed depth ramp so the renderer (or a human
  // reading the reasoning log) can verify the template has visible depth
  // separation rather than a flat stack.
  lines.push(`  Depth stack (back→front): ${summarizeDepthStack(plan.elements)}`);

  if (plan.isGifCompatible) {
    lines.push("  Motion: This composition supports GIF animation.");
  }

  return lines.join("\n");
}
