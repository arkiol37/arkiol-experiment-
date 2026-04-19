// src/engines/layout/families.ts
// Layout Family Registry — 9 Arkiol categories with canonical zones,
// authority rules, variations, and asset constraints.

import { createHash } from "crypto";

export type ZoneId =
  | "headline" | "subhead" | "body" | "cta" | "logo"
  | "image" | "background" | "badge" | "price" | "legal"
  | "tagline" | "name" | "title" | "company" | "contact"
  | "section_header" | "bullet_1" | "bullet_2" | "bullet_3"
  | "accent";

export interface ZoneConstraints {
  aspectRatio?: number;
  maxChars?:    number;
  fontWeight?:  number[];
  faceMode?:    "auto" | "product" | "none";  // YouTube thumbnail face/product
}

export interface Zone {
  id:           ZoneId;
  x:            number;   // % from left
  y:            number;   // % from top
  width:        number;   // % of canvas width
  height:       number;   // % of canvas height
  minFontSize?: number;
  maxFontSize?: number;
  required:     boolean;
  zIndex:       number;
  alignH:       "left" | "center" | "right";
  alignV:       "top"  | "middle" | "bottom";
  constraints?: ZoneConstraints;
  locked?:      boolean;  // cannot be moved by editor (authority zones)
}

export interface LayoutVariation {
  id:        string;
  name:      string;
  overrides: Partial<Record<ZoneId, Partial<Zone>>>;
}

export interface LayoutFamily {
  id:          string;
  name:        string;
  category:    ArkiolLayoutCategory;
  formats:     string[];
  zones:       Zone[];
  variations:  LayoutVariation[];
  assetConstraints?: {
    maxImageAreas: number;
    requiresPhoto?: boolean;
    preferFace?:    boolean;
  };
}

export type ArkiolLayoutCategory =
  | "instagram" | "story" | "thumbnail"
  | "flyer" | "poster" | "slide"
  | "card" | "document" | "logo";

// ═══════════════════════════════════════════════════════════════════════════════
// 1. INSTAGRAM POST  (1080×1080)
// ═══════════════════════════════════════════════════════════════════════════════
const IG_POST: LayoutFamily = {
  id: "ig_post", name: "Instagram Post", category: "instagram",
  formats: ["instagram_post"],
  assetConstraints: { maxImageAreas: 1 },
  zones: [
    { id: "background", x: 0,  y: 0,  width: 100, height: 100, required: true,  zIndex: 0, alignH: "center", alignV: "middle", locked: true },
    { id: "image",      x: 0,  y: 0,  width: 100, height: 55,  required: false, zIndex: 1, alignH: "center", alignV: "top",    constraints: { aspectRatio: 1 } },
    { id: "headline",   x: 5,  y: 58, width: 90,  height: 18,  required: true,  zIndex: 2, alignH: "left",   alignV: "top",    minFontSize: 28, maxFontSize: 56, constraints: { maxChars: 60, fontWeight: [700, 800] } },
    { id: "subhead",    x: 5,  y: 78, width: 90,  height: 9,   required: false, zIndex: 2, alignH: "left",   alignV: "top",    minFontSize: 14, maxFontSize: 22, constraints: { maxChars: 100 } },
    { id: "cta",        x: 5,  y: 88, width: 42,  height: 8,   required: false, zIndex: 3, alignH: "center", alignV: "middle", minFontSize: 12, maxFontSize: 16 },
    { id: "logo",       x: 79, y: 88, width: 16,  height: 7,   required: false, zIndex: 4, alignH: "right",  alignV: "bottom" },
  ],
  variations: [
    { id: "v1_split",        name: "Image Top",       overrides: {} },
    { id: "v2_text_heavy",   name: "Text Dominant",   overrides: { image: { height: 35 }, headline: { y: 38, maxFontSize: 64 } } },
    { id: "v3_full_bleed",   name: "Full Bleed",      overrides: { image: { height: 100, zIndex: 0 }, headline: { y: 58, zIndex: 3 }, subhead: { zIndex: 3 }, cta: { zIndex: 4 } } },
    { id: "v4_centered",     name: "Centered Overlay",overrides: { headline: { x: 5, y: 40, width: 90, alignH: "center" }, subhead: { alignH: "center" }, cta: { x: 29 } } },
    { id: "v5_bottom_third", name: "Bottom Third",    overrides: { headline: { y: 72, height: 14, maxFontSize: 36 }, image: { height: 70 } } },
    { id: "v6_left_half",    name: "Left Half Image", overrides: { image: { x: 0, y: 0, width: 50, height: 100 }, headline: { x: 54, y: 12, width: 42, height: 30 }, subhead: { x: 54, width: 42, y: 46 }, cta: { x: 54, width: 42 } } },
    { id: "v7_right_half",   name: "Right Half Image",overrides: { image: { x: 50, y: 0, width: 50, height: 100 }, headline: { x: 5, y: 12, width: 42, height: 30 }, subhead: { x: 5, width: 42, y: 46 }, cta: { x: 5, width: 42 } } },
    { id: "v8_no_image",     name: "Text Only",       overrides: { image: { height: 0 }, headline: { y: 22, height: 30, maxFontSize: 96 }, subhead: { y: 56 }, cta: { y: 80 } } },
    { id: "v9_corner_badge", name: "Corner Badge",    overrides: { image: { height: 60 }, headline: { y: 64, height: 14 }, subhead: { y: 80 }, cta: { x: 4, y: 90, width: 34 }, logo: { x: 70, y: 4, width: 14, height: 6 } } },
    { id: "v10_asym_stack",  name: "Asymmetric Stack",overrides: { image: { x: 5, y: 5, width: 55, height: 55 }, headline: { x: 5, y: 63, width: 70 }, subhead: { x: 5, y: 82, width: 70 }, cta: { x: 62, y: 10, width: 33, height: 14 } } },
  ],
};

