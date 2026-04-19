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

import type { Asset, AssetCategory, AssetKind } from "./types";
import { queryAssets, pickAsset, ASSET_CATEGORIES } from "./registry";

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
}

/**
 * Select a concrete list of assets for a given category, following its recipe.
 * No layout / placement logic here — just the picks.
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

  recipe.entries.forEach((entry, entryIdx) => {
    // Candidate pool: category + kind, then optional tag filter.
    const base = queryAssets({ category, kind: entry.kind });
    const taggedFirst = entry.tags && entry.tags.length > 0
      ? [...base].sort((a, b) => tagScore(b, entry.tags!) - tagScore(a, entry.tags!))
      : base;

    let remaining = [...taggedFirst];

    for (let i = 0; i < entry.count; i++) {
      // Stable per-slot seed keeps the mix reproducible across reloads.
      const slotSeed = opts.seed ? `${opts.seed}::${entry.kind}::${entryIdx}::${i}` : undefined;
      const pool = remaining.filter(a => !seenIds.has(a.id));
      if (pool.length === 0) break;

      const pick = pickFromPool(pool, slotSeed);
      if (!pick) break;
      picked.push(pick);
      seenIds.add(pick.id);
      remaining = pool;
    }

    // Required-fallback: if this kind is required and we found nothing in
    // the category, pull any asset of this kind from the global pool.
    if (enforceRequired && entry.required && picked.filter(a => a.kind === entry.kind).length === 0) {
      const fallback = pickAsset({ kind: entry.kind, seed: opts.seed ? `${opts.seed}::fallback::${entry.kind}` : undefined });
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
