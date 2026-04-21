// src/lib/asset-library/category-realm-affinity.ts
//
// Step 57: Category → realm affinity.
//
// The category-profile layer (category-profile.ts) already scores assets
// by category-membership + tag alignment + kind-bias, which works well
// for the legacy inline-SVG / icon library. With the 3D realm catalogs
// in place (nature / animal / lifestyle / object / scene / decorative),
// we need an explicit, *intentional* contract between a template's
// category and the realms it should pull from — so a fitness template
// reaches for gym / dumbbells / yoga-mat first, a wellness template
// reaches for forest / river / calm-room first, a business template
// reaches for workspace / laptop / boardroom first, and a travel
// template reaches for mountain / beach / suitcase first.
//
// This module sits above category-profile: it doesn't replace the tag
// scoring, it adds a realm bonus / penalty that propagates through
// scoreAssetForCategory into rank/select flows. The numbers are tuned
// to nudge — a well-tagged cross-realm asset can still win, but an
// on-realm asset wins ties and a clearly off-realm asset loses.

import type { Asset, AssetCategory, AssetRealm } from "./types";
import {
  ASSET_3D_MANIFEST,
  type Asset3DSlug,
} from "../../engines/assets/3d-asset-manifest";

// ── Affinity map ─────────────────────────────────────────────────────────────

export interface CategoryRealmAffinity {
  category: AssetCategory;
  // Realms a template in this category should lean on for its primary
  // visual + decorative accents. Ordered — earlier realms are more
  // strongly preferred.
  prefer:   AssetRealm[];
  // Realms that clash with the category's identity. A business
  // template probably shouldn't hero a deer; a fitness template
  // probably shouldn't hero a flower bouquet.
  avoid:    AssetRealm[];
  // Short human-readable rationale — useful when debugging why the
  // selector reached for a particular realm.
  rationale: string;
}

// Every AssetCategory has a declared affinity. `decorative` is rarely
// in `avoid` because decorative assets (ribbons / frames / badges /
// dividers) are structural units that serve every category. Instead
// we use `prefer` for the realms whose *subjects* best express the
// category.
export const CATEGORY_REALM_AFFINITY: Record<AssetCategory, CategoryRealmAffinity> = {
  fitness: {
    category:  "fitness",
    prefer:    ["lifestyle", "object"],   // gym / home-gym / running-trail + dumbbell / yoga-mat / activewear
    avoid:     ["animal", "nature"],      // flower bouquets + deer don't read "workout"
    rationale: "Gym / yoga / running scenes and gear props over scenic nature or pets.",
  },

  wellness: {
    category:  "wellness",
    prefer:    ["nature", "animal", "lifestyle"],  // forest / river / pebble stack + plant-room / kitchen + calm pets
    avoid:     [],                                  // nothing violently wrong for wellness
    rationale: "Calm-nature, pets, and restorative interiors — self-care first.",
  },

  business: {
    category:  "business",
    prefer:    ["lifestyle", "object", "scene"],    // workspace / boardroom + laptop / charts + city skyline
    avoid:     ["animal", "nature"],                // wildlife and landscapes feel off-brand on a corporate deck
    rationale: "Workspace / boardroom scenes and business props over wildlife or landscapes.",
  },

  travel: {
    category:  "travel",
    prefer:    ["nature", "scene", "object"],       // mountain / beach + beach-horizon / cafe + suitcase / passport
    avoid:     ["decorative"],                      // purely structural kit doesn't sell a destination
    rationale: "Scenic nature, destination scenes, and travel gear — show the place.",
  },

  productivity: {
    category:  "productivity",
    prefer:    ["lifestyle", "object"],             // workspace / desk-flatlay + notebook / pen-set / coffee-cup
    avoid:     ["animal", "nature"],                // wildlife distracts from focus/task framing
    rationale: "Desk setups and focus props — no wildlife or wide landscapes.",
  },

  education: {
    category:  "education",
    prefer:    ["object", "lifestyle"],             // books / notebook + reading-nook / art-studio
    avoid:     [],
    rationale: "Books, notebooks, reading / learning interiors.",
  },

  beauty: {
    category:  "beauty",
    prefer:    ["object", "nature", "lifestyle"],   // skincare / makeup + flowers / succulent + scandi-bedroom / bathroom
    avoid:     [],
    rationale: "Skincare / makeup props, florals, and soft elegant interiors.",
  },

  marketing: {
    category:  "marketing",
    prefer:    ["decorative", "object", "lifestyle"], // ribbons / banners / badges + megaphone / sale-tag / gift-box + retail-shop
    avoid:     ["animal", "nature"],                  // promo visuals don't usually need wildlife
    rationale: "Structural kit (ribbons / badges / banners) + promo props + retail scenes.",
  },

  motivation: {
    category:  "motivation",
    prefer:    ["nature", "animal", "scene"],       // mountain peak / sunrise + bird-in-flight + horizon
    avoid:     [],
    rationale: "Aspirational nature (peaks, sunrise), symbolic wildlife, wide horizons.",
  },
};