// ═══════════════════════════════════════════════════════════════════════════════
// 2. INSTAGRAM STORY  (1080×1920)
// ═══════════════════════════════════════════════════════════════════════════════
const IG_STORY: LayoutFamily = {
  id: "ig_story", name: "Instagram Story", category: "story",
  formats: ["instagram_story"],
  assetConstraints: { maxImageAreas: 1 },
  zones: [
    { id: "background", x: 0,  y: 0,  width: 100, height: 100, required: true,  zIndex: 0, alignH: "center", alignV: "middle", locked: true },
    { id: "image",      x: 0,  y: 10, width: 100, height: 55,  required: false, zIndex: 1, alignH: "center", alignV: "middle", constraints: { aspectRatio: 0.56 } },
    { id: "headline",   x: 5,  y: 68, width: 90,  height: 14,  required: true,  zIndex: 2, alignH: "center", alignV: "top",    minFontSize: 40, maxFontSize: 80, constraints: { maxChars: 50, fontWeight: [700, 800] } },
    { id: "subhead",    x: 5,  y: 84, width: 90,  height: 6,   required: false, zIndex: 2, alignH: "center", alignV: "top",    minFontSize: 18, maxFontSize: 28, constraints: { maxChars: 80 } },
    { id: "cta",        x: 20, y: 91, width: 60,  height: 5,   required: false, zIndex: 3, alignH: "center", alignV: "middle" },
    { id: "logo",       x: 5,  y: 3,  width: 14,  height: 5,   required: false, zIndex: 4, alignH: "left",   alignV: "top" },
    { id: "badge",      x: 75, y: 3,  width: 22,  height: 5,   required: false, zIndex: 4, alignH: "center", alignV: "middle", constraints: { maxChars: 20 } },
  ],
  variations: [
    { id: "v1_default",    name: "Center Stack",   overrides: {} },
    { id: "v2_full_bleed", name: "Full Bleed",     overrides: { image: { y: 0, height: 100, zIndex: 0 }, headline: { y: 65, zIndex: 3 }, subhead: { zIndex: 3 } } },
    { id: "v3_top_text",   name: "Top Text",       overrides: { headline: { y: 8, height: 16 }, image: { y: 28, height: 55 } } },
    { id: "v4_split",      name: "50/50 Split",    overrides: { image: { y: 0, height: 50 }, headline: { y: 52 } } },
    { id: "v5_mid_band",   name: "Image Mid-Band", overrides: { headline: { y: 8, height: 18 }, image: { y: 30, height: 40 }, subhead: { y: 74, height: 8 }, cta: { y: 86 } } },
    { id: "v6_text_only",  name: "Text Only",      overrides: { image: { height: 0 }, headline: { y: 30, height: 28, maxFontSize: 140 }, subhead: { y: 62, height: 10 }, cta: { y: 80 } } },
    { id: "v7_diag_overlay",name: "Diagonal Overlay",overrides: { image: { y: 0, height: 100, zIndex: 0 }, headline: { y: 12, height: 20, zIndex: 3, alignH: "left", x: 5, width: 70 }, subhead: { y: 34, x: 5, width: 70, zIndex: 3, alignH: "left" }, cta: { zIndex: 4 } } },
    { id: "v8_left_rail",  name: "Left Rail Logo", overrides: { logo: { x: 3, y: 40, width: 8, height: 20 }, headline: { x: 16, y: 55, width: 79, alignH: "left" }, subhead: { x: 16, width: 79, alignH: "left" }, image: { x: 14, y: 8, width: 84, height: 42 } } },
  ],
};

