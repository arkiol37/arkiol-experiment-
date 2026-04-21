// src/engines/assets/subject-image-selector.ts
//
// STEP 9 — Real visual subjects.
//
// What this module does
// ─────────────────────────────────────────────────────────────────────────────
// Templates have historically rendered as headline + shapes + gradient. Even
// after Steps 5–8 gave every template a component mix and structured content,
// the canvas still lacked the *real subject* that makes a finished design feel
// like a finished design — a fitness photo on a fitness template, food on a
// nutrition template, a workspace on a productivity template. This module
// picks that subject.
//
// Given:
//   - a brief (→ categoryPack from detectCategoryPack)
//   - the resolved TemplateType
//   - the canvas zones (→ we need an "image" zone to place a subject)
//   - a variationIdx (→ different siblings in the same gallery get
//     different subjects instead of all rendering the same photo)
//
// …we select a PhotoAssetSlug from the existing PHOTO_ASSET_MANIFEST
// whose (category + realm) match the brief most closely, prefer an
// aspect ratio close to the image zone's aspect, and return a
// SubjectImage describing where to render it.
//
// What this module does NOT do
// ─────────────────────────────────────────────────────────────────────────────
// No network calls, no image processing. Photo asset URLs come from
// photoAssetUrl() — when ARKIOL_PHOTO_ASSET_BASE is set the URL points
// at the licensed CDN, otherwise we fall back to an Unsplash-query URL
// keyed off the slug's label so dev environments still render *something*.
// The renderer is what actually paints the `<image>` element.

import type { BriefAnalysis }     from "../ai/brief-analyzer";
import type { Zone }              from "../layout/families";
import type { TemplateType }      from "../templates/template-types";
import type { CategoryStylePack } from "../style/category-style-packs";
import {
  PHOTO_ASSET_MANIFEST,
  photoAssetUrl,
  isPhotoAssetConfigured,
  type PhotoAssetSlug,
} from "./photo-asset-manifest";
import {
  ASSET_3D_MANIFEST,
  asset3dUrl,
  isAsset3dConfigured,
  type Asset3DSlug,
} from "./3d-asset-manifest";

// ── Types ────────────────────────────────────────────────────────────────────

/** Stylistic mode the subject must align with. Driven by brief.imageStyle. */
export type SubjectMode =
  | "3d"            // premium 3D render — the platform's preferred hero style
  | "photo"         // realistic photography (food, fitness, lifestyle, beauty)
  | "illustration"  // flat/illustrated scene (we don't have a manifest for this yet)
  | "abstract"      // shapes + gradients only — no subject image
  | "none";         // brief explicitly opted out

export type SubjectPlacement =
  | "focal_block"       // image zone is smaller than half the canvas and centred-ish
  | "side_panel"        // image zone dominates the left/right column
  | "background_section"// image zone stacks horizontally as a banner
  | "full_bleed";       // image zone covers the full canvas

export interface SubjectImage {
  slug:          string;
  label:         string;
  url:           string;                 // rendered URL (CDN or fallback)
  category:      string;                 // manifest category
  realm:         PhotoAssetSlug["realm"];
  mode:          SubjectMode;
  placement:     SubjectPlacement;
  aspectRatio:   number;                 // manifest aspect (w/h)
  zoneId:        string;                 // canvas zone that holds the subject
  /** true when the photo CDN is wired and the URL will resolve to a
   *  licensed asset; false when we fell back to an Unsplash query. */
  licensed:      boolean;
  /** One-line string for admission logs. */
  auditSummary:  string;
}

export interface SubjectSelectionParams {
  brief:           BriefAnalysis;
  templateType:    TemplateType;
  variationIdx:    number;
  zones:           Zone[];
  /** Result of detectCategoryPack(brief) from the builder. */
  categoryPack?:   CategoryStylePack | null;
}

// ── Category → preferred (category,realm) weights ───────────────────────────
//
// Each brief category maps to an ordered list of candidate (manifest
// category, optional realm) filters. We walk the list and return the
// first manifest entry that matches — which is why narrower filters
// come before broader ones. All brief categories that do NOT appear
// here fall back to `DEFAULT_CATEGORY_PREF`.

interface CatFilter { category?: string; realm?: PhotoAssetSlug["realm"]; }

const CATEGORY_PREFS: Record<string, CatFilter[]> = {
  fitness: [
    { category: "fitness" },
    { realm: "lifestyle" },
    { realm: "object" },
  ],
  wellness: [
    { category: "wellness" },
    { realm: "food" },
    { realm: "lifestyle" },
    { realm: "beauty" },
  ],
  food: [
    { category: "wellness", realm: "food" },
    { realm: "food" },
    { category: "marketing", realm: "food" },
  ],
  beauty: [
    { category: "beauty" },
    { realm: "beauty" },
    { realm: "fashion" },
  ],
  fashion: [
    { realm: "fashion" },
    { category: "beauty", realm: "fashion" },
    { category: "beauty" },
  ],
  travel: [
    { category: "travel" },
    { realm: "scene" },
    { realm: "lifestyle" },
  ],
  business: [
    { category: "business" },
    { realm: "object" },
    { realm: "lifestyle" },
  ],
  productivity: [
    { category: "productivity" },
    { realm: "object" },
  ],
  education: [
    { category: "education" },
    { realm: "object" },
    { realm: "lifestyle" },
  ],
  marketing: [
    { category: "marketing" },
    { realm: "scene" },
    { realm: "lifestyle" },
  ],
  motivation: [
    { category: "fitness" },
    { realm: "lifestyle" },
    { realm: "scene" },
  ],
  tech: [
    { category: "productivity" },
    { category: "business" },
    { realm: "object" },
  ],
  realestate: [
    { category: "business" },
    { realm: "scene" },
    { realm: "object" },
  ],
};

