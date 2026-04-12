// src/engines/assets/contract.ts
// AssetContract System
//
// Every AI-generated asset element (human figure, product, atmospheric,
// texture, background) is bound by a strict contract that declares:
//   - which layout zones it may occupy
//   - its hierarchy weight (affects render z-index)
//   - density limits (max area coverage %)
//   - motion compatibility for GIF export
//   - bleed behavior (can it extend to canvas edge?)
//
// The contract is enforced before SVG build — no element can break canvas
// geometry or violate zone ownership rules.

import { ZoneId } from "../layout/families";

// ── Asset types ───────────────────────────────────────────────────────────────
export type AssetElementType =
  | "human"        // Person, character, face
  | "object"       // Product, item, prop
  | "atmospheric"  // Sky, fog, light rays, bokeh
  | "texture"      // Surface pattern, grain, paper
  | "background"   // Full-canvas bg — solid, gradient, scene
  | "logo"         // Brand mark
  | "badge"        // Label, chip, tag
  | "icon"         // Small symbol/pictogram
  | "overlay";     // Semi-transparent color/shape overlay

// ── Contract definition ───────────────────────────────────────────────────────
export interface AssetContract {
  type:              AssetElementType;
  allowedZones:      ZoneId[];         // zones this element may occupy
  hierarchyWeight:   number;           // z-index tier: 0=background, 5=foreground
  maxAreaCoverage:   number;           // 0–1, max % of canvas this element covers
  minAreaCoverage:   number;           // 0–1, must cover at least this much
  densityLimit:      number;           // max visual complexity score contribution
  motionCompatible:  boolean;          // can animate in GIF?
  bleedAllowed:      boolean;          // can extend beyond canvas boundary?
  exclusiveZones:    ZoneId[];         // zones this element BLOCKS from other types
  requiresImageZone: boolean;          // must have an "image" zone in layout
  scaleMode:         "fit" | "fill" | "contain" | "fixed";
  aspectRatioLocked: boolean;          // aspect ratio cannot be changed
  allowedFormats:    string[] | "*";   // format restrictions ("*" = all)
  description:       string;           // human-readable summary
}

// ── Contract registry ─────────────────────────────────────────────────────────
export const ASSET_CONTRACTS: Record<AssetElementType, AssetContract> = {

  human: {
    type:             "human",
    allowedZones:     ["image", "background"],
    hierarchyWeight:  2,
    maxAreaCoverage:  0.60,
    minAreaCoverage:  0.05,
    densityLimit:     60,
    motionCompatible: true,
    bleedAllowed:     true,
    exclusiveZones:   ["image"],
    requiresImageZone:true,
    scaleMode:        "contain",
    aspectRatioLocked:true,
    allowedFormats:   "*",
    description:      "Person, face, or character. Occupies image zone. Cannot overlap text zones.",
  },

  object: {
    type:             "object",
    allowedZones:     ["image", "background"],
    hierarchyWeight:  2,
    maxAreaCoverage:  0.65,
    minAreaCoverage:  0.05,
    densityLimit:     50,
    motionCompatible: true,
    bleedAllowed:     false,
    exclusiveZones:   ["image"],
    requiresImageZone:true,
    scaleMode:        "contain",
    aspectRatioLocked:true,
    allowedFormats:   "*",
    description:      "Product or prop. Fills image zone without bleeds.",
  },

  atmospheric: {
    type:             "atmospheric",
    allowedZones:     ["background", "image"],
    hierarchyWeight:  1,
    maxAreaCoverage:  0.90,
    minAreaCoverage:  0.20,
    densityLimit:     30,
    motionCompatible: true,
    bleedAllowed:     true,
    exclusiveZones:   [],
    requiresImageZone:false,
    scaleMode:        "fill",
    aspectRatioLocked:false,
    allowedFormats:   "*",
    description:      "Sky, fog, bokeh, light effects. Background layer. Can be animated.",
  },

  texture: {
    type:             "texture",
    allowedZones:     ["background"],
    hierarchyWeight:  1,
    maxAreaCoverage:  1.0,
    minAreaCoverage:  0.5,
    densityLimit:     20,
    motionCompatible: false,
    bleedAllowed:     true,
    exclusiveZones:   [],
    requiresImageZone:false,
    scaleMode:        "fill",
    aspectRatioLocked:false,
    allowedFormats:   ["instagram_post", "instagram_story", "youtube_thumbnail", "flyer", "poster", "presentation_slide"],
    description:      "Surface pattern or grain. Background only. No animation.",
  },

  background: {
    type:             "background",
    allowedZones:     ["background"],
    hierarchyWeight:  0,
    maxAreaCoverage:  1.0,
    minAreaCoverage:  1.0,
    densityLimit:     25,
    motionCompatible: true,
    bleedAllowed:     true,
    exclusiveZones:   ["background"],
    requiresImageZone:false,
    scaleMode:        "fill",
    aspectRatioLocked:false,
    allowedFormats:   "*",
    description:      "Full-canvas background. Always present. Lowest z-index.",
  },

  logo: {
    type:             "logo",
    allowedZones:     ["logo"],
    hierarchyWeight:  4,
    maxAreaCoverage:  0.15,
    minAreaCoverage:  0.01,
    densityLimit:     10,
    motionCompatible: false,
    bleedAllowed:     false,
    exclusiveZones:   ["logo"],
    requiresImageZone:false,
    scaleMode:        "contain",
    aspectRatioLocked:true,
    allowedFormats:   "*",
    description:      "Brand mark. Logo zone only. Never exceeds 15% canvas area.",
  },

  badge: {
    type:             "badge",
    allowedZones:     ["badge"],
    hierarchyWeight:  4,
    maxAreaCoverage:  0.12,
    minAreaCoverage:  0.01,
    densityLimit:     15,
    motionCompatible: true,
    bleedAllowed:     false,
    exclusiveZones:   ["badge"],
    requiresImageZone:false,
    scaleMode:        "fit",
    aspectRatioLocked:false,
    allowedFormats:   "*",
    description:      "Label or tag. Badge zone only. Short text (≤25 chars).",
  },

  icon: {
    type:             "icon",
    allowedZones:     ["badge", "cta", "logo"],
    hierarchyWeight:  3,
    maxAreaCoverage:  0.08,
    minAreaCoverage:  0.005,
    densityLimit:     10,
    motionCompatible: true,
    bleedAllowed:     false,
    exclusiveZones:   [],
    requiresImageZone:false,
    scaleMode:        "contain",
    aspectRatioLocked:true,
    allowedFormats:   "*",
    description:      "Small symbol. Sits beside text. No zone ownership.",
  },

  overlay: {
    type:             "overlay",
    allowedZones:     ["background"],
    hierarchyWeight:  1,
    maxAreaCoverage:  1.0,
    minAreaCoverage:  0.0,
    densityLimit:     5,
    motionCompatible: false,
    bleedAllowed:     true,
    exclusiveZones:   [],
    requiresImageZone:false,
    scaleMode:        "fill",
    aspectRatioLocked:false,
    allowedFormats:   "*",
    description:      "Semi-transparent color scrim for text legibility.",
  },
};

