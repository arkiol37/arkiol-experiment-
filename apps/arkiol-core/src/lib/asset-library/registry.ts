// Asset library — registry + query API.
//
// Thin wrapper over the seed data that lets callers (template generation,
// editor UI, AI pipeline) look up assets contextually without importing the
// raw array. All queries are O(n) over the seed and indexed lazily.

import { ASSETS } from "./data";
import type {
  Asset,
  AssetCategory,
  AssetKind,
  AssetQuery,
  AssetRealm,
} from "./types";

export const ASSET_CATEGORIES: readonly AssetCategory[] = Object.freeze([
  "productivity", "wellness", "education", "business",
  "fitness", "beauty", "travel", "marketing", "motivation",
]);

export const ASSET_KINDS: readonly AssetKind[] = Object.freeze([
  "icon", "illustration", "photo", "shape", "texture",
  "sticker", "badge", "ribbon", "frame", "divider",
]);

// Step 35: real-world subject realms.
export const ASSET_REALMS: readonly AssetRealm[] = Object.freeze([
  "nature", "animal", "lifestyle", "object", "scene",
]);

// ── Lazy indexes ──────────────────────────────────────────────────────────────

let idIndex:       Map<string, Asset> | null = null;
let categoryIndex: Map<AssetCategory, Asset[]> | null = null;
let kindIndex:     Map<AssetKind, Asset[]> | null = null;
let realmIndex:    Map<AssetRealm, Asset[]> | null = null;

function assetCategories(a: Asset): AssetCategory[] {
  return a.extraCategories ? [a.category, ...a.extraCategories] : [a.category];
}

function buildIndexes(): void {
  if (idIndex && categoryIndex && kindIndex && realmIndex) return;
  idIndex = new Map();
  categoryIndex = new Map();
  kindIndex = new Map();
  realmIndex = new Map();
  for (const a of ASSETS) {
    idIndex.set(a.id, a);
    for (const c of assetCategories(a)) {
      const bucket = categoryIndex.get(c) ?? [];
      bucket.push(a);
      categoryIndex.set(c, bucket);
    }
    const kb = kindIndex.get(a.kind) ?? [];
    kb.push(a);
    kindIndex.set(a.kind, kb);
    if (a.realm) {
      const rb = realmIndex.get(a.realm) ?? [];
      rb.push(a);
      realmIndex.set(a.realm, rb);
    }
  }
}

// ── Query API ─────────────────────────────────────────────────────────────────

export function getAssetById(id: string): Asset | undefined {
  buildIndexes();
  return idIndex!.get(id);
}

export function getAssetsByCategory(category: AssetCategory): Asset[] {
  buildIndexes();
  return (categoryIndex!.get(category) ?? []).slice();
}

export function getAssetsByKind(kind: AssetKind): Asset[] {
  buildIndexes();
  return (kindIndex!.get(kind) ?? []).slice();
}

// Step 35: realm-indexed lookup — all nature / animal / lifestyle /
// object / scene assets in the library.
export function getAssetsByRealm(realm: AssetRealm): Asset[] {
  buildIndexes();
  return (realmIndex!.get(realm) ?? []).slice();
}

export function getAllAssets(): readonly Asset[] {
  return ASSETS;
}

