// Asset library — category profile scoring.
//
// A profile is a per-category value judgement: which assets *feel right* for
// productivity vs. wellness vs. fitness. Recipes (see category-recipes.ts)
// already declare the shape of a template's asset roster (how many icons,
// one texture, a hero illustration, etc). Profiles add a second layer on
// top: given a candidate pool of assets, *rank them* so the picks that land
// in a template are visually on-category — a checklist icon for productivity,
// a calm blob for wellness, a growth chart for business, an energy burst
// for fitness.
//
// This module is intentionally pure: no layout, no placement. It maps
// (asset, category) → numeric score, and exposes rank/filter helpers.

import type { Asset, AssetCategory, AssetKind } from "./types";
import { scoreRealmForCategory } from "./category-realm-affinity";

// ── Profile shape ─────────────────────────────────────────────────────────────

export interface CategoryProfile {
  category:        AssetCategory;
  // One-line human-readable direction — useful for debugging which assets
  // the system thinks belong to which bucket.
  mood:            string;
  // Tags that reinforce the category's identity. Each hit adds to the score.
  preferredTags:   string[];
  // Tags that clash with the category's identity. Each hit subtracts.
  avoidTags:       string[];
  // Per-kind multiplier applied after tag scoring. Use values > 1 to boost a
  // kind that is central to the category (e.g. badges for marketing), and
  // values < 1 to demote kinds that should rarely show up (e.g. burst
  // stickers for wellness). Missing kinds default to 1.
  kindBias:        Partial<Record<AssetKind, number>>;
}

// Score weights — tuned so a primary-category asset with strong tag alignment
// dominates, while a cross-category asset with weak alignment can still rank
// when no better option exists.
const SCORE_PRIMARY_CATEGORY   = 10;   // asset.category === profile.category
const SCORE_SECONDARY_CATEGORY =  3;   // extraCategories includes profile.category
const SCORE_TAG_MATCH          =  2;   // per preferredTag hit
const SCORE_TAG_AVOID          = -4;   // per avoidTag hit (heavier than boost
                                       // so a clearly-wrong asset is dropped)

// ── Per-category profiles ────────────────────────────────────────────────────
// These are the concrete category → asset mappings. Adjusting them changes
// what generation actually picks for a given brief — without touching recipes
// or seed data.