// ── Score weights ────────────────────────────────────────────────────────────
// Tuned to be meaningful but not dominant: a +4 prefer boost roughly
// doubles the weight of two matched tags (each worth +2), while a -3
// penalty is close to a single avoid-tag hit (-4). Primary-category
// membership (+10) still wins.

const SCORE_PREFER_REALM_FIRST  =  4;  // first-choice realm
const SCORE_PREFER_REALM_OTHER  =  2;  // secondary prefer-realm
const SCORE_AVOID_REALM         = -3;  // realm on the avoid list
const SCORE_NEUTRAL_REALM       =  0;  // anything else, including unset realm

/**
 * Bonus / penalty applied to an asset's category score based on how
 * well its realm matches the category's declared realm affinity.
 *
 *   prefer[0]             → +4  (first-choice realm for this category)
 *   prefer[1..n]          → +2  (secondary prefer realms)
 *   avoid                 → -3  (realm clashes with category identity)
 *   neutral / unset realm →  0  (no signal either way)
 *
 * This is the function the category-profile scoring layer calls to
 * add a realm-affinity component to the overall asset score.
 */
export function scoreRealmForCategory(
  realm:    AssetRealm | undefined,
  category: AssetCategory,
): number {
  if (!realm) return SCORE_NEUTRAL_REALM;
  const affinity = CATEGORY_REALM_AFFINITY[category];
  if (!affinity) return SCORE_NEUTRAL_REALM;

  const preferIdx = affinity.prefer.indexOf(realm);
  if (preferIdx === 0) return SCORE_PREFER_REALM_FIRST;
  if (preferIdx > 0)   return SCORE_PREFER_REALM_OTHER;
  if (affinity.avoid.includes(realm)) return SCORE_AVOID_REALM;
  return SCORE_NEUTRAL_REALM;
}

/**
 * Realms ordered from most- to least-preferred for the category.
 * Prefer list first (in declaration order), followed by neutral
 * realms (in a stable global order), followed by avoid realms last.
 * Useful when the selector wants to walk realms in category-priority
 * order to fill a roster.
 */
const ALL_REALMS: readonly AssetRealm[] = [
  "nature", "animal", "lifestyle", "object", "scene", "decorative",
];

export function realmsForCategory(category: AssetCategory): readonly AssetRealm[] {
  const aff = CATEGORY_REALM_AFFINITY[category];
  if (!aff) return ALL_REALMS;
  const preferSet = new Set(aff.prefer);
  const avoidSet  = new Set(aff.avoid);
  const neutrals  = ALL_REALMS.filter(r => !preferSet.has(r) && !avoidSet.has(r));
  return [...aff.prefer, ...neutrals, ...aff.avoid];
}

/**
 * Compare two assets by realm-affinity alone — returns negative when
 * `a` is a better realm fit for `category` than `b`, positive when
 * `b` is better, zero when they tie. Thin wrapper over
 * scoreRealmForCategory that callers can drop into Array.sort.
 */
export function compareAssetsByRealmAffinity(
  a:        Asset,
  b:        Asset,
  category: AssetCategory,
): number {
  return scoreRealmForCategory(b.realm, category)
       - scoreRealmForCategory(a.realm, category);
}

// ── 3D manifest integration ──────────────────────────────────────────────────

/**
 * Rank the 3D manifest for a category, best-fit first. Uses:
 *   1. Manifest's primary category (direct match wins +10 equivalent)
 *   2. Realm affinity score (via scoreRealmForCategory)
 *   3. Stable manifest order as final tie-breaker
 *
 * Returns the full manifest (not filtered) so callers can still pick
 * from the long tail when the top bucket is exhausted. Use
 * `asset3dSlugsForCategory` with a `limit` or filter the result to
 * drop off-category picks entirely.
 */
export function asset3dSlugsForCategory(
  category: AssetCategory,
  opts: { limit?: number; excludeAvoidedRealms?: boolean } = {},
): readonly Asset3DSlug[] {
  const scoreManifest = (m: Asset3DSlug): number => {
    let s = 0;
    if (m.category === category) s += 10;  // primary match dominates
    s += scoreRealmForCategory(m.realm, category);
    return s;
  };
  const ranked = ASSET_3D_MANIFEST
    .map((m, i) => ({ m, i, s: scoreManifest(m) }))
    .sort((a, b) => (b.s - a.s) || (a.i - b.i))
    .map(x => x.m);

  const filtered = opts.excludeAvoidedRealms
    ? ranked.filter(m => !CATEGORY_REALM_AFFINITY[category].avoid.includes(m.realm as AssetRealm))
    : ranked;

  return typeof opts.limit === "number" ? filtered.slice(0, opts.limit) : filtered;
}