// ── Contract validation ───────────────────────────────────────────────────────
export interface ContractViolation {
  elementType: AssetElementType;
  targetZone:  string;
  issue:       string;
  severity:    "error" | "warning";
}

/**
 * Validates that an element placement respects its contract.
 * Returns violations — caller decides whether to reject or remap.
 */
export function validatePlacement(
  elementType: AssetElementType,
  targetZone:  ZoneId,
  format:      string,
  coveragePct: number  // 0–1
): ContractViolation[] {
  const contract = ASSET_CONTRACTS[elementType];
  const violations: ContractViolation[] = [];

  // Zone ownership check
  if (!contract.allowedZones.includes(targetZone)) {
    violations.push({
      elementType,
      targetZone,
      issue: `${elementType} is not allowed in zone "${targetZone}". Allowed: [${contract.allowedZones.join(", ")}]`,
      severity: "error",
    });
  }

  // Format restriction check
  if (contract.allowedFormats !== "*" && !contract.allowedFormats.includes(format)) {
    violations.push({
      elementType,
      targetZone,
      issue: `${elementType} is not compatible with format "${format}"`,
      severity: "error",
    });
  }

  // Area coverage check
  if (coveragePct > contract.maxAreaCoverage) {
    violations.push({
      elementType,
      targetZone,
      issue: `${elementType} coverage ${Math.round(coveragePct * 100)}% exceeds max ${Math.round(contract.maxAreaCoverage * 100)}%`,
      severity: "warning",
    });
  }
  if (coveragePct > 0 && coveragePct < contract.minAreaCoverage) {
    violations.push({
      elementType,
      targetZone,
      issue: `${elementType} coverage ${Math.round(coveragePct * 100)}% is below minimum ${Math.round(contract.minAreaCoverage * 100)}%`,
      severity: "warning",
    });
  }

  return violations;
}

/**
 * Returns the correct zone for an element type given the available zones.
 * Used when the AI tries to place an element in a wrong zone.
 */
export function remapToAllowedZone(
  elementType:   AssetElementType,
  availableZones: ZoneId[]
): ZoneId | null {
  const contract  = ASSET_CONTRACTS[elementType];
  const allowed   = contract.allowedZones.filter(z => availableZones.includes(z));
  return allowed[0] ?? null;
}

/**
 * Given a set of element types, compute the total density score.
 * Used to check if the composition is over the density limit.
 */
export function totalDensityScore(elements: AssetElementType[]): number {
  return elements.reduce((sum, type) => sum + ASSET_CONTRACTS[type].densityLimit, 0);
}

/**
 * Returns motion-compatible elements only.
 * Used to filter the element set for GIF renders.
 */
export function motionCompatibleElements(elements: AssetElementType[]): AssetElementType[] {
  return elements.filter(type => ASSET_CONTRACTS[type].motionCompatible);
}

/**
 * Build a zone-ownership map from a list of elements.
 * Detects conflicts (two elements claiming exclusive ownership of same zone).
 */
export function buildZoneOwnershipMap(
  elements: Array<{ type: AssetElementType; zone: ZoneId }>
): { map: Map<ZoneId, AssetElementType>; conflicts: string[] } {
  const map: Map<ZoneId, AssetElementType> = new Map();
  const conflicts: string[] = [];

  for (const el of elements) {
    const contract = ASSET_CONTRACTS[el.type];
    if (contract.exclusiveZones.includes(el.zone)) {
      const existing = map.get(el.zone);
      if (existing) {
        conflicts.push(`Zone "${el.zone}" claimed by both ${existing} and ${el.type}`);
      } else {
        map.set(el.zone, el.type);
      }
    }
  }

  return { map, conflicts };
}
