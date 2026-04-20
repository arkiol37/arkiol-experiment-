// src/engines/assets/3d-asset-manifest.ts
//
// Canonical list of 3D asset slugs the system expects when
// ARKIOL_3D_ASSET_BASE is populated. Deployments that want the "3D"
// visualStyle path to win over inline-SVG illustrations must serve a
// PNG (ideally WebP for size) at each slug below from the CDN base.
//
// URL convention:
//   ${ARKIOL_3D_ASSET_BASE}/${slug}.png
//
// Example deployment recipe:
//   1. Source / commission one 3D render per slug. Recommended style:
//      claymorphism or softly lit 3D, consistent camera angle, clean
//      background, 1200×1200 minimum (or 1920×1200 for 1.6-ratio
//      slugs flagged below).
//   2. Upload to a public CDN under a single prefix, e.g.
//      https://cdn.arkiol.com/3d/<slug>.png
//   3. Set ARKIOL_3D_ASSET_BASE=https://cdn.arkiol.com/3d on the
//      worker. The render3d() helper in data.ts picks it up
//      automatically; no code change needed.
//   4. The marketplace-gate's styleConsistent criterion will then
//      prefer "3d" over "illustration" for categories with full
//      coverage.
//
// Every slug carries its ideal aspect ratio + suggested license /
// source so ops can budget and attribute correctly. The manifest is
// read-only — update it here when a new 3D slug lands in the library.

export interface Asset3DSlug {
  slug:        string;
  label:       string;
  category:    string;     // primary library category this asset serves
  realm:       "nature" | "animal" | "lifestyle" | "object" | "scene";
  aspectRatio: number;     // w / h
  suggestedSize: { w: number; h: number };
  notes?:      string;
}