// ═══════════════════════════════════════════════════════════════════════════════
// 3. YOUTUBE THUMBNAIL  (1280×720) — AUTO face/product mode
// ═══════════════════════════════════════════════════════════════════════════════
const YT_THUMB: LayoutFamily = {
  id: "yt_thumb", name: "YouTube Thumbnail", category: "thumbnail",
  formats: ["youtube_thumbnail"],
  assetConstraints: { maxImageAreas: 1, requiresPhoto: true, preferFace: true },
  zones: [
    { id: "background", x: 0,  y: 0,  width: 100, height: 100, required: true,  zIndex: 0, alignH: "center", alignV: "middle", locked: true },
    // image zone: left half — face or product fills this
    { id: "image",      x: 0,  y: 0,  width: 55,  height: 100, required: true,  zIndex: 1, alignH: "center", alignV: "middle", constraints: { aspectRatio: 0.72, faceMode: "auto" } },
    { id: "headline",   x: 56, y: 8,  width: 40,  height: 55,  required: true,  zIndex: 2, alignH: "left",   alignV: "top",    minFontSize: 48, maxFontSize: 100, constraints: { maxChars: 30, fontWeight: [800] } },
    { id: "badge",      x: 56, y: 68, width: 40,  height: 20,  required: false, zIndex: 3, alignH: "left",   alignV: "middle", minFontSize: 20, maxFontSize: 36, constraints: { maxChars: 20 } },
    { id: "logo",       x: 3,  y: 3,  width: 14,  height: 14,  required: false, zIndex: 4, alignH: "left",   alignV: "top" },
  ],
  variations: [
    { id: "v1_face_left",    name: "Face Left / Text Right",  overrides: {} },
    { id: "v2_face_right",   name: "Face Right / Text Left",  overrides: { image: { x: 45, width: 55 }, headline: { x: 3, width: 40 }, badge: { x: 3 } } },
    { id: "v3_product_hero", name: "Product Hero (no face)",  overrides: { image: { x: 0, width: 100, constraints: { faceMode: "product" } }, headline: { x: 5, y: 60, width: 90, alignH: "center", zIndex: 3 }, badge: { x: 5, width: 90, alignH: "center", zIndex: 3 } } },
    { id: "v4_centered",     name: "Centered (minimal)",      overrides: { image: { width: 100 }, headline: { x: 5, y: 28, width: 90, alignH: "center", zIndex: 3 }, badge: { x: 5, width: 90, alignH: "center", zIndex: 3 } } },
    { id: "v5_bottom_band",  name: "Bottom Headline Band",    overrides: { image: { x: 0, width: 100, height: 62 }, headline: { x: 4, y: 65, width: 92, height: 24, alignH: "left" }, badge: { x: 4, y: 90, width: 32, height: 8 } } },
    { id: "v6_top_text",     name: "Top Text Strip",          overrides: { image: { x: 0, y: 32, width: 100, height: 68 }, headline: { x: 4, y: 4, width: 92, height: 22 }, badge: { x: 4, y: 26, width: 32, height: 5 } } },
    { id: "v7_text_left_narrow", name: "Narrow Text Left",    overrides: { image: { x: 38, width: 62 }, headline: { x: 3, width: 32 }, badge: { x: 3 } } },
    { id: "v8_corner_label", name: "Corner Label",            overrides: { image: { x: 0, width: 100 }, headline: { x: 40, y: 8, width: 56, height: 28, zIndex: 3 }, badge: { x: 40, y: 38, width: 56, height: 12, zIndex: 3 } } },
  ],
};

// ═══════════════════════════════════════════════════════════════════════════════
// 4. FLYER  (2550×3300 — US Letter portrait)
// ═══════════════════════════════════════════════════════════════════════════════
const FLYER: LayoutFamily = {
  id: "flyer", name: "Flyer", category: "flyer",
  formats: ["flyer"],
  assetConstraints: { maxImageAreas: 1 },
  zones: [
    { id: "background",    x: 0,  y: 0,  width: 100, height: 100, required: true,  zIndex: 0, alignH: "center", alignV: "middle", locked: true },
    { id: "image",         x: 0,  y: 0,  width: 100, height: 45,  required: false, zIndex: 1, alignH: "center", alignV: "top" },
    { id: "headline",      x: 5,  y: 47, width: 90,  height: 12,  required: true,  zIndex: 2, alignH: "center", alignV: "top",    minFontSize: 48, maxFontSize: 120, constraints: { maxChars: 40, fontWeight: [700, 800] } },
    { id: "subhead",       x: 5,  y: 61, width: 90,  height: 8,   required: false, zIndex: 2, alignH: "center", alignV: "top",    minFontSize: 24, maxFontSize: 48, constraints: { maxChars: 80 } },
    { id: "body",          x: 8,  y: 70, width: 84,  height: 14,  required: false, zIndex: 2, alignH: "center", alignV: "top",    minFontSize: 18, maxFontSize: 32, constraints: { maxChars: 200 } },
    { id: "cta",           x: 20, y: 86, width: 60,  height: 6,   required: false, zIndex: 3, alignH: "center", alignV: "middle", minFontSize: 22, maxFontSize: 40, constraints: { maxChars: 30 } },
    { id: "logo",          x: 40, y: 93, width: 20,  height: 5,   required: false, zIndex: 4, alignH: "center", alignV: "middle" },
    { id: "legal",         x: 5,  y: 96, width: 90,  height: 3,   required: false, zIndex: 2, alignH: "center", alignV: "top",    minFontSize: 10, maxFontSize: 16, constraints: { maxChars: 150 } },
  ],
  variations: [
    { id: "v1_classic",    name: "Classic Event",   overrides: {} },
    { id: "v2_no_image",   name: "Text Dominant",   overrides: { image: { height: 0 }, headline: { y: 15, height: 20, maxFontSize: 160 }, subhead: { y: 37 }, body: { y: 48 }, cta: { y: 76 } } },
    { id: "v3_split_col",  name: "Two Column",      overrides: { image: { width: 48, height: 100 }, headline: { x: 52, y: 8, width: 44 }, subhead: { x: 52, width: 44 }, body: { x: 52, width: 44 }, cta: { x: 52, width: 44 } } },
    { id: "v4_full_bleed", name: "Full Bleed Image",overrides: { image: { height: 100 }, headline: { y: 55, zIndex: 3 }, subhead: { zIndex: 3 }, body: { zIndex: 3 }, cta: { zIndex: 4 } } },
    { id: "v5_header_band",name: "Header Band",     overrides: { headline: { y: 6, height: 14 }, subhead: { y: 22 }, image: { y: 32, height: 35 }, body: { y: 70, height: 14 }, cta: { y: 88 } } },
    { id: "v6_reverse_col",name: "Reverse Two-Col", overrides: { image: { x: 52, width: 48, height: 100 }, headline: { x: 4, y: 8, width: 44 }, subhead: { x: 4, width: 44 }, body: { x: 4, width: 44 }, cta: { x: 4, width: 44 } } },
    { id: "v7_corner_img", name: "Corner Image",    overrides: { image: { x: 60, y: 4, width: 36, height: 30 }, headline: { x: 5, y: 6, width: 52, height: 18 }, subhead: { x: 5, y: 26, width: 52 }, body: { y: 40, height: 34 }, cta: { y: 80 } } },
    { id: "v8_poster_grid",name: "Poster Grid",     overrides: { image: { y: 0, height: 35 }, headline: { y: 38, height: 16, maxFontSize: 140 }, subhead: { y: 56, height: 7 }, body: { y: 66, height: 12 }, cta: { y: 80 }, legal: { y: 95 } } },
    { id: "v9_footer_cta", name: "Footer CTA Bar",  overrides: { image: { height: 52 }, headline: { y: 55, height: 12 }, subhead: { y: 68 }, body: { y: 76 }, cta: { x: 0, y: 90, width: 100, height: 9, maxFontSize: 48 } } },
  ],
};

