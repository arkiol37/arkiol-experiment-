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
} from "./types";

export const ASSET_CATEGORIES: readonly AssetCategory[] = Object.freeze([
  "productivity", "wellness", "education", "business",
  "fitness", "beauty", "travel", "marketing",
]);

export const ASSET_KINDS: readonly AssetKind[] = Object.freeze([
  "icon", "illustration", "photo", "shape", "texture",
]);

// ── Lazy indexes ──────────────────────────────────────────────────────────────

let idIndex:       Map<string, Asset> | null = null;
let categoryIndex: Map<AssetCategory, Asset[]> | null = null;
let kindIndex:     Map<AssetKind, Asset[]> | null = null;

function assetCategories(a: Asset): AssetCategory[] {
  return a.extraCategories ? [a.category, ...a.extraCategories] : [a.category];
}

function buildIndexes(): void {
  if (idIndex && categoryIndex && kindIndex) return;
  idIndex = new Map();
  categoryIndex = new Map();
  kindIndex = new Map();
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

  if (typeof q.limit === "number" && q.limit >= 0) {
    pool = pool.slice(0, q.limit);
  }
  return pool;
}

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
} {
  buildIndexes();
  const byCategory = {} as Record<AssetCategory, number>;
  for (const c of ASSET_CATEGORIES) byCategory[c] = (categoryIndex!.get(c) ?? []).length;
  const byKind = {} as Record<AssetKind, number>;
  for (const k of ASSET_KINDS) byKind[k] = (kindIndex!.get(k) ?? []).length;
  return { total: ASSETS.length, byCategory, byKind };
}