// Flexible query — any combination of category, kind, tags.
export function queryAssets(q: AssetQuery = {}): Asset[] {
  buildIndexes();

  // Start from the narrowest index.
  let pool: Asset[];
  if (q.category)      pool = getAssetsByCategory(q.category);
  else if (q.kind)     pool = getAssetsByKind(q.kind);
  else                 pool = ASSETS.slice();

  if (q.category && q.kind) {
    pool = pool.filter(a => a.kind === q.kind);
  }

  if (q.tags && q.tags.length > 0) {
    const wanted = new Set(q.tags.map(t => t.toLowerCase()));
    pool = pool.filter(a => a.tags.some(t => wanted.has(t.toLowerCase())));
  }

  // Step 34: style axis for icons (outline / filled / duotone). Assets
  // without a `style` are style-agnostic and pass unconditionally — so
  // filtering on style doesn't silently drop ribbons / badges / etc.
  if (q.style) {
    pool = pool.filter(a => a.style === undefined || a.style === q.style);
  }

  // Step 35: realm filter is *exact match* (no pass-through for unset),
  // because a realm query is the caller explicitly asking for real-world
  // subjects — decorative / abstract assets should not surface.
  if (q.realm) {
    pool = pool.filter(a => a.realm === q.realm);
  }

  // Step 36: visualStyle filter passes through style-less assets (they're
  // style-agnostic — e.g. ribbons, dividers) so a "3d" query doesn't
  // silently drop decorative elements the template legitimately needs
  // alongside the 3D real-world assets.
  if (q.visualStyle) {
    pool = pool.filter(a => a.visualStyle === undefined || a.visualStyle === q.visualStyle);
  }

  // Step 47: qualityTier filter acts as a floor — passing "premium"
  // keeps only premium-tagged assets; passing "standard" keeps premium
  // + standard (rejecting "draft"). Unset tier is treated as "standard".
  if (q.qualityTier) {
    const floorRank = QUALITY_TIER_RANK[q.qualityTier];
    pool = pool.filter(a => {
      const tier = a.qualityTier ?? "standard";
      return QUALITY_TIER_RANK[tier] >= floorRank;
    });
  }

  if (typeof q.limit === "number" && q.limit >= 0) {
    pool = pool.slice(0, q.limit);
  }
  return pool;
}

// Higher rank = higher quality. Used by queryAssets() to implement the
// tier floor — e.g. a "standard" query admits premium + standard,
// rejecting "draft" tier entirely.
const QUALITY_TIER_RANK: Record<import("./types").AssetQualityTier, number> = {
  draft:    0,
  standard: 1,
  premium:  2,
};

// Deterministic "pick one" — useful for template generation so the same
// input yields the same asset selection across runs. The `seed` string can
// be anything stable (e.g. template id + slot id).
export function pickAsset(q: AssetQuery & { seed?: string } = {}): Asset | null {
  const pool = queryAssets(q);
  if (pool.length === 0) return null;
  const idx = q.seed ? hashString(q.seed) % pool.length : Math.floor(Math.random() * pool.length);
  return pool[idx];
}

function hashString(s: string): number {
  // djb2 — small, stable, no deps.
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

// ── Insertion helper ──────────────────────────────────────────────────────────
// Converts an asset payload into a value suitable for an editor `image`
// element's `src`. SVG/pattern assets are emitted as data URLs; photos keep
// their URL. Layout wiring is intentionally out of scope at this step.

export function assetToImageSrc(asset: Asset): string {
  const p = asset.payload;
  if (p.format === "url")     return p.url;
  if (p.format === "svg")     return svgToDataUrl(p.markup);
  if (p.format === "pattern") return svgToDataUrl(p.svg);
  return "";
}

function svgToDataUrl(svg: string): string {
  // Encode enough to be safe in a data URL without a full base64 hop.
  const encoded = svg
    .replace(/"/g, "'")
    .replace(/>\s+</g, "><")
    .replace(/[\r\n\t]/g, "")
    .replace(/#/g, "%23")
    .replace(/%/g, "%25")
    .replace(/</g, "%3C")
    .replace(/>/g, "%3E");
  return `data:image/svg+xml;charset=UTF-8,${encoded}`;
}

// ── Stats (handy for tests / debug) ───────────────────────────────────────────

export function libraryStats(): {
  total: number;
  byCategory: Record<AssetCategory, number>;
  byKind: Record<AssetKind, number>;
  byRealm: Record<AssetRealm, number>;
} {
  buildIndexes();
  const byCategory = {} as Record<AssetCategory, number>;
  for (const c of ASSET_CATEGORIES) byCategory[c] = (categoryIndex!.get(c) ?? []).length;
  const byKind = {} as Record<AssetKind, number>;
  for (const k of ASSET_KINDS) byKind[k] = (kindIndex!.get(k) ?? []).length;
  const byRealm = {} as Record<AssetRealm, number>;
  for (const r of ASSET_REALMS) byRealm[r] = (realmIndex!.get(r) ?? []).length;
  return { total: ASSETS.length, byCategory, byKind, byRealm };
}
