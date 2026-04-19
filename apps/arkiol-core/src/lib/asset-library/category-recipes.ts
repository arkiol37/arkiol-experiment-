// Category → asset recipe mapping.
//
// For every supported content category, this file declares which kinds of
// assets a generated template should contain so that layouts are never
// visually empty. The recipe is intentionally abstract — it specifies the
// *mix* (kinds, counts, tag preferences), not the *placement* on the canvas.
// Positioning / composition is handled downstream.
//
// This module is the foundation that downstream generation logic consults
// when assembling a default visual roster for a given category.

import type { Asset, AssetCategory, AssetKind, AssetVisualStyle } from "./types";
import { queryAssets, pickAsset, ASSET_CATEGORIES } from "./registry";
import { scoreAssetForCategory } from "./category-profile";

// ── Recipe shape ──────────────────────────────────────────────────────────────

export interface RecipeEntry {
  kind:      AssetKind;
  count:     number;           // how many distinct assets to include
  tags?:     string[];         // tag bias — narrow selection when any match
  required?: boolean;          // if true, fall back to any asset of this kind
                               // (across categories) when the category has none
}

export interface CategoryRecipe {
  category: AssetCategory;
  summary:  string;            // short human-readable rationale
  entries:  RecipeEntry[];
}

// ── Per-category recipes ──────────────────────────────────────────────────────
// Each recipe targets ~4–5 distinct assets: a hero illustration, 1–2
// contextual icons, a decorative shape, and a background texture. This
// keeps templates visually complete without crowding the canvas.

