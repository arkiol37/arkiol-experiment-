// src/engines/assets/photo-asset-manifest.ts
//
// Canonical catalog of licensed-photo slugs the system expects when
// ARKIOL_PHOTO_ASSET_BASE is populated. Mirrors the shape of
// 3d-asset-manifest.ts so the same ops pattern (CDN + env var + slug)
// applies to both.
//
// URL convention:
//   ${ARKIOL_PHOTO_ASSET_BASE}/${slug}.${ARKIOL_PHOTO_ASSET_EXT ?? "jpg"}
//
// Why this exists: the inline-SVG scene library covers ~85% of Canva-
// style templates (text-driven posts, decorations, illustrations),
// but three recurring template archetypes genuinely need real
// photography:
//
//   1. Food-forward templates (healthy eating, recipes, meal plans)
//   2. Beauty / self-care product templates (skincare flatlays, candles)
//   3. Fashion / lifestyle templates (outfits, models, portraits)
//
// This manifest specifies the exact slugs a deployment must host to
// close those gaps. When the env var is unset, the library gracefully
// falls back to Unsplash-query URLs (see `photo()` in data.ts) so
// local dev + CI stay functional.
//
// Deployment recipe:
//   1. Source / license one photo per slug (Unsplash+, Pexels license,
//      or commissioned photography). Match the notes/aspect ratio.
//   2. Upload to a public CDN at `<base>/<slug>.<ext>`.
//   3. Set ARKIOL_PHOTO_ASSET_BASE + optional ARKIOL_PHOTO_ASSET_EXT
//      on the deployment.
//   4. Confirm via /api/health/generation — `photo.configured` flips
//      to `true` and `photo.totalSlugs` matches the manifest size.

export interface PhotoAssetSlug {
  slug:          string;
  label:         string;
  category:      string;             // primary library category this asset serves
  realm:         "food" | "beauty" | "fashion" | "lifestyle" | "nature" | "object" | "scene";
  aspectRatio:   number;             // w / h — 1.0 square, 1.6 hero, 2.0 banner
  suggestedSize: { w: number; h: number };
  // Suggested photographer attribution source. Optional, for ops.
  notes?:        string;
}

export const PHOTO_ASSET_MANIFEST: readonly PhotoAssetSlug[] = Object.freeze([
  // ── Food (8) — closes "Healthy Eating Habits" archetype ─────────────
  { slug: "food-salad-bowl",      label: "Fresh salad bowl",       category: "wellness",  realm: "food",      aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 }, notes: "top-down, bright natural light" },
  { slug: "food-healthy-plate",   label: "Balanced plate",         category: "wellness",  realm: "food",      aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 }, notes: "macro-focused plate, protein + greens + grain" },
  { slug: "food-breakfast-spread",label: "Breakfast spread",       category: "wellness",  realm: "food",      aspectRatio: 1.6, suggestedSize: { w: 1920, h: 1200 }, notes: "oats, fruit, coffee — flat lay" },
  { slug: "food-smoothie-bowl",   label: "Smoothie bowl",          category: "wellness",  realm: "food",      aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 }, notes: "berries + granola topping" },
  { slug: "food-fruit-platter",   label: "Fruit platter",          category: "wellness",  realm: "food",      aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 } },
  { slug: "food-meal-prep",       label: "Meal prep containers",   category: "fitness",   realm: "food",      aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 } },
  { slug: "food-coffee-pastry",   label: "Coffee + pastry",        category: "marketing", realm: "food",      aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 } },
  { slug: "food-pasta-dish",      label: "Pasta dish",             category: "marketing", realm: "food",      aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 } },

  // ── Beauty / self-care products (8) — closes "Self-Care Reminders" ──
  { slug: "beauty-skincare-flatlay",label: "Skincare flatlay",      category: "beauty",    realm: "beauty",    aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 }, notes: "pastel backdrop, 3–5 products" },
  { slug: "beauty-serum-bottle",   label: "Serum bottle close-up", category: "beauty",    realm: "beauty",    aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 } },
  { slug: "beauty-candle-lit",     label: "Lit candle",            category: "wellness",  realm: "beauty",    aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 } },
  { slug: "beauty-spa-setup",      label: "Spa setup",             category: "wellness",  realm: "beauty",    aspectRatio: 1.6, suggestedSize: { w: 1920, h: 1200 } },
  { slug: "beauty-makeup-flatlay", label: "Makeup flatlay",        category: "beauty",    realm: "beauty",    aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 } },
  { slug: "beauty-bath-essentials",label: "Bath essentials",       category: "beauty",    realm: "beauty",    aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 } },
  { slug: "beauty-eye-palette",    label: "Eye palette",           category: "beauty",    realm: "beauty",    aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 } },
  { slug: "beauty-perfume-bottle", label: "Perfume bottle",        category: "beauty",    realm: "beauty",    aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 } },

  // ── Fashion / lifestyle people (9) — closes "Style Guide" archetype ─
  { slug: "fashion-outfit-flatlay",label: "Outfit flatlay",        category: "beauty",    realm: "fashion",   aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 }, notes: "top-down clothing layout" },
  { slug: "fashion-street-style",  label: "Street-style portrait", category: "beauty",    realm: "fashion",   aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 }, notes: "face obscured / back-turned preferred for reuse" },
  { slug: "fashion-accessories",   label: "Accessories flatlay",   category: "beauty",    realm: "fashion",   aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 } },
  { slug: "fashion-shoes-flatlay", label: "Shoes flatlay",         category: "beauty",    realm: "fashion",   aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 } },
  { slug: "fashion-handbag",       label: "Handbag product",       category: "beauty",    realm: "fashion",   aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 } },
  { slug: "lifestyle-person-working",label: "Person at laptop",    category: "productivity",realm: "lifestyle", aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 }, notes: "anonymous / over-shoulder shot preferred" },
  { slug: "lifestyle-person-yoga", label: "Yoga pose",             category: "wellness",  realm: "lifestyle", aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 } },
  { slug: "lifestyle-person-reading",label: "Person reading",      category: "education", realm: "lifestyle", aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 } },
  { slug: "lifestyle-group-meeting",label: "Team meeting",         category: "business",  realm: "lifestyle", aspectRatio: 1.6, suggestedSize: { w: 1920, h: 1200 } },

  // ── Fitness / activity (4) ─────────────────────────────────────────
  { slug: "fitness-gym-workout",   label: "Gym workout",           category: "fitness",   realm: "lifestyle", aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 } },
  { slug: "fitness-yoga-mat",      label: "Yoga mat setup",        category: "fitness",   realm: "object",    aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 } },
  { slug: "fitness-running-outdoor",label: "Outdoor running",      category: "fitness",   realm: "lifestyle", aspectRatio: 1.6, suggestedSize: { w: 1920, h: 1200 } },
  { slug: "fitness-water-bottle",  label: "Sport bottle",          category: "fitness",   realm: "object",    aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 } },

  // ── Travel photography (4) — real-photo counterparts to scene kinds ─
  { slug: "travel-mountain-vista", label: "Mountain vista",        category: "travel",    realm: "scene",     aspectRatio: 1.6, suggestedSize: { w: 1920, h: 1200 } },
  { slug: "travel-beach-sunset",   label: "Beach at sunset",       category: "travel",    realm: "scene",     aspectRatio: 1.6, suggestedSize: { w: 1920, h: 1200 } },
  { slug: "travel-cafe-scene",     label: "Café scene",            category: "travel",    realm: "scene",     aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 } },
  { slug: "travel-passport",       label: "Passport + map",        category: "travel",    realm: "object",    aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 } },

  // ── Business / workspace (4) ───────────────────────────────────────
  { slug: "business-desk-flatlay", label: "Desk flatlay",          category: "business",    realm: "object",    aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 } },
  { slug: "business-laptop-coffee",label: "Laptop + coffee",       category: "productivity",realm: "object",    aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 } },
  { slug: "business-notebook-pen", label: "Notebook + pen",        category: "education",   realm: "object",    aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 } },
  { slug: "business-handshake",    label: "Handshake",             category: "business",    realm: "lifestyle", aspectRatio: 1.6, suggestedSize: { w: 1920, h: 1200 } },

  // ── Marketing / celebration (3) ────────────────────────────────────
  { slug: "marketing-confetti-burst",label: "Confetti burst",      category: "marketing",   realm: "scene",     aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 } },
  { slug: "marketing-product-table",label: "Product on table",     category: "marketing",   realm: "scene",     aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 } },
  { slug: "marketing-shop-window", label: "Shop-window lifestyle", category: "marketing",   realm: "lifestyle", aspectRatio: 1.6, suggestedSize: { w: 1920, h: 1200 } },
]);

