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

const tile = (size: number, body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${body}</svg>`;

// Photo placeholder via Unsplash Source (stable, deterministic, no auth).
const photo = (query: string, w = 1600, h = 1600): string =>
  `https://source.unsplash.com/featured/${w}x${h}/?${encodeURIComponent(query)}`;

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
  { id: "photo.productivity.desk",   kind: "photo", category: "productivity", label: "Tidy desk",
    tags: ["desk", "workspace", "focus"], aspectRatio: 1,
    payload: { format: "url", url: photo("minimal desk workspace"), width: 1600, height: 1600 } },
  { id: "photo.wellness.spa",        kind: "photo", category: "wellness", label: "Spa stones",
    tags: ["spa", "calm", "zen"], aspectRatio: 1,
    payload: { format: "url", url: photo("spa stones water"), width: 1600, height: 1600 } },
  { id: "photo.education.library",   kind: "photo", category: "education", label: "Library shelves",
    tags: ["library", "books", "study"], aspectRatio: 1,
    payload: { format: "url", url: photo("library books shelves"), width: 1600, height: 1600 } },
  { id: "photo.business.city",       kind: "photo", category: "business", label: "City skyline",
    tags: ["city", "corporate", "skyline"], aspectRatio: 1.6,
    payload: { format: "url", url: photo("city skyline dawn"), width: 1920, height: 1200 } },
  { id: "photo.fitness.gym",         kind: "photo", category: "fitness", label: "Gym weights",
    tags: ["gym", "training"], aspectRatio: 1,
    payload: { format: "url", url: photo("gym dumbbells training"), width: 1600, height: 1600 } },
  { id: "photo.beauty.skincare",     kind: "photo", category: "beauty", label: "Skincare flatlay",
    tags: ["skincare", "beauty", "clean"], aspectRatio: 1,
    payload: { format: "url", url: photo("skincare flatlay pastel"), width: 1600, height: 1600 } },
  { id: "photo.travel.beach",        kind: "photo", category: "travel", label: "Beach horizon",
    tags: ["beach", "ocean", "vacation"], aspectRatio: 1.6,
    payload: { format: "url", url: photo("beach ocean horizon"), width: 1920, height: 1200 } },
  { id: "photo.marketing.confetti",  kind: "photo", category: "marketing", label: "Launch confetti",
    tags: ["launch", "celebration", "promo"], aspectRatio: 1.6,
    payload: { format: "url", url: photo("celebration confetti colorful"), width: 1920, height: 1200 } },
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

// ── Public seed ───────────────────────────────────────────────────────────────

export const ASSETS: readonly Asset[] = Object.freeze([
  ...ICONS,
  ...ILLUSTRATIONS,
  ...PHOTOS,
  ...SHAPES,
  ...TEXTURES,
]);