const DEFAULT_CATEGORY_PREF: CatFilter[] = [
  { realm: "lifestyle" },
  { realm: "scene" },
  { realm: "object" },
];

// ── Image-style → subject mode ──────────────────────────────────────────────
//
// `brief.imageStyle` is the explicit visual intent from the brief analyzer.
// We honour it strictly — when the brief said "geometric" we do NOT place a
// realistic photo (that would break stylistic consistency with the
// category pack's shape-forward decorations).

function modeForImageStyle(style: BriefAnalysis["imageStyle"]): SubjectMode {
  // Step 47: when the 3D CDN is wired up, photo-style briefs promote to
  // the premium 3D subject path so the whole template (background +
  // hero + accents) reads as one coherent modern 3D composition
  // rather than mixing a realistic photo against 3D decorations.
  const prefer3d = isAsset3dConfigured();
  switch (style) {
    case "photography":
    case "product":
    case "lifestyle":   return prefer3d ? "3d" : "photo";
    case "illustration":return "illustration";
    case "abstract":
    case "geometric":   return "abstract";
    case "none":        return "none";
    default:            return prefer3d ? "3d" : "photo";
  }
}

// ── Selection ───────────────────────────────────────────────────────────────

export function selectSubjectImage(
  params: SubjectSelectionParams,
): SubjectImage | null {
  const { brief, templateType, variationIdx, zones, categoryPack } = params;

  // 1. Must have an image zone to place a subject.
  const imageZone = zones.find(z => z.id === "image");
  if (!imageZone) return null;

  // 2. Honor the brief's stylistic intent. Abstract / geometric / none
  // skip the subject entirely so we don't mix realism with flat design.
  const mode = modeForImageStyle(brief.imageStyle);
  if (mode !== "photo" && mode !== "3d") return null;

  // 3. Resolve preference list.
  const catId = categoryPack?.id;
  const prefs = (catId && CATEGORY_PREFS[catId]) || DEFAULT_CATEGORY_PREF;
  const zoneAspect = imageZone.width / Math.max(1, imageZone.height);
  const placement = resolvePlacement(imageZone);

  // Step 47: 3D path — pull from the curated premium 3D manifest.
  // This is the platform's preferred hero style and guarantees a
  // consistent modern look across every template when ARKIOL_3D_ASSET_BASE
  // is configured.
  if (mode === "3d") {
    return select3dSubject({
      prefs, zoneAspect, variationIdx, placement, imageZoneId: imageZone.id, templateType,
    });
  }

  // 4. Walk prefs in order, collect every matching manifest entry.
  const candidates: PhotoAssetSlug[] = [];
  for (const filter of prefs) {
    for (const entry of PHOTO_ASSET_MANIFEST) {
      if (filter.category && entry.category !== filter.category) continue;
      if (filter.realm    && entry.realm    !== filter.realm)    continue;
      if (candidates.includes(entry)) continue;
      candidates.push(entry);
    }
    if (candidates.length >= 4) break; // enough variety
  }
  if (candidates.length === 0) {
    // Last-resort fallback so we never return null for a photo brief
    // when the manifest has anything at all in it.
    candidates.push(...PHOTO_ASSET_MANIFEST);
  }

  // 5. Prefer entries whose aspect ratio is closest to the image zone's
  // aspect — that minimises the "crop ugliness" from preserveAspectRatio
  // slice when the photo is drawn.
  candidates.sort((a, b) => aspectDelta(a, zoneAspect) - aspectDelta(b, zoneAspect));

  // 6. Deterministic per-variation pick from the top-N bucket so the
  // first four variations in a gallery get different photos.
  const topN  = candidates.slice(0, Math.min(4, candidates.length));
  const idx   = Math.abs(Math.floor(variationIdx)) % topN.length;
  const pick  = topN[idx];

  const url       = photoAssetUrl(pick.slug) ?? unsplashFallbackUrl(pick);
  const licensed  = isPhotoAssetConfigured();

  const subject: SubjectImage = {
    slug:        pick.slug,
    label:       pick.label,
    url,
    category:    pick.category,
    realm:       pick.realm,
    mode:        "photo",
    placement,
    aspectRatio: pick.aspectRatio,
    zoneId:      imageZone.id,
    licensed,
    auditSummary: [
      `slug=${pick.slug}`,
      `cat=${pick.category}`,
      `realm=${pick.realm}`,
      `mode=photo`,
      `place=${placement}`,
      `licensed=${licensed ? "yes" : "no"}`,
      `tpl=${templateType}`,
    ].join(" "),
  };

  return subject;
}