export const CATEGORY_RECIPES: Record<AssetCategory, CategoryRecipe> = {
  productivity: {
    category: "productivity",
    summary:  "Focused, task-oriented. Checklist-style visuals, time cues, clean dot-grid texture.",
    entries: [
      { kind: "illustration", count: 1, required: true                                   },
      { kind: "icon",         count: 2, tags: ["task", "done", "list", "time", "plan"]   },
      { kind: "shape",        count: 1, tags: ["arrow", "dot", "minimal", "cta"]         },
      { kind: "texture",      count: 1, tags: ["dots", "grid", "minimal"]                },
      { kind: "frame",        count: 1, tags: ["card", "container", "clean"]             },
      { kind: "divider",      count: 1, tags: ["minimal", "dots", "hairline"]            },
    ],
  },

  wellness: {
    category: "wellness",
    summary:  "Calm and restorative. Organic waves, soft blobs, leaf accents, gentle grain.",
    entries: [
      { kind: "illustration", count: 1, required: true                                   },
      { kind: "icon",         count: 2, tags: ["calm", "nature", "mindful", "health"]    },
      { kind: "shape",        count: 1, tags: ["blob", "organic", "wave", "soft"]        },
      { kind: "texture",      count: 1, tags: ["grain", "paper", "soft", "waves"]        },
      { kind: "sticker",      count: 1, tags: ["calm", "zen", "balance"]                 },
      { kind: "divider",      count: 1, tags: ["wave", "soft", "flow"]                   },
    ],
  },

  education: {
    category: "education",
    summary:  "Insightful and clear. Idea/learning glyphs, title ribbons, paper grain.",
    entries: [
      { kind: "illustration", count: 1, required: true                                   },
      { kind: "icon",         count: 2, tags: ["learn", "read", "study", "idea"]         },
      { kind: "shape",        count: 1, tags: ["ribbon", "banner", "title"]              },
      { kind: "texture",      count: 1, tags: ["grain", "dots", "paper"]                 },
      { kind: "ribbon",       count: 1, tags: ["scroll", "banner", "title"]              },
      { kind: "frame",        count: 1, tags: ["note", "tape", "casual", "card"]         },
    ],
  },

  business: {
    category: "business",
    summary:  "Structured and confident. Growth visuals, data icons, diagonal line texture.",
    entries: [
      { kind: "illustration", count: 1, required: true                                   },
      { kind: "icon",         count: 2, tags: ["growth", "data", "deal", "work"]         },
      { kind: "shape",        count: 1, tags: ["arrow", "ribbon", "cta"]                 },
      { kind: "texture",      count: 1, tags: ["lines", "structure", "formal"]           },
      { kind: "badge",        count: 1, tags: ["verified", "premium", "seal"]            },
      { kind: "frame",        count: 1, tags: ["card", "accent", "bar"]                  },
    ],
  },

  fitness: {
    category: "fitness",
    summary:  "High-energy. Action icons, bold bursts, punchy checker texture.",
    entries: [
      { kind: "illustration", count: 1, required: true                                   },
      { kind: "icon",         count: 2, tags: ["energy", "power", "gym", "run", "fast"]  },
      { kind: "shape",        count: 1, tags: ["burst", "attention", "pennant"]          },
      { kind: "texture",      count: 1, tags: ["checker", "retro", "playful"]            },
      { kind: "sticker",      count: 1, tags: ["energy", "hot", "streak"]                },
      { kind: "badge",        count: 1, tags: ["level", "achievement"]                   },
    ],
  },

  beauty: {
    category: "beauty",
    summary:  "Soft and luminous. Floral illustrations, sparkle accents, confetti flecks.",
    entries: [
      { kind: "illustration", count: 1, required: true                                   },
      { kind: "icon",         count: 2, tags: ["glow", "floral", "skincare", "soft"]     },
      { kind: "shape",        count: 1, tags: ["sparkle", "shine", "soft", "blob"]       },
      { kind: "texture",      count: 1, tags: ["confetti", "grain", "soft"]              },
      { kind: "ribbon",       count: 1, tags: ["bow", "gift", "elegant"]                 },
      { kind: "frame",        count: 1, tags: ["ornate", "elegant", "polaroid"]          },
    ],
  },

  travel: {
    category: "travel",
    summary:  "Explorative and open. Horizon illustrations, nav icons, wave dividers.",
    entries: [
      { kind: "illustration", count: 1, required: true                                   },
      { kind: "icon",         count: 2, tags: ["explore", "journey", "map", "adventure"] },
      { kind: "shape",        count: 1, tags: ["pennant", "wave", "divider"]             },
      { kind: "texture",      count: 1, tags: ["waves", "flow", "grain"]                 },
      { kind: "sticker",      count: 1, tags: ["stamp", "passport", "explore"]           },
      { kind: "frame",        count: 1, tags: ["polaroid", "memory", "photo"]            },
    ],
  },

  marketing: {
    category: "marketing",
    summary:  "Promotional and attention-grabbing. Launch visuals, badges, star bursts.",
    entries: [
      { kind: "illustration", count: 1, required: true                                   },
      { kind: "icon",         count: 2, tags: ["announce", "launch", "sale", "new"]      },
      { kind: "shape",        count: 1, tags: ["burst", "attention", "arrow", "cta"]     },
      { kind: "texture",      count: 1, tags: ["confetti", "checker", "dots"]            },
      { kind: "badge",        count: 1, tags: ["new", "sale", "offer", "burst"]          },
      { kind: "ribbon",       count: 1, tags: ["tag", "sale", "banner"]                  },
    ],
  },

  // Step 34: motivation — aspirational / achievement content.
  motivation: {
    category: "motivation",
    summary:  "Aspirational and bold. Mountain / sunrise illustrations, achievement badges, streak icons.",
    entries: [
      { kind: "illustration", count: 1, required: true                                   },
      { kind: "icon",         count: 2, tags: ["trophy", "peak", "flame", "arrow", "star"] },
      { kind: "badge",        count: 1, tags: ["achievement", "trophy", "verified"]      },
      { kind: "shape",        count: 1, tags: ["burst", "arrow", "star", "sparkle"]      },
      { kind: "texture",      count: 1, tags: ["grain", "lines", "confetti"]             },
    ],
  },
};

// ── Selection ─────────────────────────────────────────────────────────────────

export interface SelectOptions {
  // Stable string so repeated generations yield the same selection — usually
  // a templateId / assetId. When omitted, picks are random.
  seed?: string;
  // Hard cap on total assets returned (across all kinds). The recipe order
  // determines priority when truncating.
  limit?: number;
  // When true, kinds marked `required` will fall back to a cross-category
  // pick of the same kind if the category itself has none of that kind.
  enforceRequired?: boolean;
  // Step 36: visual-style consistency. When set, the selector pins every
  // pick to this style (style-agnostic assets without a visualStyle tag
  // still pass through — ribbons, badges, dividers, etc.). Default
  // behavior: when omitted, the selector auto-picks the best-available
  // style for the category — "3d" is preferred if the category has any
  // 3D assets, otherwise the first style that has enough coverage. This
  // stops a single template from mixing 3D renders with flat photos or
  // hand-drawn illustrations.
  visualStyle?:      AssetVisualStyle;
  // When true, the auto-style-pick skips styles with fewer than the
  // recipe's total entry count — prevents "3d" from being chosen just
  // because one 3D icon exists in the category. Default true.
  enforceStyleCoverage?: boolean;
}

