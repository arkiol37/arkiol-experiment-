// src/engines/layout/authority.ts
// Layout Authority Engine — single source of truth for structural zone enforcement.

import { createHash } from "crypto";
import {
  Zone, ZoneId, LayoutFamily, LayoutVariation,
  LAYOUT_FAMILIES, FAMILIES_BY_FORMAT,
  pickPermutedIndex,
} from "./families";
import {
  getCategoryLayoutProfile,
  selectCategoryVariationIndex,
} from "../style/category-layout-profiles";

export type FormatCategory =
  | "instagram"      // 1:1
  | "story"          // 9:16
  | "thumbnail"      // 16:9
  | "flyer"          // US Letter portrait
  | "poster"         // A4 portrait
  | "slide"          // 16:9 presentation
  | "card"           // business card
  | "document"       // resume
  | "logo"           // square
  | "unknown";

const FORMAT_CATEGORY: Record<string, FormatCategory> = {
  instagram_post:     "instagram",
  instagram_story:    "story",
  youtube_thumbnail:  "thumbnail",
  flyer:              "flyer",
  poster:             "poster",
  presentation_slide: "slide",
  business_card:      "card",
  resume:             "document",
  logo:               "logo",
};

export function getFormatCategory(format: string): FormatCategory {
  return FORMAT_CATEGORY[format] ?? "unknown";
}

export interface DensityProfile {
  maxTextZones:    number;
  baseLeading:     number;
  minZonePadding:  number;
  maxOverlapDepth: number;
  preferCompact:   boolean;
}

const DENSITY_PROFILES: Record<FormatCategory, DensityProfile> = {
  instagram:  { maxTextZones: 4, baseLeading: 1.25, minZonePadding: 2,   maxOverlapDepth: 3, preferCompact: false },
  story:      { maxTextZones: 3, baseLeading: 1.3,  minZonePadding: 2,   maxOverlapDepth: 2, preferCompact: true  },
  thumbnail:  { maxTextZones: 2, baseLeading: 1.15, minZonePadding: 1,   maxOverlapDepth: 1, preferCompact: true  },
  flyer:      { maxTextZones: 5, baseLeading: 1.3,  minZonePadding: 2,   maxOverlapDepth: 2, preferCompact: false },
  poster:     { maxTextZones: 4, baseLeading: 1.35, minZonePadding: 2.5, maxOverlapDepth: 2, preferCompact: false },
  slide:      { maxTextZones: 5, baseLeading: 1.4,  minZonePadding: 2,   maxOverlapDepth: 1, preferCompact: false },
  card:       { maxTextZones: 5, baseLeading: 1.3,  minZonePadding: 1,   maxOverlapDepth: 0, preferCompact: true  },
  document:   { maxTextZones: 8, baseLeading: 1.4,  minZonePadding: 1,   maxOverlapDepth: 0, preferCompact: false },
  logo:       { maxTextZones: 2, baseLeading: 1.2,  minZonePadding: 3,   maxOverlapDepth: 0, preferCompact: true  },
  unknown:    { maxTextZones: 3, baseLeading: 1.25, minZonePadding: 2,   maxOverlapDepth: 2, preferCompact: false },
};

export interface LayoutSpec {
  family:          LayoutFamily;
  variation:       LayoutVariation;
  zones:           Zone[];
  seed:            string;
  formatCategory:  FormatCategory;
  density:         DensityProfile;
  activeZoneIds:   ZoneId[];
  variationIndex:  number;
}

export interface AuthorityContext {
  format:       string;
  stylePreset:  string;
  variationIdx: number;
  campaignId:   string;
  briefLength?: "short" | "medium" | "long";
  /**
   * Detected content category (productivity, wellness, education, business,
   * fitness, beauty, travel, marketing, motivation). When present, biases
   * the variation selection toward the category's preferred composition.
   */
  categoryId?:  string;
}

