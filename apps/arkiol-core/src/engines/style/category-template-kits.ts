// src/engines/style/category-template-kits.ts
//
// Category Template Kits — complete composition blueprints per content category.
//
// Each kit defines signature decorations, content block patterns, framing,
// divider styles, and accent treatments so templates for "productivity" look
// intentionally different from "beauty" or "fitness". The kit decorations
// replace weak theme decorations when a category is detected, producing
// outputs that feel like curated social media template packs.

import type { DecorShape } from "../render/design-themes";

// ── Kit interface ─────────────────────────────────────────────────────────────

export interface CategoryTemplateKit {
  categoryId: string;
  /** Signature decorations injected into every template of this category */
  decorations: DecorShape[];
  /** Minimum decoration kinds required — enrichment adds more if needed */
  minKinds: number;
  /** Overlay opacity override (0 = no override) */
  overlayBoost: number;
}

// Color placeholder resolved at merge time against the theme palette
const C = "currentColor";
const C2 = "currentColor2";

// ── Productivity ──────────────────────────────────────────────────────────────
// Clean grids, checklists, section dividers, structured cards — organized feel

const PRODUCTIVITY_KIT: CategoryTemplateKit = {
  categoryId: "productivity",
  minKinds: 5,
  overlayBoost: 0,
  decorations: [
    { kind: "frame_border", x: 3, y: 3, w: 94, h: 94, color: C, opacity: 0.08, strokeWidth: 1, gap: 0, rx: 6 },
    { kind: "section_divider", x: 10, y: 48, w: 80, color: C, opacity: 0.12, strokeWidth: 0.8, ornament: "dash" },
    { kind: "dots_grid", x: 82, y: 5, cols: 5, rows: 5, gap: 2.5, r: 0.6, color: C, opacity: 0.1 },
    { kind: "checklist", x: 8, y: 62, w: 40, items: ["Plan your day", "Set clear goals", "Track progress"], color: C, checkColor: C2, fontSize: 11, opacity: 0.85 },
    { kind: "accent_bar", x: 5, y: 14, w: 4, h: 12, color: C2, rx: 2 },
    { kind: "card_panel", x: 55, y: 58, w: 40, h: 34, color: C, opacity: 0.05, rx: 8, shadow: true },
    { kind: "corner_bracket", x: 3, y: 3, size: 6, color: C, opacity: 0.2, strokeWidth: 1.5, corner: "tl" },
    { kind: "corner_bracket", x: 97, y: 97, size: 6, color: C, opacity: 0.2, strokeWidth: 1.5, corner: "br" },
    { kind: "icon_symbol", x: 88, y: 8, size: 5, icon: "check", color: C2, opacity: 0.5 },
    { kind: "line", x1: 5, y1: 93, x2: 35, y2: 93, color: C, opacity: 0.1, width: 0.8 },
  ],
};

// ── Wellness ──────────────────────────────────────────────────────────────────
// Soft curves, organic shapes, gentle overlays, breathing space — calm feel

const WELLNESS_KIT: CategoryTemplateKit = {
  categoryId: "wellness",
  minKinds: 5,
  overlayBoost: 0.06,
  decorations: [
    { kind: "blob", x: -5, y: 70, size: 45, color: C, opacity: 0.06, seed: 42 },
    { kind: "blob", x: 85, y: -5, size: 35, color: C2, opacity: 0.05, seed: 77 },
    { kind: "wave", x: 0, y: 88, w: 100, amplitude: 3, frequency: 2, color: C, opacity: 0.08, strokeWidth: 1.2 },
    { kind: "flower", x: 90, y: 8, r: 7, petals: 6, color: C2, opacity: 0.15 },
    { kind: "flower", x: 8, y: 90, r: 5, petals: 5, color: C, opacity: 0.1 },
    { kind: "deco_ring", x: 50, y: 50, r: 42, color: C, opacity: 0.04, strokeWidth: 0.8 },
    { kind: "half_circle", x: 100, y: 40, r: 28, color: C2, opacity: 0.04, rotation: 270 },
    { kind: "arc_stroke", x: 10, y: 10, r: 25, startAngle: 180, endAngle: 280, color: C, opacity: 0.06, strokeWidth: 1 },
    { kind: "section_divider", x: 30, y: 50, w: 40, color: C, opacity: 0.1, strokeWidth: 0.6, ornament: "circle" },
    { kind: "squiggle", x: 75, y: 85, w: 20, color: C2, opacity: 0.08, strokeWidth: 1 },
  ],
};