// Step 36 + 40: preferred visual style fallback order.
//
// "illustration" is first because Step 40 added a self-contained
// inline-SVG illustration library (svg-scene-composer) that renders
// offline with no CDN or AI dependency — always available, always
// deterministic. "3d" ranks second: when ARKIOL_3D_ASSET_BASE is
// populated with curated renders, 3D wins via per-asset scoring; when
// it isn't, the Unsplash fallback is inconsistent and we'd rather fall
// back to the inline illustrations. Everything after is legacy.
const STYLE_PREFERENCE: readonly AssetVisualStyle[] = [
  "illustration", "3d", "flat", "outline", "photo", "hand-drawn",
];

/**
 * Pick the best-available visual style for a category. Walks the
 * STYLE_PREFERENCE order and returns the first style that covers at
 * least the recipe's meaningful-entry count (illustrations + photos —
 * the kinds that actually carry visualStyle). Returns null when no
 * style has enough coverage, meaning the template falls back to
 * style-agnostic selection (mixed output is acceptable in that case
 * because there's no better option).
 */
export function resolveVisualStyleForCategory(
  category: AssetCategory,
  enforceCoverage: boolean = true,
): AssetVisualStyle | null {
  const recipe = CATEGORY_RECIPES[category];
  if (!recipe) return null;

  // Only illustration / photo kinds carry a visualStyle today, so
  // coverage = how many illustration/photo entries the recipe asks
  // for. That's the target threshold.
  const targetCount = recipe.entries
    .filter(e => e.kind === "illustration" || e.kind === "photo")
    .reduce((s, e) => s + e.count, 0);

  for (const style of STYLE_PREFERENCE) {
    const pool = queryAssets({ category, visualStyle: style })
      .filter(a => a.visualStyle === style);  // require exact match, not pass-through
    if (!enforceCoverage) {
      if (pool.length > 0) return style;
    } else if (pool.length >= Math.max(1, targetCount)) {
      return style;
    }
  }
  return null;
}

/**
 * Select a concrete list of assets for a given category, following its recipe.
 * No layout / placement logic here — just the picks.
 *
 * Selection order within each recipe entry:
 *   1. Pool = assets whose category (or extraCategories) includes `category`,
 *      filtered by recipe entry kind.
 *   2. Rank by category-profile score (see category-profile.ts) so picks lean
 *      toward the on-brand choices for the category (e.g. checklist icons
 *      for productivity, calm blobs for wellness, charts for business,
 *      energy bursts for fitness).
 *   3. Break remaining ties using recipe tag bias — this keeps per-entry
 *      narrowing (e.g. icon entry asking for "time" + "done" tags) working
 *      alongside the global category profile.
 *   4. Deterministic pickFromPool via seed.
 */