// Step 47: 3D subject path. Mirrors the photo path but pulls from the
// 3D manifest and only matches on category (the 3D manifest doesn't
// carry the food / beauty / fashion realms that are photo-only).
function select3dSubject(params: {
  prefs:        CatFilter[];
  zoneAspect:   number;
  variationIdx: number;
  placement:    SubjectPlacement;
  imageZoneId:  string;
  templateType: TemplateType;
}): SubjectImage | null {
  const { prefs, zoneAspect, variationIdx, placement, imageZoneId, templateType } = params;

  // Only "realm" filters apply to the 3D manifest — the photo-specific
  // realms (food / beauty / fashion) don't exist in 3D yet so those
  // filters collapse to "any realm" and we rely on the category match.
  const threeDRealms = new Set(["nature", "animal", "lifestyle", "object", "scene"]);
  const candidates: Asset3DSlug[] = [];
  for (const filter of prefs) {
    for (const entry of ASSET_3D_MANIFEST) {
      if (filter.category && entry.category !== filter.category) continue;
      if (filter.realm && !threeDRealms.has(filter.realm)) continue;
      if (filter.realm && entry.realm !== filter.realm) continue;
      if (candidates.includes(entry)) continue;
      candidates.push(entry);
    }
    if (candidates.length >= 4) break;
  }
  if (candidates.length === 0) {
    // No premium 3D match — skip the subject rather than fall back to
    // an off-style photo. The composition plan will still carry a 3D
    // library asset from the category recipe.
    return null;
  }

  candidates.sort((a, b) => Math.abs(Math.log(a.aspectRatio) - Math.log(zoneAspect)) -
                            Math.abs(Math.log(b.aspectRatio) - Math.log(zoneAspect)));

  const topN = candidates.slice(0, Math.min(4, candidates.length));
  const idx  = Math.abs(Math.floor(variationIdx)) % topN.length;
  const pick = topN[idx];

  const url      = asset3dUrl(pick.slug);
  // asset3dUrl returns undefined when the CDN isn't configured — but
  // modeForImageStyle only returns "3d" when isAsset3dConfigured() is
  // true, so `url` is always defined here in practice.
  if (!url) return null;

  return {
    slug:        pick.slug,
    label:       pick.label,
    url,
    category:    pick.category,
    // Coerce the 3D realms into the PhotoAssetSlug realm union so the
    // shared SubjectImage type keeps working without forks.
    realm:       pick.realm as SubjectImage["realm"],
    mode:        "3d",
    placement,
    aspectRatio: pick.aspectRatio,
    zoneId:      imageZoneId,
    licensed:    true,
    auditSummary: [
      `slug=${pick.slug}`,
      `cat=${pick.category}`,
      `realm=${pick.realm}`,
      `mode=3d`,
      `tier=${pick.qualityTier}`,
      `place=${placement}`,
      `tpl=${templateType}`,
    ].join(" "),
  };
}

function aspectDelta(entry: PhotoAssetSlug, target: number): number {
  return Math.abs(Math.log(entry.aspectRatio) - Math.log(target));
}

function resolvePlacement(zone: Zone): SubjectPlacement {
  // zone coordinates are % of canvas.
  const area = (zone.width * zone.height) / 10000; // fraction of canvas area
  if (area >= 0.9)  return "full_bleed";
  if (zone.height >= 80 && zone.width <= 55) return "side_panel";
  if (zone.width >= 80 && zone.height <= 55) return "background_section";
  return "focal_block";
}

function unsplashFallbackUrl(entry: PhotoAssetSlug): string {
  const q = entry.label.toLowerCase().replace(/[^a-z0-9\s-]/g, "").trim().replace(/\s+/g, ",");
  const w = entry.suggestedSize?.w ?? 1600;
  const h = entry.suggestedSize?.h ?? 1600;
  return `https://source.unsplash.com/featured/${w}x${h}/?${encodeURIComponent(q)}`;
}

// ── Audit helper ────────────────────────────────────────────────────────────

export function describeSubjectImage(s: SubjectImage | null | undefined): string {
  if (!s) return "subject=none";
  return `subject=${s.slug} ${s.auditSummary}`;
}

// ── Stylistic-intent reasons ────────────────────────────────────────────────
//
// The rejection gate uses these to decide whether a missing subject is
// an actual failure (photo brief with no subject) or expected behaviour
// (geometric brief opting out of photography).

export function photoSubjectExpected(brief: BriefAnalysis): boolean {
  const mode = modeForImageStyle(brief.imageStyle);
  // Step 47: 3D subjects satisfy the same "photo-style brief expected a
  // concrete subject" contract — rejection rules that gate on this
  // treat them as interchangeable.
  return mode === "photo" || mode === "3d";
}