// ── Education ─────────────────────────────────────────────────────────────────
// Structured cards, checklists, numbered lists, icon accents — informative feel

const EDUCATION_KIT: CategoryTemplateKit = {
  categoryId: "education",
  minKinds: 6,
  overlayBoost: 0,
  decorations: [
    { kind: "card_panel", x: 5, y: 52, w: 90, h: 42, color: C, opacity: 0.06, rx: 10, shadow: true },
    { kind: "checklist", x: 10, y: 58, w: 45, items: ["Key concept", "Practice daily", "Review notes"], color: C, checkColor: C2, fontSize: 11, opacity: 0.8 },
    { kind: "icon_symbol", x: 8, y: 8, size: 6, icon: "star", color: C2, opacity: 0.4 },
    { kind: "badge_pill", x: 70, y: 6, w: 24, h: 5, color: C2, text: "TIPS", textColor: "#fff", fontSize: 10 },
    { kind: "section_divider", x: 8, y: 50, w: 84, color: C, opacity: 0.12, strokeWidth: 1, ornament: "diamond" },
    { kind: "dots_grid", x: 85, y: 80, cols: 4, rows: 3, gap: 3, r: 0.7, color: C, opacity: 0.1 },
    { kind: "accent_bar", x: 5, y: 15, w: 3, h: 10, color: C2, rx: 1.5 },
    { kind: "corner_bracket", x: 3, y: 3, size: 5, color: C, opacity: 0.15, strokeWidth: 1.2, corner: "tl" },
    { kind: "corner_bracket", x: 97, y: 97, size: 5, color: C, opacity: 0.15, strokeWidth: 1.2, corner: "br" },
    { kind: "frame_border", x: 4, y: 4, w: 92, h: 92, color: C, opacity: 0.05, strokeWidth: 0.8, gap: 0, rx: 8 },
  ],
};

// ── Business ──────────────────────────────────────────────────────────────────
// Editorial framing, clean dividers, subtle textures, authority — professional feel

const BUSINESS_KIT: CategoryTemplateKit = {
  categoryId: "business",
  minKinds: 5,
  overlayBoost: 0.04,
  decorations: [
    { kind: "frame_border", x: 4, y: 4, w: 92, h: 92, color: C, opacity: 0.1, strokeWidth: 1.2, gap: 0, rx: 0 },
    { kind: "section_divider", x: 10, y: 46, w: 80, color: C, opacity: 0.15, strokeWidth: 1, ornament: "diamond" },
    { kind: "accent_bar", x: 5, y: 16, w: 5, h: 14, color: C2, rx: 0 },
    { kind: "card_panel", x: 58, y: 55, w: 38, h: 38, color: C, opacity: 0.05, rx: 4, shadow: true },
    { kind: "line", x1: 5, y1: 92, x2: 45, y2: 92, color: C2, opacity: 0.2, width: 1.5 },
    { kind: "dots_grid", x: 88, y: 6, cols: 3, rows: 8, gap: 2, r: 0.5, color: C, opacity: 0.08 },
    { kind: "diagonal_stripe", x: 0, y: 0, w: 100, h: 100, color: C, opacity: 0.015 },
    { kind: "corner_bracket", x: 4, y: 4, size: 7, color: C, opacity: 0.18, strokeWidth: 1.5, corner: "tl" },
    { kind: "icon_symbol", x: 90, y: 90, size: 4, icon: "arrow", color: C2, opacity: 0.3 },
    { kind: "noise_overlay", opacity: 0.02 },
  ],
};

// ── Beauty ────────────────────────────────────────────────────────────────────
// Soft shapes, floral accents, gentle gradients, elegant framing — luxurious feel