export const CATEGORY_PROFILES: Record<AssetCategory, CategoryProfile> = {
  productivity: {
    category:      "productivity",
    mood:          "Focused, systematic, tidy. Checklist and system-style icons, minimal shapes, grid textures.",
    preferredTags: [
      "task", "done", "complete", "list", "checklist", "todo", "plan",
      "time", "schedule", "deadline", "focus", "minimal", "grid", "system",
      "calendar", "arrow", "cta", "dot",
    ],
    avoidTags: [
      "floral", "ornate", "vintage", "bow", "confetti", "burst", "pop",
      "glam", "cartoon", "passport",
    ],
    kindBias: {
      icon: 1.4, shape: 1.2, texture: 1.1, frame: 1.1, divider: 1.0,
      illustration: 1.0, sticker: 0.6, badge: 0.7, ribbon: 0.5, photo: 0.9,
    },
  },

  wellness: {
    category:      "wellness",
    mood:          "Calm, restorative, organic. Soft shapes, waves, leaves, paper grain; no hard bursts.",
    preferredTags: [
      "calm", "mindful", "nature", "leaf", "soft", "organic", "wave",
      "zen", "balance", "breath", "health", "heal", "flow", "meditation",
      "spa", "paper",
    ],
    avoidTags: [
      "burst", "sale", "promo", "bold", "pop", "bang", "pennant",
      "checker", "loud", "industrial",
    ],
    kindBias: {
      illustration: 1.5, shape: 1.3, texture: 1.2, divider: 1.1,
      icon: 1.0, frame: 0.9, sticker: 0.7, ribbon: 0.6, badge: 0.5, photo: 1.0,
    },
  },

  education: {
    category:      "education",
    mood:          "Insightful, clear, studious. Idea/learning glyphs, title scrolls, taped notes, paper grain.",
    preferredTags: [
      "learn", "read", "study", "idea", "book", "note", "graduate",
      "academic", "school", "pencil", "scroll", "title", "ribbon",
      "tape", "paper", "calendar", "student",
    ],
    avoidTags: [
      "sale", "promo", "burst", "pop", "bang", "industrial", "passport",
    ],
    kindBias: {
      illustration: 1.3, icon: 1.3, ribbon: 1.2, frame: 1.1, texture: 1.1,
      shape: 1.0, divider: 1.0, badge: 0.8, sticker: 0.8, photo: 1.0,
    },
  },

  business: {
    category:      "business",
    mood:          "Structured, confident, credible. Growth visuals, data icons, structured blocks, verified badges.",
    preferredTags: [
      "growth", "data", "chart", "deal", "work", "corporate", "office",
      "verified", "premium", "seal", "structure", "formal", "lines",
      "arrow", "cta", "briefcase", "ribbon", "card",
    ],
    avoidTags: [
      "floral", "cartoon", "glam", "bow", "confetti", "playful",
      "passport", "kiss",
    ],
    kindBias: {
      illustration: 1.3, icon: 1.3, shape: 1.1, texture: 1.1, badge: 1.3,
      frame: 1.2, ribbon: 1.0, divider: 1.0, sticker: 0.6, photo: 1.0,
    },
  },

  fitness: {
    category:      "fitness",
    mood:          "High-energy, bold, action-driven. Energetic icons, flames, bold bursts, level-up badges.",
    preferredTags: [
      "energy", "power", "fast", "gym", "run", "cardio", "train",
      "strength", "hot", "streak", "level", "achievement", "bolt",
      "burst", "attention", "pennant", "checker",
    ],
    avoidTags: [
      "soft", "calm", "floral", "ornate", "paper", "meditation",
      "vintage", "bow", "scroll", "skincare",
    ],
    kindBias: {
      sticker: 1.4, badge: 1.3, illustration: 1.3, shape: 1.2, icon: 1.2,
      texture: 1.0, divider: 1.0, ribbon: 0.9, frame: 0.8, photo: 1.0,
    },
  },

  beauty: {
    category:      "beauty",
    mood:          "Soft, luminous, elegant. Floral illustrations, sparkle accents, bows, ornate frames.",
    preferredTags: [
      "glow", "floral", "flower", "soft", "sparkle", "shine", "skincare",
      "hydrate", "bloom", "petal", "bow", "elegant", "ornate", "glam",
      "polaroid", "confetti",
    ],
    avoidTags: [
      "sale", "gym", "cardio", "industrial", "bang", "pennant", "checker",
      "corporate", "briefcase",
    ],
    kindBias: {
      illustration: 1.4, texture: 1.2, ribbon: 1.2, frame: 1.2, sticker: 1.1,
      shape: 1.1, icon: 1.1, divider: 1.0, badge: 0.9, photo: 1.0,
    },
  },

  travel: {
    category:      "travel",
    mood:          "Exploratory, open, atmospheric. Horizon illustrations, nav icons, passport stamps, polaroids.",
    preferredTags: [
      "explore", "journey", "map", "adventure", "horizon", "wave", "wander",
      "passport", "stamp", "polaroid", "memory", "beach", "mountain",
      "compass", "plane", "pin", "globe",
    ],
    avoidTags: [
      "corporate", "briefcase", "sale", "cardio", "gym", "meditation",
    ],
    kindBias: {
      photo: 1.3, illustration: 1.3, sticker: 1.2, icon: 1.2, frame: 1.1,
      shape: 1.0, divider: 1.0, texture: 1.0, ribbon: 0.9, badge: 0.8,
    },
  },

  marketing: {
    category:      "marketing",
    mood:          "Promotional, attention-grabbing, punchy. SALE badges, star bursts, ribbons, launch visuals.",
    preferredTags: [
      "announce", "launch", "sale", "promo", "discount", "offer", "new",
      "burst", "attention", "bang", "pop", "star", "arrow", "cta",
      "tag", "banner", "confetti", "ribbon",
    ],
    avoidTags: [
      "calm", "meditation", "paper", "ornate", "vintage", "scroll",
      "passport",
    ],
    kindBias: {
      badge: 1.4, sticker: 1.3, ribbon: 1.2, illustration: 1.2, shape: 1.1,
      icon: 1.1, texture: 1.0, divider: 1.0, frame: 1.0, photo: 1.0,
    },
  },

  // Step 34: motivation — inspirational quotes, goals, mindset,
  // achievement. Distinct from marketing (transactional) and wellness
  // (calm). Bold typography + aspirational imagery + achievement badges.
  motivation: {
    category:      "motivation",
    mood:          "Aspirational, bold, uplifting. Mountain peaks, sunrise, trophies, streak flames. Strong headline-first type.",
    preferredTags: [
      "motivation", "goal", "aspire", "mindset", "success", "achieve",
      "trophy", "peak", "mountain", "sunrise", "streak", "flame",
      "arrow", "bolt", "star", "quote", "win", "rise", "grow",
    ],
    avoidTags: [
      "corporate", "briefcase", "sale", "discount", "floral", "bow",
      "passport", "checker",
    ],
    kindBias: {
      illustration: 1.4, badge: 1.3, icon: 1.2, ribbon: 1.1,
      shape: 1.1, sticker: 1.1, texture: 1.0, frame: 1.0, divider: 1.0, photo: 1.1,
    },
  },
};