// ═══════════════════════════════════════════════════════════════════════════════
// 5. POSTER  (2480×3508 — A4)
// ═══════════════════════════════════════════════════════════════════════════════
const POSTER: LayoutFamily = {
  id: "poster", name: "Poster", category: "poster",
  formats: ["poster"],
  assetConstraints: { maxImageAreas: 1 },
  zones: [
    { id: "background", x: 0,  y: 0,  width: 100, height: 100, required: true,  zIndex: 0, alignH: "center", alignV: "middle", locked: true },
    { id: "image",      x: 0,  y: 0,  width: 100, height: 50,  required: false, zIndex: 1, alignH: "center", alignV: "top" },
    { id: "headline",   x: 5,  y: 52, width: 90,  height: 14,  required: true,  zIndex: 2, alignH: "center", alignV: "top",    minFontSize: 60, maxFontSize: 160, constraints: { maxChars: 35, fontWeight: [700, 800, 900] } },
    { id: "subhead",    x: 5,  y: 68, width: 90,  height: 8,   required: false, zIndex: 2, alignH: "center", alignV: "top",    minFontSize: 28, maxFontSize: 56, constraints: { maxChars: 70 } },
    { id: "tagline",    x: 5,  y: 78, width: 90,  height: 6,   required: false, zIndex: 2, alignH: "center", alignV: "top",    minFontSize: 18, maxFontSize: 32, constraints: { maxChars: 100 } },
    { id: "cta",        x: 25, y: 86, width: 50,  height: 5,   required: false, zIndex: 3, alignH: "center", alignV: "middle", minFontSize: 22, maxFontSize: 40 },
    { id: "logo",       x: 40, y: 93, width: 20,  height: 4,   required: false, zIndex: 4, alignH: "center", alignV: "middle" },
  ],
  variations: [
    { id: "v1_classic",   name: "Classic",    overrides: {} },
    { id: "v2_minimal",   name: "Minimal",    overrides: { image: { height: 0 }, headline: { y: 20, height: 25, maxFontSize: 200 }, subhead: { y: 48 }, tagline: { y: 60 } } },
    { id: "v3_full_art",  name: "Art Poster", overrides: { image: { height: 100 }, headline: { y: 65, zIndex: 3, minFontSize: 80, maxFontSize: 200 }, subhead: { zIndex: 3 } } },
    { id: "v4_top_bar",   name: "Top Headline Bar", overrides: { headline: { y: 4, height: 16 }, image: { y: 22, height: 50 }, subhead: { y: 74 }, tagline: { y: 84 }, cta: { y: 92 } } },
    { id: "v5_split_half",name: "Half Split",       overrides: { image: { y: 0, height: 50 }, headline: { y: 54, height: 18, maxFontSize: 180 }, subhead: { y: 74 }, tagline: { y: 84 } } },
    { id: "v6_footer_band",name: "Footer Band",     overrides: { image: { y: 0, height: 62 }, headline: { y: 65, height: 12 }, subhead: { y: 79 }, tagline: { y: 88 }, cta: { x: 0, y: 94, width: 100, height: 6 } } },
    { id: "v7_off_center",name: "Off-Center Focus", overrides: { image: { x: 0, y: 0, width: 62, height: 100 }, headline: { x: 64, y: 14, width: 32, height: 40, alignH: "left" }, subhead: { x: 64, y: 58, width: 32, alignH: "left" }, tagline: { x: 64, y: 72, width: 32, alignH: "left" }, cta: { x: 64, y: 86, width: 32 } } },
  ],
};