const BEAUTY_KIT: CategoryTemplateKit = {
  categoryId: "beauty",
  minKinds: 5,
  overlayBoost: 0.05,
  decorations: [
    { kind: "flower", x: 88, y: 6, r: 9, petals: 7, color: C2, opacity: 0.2 },
    { kind: "flower", x: 6, y: 88, r: 6, petals: 5, color: C, opacity: 0.12 },
    { kind: "blob", x: 80, y: 75, size: 35, color: C2, opacity: 0.05, seed: 31 },
    { kind: "deco_ring", x: 50, y: 50, r: 44, color: C, opacity: 0.04, strokeWidth: 0.6, dash: 4 },
    { kind: "arc_stroke", x: 12, y: 12, r: 28, startAngle: 150, endAngle: 260, color: C2, opacity: 0.07, strokeWidth: 0.8 },
    { kind: "half_circle", x: 0, y: 55, r: 25, color: C, opacity: 0.04, rotation: 90 },
    { kind: "squiggle", x: 65, y: 90, w: 25, color: C2, opacity: 0.1, strokeWidth: 1 },
    { kind: "section_divider", x: 25, y: 48, w: 50, color: C, opacity: 0.1, strokeWidth: 0.6, ornament: "circle" },
    { kind: "sticker_circle", x: 85, y: 85, r: 7, color: C2, text: "NEW", textColor: "#fff", fontSize: 9, rotation: -12, opacity: 0.9 },
    { kind: "wave", x: 0, y: 92, w: 100, amplitude: 2, frequency: 3, color: C, opacity: 0.06, strokeWidth: 0.8 },
  ],
};

// ── Fitness ───────────────────────────────────────────────────────────────────
// Bold shapes, high-energy accents, diagonal bands, strong framing — power feel

const FITNESS_KIT: CategoryTemplateKit = {
  categoryId: "fitness",
  minKinds: 5,
  overlayBoost: 0.1,
  decorations: [
    { kind: "diagonal_band", color: C2, opacity: 0.08, angle: -15, thickness: 18 },
    { kind: "starburst", x: 85, y: 10, r: 15, rays: 12, color: C2, opacity: 0.12, rotation: 15 },
    { kind: "triangle", x: 90, y: 85, size: 18, color: C, opacity: 0.08, rotation: 30 },
    { kind: "accent_bar", x: 3, y: 18, w: 6, h: 20, color: C2, rx: 0 },
    { kind: "icon_symbol", x: 88, y: 88, size: 6, icon: "lightning", color: C2, opacity: 0.5 },
    { kind: "frame_border", x: 2, y: 2, w: 96, h: 96, color: C, opacity: 0.12, strokeWidth: 2, gap: 0, rx: 0 },
    { kind: "dots_grid", x: 80, y: 5, cols: 3, rows: 3, gap: 4, r: 1.2, color: C2, opacity: 0.15 },
    { kind: "line", x1: 5, y1: 90, x2: 50, y2: 90, color: C2, opacity: 0.25, width: 2.5 },
    { kind: "cross", x: 8, y: 85, size: 5, thickness: 1.5, color: C2, opacity: 0.2, rotation: 15 },
    { kind: "badge_pill", x: 60, y: 5, w: 28, h: 5.5, color: C2, text: "WORKOUT", textColor: "#fff", fontSize: 10 },
  ],
};

// ── Travel ────────────────────────────────────────────────────────────────────
// Photo frames, organic curves, horizon lines, badges — adventurous feel

const TRAVEL_KIT: CategoryTemplateKit = {
  categoryId: "travel",
  minKinds: 5,
  overlayBoost: 0.08,
  decorations: [
    { kind: "photo_circle", x: 75, y: 25, r: 18, borderColor: C2, borderWidth: 2, opacity: 0.9, shadow: true, bgColor: C },
    { kind: "wave", x: 0, y: 85, w: 100, amplitude: 4, frequency: 1.5, color: C2, opacity: 0.1, strokeWidth: 1.5 },
    { kind: "sticker_circle", x: 88, y: 8, r: 8, color: C2, text: "EXPLORE", textColor: "#fff", fontSize: 8, rotation: -10, opacity: 0.85 },
    { kind: "arc_stroke", x: 50, y: 50, r: 40, startAngle: 0, endAngle: 90, color: C, opacity: 0.05, strokeWidth: 1 },
    { kind: "half_circle", x: 100, y: 70, r: 30, color: C, opacity: 0.04, rotation: 270 },
    { kind: "dots_grid", x: 5, y: 85, cols: 6, rows: 2, gap: 3, r: 0.8, color: C2, opacity: 0.1 },
    { kind: "icon_symbol", x: 8, y: 8, size: 5, icon: "arrow", color: C2, opacity: 0.35 },
    { kind: "blob", x: 90, y: 80, size: 25, color: C, opacity: 0.04, seed: 63 },
    { kind: "section_divider", x: 20, y: 50, w: 60, color: C, opacity: 0.08, strokeWidth: 0.6, ornament: "dot" },
    { kind: "corner_bracket", x: 3, y: 3, size: 6, color: C, opacity: 0.15, strokeWidth: 1.2, corner: "tl" },
  ],
};