// ── Scoring ──────────────────────────────────────────────────────────────────

/**
 * Score how well an asset matches a given category. The score combines:
 *   - primary/secondary category membership,
 *   - preferred/avoid tag overlap,
 *   - per-kind bias multiplier.
 *
 * Scores are unbounded; a score of 0 means "no category signal"; negative
 * scores mean the asset actively clashes with the category and should be
 * avoided. Use `rankAssetsForCategory` to apply this across a pool.
 */
export function scoreAssetForCategory(
  asset:    Asset,
  category: AssetCategory,
): number {
  const profile = CATEGORY_PROFILES[category];
  if (!profile) return 0;

  let score = 0;

  // 1. Category membership — primary beats secondary beats none.
  if (asset.category === category) {
    score += SCORE_PRIMARY_CATEGORY;
  } else if (asset.extraCategories?.includes(category)) {
    score += SCORE_SECONDARY_CATEGORY;
  }

  // 2. Tag alignment. Preferred tags add, avoid tags subtract.
  const assetTags = new Set(asset.tags.map(t => t.toLowerCase()));
  for (const t of profile.preferredTags) {
    if (assetTags.has(t.toLowerCase())) score += SCORE_TAG_MATCH;
  }
  for (const t of profile.avoidTags) {
    if (assetTags.has(t.toLowerCase())) score += SCORE_TAG_AVOID;
  }

  // 3. Realm affinity (Step 57). Category declares which 3D realms
  // (nature / lifestyle / object / scene / animal / decorative) are
  // on-brand for its subject matter — fitness leans on lifestyle +
  // object (gym / dumbbells), wellness on nature + animal, business
  // on lifestyle + object + scene, travel on nature + scene + object.
  // A realm bonus / penalty here is how we make 3D selection intentional
  // without hand-coded per-category slug lists.
  score += scoreRealmForCategory(asset.realm, category);

  // 4. Kind bias.
  const bias = profile.kindBias[asset.kind] ?? 1;
  score *= bias;

  return score;
}

/**
 * Rank a list of assets for a category, best-fit first. Assets with a
 * non-positive score are placed last so they're only used as fallbacks.
 * Stable: ties preserve input order.
 */
export function rankAssetsForCategory(
  assets:   readonly Asset[],
  category: AssetCategory,
): Asset[] {
  const withScore = assets.map((a, i) => ({
    a,
    i,
    s: scoreAssetForCategory(a, category),
  }));
  withScore.sort((x, y) => (y.s - x.s) || (x.i - y.i));
  return withScore.map(x => x.a);
}

/**
 * Filter assets to those that clear a minimum category-fit threshold.
 * Useful when a caller wants to *guarantee* no off-category picks — callers
 * that tolerate weak matches should use rank instead of filter.
 */
export function filterAssetsForCategory(
  assets:    readonly Asset[],
  category:  AssetCategory,
  minScore:  number = 1,
): Asset[] {
  return assets.filter(a => scoreAssetForCategory(a, category) >= minScore);
}