// ═══════════════════════════════════════════════════════════════════════════════
// 6. PRESENTATION SLIDE  (1920×1080)
// ═══════════════════════════════════════════════════════════════════════════════
const PRES_SLIDE: LayoutFamily = {
  id: "pres_slide", name: "Presentation Slide", category: "slide",
  formats: ["presentation_slide"],
  assetConstraints: { maxImageAreas: 1 },
  zones: [
    { id: "background",     x: 0,  y: 0,  width: 100, height: 100, required: true,  zIndex: 0, alignH: "center", alignV: "middle", locked: true },
    { id: "accent",         x: 0,  y: 0,  width: 2,   height: 100, required: false, zIndex: 1, alignH: "left",   alignV: "top",    locked: true },
    { id: "section_header", x: 5,  y: 5,  width: 60,  height: 8,   required: false, zIndex: 2, alignH: "left",   alignV: "middle", minFontSize: 14, maxFontSize: 20, constraints: { maxChars: 40 } },
    { id: "headline",       x: 5,  y: 18, width: 90,  height: 22,  required: true,  zIndex: 2, alignH: "left",   alignV: "top",    minFontSize: 36, maxFontSize: 80, constraints: { maxChars: 55, fontWeight: [700, 800] } },
    { id: "subhead",        x: 5,  y: 42, width: 55,  height: 10,  required: false, zIndex: 2, alignH: "left",   alignV: "top",    minFontSize: 18, maxFontSize: 28, constraints: { maxChars: 100 } },
    { id: "body",           x: 5,  y: 55, width: 55,  height: 28,  required: false, zIndex: 2, alignH: "left",   alignV: "top",    minFontSize: 14, maxFontSize: 20, constraints: { maxChars: 250 } },
    { id: "image",          x: 62, y: 10, width: 34,  height: 80,  required: false, zIndex: 1, alignH: "center", alignV: "middle" },
    { id: "logo",           x: 88, y: 90, width: 10,  height: 8,   required: false, zIndex: 4, alignH: "right",  alignV: "bottom" },
  ],
  variations: [
    { id: "v1_title_body",   name: "Title + Body",    overrides: {} },
    { id: "v2_big_title",    name: "Big Title",       overrides: { headline: { y: 30, height: 40, maxFontSize: 120 }, subhead: { y: 72 }, body: { height: 0 } } },
    { id: "v3_two_col",      name: "Two Column",      overrides: { headline: { y: 5, height: 15 }, body: { x: 52, y: 22, width: 44, height: 65 }, image: { x: 5, y: 22, width: 44, height: 65 } } },
    { id: "v4_full_bleed",   name: "Full Bleed Image",overrides: { image: { x: 0, y: 0, width: 100, height: 100, zIndex: 0 }, headline: { zIndex: 3 }, subhead: { zIndex: 3 }, body: { zIndex: 3 } } },
    { id: "v5_image_left",   name: "Image Left",      overrides: { image: { x: 5, y: 22, width: 44, height: 65 }, headline: { x: 52, y: 22, width: 44, height: 18 }, subhead: { x: 52, y: 44, width: 44 }, body: { x: 52, y: 58, width: 44, height: 30 } } },
    { id: "v6_section_title",name: "Section Title",   overrides: { section_header: { x: 5, y: 4, width: 90, height: 5 }, headline: { y: 12, height: 16 }, subhead: { y: 32, width: 90 }, body: { y: 48, width: 90, height: 38 }, image: { height: 0 } } },
    { id: "v7_side_quote",   name: "Side Quote",      overrides: { headline: { x: 5, y: 28, width: 55, height: 44, maxFontSize: 88 }, subhead: { x: 5, y: 78, width: 55 }, body: { height: 0 }, image: { x: 64, y: 12, width: 32, height: 76 } } },
    { id: "v8_centered_stat",name: "Centered Stat",   overrides: { headline: { x: 5, y: 22, width: 90, height: 40, maxFontSize: 200, alignH: "center" }, subhead: { x: 5, y: 66, width: 90, alignH: "center" }, body: { x: 5, y: 78, width: 90, height: 10, alignH: "center" }, image: { height: 0 } } },
  ],
};