// ── Marketing ─────────────────────────────────────────────────────────────────
// Price tags, ribbons, starburst badges, bold banners — promotional feel

const MARKETING_KIT: CategoryTemplateKit = {
  categoryId: "marketing",
  minKinds: 6,
  overlayBoost: 0,
  decorations: [
    { kind: "ribbon", x: 0, y: 5, w: 30, h: 6, color: C2, text: "SALE", textColor: "#fff", fontSize: 12, opacity: 0.95, corner: "tl" },
    { kind: "starburst", x: 82, y: 12, r: 14, rays: 16, color: C2, opacity: 0.2, rotation: 8 },
    { kind: "price_tag", x: 60, y: 65, w: 32, h: 12, color: C2, text: "$29.99", textColor: "#fff", fontSize: 16, opacity: 0.9 },
    { kind: "banner_strip", x: 0, y: 88, w: 100, h: 8, color: C2, text: "LIMITED TIME OFFER", textColor: "#fff", fontSize: 11, opacity: 0.9 },
    { kind: "diagonal_band", color: C, opacity: 0.06, angle: -20, thickness: 22 },
    { kind: "icon_symbol", x: 8, y: 8, size: 5, icon: "fire", color: C2, opacity: 0.5 },
    { kind: "dots_grid", x: 85, y: 80, cols: 3, rows: 3, gap: 3, r: 1, color: C2, opacity: 0.12 },
    { kind: "accent_bar", x: 5, y: 45, w: 15, h: 0.8, color: C2, rx: 0 },
    { kind: "sticker_circle", x: 85, y: 82, r: 9, color: C2, text: "HOT", textColor: "#fff", fontSize: 10, rotation: 12, opacity: 0.85, borderColor: "#fff", borderWidth: 2 },
    { kind: "frame_border", x: 2, y: 2, w: 96, h: 96, color: C, opacity: 0.08, strokeWidth: 1.5, gap: 0, rx: 4 },
  ],
};

// ── Motivation ────────────────────────────────────────────────────────────────
// Dramatic framing, glow effects, bold dividers, icon accents — empowering feel

const MOTIVATION_KIT: CategoryTemplateKit = {
  categoryId: "motivation",
  minKinds: 5,
  overlayBoost: 0.12,
  decorations: [
    { kind: "frame_border", x: 5, y: 5, w: 90, h: 90, color: C, opacity: 0.12, strokeWidth: 1.5, gap: 3, rx: 0 },
    { kind: "glow_circle", x: 50, y: 40, r: 35, color: C2, opacity: 0.06 },
    { kind: "section_divider", x: 15, y: 60, w: 70, color: C, opacity: 0.2, strokeWidth: 1.2, ornament: "star" },
    { kind: "icon_symbol", x: 50, y: 8, size: 6, icon: "sparkle", color: C2, opacity: 0.4 },
    { kind: "accent_bar", x: 35, y: 55, w: 30, h: 0.5, color: C2, rx: 0 },
    { kind: "corner_bracket", x: 5, y: 5, size: 8, color: C, opacity: 0.2, strokeWidth: 2, corner: "tl" },
    { kind: "corner_bracket", x: 95, y: 5, size: 8, color: C, opacity: 0.2, strokeWidth: 2, corner: "tr" },
    { kind: "corner_bracket", x: 5, y: 95, size: 8, color: C, opacity: 0.2, strokeWidth: 2, corner: "bl" },
    { kind: "corner_bracket", x: 95, y: 95, size: 8, color: C, opacity: 0.2, strokeWidth: 2, corner: "br" },
    { kind: "diagonal_stripe", x: 0, y: 0, w: 100, h: 100, color: C, opacity: 0.02 },
    { kind: "noise_overlay", opacity: 0.03 },
  ],
};

// ── Food ──────────────────────────────────────────────────────────────────────
// Warm textures, organic frames, sticker badges, recipe cards — appetizing feel