// ── Helpers ──────────────────────────────────────────────────────────────────

function photoAssetExt(): string {
  if (typeof process === "undefined") return "jpg";
  const v = (process.env as Record<string, string | undefined>).ARKIOL_PHOTO_ASSET_EXT;
  const ext = v && v.length > 0 ? v.replace(/^\.+/, "").toLowerCase() : "jpg";
  // Only allow a safe set; anything else falls back to jpg to avoid
  // URL-encoding surprises or content-type mismatches on the CDN.
  return /^(jpg|jpeg|png|webp|avif)$/.test(ext) ? ext : "jpg";
}

export function photoAssetBaseUrl(): string | undefined {
  if (typeof process === "undefined") return undefined;
  const v = (process.env as Record<string, string | undefined>).ARKIOL_PHOTO_ASSET_BASE;
  return v && v.length > 0 ? v.replace(/\/+$/, "") : undefined;
}

export function photoAssetUrl(slug: string): string | undefined {
  const base = photoAssetBaseUrl();
  return base ? `${base}/${slug}.${photoAssetExt()}` : undefined;
}

export function isPhotoAssetConfigured(): boolean {
  return photoAssetBaseUrl() !== undefined;
}

// Diagnostic summary for /api/health/generation + startup logs.
export function photoAssetManifestStats(): {
  configured:  boolean;
  baseUrl:     string | undefined;
  extension:   string;
  totalSlugs:  number;
  byRealm:     Record<string, number>;
  byCategory:  Record<string, number>;
} {
  const byRealm:    Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  for (const m of PHOTO_ASSET_MANIFEST) {
    byRealm[m.realm]       = (byRealm[m.realm]       ?? 0) + 1;
    byCategory[m.category] = (byCategory[m.category] ?? 0) + 1;
  }
  return {
    configured: isPhotoAssetConfigured(),
    baseUrl:    photoAssetBaseUrl(),
    extension:  photoAssetExt(),
    totalSlugs: PHOTO_ASSET_MANIFEST.length,
    byRealm,
    byCategory,
  };
}

// Lookup a single manifest entry by slug (for asset-library plumbing).
export function getPhotoAssetSlug(slug: string): PhotoAssetSlug | undefined {
  return PHOTO_ASSET_MANIFEST.find(m => m.slug === slug);
}