// ═══════════════════════════════════════════════════════════════════════════════
// 7. BUSINESS CARD  (1050×600 — 3.5×2in @ 300dpi)
// ═══════════════════════════════════════════════════════════════════════════════
const BIZ_CARD: LayoutFamily = {
  id: "biz_card", name: "Business Card", category: "card",
  formats: ["business_card"],
  assetConstraints: { maxImageAreas: 1 },
  zones: [
    { id: "background", x: 0,  y: 0,  width: 100, height: 100, required: true,  zIndex: 0, alignH: "center", alignV: "middle", locked: true },
    { id: "logo",       x: 5,  y: 10, width: 22,  height: 40,  required: false, zIndex: 2, alignH: "center", alignV: "middle" },
    { id: "name",       x: 32, y: 10, width: 63,  height: 25,  required: true,  zIndex: 2, alignH: "left",   alignV: "middle", minFontSize: 28, maxFontSize: 52, constraints: { maxChars: 35, fontWeight: [700] } },
    { id: "title",      x: 32, y: 38, width: 63,  height: 16,  required: true,  zIndex: 2, alignH: "left",   alignV: "middle", minFontSize: 14, maxFontSize: 24, constraints: { maxChars: 50 } },
    { id: "company",    x: 5,  y: 58, width: 90,  height: 12,  required: false, zIndex: 2, alignH: "left",   alignV: "middle", minFontSize: 12, maxFontSize: 20, constraints: { maxChars: 40 } },
    { id: "contact",    x: 5,  y: 74, width: 90,  height: 20,  required: true,  zIndex: 2, alignH: "left",   alignV: "top",    minFontSize: 10, maxFontSize: 16, constraints: { maxChars: 120 } },
    { id: "accent",     x: 0,  y: 0,  width: 3,   height: 100, required: false, zIndex: 1, alignH: "left",   alignV: "top",    locked: true },
  ],
  variations: [
    { id: "v1_classic",  name: "Classic",      overrides: {} },
    { id: "v2_centered", name: "Centered",     overrides: { logo: { x: 35, y: 8, width: 30, height: 35, alignH: "center" }, name: { x: 5, y: 48, width: 90, alignH: "center" }, title: { x: 5, y: 62, width: 90, alignH: "center" }, company: { x: 5, alignH: "center" }, contact: { x: 5, alignH: "center" } } },
    { id: "v3_horizontal", name: "Horizontal Left", overrides: { logo: { x: 5, y: 20, width: 20, height: 60 }, name: { x: 30, y: 15 }, title: { x: 30, y: 40 } } },
    { id: "v4_bottom_bar", name: "Bottom Accent Bar", overrides: { accent: { x: 0, y: 80, width: 100, height: 20 }, logo: { x: 5, y: 8, width: 22, height: 30 }, name: { x: 30, y: 10, width: 65, height: 25 }, title: { x: 30, y: 38, width: 65, height: 14 }, company: { x: 5, y: 55, width: 90, height: 18 }, contact: { x: 5, y: 84, width: 90, height: 14 } } },
    { id: "v5_right_accent", name: "Right Accent",    overrides: { accent: { x: 97, y: 0, width: 3, height: 100 }, logo: { x: 72, y: 12, width: 22, height: 30 }, name: { x: 5, y: 10, width: 62 }, title: { x: 5, y: 36 }, company: { x: 5, y: 54 }, contact: { x: 5, y: 72 } } },
    { id: "v6_split_diag",   name: "Split Layout",    overrides: { accent: { x: 0, y: 0, width: 40, height: 100 }, logo: { x: 6, y: 35, width: 28, height: 30 }, name: { x: 44, y: 14, width: 52, height: 22 }, title: { x: 44, y: 40, width: 52, height: 14 }, company: { x: 44, y: 58, width: 52, height: 14 }, contact: { x: 44, y: 74, width: 52, height: 22 } } },
  ],
};