export function resolveLayoutSpec(ctx: AuthorityContext): LayoutSpec {
  const category = getFormatCategory(ctx.format);
  const density  = DENSITY_PROFILES[category];

  const families = FAMILIES_BY_FORMAT[ctx.format];
  const fallback = LAYOUT_FAMILIES[0];

  const seed = createHash("sha256")
    .update([ctx.campaignId, ctx.format, ctx.variationIdx, ctx.stylePreset].join(":"))
    .digest("hex");

  let family:        LayoutFamily;
  let variation:     LayoutVariation;
  let variationIndex: number;

  if (!families?.length) {
    family         = fallback;
    variation      = fallback.variations[0];
    variationIndex = 0;
  } else {
    // Use a permutation for the family index so sequential variationIdx
    // values cycle through every family before repeating.
    const fSeed    = createHash("sha256")
      .update([ctx.campaignId, ctx.format, ctx.stylePreset, "family"].join(":"))
      .digest("hex");
    const fIdx     = pickPermutedIndex(fSeed, families.length, ctx.variationIdx);
    family         = families[fIdx];

    // Variation selection uses a campaign-stable permutation so the first
    // N gallery templates cover all N variations of this family before any
    // repeats. The permutation seed incorporates the chosen family so that
    // every (family, slot) pair picks a different variation ordering.
    const vSeed    = createHash("sha256")
      .update([ctx.campaignId, ctx.format, ctx.stylePreset, family.id].join(":"))
      .digest("hex");
    const permVIdx = pickPermutedIndex(vSeed, family.variations.length, ctx.variationIdx);

    // Bias variation selection toward the category's preferred composition
    // approach when a profile exists for the detected category.
    const profile  = getCategoryLayoutProfile(ctx.categoryId);
    const vIdx     = profile
      ? selectCategoryVariationIndex(
          family.variations.map(v => v.id),
          profile,
          permVIdx,
        )
      : permVIdx;

    variation      = family.variations[vIdx];
    variationIndex = vIdx;
  }

  const zones: Zone[] = family.zones.map(zone => {
    const override = variation.overrides[zone.id];
    if (!override) return { ...zone };
    return {
      ...zone,
      ...override,
      constraints: {
        ...(zone.constraints ?? {}),
        ...(override.constraints ?? {}),
      },
    };
  });

  const textZoneIds: ZoneId[] = [
    "headline", "subhead", "body", "cta", "badge", "tagline", "legal", "price",
    "name", "title", "company", "contact", "section_header",
    "bullet_1", "bullet_2", "bullet_3",
  ];
  let textZones = zones.filter(z => textZoneIds.includes(z.id));

  if (density.preferCompact && ctx.briefLength === "short") {
    const priorityOrder: ZoneId[] = [
      "headline", "name", "cta", "subhead", "title", "badge", "tagline",
      "body", "contact", "legal", "company", "section_header",
      "bullet_1", "bullet_2", "bullet_3", "price",
    ];
    const required   = textZones.filter(z => z.required);
    const optional   = textZones.filter(z => !z.required);
    const allowExtra = Math.max(0, density.maxTextZones - required.length);
    const selected   = optional
      .sort((a, b) => priorityOrder.indexOf(a.id) - priorityOrder.indexOf(b.id))
      .slice(0, allowExtra);
    textZones = [...required, ...selected];
  }

  const nonTextZones  = zones.filter(z => !textZoneIds.includes(z.id));
  const activeZoneIds = [
    ...nonTextZones.map(z => z.id),
    ...textZones.map(z => z.id),
  ] as ZoneId[];

  return {
    family, variation, zones, seed, formatCategory: category,
    density, activeZoneIds, variationIndex,
  };
}

export interface GeometryViolation {
  zoneId: string;
  issue:  string;
}

export function validateZoneGeometry(zones: Zone[]): GeometryViolation[] {
  const violations: GeometryViolation[] = [];
  for (const zone of zones) {
    if (zone.x < 0 || zone.x > 100)
      violations.push({ zoneId: zone.id, issue: `x=${zone.x} out of range [0,100]` });
    if (zone.y < 0 || zone.y > 100)
      violations.push({ zoneId: zone.id, issue: `y=${zone.y} out of range [0,100]` });
    if (zone.width < 0 || zone.x + zone.width > 101)
      violations.push({ zoneId: zone.id, issue: `x(${zone.x})+width(${zone.width})=${zone.x + zone.width} > 100` });
    if (zone.height < 0 || zone.y + zone.height > 101)
      violations.push({ zoneId: zone.id, issue: `y(${zone.y})+height(${zone.height})=${zone.y + zone.height} > 100` });
    if (zone.minFontSize && zone.maxFontSize && zone.minFontSize > zone.maxFontSize)
      violations.push({ zoneId: zone.id, issue: `minFontSize(${zone.minFontSize}) > maxFontSize(${zone.maxFontSize})` });
  }
  return violations;
}

export function describeSpec(spec: LayoutSpec): string {
  return [
    `family=${spec.family.id}`,
    `variation=${spec.variation.id}`,
    `category=${spec.formatCategory}`,
    `activeZones=[${spec.activeZoneIds.join(",")}]`,
    `seed=${spec.seed.slice(0, 12)}...`,
  ].join(" | ");
}