const FOOD_KIT: CategoryTemplateKit = {
  categoryId: "food",
  minKinds: 5,
  overlayBoost: 0.04,
  decorations: [
    { kind: "photo_circle", x: 50, y: 30, r: 22, borderColor: C2, borderWidth: 2.5, opacity: 0.9, shadow: true, bgColor: C },
    { kind: "texture_fill", x: 0, y: 0, w: 100, h: 100, pattern: "crosses", color: C, opacity: 0.03, scale: 1.2 },
    { kind: "sticker_circle", x: 82, y: 10, r: 8, color: C2, text: "YUM", textColor: "#fff", fontSize: 10, rotation: -8, opacity: 0.85 },
    { kind: "ribbon", x: 0, y: 6, w: 28, h: 5.5, color: C2, text: "RECIPE", textColor: "#fff", fontSize: 10, opacity: 0.9, corner: "tl" },
    { kind: "wave", x: 0, y: 55, w: 100, amplitude: 2.5, frequency: 2.5, color: C2, opacity: 0.06, strokeWidth: 1 },
    { kind: "card_panel", x: 8, y: 58, w: 84, h: 36, color: C, opacity: 0.06, rx: 12, shadow: true },
    { kind: "section_divider", x: 15, y: 56, w: 70, color: C, opacity: 0.1, strokeWidth: 0.8, ornament: "dot" },
    { kind: "dots_grid", x: 88, y: 88, cols: 3, rows: 3, gap: 2.5, r: 0.8, color: C2, opacity: 0.1 },
    { kind: "blob", x: 0, y: 80, size: 30, color: C, opacity: 0.04, seed: 55 },
    { kind: "icon_symbol", x: 8, y: 90, size: 4, icon: "heart", color: C2, opacity: 0.3 },
  ],
};

// ── Fashion ───────────────────────────────────────────────────────────────────
// Editorial borders, minimal accents, strong typography framing — high-fashion feel

const FASHION_KIT: CategoryTemplateKit = {
  categoryId: "fashion",
  minKinds: 4,
  overlayBoost: 0.06,
  decorations: [
    { kind: "frame_border", x: 4, y: 4, w: 92, h: 92, color: C, opacity: 0.15, strokeWidth: 1, gap: 2, rx: 0 },
    { kind: "line", x1: 10, y1: 50, x2: 90, y2: 50, color: C, opacity: 0.12, width: 0.5 },
    { kind: "accent_bar", x: 5, y: 18, w: 3, h: 16, color: C2, rx: 0 },
    { kind: "corner_bracket", x: 6, y: 6, size: 10, color: C, opacity: 0.25, strokeWidth: 1, corner: "tl" },
    { kind: "corner_bracket", x: 94, y: 94, size: 10, color: C, opacity: 0.25, strokeWidth: 1, corner: "br" },
    { kind: "diagonal_stripe", x: 0, y: 0, w: 100, h: 100, color: C, opacity: 0.018 },
    { kind: "badge_pill", x: 65, y: 6, w: 26, h: 4.5, color: C2, text: "NEW COLLECTION", textColor: "#fff", fontSize: 8 },
    { kind: "section_divider", x: 30, y: 90, w: 40, color: C2, opacity: 0.15, strokeWidth: 0.6, ornament: "dash" },
    { kind: "noise_overlay", opacity: 0.02 },
  ],
};

// ── Tech ──────────────────────────────────────────────────────────────────────
// Grid patterns, circuit-like lines, glow accents, clean cards — futuristic feel

const TECH_KIT: CategoryTemplateKit = {
  categoryId: "tech",
  minKinds: 5,
  overlayBoost: 0.04,
  decorations: [
    { kind: "dots_grid", x: 5, y: 5, cols: 8, rows: 8, gap: 2.5, r: 0.4, color: C, opacity: 0.06 },
    { kind: "glow_circle", x: 50, y: 35, r: 30, color: C2, opacity: 0.05 },
    { kind: "card_panel", x: 55, y: 55, w: 40, h: 38, color: C, opacity: 0.06, rx: 8, shadow: true },
    { kind: "line", x1: 5, y1: 48, x2: 48, y2: 48, color: C, opacity: 0.1, width: 0.5, dash: 3 },
    { kind: "line", x1: 52, y1: 48, x2: 95, y2: 48, color: C, opacity: 0.1, width: 0.5, dash: 3 },
    { kind: "corner_bracket", x: 3, y: 3, size: 5, color: C2, opacity: 0.2, strokeWidth: 1.5, corner: "tl" },
    { kind: "corner_bracket", x: 97, y: 97, size: 5, color: C2, opacity: 0.2, strokeWidth: 1.5, corner: "br" },
    { kind: "icon_symbol", x: 90, y: 8, size: 5, icon: "sparkle", color: C2, opacity: 0.35 },
    { kind: "deco_ring", x: 12, y: 80, r: 10, color: C, opacity: 0.06, strokeWidth: 1, dash: 2 },
    { kind: "accent_bar", x: 5, y: 92, w: 20, h: 0.5, color: C2, rx: 0 },
    { kind: "noise_overlay", opacity: 0.025 },
  ],
};