// ═══════════════════════════════════════════════════════════════════════════════
// 8. RESUME  (2550×3300 — US Letter)
// ═══════════════════════════════════════════════════════════════════════════════
const RESUME: LayoutFamily = {
  id: "resume", name: "Resume", category: "document",
  formats: ["resume"],
  assetConstraints: { maxImageAreas: 0 },  // no photos in default resume
  zones: [
    { id: "background",    x: 0,  y: 0,  width: 100, height: 100, required: true,  zIndex: 0, alignH: "center", alignV: "middle", locked: true },
    { id: "accent",        x: 0,  y: 0,  width: 28,  height: 100, required: false, zIndex: 1, alignH: "left",   alignV: "top",    locked: true },
    { id: "name",          x: 32, y: 3,  width: 65,  height: 6,   required: true,  zIndex: 2, alignH: "left",   alignV: "middle", minFontSize: 36, maxFontSize: 64, constraints: { maxChars: 40, fontWeight: [700] } },
    { id: "title",         x: 32, y: 10, width: 65,  height: 4,   required: true,  zIndex: 2, alignH: "left",   alignV: "middle", minFontSize: 18, maxFontSize: 28, constraints: { maxChars: 60 } },
    { id: "contact",       x: 32, y: 15, width: 65,  height: 4,   required: true,  zIndex: 2, alignH: "left",   alignV: "top",    minFontSize: 12, maxFontSize: 18, constraints: { maxChars: 120 } },
    { id: "section_header",x: 32, y: 22, width: 65,  height: 3,   required: false, zIndex: 2, alignH: "left",   alignV: "middle", minFontSize: 14, maxFontSize: 20, constraints: { maxChars: 30, fontWeight: [700] } },
    { id: "body",          x: 32, y: 26, width: 65,  height: 35,  required: true,  zIndex: 2, alignH: "left",   alignV: "top",    minFontSize: 11, maxFontSize: 16, constraints: { maxChars: 800 } },
    { id: "bullet_1",      x: 3,  y: 25, width: 24,  height: 8,   required: false, zIndex: 2, alignH: "left",   alignV: "top",    minFontSize: 12, maxFontSize: 18, constraints: { maxChars: 80 } },
    { id: "bullet_2",      x: 3,  y: 38, width: 24,  height: 8,   required: false, zIndex: 2, alignH: "left",   alignV: "top",    minFontSize: 12, maxFontSize: 18, constraints: { maxChars: 80 } },
    { id: "bullet_3",      x: 3,  y: 51, width: 24,  height: 8,   required: false, zIndex: 2, alignH: "left",   alignV: "top",    minFontSize: 12, maxFontSize: 18, constraints: { maxChars: 80 } },
    { id: "logo",          x: 3,  y: 3,  width: 22,  height: 12,  required: false, zIndex: 2, alignH: "center", alignV: "middle" },
  ],
  variations: [
    { id: "v1_two_col",    name: "Two Column",    overrides: {} },
    { id: "v2_single_col", name: "Single Column", overrides: { accent: { width: 0 }, name: { x: 5 }, title: { x: 5 }, contact: { x: 5 }, section_header: { x: 5 }, body: { x: 5, width: 90 }, bullet_1: { height: 0 }, bullet_2: { height: 0 }, bullet_3: { height: 0 } } },
    { id: "v3_right_sidebar", name: "Right Sidebar", overrides: { accent: { x: 72, y: 0, width: 28, height: 100 }, name: { x: 4, y: 3, width: 65 }, title: { x: 4, y: 10, width: 65 }, contact: { x: 4, y: 15, width: 65 }, section_header: { x: 4, y: 22, width: 65 }, body: { x: 4, y: 26, width: 65 }, bullet_1: { x: 74, y: 6, width: 22, height: 12 }, bullet_2: { x: 74, y: 22, width: 22, height: 12 }, bullet_3: { x: 74, y: 38, width: 22, height: 12 }, logo: { x: 76, y: 84, width: 18, height: 10 } } },
    { id: "v4_header_band",name: "Header Band",    overrides: { accent: { x: 0, y: 0, width: 100, height: 18 }, name: { x: 5, y: 3, width: 90 }, title: { x: 5, y: 9, width: 90 }, contact: { x: 5, y: 13, width: 90 }, section_header: { x: 5, y: 22, width: 90 }, body: { x: 5, y: 26, width: 90, height: 68 }, bullet_1: { height: 0 }, bullet_2: { height: 0 }, bullet_3: { height: 0 }, logo: { x: 82, y: 3, width: 14, height: 10 } } },
  ],
};

// ═══════════════════════════════════════════════════════════════════════════════
// 9. LOGO  (1000×1000 — square master)
// ═══════════════════════════════════════════════════════════════════════════════
const LOGO: LayoutFamily = {
  id: "logo", name: "Logo", category: "logo",
  formats: ["logo"],
  assetConstraints: { maxImageAreas: 0 },
  zones: [
    { id: "background", x: 0,  y: 0,  width: 100, height: 100, required: true,  zIndex: 0, alignH: "center", alignV: "middle", locked: true },
    { id: "image",      x: 15, y: 10, width: 70,  height: 50,  required: false, zIndex: 1, alignH: "center", alignV: "middle" },
    { id: "name",       x: 5,  y: 63, width: 90,  height: 18,  required: true,  zIndex: 2, alignH: "center", alignV: "middle", minFontSize: 40, maxFontSize: 100, constraints: { maxChars: 25, fontWeight: [700, 800] } },
    { id: "tagline",    x: 5,  y: 82, width: 90,  height: 10,  required: false, zIndex: 2, alignH: "center", alignV: "middle", minFontSize: 14, maxFontSize: 24, constraints: { maxChars: 50 } },
    { id: "accent",     x: 38, y: 60, width: 24,  height: 1,   required: false, zIndex: 1, alignH: "center", alignV: "middle", locked: true },
  ],
  variations: [
    { id: "v1_wordmark",    name: "Wordmark",       overrides: { image: { height: 0 }, name: { y: 32, height: 36, maxFontSize: 140 }, tagline: { y: 72 } } },
    { id: "v2_icon_top",    name: "Icon + Name",    overrides: {} },
    { id: "v3_monogram",    name: "Monogram",       overrides: { image: { y: 20, height: 60 }, name: { height: 0 }, tagline: { height: 0 } } },
    { id: "v4_horizontal",  name: "Horizontal",     overrides: { image: { x: 5, y: 25, width: 30, height: 50 }, name: { x: 40, y: 30, width: 55, alignH: "left" }, tagline: { x: 40, y: 65, width: 55, alignH: "left" } } },
    { id: "v5_underline",   name: "Underlined",     overrides: { image: { x: 25, y: 12, width: 50, height: 36 }, name: { y: 54, height: 16 }, accent: { x: 30, y: 72, width: 40, height: 1 }, tagline: { y: 78, height: 8 } } },
    { id: "v6_stacked",     name: "Stacked Tight",  overrides: { image: { x: 35, y: 14, width: 30, height: 30 }, name: { y: 48, height: 20, maxFontSize: 80 }, tagline: { y: 70, height: 10 } } },
    { id: "v7_icon_left",   name: "Icon Left",      overrides: { image: { x: 6, y: 30, width: 28, height: 40 }, name: { x: 38, y: 36, width: 58, alignH: "left", height: 18 }, tagline: { x: 38, y: 58, width: 58, alignH: "left", height: 10 } } },
    { id: "v8_name_first",  name: "Name Above Icon",overrides: { name: { y: 12, height: 20, maxFontSize: 110 }, image: { y: 38, height: 40 }, tagline: { y: 82, height: 10 } } },
  ],
};