export function selectAssetsForCategory(
  category: AssetCategory,
  opts: SelectOptions = {},
): Asset[] {
  const recipe = CATEGORY_RECIPES[category];
  if (!recipe) return [];
  const enforceRequired = opts.enforceRequired ?? true;
  const picked: Asset[] = [];
  const seenIds = new Set<string>();

  // Step 36: resolve visual style once at the top so every recipe slot
  // pins to the same style. Explicit opts.visualStyle wins; otherwise
  // auto-pick via STYLE_PREFERENCE — "3d" first when available.
  const resolvedStyle: AssetVisualStyle | null =
    opts.visualStyle ?? resolveVisualStyleForCategory(category, opts.enforceStyleCoverage ?? true);

  recipe.entries.forEach((entry, entryIdx) => {
    // Candidate pool: category + kind, pinned to the resolved visual
    // style when one was chosen. Style-agnostic assets (no visualStyle
    // set — ribbons, badges, icons, textures) still pass through.
    const base = resolvedStyle
      ? queryAssets({ category, kind: entry.kind, visualStyle: resolvedStyle })
      : queryAssets({ category, kind: entry.kind });

    // Two-key sort: primary key is the category-profile score (how on-brand
    // this asset is for the category overall), secondary key is the entry
    // tag score (how well it matches this particular recipe slot).
    const ranked = [...base].sort((a, b) => {
      const ds = scoreAssetForCategory(b, category) - scoreAssetForCategory(a, category);
      if (ds !== 0) return ds;
      if (entry.tags && entry.tags.length > 0) {
        return tagScore(b, entry.tags) - tagScore(a, entry.tags);
      }
      return 0;
    });

    let remaining = [...ranked];

    for (let i = 0; i < entry.count; i++) {
      // Stable per-slot seed keeps the mix reproducible across reloads.
      const slotSeed = opts.seed ? `${opts.seed}::${entry.kind}::${entryIdx}::${i}` : undefined;
      const pool = remaining.filter(a => !seenIds.has(a.id));
      if (pool.length === 0) break;

      // Pick from the top-scoring segment first — only fall back to the
      // long tail if the seed rotates us past it. This biases toward
      // category-aligned picks without making them forced.
      const topScore = scoreAssetForCategory(pool[0], category);
      const topBand  = pool.filter(a => scoreAssetForCategory(a, category) >= Math.max(1, topScore - 2));
      const pickPool = topBand.length > 0 ? topBand : pool;

      const pick = pickFromPool(pickPool, slotSeed);
      if (!pick) break;
      picked.push(pick);
      seenIds.add(pick.id);
      remaining = pool;
    }

    // Required-fallback: if this kind is required and we found nothing in
    // the category, pull any asset of this kind from the global pool,
    // ranked by category-profile score so the fallback is still on-brand.
    if (enforceRequired && entry.required && picked.filter(a => a.kind === entry.kind).length === 0) {
      const global = queryAssets({ kind: entry.kind });
      const rankedGlobal = [...global].sort(
        (a, b) => scoreAssetForCategory(b, category) - scoreAssetForCategory(a, category),
      );
      const fallback = pickFromPool(
        rankedGlobal.filter(a => !seenIds.has(a.id)),
        opts.seed ? `${opts.seed}::fallback::${entry.kind}` : undefined,
      ) ?? pickAsset({ kind: entry.kind, seed: opts.seed ? `${opts.seed}::fallback::${entry.kind}` : undefined });
      if (fallback && !seenIds.has(fallback.id)) {
        picked.push(fallback);
        seenIds.add(fallback.id);
      }
    }
  });

  return typeof opts.limit === "number" ? picked.slice(0, opts.limit) : picked;
}

// ── Category inference ───────────────────────────────────────────────────────
// Lightweight text → category detection, used when upstream metadata didn't
// already stash a categoryPackId. Mirrors (a subset of) detectCategoryPack
// from engines/style — kept local so the library has no engine dependency.

const CATEGORY_KEYWORDS: Record<AssetCategory, string[]> = {
  productivity: ["productivity", "task", "todo", "focus", "plan", "deadline", "checklist", "schedule", "workflow"],
  wellness:     ["wellness", "mindful", "meditation", "calm", "yoga", "self-care", "selfcare", "balance", "breath"],
  education:    ["education", "learn", "course", "tutorial", "study", "class", "lesson", "guide", "how to", "student"],
  business:     ["business", "corporate", "b2b", "saas", "startup", "revenue", "strategy", "roi", "leadership"],
  fitness:      ["fitness", "workout", "gym", "exercise", "cardio", "strength", "run", "athlete", "training"],
  beauty:       ["beauty", "skincare", "makeup", "cosmetic", "glow", "serum", "spa", "salon", "hair", "nail"],
  travel:       ["travel", "vacation", "destination", "adventure", "flight", "hotel", "beach", "tourism"],
  marketing:    ["marketing", "sale", "promo", "discount", "launch", "campaign", "announcement", "offer", "shop"],
  motivation:   ["motivation", "inspire", "inspiration", "goal", "goals", "mindset", "aspire", "achieve",
                 "success", "dream", "quote", "affirmation", "hustle", "rise", "grind", "win",
                 "empower", "courage", "growth"],
};

/**
 * Infer a content category from arbitrary text (intent, headline, keywords).
 * Returns null if no category scores > 0.
 */
export function inferCategoryFromText(text: string | null | undefined): AssetCategory | null {
  if (!text) return null;
  const t = text.toLowerCase();
  let best: AssetCategory | null = null;
  let bestScore = 0;
  for (const c of ASSET_CATEGORIES) {
    let score = 0;
    for (const kw of CATEGORY_KEYWORDS[c]) {
      if (t.includes(kw)) score++;
    }
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return best;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function tagScore(a: Asset, wanted: string[]): number {
  const set = new Set(wanted.map(t => t.toLowerCase()));
  let s = 0;
  for (const t of a.tags) if (set.has(t.toLowerCase())) s++;
  return s;
}

function pickFromPool(pool: Asset[], seed?: string): Asset | null {
  if (pool.length === 0) return null;
  const idx = seed ? hashString(seed) % pool.length : Math.floor(Math.random() * pool.length);
  return pool[idx];
}

function hashString(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