// ── Real Estate ───────────────────────────────────────────────────────────────
// Photo frames, clean borders, subtle textures, property cards — trust feel

const REALESTATE_KIT: CategoryTemplateKit = {
  categoryId: "realestate",
  minKinds: 5,
  overlayBoost: 0.03,
  decorations: [
    { kind: "photo_circle", x: 50, y: 28, r: 20, borderColor: C2, borderWidth: 2, opacity: 0.9, shadow: true, bgColor: C },
    { kind: "frame_border", x: 5, y: 5, w: 90, h: 90, color: C, opacity: 0.08, strokeWidth: 1, gap: 0, rx: 4 },
    { kind: "card_panel", x: 8, y: 55, w: 84, h: 38, color: C, opacity: 0.05, rx: 6, shadow: true },
    { kind: "section_divider", x: 15, y: 53, w: 70, color: C, opacity: 0.1, strokeWidth: 0.8, ornament: "diamond" },
    { kind: "accent_bar", x: 5, y: 16, w: 4, h: 10, color: C2, rx: 1 },
    { kind: "dots_grid", x: 88, y: 85, cols: 3, rows: 3, gap: 3, r: 0.6, color: C, opacity: 0.08 },
    { kind: "icon_symbol", x: 90, y: 8, size: 4.5, icon: "star", color: C2, opacity: 0.3 },
    { kind: "line", x1: 8, y1: 92, x2: 40, y2: 92, color: C2, opacity: 0.15, width: 1 },
    { kind: "noise_overlay", opacity: 0.015 },
  ],
};

// ── Kit registry ──────────────────────────────────────────────────────────────

const KIT_MAP = new Map<string, CategoryTemplateKit>([
  ["productivity", PRODUCTIVITY_KIT],
  ["wellness",     WELLNESS_KIT],
  ["education",    EDUCATION_KIT],
  ["business",     BUSINESS_KIT],
  ["beauty",       BEAUTY_KIT],
  ["fitness",      FITNESS_KIT],
  ["travel",       TRAVEL_KIT],
  ["marketing",    MARKETING_KIT],
  ["motivation",   MOTIVATION_KIT],
  ["food",         FOOD_KIT],
  ["fashion",      FASHION_KIT],
  ["tech",         TECH_KIT],
  ["realestate",   REALESTATE_KIT],
]);

// ── Public API ────────────────────────────────────────────────────────────────

export function getCategoryKit(categoryId: string): CategoryTemplateKit | null {
  return KIT_MAP.get(categoryId) ?? null;
}

export function getAllCategoryKits(): CategoryTemplateKit[] {
  return [...KIT_MAP.values()];
}

/**
 * Merge kit decorations into a theme's decoration array.
 * Kit decorations replace weak theme decorations when the kit provides
 * richer alternatives. Color placeholders are resolved against the theme palette.
 */
export function mergeKitDecorations(
  themeDecorations: DecorShape[],
  kit: CategoryTemplateKit,
  accentColor: string,
  secondaryColor: string,
): DecorShape[] {
  const kitDecos = kit.decorations.map(d => resolveKitColors(d, accentColor, secondaryColor));

  // Keep theme decorations that don't conflict with kit decoration kinds
  const kitKinds = new Set(kitDecos.map(d => d.kind));
  const kept = themeDecorations.filter(d => !kitKinds.has(d.kind));

  // Kit decorations take precedence, then kept theme decorations fill gaps
  return [...kitDecos, ...kept];
}

function resolveKitColors(shape: DecorShape, primary: string, secondary: string): DecorShape {
  const s = JSON.stringify(shape);
  const resolved = s
    .replace(/"currentColor2"/g, JSON.stringify(secondary))
    .replace(/"currentColor"/g, JSON.stringify(primary));
  return JSON.parse(resolved) as DecorShape;
}
