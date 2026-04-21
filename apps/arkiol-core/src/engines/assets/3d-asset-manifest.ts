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
  // Step 47: quality expectations. Every curated slug in this manifest
  // must ship as a premium-tier render — modern, clean, high-resolution
  // 3D with consistent lighting and camera angle. A "standard" slug is
  // acceptable decorative supporting art. "draft" entries are dev-only
  // placeholders and MUST NOT appear in production. Defaulting the
  // field to "premium" for the whole manifest enforces the platform's
  // hero-grade visual contract.
  qualityTier: "premium" | "standard";
  // Style contract — every 3D manifest entry is always visualStyle="3d".
  // Declared here explicitly so downstream code can trust the guarantee
  // without re-reading every asset record.
  visualStyle: "3d";
}

export const ASSET_3D_MANIFEST: readonly Asset3DSlug[] = Object.freeze([
  // ── Nature (8) ─────────────────────────────────────────────────────
  { slug: "nature-mountain-range", label: "Mountain range",    category: "travel",      realm: "nature",    aspectRatio: 1.6, suggestedSize: { w: 1920, h: 1200 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "nature-river",          label: "River stream",      category: "wellness",    realm: "nature",    aspectRatio: 1.6, suggestedSize: { w: 1920, h: 1200 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "nature-forest",         label: "Forest scene",      category: "wellness",    realm: "nature",    aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "nature-ocean-waves",    label: "Ocean waves",       category: "travel",      realm: "nature",    aspectRatio: 1.6, suggestedSize: { w: 1920, h: 1200 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "nature-sky-clouds",     label: "Sky clouds",        category: "motivation",  realm: "nature",    aspectRatio: 1.6, suggestedSize: { w: 1920, h: 1200 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "nature-potted-plant",   label: "Potted plant",      category: "wellness",    realm: "nature",    aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "nature-sunset",         label: "Golden hour",       category: "motivation",  realm: "nature",    aspectRatio: 1.6, suggestedSize: { w: 1920, h: 1200 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "nature-leaf",           label: "Leaf",              category: "wellness",    realm: "nature",    aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 }, qualityTier: "premium", visualStyle: "3d" },

  // ── Animal (5) ─────────────────────────────────────────────────────
  { slug: "animal-dog",            label: "Dog",               category: "wellness",    realm: "animal",    aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "animal-cat",            label: "Cat",               category: "wellness",    realm: "animal",    aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "animal-bird-flight",    label: "Bird in flight",    category: "motivation",  realm: "animal",    aspectRatio: 1.6, suggestedSize: { w: 1920, h: 1200 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "animal-butterfly",      label: "Butterfly",         category: "beauty",      realm: "animal",    aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "animal-deer",           label: "Deer",              category: "wellness",    realm: "animal",    aspectRatio: 1.6, suggestedSize: { w: 1920, h: 1200 }, qualityTier: "premium", visualStyle: "3d" },

  // ── Lifestyle (6) ──────────────────────────────────────────────────
  { slug: "lifestyle-workspace",   label: "Workspace",         category: "productivity",realm: "lifestyle", aspectRatio: 1.6, suggestedSize: { w: 1920, h: 1200 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "lifestyle-reading-nook",label: "Reading nook",      category: "education",   realm: "lifestyle", aspectRatio: 1.6, suggestedSize: { w: 1920, h: 1200 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "lifestyle-plant-room",  label: "Plant-filled room", category: "wellness",    realm: "lifestyle", aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "lifestyle-kitchen",     label: "Kitchen counter",   category: "wellness",    realm: "lifestyle", aspectRatio: 1.6, suggestedSize: { w: 1920, h: 1200 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "lifestyle-bedroom",     label: "Bedroom",           category: "wellness",    realm: "lifestyle", aspectRatio: 1.6, suggestedSize: { w: 1920, h: 1200 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "lifestyle-home-office", label: "Home office",       category: "business",    realm: "lifestyle", aspectRatio: 1.6, suggestedSize: { w: 1920, h: 1200 }, qualityTier: "premium", visualStyle: "3d" },

  // ── Object (8) ─────────────────────────────────────────────────────
  { slug: "object-books-stack",    label: "Books stack",       category: "education",   realm: "object",    aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "object-water-bottle",   label: "Water bottle",      category: "fitness",     realm: "object",    aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "object-dumbbell",       label: "Dumbbell",          category: "fitness",     realm: "object",    aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "object-suitcase",       label: "Suitcase",          category: "travel",      realm: "object",    aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "object-coffee-cup",     label: "Coffee cup",        category: "productivity",realm: "object",    aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "object-laptop",         label: "Laptop",            category: "business",    realm: "object",    aspectRatio: 1.3, suggestedSize: { w: 1600, h: 1200 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "object-skincare-bottle",label: "Skincare bottle",   category: "beauty",      realm: "object",    aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "object-notebook",       label: "Notebook",          category: "education",   realm: "object",    aspectRatio: 1.3, suggestedSize: { w: 1600, h: 1200 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "object-toy-rocket",     label: "Toy rocket",        category: "marketing",   realm: "object",    aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 }, qualityTier: "premium", visualStyle: "3d" },

  // ── Scene (5) ──────────────────────────────────────────────────────
  { slug: "scene-city-skyline",    label: "City skyline",      category: "business",    realm: "scene",     aspectRatio: 2.0, suggestedSize: { w: 2000, h: 1000 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "scene-beach-horizon",   label: "Beach horizon",     category: "travel",      realm: "scene",     aspectRatio: 2.0, suggestedSize: { w: 2000, h: 1000 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "scene-cafe-interior",   label: "Café interior",     category: "marketing",   realm: "scene",     aspectRatio: 1.6, suggestedSize: { w: 1920, h: 1200 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "scene-living-room",     label: "Living room",       category: "wellness",    realm: "scene",     aspectRatio: 1.6, suggestedSize: { w: 1920, h: 1200 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "scene-urban-street",    label: "Urban street",      category: "marketing",   realm: "scene",     aspectRatio: 1.6, suggestedSize: { w: 1920, h: 1200 }, qualityTier: "premium", visualStyle: "3d" },
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
  premiumSlugs:   number;
  byRealm:        Record<string, number>;
  byCategory:     Record<string, number>;
} {
  const byRealm:    Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  let premiumCount = 0;
  for (const m of ASSET_3D_MANIFEST) {
    byRealm[m.realm]       = (byRealm[m.realm]       ?? 0) + 1;
    byCategory[m.category] = (byCategory[m.category] ?? 0) + 1;
    if (m.qualityTier === "premium") premiumCount += 1;
  }
  return {
    configured:   isAsset3dConfigured(),
    baseUrl:      asset3dBaseUrl(),
    totalSlugs:   ASSET_3D_MANIFEST.length,
    premiumSlugs: premiumCount,
    byRealm,
    byCategory,
  };
}

// ── Quality gate ─────────────────────────────────────────────────────────────
// Step 47: the 3D manifest is the platform's hero-grade visual contract —
// every slug must be a premium, modern, high-resolution 3D render with
// consistent lighting and camera angle. These helpers make that contract
// checkable so ops can fail fast when a regression lands.

/** True when every manifest entry is tagged as premium-tier. */
export function is3dManifestPremiumOnly(): boolean {
  return ASSET_3D_MANIFEST.every(m => m.qualityTier === "premium");
}

/** All manifest entries at or above the given quality tier. */
export function asset3dSlugsByQualityTier(
  tier: "premium" | "standard",
): readonly Asset3DSlug[] {
  if (tier === "premium") {
    return ASSET_3D_MANIFEST.filter(m => m.qualityTier === "premium");
  }
  return ASSET_3D_MANIFEST;
}

/** Look up a single manifest entry by slug. */
export function getAsset3dSlug(slug: string): Asset3DSlug | undefined {
  return ASSET_3D_MANIFEST.find(m => m.slug === slug);
}
