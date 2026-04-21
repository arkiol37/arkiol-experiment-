// Asset library — seed data.
//
// Curated entries across the 8 supported categories and 5 asset kinds.
// This is the foundation set — enough to prove contextual selection works.
// Every inline SVG is minimal, currentColor-aware where it makes sense, and
// viewBox-normalized so renderers can resize without distortion.
//
// Photos are referenced by stable CDN URLs (Unsplash source) so template
// generation does not need any local binary bundling at this stage.

import type { Asset } from "./types";

// ── SVG helpers ───────────────────────────────────────────────────────────────
// Kept inline so assets remain self-contained strings.

const icon = (viewBox: string, body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

const illus = (viewBox: string, body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">${body}</svg>`;

const shape = (viewBox: string, body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">${body}</svg>`;

// Stickers/badges/ribbons/frames/dividers use full-color SVG (not currentColor)
// so they remain recognizable when dropped into any surrounding design.
const art = (viewBox: string, body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">${body}</svg>`;

const tile = (size: number, body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${body}</svg>`;

// Photo placeholder via Unsplash Source (stable, deterministic, no auth).
const photo = (query: string, w = 1600, h = 1600): string =>
  `https://source.unsplash.com/featured/${w}x${h}/?${encodeURIComponent(query)}`;

// Step 45: photo asset slug helper. When ARKIOL_PHOTO_ASSET_BASE is set,
// the library resolves each entry to `<base>/<slug>.<ext>` — a CDN-
// hosted, licensed photograph. Without the env var, falls back to the
// Unsplash-query path so dev and CI keep working. Mirrors render3d()
// so ops can wire both CDNs with the same pattern.
const renderPhoto = (slug: string, fallbackQuery: string, w = 1600, h = 1600): string => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const base = typeof process !== "undefined"
    ? (process.env as any)?.ARKIOL_PHOTO_ASSET_BASE
    : undefined;
  if (typeof base === "string" && base.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const extEnv = (process.env as any)?.ARKIOL_PHOTO_ASSET_EXT;
    const ext = typeof extEnv === "string" && /^(jpg|jpeg|png|webp|avif)$/i.test(extEnv)
      ? extEnv.replace(/^\.+/, "").toLowerCase()
      : "jpg";
    return `${base.replace(/\/+$/, "")}/${slug}.${ext}`;
  }
  return photo(fallbackQuery, w, h);
};

// Step 36: 3D-render asset URL. Prefixes the query with "3d render
// claymorphism" so the upstream image host returns consistent 3D /
// claymorphic renders rather than ordinary photos. Ships as its own
// helper so a future CDN swap (e.g. `https://cdn.arkiol.com/3d/...`)
// only has to change this one function.
//
// ARKIOL_3D_ASSET_BASE env override lets ops point the helper at a
// curated 3D-render CDN when one is wired up — the default falls back
// to the 3D-query Unsplash path so the library keeps working out of
// the box.
const render3d = (slug: string, query: string, w = 1600, h = 1600): string => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const base = typeof process !== "undefined"
    ? (process.env as any)?.ARKIOL_3D_ASSET_BASE
    : undefined;
  if (typeof base === "string" && base.length > 0) {
    return `${base.replace(/\/+$/, "")}/${slug}.png`;
  }
  return `https://source.unsplash.com/featured/${w}x${h}/?${encodeURIComponent(`3d render ${query}`)}`;
};

// ── Icons ─────────────────────────────────────────────────────────────────────
// Each icon is a compact 24px-grid pictogram thematically tied to a category.

const ICONS: Asset[] = [
  // productivity
  { id: "icon.productivity.check",   kind: "icon", category: "productivity", label: "Check",        tags: ["done", "complete", "task"],
    payload: { format: "svg", markup: icon("0 0 24 24", '<path d="M4 12l5 5L20 6"/>') } },
  { id: "icon.productivity.list",    kind: "icon", category: "productivity", label: "Checklist",    tags: ["todo", "list", "plan"],
    payload: { format: "svg", markup: icon("0 0 24 24", '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M8 9h8M8 13h8M8 17h5"/>') } },
  { id: "icon.productivity.clock",   kind: "icon", category: "productivity", label: "Clock",        tags: ["time", "schedule", "deadline"],
    payload: { format: "svg", markup: icon("0 0 24 24", '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>') } },

  // wellness
  { id: "icon.wellness.leaf",        kind: "icon", category: "wellness", label: "Leaf",             tags: ["calm", "nature", "mindful"],
    payload: { format: "svg", markup: icon("0 0 24 24", '<path d="M20 4C10 4 4 10 4 20c10 0 16-6 16-16zM4 20L14 10"/>') } },
  { id: "icon.wellness.heart",       kind: "icon", category: "wellness", label: "Heart",            tags: ["love", "care", "health"],
    payload: { format: "svg", markup: icon("0 0 24 24", '<path d="M12 20s-7-4.5-7-10a4 4 0 017-2.6A4 4 0 0119 10c0 5.5-7 10-7 10z"/>') } },
  { id: "icon.wellness.yoga",        kind: "icon", category: "wellness", label: "Meditation",       tags: ["yoga", "calm", "focus"],
    payload: { format: "svg", markup: icon("0 0 24 24", '<circle cx="12" cy="6" r="2.5"/><path d="M12 9v5M4 20c3-4 5-4 8-4s5 0 8 4"/>') } },

  // education
  { id: "icon.education.book",       kind: "icon", category: "education", label: "Open book",        tags: ["learn", "read", "study"],
    payload: { format: "svg", markup: icon("0 0 24 24", '<path d="M4 5h6a3 3 0 013 3v11H6a2 2 0 01-2-2V5zM20 5h-6a3 3 0 00-3 3v11h6a2 2 0 002-2V5z"/>') } },
  { id: "icon.education.cap",        kind: "icon", category: "education", label: "Graduation cap",   tags: ["graduate", "school", "academic"],
    payload: { format: "svg", markup: icon("0 0 24 24", '<path d="M2 9l10-5 10 5-10 5L2 9z"/><path d="M6 11v5c2 2 10 2 12 0v-5"/>') } },
  { id: "icon.education.pencil",     kind: "icon", category: "education", label: "Pencil",           tags: ["write", "edit", "note"],
    payload: { format: "svg", markup: icon("0 0 24 24", '<path d="M4 20l4-1 11-11-3-3L5 16l-1 4z"/>') } },

  // business
  { id: "icon.business.briefcase",   kind: "icon", category: "business", label: "Briefcase",         tags: ["work", "office", "corporate"],
    payload: { format: "svg", markup: icon("0 0 24 24", '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 012-2h2a2 2 0 012 2v2"/>') } },
  { id: "icon.business.chart",       kind: "icon", category: "business", label: "Growth chart",      tags: ["growth", "data", "roi"],
    payload: { format: "svg", markup: icon("0 0 24 24", '<path d="M4 20V4M4 20h16M8 16l4-4 3 3 5-6"/>') } },
  { id: "icon.business.handshake",   kind: "icon", category: "business", label: "Partnership",       tags: ["deal", "trust", "team"],
    payload: { format: "svg", markup: icon("0 0 24 24", '<path d="M3 13l4-4 3 2 3-3 3 3 5-2M3 13l5 5 3-1 3 1 5-5"/>') } },

  // fitness
  { id: "icon.fitness.dumbbell",     kind: "icon", category: "fitness", label: "Dumbbell",           tags: ["gym", "strong", "train"],
    payload: { format: "svg", markup: icon("0 0 24 24", '<path d="M3 10v4M6 8v8M18 8v8M21 10v4M6 12h12"/>') } },
  { id: "icon.fitness.run",          kind: "icon", category: "fitness", label: "Runner",             tags: ["run", "cardio", "energy"],
    payload: { format: "svg", markup: icon("0 0 24 24", '<circle cx="15" cy="5" r="2"/><path d="M7 20l3-5 3 1 2-4 4 3M10 12l-2-3-4 1"/>') } },
  { id: "icon.fitness.bolt",         kind: "icon", category: "fitness", label: "Bolt",               tags: ["energy", "power", "fast"],
    payload: { format: "svg", markup: icon("0 0 24 24", '<path d="M13 2L4 14h7l-2 8 10-13h-7l1-7z"/>') } },

  // beauty
  { id: "icon.beauty.sparkle",       kind: "icon", category: "beauty", label: "Sparkle",             tags: ["glow", "shine", "magic"],
    payload: { format: "svg", markup: icon("0 0 24 24", '<path d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2 2-6z"/>') } },
  { id: "icon.beauty.flower",        kind: "icon", category: "beauty", label: "Flower",              tags: ["floral", "soft", "feminine"],
    payload: { format: "svg", markup: icon("0 0 24 24", '<circle cx="12" cy="12" r="2"/><path d="M12 4a4 4 0 010 6M12 14a4 4 0 010 6M4 12a4 4 0 016 0M14 12a4 4 0 016 0"/>') } },
  { id: "icon.beauty.drop",          kind: "icon", category: "beauty", label: "Serum drop",          tags: ["skincare", "hydrate", "pure"],
    payload: { format: "svg", markup: icon("0 0 24 24", '<path d="M12 3c4 5 6 8 6 11a6 6 0 11-12 0c0-3 2-6 6-11z"/>') } },

  // travel
  { id: "icon.travel.plane",         kind: "icon", category: "travel", label: "Paper plane",         tags: ["fly", "journey", "explore"],
    payload: { format: "svg", markup: icon("0 0 24 24", '<path d="M3 11l18-8-6 18-4-7-8-3z"/>') } },
  { id: "icon.travel.compass",       kind: "icon", category: "travel", label: "Compass",             tags: ["explore", "direction", "adventure"],
    payload: { format: "svg", markup: icon("0 0 24 24", '<circle cx="12" cy="12" r="9"/><path d="M15 9l-2 6-6 2 2-6 6-2z"/>') } },
  { id: "icon.travel.pin",           kind: "icon", category: "travel", label: "Location pin",        tags: ["map", "place", "city"],
    payload: { format: "svg", markup: icon("0 0 24 24", '<path d="M12 22s7-7 7-12a7 7 0 10-14 0c0 5 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/>') } },

  // marketing
  { id: "icon.marketing.megaphone",  kind: "icon", category: "marketing", label: "Megaphone",        tags: ["announce", "launch", "promo"],
    payload: { format: "svg", markup: icon("0 0 24 24", '<path d="M3 10v4l10 4V6L3 10zM13 8c3 0 5 2 5 4s-2 4-5 4"/>') } },
  { id: "icon.marketing.tag",        kind: "icon", category: "marketing", label: "Price tag",        tags: ["sale", "offer", "discount"],
    payload: { format: "svg", markup: icon("0 0 24 24", '<path d="M3 12V4h8l10 10-8 8-10-10z"/><circle cx="8" cy="8" r="1.5"/>') } },
  { id: "icon.marketing.spark",      kind: "icon", category: "marketing", label: "New spark",        tags: ["new", "launch", "idea"],
    payload: { format: "svg", markup: icon("0 0 24 24", '<path d="M12 2v4M12 18v4M2 12h4M18 12h4M5 5l3 3M16 16l3 3M5 19l3-3M16 8l3-3"/>') } },

  // universal / multi-category
  { id: "icon.common.star",          kind: "icon", category: "marketing", extraCategories: ["beauty", "fitness"], label: "Star",         tags: ["star", "rating", "favorite"],
    payload: { format: "svg", markup: icon("0 0 24 24", '<path d="M12 3l3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z"/>') } },
  { id: "icon.common.arrow",         kind: "icon", category: "business", extraCategories: ["productivity", "marketing"], label: "Arrow right", tags: ["arrow", "direction", "cta"],
    payload: { format: "svg", markup: icon("0 0 24 24", '<path d="M4 12h15M14 6l6 6-6 6"/>') } },
  { id: "icon.common.location",      kind: "icon", category: "travel", extraCategories: ["business"], label: "Globe",   tags: ["globe", "world", "explore"],
    payload: { format: "svg", markup: icon("0 0 24 24", '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>') } },
  { id: "icon.common.calendar",      kind: "icon", category: "productivity", extraCategories: ["business", "education"], label: "Calendar", tags: ["calendar", "event", "schedule"],
    payload: { format: "svg", markup: icon("0 0 24 24", '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>') } },
];

// ── Illustrations ─────────────────────────────────────────────────────────────
// Simple composed vector scenes — single per category as a starting point.

const ILLUSTRATIONS: Asset[] = [
  { id: "illus.productivity.stack",  kind: "illustration", category: "productivity", label: "Task stack",
    tags: ["organize", "plan", "flow"], aspectRatio: 1,
    payload: { format: "svg", markup: illus("0 0 200 200",
      '<rect x="30" y="40" width="140" height="30" rx="6" fill="#DBEAFE"/>' +
      '<rect x="30" y="80" width="140" height="30" rx="6" fill="#BFDBFE"/>' +
      '<rect x="30" y="120" width="140" height="30" rx="6" fill="#93C5FD"/>' +
      '<circle cx="50" cy="55" r="6" fill="#1D4ED8"/><circle cx="50" cy="95" r="6" fill="#1D4ED8"/><circle cx="50" cy="135" r="6" fill="#1D4ED8"/>') } },

  { id: "illus.wellness.wave",       kind: "illustration", category: "wellness", label: "Calm waves",
    tags: ["calm", "flow", "breath"], aspectRatio: 2,
    payload: { format: "svg", markup: illus("0 0 400 200",
      '<path d="M0 120 Q 100 80 200 120 T 400 120 V200 H0Z" fill="#A7F3D0"/>' +
      '<path d="M0 140 Q 100 100 200 140 T 400 140 V200 H0Z" fill="#6EE7B7" opacity="0.8"/>' +
      '<path d="M0 160 Q 100 130 200 160 T 400 160 V200 H0Z" fill="#34D399" opacity="0.7"/>') } },

  { id: "illus.education.idea",      kind: "illustration", category: "education", label: "Big idea bulb",
    tags: ["idea", "learn", "creative"], aspectRatio: 1,
    payload: { format: "svg", markup: illus("0 0 200 200",
      '<circle cx="100" cy="90" r="50" fill="#FEF3C7"/>' +
      '<rect x="85" y="135" width="30" height="20" rx="3" fill="#92400E"/>' +
      '<path d="M40 90h-12M160 90h12M100 25v12M58 48l8 8M142 48l-8 8" stroke="#F59E0B" stroke-width="4" stroke-linecap="round"/>') } },

  { id: "illus.business.growth",     kind: "illustration", category: "business", label: "Upward arrow",
    tags: ["growth", "scale", "success"], aspectRatio: 1.5,
    payload: { format: "svg", markup: illus("0 0 300 200",
      '<rect x="20" y="140" width="40" height="40" fill="#1E40AF"/>' +
      '<rect x="80" y="110" width="40" height="70" fill="#2563EB"/>' +
      '<rect x="140" y="70" width="40" height="110" fill="#3B82F6"/>' +
      '<rect x="200" y="30" width="40" height="150" fill="#60A5FA"/>' +
      '<path d="M30 150 L250 30 M250 30l-20 5 M250 30l-5 20" stroke="#F97316" stroke-width="4" fill="none" stroke-linecap="round"/>') } },

  { id: "illus.fitness.energy",      kind: "illustration", category: "fitness", label: "Energy burst",
    tags: ["energy", "power", "move"], aspectRatio: 1,
    payload: { format: "svg", markup: illus("0 0 200 200",
      '<circle cx="100" cy="100" r="60" fill="#FCA5A5"/>' +
      '<path d="M100 40 L110 100 L160 100 L105 120 L125 170 L95 130 L55 150 L85 105 L40 90 L95 95 Z" fill="#DC2626"/>') } },

  { id: "illus.beauty.petals",       kind: "illustration", category: "beauty", label: "Soft petals",
    tags: ["floral", "soft", "bloom"], aspectRatio: 1,
    payload: { format: "svg", markup: illus("0 0 200 200",
      '<ellipse cx="100" cy="60" rx="30" ry="50" fill="#FBCFE8"/>' +
      '<ellipse cx="140" cy="100" rx="30" ry="50" fill="#F9A8D4" transform="rotate(72 140 100)"/>' +
      '<ellipse cx="120" cy="150" rx="30" ry="50" fill="#F472B6" transform="rotate(144 120 150)"/>' +
      '<ellipse cx="80" cy="150" rx="30" ry="50" fill="#F9A8D4" transform="rotate(216 80 150)"/>' +
      '<ellipse cx="60" cy="100" rx="30" ry="50" fill="#FBCFE8" transform="rotate(288 60 100)"/>' +
      '<circle cx="100" cy="110" r="14" fill="#FEF3C7"/>') } },

  { id: "illus.travel.mountains",    kind: "illustration", category: "travel", label: "Mountain horizon",
    tags: ["adventure", "nature", "journey"], aspectRatio: 2,
    payload: { format: "svg", markup: illus("0 0 400 200",
      '<rect width="400" height="200" fill="#DBEAFE"/>' +
      '<circle cx="320" cy="50" r="22" fill="#FDE68A"/>' +
      '<path d="M0 160 L80 90 L140 140 L220 60 L300 130 L360 100 L400 140 V200 H0Z" fill="#3B82F6"/>' +
      '<path d="M0 180 L90 130 L180 170 L260 120 L340 170 L400 150 V200 H0Z" fill="#1E40AF"/>') } },

  { id: "illus.marketing.launch",    kind: "illustration", category: "marketing", label: "Rocket launch",
    tags: ["launch", "new", "go"], aspectRatio: 1,
    payload: { format: "svg", markup: illus("0 0 200 200",
      '<path d="M100 20 Q120 60 120 110 L80 110 Q80 60 100 20Z" fill="#EF4444"/>' +
      '<circle cx="100" cy="80" r="10" fill="#FFF"/>' +
      '<path d="M80 110 L60 140 L90 130 Z" fill="#F97316"/>' +
      '<path d="M120 110 L140 140 L110 130 Z" fill="#F97316"/>' +
      '<path d="M90 130 Q100 170 110 130 Q100 180 90 130Z" fill="#FBBF24"/>') } },
];

// ── Photos (Unsplash) ─────────────────────────────────────────────────────────
// One representative query per category — library callers can request more.

const PHOTOS: Asset[] = [
  // ── Existing baseline (1 per category) ────────────────────────────
  { id: "photo.productivity.desk",   kind: "photo", category: "productivity", label: "Tidy desk",
    tags: ["desk", "workspace", "focus"], aspectRatio: 1,
    payload: { format: "url", url: renderPhoto("business-laptop-coffee", "minimal desk workspace"), width: 1600, height: 1600 } },
  { id: "photo.wellness.spa",        kind: "photo", category: "wellness", label: "Spa stones",
    tags: ["spa", "calm", "zen"], aspectRatio: 1,
    payload: { format: "url", url: renderPhoto("beauty-spa-setup", "spa stones water"), width: 1600, height: 1600 } },
  { id: "photo.education.library",   kind: "photo", category: "education", label: "Library shelves",
    tags: ["library", "books", "study"], aspectRatio: 1,
    payload: { format: "url", url: renderPhoto("lifestyle-person-reading", "library books shelves"), width: 1600, height: 1600 } },
  { id: "photo.business.city",       kind: "photo", category: "business", label: "City skyline",
    tags: ["city", "corporate", "skyline"], aspectRatio: 1.6,
    payload: { format: "url", url: renderPhoto("lifestyle-group-meeting", "city skyline dawn", 1920, 1200), width: 1920, height: 1200 } },
  { id: "photo.fitness.gym",         kind: "photo", category: "fitness", label: "Gym weights",
    tags: ["gym", "training"], aspectRatio: 1,
    payload: { format: "url", url: renderPhoto("fitness-gym-workout", "gym dumbbells training"), width: 1600, height: 1600 } },
  { id: "photo.beauty.skincare",     kind: "photo", category: "beauty", label: "Skincare flatlay",
    tags: ["skincare", "beauty", "clean", "self-care", "product"], aspectRatio: 1,
    payload: { format: "url", url: renderPhoto("beauty-skincare-flatlay", "skincare flatlay pastel"), width: 1600, height: 1600 } },
  { id: "photo.travel.beach",        kind: "photo", category: "travel", label: "Beach horizon",
    tags: ["beach", "ocean", "vacation"], aspectRatio: 1.6,
    payload: { format: "url", url: renderPhoto("travel-beach-sunset", "beach ocean horizon", 1920, 1200), width: 1920, height: 1200 } },
  { id: "photo.marketing.confetti",  kind: "photo", category: "marketing", label: "Launch confetti",
    tags: ["launch", "celebration", "promo"], aspectRatio: 1.6,
    payload: { format: "url", url: renderPhoto("marketing-confetti-burst", "celebration confetti colorful", 1920, 1200), width: 1920, height: 1200 } },

  // ── Step 45: food photography (closes "Healthy Eating Habits") ────
  { id: "photo.wellness.salad",      kind: "photo", category: "wellness", label: "Fresh salad bowl",
    extraCategories: ["education"], tags: ["food", "salad", "healthy", "greens", "meal", "nutrition", "diet"], aspectRatio: 1,
    payload: { format: "url", url: renderPhoto("food-salad-bowl", "fresh salad bowl healthy"), width: 1600, height: 1600 } },
  { id: "photo.wellness.healthy-plate", kind: "photo", category: "wellness", label: "Balanced plate",
    extraCategories: ["education", "fitness"], tags: ["food", "plate", "balanced", "protein", "nutrition", "meal", "diet"], aspectRatio: 1,
    payload: { format: "url", url: renderPhoto("food-healthy-plate", "balanced meal plate"), width: 1600, height: 1600 } },
  { id: "photo.wellness.breakfast",  kind: "photo", category: "wellness", label: "Breakfast spread",
    extraCategories: ["marketing"], tags: ["breakfast", "oats", "fruit", "coffee", "food", "morning"], aspectRatio: 1.6,
    payload: { format: "url", url: renderPhoto("food-breakfast-spread", "breakfast spread oats fruit", 1920, 1200), width: 1920, height: 1200 } },
  { id: "photo.wellness.smoothie",   kind: "photo", category: "wellness", label: "Smoothie bowl",
    extraCategories: ["fitness"], tags: ["smoothie", "bowl", "berries", "granola", "healthy"], aspectRatio: 1,
    payload: { format: "url", url: renderPhoto("food-smoothie-bowl", "smoothie bowl berries"), width: 1600, height: 1600 } },
  { id: "photo.wellness.fruit",      kind: "photo", category: "wellness", label: "Fruit platter",
    tags: ["fruit", "platter", "colorful", "healthy", "diet"], aspectRatio: 1,
    payload: { format: "url", url: renderPhoto("food-fruit-platter", "fruit platter colorful"), width: 1600, height: 1600 } },
  { id: "photo.fitness.meal-prep",   kind: "photo", category: "fitness", label: "Meal prep containers",
    extraCategories: ["wellness"], tags: ["meal prep", "containers", "fitness", "diet", "nutrition"], aspectRatio: 1,
    payload: { format: "url", url: renderPhoto("food-meal-prep", "meal prep containers fitness"), width: 1600, height: 1600 } },

  // ── Step 45: beauty / self-care products (closes "Self-Care Reminders") ─
  { id: "photo.beauty.serum",        kind: "photo", category: "beauty", label: "Serum bottle",
    tags: ["serum", "bottle", "skincare", "beauty", "product", "self-care"], aspectRatio: 1,
    payload: { format: "url", url: renderPhoto("beauty-serum-bottle", "serum bottle skincare close"), width: 1600, height: 1600 } },
  { id: "photo.wellness.candle",     kind: "photo", category: "wellness", label: "Lit candle",
    extraCategories: ["beauty"], tags: ["candle", "self-care", "calm", "ambient", "cozy"], aspectRatio: 1,
    payload: { format: "url", url: renderPhoto("beauty-candle-lit", "lit candle cozy warm"), width: 1600, height: 1600 } },
  { id: "photo.beauty.makeup",       kind: "photo", category: "beauty", label: "Makeup flatlay",
    tags: ["makeup", "flatlay", "beauty", "cosmetics", "product"], aspectRatio: 1,
    payload: { format: "url", url: renderPhoto("beauty-makeup-flatlay", "makeup flatlay cosmetics"), width: 1600, height: 1600 } },
  { id: "photo.beauty.bath",         kind: "photo", category: "beauty", label: "Bath essentials",
    extraCategories: ["wellness"], tags: ["bath", "self-care", "bathroom", "essentials", "relax"], aspectRatio: 1,
    payload: { format: "url", url: renderPhoto("beauty-bath-essentials", "bath essentials self-care"), width: 1600, height: 1600 } },
  { id: "photo.beauty.perfume",      kind: "photo", category: "beauty", label: "Perfume bottle",
    tags: ["perfume", "fragrance", "bottle", "luxury", "beauty"], aspectRatio: 1,
    payload: { format: "url", url: renderPhoto("beauty-perfume-bottle", "perfume bottle luxury"), width: 1600, height: 1600 } },
  { id: "photo.wellness.spa-setup",  kind: "photo", category: "wellness", label: "Spa setup",
    extraCategories: ["beauty"], tags: ["spa", "candle", "stones", "setup", "relax", "self-care"], aspectRatio: 1.6,
    payload: { format: "url", url: renderPhoto("beauty-spa-setup", "spa setup candles stones", 1920, 1200), width: 1920, height: 1200 } },

  // ── Step 45: fashion / lifestyle (closes "Style Guide") ───────────
  { id: "photo.beauty.outfit",       kind: "photo", category: "beauty", label: "Outfit flatlay",
    tags: ["outfit", "fashion", "style", "clothing", "flatlay", "wardrobe"], aspectRatio: 1,
    payload: { format: "url", url: renderPhoto("fashion-outfit-flatlay", "outfit flatlay fashion"), width: 1600, height: 1600 } },
  { id: "photo.beauty.street-style", kind: "photo", category: "beauty", label: "Street style",
    tags: ["street style", "fashion", "outfit", "portrait", "style"], aspectRatio: 1,
    payload: { format: "url", url: renderPhoto("fashion-street-style", "street style fashion portrait"), width: 1600, height: 1600 } },
  { id: "photo.beauty.accessories",  kind: "photo", category: "beauty", label: "Accessories",
    tags: ["accessories", "jewelry", "watch", "fashion", "flatlay"], aspectRatio: 1,
    payload: { format: "url", url: renderPhoto("fashion-accessories", "fashion accessories flatlay"), width: 1600, height: 1600 } },
  { id: "photo.beauty.shoes",        kind: "photo", category: "beauty", label: "Shoes flatlay",
    tags: ["shoes", "fashion", "flatlay", "footwear", "style"], aspectRatio: 1,
    payload: { format: "url", url: renderPhoto("fashion-shoes-flatlay", "shoes flatlay fashion"), width: 1600, height: 1600 } },
  { id: "photo.beauty.handbag",      kind: "photo", category: "beauty", label: "Handbag",
    tags: ["handbag", "bag", "fashion", "luxury", "product"], aspectRatio: 1,
    payload: { format: "url", url: renderPhoto("fashion-handbag", "handbag fashion luxury"), width: 1600, height: 1600 } },

  // ── Step 45: people / lifestyle (various categories) ──────────────
  { id: "photo.productivity.person-working", kind: "photo", category: "productivity", label: "Person at laptop",
    extraCategories: ["business"], tags: ["working", "laptop", "focus", "remote", "lifestyle"], aspectRatio: 1,
    payload: { format: "url", url: renderPhoto("lifestyle-person-working", "person working laptop"), width: 1600, height: 1600 } },
  { id: "photo.wellness.person-yoga",kind: "photo", category: "wellness", label: "Yoga pose",
    extraCategories: ["fitness"], tags: ["yoga", "pose", "mindful", "lifestyle", "wellbeing"], aspectRatio: 1,
    payload: { format: "url", url: renderPhoto("lifestyle-person-yoga", "yoga pose mindful"), width: 1600, height: 1600 } },
  { id: "photo.education.person-reading",kind: "photo", category: "education", label: "Person reading",
    tags: ["reading", "book", "learning", "lifestyle", "study"], aspectRatio: 1,
    payload: { format: "url", url: renderPhoto("lifestyle-person-reading", "person reading book"), width: 1600, height: 1600 } },
  { id: "photo.business.team-meeting",kind: "photo", category: "business", label: "Team meeting",
    tags: ["team", "meeting", "collaboration", "business", "office"], aspectRatio: 1.6,
    payload: { format: "url", url: renderPhoto("lifestyle-group-meeting", "team meeting collaboration", 1920, 1200), width: 1920, height: 1200 } },
  { id: "photo.fitness.running",     kind: "photo", category: "fitness", label: "Outdoor running",
    tags: ["running", "outdoor", "exercise", "cardio", "lifestyle"], aspectRatio: 1.6,
    payload: { format: "url", url: renderPhoto("fitness-running-outdoor", "outdoor running exercise", 1920, 1200), width: 1920, height: 1200 } },
  { id: "photo.fitness.yoga-mat",    kind: "photo", category: "fitness", label: "Yoga mat",
    tags: ["yoga mat", "fitness", "equipment", "home workout"], aspectRatio: 1,
    payload: { format: "url", url: renderPhoto("fitness-yoga-mat", "yoga mat equipment"), width: 1600, height: 1600 } },

  // ── Step 45: travel scenes ────────────────────────────────────────
  { id: "photo.travel.mountain-vista", kind: "photo", category: "travel", label: "Mountain vista",
    tags: ["mountain", "vista", "travel", "adventure", "landscape"], aspectRatio: 1.6,
    payload: { format: "url", url: renderPhoto("travel-mountain-vista", "mountain vista landscape", 1920, 1200), width: 1920, height: 1200 } },
  { id: "photo.travel.cafe",         kind: "photo", category: "travel", label: "Café scene",
    extraCategories: ["marketing"], tags: ["cafe", "coffee", "travel", "scene", "interior"], aspectRatio: 1,
    payload: { format: "url", url: renderPhoto("travel-cafe-scene", "cafe coffee scene interior"), width: 1600, height: 1600 } },
  { id: "photo.travel.passport",     kind: "photo", category: "travel", label: "Passport and map",
    tags: ["passport", "map", "travel", "journey", "documents"], aspectRatio: 1,
    payload: { format: "url", url: renderPhoto("travel-passport", "passport map journey"), width: 1600, height: 1600 } },
];

// ── Decorative shapes ─────────────────────────────────────────────────────────
// Reusable vector ornaments. Each tagged so selection can match mood.

const SHAPES: Asset[] = [
  { id: "shape.blob.soft",        kind: "shape", category: "wellness",     label: "Soft blob",
    extraCategories: ["beauty", "education"], tags: ["blob", "organic", "soft"], preferredColor: "#A7F3D0",
    payload: { format: "svg", markup: shape("0 0 200 200",
      '<path d="M40 80Q60 20 120 30T180 90Q190 150 130 170T40 150Q10 110 40 80Z" fill="currentColor"/>') } },

  { id: "shape.burst.star",       kind: "shape", category: "marketing",    label: "Star burst",
    extraCategories: ["fitness"], tags: ["burst", "attention", "sale"], preferredColor: "#F97316",
    payload: { format: "svg", markup: shape("0 0 200 200",
      '<polygon fill="currentColor" points="100,10 118,70 180,70 130,108 150,170 100,132 50,170 70,108 20,70 82,70"/>') } },

  { id: "shape.ribbon.banner",    kind: "shape", category: "business",     label: "Ribbon banner",
    extraCategories: ["marketing", "education"], tags: ["banner", "ribbon", "title"], preferredColor: "#2563EB",
    payload: { format: "svg", markup: shape("0 0 300 80",
      '<path fill="currentColor" d="M10 20h280l-20 20 20 20H10l20-20z"/>') } },

  { id: "shape.circle.dot",       kind: "shape", category: "productivity", label: "Dot accent",
    extraCategories: ["travel", "beauty"], tags: ["dot", "accent", "minimal"], preferredColor: "#3B82F6",
    payload: { format: "svg", markup: shape("0 0 100 100",
      '<circle cx="50" cy="50" r="45" fill="currentColor"/>') } },

  { id: "shape.arrow.forward",    kind: "shape", category: "marketing",    label: "Forward arrow",
    extraCategories: ["business", "productivity"], tags: ["arrow", "direction", "cta"], preferredColor: "#111827",
    payload: { format: "svg", markup: shape("0 0 200 100",
      '<path fill="currentColor" d="M10 40h140V20l40 30-40 30V60H10z"/>') } },

  { id: "shape.sparkle.ornate",   kind: "shape", category: "beauty",       label: "Sparkle ornament",
    extraCategories: ["marketing"], tags: ["sparkle", "shine", "glow"], preferredColor: "#F59E0B",
    payload: { format: "svg", markup: shape("0 0 100 100",
      '<path fill="currentColor" d="M50 5l8 30 30 8-30 8-8 30-8-30-30-8 30-8z"/>') } },

  { id: "shape.triangle.tag",     kind: "shape", category: "travel",       label: "Pennant",
    extraCategories: ["fitness"], tags: ["pennant", "flag", "playful"], preferredColor: "#14B8A6",
    payload: { format: "svg", markup: shape("0 0 200 100",
      '<polygon fill="currentColor" points="0,0 200,0 160,50 200,100 0,100"/>') } },

  { id: "shape.wave.divider",     kind: "shape", category: "wellness",     label: "Wave divider",
    extraCategories: ["travel", "beauty"], tags: ["wave", "divider", "soft"], preferredColor: "#60A5FA",
    payload: { format: "svg", markup: shape("0 0 400 60",
      '<path fill="currentColor" d="M0 40 Q50 10 100 40 T200 40 T300 40 T400 40 V60 H0Z"/>') } },
];

// ── Background textures ───────────────────────────────────────────────────────
// Repeating SVG tiles. Renderers should multiply-fill the target area.

const TEXTURES: Asset[] = [
  { id: "texture.dots.neutral",   kind: "texture", category: "productivity", label: "Dot grid",
    extraCategories: ["business", "education"], tags: ["dots", "grid", "minimal"],
    payload: { format: "pattern", tileSize: 16,
      svg: tile(16, '<circle cx="8" cy="8" r="1.2" fill="currentColor" opacity="0.35"/>') } },

  { id: "texture.lines.diag",     kind: "texture", category: "business",    label: "Diagonal lines",
    extraCategories: ["marketing"], tags: ["lines", "structure", "formal"],
    payload: { format: "pattern", tileSize: 20,
      svg: tile(20, '<path d="M-2 22 L22 -2" stroke="currentColor" stroke-opacity="0.25" stroke-width="1"/>') } },

  { id: "texture.grain.paper",    kind: "texture", category: "wellness",    label: "Paper grain",
    extraCategories: ["beauty", "education"], tags: ["grain", "paper", "soft"],
    payload: { format: "pattern", tileSize: 32,
      svg: tile(32,
        '<rect width="32" height="32" fill="currentColor" opacity="0.04"/>' +
        '<circle cx="5" cy="7" r="0.6" fill="currentColor" opacity="0.15"/>' +
        '<circle cx="18" cy="3" r="0.5" fill="currentColor" opacity="0.12"/>' +
        '<circle cx="24" cy="20" r="0.7" fill="currentColor" opacity="0.18"/>' +
        '<circle cx="10" cy="26" r="0.5" fill="currentColor" opacity="0.10"/>') } },

  { id: "texture.checker.soft",   kind: "texture", category: "marketing",   label: "Soft checker",
    extraCategories: ["fitness"], tags: ["checker", "retro", "playful"],
    payload: { format: "pattern", tileSize: 24,
      svg: tile(24, '<rect width="12" height="12" fill="currentColor" opacity="0.12"/><rect x="12" y="12" width="12" height="12" fill="currentColor" opacity="0.12"/>') } },

  { id: "texture.waves.fluid",    kind: "texture", category: "travel",      label: "Fluid waves",
    extraCategories: ["wellness"], tags: ["waves", "flow", "ocean"],
    payload: { format: "pattern", tileSize: 40,
      svg: tile(40, '<path d="M0 20 Q10 10 20 20 T40 20" fill="none" stroke="currentColor" stroke-opacity="0.25" stroke-width="1.4"/>') } },

  { id: "texture.confetti.bright",kind: "texture", category: "beauty",      label: "Confetti flecks",
    extraCategories: ["marketing"], tags: ["confetti", "celebration", "playful"],
    payload: { format: "pattern", tileSize: 36,
      svg: tile(36,
        '<rect x="4" y="6" width="3" height="8" fill="#F472B6" transform="rotate(20 5 10)"/>' +
        '<rect x="20" y="14" width="3" height="8" fill="#60A5FA" transform="rotate(-40 21 18)"/>' +
        '<rect x="10" y="24" width="3" height="8" fill="#F59E0B" transform="rotate(60 11 28)"/>' +
        '<rect x="26" y="28" width="3" height="8" fill="#34D399" transform="rotate(-20 27 32)"/>') } },
];

// ── Stickers ──────────────────────────────────────────────────────────────────
// Polychrome, full-color mini-graphics that read like laptop stickers. Always
// drop-in ready — own palette, own outline, no currentColor dependency.

const STICKERS: Asset[] = [
  { id: "sticker.productivity.done",     kind: "sticker", category: "productivity", label: "Done! sticker",
    tags: ["done", "complete", "celebrate"], aspectRatio: 1,
    payload: { format: "svg", markup: art("0 0 200 200",
      '<circle cx="100" cy="100" r="86" fill="#22C55E" stroke="#14532D" stroke-width="4"/>' +
      '<path d="M60 102 L92 132 L146 74" fill="none" stroke="#FFFFFF" stroke-width="14" stroke-linecap="round" stroke-linejoin="round"/>') } },

  { id: "sticker.wellness.balance",      kind: "sticker", category: "wellness", label: "Balance stones",
    tags: ["calm", "zen", "balance"], aspectRatio: 1,
    payload: { format: "svg", markup: art("0 0 200 200",
      '<ellipse cx="100" cy="160" rx="70" ry="12" fill="#1F2937" opacity="0.15"/>' +
      '<ellipse cx="100" cy="150" rx="60" ry="14" fill="#475569"/>' +
      '<ellipse cx="100" cy="122" rx="44" ry="12" fill="#64748B"/>' +
      '<ellipse cx="100" cy="98"  rx="32" ry="10" fill="#94A3B8"/>' +
      '<ellipse cx="100" cy="78"  rx="22" ry="8"  fill="#CBD5E1"/>') } },

  { id: "sticker.education.bookworm",    kind: "sticker", category: "education", label: "Bookworm",
    tags: ["book", "learn", "fun"], aspectRatio: 1,
    payload: { format: "svg", markup: art("0 0 200 200",
      '<rect x="30" y="60" width="140" height="90" rx="8" fill="#F59E0B" stroke="#78350F" stroke-width="4"/>' +
      '<rect x="40" y="60" width="4"   height="90" fill="#78350F"/>' +
      '<rect x="156" y="60" width="4"  height="90" fill="#78350F"/>' +
      '<circle cx="100" cy="50" r="24" fill="#34D399" stroke="#065F46" stroke-width="4"/>' +
      '<circle cx="93"  cy="45" r="3"  fill="#065F46"/>' +
      '<circle cx="108" cy="45" r="3"  fill="#065F46"/>' +
      '<path d="M90 55 Q100 62 110 55" stroke="#065F46" stroke-width="3" fill="none" stroke-linecap="round"/>') } },

  { id: "sticker.business.trophy",       kind: "sticker", category: "business", label: "Trophy",
    tags: ["win", "award", "success"], aspectRatio: 1,
    payload: { format: "svg", markup: art("0 0 200 200",
      '<path d="M60 40h80v40a40 40 0 01-80 0z" fill="#FACC15" stroke="#78350F" stroke-width="4"/>' +
      '<path d="M60 55c-18 0-22-10-22-22h22M140 55c18 0 22-10 22-22h-22" fill="none" stroke="#78350F" stroke-width="4"/>' +
      '<rect x="84" y="120" width="32" height="20" fill="#FACC15" stroke="#78350F" stroke-width="4"/>' +
      '<rect x="60" y="140" width="80" height="16" rx="4" fill="#78350F"/>') } },

  { id: "sticker.fitness.flame",         kind: "sticker", category: "fitness", label: "Fire flame",
    tags: ["energy", "hot", "streak"], aspectRatio: 1,
    payload: { format: "svg", markup: art("0 0 200 200",
      '<path d="M100 20 C150 70 160 110 130 150 C120 165 80 165 70 150 C40 110 60 80 100 20Z" fill="#EF4444" stroke="#7F1D1D" stroke-width="4"/>' +
      '<path d="M100 70 C120 100 125 125 110 145 C105 152 95 152 90 145 C78 125 88 100 100 70Z" fill="#FBBF24"/>') } },

  { id: "sticker.beauty.kiss",           kind: "sticker", category: "beauty", label: "Lips",
    tags: ["lips", "glam", "beauty"], aspectRatio: 1.4,
    payload: { format: "svg", markup: art("0 0 280 200",
      '<path d="M20 100 C50 40 110 40 140 90 C170 40 230 40 260 100 C230 170 170 180 140 140 C110 180 50 170 20 100Z" fill="#EC4899" stroke="#831843" stroke-width="4"/>' +
      '<path d="M140 90 V140" stroke="#831843" stroke-width="3"/>') } },

  { id: "sticker.travel.passport",       kind: "sticker", category: "travel", label: "Passport stamp",
    tags: ["stamp", "travel", "explore"], aspectRatio: 1,
    payload: { format: "svg", markup: art("0 0 200 200",
      '<circle cx="100" cy="100" r="82" fill="none" stroke="#2563EB" stroke-width="6"/>' +
      '<circle cx="100" cy="100" r="66" fill="none" stroke="#2563EB" stroke-width="2" stroke-dasharray="4 4"/>' +
      '<text x="100" y="90"  text-anchor="middle" font-family="Impact, sans-serif" font-size="24" fill="#2563EB">EXPLORE</text>' +
      '<path d="M40 110 L160 110" stroke="#2563EB" stroke-width="2"/>' +
      '<text x="100" y="135" text-anchor="middle" font-family="Impact, sans-serif" font-size="16" fill="#2563EB">GLOBAL · 2026</text>') } },

  { id: "sticker.marketing.bang",        kind: "sticker", category: "marketing", label: "Comic bang",
    tags: ["bang", "pop", "promo"], aspectRatio: 1,
    payload: { format: "svg", markup: art("0 0 200 200",
      '<polygon fill="#F59E0B" stroke="#7C2D12" stroke-width="4" points="100,10 118,55 168,40 138,82 190,95 138,118 168,160 118,145 100,190 82,145 32,160 62,118 10,105 62,82 32,40 82,55"/>' +
      '<text x="100" y="115" text-anchor="middle" font-family="Impact, sans-serif" font-size="38" fill="#FFFFFF" stroke="#7C2D12" stroke-width="2">WOW!</text>') } },
];

// ── Badges ────────────────────────────────────────────────────────────────────
// Scalable emblems / seals. Each reads as a labeled marker.

const BADGES: Asset[] = [
  { id: "badge.marketing.new",           kind: "badge", category: "marketing", label: "NEW badge",
    tags: ["new", "launch", "emphasis"], aspectRatio: 1,
    payload: { format: "svg", markup: art("0 0 200 200",
      '<circle cx="100" cy="100" r="88" fill="#EF4444"/>' +
      '<circle cx="100" cy="100" r="72" fill="none" stroke="#FFFFFF" stroke-width="3"/>' +
      '<text x="100" y="118" text-anchor="middle" font-family="Impact, sans-serif" font-size="60" fill="#FFFFFF">NEW</text>') } },

  { id: "badge.marketing.sale",          kind: "badge", category: "marketing", label: "SALE starburst",
    tags: ["sale", "offer", "discount", "burst"], aspectRatio: 1,
    payload: { format: "svg", markup: art("0 0 200 200",
      '<polygon fill="#F97316" points="100,4 114,40 152,24 144,64 184,72 152,98 184,128 144,136 152,176 114,160 100,196 86,160 48,176 56,136 16,128 48,98 16,72 56,64 48,24 86,40"/>' +
      '<text x="100" y="118" text-anchor="middle" font-family="Impact, sans-serif" font-size="48" fill="#FFFFFF">SALE</text>') } },

  { id: "badge.marketing.percent",       kind: "badge", category: "marketing", label: "-50% off",
    tags: ["discount", "percent", "offer"], aspectRatio: 1,
    payload: { format: "svg", markup: art("0 0 200 200",
      '<circle cx="100" cy="100" r="88" fill="#111827"/>' +
      '<text x="100" y="92"  text-anchor="middle" font-family="Inter, sans-serif" font-size="24" font-weight="700" fill="#F59E0B">SAVE</text>' +
      '<text x="100" y="142" text-anchor="middle" font-family="Impact, sans-serif" font-size="64" fill="#FFFFFF">50%</text>') } },

  { id: "badge.business.verified",       kind: "badge", category: "business", label: "Verified seal",
    tags: ["verified", "trust", "seal"], aspectRatio: 1,
    payload: { format: "svg", markup: art("0 0 200 200",
      '<polygon fill="#2563EB" points="100,10 128,32 164,28 172,64 196,90 180,122 190,158 156,168 140,198 100,186 60,198 44,168 10,158 20,122 4,90 28,64 36,28 72,32"/>' +
      '<path d="M60 102 L90 132 L146 76" fill="none" stroke="#FFFFFF" stroke-width="14" stroke-linecap="round" stroke-linejoin="round"/>') } },

  { id: "badge.business.premium",        kind: "badge", category: "business", label: "Premium",
    tags: ["premium", "gold", "quality"], aspectRatio: 1,
    payload: { format: "svg", markup: art("0 0 200 200",
      '<circle cx="100" cy="100" r="88" fill="#111827" stroke="#F59E0B" stroke-width="4"/>' +
      '<circle cx="100" cy="100" r="72" fill="none" stroke="#F59E0B" stroke-width="2"/>' +
      '<path d="M64 92 L100 68 L136 92 L122 132 H78z" fill="#F59E0B"/>' +
      '<text x="100" y="156" text-anchor="middle" font-family="Inter, sans-serif" font-size="14" font-weight="700" fill="#F59E0B" letter-spacing="2">PREMIUM</text>') } },

  { id: "badge.fitness.level",           kind: "badge", category: "fitness", label: "Level up",
    tags: ["level", "achievement", "gym"], aspectRatio: 1,
    payload: { format: "svg", markup: art("0 0 200 200",
      '<polygon fill="#DC2626" points="100,8 184,60 184,140 100,192 16,140 16,60"/>' +
      '<polygon fill="#FBBF24" points="100,28 166,70 166,130 100,172 34,130 34,70"/>' +
      '<path d="M70 120 L100 60 L130 120 L100 100Z" fill="#7F1D1D"/>') } },

  { id: "badge.beauty.award",            kind: "badge", category: "beauty", label: "Beauty award",
    tags: ["award", "winner", "quality"], aspectRatio: 0.9,
    payload: { format: "svg", markup: art("0 0 180 200",
      '<path d="M90 10 L170 50 L150 130 L90 190 L30 130 L10 50Z" fill="#DB2777"/>' +
      '<circle cx="90" cy="80" r="46" fill="#FCE7F3" stroke="#831843" stroke-width="3"/>' +
      '<text x="90"  y="86"  text-anchor="middle" font-family="Inter, sans-serif" font-size="14" font-weight="700" fill="#831843">BEST</text>' +
      '<text x="90"  y="104" text-anchor="middle" font-family="Inter, sans-serif" font-size="10" fill="#831843">2026</text>' +
      '<path d="M60 130 L40 190 L90 170 L140 190 L120 130Z" fill="#F472B6" stroke="#831843" stroke-width="2"/>') } },

  { id: "badge.travel.stamp",            kind: "badge", category: "travel", label: "Destination stamp",
    tags: ["stamp", "passport", "arrived"], aspectRatio: 1,
    payload: { format: "svg", markup: art("0 0 200 200",
      '<polygon fill="none" stroke="#059669" stroke-width="5" points="30,30 170,30 170,170 30,170" transform="rotate(-6 100 100)"/>' +
      '<text x="100" y="94"  text-anchor="middle" font-family="Impact, sans-serif" font-size="24" fill="#059669" transform="rotate(-6 100 100)">ARRIVED</text>' +
      '<text x="100" y="126" text-anchor="middle" font-family="Impact, sans-serif" font-size="16" fill="#059669" transform="rotate(-6 100 100)">AT THE TOP</text>') } },
];

// ── Ribbons ───────────────────────────────────────────────────────────────────
// Title ribbons and banner streamers for section headers and callouts.

const RIBBONS: Asset[] = [
  { id: "ribbon.classic.flat",           kind: "ribbon", category: "business", extraCategories: ["education", "marketing"],
    label: "Flat banner ribbon", tags: ["banner", "title", "ribbon"], aspectRatio: 4,
    payload: { format: "svg", markup: art("0 0 400 100",
      '<path fill="#2563EB" d="M40 20 H360 L340 50 L360 80 H40 L60 50Z"/>' +
      '<path fill="#1E40AF" d="M0 30 L40 20 L60 50 L40 80 L0 70Z"/>' +
      '<path fill="#1E40AF" d="M400 30 L360 20 L340 50 L360 80 L400 70Z"/>') } },

  { id: "ribbon.pennant.twin",           kind: "ribbon", category: "marketing", extraCategories: ["fitness"],
    label: "Twin pennant", tags: ["pennant", "flag", "celebrate"], aspectRatio: 4,
    payload: { format: "svg", markup: art("0 0 400 100",
      '<path fill="#F97316" d="M20 20 H200 L180 50 L200 80 H20 L40 50Z"/>' +
      '<path fill="#EA580C" d="M0 30 L20 20 L40 50 L20 80 L0 70Z"/>' +
      '<path fill="#FACC15" d="M220 20 H380 L400 50 L380 80 H220 L240 50Z"/>' +
      '<path fill="#EAB308" d="M220 20 L200 50 L220 80 L240 50Z"/>') } },

  { id: "ribbon.vintage.scroll",         kind: "ribbon", category: "education", extraCategories: ["beauty"],
    label: "Vintage scroll", tags: ["scroll", "vintage", "award"], aspectRatio: 4,
    payload: { format: "svg", markup: art("0 0 400 100",
      '<path fill="#92400E" d="M40 30 Q200 10 360 30 L360 70 Q200 90 40 70Z"/>' +
      '<path fill="#B45309" d="M40 30 Q200 14 360 30 L360 38 Q200 22 40 38Z"/>' +
      '<path fill="#78350F" d="M0 30 L40 30 L50 50 L40 70 L0 70 L15 50Z"/>' +
      '<path fill="#78350F" d="M400 30 L360 30 L350 50 L360 70 L400 70 L385 50Z"/>') } },

  { id: "ribbon.celebrate.award",        kind: "ribbon", category: "marketing", extraCategories: ["business"],
    label: "Award streamer", tags: ["award", "winner", "best"], aspectRatio: 2,
    payload: { format: "svg", markup: art("0 0 300 150",
      '<circle cx="150" cy="60" r="46" fill="#F59E0B" stroke="#78350F" stroke-width="3"/>' +
      '<circle cx="150" cy="60" r="34" fill="none" stroke="#FFFFFF" stroke-width="2"/>' +
      '<text x="150" y="66" text-anchor="middle" font-family="Inter, sans-serif" font-weight="700" font-size="14" fill="#FFFFFF">BEST</text>' +
      '<path d="M120 100 L100 150 L140 130 L150 145 L160 130 L200 150 L180 100Z" fill="#DC2626"/>') } },

  { id: "ribbon.bow.tied",               kind: "ribbon", category: "beauty", extraCategories: ["marketing"],
    label: "Tied bow", tags: ["bow", "gift", "wrapped"], aspectRatio: 2,
    payload: { format: "svg", markup: art("0 0 200 100",
      '<path d="M100 50 Q60 20 30 30 Q20 50 30 70 Q60 80 100 50Z" fill="#EC4899"/>' +
      '<path d="M100 50 Q140 20 170 30 Q180 50 170 70 Q140 80 100 50Z" fill="#EC4899"/>' +
      '<rect x="90" y="40" width="20" height="30" rx="4" fill="#BE185D"/>') } },

  { id: "ribbon.tag.sale",               kind: "ribbon", category: "marketing", extraCategories: ["fitness"],
    label: "Sale price tag", tags: ["sale", "tag", "offer"], aspectRatio: 2.5,
    payload: { format: "svg", markup: art("0 0 250 100",
      '<path fill="#EF4444" d="M40 10 H230 L240 50 L230 90 H40 L20 50Z"/>' +
      '<circle cx="40" cy="50" r="8" fill="#FFFFFF"/>' +
      '<text x="140" y="60" text-anchor="middle" font-family="Impact, sans-serif" font-size="36" fill="#FFFFFF">SALE</text>') } },
];

// ── Frames ────────────────────────────────────────────────────────────────────
// Framed container artwork — artworks that wrap a content block. Designed to
// sit behind text/image blocks with a transparent interior so content shows.

const FRAMES: Asset[] = [
  { id: "frame.card.rounded",            kind: "frame", category: "productivity", extraCategories: ["business", "education"],
    label: "Rounded card", tags: ["card", "container", "clean"], aspectRatio: 1.5,
    payload: { format: "svg", markup: art("0 0 300 200",
      '<rect x="8" y="12" width="284" height="184" rx="18" fill="#000000" opacity="0.08"/>' +
      '<rect x="4" y="4"  width="284" height="184" rx="18" fill="#FFFFFF" stroke="#E5E7EB" stroke-width="2"/>') } },

  { id: "frame.card.accent-bar",         kind: "frame", category: "business", extraCategories: ["marketing"],
    label: "Accent-bar card", tags: ["card", "accent", "bar"], aspectRatio: 1.5,
    payload: { format: "svg", markup: art("0 0 300 200",
      '<rect x="0" y="0" width="300" height="200" rx="12" fill="#FFFFFF" stroke="#1F2937" stroke-width="2"/>' +
      '<rect x="0" y="0" width="12" height="200" fill="#2563EB"/>') } },

  { id: "frame.polaroid",                kind: "frame", category: "travel", extraCategories: ["beauty"],
    label: "Polaroid frame", tags: ["polaroid", "photo", "memory"], aspectRatio: 0.9,
    payload: { format: "svg", markup: art("0 0 200 220",
      '<rect x="6" y="10" width="188" height="200" fill="#000000" opacity="0.1"/>' +
      '<rect x="0" y="0"  width="188" height="200" fill="#FFFFFF" stroke="#E5E7EB" stroke-width="2"/>' +
      '<rect x="14" y="14" width="160" height="140" fill="#DBEAFE"/>') } },

  { id: "frame.ornate.double",           kind: "frame", category: "beauty", extraCategories: ["education"],
    label: "Ornate double frame", tags: ["ornate", "elegant", "frame"], aspectRatio: 1.4,
    payload: { format: "svg", markup: art("0 0 280 200",
      '<rect x="10" y="10" width="260" height="180" fill="none" stroke="#B45309" stroke-width="5"/>' +
      '<rect x="22" y="22" width="236" height="156" fill="none" stroke="#B45309" stroke-width="2"/>' +
      '<circle cx="22" cy="22" r="4" fill="#B45309"/>' +
      '<circle cx="258" cy="22" r="4" fill="#B45309"/>' +
      '<circle cx="22" cy="178" r="4" fill="#B45309"/>' +
      '<circle cx="258" cy="178" r="4" fill="#B45309"/>') } },

  { id: "frame.tape.casual",             kind: "frame", category: "education", extraCategories: ["productivity", "beauty"],
    label: "Taped note", tags: ["tape", "note", "casual"], aspectRatio: 1,
    payload: { format: "svg", markup: art("0 0 200 200",
      '<rect x="10" y="10" width="180" height="180" fill="#FEF3C7" stroke="#D97706" stroke-opacity="0.2" stroke-width="1"/>' +
      '<rect x="70" y="-6" width="60" height="20" fill="#FDE68A" opacity="0.8" transform="rotate(-6 100 0)"/>') } },

  { id: "frame.cinematic.bars",          kind: "frame", category: "marketing", extraCategories: ["travel"],
    label: "Cinematic bars", tags: ["cinematic", "widescreen", "film"], aspectRatio: 2.2,
    payload: { format: "svg", markup: art("0 0 440 200",
      '<rect x="0" y="0"    width="440" height="30"  fill="#111827"/>' +
      '<rect x="0" y="170"  width="440" height="30"  fill="#111827"/>') } },
];

// ── Dividers ──────────────────────────────────────────────────────────────────
// Ornamental separators that sit between content sections.

const DIVIDERS: Asset[] = [
  { id: "divider.dots.spaced",           kind: "divider", category: "productivity", extraCategories: ["business"],
    label: "Spaced dots", tags: ["dots", "minimal", "divider"], aspectRatio: 8,
    payload: { format: "svg", markup: art("0 0 400 50",
      '<circle cx="160" cy="25" r="3" fill="#9CA3AF"/>' +
      '<circle cx="200" cy="25" r="3" fill="#9CA3AF"/>' +
      '<circle cx="240" cy="25" r="3" fill="#9CA3AF"/>') } },

  { id: "divider.wave.flow",             kind: "divider", category: "wellness", extraCategories: ["travel"],
    label: "Flowing wave", tags: ["wave", "soft", "divider"], aspectRatio: 8,
    payload: { format: "svg", markup: art("0 0 400 50",
      '<path d="M0 25 Q50 5 100 25 T200 25 T300 25 T400 25" fill="none" stroke="#60A5FA" stroke-width="2.5"/>') } },

  { id: "divider.ornate.floral",         kind: "divider", category: "beauty", extraCategories: ["education"],
    label: "Ornate floral", tags: ["ornate", "floral", "elegant"], aspectRatio: 6,
    payload: { format: "svg", markup: art("0 0 300 50",
      '<path d="M20 25 H130" stroke="#B45309" stroke-width="1.5"/>' +
      '<path d="M170 25 H280" stroke="#B45309" stroke-width="1.5"/>' +
      '<path d="M150 10 C140 18 140 32 150 40 C160 32 160 18 150 10Z" fill="#B45309"/>' +
      '<circle cx="130" cy="25" r="2" fill="#B45309"/>' +
      '<circle cx="170" cy="25" r="2" fill="#B45309"/>') } },

  { id: "divider.arrow.section",         kind: "divider", category: "marketing", extraCategories: ["business"],
    label: "Arrow section break", tags: ["arrow", "cta", "break"], aspectRatio: 8,
    payload: { format: "svg", markup: art("0 0 400 50",
      '<line x1="20"  y1="25" x2="180" y2="25" stroke="#111827" stroke-width="2"/>' +
      '<line x1="220" y1="25" x2="380" y2="25" stroke="#111827" stroke-width="2"/>' +
      '<polygon points="190,15 210,25 190,35" fill="#F97316"/>') } },

  { id: "divider.zigzag.fun",            kind: "divider", category: "fitness", extraCategories: ["marketing"],
    label: "Zigzag line", tags: ["zigzag", "energy", "playful"], aspectRatio: 8,
    payload: { format: "svg", markup: art("0 0 400 50",
      '<polyline fill="none" stroke="#DC2626" stroke-width="3" stroke-linejoin="round" points="20,30 60,20 100,30 140,20 180,30 220,20 260,30 300,20 340,30 380,20"/>') } },

  { id: "divider.line.minimal",          kind: "divider", category: "business", extraCategories: ["productivity", "education"],
    label: "Minimal hairline", tags: ["line", "minimal", "hairline"], aspectRatio: 10,
    payload: { format: "svg", markup: art("0 0 500 50",
      '<line x1="60" y1="25" x2="440" y2="25" stroke="#6B7280" stroke-width="1"/>') } },
];

// ── Step 34: Filled icon counterparts ─────────────────────────────────────────
// The original ICONS array above uses a stroke-only outline style. Step 34
// adds a parallel set of *filled* icons for the most commonly used concepts
// so templates can pick a style that matches their visual weight (e.g.
// bold_lifestyle → filled, modern_minimal → outline). Filtering is handled
// by the `style` axis in AssetQuery.

const filled = (viewBox: string, body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" fill="currentColor">${body}</svg>`;

const FILLED_ICONS: Asset[] = [
  { id: "icon.productivity.check.filled", kind: "icon", category: "productivity", label: "Check (filled)",
    tags: ["done", "complete", "task", "filled"], style: "filled",
    payload: { format: "svg", markup: filled("0 0 24 24",
      '<circle cx="12" cy="12" r="11"/><path d="M7 12l3 3 7-7" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>') } },
  { id: "icon.wellness.heart.filled", kind: "icon", category: "wellness", label: "Heart (filled)",
    tags: ["love", "care", "health", "filled"], style: "filled",
    payload: { format: "svg", markup: filled("0 0 24 24",
      '<path d="M12 21s-7-4.5-7-11a4 4 0 017-2.6A4 4 0 0119 10c0 6.5-7 11-7 11z"/>') } },
  { id: "icon.education.book.filled", kind: "icon", category: "education", label: "Book (filled)",
    tags: ["learn", "read", "study", "filled"], style: "filled",
    payload: { format: "svg", markup: filled("0 0 24 24",
      '<path d="M4 5a1 1 0 011-1h5a3 3 0 013 3v14a2 2 0 00-2-2H4V5zM20 5a1 1 0 00-1-1h-5a3 3 0 00-3 3v14a2 2 0 012-2h7V5z"/>') } },
  { id: "icon.business.chart.filled", kind: "icon", category: "business", label: "Growth chart (filled)",
    tags: ["growth", "data", "filled"], style: "filled",
    payload: { format: "svg", markup: filled("0 0 24 24",
      '<rect x="3" y="15" width="4" height="6" rx="1"/><rect x="9" y="10" width="4" height="11" rx="1"/><rect x="15" y="5" width="4" height="16" rx="1"/>') } },
  { id: "icon.fitness.bolt.filled", kind: "icon", category: "fitness", label: "Bolt (filled)",
    tags: ["energy", "power", "filled"], style: "filled",
    payload: { format: "svg", markup: filled("0 0 24 24",
      '<path d="M13 2L4 14h7l-2 8 10-13h-7l1-7z"/>') } },
  { id: "icon.beauty.sparkle.filled", kind: "icon", category: "beauty", label: "Sparkle (filled)",
    tags: ["glow", "shine", "magic", "filled"], style: "filled",
    payload: { format: "svg", markup: filled("0 0 24 24",
      '<path d="M12 2l2.5 7L22 11.5 14.5 14 12 22l-2.5-8L2 11.5 9.5 9z"/>') } },
  { id: "icon.travel.pin.filled", kind: "icon", category: "travel", label: "Location pin (filled)",
    tags: ["map", "place", "filled"], style: "filled",
    payload: { format: "svg", markup: filled("0 0 24 24",
      '<path d="M12 22s7-7 7-12a7 7 0 10-14 0c0 5 7 12 7 12z"/><circle cx="12" cy="10" r="2.5" fill="#fff"/>') } },
  { id: "icon.marketing.star.filled", kind: "icon", category: "marketing", label: "Star (filled)",
    tags: ["star", "rating", "favorite", "filled"], style: "filled", extraCategories: ["beauty", "motivation"],
    payload: { format: "svg", markup: filled("0 0 24 24",
      '<path d="M12 3l3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z"/>') } },
];

// ── Step 34: Motivation category — full asset set ─────────────────────────────
// Distinct aesthetic: mountain peaks / sunrise / achievement / streak fire.
// Every kind represented so the recipe can assemble a complete roster
// without falling back to other categories.

const MOTIVATION_ASSETS: Asset[] = [
  // Icons — outline + filled variants for core concepts.
  { id: "icon.motivation.trophy",        kind: "icon", category: "motivation", label: "Trophy",
    tags: ["trophy", "win", "achievement", "success"], style: "outline",
    payload: { format: "svg", markup: icon("0 0 24 24",
      '<path d="M8 4h8v4a4 4 0 01-8 0V4zM6 4H4v2a2 2 0 002 2M18 4h2v2a2 2 0 01-2 2M10 13v3M14 13v3M8 18h8v2H8z"/>') } },
  { id: "icon.motivation.trophy.filled", kind: "icon", category: "motivation", label: "Trophy (filled)",
    tags: ["trophy", "win", "achievement", "filled"], style: "filled",
    payload: { format: "svg", markup: filled("0 0 24 24",
      '<path d="M8 4h8v4a4 4 0 01-8 0V4zM10 13h4v4h-4zM7 19h10v2H7z"/>') } },
  { id: "icon.motivation.peak",          kind: "icon", category: "motivation", label: "Mountain peak",
    tags: ["peak", "mountain", "climb", "aspire", "goal"], style: "outline",
    payload: { format: "svg", markup: icon("0 0 24 24",
      '<path d="M3 20l6-12 4 7 3-4 5 9H3zM9 8l-1.5 3M13 15l1-1.5"/>') } },
  { id: "icon.motivation.flame",         kind: "icon", category: "motivation", label: "Streak flame",
    tags: ["flame", "streak", "hot", "fire", "habit"], style: "outline",
    payload: { format: "svg", markup: icon("0 0 24 24",
      '<path d="M12 2c3 4 5 6 5 10a5 5 0 11-10 0c0-2 1-3 2-4 0 3 1 4 2 4-1-3 0-6 1-10z"/>') } },
  { id: "icon.motivation.flame.filled",  kind: "icon", category: "motivation", label: "Streak flame (filled)",
    tags: ["flame", "streak", "hot", "fire", "habit", "filled"], style: "filled",
    payload: { format: "svg", markup: filled("0 0 24 24",
      '<path d="M12 2c3 4 5 6 5 10a5 5 0 11-10 0c0-2 1-3 2-4 0 3 1 4 2 4-1-3 0-6 1-10z"/>') } },
  { id: "icon.motivation.rise",          kind: "icon", category: "motivation", label: "Rising arrow",
    tags: ["rise", "grow", "up", "arrow", "progress"], style: "outline",
    payload: { format: "svg", markup: icon("0 0 24 24",
      '<path d="M4 20L14 10l3 3 4-4M17 6h4v4"/>') } },
  { id: "icon.motivation.target",        kind: "icon", category: "motivation", label: "Target / goal",
    tags: ["goal", "target", "focus", "aim"], style: "outline", extraCategories: ["productivity"],
    payload: { format: "svg", markup: icon("0 0 24 24",
      '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>') } },

  // Illustrations.
  { id: "illus.motivation.sunrise",      kind: "illustration", category: "motivation", label: "Sunrise over peaks",
    tags: ["sunrise", "mountain", "horizon", "aspire"], aspectRatio: 2,
    payload: { format: "svg", markup: illus("0 0 400 200",
      '<defs><linearGradient id="msky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FDE68A"/><stop offset="1" stop-color="#FED7AA"/></linearGradient></defs>' +
      '<rect width="400" height="200" fill="url(%23msky)"/>' +
      '<circle cx="200" cy="140" r="40" fill="#F97316"/>' +
      '<path d="M0 180 L90 100 L160 150 L230 80 L310 140 L400 110 V200 H0Z" fill="#7C2D12" opacity="0.92"/>' +
      '<path d="M0 200 L120 140 L220 180 L320 150 L400 190 V200 H0Z" fill="#9A3412"/>') } },
  { id: "illus.motivation.step-ladder",  kind: "illustration", category: "motivation", label: "Ascending steps",
    tags: ["steps", "progress", "rise", "goal"], aspectRatio: 1.5,
    payload: { format: "svg", markup: illus("0 0 300 200",
      '<rect x="20" y="150" width="50" height="40" fill="#1E40AF"/>' +
      '<rect x="75" y="120" width="50" height="70" fill="#2563EB"/>' +
      '<rect x="130" y="90"  width="50" height="100" fill="#3B82F6"/>' +
      '<rect x="185" y="60"  width="50" height="130" fill="#60A5FA"/>' +
      '<rect x="240" y="30"  width="50" height="160" fill="#93C5FD"/>' +
      '<path d="M40 170 L260 40 M260 40l-20 4 M260 40l-4 20" stroke="#F97316" stroke-width="4" fill="none" stroke-linecap="round"/>') } },

  // Photos (stable Unsplash source).
  { id: "photo.motivation.mountain",     kind: "photo", category: "motivation", label: "Mountain horizon (photo)",
    tags: ["mountain", "peak", "nature", "aspire"], aspectRatio: 1.6,
    payload: { format: "url", url: photo("mountain peak sunrise"), width: 1920, height: 1200 } },
  { id: "photo.motivation.runner",       kind: "photo", category: "motivation", label: "Runner at dawn (photo)",
    tags: ["run", "dawn", "effort", "rise"], aspectRatio: 1.6, extraCategories: ["fitness"],
    payload: { format: "url", url: photo("runner at dawn silhouette"), width: 1920, height: 1200 } },

  // Shapes.
  { id: "shape.motivation.arrow-up",     kind: "shape", category: "motivation", label: "Upward chevron",
    extraCategories: ["business"], tags: ["arrow", "up", "progress"], preferredColor: "#F97316",
    payload: { format: "svg", markup: shape("0 0 120 200",
      '<polygon fill="currentColor" points="60,10 110,90 80,90 80,190 40,190 40,90 10,90"/>') } },
  { id: "shape.motivation.starburst-lg", kind: "shape", category: "motivation", label: "Achievement starburst",
    extraCategories: ["marketing"], tags: ["burst", "star", "sparkle", "achievement"], preferredColor: "#F59E0B",
    payload: { format: "svg", markup: shape("0 0 200 200",
      '<polygon fill="currentColor" points="100,5 118,62 178,62 130,100 150,165 100,128 50,165 70,100 22,62 82,62"/>') } },

  // Textures — unique motivation grain: diagonal stripes w/ low opacity.
  { id: "texture.motivation.rise-lines", kind: "texture", category: "motivation", label: "Rise lines",
    tags: ["lines", "rise", "motion"],
    payload: { format: "pattern", tileSize: 28,
      svg: tile(28,
        '<path d="M-2 30 L30 -2" stroke="currentColor" stroke-opacity="0.25" stroke-width="1.2"/>' +
        '<path d="M14 30 L30 14" stroke="currentColor" stroke-opacity="0.15" stroke-width="1.2"/>') } },

  // Stickers.
  { id: "sticker.motivation.fire",       kind: "sticker", category: "motivation", label: "On fire sticker",
    tags: ["fire", "streak", "hot", "achievement"], aspectRatio: 1,
    payload: { format: "svg", markup: art("0 0 200 200",
      '<circle cx="100" cy="100" r="88" fill="#FDE68A" stroke="#DC2626" stroke-width="4"/>' +
      '<path d="M100 50c10 18 18 28 18 44a18 18 0 11-36 0c0-8 3-12 6-16 0 10 4 14 8 14-3-10 0-22 4-42z" fill="#EA580C"/>' +
      '<text x="100" y="170" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-size="22" font-weight="800" fill="#7C2D12">STREAK</text>') } },

  // Badges.
  { id: "badge.motivation.achievement",  kind: "badge", category: "motivation", label: "Achievement badge",
    tags: ["achievement", "goal", "verified"], aspectRatio: 1,
    payload: { format: "svg", markup: art("0 0 200 200",
      '<circle cx="100" cy="100" r="92" fill="#1E3A8A" stroke="#FDE68A" stroke-width="4"/>' +
      '<circle cx="100" cy="100" r="76" fill="none" stroke="#FDE68A" stroke-width="1" stroke-dasharray="3 6"/>' +
      '<text x="100" y="95" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-size="18" font-weight="700" fill="#FDE68A" letter-spacing="2">GOAL</text>' +
      '<text x="100" y="128" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-size="32" font-weight="800" fill="#FDE68A">ACHIEVED</text>') } },

  // Ribbon.
  { id: "ribbon.motivation.quote",       kind: "ribbon", category: "motivation", label: "Quote ribbon",
    tags: ["quote", "banner", "title", "inspire"], aspectRatio: 6,
    payload: { format: "svg", markup: art("0 0 600 100",
      '<path fill="#1E3A8A" d="M10 25h580l-25 25 25 25H10l25-25z"/>' +
      '<text x="300" y="62" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-size="30" font-weight="800" fill="#FDE68A" letter-spacing="4">INSPIRE</text>') } },

  // Frame / divider.
  { id: "frame.motivation.inset",        kind: "frame", category: "motivation", label: "Double-rule inspiration frame",
    tags: ["frame", "inspire", "quote"], aspectRatio: 1.4,
    payload: { format: "svg", markup: art("0 0 560 400",
      '<rect width="560" height="400" fill="#FFFBEB"/>' +
      '<rect x="20" y="20" width="520" height="360" fill="none" stroke="#1E3A8A" stroke-width="2"/>' +
      '<rect x="30" y="30" width="500" height="340" fill="none" stroke="#F59E0B" stroke-width="1"/>') } },
  { id: "divider.motivation.arrow-line", kind: "divider", category: "motivation", label: "Arrow-line divider",
    tags: ["divider", "arrow", "progress"], aspectRatio: 10,
    payload: { format: "svg", markup: art("0 0 500 50",
      '<line x1="30" y1="25" x2="450" y2="25" stroke="#1E3A8A" stroke-width="2"/>' +
      '<polygon points="450,15 470,25 450,35" fill="#F59E0B"/>') } },
];

// ── Step 36 + 47: premium 3D real-world visual assets ───────────────────────
// Replaces the Step 35 real-world photo set with a consistent 3D-render
// catalogue. Every entry:
//
//   kind         = "illustration"  (3D renders are composed artwork, not
//                                   raw photography — marking them as
//                                   illustrations keeps the placement
//                                   system treating them uniformly and
//                                   stops them from fighting
//                                   AI-generated hero photos)
//   visualStyle  = "3d"            (lets the consistency layer pick one
//                                   style per template)
//   qualityTier  = "premium"       (Step 47 — declares these as the
//                                   platform's hero-grade assets:
//                                   modern, clean, high-resolution 3D
//                                   with consistent lighting and
//                                   camera angle. The selector
//                                   prefers premium picks for primary
//                                   visuals and refuses to mix them
//                                   with lower-tier decorative art.)
//   realm        = nature / animal / lifestyle / object / scene
//   category + extraCategories     (unchanged from Step 35 so the
//                                   category-driven pipeline surfaces
//                                   them for the right briefs)
//
// Every URL goes through the render3d() helper so a real 3D-asset CDN
// can be swapped in via ARKIOL_3D_ASSET_BASE without touching this
// catalogue.

const REAL_WORLD_ASSETS: Asset[] = [
  // ── Nature (3D) ─────────────────────────────────────────────────────
  // Step 48: the nature realm is the platform's first-class environment
  // library — mountains, water, forests, beach, sky, flora, stone. Every
  // entry is a modern claymorphic 3D render (consistent soft lighting,
  // isometric-ish camera, pastel/true-to-life palette) served through
  // render3d() so ARKIOL_3D_ASSET_BASE points the whole group at a
  // production CDN with one env var.
  //
  // Mountains -----------------------------------------------------------
  { id: "real.nature.mountain-range",    kind: "illustration", realm: "nature", visualStyle: "3d", qualityTier: "premium", category: "travel",
    extraCategories: ["wellness", "motivation"], label: "Mountain range (3D)",
    tags: ["mountain", "range", "horizon", "nature", "calm", "3d", "claymorphism"],
    aspectRatio: 1.6,
    payload: { format: "url", url: render3d("nature-mountain-range", "mountain range horizon claymorphic", 1920, 1200), width: 1920, height: 1200 } },
  { id: "real.nature.mountain-snowy",    kind: "illustration", realm: "nature", visualStyle: "3d", qualityTier: "premium", category: "travel",
    extraCategories: ["wellness", "motivation"], label: "Snowy mountain (3D)",
    tags: ["mountain", "snow", "winter", "alpine", "nature", "crisp", "3d", "claymorphism"],
    aspectRatio: 1.6,
    payload: { format: "url", url: render3d("nature-mountain-snowy", "snowy mountain peak 3d claymorphic clean", 1920, 1200), width: 1920, height: 1200 } },
  { id: "real.nature.mountain-misty",    kind: "illustration", realm: "nature", visualStyle: "3d", qualityTier: "premium", category: "travel",
    extraCategories: ["wellness", "motivation"], label: "Misty mountain (3D)",
    tags: ["mountain", "mist", "fog", "layered", "calm", "nature", "3d"],
    aspectRatio: 1.6,
    payload: { format: "url", url: render3d("nature-mountain-misty", "misty mountain layers 3d claymorphic", 1920, 1200), width: 1920, height: 1200 } },
  // Rivers & waterfalls -------------------------------------------------
  { id: "real.nature.river",             kind: "illustration", realm: "nature", visualStyle: "3d", qualityTier: "premium", category: "wellness",
    extraCategories: ["travel", "motivation"], label: "River stream (3D)",
    tags: ["river", "stream", "water", "flow", "nature", "3d"],
    aspectRatio: 1.6,
    payload: { format: "url", url: render3d("nature-river", "river stream stylized 3d", 1920, 1200), width: 1920, height: 1200 } },
  { id: "real.nature.river-bend",        kind: "illustration", realm: "nature", visualStyle: "3d", qualityTier: "premium", category: "wellness",
    extraCategories: ["travel", "motivation"], label: "River bend (3D)",
    tags: ["river", "bend", "winding", "valley", "water", "nature", "3d"],
    aspectRatio: 1.6,
    payload: { format: "url", url: render3d("nature-river-bend", "winding river bend 3d aerial claymorphic", 1920, 1200), width: 1920, height: 1200 } },
  { id: "real.nature.waterfall",         kind: "illustration", realm: "nature", visualStyle: "3d", qualityTier: "premium", category: "wellness",
    extraCategories: ["travel", "motivation"], label: "Waterfall (3D)",
    tags: ["waterfall", "cascade", "water", "rocks", "flow", "nature", "3d"],
    aspectRatio: 0.8,
    payload: { format: "url", url: render3d("nature-waterfall", "cascading waterfall 3d claymorphic tall", 1200, 1500), width: 1200, height: 1500 } },
  { id: "real.nature.waterfall-tropical", kind: "illustration", realm: "nature", visualStyle: "3d", qualityTier: "premium", category: "travel",
    extraCategories: ["wellness", "motivation"], label: "Tropical waterfall (3D)",
    tags: ["waterfall", "tropical", "jungle", "palm", "water", "lush", "nature", "3d"],
    aspectRatio: 0.8,
    payload: { format: "url", url: render3d("nature-waterfall-tropical", "tropical waterfall jungle 3d claymorphic", 1200, 1500), width: 1200, height: 1500 } },
  // Forests -------------------------------------------------------------
  { id: "real.nature.forest",            kind: "illustration", realm: "nature", visualStyle: "3d", qualityTier: "premium", category: "wellness",
    extraCategories: ["travel", "education"], label: "Forest scene (3D)",
    tags: ["forest", "trees", "green", "nature", "calm", "3d"],
    aspectRatio: 1,
    payload: { format: "url", url: render3d("nature-forest", "forest 3d illustration claymorphic", 1600, 1600), width: 1600, height: 1600 } },
  { id: "real.nature.pine-forest",       kind: "illustration", realm: "nature", visualStyle: "3d", qualityTier: "premium", category: "wellness",
    extraCategories: ["travel", "motivation"], label: "Pine forest (3D)",
    tags: ["forest", "pine", "conifer", "evergreen", "calm", "nature", "3d"],
    aspectRatio: 1.6,
    payload: { format: "url", url: render3d("nature-pine-forest", "pine forest rows 3d claymorphic", 1920, 1200), width: 1920, height: 1200 } },
  { id: "real.nature.autumn-forest",     kind: "illustration", realm: "nature", visualStyle: "3d", qualityTier: "premium", category: "wellness",
    extraCategories: ["travel", "motivation"], label: "Autumn forest (3D)",
    tags: ["forest", "autumn", "fall", "warm", "orange", "nature", "3d"],
    aspectRatio: 1.6,
    payload: { format: "url", url: render3d("nature-autumn-forest", "autumn forest warm palette 3d claymorphic", 1920, 1200), width: 1920, height: 1200 } },
  // Ocean & beach -------------------------------------------------------
  { id: "real.nature.ocean-waves",       kind: "illustration", realm: "nature", visualStyle: "3d", qualityTier: "premium", category: "travel",
    extraCategories: ["wellness"], label: "Ocean waves (3D)",
    tags: ["ocean", "waves", "water", "sea", "calm", "3d"],
    aspectRatio: 1.6,
    payload: { format: "url", url: render3d("nature-ocean-waves", "ocean waves 3d stylized", 1920, 1200), width: 1920, height: 1200 } },
  { id: "real.nature.beach",             kind: "illustration", realm: "nature", visualStyle: "3d", qualityTier: "premium", category: "travel",
    extraCategories: ["wellness", "motivation"], label: "Beach cove (3D)",
    tags: ["beach", "sand", "shore", "cove", "ocean", "nature", "3d"],
    aspectRatio: 1.6,
    payload: { format: "url", url: render3d("nature-beach", "beach cove soft sand 3d claymorphic", 1920, 1200), width: 1920, height: 1200 } },
  { id: "real.nature.beach-palms",       kind: "illustration", realm: "nature", visualStyle: "3d", qualityTier: "premium", category: "travel",
    extraCategories: ["wellness", "motivation"], label: "Beach with palms (3D)",
    tags: ["beach", "palm", "tropical", "sand", "sea", "nature", "3d"],
    aspectRatio: 1.6,
    payload: { format: "url", url: render3d("nature-beach-palms", "tropical beach palms 3d claymorphic", 1920, 1200), width: 1920, height: 1200 } },
  // Sky & atmosphere ----------------------------------------------------
  { id: "real.nature.sky-clouds",        kind: "illustration", realm: "nature", visualStyle: "3d", qualityTier: "premium", category: "motivation",
    extraCategories: ["wellness", "travel"], label: "Sky clouds (3D)",
    tags: ["sky", "clouds", "open", "light", "aspire", "3d", "soft"],
    aspectRatio: 1.6,
    payload: { format: "url", url: render3d("nature-sky-clouds", "fluffy 3d clouds pastel sky", 1920, 1200), width: 1920, height: 1200 } },
  { id: "real.nature.cloud-cluster",     kind: "illustration", realm: "nature", visualStyle: "3d", qualityTier: "premium", category: "motivation",
    extraCategories: ["wellness", "beauty"], label: "Cloud cluster (3D)",
    tags: ["cloud", "cluster", "fluffy", "soft", "pastel", "dream", "nature", "3d"],
    aspectRatio: 1,
    payload: { format: "url", url: render3d("nature-cloud-cluster", "fluffy 3d cloud cluster isolated pastel", 1600, 1600), width: 1600, height: 1600 } },
  { id: "real.nature.sky-dawn",          kind: "illustration", realm: "nature", visualStyle: "3d", qualityTier: "premium", category: "motivation",
    extraCategories: ["wellness", "travel"], label: "Dawn sky (3D)",
    tags: ["sky", "dawn", "sunrise", "warm", "pink", "gradient", "nature", "3d"],
    aspectRatio: 1.6,
    payload: { format: "url", url: render3d("nature-sky-dawn", "dawn sky gradient warm 3d claymorphic", 1920, 1200), width: 1920, height: 1200 } },
  { id: "real.nature.sky-dusk",          kind: "illustration", realm: "nature", visualStyle: "3d", qualityTier: "premium", category: "motivation",
    extraCategories: ["wellness", "travel"], label: "Dusk sky (3D)",
    tags: ["sky", "dusk", "twilight", "purple", "gradient", "calm", "nature", "3d"],
    aspectRatio: 1.6,
    payload: { format: "url", url: render3d("nature-sky-dusk", "dusk twilight sky gradient 3d", 1920, 1200), width: 1920, height: 1200 } },
  { id: "real.nature.sky-starlit",       kind: "illustration", realm: "nature", visualStyle: "3d", qualityTier: "premium", category: "motivation",
    extraCategories: ["wellness", "beauty"], label: "Starlit sky (3D)",
    tags: ["sky", "stars", "night", "deep blue", "wonder", "nature", "3d"],
    aspectRatio: 1.6,
    payload: { format: "url", url: render3d("nature-sky-starlit", "starlit night sky 3d claymorphic", 1920, 1200), width: 1920, height: 1200 } },
  { id: "real.nature.sunset",            kind: "illustration", realm: "nature", visualStyle: "3d", qualityTier: "premium", category: "motivation",
    extraCategories: ["travel", "wellness"], label: "Golden hour sunset (3D)",
    tags: ["sunset", "golden hour", "warm", "horizon", "aspire", "3d"],
    aspectRatio: 1.6,
    payload: { format: "url", url: render3d("nature-sunset", "sunset horizon 3d stylized", 1920, 1200), width: 1920, height: 1200 } },
  // Plants & flora ------------------------------------------------------
  { id: "real.nature.potted-plant",      kind: "illustration", realm: "nature", visualStyle: "3d", qualityTier: "premium", category: "wellness",
    extraCategories: ["productivity", "beauty"], label: "Potted plant (3D)",
    tags: ["plant", "pothos", "indoor", "green", "nature", "3d", "claymorphism"],
    aspectRatio: 1,
    payload: { format: "url", url: render3d("nature-potted-plant", "3d claymorphic potted plant", 1600, 1600), width: 1600, height: 1600 } },
  { id: "real.nature.cactus",            kind: "illustration", realm: "nature", visualStyle: "3d", qualityTier: "premium", category: "wellness",
    extraCategories: ["beauty", "motivation"], label: "Potted cactus (3D)",
    tags: ["cactus", "desert", "resilience", "plant", "nature", "3d"],
    aspectRatio: 1,
    payload: { format: "url", url: render3d("nature-cactus", "3d claymorphic potted cactus", 1600, 1600), width: 1600, height: 1600 } },
  { id: "real.nature.succulent",         kind: "illustration", realm: "nature", visualStyle: "3d", qualityTier: "premium", category: "beauty",
    extraCategories: ["wellness"], label: "Succulent (3D)",
    tags: ["succulent", "plant", "rosette", "green", "nature", "3d"],
    aspectRatio: 1,
    payload: { format: "url", url: render3d("nature-succulent", "3d claymorphic succulent top down", 1600, 1600), width: 1600, height: 1600 } },
  { id: "real.nature.fern",              kind: "illustration", realm: "nature", visualStyle: "3d", qualityTier: "premium", category: "wellness",
    extraCategories: ["beauty"], label: "Fern frond (3D)",
    tags: ["fern", "frond", "green", "tropical", "plant", "nature", "3d"],
    aspectRatio: 1,
    payload: { format: "url", url: render3d("nature-fern", "3d claymorphic fern frond isolated", 1600, 1600), width: 1600, height: 1600 } },
  { id: "real.nature.leaf",              kind: "illustration", realm: "nature", visualStyle: "3d", qualityTier: "premium", category: "wellness",
    extraCategories: ["beauty", "motivation"], label: "Leaf (3D)",
    tags: ["leaf", "green", "plant", "growth", "nature", "3d"],
    aspectRatio: 1,
    payload: { format: "url", url: render3d("nature-leaf", "3d green leaf isolated", 1600, 1600), width: 1600, height: 1600 } },
  { id: "real.nature.autumn-leaves",     kind: "illustration", realm: "nature", visualStyle: "3d", qualityTier: "premium", category: "wellness",
    extraCategories: ["beauty", "motivation"], label: "Autumn leaves (3D)",
    tags: ["leaves", "autumn", "fall", "orange", "warm", "nature", "3d"],
    aspectRatio: 1,
    payload: { format: "url", url: render3d("nature-autumn-leaves", "3d autumn leaves cluster warm", 1600, 1600), width: 1600, height: 1600 } },
  // Flowers -------------------------------------------------------------
  { id: "real.nature.flower-rose",       kind: "illustration", realm: "nature", visualStyle: "3d", qualityTier: "premium", category: "beauty",
    extraCategories: ["wellness", "motivation"], label: "Rose bloom (3D)",
    tags: ["flower", "rose", "bloom", "love", "beauty", "nature", "3d"],
    aspectRatio: 1,
    payload: { format: "url", url: render3d("nature-flower-rose", "3d claymorphic rose bloom close", 1600, 1600), width: 1600, height: 1600 } },
  { id: "real.nature.flower-tulip",      kind: "illustration", realm: "nature", visualStyle: "3d", qualityTier: "premium", category: "beauty",
    extraCategories: ["wellness"], label: "Tulip (3D)",
    tags: ["flower", "tulip", "spring", "bloom", "beauty", "nature", "3d"],
    aspectRatio: 1,
    payload: { format: "url", url: render3d("nature-flower-tulip", "3d claymorphic tulip isolated", 1600, 1600), width: 1600, height: 1600 } },
  { id: "real.nature.flower-bouquet",    kind: "illustration", realm: "nature", visualStyle: "3d", qualityTier: "premium", category: "beauty",
    extraCategories: ["wellness", "motivation"], label: "Flower bouquet (3D)",
    tags: ["flower", "bouquet", "arrangement", "celebration", "beauty", "nature", "3d"],
    aspectRatio: 1,
    payload: { format: "url", url: render3d("nature-flower-bouquet", "3d claymorphic flower bouquet pastel", 1600, 1600), width: 1600, height: 1600 } },
  { id: "real.nature.wildflower-field",  kind: "illustration", realm: "nature", visualStyle: "3d", qualityTier: "premium", category: "wellness",
    extraCategories: ["beauty", "motivation", "travel"], label: "Wildflower field (3D)",
    tags: ["flower", "wildflower", "meadow", "field", "spring", "nature", "3d"],
    aspectRatio: 1.6,
    payload: { format: "url", url: render3d("nature-wildflower-field", "wildflower meadow 3d claymorphic", 1920, 1200), width: 1920, height: 1200 } },
  // Grass & stones ------------------------------------------------------
  { id: "real.nature.grass-meadow",      kind: "illustration", realm: "nature", visualStyle: "3d", qualityTier: "premium", category: "wellness",
    extraCategories: ["travel", "motivation"], label: "Grass meadow (3D)",
    tags: ["grass", "meadow", "field", "fresh", "green", "nature", "3d"],
    aspectRatio: 1.6,
    payload: { format: "url", url: render3d("nature-grass-meadow", "grass meadow rolling 3d claymorphic", 1920, 1200), width: 1920, height: 1200 } },
  { id: "real.nature.stone-stack",       kind: "illustration", realm: "nature", visualStyle: "3d", qualityTier: "premium", category: "wellness",
    extraCategories: ["motivation"], label: "Zen stone stack (3D)",
    tags: ["stone", "stack", "zen", "balance", "calm", "nature", "3d"],
    aspectRatio: 1,
    payload: { format: "url", url: render3d("nature-stone-stack", "3d claymorphic zen stone stack balanced", 1600, 1600), width: 1600, height: 1600 } },
  { id: "real.nature.pebbles",           kind: "illustration", realm: "nature", visualStyle: "3d", qualityTier: "premium", category: "wellness",
    extraCategories: ["beauty"], label: "Smooth pebbles (3D)",
    tags: ["pebble", "stone", "smooth", "minimal", "nature", "3d"],
    aspectRatio: 1,
    payload: { format: "url", url: render3d("nature-pebbles", "3d claymorphic smooth pebbles top down", 1600, 1600), width: 1600, height: 1600 } },

  // ── Animal (3D) ─────────────────────────────────────────────────────
  { id: "real.animal.dog",               kind: "illustration", realm: "animal", visualStyle: "3d", qualityTier: "premium", category: "wellness",
    extraCategories: ["marketing", "motivation"], label: "Dog (3D)",
    tags: ["dog", "portrait", "pet", "friendly", "3d", "claymorphism"],
    aspectRatio: 1,
    payload: { format: "url", url: render3d("animal-dog", "3d claymorphic dog friendly", 1600, 1600), width: 1600, height: 1600 } },
  { id: "real.animal.cat",               kind: "illustration", realm: "animal", visualStyle: "3d", qualityTier: "premium", category: "wellness",
    extraCategories: ["beauty", "marketing"], label: "Cat (3D)",
    tags: ["cat", "pet", "cozy", "calm", "3d"],
    aspectRatio: 1,
    payload: { format: "url", url: render3d("animal-cat", "3d claymorphic cat curled", 1600, 1600), width: 1600, height: 1600 } },
  { id: "real.animal.bird-flight",       kind: "illustration", realm: "animal", visualStyle: "3d", qualityTier: "premium", category: "motivation",
    extraCategories: ["travel"], label: "Bird in flight (3D)",
    tags: ["bird", "flight", "freedom", "sky", "aspire", "3d"],
    aspectRatio: 1.6,
    payload: { format: "url", url: render3d("animal-bird-flight", "3d bird in flight stylized", 1920, 1200), width: 1920, height: 1200 } },
  { id: "real.animal.butterfly",         kind: "illustration", realm: "animal", visualStyle: "3d", qualityTier: "premium", category: "beauty",
    extraCategories: ["wellness"], label: "Butterfly (3D)",
    tags: ["butterfly", "flower", "delicate", "bloom", "3d"],
    aspectRatio: 1,
    payload: { format: "url", url: render3d("animal-butterfly", "3d butterfly pastel", 1600, 1600), width: 1600, height: 1600 } },
  { id: "real.animal.deer",              kind: "illustration", realm: "animal", visualStyle: "3d", qualityTier: "premium", category: "wellness",
    extraCategories: ["motivation"], label: "Deer (3D)",
    tags: ["deer", "forest", "wildlife", "quiet", "3d"],
    aspectRatio: 1.6,
    payload: { format: "url", url: render3d("animal-deer", "3d stylized deer forest", 1920, 1200), width: 1920, height: 1200 } },

  // ── Lifestyle (3D) ──────────────────────────────────────────────────
  // Step 49: real-life 3D interior-scene catalog. Every entry ships as a
  // claymorphic/soft-lit 3D render and mirrors a slug in ASSET_3D_MANIFEST
  // so the CDN path and the library id line up 1:1.
  // Workspaces
  { id: "real.lifestyle.workspace",         kind: "illustration", realm: "lifestyle", visualStyle: "3d", qualityTier: "premium", category: "productivity",
    extraCategories: ["business"], label: "Workspace (3D)",
    tags: ["desk", "workspace", "laptop", "focus", "home office", "3d", "isometric"],
    aspectRatio: 1.6,
    payload: { format: "url", url: render3d("lifestyle-workspace", "3d isometric desk workspace laptop", 1920, 1200), width: 1920, height: 1200 } },
  { id: "real.lifestyle.desk-flatlay",      kind: "illustration", realm: "lifestyle", visualStyle: "3d", qualityTier: "premium", category: "productivity",
    extraCategories: ["business", "education"], label: "Desk flat-lay (3D)",
    tags: ["desk", "flatlay", "top-down", "notebook", "pen", "coffee", "3d", "claymorphism"],
    aspectRatio: 1,
    payload: { format: "url", url: render3d("lifestyle-desk-flatlay", "3d top down desk flatlay notebook coffee", 1600, 1600), width: 1600, height: 1600 } },
  { id: "real.lifestyle.dual-monitor-desk", kind: "illustration", realm: "lifestyle", visualStyle: "3d", qualityTier: "premium", category: "productivity",
    extraCategories: ["business"], label: "Dual-monitor desk (3D)",
    tags: ["desk", "dual monitor", "setup", "developer", "workspace", "3d", "isometric"],
    aspectRatio: 1.6,
    payload: { format: "url", url: render3d("lifestyle-dual-monitor-desk", "3d isometric dual monitor desk setup", 1920, 1200), width: 1920, height: 1200 } },
  { id: "real.lifestyle.minimal-desk",      kind: "illustration", realm: "lifestyle", visualStyle: "3d", qualityTier: "premium", category: "productivity",
    extraCategories: ["wellness"], label: "Minimal desk (3D)",
    tags: ["minimal", "desk", "clean", "laptop", "workspace", "3d"],
    aspectRatio: 1.6,
    payload: { format: "url", url: render3d("lifestyle-minimal-desk", "3d minimal clean desk laptop", 1920, 1200), width: 1920, height: 1200 } },
  { id: "real.lifestyle.coworking",         kind: "illustration", realm: "lifestyle", visualStyle: "3d", qualityTier: "premium", category: "business",
    extraCategories: ["productivity", "marketing"], label: "Coworking space (3D)",
    tags: ["coworking", "office", "team", "shared", "workspace", "3d", "isometric"],
    aspectRatio: 1.6,
    payload: { format: "url", url: render3d("lifestyle-coworking", "3d isometric coworking space interior", 1920, 1200), width: 1920, height: 1200 } },
  { id: "real.lifestyle.home-office",       kind: "illustration", realm: "lifestyle", visualStyle: "3d", qualityTier: "premium", category: "business",
    extraCategories: ["productivity"], label: "Home office (3D)",
    tags: ["office", "home office", "workspace", "professional", "3d", "isometric"],
    aspectRatio: 1.6,
    payload: { format: "url", url: render3d("lifestyle-home-office", "3d isometric home office", 1920, 1200), width: 1920, height: 1200 } },
  // Reading areas
  { id: "real.lifestyle.reading-nook",      kind: "illustration", realm: "lifestyle", visualStyle: "3d", qualityTier: "premium", category: "education",
    extraCategories: ["wellness"], label: "Reading nook (3D)",
    tags: ["reading", "cozy", "book", "home", "nook", "3d"],
    aspectRatio: 1.6,
    payload: { format: "url", url: render3d("lifestyle-reading-nook", "3d cozy reading nook armchair", 1920, 1200), width: 1920, height: 1200 } },
  { id: "real.lifestyle.reading-armchair",  kind: "illustration", realm: "lifestyle", visualStyle: "3d", qualityTier: "premium", category: "education",
    extraCategories: ["wellness", "beauty"], label: "Reading armchair (3D)",
    tags: ["armchair", "reading", "book", "lamp", "cozy", "3d"],
    aspectRatio: 1,
    payload: { format: "url", url: render3d("lifestyle-reading-armchair", "3d cozy reading armchair side table lamp", 1600, 1600), width: 1600, height: 1600 } },
  // Green interiors
  { id: "real.lifestyle.plant-room",        kind: "illustration", realm: "lifestyle", visualStyle: "3d", qualityTier: "premium", category: "wellness",
    extraCategories: ["productivity", "beauty"], label: "Plant-filled room (3D)",
    tags: ["plants", "interior", "green", "calm", "home", "3d"],
    aspectRatio: 1,
    payload: { format: "url", url: render3d("lifestyle-plant-room", "3d plant filled room interior", 1600, 1600), width: 1600, height: 1600 } },
  { id: "real.lifestyle.botanical-corner",  kind: "illustration", realm: "lifestyle", visualStyle: "3d", qualityTier: "premium", category: "wellness",
    extraCategories: ["beauty"], label: "Botanical corner (3D)",
    tags: ["plants", "botanical", "corner", "greenery", "calm", "home", "3d"],
    aspectRatio: 1,
    payload: { format: "url", url: render3d("lifestyle-botanical-corner", "3d botanical corner with plants", 1600, 1600), width: 1600, height: 1600 } },
  // Kitchens
  { id: "real.lifestyle.kitchen",           kind: "illustration", realm: "lifestyle", visualStyle: "3d", qualityTier: "premium", category: "wellness",
    extraCategories: ["marketing"], label: "Kitchen counter (3D)",
    tags: ["kitchen", "counter", "food", "home", "3d", "isometric"],
    aspectRatio: 1.6,
    payload: { format: "url", url: render3d("lifestyle-kitchen", "3d isometric kitchen counter", 1920, 1200), width: 1920, height: 1200 } },
  { id: "real.lifestyle.modern-kitchen",    kind: "illustration", realm: "lifestyle", visualStyle: "3d", qualityTier: "premium", category: "wellness",
    extraCategories: ["marketing", "beauty"], label: "Modern kitchen (3D)",
    tags: ["kitchen", "modern", "island", "cabinets", "interior", "3d"],
    aspectRatio: 1.6,
    payload: { format: "url", url: render3d("lifestyle-modern-kitchen", "3d modern kitchen island interior", 1920, 1200), width: 1920, height: 1200 } },
  { id: "real.lifestyle.sunlit-kitchen",    kind: "illustration", realm: "lifestyle", visualStyle: "3d", qualityTier: "premium", category: "wellness",
    extraCategories: ["marketing"], label: "Sunlit kitchen (3D)",
    tags: ["kitchen", "sunlit", "bright", "window", "morning", "3d"],
    aspectRatio: 1.6,
    payload: { format: "url", url: render3d("lifestyle-sunlit-kitchen", "3d sunlit kitchen warm window light", 1920, 1200), width: 1920, height: 1200 } },
  // Bedrooms
  { id: "real.lifestyle.bedroom",           kind: "illustration", realm: "lifestyle", visualStyle: "3d", qualityTier: "premium", category: "wellness",
    extraCategories: ["beauty"], label: "Bedroom (3D)",
    tags: ["bedroom", "calm", "home", "sleep", "3d", "isometric"],
    aspectRatio: 1.6,
    payload: { format: "url", url: render3d("lifestyle-bedroom", "3d isometric minimal bedroom", 1920, 1200), width: 1920, height: 1200 } },
  { id: "real.lifestyle.cozy-bedroom",      kind: "illustration", realm: "lifestyle", visualStyle: "3d", qualityTier: "premium", category: "wellness",
    extraCategories: ["beauty"], label: "Cozy bedroom (3D)",
    tags: ["bedroom", "cozy", "warm", "blanket", "home", "3d"],
    aspectRatio: 1.6,
    payload: { format: "url", url: render3d("lifestyle-cozy-bedroom", "3d cozy warm bedroom soft light", 1920, 1200), width: 1920, height: 1200 } },
  { id: "real.lifestyle.scandi-bedroom",    kind: "illustration", realm: "lifestyle", visualStyle: "3d", qualityTier: "premium", category: "beauty",
    extraCategories: ["wellness"], label: "Scandi bedroom (3D)",
    tags: ["bedroom", "scandinavian", "minimal", "wood", "white", "clean", "3d"],
    aspectRatio: 1.6,
    payload: { format: "url", url: render3d("lifestyle-scandi-bedroom", "3d scandinavian minimal bedroom", 1920, 1200), width: 1920, height: 1200 } },
  // Living areas
  { id: "real.lifestyle.living-room",       kind: "illustration", realm: "lifestyle", visualStyle: "3d", qualityTier: "premium", category: "wellness",
    extraCategories: ["marketing", "beauty"], label: "Living room (3D)",
    tags: ["living room", "sofa", "interior", "home", "3d", "isometric"],
    aspectRatio: 1.6,
    payload: { format: "url", url: render3d("lifestyle-living-room", "3d isometric modern living room", 1920, 1200), width: 1920, height: 1200 } },
  // Studios
  { id: "real.lifestyle.photo-studio",      kind: "illustration", realm: "lifestyle", visualStyle: "3d", qualityTier: "premium", category: "marketing",
    extraCategories: ["beauty", "business"], label: "Photography studio (3D)",
    tags: ["photo studio", "camera", "lights", "backdrop", "creative", "3d"],
    aspectRatio: 1.6,
    payload: { format: "url", url: render3d("lifestyle-photo-studio", "3d photography studio softbox backdrop", 1920, 1200), width: 1920, height: 1200 } },
  { id: "real.lifestyle.art-studio",        kind: "illustration", realm: "lifestyle", visualStyle: "3d", qualityTier: "premium", category: "education",
    extraCategories: ["motivation", "marketing"], label: "Art studio (3D)",
    tags: ["art studio", "easel", "paint", "canvas", "creative", "3d"],
    aspectRatio: 1.6,
    payload: { format: "url", url: render3d("lifestyle-art-studio", "3d art studio easel canvas paint", 1920, 1200), width: 1920, height: 1200 } },
  { id: "real.lifestyle.podcast-studio",    kind: "illustration", realm: "lifestyle", visualStyle: "3d", qualityTier: "premium", category: "marketing",
    extraCategories: ["business", "education"], label: "Podcast studio (3D)",
    tags: ["podcast", "studio", "microphone", "recording", "creative", "3d"],
    aspectRatio: 1.6,
    payload: { format: "url", url: render3d("lifestyle-podcast-studio", "3d podcast studio microphone setup", 1920, 1200), width: 1920, height: 1200 } },
  // Wellness & self-care setups
  { id: "real.lifestyle.spa-setup",         kind: "illustration", realm: "lifestyle", visualStyle: "3d", qualityTier: "premium", category: "wellness",
    extraCategories: ["beauty"], label: "Spa setup (3D)",
    tags: ["spa", "candles", "towels", "relax", "self-care", "3d"],
    aspectRatio: 1.6,
    payload: { format: "url", url: render3d("lifestyle-spa-setup", "3d spa setup candles towels stones", 1920, 1200), width: 1920, height: 1200 } },
  { id: "real.lifestyle.yoga-setup",        kind: "illustration", realm: "lifestyle", visualStyle: "3d", qualityTier: "premium", category: "fitness",
    extraCategories: ["wellness", "motivation"], label: "Yoga setup (3D)",
    tags: ["yoga", "mat", "studio", "plants", "wellness", "3d"],
    aspectRatio: 1.6,
    payload: { format: "url", url: render3d("lifestyle-yoga-setup", "3d yoga mat studio plants calm", 1920, 1200), width: 1920, height: 1200 } },
  { id: "real.lifestyle.bathroom",          kind: "illustration", realm: "lifestyle", visualStyle: "3d", qualityTier: "premium", category: "wellness",
    extraCategories: ["beauty"], label: "Bathroom (3D)",
    tags: ["bathroom", "clean", "spa", "tiles", "interior", "3d"],
    aspectRatio: 1.6,
    payload: { format: "url", url: render3d("lifestyle-bathroom", "3d clean bright bathroom interior", 1920, 1200), width: 1920, height: 1200 } },
  // Fitness setups
  { id: "real.lifestyle.gym",               kind: "illustration", realm: "lifestyle", visualStyle: "3d", qualityTier: "premium", category: "fitness",
    extraCategories: ["motivation"], label: "Gym interior (3D)",
    tags: ["gym", "fitness", "equipment", "weights", "workout", "3d"],
    aspectRatio: 1.6,
    payload: { format: "url", url: render3d("lifestyle-gym", "3d modern gym interior equipment", 1920, 1200), width: 1920, height: 1200 } },
  { id: "real.lifestyle.home-gym",          kind: "illustration", realm: "lifestyle", visualStyle: "3d", qualityTier: "premium", category: "fitness",
    extraCategories: ["wellness", "motivation"], label: "Home gym corner (3D)",
    tags: ["home gym", "workout", "corner", "equipment", "fitness", "3d"],
    aspectRatio: 1.6,
    payload: { format: "url", url: render3d("lifestyle-home-gym", "3d home gym corner weights mat", 1920, 1200), width: 1920, height: 1200 } },
  { id: "real.lifestyle.running-trail",     kind: "illustration", realm: "lifestyle", visualStyle: "3d", qualityTier: "premium", category: "fitness",
    extraCategories: ["travel", "motivation"], label: "Running trail (3D)",
    tags: ["running", "trail", "outdoor", "path", "fitness", "nature", "3d"],
    aspectRatio: 1.6,
    payload: { format: "url", url: render3d("lifestyle-running-trail", "3d scenic running trail path nature", 1920, 1200), width: 1920, height: 1200 } },
  // Business & retail setups
  { id: "real.lifestyle.meeting-room",      kind: "illustration", realm: "lifestyle", visualStyle: "3d", qualityTier: "premium", category: "business",
    extraCategories: ["productivity", "marketing"], label: "Meeting room (3D)",
    tags: ["meeting", "conference", "table", "team", "business", "3d"],
    aspectRatio: 1.6,
    payload: { format: "url", url: render3d("lifestyle-meeting-room", "3d modern meeting room conference table", 1920, 1200), width: 1920, height: 1200 } },
  { id: "real.lifestyle.boardroom",         kind: "illustration", realm: "lifestyle", visualStyle: "3d", qualityTier: "premium", category: "business",
    extraCategories: ["marketing"], label: "Boardroom (3D)",
    tags: ["boardroom", "executive", "corporate", "meeting", "business", "3d"],
    aspectRatio: 1.6,
    payload: { format: "url", url: render3d("lifestyle-boardroom", "3d corporate boardroom long table", 1920, 1200), width: 1920, height: 1200 } },
  { id: "real.lifestyle.retail-shop",       kind: "illustration", realm: "lifestyle", visualStyle: "3d", qualityTier: "premium", category: "marketing",
    extraCategories: ["business", "beauty"], label: "Retail shop (3D)",
    tags: ["retail", "shop", "storefront", "store", "commerce", "3d"],
    aspectRatio: 1.6,
    payload: { format: "url", url: render3d("lifestyle-retail-shop", "3d modern retail shop interior shelves", 1920, 1200), width: 1920, height: 1200 } },

  // ── Object (3D) ─────────────────────────────────────────────────────
  // Step 50: real-life daily-use object catalog. Every entry mirrors a
  // slug in ASSET_3D_MANIFEST so the library id (real.object.<suffix>)
  // and the CDN path stay 1:1. Rendered with a consistent neutral
  // backdrop, soft key light, and ¾ / front-on camera so any prop can
  // drop into any template without a visual mismatch.
  // Books & reading
  { id: "real.object.books-stack",       kind: "illustration", realm: "object", visualStyle: "3d", qualityTier: "premium", category: "education",
    extraCategories: ["productivity"], label: "Stack of books (3D)",
    tags: ["books", "stack", "read", "learn", "3d", "claymorphism"],
    aspectRatio: 1,
    payload: { format: "url", url: render3d("object-books-stack", "3d claymorphic stack of books", 1600, 1600), width: 1600, height: 1600 } },
  { id: "real.object.book-open",         kind: "illustration", realm: "object", visualStyle: "3d", qualityTier: "premium", category: "education",
    extraCategories: ["wellness", "motivation"], label: "Open book (3D)",
    tags: ["book", "open", "read", "page", "study", "3d"],
    aspectRatio: 1.3,
    payload: { format: "url", url: render3d("object-book-open", "3d open book pages", 1600, 1200), width: 1600, height: 1200 } },
  // Stationery
  { id: "real.object.notebook",          kind: "illustration", realm: "object", visualStyle: "3d", qualityTier: "premium", category: "education",
    extraCategories: ["productivity", "motivation"], label: "Notebook (3D)",
    tags: ["notebook", "journal", "write", "page", "3d"],
    aspectRatio: 1.3,
    payload: { format: "url", url: render3d("object-notebook", "3d open notebook pen", 1600, 1200), width: 1600, height: 1200 } },
  { id: "real.object.notebook-pen",      kind: "illustration", realm: "object", visualStyle: "3d", qualityTier: "premium", category: "productivity",
    extraCategories: ["education", "business"], label: "Notebook with pen (3D)",
    tags: ["notebook", "pen", "journal", "desk", "stationery", "3d"],
    aspectRatio: 1.3,
    payload: { format: "url", url: render3d("object-notebook-pen", "3d notebook with pen desk", 1600, 1200), width: 1600, height: 1200 } },
  { id: "real.object.pen-set",           kind: "illustration", realm: "object", visualStyle: "3d", qualityTier: "premium", category: "productivity",
    extraCategories: ["education", "business"], label: "Pen set (3D)",
    tags: ["pen", "stationery", "writing", "desk", "3d"],
    aspectRatio: 1,
    payload: { format: "url", url: render3d("object-pen-set", "3d ballpoint pen set stationery", 1600, 1600), width: 1600, height: 1600 } },
  { id: "real.object.pencil-set",        kind: "illustration", realm: "object", visualStyle: "3d", qualityTier: "premium", category: "education",
    extraCategories: ["productivity"], label: "Pencil set (3D)",
    tags: ["pencil", "stationery", "school", "drawing", "3d"],
    aspectRatio: 1,
    payload: { format: "url", url: render3d("object-pencil-set", "3d colored pencil set stationery", 1600, 1600), width: 1600, height: 1600 } },
  // Tech
  { id: "real.object.laptop",            kind: "illustration", realm: "object", visualStyle: "3d", qualityTier: "premium", category: "business",
    extraCategories: ["productivity"], label: "Laptop (3D)",
    tags: ["laptop", "notebook", "tech", "work", "3d", "isometric"],
    aspectRatio: 1.3,
    payload: { format: "url", url: render3d("object-laptop", "3d laptop isometric isolated", 1600, 1200), width: 1600, height: 1200 } },
  { id: "real.object.phone",             kind: "illustration", realm: "object", visualStyle: "3d", qualityTier: "premium", category: "marketing",
    extraCategories: ["business", "productivity"], label: "Smartphone (3D)",
    tags: ["phone", "smartphone", "mobile", "tech", "app", "3d"],
    aspectRatio: 0.8,
    payload: { format: "url", url: render3d("object-phone", "3d smartphone mockup isolated", 1200, 1500), width: 1200, height: 1500 } },
  { id: "real.object.camera",            kind: "illustration", realm: "object", visualStyle: "3d", qualityTier: "premium", category: "marketing",
    extraCategories: ["beauty", "travel"], label: "Camera (3D)",
    tags: ["camera", "photo", "lens", "creative", "3d", "claymorphism"],
    aspectRatio: 1,
    payload: { format: "url", url: render3d("object-camera", "3d claymorphic camera with lens", 1600, 1600), width: 1600, height: 1600 } },
  { id: "real.object.headphones",        kind: "illustration", realm: "object", visualStyle: "3d", qualityTier: "premium", category: "productivity",
    extraCategories: ["marketing", "motivation"], label: "Headphones (3D)",
    tags: ["headphones", "music", "audio", "focus", "3d", "claymorphism"],
    aspectRatio: 1,
    payload: { format: "url", url: render3d("object-headphones", "3d claymorphic over-ear headphones", 1600, 1600), width: 1600, height: 1600 } },
  // Business combos & charts
  { id: "real.object.laptop-coffee",     kind: "illustration", realm: "object", visualStyle: "3d", qualityTier: "premium", category: "business",
    extraCategories: ["productivity", "marketing"], label: "Laptop with coffee (3D)",
    tags: ["laptop", "coffee", "workday", "desk", "business", "3d"],
    aspectRatio: 1.3,
    payload: { format: "url", url: render3d("object-laptop-coffee", "3d laptop with coffee cup desk", 1600, 1200), width: 1600, height: 1200 } },
  { id: "real.object.notebook-meeting",  kind: "illustration", realm: "object", visualStyle: "3d", qualityTier: "premium", category: "business",
    extraCategories: ["productivity"], label: "Meeting notebook (3D)",
    tags: ["notebook", "meeting", "notes", "pen", "planning", "3d"],
    aspectRatio: 1.3,
    payload: { format: "url", url: render3d("object-notebook-meeting", "3d meeting notebook pen notes", 1600, 1200), width: 1600, height: 1200 } },
  { id: "real.object.bar-chart",         kind: "illustration", realm: "object", visualStyle: "3d", qualityTier: "premium", category: "business",
    extraCategories: ["marketing"], label: "Bar chart (3D)",
    tags: ["bar chart", "graph", "data", "analytics", "business", "3d"],
    aspectRatio: 1,
    payload: { format: "url", url: render3d("object-bar-chart", "3d bar chart analytics graph", 1600, 1600), width: 1600, height: 1600 } },
  { id: "real.object.line-chart",        kind: "illustration", realm: "object", visualStyle: "3d", qualityTier: "premium", category: "business",
    extraCategories: ["marketing", "motivation"], label: "Line chart (3D)",
    tags: ["line chart", "trend", "growth", "data", "business", "3d"],
    aspectRatio: 1.3,
    payload: { format: "url", url: render3d("object-line-chart", "3d line chart growth trend up", 1600, 1200), width: 1600, height: 1200 } },
  { id: "real.object.pie-chart",         kind: "illustration", realm: "object", visualStyle: "3d", qualityTier: "premium", category: "business",
    extraCategories: ["marketing"], label: "Pie chart (3D)",
    tags: ["pie chart", "data", "analytics", "share", "business", "3d"],
    aspectRatio: 1,
    payload: { format: "url", url: render3d("object-pie-chart", "3d pie chart segments data", 1600, 1600), width: 1600, height: 1600 } },
  // Drinks
  { id: "real.object.coffee-cup",        kind: "illustration", realm: "object", visualStyle: "3d", qualityTier: "premium", category: "productivity",
    extraCategories: ["marketing", "wellness"], label: "Coffee cup (3D)",
    tags: ["coffee", "cup", "morning", "desk", "3d"],
    aspectRatio: 1,
    payload: { format: "url", url: render3d("object-coffee-cup", "3d coffee cup steaming", 1600, 1600), width: 1600, height: 1600 } },
  { id: "real.object.coffee-mug",        kind: "illustration", realm: "object", visualStyle: "3d", qualityTier: "premium", category: "productivity",
    extraCategories: ["wellness"], label: "Coffee mug (3D)",
    tags: ["coffee", "mug", "ceramic", "warm", "morning", "3d"],
    aspectRatio: 1,
    payload: { format: "url", url: render3d("object-coffee-mug", "3d ceramic coffee mug steaming", 1600, 1600), width: 1600, height: 1600 } },
  { id: "real.object.tea-cup",           kind: "illustration", realm: "object", visualStyle: "3d", qualityTier: "premium", category: "wellness",
    extraCategories: ["beauty"], label: "Tea cup (3D)",
    tags: ["tea", "cup", "calm", "saucer", "warm", "3d"],
    aspectRatio: 1,
    payload: { format: "url", url: render3d("object-tea-cup", "3d tea cup saucer steaming", 1600, 1600), width: 1600, height: 1600 } },
  // Food
  { id: "real.object.salad-bowl",        kind: "illustration", realm: "object", visualStyle: "3d", qualityTier: "premium", category: "wellness",
    extraCategories: ["fitness", "beauty"], label: "Salad bowl (3D)",
    tags: ["salad", "bowl", "greens", "healthy", "food", "3d"],
    aspectRatio: 1,
    payload: { format: "url", url: render3d("object-salad-bowl", "3d fresh salad bowl greens healthy", 1600, 1600), width: 1600, height: 1600 } },
  { id: "real.object.balanced-meal",     kind: "illustration", realm: "object", visualStyle: "3d", qualityTier: "premium", category: "wellness",
    extraCategories: ["fitness"], label: "Balanced meal bowl (3D)",
    tags: ["balanced", "meal", "bowl", "grain", "protein", "healthy", "3d"],
    aspectRatio: 1,
    payload: { format: "url", url: render3d("object-balanced-meal", "3d balanced meal bowl grain protein veggies", 1600, 1600), width: 1600, height: 1600 } },
  { id: "real.object.breakfast-spread",  kind: "illustration", realm: "object", visualStyle: "3d", qualityTier: "premium", category: "wellness",
    extraCategories: ["beauty", "marketing"], label: "Breakfast spread (3D)",
    tags: ["breakfast", "spread", "morning", "pancake", "fruit", "coffee", "3d"],
    aspectRatio: 1.6,
    payload: { format: "url", url: render3d("object-breakfast-spread", "3d breakfast spread pancakes fruit coffee", 1920, 1200), width: 1920, height: 1200 } },
  { id: "real.object.smoothie-bowl",     kind: "illustration", realm: "object", visualStyle: "3d", qualityTier: "premium", category: "wellness",
    extraCategories: ["fitness", "beauty"], label: "Smoothie bowl (3D)",
    tags: ["smoothie", "bowl", "acai", "berries", "healthy", "3d"],
    aspectRatio: 1,
    payload: { format: "url", url: render3d("object-smoothie-bowl", "3d smoothie bowl berries topping", 1600, 1600), width: 1600, height: 1600 } },
  { id: "real.object.fruit-platter",     kind: "illustration", realm: "object", visualStyle: "3d", qualityTier: "premium", category: "wellness",
    extraCategories: ["beauty"], label: "Fruit platter (3D)",
    tags: ["fruit", "platter", "fresh", "colorful", "healthy", "3d"],
    aspectRatio: 1,
    payload: { format: "url", url: render3d("object-fruit-platter", "3d fruit platter fresh colorful", 1600, 1600), width: 1600, height: 1600 } },
  { id: "real.object.meal-prep",         kind: "illustration", realm: "object", visualStyle: "3d", qualityTier: "premium", category: "fitness",
    extraCategories: ["wellness", "motivation"], label: "Meal-prep containers (3D)",
    tags: ["meal prep", "containers", "healthy", "nutrition", "3d"],
    aspectRatio: 1.3,
    payload: { format: "url", url: render3d("object-meal-prep", "3d meal prep containers healthy", 1600, 1200), width: 1600, height: 1200 } },
  // Fitness
  { id: "real.object.water-bottle",      kind: "illustration", realm: "object", visualStyle: "3d", qualityTier: "premium", category: "fitness",
    extraCategories: ["wellness"], label: "Water bottle (3D)",
    tags: ["water", "bottle", "hydration", "fitness", "3d"],
    aspectRatio: 1,
    payload: { format: "url", url: render3d("object-water-bottle", "3d water bottle isolated", 1600, 1600), width: 1600, height: 1600 } },
  { id: "real.object.dumbbell",          kind: "illustration", realm: "object", visualStyle: "3d", qualityTier: "premium", category: "fitness",
    extraCategories: ["motivation"], label: "Dumbbell (3D)",
    tags: ["dumbbell", "weight", "gym", "strength", "3d", "claymorphism"],
    aspectRatio: 1,
    payload: { format: "url", url: render3d("object-dumbbell", "3d claymorphic dumbbell", 1600, 1600), width: 1600, height: 1600 } },
  { id: "real.object.yoga-mat",          kind: "illustration", realm: "object", visualStyle: "3d", qualityTier: "premium", category: "fitness",
    extraCategories: ["wellness"], label: "Yoga mat (3D)",
    tags: ["yoga", "mat", "rolled", "wellness", "fitness", "3d"],
    aspectRatio: 1.3,
    payload: { format: "url", url: render3d("object-yoga-mat", "3d rolled yoga mat isolated", 1600, 1200), width: 1600, height: 1200 } },
  { id: "real.object.running-shoes",     kind: "illustration", realm: "object", visualStyle: "3d", qualityTier: "premium", category: "fitness",
    extraCategories: ["motivation", "marketing"], label: "Running shoes (3D)",
    tags: ["running", "shoes", "sneakers", "sport", "fitness", "3d"],
    aspectRatio: 1.3,
    payload: { format: "url", url: render3d("object-running-shoes", "3d modern running shoes pair", 1600, 1200), width: 1600, height: 1200 } },
  { id: "real.object.gym-bag",           kind: "illustration", realm: "object", visualStyle: "3d", qualityTier: "premium", category: "fitness",
    extraCategories: ["travel"], label: "Gym bag (3D)",
    tags: ["gym bag", "duffle", "sport", "fitness", "3d"],
    aspectRatio: 1.3,
    payload: { format: "url", url: render3d("object-gym-bag", "3d duffle gym bag isolated", 1600, 1200), width: 1600, height: 1200 } },
  { id: "real.object.activewear",        kind: "illustration", realm: "object", visualStyle: "3d", qualityTier: "premium", category: "fitness",
    extraCategories: ["beauty", "wellness"], label: "Activewear flat-lay (3D)",
    tags: ["activewear", "sportswear", "leggings", "flatlay", "fitness", "3d"],
    aspectRatio: 1,
    payload: { format: "url", url: render3d("object-activewear", "3d activewear flatlay leggings sports", 1600, 1600), width: 1600, height: 1600 } },
  // Travel
  { id: "real.object.suitcase",          kind: "illustration", realm: "object", visualStyle: "3d", qualityTier: "premium", category: "travel",
    extraCategories: ["motivation"], label: "Suitcase (3D)",
    tags: ["suitcase", "luggage", "travel", "trip", "3d", "claymorphism"],
    aspectRatio: 1,
    payload: { format: "url", url: render3d("object-suitcase", "3d claymorphic travel suitcase", 1600, 1600), width: 1600, height: 1600 } },
  { id: "real.object.passport",          kind: "illustration", realm: "object", visualStyle: "3d", qualityTier: "premium", category: "travel",
    extraCategories: ["business"], label: "Passport (3D)",
    tags: ["passport", "travel", "document", "trip", "3d"],
    aspectRatio: 1,
    payload: { format: "url", url: render3d("object-passport", "3d passport document travel", 1600, 1600), width: 1600, height: 1600 } },
  { id: "real.object.travel-kit",        kind: "illustration", realm: "object", visualStyle: "3d", qualityTier: "premium", category: "travel",
    extraCategories: ["marketing"], label: "Travel kit flat-lay (3D)",
    tags: ["travel", "kit", "flatlay", "passport", "camera", "map", "3d"],
    aspectRatio: 1,
    payload: { format: "url", url: render3d("object-travel-kit", "3d travel kit flatlay passport camera map", 1600, 1600), width: 1600, height: 1600 } },
  { id: "real.object.backpack",          kind: "illustration", realm: "object", visualStyle: "3d", qualityTier: "premium", category: "travel",
    extraCategories: ["education", "fitness"], label: "Travel backpack (3D)",
    tags: ["backpack", "rucksack", "travel", "hiking", "3d"],
    aspectRatio: 1,
    payload: { format: "url", url: render3d("object-backpack", "3d travel backpack rucksack", 1600, 1600), width: 1600, height: 1600 } },
  // Beauty & wellness
  { id: "real.object.skincare-bottle",   kind: "illustration", realm: "object", visualStyle: "3d", qualityTier: "premium", category: "beauty",
    extraCategories: ["wellness"], label: "Skincare bottle (3D)",
    tags: ["skincare", "bottle", "serum", "clean", "3d", "claymorphism"],
    aspectRatio: 1,
    payload: { format: "url", url: render3d("object-skincare-bottle", "3d claymorphic skincare bottle", 1600, 1600), width: 1600, height: 1600 } },
  { id: "real.object.perfume-bottle",    kind: "illustration", realm: "object", visualStyle: "3d", qualityTier: "premium", category: "beauty",
    extraCategories: ["marketing"], label: "Perfume bottle (3D)",
    tags: ["perfume", "fragrance", "bottle", "glass", "luxury", "3d"],
    aspectRatio: 1,
    payload: { format: "url", url: render3d("object-perfume-bottle", "3d glass perfume bottle elegant", 1600, 1600), width: 1600, height: 1600 } },
  { id: "real.object.candle",            kind: "illustration", realm: "object", visualStyle: "3d", qualityTier: "premium", category: "wellness",
    extraCategories: ["beauty"], label: "Candle (3D)",
    tags: ["candle", "wax", "warm", "calm", "aroma", "3d"],
    aspectRatio: 1,
    payload: { format: "url", url: render3d("object-candle", "3d scented candle glowing warm", 1600, 1600), width: 1600, height: 1600 } },
  { id: "real.object.diffuser",          kind: "illustration", realm: "object", visualStyle: "3d", qualityTier: "premium", category: "wellness",
    extraCategories: ["beauty"], label: "Essential-oil diffuser (3D)",
    tags: ["diffuser", "essential oil", "aroma", "calm", "spa", "3d"],
    aspectRatio: 1,
    payload: { format: "url", url: render3d("object-diffuser", "3d essential oil diffuser mist", 1600, 1600), width: 1600, height: 1600 } },
  { id: "real.object.serum-dropper",     kind: "illustration", realm: "object", visualStyle: "3d", qualityTier: "premium", category: "beauty",
    extraCategories: ["wellness"], label: "Serum dropper (3D)",
    tags: ["serum", "dropper", "skincare", "glass", "luxury", "3d"],
    aspectRatio: 1,
    payload: { format: "url", url: render3d("object-serum-dropper", "3d glass serum dropper bottle", 1600, 1600), width: 1600, height: 1600 } },
  // Makeup
  { id: "real.object.makeup-brushes",    kind: "illustration", realm: "object", visualStyle: "3d", qualityTier: "premium", category: "beauty",
    extraCategories: ["marketing"], label: "Makeup brush set (3D)",
    tags: ["makeup", "brushes", "set", "beauty", "cosmetics", "3d"],
    aspectRatio: 1,
    payload: { format: "url", url: render3d("object-makeup-brushes", "3d makeup brush set holder", 1600, 1600), width: 1600, height: 1600 } },
  { id: "real.object.lipstick",          kind: "illustration", realm: "object", visualStyle: "3d", qualityTier: "premium", category: "beauty",
    extraCategories: ["marketing"], label: "Lipstick (3D)",
    tags: ["lipstick", "cosmetics", "beauty", "lip", "luxury", "3d"],
    aspectRatio: 1,
    payload: { format: "url", url: render3d("object-lipstick", "3d lipstick tube glossy", 1600, 1600), width: 1600, height: 1600 } },
  { id: "real.object.makeup-palette",    kind: "illustration", realm: "object", visualStyle: "3d", qualityTier: "premium", category: "beauty",
    extraCategories: ["marketing"], label: "Makeup palette (3D)",
    tags: ["makeup", "palette", "eyeshadow", "colors", "cosmetics", "3d"],
    aspectRatio: 1.3,
    payload: { format: "url", url: render3d("object-makeup-palette", "3d eyeshadow makeup palette colors", 1600, 1200), width: 1600, height: 1200 } },
  // Bath essentials
  { id: "real.object.bath-salts",        kind: "illustration", realm: "object", visualStyle: "3d", qualityTier: "premium", category: "wellness",
    extraCategories: ["beauty"], label: "Bath salts jar (3D)",
    tags: ["bath salts", "jar", "spa", "relax", "wellness", "3d"],
    aspectRatio: 1,
    payload: { format: "url", url: render3d("object-bath-salts", "3d bath salts jar spa", 1600, 1600), width: 1600, height: 1600 } },
  { id: "real.object.bath-soap-set",     kind: "illustration", realm: "object", visualStyle: "3d", qualityTier: "premium", category: "wellness",
    extraCategories: ["beauty"], label: "Bath soap set (3D)",
    tags: ["soap", "bath", "bar", "natural", "spa", "3d"],
    aspectRatio: 1,
    payload: { format: "url", url: render3d("object-bath-soap-set", "3d natural soap bar set spa", 1600, 1600), width: 1600, height: 1600 } },
  // Fashion
  { id: "real.object.outfit-flatlay",    kind: "illustration", realm: "object", visualStyle: "3d", qualityTier: "premium", category: "beauty",
    extraCategories: ["marketing"], label: "Outfit flat-lay (3D)",
    tags: ["outfit", "flatlay", "fashion", "style", "wardrobe", "3d"],
    aspectRatio: 1,
    payload: { format: "url", url: render3d("object-outfit-flatlay", "3d fashion outfit flatlay top bottom shoes", 1600, 1600), width: 1600, height: 1600 } },
  { id: "real.object.handbag",           kind: "illustration", realm: "object", visualStyle: "3d", qualityTier: "premium", category: "beauty",
    extraCategories: ["marketing", "travel"], label: "Handbag (3D)",
    tags: ["handbag", "purse", "fashion", "accessory", "leather", "3d"],
    aspectRatio: 1,
    payload: { format: "url", url: render3d("object-handbag", "3d leather handbag fashion", 1600, 1600), width: 1600, height: 1600 } },
  { id: "real.object.heels",             kind: "illustration", realm: "object", visualStyle: "3d", qualityTier: "premium", category: "beauty",
    extraCategories: ["marketing"], label: "Heels (3D)",
    tags: ["heels", "shoes", "fashion", "elegant", "3d"],
    aspectRatio: 1,
    payload: { format: "url", url: render3d("object-heels", "3d elegant heels fashion pair", 1600, 1600), width: 1600, height: 1600 } },
  { id: "real.object.sunglasses",        kind: "illustration", realm: "object", visualStyle: "3d", qualityTier: "premium", category: "beauty",
    extraCategories: ["travel", "marketing"], label: "Sunglasses (3D)",
    tags: ["sunglasses", "eyewear", "fashion", "summer", "3d"],
    aspectRatio: 1,
    payload: { format: "url", url: render3d("object-sunglasses", "3d sunglasses fashion eyewear", 1600, 1600), width: 1600, height: 1600 } },
  { id: "real.object.watch",             kind: "illustration", realm: "object", visualStyle: "3d", qualityTier: "premium", category: "business",
    extraCategories: ["beauty", "marketing"], label: "Wristwatch (3D)",
    tags: ["watch", "wristwatch", "time", "fashion", "luxury", "3d"],
    aspectRatio: 1,
    payload: { format: "url", url: render3d("object-watch", "3d luxury wristwatch leather strap", 1600, 1600), width: 1600, height: 1600 } },
  // Promo & marketing
  { id: "real.object.product-display",   kind: "illustration", realm: "object", visualStyle: "3d", qualityTier: "premium", category: "marketing",
    extraCategories: ["beauty", "business"], label: "Product display (3D)",
    tags: ["product", "display", "pedestal", "showcase", "marketing", "3d"],
    aspectRatio: 1,
    payload: { format: "url", url: render3d("object-product-display", "3d product pedestal display showcase", 1600, 1600), width: 1600, height: 1600 } },
  { id: "real.object.shopping-bag",      kind: "illustration", realm: "object", visualStyle: "3d", qualityTier: "premium", category: "marketing",
    extraCategories: ["beauty"], label: "Shopping bag (3D)",
    tags: ["shopping", "bag", "retail", "store", "marketing", "3d"],
    aspectRatio: 1,
    payload: { format: "url", url: render3d("object-shopping-bag", "3d branded shopping bag retail", 1600, 1600), width: 1600, height: 1600 } },
  { id: "real.object.shopping-cart",     kind: "illustration", realm: "object", visualStyle: "3d", qualityTier: "premium", category: "marketing",
    extraCategories: ["business"], label: "Shopping cart (3D)",
    tags: ["shopping", "cart", "ecommerce", "retail", "marketing", "3d"],
    aspectRatio: 1,
    payload: { format: "url", url: render3d("object-shopping-cart", "3d shopping cart ecommerce", 1600, 1600), width: 1600, height: 1600 } },
  { id: "real.object.gift-box",          kind: "illustration", realm: "object", visualStyle: "3d", qualityTier: "premium", category: "marketing",
    extraCategories: ["beauty", "motivation"], label: "Gift box (3D)",
    tags: ["gift", "box", "ribbon", "present", "celebration", "3d"],
    aspectRatio: 1,
    payload: { format: "url", url: render3d("object-gift-box", "3d gift box ribbon bow", 1600, 1600), width: 1600, height: 1600 } },
  { id: "real.object.sale-tag",          kind: "illustration", realm: "object", visualStyle: "3d", qualityTier: "premium", category: "marketing",
    extraCategories: ["business"], label: "Sale tag (3D)",
    tags: ["sale", "tag", "discount", "price", "promo", "3d"],
    aspectRatio: 1,
    payload: { format: "url", url: render3d("object-sale-tag", "3d sale price tag discount", 1600, 1600), width: 1600, height: 1600 } },
  { id: "real.object.megaphone",         kind: "illustration", realm: "object", visualStyle: "3d", qualityTier: "premium", category: "marketing",
    extraCategories: ["business", "motivation"], label: "Megaphone (3D)",
    tags: ["megaphone", "announce", "promo", "marketing", "loud", "3d"],
    aspectRatio: 1,
    payload: { format: "url", url: render3d("object-megaphone", "3d megaphone bullhorn announce", 1600, 1600), width: 1600, height: 1600 } },
  { id: "real.object.confetti-burst",    kind: "illustration", realm: "object", visualStyle: "3d", qualityTier: "premium", category: "marketing",
    extraCategories: ["motivation", "beauty"], label: "Confetti burst (3D)",
    tags: ["confetti", "celebration", "launch", "promo", "party", "3d"],
    aspectRatio: 1,
    payload: { format: "url", url: render3d("object-confetti-burst", "3d confetti burst celebration", 1600, 1600), width: 1600, height: 1600 } },
  // Toys
  { id: "real.object.toy-rocket",        kind: "illustration", realm: "object", visualStyle: "3d", qualityTier: "premium", category: "marketing",
    extraCategories: ["motivation", "education"], label: "Toy rocket (3D)",
    tags: ["rocket", "launch", "toy", "play", "3d", "claymorphism"],
    aspectRatio: 1,
    payload: { format: "url", url: render3d("object-toy-rocket", "3d claymorphic toy rocket", 1600, 1600), width: 1600, height: 1600 } },
  { id: "real.object.plush-bear",        kind: "illustration", realm: "object", visualStyle: "3d", qualityTier: "premium", category: "marketing",
    extraCategories: ["education", "beauty"], label: "Plush bear (3D)",
    tags: ["plush", "bear", "toy", "soft", "cute", "3d"],
    aspectRatio: 1,
    payload: { format: "url", url: render3d("object-plush-bear", "3d plush teddy bear cute", 1600, 1600), width: 1600, height: 1600 } },
  { id: "real.object.building-blocks",   kind: "illustration", realm: "object", visualStyle: "3d", qualityTier: "premium", category: "education",
    extraCategories: ["marketing", "motivation"], label: "Building blocks (3D)",
    tags: ["blocks", "toy", "build", "play", "kids", "3d", "claymorphism"],
    aspectRatio: 1,
    payload: { format: "url", url: render3d("object-building-blocks", "3d claymorphic building blocks stack", 1600, 1600), width: 1600, height: 1600 } },

  // ── Scene (3D) ──────────────────────────────────────────────────────
  { id: "real.scene.city-skyline-dawn",  kind: "illustration", realm: "scene", visualStyle: "3d", qualityTier: "premium", category: "business",
    extraCategories: ["travel", "marketing"], label: "City skyline (3D)",
    tags: ["city", "skyline", "dawn", "urban", "corporate", "3d", "isometric"],
    aspectRatio: 2,
    payload: { format: "url", url: render3d("scene-city-skyline", "3d isometric city skyline dawn", 2000, 1000), width: 2000, height: 1000 } },
  { id: "real.scene.beach-horizon",      kind: "illustration", realm: "scene", visualStyle: "3d", qualityTier: "premium", category: "travel",
    extraCategories: ["wellness"], label: "Beach horizon (3D)",
    tags: ["beach", "ocean", "horizon", "travel", "calm", "3d"],
    aspectRatio: 2,
    payload: { format: "url", url: render3d("scene-beach-horizon", "3d beach horizon panoramic stylized", 2000, 1000), width: 2000, height: 1000 } },
  { id: "real.scene.cafe-interior",      kind: "illustration", realm: "scene", visualStyle: "3d", qualityTier: "premium", category: "marketing",
    extraCategories: ["productivity", "education"], label: "Café interior (3D)",
    tags: ["cafe", "coffee shop", "interior", "warm", "3d", "isometric"],
    aspectRatio: 1.6,
    payload: { format: "url", url: render3d("scene-cafe-interior", "3d isometric cafe interior warm", 1920, 1200), width: 1920, height: 1200 } },
  { id: "real.scene.living-room",        kind: "illustration", realm: "scene", visualStyle: "3d", qualityTier: "premium", category: "wellness",
    extraCategories: ["beauty"], label: "Living room (3D)",
    tags: ["living room", "interior", "minimal", "home", "3d", "isometric"],
    aspectRatio: 1.6,
    payload: { format: "url", url: render3d("scene-living-room", "3d isometric minimal living room", 1920, 1200), width: 1920, height: 1200 } },
  { id: "real.scene.urban-street",       kind: "illustration", realm: "scene", visualStyle: "3d", qualityTier: "premium", category: "marketing",
    extraCategories: ["travel", "business"], label: "Urban street (3D)",
    tags: ["urban", "street", "city", "people", "3d", "isometric"],
    aspectRatio: 1.6,
    payload: { format: "url", url: render3d("scene-urban-street", "3d isometric urban street morning", 1920, 1200), width: 1920, height: 1200 } },
];

// ── Step 40: Inline-SVG illustration catalog ─────────────────────────────────
// Self-contained scene illustrations composed via svg-scene-composer. No
// external image service required — every asset renders offline from a
// deterministic SVG string. Marked visualStyle="illustration" so they
// slot in as the natural second-preference style when the 3D CDN isn't
// populated (Step 36's STYLE_PREFERENCE is ["3d","illustration",...]).
//
// Each scene is palette-driven (category → ScenePalette mapping), so
// one scene kind supports multiple category homes with the right colors.

// svg-scene-composer is self-contained (no imports from the asset
// library) so a plain static import is safe and preferable for
// bundler tree-shaking.
import { renderScene } from "../../engines/assets/svg-scene-composer";

const sceneAsset = (opts: {
  id:       string;
  sceneKind: import("../../engines/assets/svg-scene-composer").SceneKind;
  category: Asset["category"];
  extraCategories?: Asset["extraCategories"];
  label:    string;
  tags:     string[];
}): Asset => ({
  id:              opts.id,
  kind:            "illustration",
  category:        opts.category,
  extraCategories: opts.extraCategories,
  label:           opts.label,
  tags:            [...opts.tags, "inline-svg", "scene", "illustration"],
  aspectRatio:     1,
  visualStyle:     "illustration",
  // Inline scenes render deterministically but are flat vector art —
  // acceptable as a supporting/fallback style, not the premium hero
  // tier reserved for curated 3D renders.
  qualityTier:     "standard",
  payload:         { format: "svg", markup: renderScene(opts.sceneKind, opts.category) },
});

const INLINE_SCENE_ASSETS: Asset[] = [
  // ── Motivation ──────────────────────────────────────────────────────
  sceneAsset({
    id: "scene.motivation.mountain-sunrise", sceneKind: "mountain-sunrise",
    category: "motivation", extraCategories: ["travel", "wellness"],
    label: "Mountain sunrise scene",
    tags: ["mountain", "sunrise", "peak", "aspire", "goal", "rise"],
  }),
  sceneAsset({
    id: "scene.motivation.trophy", sceneKind: "trophy-podium",
    category: "motivation", extraCategories: ["fitness", "business"],
    label: "Trophy podium scene",
    tags: ["trophy", "win", "achievement", "success", "first"],
  }),
  sceneAsset({
    id: "scene.motivation.target-arrow", sceneKind: "target-arrow",
    category: "motivation", extraCategories: ["productivity", "business"],
    label: "Target with arrow",
    tags: ["target", "goal", "aim", "focus", "arrow", "bullseye"],
  }),
  sceneAsset({
    id: "scene.motivation.cloudscape", sceneKind: "cloudscape",
    category: "motivation", extraCategories: ["travel", "wellness"],
    label: "Cloudscape with peaks",
    tags: ["sky", "cloud", "horizon", "aspire", "rise"],
  }),

  // ── Wellness ────────────────────────────────────────────────────────
  sceneAsset({
    id: "scene.wellness.plant", sceneKind: "plant-potted",
    category: "wellness", extraCategories: ["productivity", "beauty"],
    label: "Potted plant scene",
    tags: ["plant", "pothos", "green", "calm", "nature", "indoor"],
  }),
  sceneAsset({
    id: "scene.wellness.leaf", sceneKind: "leaf-scene",
    category: "wellness", extraCategories: ["beauty", "motivation"],
    label: "Leaf scene",
    tags: ["leaf", "green", "growth", "nature", "organic"],
  }),
  sceneAsset({
    id: "scene.wellness.heart", sceneKind: "heart-centered",
    category: "wellness", extraCategories: ["beauty", "marketing"],
    label: "Heart scene",
    tags: ["heart", "health", "care", "love", "self-care"],
  }),

  // ── Productivity ────────────────────────────────────────────────────
  sceneAsset({
    id: "scene.productivity.target", sceneKind: "target-arrow",
    category: "productivity", extraCategories: ["business", "motivation"],
    label: "Productivity target",
    tags: ["target", "focus", "task", "goal", "done"],
  }),
  sceneAsset({
    id: "scene.productivity.bulb", sceneKind: "idea-bulb",
    category: "productivity", extraCategories: ["education", "business"],
    label: "Idea lightbulb",
    tags: ["idea", "lightbulb", "think", "plan", "insight"],
  }),

  // ── Education ───────────────────────────────────────────────────────
  sceneAsset({
    id: "scene.education.books", sceneKind: "books-stack",
    category: "education", extraCategories: ["productivity", "motivation"],
    label: "Books stack scene",
    tags: ["books", "learn", "read", "study", "knowledge"],
  }),
  sceneAsset({
    id: "scene.education.bulb", sceneKind: "idea-bulb",
    category: "education", extraCategories: ["business", "motivation"],
    label: "Learning lightbulb",
    tags: ["idea", "learn", "insight", "knowledge", "think"],
  }),

  // ── Fitness ─────────────────────────────────────────────────────────
  sceneAsset({
    id: "scene.fitness.dumbbell", sceneKind: "dumbbell-rack",
    category: "fitness", extraCategories: ["motivation"],
    label: "Dumbbell scene",
    tags: ["dumbbell", "weight", "gym", "strength", "train"],
  }),
  sceneAsset({
    id: "scene.fitness.water", sceneKind: "water-bottle",
    category: "fitness", extraCategories: ["wellness"],
    label: "Water bottle scene",
    tags: ["water", "hydrate", "bottle", "fitness", "fuel"],
  }),
  sceneAsset({
    id: "scene.fitness.trophy", sceneKind: "trophy-podium",
    category: "fitness", extraCategories: ["motivation"],
    label: "Fitness trophy",
    tags: ["trophy", "win", "achieve", "result", "fitness"],
  }),

  // ── Beauty ──────────────────────────────────────────────────────────
  sceneAsset({
    id: "scene.beauty.heart", sceneKind: "heart-centered",
    category: "beauty", extraCategories: ["wellness", "marketing"],
    label: "Beauty heart",
    tags: ["heart", "love", "care", "beauty", "self-care"],
  }),
  sceneAsset({
    id: "scene.beauty.leaf", sceneKind: "leaf-scene",
    category: "beauty", extraCategories: ["wellness"],
    label: "Botanical leaf",
    tags: ["leaf", "botanical", "natural", "clean", "fresh"],
  }),

  // ── Travel ──────────────────────────────────────────────────────────
  sceneAsset({
    id: "scene.travel.paper-plane", sceneKind: "paper-plane",
    category: "travel", extraCategories: ["motivation", "marketing"],
    label: "Paper plane journey",
    tags: ["plane", "travel", "journey", "explore", "paper"],
  }),
  sceneAsset({
    id: "scene.travel.mountain", sceneKind: "mountain-sunrise",
    category: "travel", extraCategories: ["wellness", "motivation"],
    label: "Travel mountain sunrise",
    tags: ["mountain", "horizon", "travel", "adventure", "nature"],
  }),
  sceneAsset({
    id: "scene.travel.cloudscape", sceneKind: "cloudscape",
    category: "travel", extraCategories: ["motivation"],
    label: "Travel cloudscape",
    tags: ["sky", "clouds", "horizon", "travel", "destination"],
  }),

  // ── Business ────────────────────────────────────────────────────────
  sceneAsset({
    id: "scene.business.target", sceneKind: "target-arrow",
    category: "business", extraCategories: ["productivity", "motivation"],
    label: "Business target",
    tags: ["target", "goal", "strategy", "growth", "aim"],
  }),
  sceneAsset({
    id: "scene.business.trophy", sceneKind: "trophy-podium",
    category: "business", extraCategories: ["motivation", "marketing"],
    label: "Business achievement",
    tags: ["trophy", "achieve", "win", "success", "result"],
  }),
  sceneAsset({
    id: "scene.business.bulb", sceneKind: "idea-bulb",
    category: "business", extraCategories: ["productivity", "education"],
    label: "Business insight bulb",
    tags: ["idea", "insight", "strategy", "innovation", "think"],
  }),

  // ── Marketing ───────────────────────────────────────────────────────
  sceneAsset({
    id: "scene.marketing.megaphone", sceneKind: "megaphone-launch",
    category: "marketing", extraCategories: ["business"],
    label: "Marketing megaphone",
    tags: ["megaphone", "launch", "announce", "promo", "campaign"],
  }),
  sceneAsset({
    id: "scene.marketing.paper-plane", sceneKind: "paper-plane",
    category: "marketing", extraCategories: ["business", "travel"],
    label: "Marketing launch plane",
    tags: ["plane", "launch", "deliver", "message", "go"],
  }),

  // ── Step 41: Richer scene compositions ──────────────────────────────
  sceneAsset({
    id: "scene.travel.polaroid-mountain", sceneKind: "polaroid-mountain",
    category: "travel", extraCategories: ["motivation", "marketing"],
    label: "Polaroid mountain memory",
    tags: ["polaroid", "photo", "mountain", "memory", "travel", "vintage"],
  }),
  sceneAsset({
    id: "scene.beauty.floral-wreath", sceneKind: "floral-wreath",
    category: "beauty", extraCategories: ["wellness", "motivation"],
    label: "Floral wreath",
    tags: ["floral", "wreath", "bloom", "flowers", "elegant", "botanical"],
  }),
  sceneAsset({
    id: "scene.wellness.floral-wreath", sceneKind: "floral-wreath",
    category: "wellness", extraCategories: ["beauty"],
    label: "Wellness floral wreath",
    tags: ["floral", "calm", "nature", "wellness", "botanical"],
  }),
  sceneAsset({
    id: "scene.fitness.workout", sceneKind: "workout-scene",
    category: "fitness", extraCategories: ["motivation"],
    label: "Workout bench scene",
    tags: ["workout", "bench", "weights", "gym", "train", "fitness"],
  }),
  sceneAsset({
    id: "scene.motivation.script-banner", sceneKind: "script-banner",
    category: "motivation", extraCategories: ["beauty", "marketing"],
    label: "Script motivation banner",
    tags: ["motivation", "quote", "script", "typography", "banner"],
  }),
  sceneAsset({
    id: "scene.motivation.confidence-spark", sceneKind: "confidence-spark",
    category: "motivation", extraCategories: ["fitness"],
    label: "Confidence spark",
    tags: ["confidence", "bolt", "energy", "power", "spark"],
  }),
  sceneAsset({
    id: "scene.wellness.diet-plate", sceneKind: "diet-plate",
    category: "wellness", extraCategories: ["fitness", "education"],
    label: "Healthy diet plate",
    tags: ["food", "diet", "healthy", "plate", "nutrition", "eat"],
  }),
  sceneAsset({
    id: "scene.education.diet-plate", sceneKind: "diet-plate",
    category: "education", extraCategories: ["wellness"],
    label: "Nutrition education plate",
    tags: ["food", "nutrition", "learn", "education", "healthy"],
  }),

  // ── Step 43: Premium scene kinds ─────────────────────────────────────
  sceneAsset({
    id: "scene.wellness.yoga", sceneKind: "yoga-pose",
    category: "wellness", extraCategories: ["fitness", "motivation"],
    label: "Yoga pose scene",
    tags: ["yoga", "pose", "balance", "calm", "meditation", "wellness"],
  }),
  sceneAsset({
    id: "scene.fitness.yoga", sceneKind: "yoga-pose",
    category: "fitness", extraCategories: ["wellness"],
    label: "Fitness yoga pose",
    tags: ["yoga", "stretch", "fitness", "flexibility"],
  }),
  sceneAsset({
    id: "scene.productivity.coffee", sceneKind: "coffee-mug",
    category: "productivity", extraCategories: ["marketing", "wellness"],
    label: "Coffee mug with steam",
    tags: ["coffee", "morning", "mug", "steam", "fuel", "ritual"],
  }),
  sceneAsset({
    id: "scene.marketing.coffee", sceneKind: "coffee-mug",
    category: "marketing", extraCategories: ["productivity"],
    label: "Marketing café mug",
    tags: ["coffee", "cafe", "cozy", "drink"],
  }),
  sceneAsset({
    id: "scene.productivity.calendar", sceneKind: "calendar-day",
    category: "productivity", extraCategories: ["business", "education"],
    label: "Calendar day card",
    tags: ["calendar", "date", "schedule", "today", "plan", "task"],
  }),
  sceneAsset({
    id: "scene.business.calendar", sceneKind: "calendar-day",
    category: "business", extraCategories: ["productivity"],
    label: "Business deadline",
    tags: ["calendar", "deadline", "schedule", "business"],
  }),
  sceneAsset({
    id: "scene.education.brain", sceneKind: "brain-sparks",
    category: "education", extraCategories: ["productivity", "motivation"],
    label: "Brain with sparks",
    tags: ["brain", "think", "smart", "learn", "idea", "mind"],
  }),
  sceneAsset({
    id: "scene.productivity.brain", sceneKind: "brain-sparks",
    category: "productivity", extraCategories: ["education"],
    label: "Productive brain",
    tags: ["brain", "focus", "think", "mental", "cognition"],
  }),
  sceneAsset({
    id: "scene.marketing.confetti", sceneKind: "confetti-burst",
    category: "marketing", extraCategories: ["business", "motivation"],
    label: "Confetti burst celebration",
    tags: ["confetti", "celebrate", "launch", "promo", "announce", "burst"],
  }),
  sceneAsset({
    id: "scene.motivation.confetti", sceneKind: "confetti-burst",
    category: "motivation", extraCategories: ["marketing"],
    label: "Achievement confetti",
    tags: ["confetti", "win", "achieve", "celebrate", "success"],
  }),
  sceneAsset({
    id: "scene.travel.map-compass", sceneKind: "map-compass",
    category: "travel", extraCategories: ["motivation", "education"],
    label: "Map with compass",
    tags: ["map", "compass", "travel", "journey", "explore", "direction"],
  }),
  // Step 44 — breadth additions
  sceneAsset({
    id: "scene.marketing.phone-mockup", sceneKind: "phone-mockup",
    category: "marketing", extraCategories: ["business", "productivity"],
    label: "Phone chat mockup",
    tags: ["phone", "mockup", "chat", "app", "ui", "notification", "product"],
  }),
  sceneAsset({
    id: "scene.business.phone-mockup", sceneKind: "phone-mockup",
    category: "business", extraCategories: ["marketing"],
    label: "Mobile app preview",
    tags: ["phone", "app", "device", "product", "mockup"],
  }),
  sceneAsset({
    id: "scene.motivation.podium-stage", sceneKind: "podium-stage",
    category: "motivation", extraCategories: ["business", "fitness"],
    label: "Winner podium with spotlight",
    tags: ["podium", "winner", "1st", "champion", "stage", "award", "success"],
  }),
  sceneAsset({
    id: "scene.business.podium-stage", sceneKind: "podium-stage",
    category: "business", extraCategories: ["motivation"],
    label: "Leaderboard podium",
    tags: ["ranking", "leader", "podium", "1st", "award", "trophy"],
  }),
  sceneAsset({
    id: "scene.education.notebook-pen", sceneKind: "notebook-pen",
    category: "education", extraCategories: ["productivity", "business"],
    label: "Notebook with pen",
    tags: ["notebook", "pen", "write", "study", "learn", "note", "journal"],
  }),
  sceneAsset({
    id: "scene.productivity.notebook-pen", sceneKind: "notebook-pen",
    category: "productivity", extraCategories: ["education"],
    label: "Planner and pen",
    tags: ["planner", "notebook", "pen", "write", "task", "journal"],
  }),
  sceneAsset({
    id: "scene.marketing.paint-brush", sceneKind: "paint-brush",
    category: "marketing", extraCategories: ["education"],
    label: "Paintbrush with splash",
    tags: ["paint", "brush", "creative", "art", "design", "splash", "color"],
  }),
  sceneAsset({
    id: "scene.education.paint-brush", sceneKind: "paint-brush",
    category: "education", extraCategories: ["marketing"],
    label: "Art supplies",
    tags: ["paint", "art", "brush", "creative", "school"],
  }),
  sceneAsset({
    id: "scene.marketing.music-note", sceneKind: "music-note",
    category: "marketing", extraCategories: ["motivation"],
    label: "Music note burst",
    tags: ["music", "note", "sound", "audio", "song", "playlist", "celebrate"],
  }),
  sceneAsset({
    id: "scene.motivation.music-note", sceneKind: "music-note",
    category: "motivation", extraCategories: ["marketing"],
    label: "Rhythm and beat",
    tags: ["music", "beat", "rhythm", "energy", "motivation"],
  }),
];

// ── Public seed ───────────────────────────────────────────────────────────────

export const ASSETS: readonly Asset[] = Object.freeze([
  ...ICONS,
  ...ILLUSTRATIONS,
  ...PHOTOS,
  ...SHAPES,
  ...TEXTURES,
  ...STICKERS,
  ...BADGES,
  ...RIBBONS,
  ...FRAMES,
  ...DIVIDERS,
  // Step 34 additions
  ...FILLED_ICONS,
  ...MOTIVATION_ASSETS,
  // Step 35 additions
  ...REAL_WORLD_ASSETS,
  // Step 40 — inline-SVG scene illustrations (no CDN / AI needed)
  ...INLINE_SCENE_ASSETS,
]);