export const ASSET_3D_MANIFEST: readonly Asset3DSlug[] = Object.freeze([
  // ── Nature (8) ─────────────────────────────────────────────────────
  { slug: "nature-mountain-range", label: "Mountain range",    category: "travel",      realm: "nature",    aspectRatio: 1.6, suggestedSize: { w: 1920, h: 1200 } },
  { slug: "nature-river",          label: "River stream",      category: "wellness",    realm: "nature",    aspectRatio: 1.6, suggestedSize: { w: 1920, h: 1200 } },
  { slug: "nature-forest",         label: "Forest scene",      category: "wellness",    realm: "nature",    aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 } },
  { slug: "nature-ocean-waves",    label: "Ocean waves",       category: "travel",      realm: "nature",    aspectRatio: 1.6, suggestedSize: { w: 1920, h: 1200 } },
  { slug: "nature-sky-clouds",     label: "Sky clouds",        category: "motivation",  realm: "nature",    aspectRatio: 1.6, suggestedSize: { w: 1920, h: 1200 } },
  { slug: "nature-potted-plant",   label: "Potted plant",      category: "wellness",    realm: "nature",    aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 } },
  { slug: "nature-sunset",         label: "Golden hour",       category: "motivation",  realm: "nature",    aspectRatio: 1.6, suggestedSize: { w: 1920, h: 1200 } },
  { slug: "nature-leaf",           label: "Leaf",              category: "wellness",    realm: "nature",    aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 } },

  // ── Animal (5) ─────────────────────────────────────────────────────
  { slug: "animal-dog",            label: "Dog",               category: "wellness",    realm: "animal",    aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 } },
  { slug: "animal-cat",            label: "Cat",               category: "wellness",    realm: "animal",    aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 } },
  { slug: "animal-bird-flight",    label: "Bird in flight",    category: "motivation",  realm: "animal",    aspectRatio: 1.6, suggestedSize: { w: 1920, h: 1200 } },
  { slug: "animal-butterfly",      label: "Butterfly",         category: "beauty",      realm: "animal",    aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 } },
  { slug: "animal-deer",           label: "Deer",              category: "wellness",    realm: "animal",    aspectRatio: 1.6, suggestedSize: { w: 1920, h: 1200 } },

  // ── Lifestyle (6) ──────────────────────────────────────────────────
  { slug: "lifestyle-workspace",   label: "Workspace",         category: "productivity",realm: "lifestyle", aspectRatio: 1.6, suggestedSize: { w: 1920, h: 1200 } },
  { slug: "lifestyle-reading-nook",label: "Reading nook",      category: "education",   realm: "lifestyle", aspectRatio: 1.6, suggestedSize: { w: 1920, h: 1200 } },
  { slug: "lifestyle-plant-room",  label: "Plant-filled room", category: "wellness",    realm: "lifestyle", aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 } },
  { slug: "lifestyle-kitchen",     label: "Kitchen counter",   category: "wellness",    realm: "lifestyle", aspectRatio: 1.6, suggestedSize: { w: 1920, h: 1200 } },
  { slug: "lifestyle-bedroom",     label: "Bedroom",           category: "wellness",    realm: "lifestyle", aspectRatio: 1.6, suggestedSize: { w: 1920, h: 1200 } },
  { slug: "lifestyle-home-office", label: "Home office",       category: "business",    realm: "lifestyle", aspectRatio: 1.6, suggestedSize: { w: 1920, h: 1200 } },

  // ── Object (8) ─────────────────────────────────────────────────────
  { slug: "object-books-stack",    label: "Books stack",       category: "education",   realm: "object",    aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 } },
  { slug: "object-water-bottle",   label: "Water bottle",      category: "fitness",     realm: "object",    aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 } },
  { slug: "object-dumbbell",       label: "Dumbbell",          category: "fitness",     realm: "object",    aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 } },
  { slug: "object-suitcase",       label: "Suitcase",          category: "travel",      realm: "object",    aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 } },
  { slug: "object-coffee-cup",     label: "Coffee cup",        category: "productivity",realm: "object",    aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 } },
  { slug: "object-laptop",         label: "Laptop",            category: "business",    realm: "object",    aspectRatio: 1.3, suggestedSize: { w: 1600, h: 1200 } },
  { slug: "object-skincare-bottle",label: "Skincare bottle",   category: "beauty",      realm: "object",    aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 } },
  { slug: "object-notebook",       label: "Notebook",          category: "education",   realm: "object",    aspectRatio: 1.3, suggestedSize: { w: 1600, h: 1200 } },
  { slug: "object-toy-rocket",     label: "Toy rocket",        category: "marketing",   realm: "object",    aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 } },

  // ── Scene (5) ──────────────────────────────────────────────────────
  { slug: "scene-city-skyline",    label: "City skyline",      category: "business",    realm: "scene",     aspectRatio: 2.0, suggestedSize: { w: 2000, h: 1000 } },
  { slug: "scene-beach-horizon",   label: "Beach horizon",     category: "travel",      realm: "scene",     aspectRatio: 2.0, suggestedSize: { w: 2000, h: 1000 } },
  { slug: "scene-cafe-interior",   label: "Café interior",     category: "marketing",   realm: "scene",     aspectRatio: 1.6, suggestedSize: { w: 1920, h: 1200 } },
  { slug: "scene-living-room",     label: "Living room",       category: "wellness",    realm: "scene",     aspectRatio: 1.6, suggestedSize: { w: 1920, h: 1200 } },
  { slug: "scene-urban-street",    label: "Urban street",      category: "marketing",   realm: "scene",     aspectRatio: 1.6, suggestedSize: { w: 1920, h: 1200 } },
]);

// ── Helpers ──────────────────────────────────────────────────────────────────

export function asset3dBaseUrl(): string | undefined {
  if (typeof process === "undefined") return undefined;
  const v = (process.env as Record<string, string | undefined>).ARKIOL_3D_ASSET_BASE;
  return v && v.length > 0 ? v.replace(/\/+$/, "") : undefined;
}

export function asset3dUrl(slug: string): string | undefined {
  const base = asset3dBaseUrl();
  return base ? `${base}/${slug}.png` : undefined;
}

export function isAsset3dConfigured(): boolean {
  return asset3dBaseUrl() !== undefined;
}

// Diagnostic summary — useful in health endpoints or startup logs so
// ops can see at a glance whether the 3D catalog is live.
export function asset3dManifestStats(): {
  configured:     boolean;
  baseUrl:        string | undefined;
  totalSlugs:     number;
  byRealm:        Record<string, number>;
  byCategory:     Record<string, number>;
} {
  const byRealm:    Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  for (const m of ASSET_3D_MANIFEST) {
    byRealm[m.realm]       = (byRealm[m.realm]       ?? 0) + 1;
    byCategory[m.category] = (byCategory[m.category] ?? 0) + 1;
  }
  return {
    configured: isAsset3dConfigured(),
    baseUrl:    asset3dBaseUrl(),
    totalSlugs: ASSET_3D_MANIFEST.length,
    byRealm,
    byCategory,
  };
}