// ── Registry ──────────────────────────────────────────────────────────────────
export const LAYOUT_FAMILIES: LayoutFamily[] = [
  IG_POST, IG_STORY, YT_THUMB,
  FLYER, POSTER, PRES_SLIDE,
  BIZ_CARD, RESUME, LOGO,
];

export const FAMILIES_BY_FORMAT: Record<string, LayoutFamily[]> = {};
for (const family of LAYOUT_FAMILIES) {
  for (const fmt of family.formats) {
    FAMILIES_BY_FORMAT[fmt] = FAMILIES_BY_FORMAT[fmt] ?? [];
    FAMILIES_BY_FORMAT[fmt].push(family);
  }
}

// ── Deterministic permutation ───────────────────────────────────────────────
//
// The gallery renders N templates per format with sequential variationIdx
// values (0, 1, 2, ...). A plain hash-mod-N selector causes collisions
// whenever N exceeds the variation count, so the first template and the
// sixth template of the same family end up looking identical.
//
// Instead, for each (campaignId, format, stylePreset) we derive a seed and
// produce a Fisher-Yates permutation of [0..N-1]. Calling
// `pickPermutedIndex(seed, N, variationIdx)` returns
// `permutation[variationIdx % N]`, guaranteeing that the first N templates
// cover all N variations before any repeats.

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function permutation(size: number, seedHex: string): number[] {
  const arr = Array.from({ length: size }, (_, i) => i);
  // Mix several hex chunks into the RNG seed to keep spread wide
  const seedInt = parseInt(seedHex.slice(0, 8), 16) ^ parseInt(seedHex.slice(8, 16), 16);
  const rand = mulberry32(seedInt || 1);
  for (let i = size - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Deterministically pick the index of the variationIdx-th item in a
 * permutation of [0..size-1], seeded by `seedHex`. The first `size` calls
 * with distinct variationIdx values cover every index exactly once.
 */
export function pickPermutedIndex(seedHex: string, size: number, variationIdx: number): number {
  if (size <= 1) return 0;
  const perm = permutation(size, seedHex);
  const step = ((variationIdx % size) + size) % size;
  return perm[step];
}

// Alias extended social formats to closest canonical layout family
const FORMAT_ALIASES: Record<string, string> = {
  facebook_post:  "instagram_post",
  twitter_post:   "youtube_thumbnail",
  display_banner: "youtube_thumbnail",
  linkedin_post:  "instagram_post",
  tiktok_video:   "instagram_story",
};
for (const [alias, canonical] of Object.entries(FORMAT_ALIASES)) {
  if (!FAMILIES_BY_FORMAT[alias] && FAMILIES_BY_FORMAT[canonical]) {
    FAMILIES_BY_FORMAT[alias] = FAMILIES_BY_FORMAT[canonical];
  }
}

// ── Selector ──────────────────────────────────────────────────────────────────
export interface SelectionContext {
  format:       string;
  stylePreset:  string;
  variationIdx: number;
  campaignId:   string;
}

export interface LayoutSelection {
  family:    LayoutFamily;
  variation: LayoutVariation;
  seed:      string;
}

/**
 * Deterministically selects a layout family and variation.
 * Same inputs ALWAYS produce the same selection — campaign consistency guaranteed.
 */
export function selectLayout(ctx: SelectionContext): LayoutSelection {
  const families = FAMILIES_BY_FORMAT[ctx.format];
  if (!families?.length) {
    const fallback = LAYOUT_FAMILIES[0];
    return { family: fallback, variation: fallback.variations[0], seed: "fallback" };
  }

  const seed = createHash("sha256")
    .update(`${ctx.campaignId}:${ctx.format}:${ctx.variationIdx}:${ctx.stylePreset}`)
    .digest("hex");

  const fSeed = createHash("sha256")
    .update(`${ctx.campaignId}:${ctx.format}:${ctx.stylePreset}:family`)
    .digest("hex");
  const familyIdx = pickPermutedIndex(fSeed, families.length, ctx.variationIdx);
  const family    = families[familyIdx];

  const vSeed = createHash("sha256")
    .update(`${ctx.campaignId}:${ctx.format}:${ctx.stylePreset}:${family.id}`)
    .digest("hex");
  const variationIdx = pickPermutedIndex(vSeed, family.variations.length, ctx.variationIdx);

  return {
    family,
    variation: family.variations[variationIdx],
    seed,
  };
}

/**
 * Merges variation overrides onto base zones → final resolved zone set.
 */
export function resolveZones(selection: LayoutSelection): Zone[] {
  const { family, variation } = selection;
  return family.zones.map(zone => {
    const override = variation.overrides[zone.id];
    if (!override) return zone;
    return {
      ...zone,
      ...override,
      constraints: {
        ...(zone.constraints ?? {}),
        ...(override.constraints ?? {}),
      },
    };
  });
}
