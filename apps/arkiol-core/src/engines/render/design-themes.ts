// src/engines/render/design-themes.ts  — Arkiol Ultimate v4  (Canva-parity)
//
// Philosophy: Every theme is a COMPLETE visual identity system.
// Canva templates win because: (1) intentional whitespace, (2) type hierarchy
// that fills the canvas, (3) decorations that FRAME text not fight it,
// (4) colour palette with real contrast ratios, (5) premium font pairings.
//
// v4 changes:
//  • Decorations now use LAYOUT-AWARE coords — placed relative to safe content area
//  • Blob renderer upgraded to 12-point smooth cubic bezier (organic, not angular)
//  • New shapes: noise_texture, corner_bracket, arc_stroke, diagonal_band
//  • All card_panels sized and positioned to wrap actual body/subhead zones
//  • headlineSizeMultiplier raised — hero text fills canvas like Canva
//  • Theme scoring upgraded: 3 tones + 3 colorMoods per theme (better matching)

import { BriefAnalysis } from "../ai/brief-analyzer";
import { detectCategoryPack, paletteMoodToColorMoods, type CategoryStylePack } from "../style/category-style-packs";

export type ThemeFont =
  | "Montserrat" | "Playfair Display" | "Oswald"  | "Poppins"
  | "Raleway"    | "Nunito"           | "Lato"     | "Bebas Neue"
  | "DM Sans"    | "Cormorant Garamond"
  | "Nunito Sans"
  // Step 64 — script / cursive / handwritten display faces so themes
  // can reach the "Monday Motivation" / "Stress Relief" / "Style Guide"
  // typographic register. All five are Google Fonts so the registry
  // can fetch + embed them without new licensing surface.
  | "Dancing Script" | "Caveat" | "Sacramento" | "Allura" | "Pacifico";

export interface ThemePalette {
  background: string; surface: string;  primary:   string;
  secondary:  string; text:    string;  textMuted: string; highlight: string;
}

// Step 65 — painterly scene kinds used by `BgTreatment.scene`.
// Each kind resolves to a deterministic set of SVG layers inside the
// renderer. Keep this list append-only — themes reference kinds by name
// and adding new ones doesn't break existing tests.
export type SceneKind =
  | "mountain_lake"
  | "jungle"
  | "sunset_sky"
  | "meadow"
  | "ocean_horizon"
  | "forest";

export type BgTreatment =
  | { kind: "solid";           color: string }
  | { kind: "linear_gradient"; colors: string[]; angle: number }
  | { kind: "radial_gradient"; colors: string[]; cx: number; cy: number }
  | { kind: "mesh";            colors: string[] }
  | { kind: "split";           colors: [string, string]; splitY: number }
  // Step 65 — full-bleed painterly scene used as the canvas background.
  // `scene` picks a drawable illustration (mountain+lake, jungle, sunset
  // sky, meadow, ocean horizon, forest). `palette` tints the scene so it
  // harmonizes with the theme's palette. `atmosphere` controls how warm
  // / cool the sky layer reads. The actual painting is composed from
  // layered SVG paths + gradients — no bitmap assets required.
  | { kind: "scene"; scene: SceneKind; palette: string[]; atmosphere?: "dawn"|"noon"|"dusk"|"night" }

// ALL coordinates are % of canvas width/height
export type DecorShape =
  | { kind:"circle";         x:number; y:number; r:number;     color:string; opacity:number; stroke?:boolean; strokeWidth?:number }
  | { kind:"rect";           x:number; y:number; w:number; h:number; color:string; opacity:number; rx:number }
  | { kind:"blob";           x:number; y:number; size:number;  color:string; opacity:number; seed:number }
  | { kind:"line";           x1:number;y1:number;x2:number;y2:number; color:string; opacity:number; width:number; dash?:number }
  | { kind:"dots_grid";      x:number; y:number; cols:number; rows:number; gap:number; r:number; color:string; opacity:number }
  | { kind:"diagonal_stripe";x:number; y:number; w:number; h:number; color:string; opacity:number }
  | { kind:"half_circle";    x:number; y:number; r:number;     color:string; opacity:number; rotation:number }
  | { kind:"accent_bar";     x:number; y:number; w:number; h:number; color:string; rx:number }
  | { kind:"badge_pill";     x:number; y:number; w:number; h:number; color:string; text:string; textColor:string; fontSize:number }
  | { kind:"deco_ring";      x:number; y:number; r:number;     color:string; opacity:number; strokeWidth:number; dash?:number }
  | { kind:"triangle";       x:number; y:number; size:number;  color:string; opacity:number; rotation:number }
  | { kind:"cross";          x:number; y:number; size:number;  thickness:number; color:string; opacity:number; rotation:number }
  | { kind:"wave";           x:number; y:number; w:number;     amplitude:number; frequency:number; color:string; opacity:number; strokeWidth:number }
  | { kind:"card_panel";     x:number; y:number; w:number; h:number; color:string; opacity:number; rx:number; shadow?:boolean }
  | { kind:"glow_circle";    x:number; y:number; r:number;     color:string; opacity:number }
  | { kind:"flower";         x:number; y:number; r:number;     petals:number; color:string; opacity:number }
  | { kind:"squiggle";       x:number; y:number; w:number;     color:string; opacity:number; strokeWidth:number }
  | { kind:"arc_stroke";     x:number; y:number; r:number;     startAngle:number; endAngle:number; color:string; opacity:number; strokeWidth:number }
  | { kind:"corner_bracket"; x:number; y:number; size:number;  color:string; opacity:number; strokeWidth:number; corner:"tl"|"tr"|"bl"|"br" }
  | { kind:"diagonal_band";  color:string; opacity:number; angle:number; thickness:number }
  | { kind:"noise_overlay";  opacity:number }
  // ── Step 3: Richer decorations & components ──
  | { kind:"ribbon";         x:number; y:number; w:number; h:number; color:string; text:string; textColor:string; fontSize:number; opacity:number; corner:"tl"|"tr" }
  | { kind:"sticker_circle"; x:number; y:number; r:number; color:string; text:string; textColor:string; fontSize:number; rotation:number; opacity:number; borderColor?:string; borderWidth?:number }
  | { kind:"icon_symbol";    x:number; y:number; size:number; icon:"star"|"check"|"heart"|"arrow"|"lightning"|"play"|"fire"|"sparkle"; color:string; opacity:number }
  | { kind:"checklist";      x:number; y:number; w:number; items:string[]; color:string; checkColor:string; fontSize:number; opacity:number; lineHeight?:number }
  | { kind:"frame_border";   x:number; y:number; w:number; h:number; color:string; opacity:number; strokeWidth:number; gap:number; rx:number }
  | { kind:"section_divider"; x:number; y:number; w:number; color:string; opacity:number; strokeWidth:number; ornament:"diamond"|"dot"|"dash"|"circle"|"star" }
  | { kind:"texture_fill";   x:number; y:number; w:number; h:number; pattern:"crosses"|"lines"|"zigzag"|"confetti"; color:string; opacity:number; scale:number }
  | { kind:"photo_circle";   x:number; y:number; r:number; borderColor:string; borderWidth:number; opacity:number; shadow?:boolean; bgColor:string; photoSlug?:string; photoUrl?:string }
  | { kind:"starburst";      x:number; y:number; r:number; rays:number; color:string; opacity:number; rotation:number }
  | { kind:"price_tag";      x:number; y:number; w:number; h:number; color:string; text:string; textColor:string; fontSize:number; opacity:number }
  | { kind:"banner_strip";   x:number; y:number; w:number; h:number; color:string; text:string; textColor:string; fontSize:number; opacity:number; skew?:number }
  // ── Step 65: painterly illustration decorations ──
  // These five kinds fill the gap against the Canva-grade reference pack:
  //   • foliage_silhouette — layered painted leaves/grass anchored to an edge
  //   • mountain_range     — parallax-layered mountain silhouettes
  //   • watercolor_corner  — soft organic blob + leaf sprigs at a corner
  //   • themed_cluster     — category-specific prop group (food/spa/study/office)
  //   • torn_paper_frame   — irregular jagged-edge paper panel framing content
  | { kind:"foliage_silhouette"; anchor:"bottom"|"top"|"left"|"right"; palette:[string,string,string]; density:number; height:number; opacity:number }
  | { kind:"mountain_range";     y:number; layers:number; palette:string[]; peakVariance:number; opacity:number }
  | { kind:"watercolor_corner";  corner:"tl"|"tr"|"bl"|"br"; size:number; palette:[string,string,string]; opacity:number }
  | { kind:"themed_cluster";     x:number; y:number; size:number; theme:"food"|"spa"|"study"|"office"|"travel"|"floral"; palette:string[]; opacity:number }
  | { kind:"torn_paper_frame";   x:number; y:number; w:number; h:number; color:string; shadowColor:string; opacity:number; seed:number }
  // ── Step 66: photo integration + shape panels + washi tape ──
  //   • photo_shape    — a real <image> masked to heart/circle/blob (matches
  //                      "Heart Health Tips" / "Style Guide" in reference)
  //   • shape_panel    — filled shape (heart/blob/arc) used as a text backdrop
  //   • washi_tape     — angled semi-transparent striped tape pinning decor
  | { kind:"photo_shape";        x:number; y:number; w:number; h:number; shape:"heart"|"circle"|"blob"|"rounded"; photoSlug?:string; photoUrl?:string; borderColor?:string; borderWidth?:number; opacity:number; shadow?:boolean; fallbackColor:string }
  | { kind:"shape_panel";        x:number; y:number; w:number; h:number; shape:"heart"|"blob"|"arc"|"badge"; color:string; strokeColor?:string; strokeWidth?:number; opacity:number; seed?:number }
  | { kind:"washi_tape";         x:number; y:number; w:number; h:number; rotation:number; colorA:string; colorB:string; opacity:number; stripes:number }

export interface ZoneTypography {
  fontFamily:ThemeFont; fontWeight:number; color:string;
  letterSpacing?:number; textTransform?:"uppercase"|"none";
  lineHeightMultiplier?:number; fontSizeMultiplier?:number;
}
export interface ThemeTypography {
  display:ThemeFont; body:ThemeFont;
  headline:ZoneTypography; subhead:ZoneTypography; body_text:ZoneTypography;
  cta:ZoneTypography; badge:ZoneTypography; eyebrow:ZoneTypography;
}
export interface ThemeCtaStyle {
  backgroundColor:string; textColor:string; borderRadius:number;
  paddingH:number; paddingV:number; shadow?:boolean;
  outline?:boolean; outlineColor?:string; outlineWidth?:number;
}
export interface DesignTheme {
  id:string; name:string;
  tones:BriefAnalysis["tone"][]; colorMoods:BriefAnalysis["colorMood"][];
  palette:ThemePalette; background:BgTreatment;
  typography:ThemeTypography; decorations:DecorShape[];
  ctaStyle:ThemeCtaStyle;
  overlayOpacity?:number; overlayColor?:string;
  headlineSizeMultiplier?:number;
}

// ─────────────────────────────────────────────────────────────────────────────
// THEME LIBRARY — 12 production-grade themes, Canva-parity
// Layout convention (% of 1080×1080 canvas):
//   eyebrow  ≈ y 8–13
//   headline ≈ y 15–42
//   subhead  ≈ y 44–54
//   body     ≈ y 55–68
//   cta      ≈ y 72–82
// Decorations are placed to FRAME text, never overlap it.
// ─────────────────────────────────────────────────────────────────────────────

export const THEMES: DesignTheme[] = [

// ══════════════════════════════════════════════════════════════════════════════
// 1. VIBRANT BURST — Energy, sport, sale  (orange fire mesh)
// ══════════════════════════════════════════════════════════════════════════════
{
  id:"vibrant_burst", name:"Vibrant Burst",
  tones:["energetic","bold","urgent"], colorMoods:["vibrant","warm"],
  headlineSizeMultiplier:1.42,
  palette:{ background:"#f4511e", surface:"rgba(255,255,255,0.15)", primary:"#f4511e",
    secondary:"#ffd600", text:"#ffffff", textMuted:"rgba(255,255,255,0.78)", highlight:"#ffd600" },
  background:{ kind:"mesh", colors:["#f4511e","#ff7043","#e64a19"] },
  typography:{
    display:"Montserrat", body:"Lato",
    headline: { fontFamily:"Montserrat", fontWeight:900, color:"#ffffff", letterSpacing:-0.03, fontSizeMultiplier:1.42 },
    subhead:  { fontFamily:"Montserrat", fontWeight:600, color:"rgba(255,255,255,0.92)" },
    body_text:{ fontFamily:"Lato",       fontWeight:400, color:"rgba(255,255,255,0.8)" },
    cta:      { fontFamily:"Montserrat", fontWeight:800, color:"#f4511e", textTransform:"uppercase", letterSpacing:0.08 },
    badge:    { fontFamily:"Montserrat", fontWeight:700, color:"#ffffff", textTransform:"uppercase", letterSpacing:0.16 },
    eyebrow:  { fontFamily:"Montserrat", fontWeight:700, color:"#ffd600", textTransform:"uppercase", letterSpacing:0.26 },
  },
  decorations:[
    // Big corner circles (frame, not intrude)
    { kind:"circle",      x:95,  y:-8,  r:220, color:"rgba(255,255,255,0.12)", opacity:1 },
    { kind:"circle",      x:-8,  y:95,  r:150, color:"rgba(255,255,255,0.10)", opacity:1 },
    // Gold accent ring top-right
    { kind:"deco_ring",   x:88,  y:8,   r:58,  color:"#ffd600", opacity:0.55, strokeWidth:3 },
    { kind:"deco_ring",   x:88,  y:8,   r:75,  color:"#ffd600", opacity:0.2,  strokeWidth:1.5, dash:5 },
    // Bottom gold bar
    { kind:"rect",        x:0,   y:95.5,w:100, h:4.5,color:"#ffd600", opacity:1,  rx:0 },
    // Dot grid bottom-left (visual weight anchor)
    { kind:"dots_grid",   x:3,   y:70,  cols:5,rows:4, gap:14, r:2.8, color:"#ffd600", opacity:0.35 },
    // ×-cross accents
    { kind:"cross",       x:7,   y:7,   size:20, thickness:3, color:"rgba(255,255,255,0.45)", opacity:1, rotation:45 },
    { kind:"cross",       x:88,  y:88,  size:14, thickness:2, color:"rgba(255,255,255,0.3)",  opacity:1, rotation:0 },
    // Eyebrow left accent bar
    { kind:"accent_bar",  x:5,   y:7,   w:0.5, h:5, color:"#ffd600", rx:2 },
    // Starburst behind headline area
    { kind:"starburst",   x:50,  y:30,  r:350, rays:24, color:"rgba(255,255,255,0.04)", opacity:1, rotation:8 },
    // Fire icon accent
    { kind:"icon_symbol", x:92,  y:50,  size:18, icon:"fire", color:"#ffd600", opacity:0.45 },
  ],
  ctaStyle:{ backgroundColor:"#ffffff", textColor:"#f4511e", borderRadius:50, paddingH:40, paddingV:18, shadow:true },
  overlayOpacity:0.2, overlayColor:"#000000",
},

// ══════════════════════════════════════════════════════════════════════════════
// 2. DARK LUXE — Luxury brand, jewellery, high-end services  (gold on black)
// ══════════════════════════════════════════════════════════════════════════════
{
  id:"dark_luxe", name:"Dark Luxe",
  tones:["professional","luxury","minimal"], colorMoods:["dark","monochrome"],
  headlineSizeMultiplier:1.22,
  palette:{ background:"#08091a", surface:"rgba(201,168,76,0.06)", primary:"#c9a84c",
    secondary:"#e8d5a3", text:"#ffffff", textMuted:"rgba(255,255,255,0.48)", highlight:"#c9a84c" },
  background:{ kind:"linear_gradient", colors:["#08091a","#10142a","#08091a"], angle:158 },
  typography:{
    display:"Playfair Display", body:"Lato",
    headline: { fontFamily:"Playfair Display", fontWeight:700, color:"#ffffff",  letterSpacing:-0.01, fontSizeMultiplier:1.22 },
    subhead:  { fontFamily:"Lato",             fontWeight:300, color:"rgba(255,255,255,0.52)", letterSpacing:0.14 },
    body_text:{ fontFamily:"Lato",             fontWeight:400, color:"rgba(255,255,255,0.4)" },
    cta:      { fontFamily:"Lato",             fontWeight:700, color:"#08091a",  letterSpacing:0.12 },
    badge:    { fontFamily:"Lato",             fontWeight:700, color:"#c9a84c",  textTransform:"uppercase", letterSpacing:0.24 },
    eyebrow:  { fontFamily:"Lato",             fontWeight:400, color:"#c9a84c",  textTransform:"uppercase", letterSpacing:0.3 },
  },
  decorations:[
    // Ambient gold glow
    { kind:"glow_circle",  x:82,  y:18,  r:280, color:"#c9a84c", opacity:0.18 },
    // Concentric rings top-right
    { kind:"deco_ring",    x:87,  y:10,  r:52,  color:"#c9a84c", opacity:0.6,  strokeWidth:1.5 },
    { kind:"deco_ring",    x:87,  y:10,  r:68,  color:"#c9a84c", opacity:0.25, strokeWidth:1,   dash:4 },
    { kind:"deco_ring",    x:87,  y:10,  r:86,  color:"#c9a84c", opacity:0.1,  strokeWidth:0.8 },
    // Left gold vertical rule
    { kind:"accent_bar",   x:0,   y:10,  w:0.55,h:78, color:"#c9a84c", rx:0 },
    // Bottom rule
    { kind:"line",         x1:4,  y1:96, x2:96, y2:96, color:"#c9a84c", opacity:0.2, width:0.8 },
    // Dot matrix bottom-right
    { kind:"dots_grid",    x:73,  y:72,  cols:5,rows:5, gap:13, r:1.2, color:"#c9a84c", opacity:0.14 },
    // Partial arc top-left corner
    { kind:"arc_stroke",   x:3,   y:5,   r:35, startAngle:90, endAngle:180, color:"#c9a84c", opacity:0.25, strokeWidth:1 },
    // Luxury frame border
    { kind:"frame_border", x:3,   y:3,   w:94, h:94, color:"#c9a84c", opacity:0.12, strokeWidth:1, gap:8, rx:0 },
    // Section divider with diamond ornament
    { kind:"section_divider", x:15, y:52, w:70, color:"#c9a84c", opacity:0.2, strokeWidth:0.8, ornament:"diamond" },
  ],
  ctaStyle:{ backgroundColor:"#c9a84c", textColor:"#08091a", borderRadius:2, paddingH:36, paddingV:15 },
  overlayOpacity:0.48, overlayColor:"#08091a",
},

// ══════════════════════════════════════════════════════════════════════════════
// 3. LUSH GREEN — Eco, nutrition, nature brands  (deep forest)
// ══════════════════════════════════════════════════════════════════════════════
{
  id:"lush_green", name:"Lush Green",
  tones:["bold","warm","energetic"], colorMoods:["dark","cool"],
  headlineSizeMultiplier:1.28,
  palette:{ background:"#0b2117", surface:"rgba(255,255,255,0.06)", primary:"#2ecc71",
    secondary:"#52d68a", text:"#ffffff", textMuted:"rgba(255,255,255,0.62)", highlight:"#00e676" },
  background:{ kind:"linear_gradient", colors:["#0b2117","#163828","#0b2117"], angle:152 },
  typography:{
    display:"Poppins", body:"Lato",
    headline: { fontFamily:"Poppins", fontWeight:800, color:"#ffffff",  letterSpacing:-0.02, fontSizeMultiplier:1.28 },
    subhead:  { fontFamily:"Poppins", fontWeight:400, color:"#52d68a" },
    body_text:{ fontFamily:"Lato",    fontWeight:400, color:"rgba(255,255,255,0.65)" },
    cta:      { fontFamily:"Poppins", fontWeight:700, color:"#0b2117", textTransform:"uppercase" },
    badge:    { fontFamily:"Poppins", fontWeight:600, color:"#0b2117", textTransform:"uppercase", letterSpacing:0.14 },
    eyebrow:  { fontFamily:"Poppins", fontWeight:600, color:"#00e676", textTransform:"uppercase", letterSpacing:0.22 },
  },
  decorations:[
    // Organic blobs (off-canvas, just peep in)
    { kind:"blob",      x:90,  y:-6,  size:300, color:"rgba(46,204,113,0.1)",  opacity:1, seed:3 },
    { kind:"blob",      x:-6,  y:88,  size:220, color:"rgba(0,230,118,0.09)", opacity:1, seed:17 },
    // Green rings top-right
    { kind:"deco_ring", x:82,  y:10,  r:52,  color:"#00e676", opacity:0.4, strokeWidth:1.8 },
    { kind:"deco_ring", x:82,  y:10,  r:68,  color:"#2ecc71", opacity:0.18,strokeWidth:1 },
    // Top green line
    { kind:"accent_bar",x:0,   y:0,   w:100, h:0.65, color:"#00e676", rx:0 },
    // Bottom hook line
    { kind:"line",      x1:6,  y1:93, x2:48, y2:93, color:"#00e676", opacity:0.45, width:2.5 },
    // Left dot grid
    { kind:"dots_grid", x:4,   y:2,   cols:4,rows:7, gap:15, r:2.2, color:"#2ecc71", opacity:0.22 },
    // Corner bracket top-left
    { kind:"corner_bracket", x:5, y:5, size:22, color:"#00e676", opacity:0.5, strokeWidth:2, corner:"tl" },
    // Checklist block (tips/eco habits)
    { kind:"checklist", x:8, y:58, w:40, items:["Eco-friendly","Sustainable","Natural"], color:"rgba(255,255,255,0.65)", checkColor:"#00e676", fontSize:13, opacity:0.7 },
    // Leaf icon
    { kind:"icon_symbol", x:92, y:48, size:16, icon:"sparkle", color:"#00e676", opacity:0.35 },
  ],
  ctaStyle:{ backgroundColor:"#00e676", textColor:"#0b2117", borderRadius:8, paddingH:36, paddingV:16, shadow:true },
  overlayOpacity:0.52, overlayColor:"#0b2117",
},

// ══════════════════════════════════════════════════════════════════════════════
// 4. FLORAL ROMANCE — Weddings, beauty, fashion  (blush & rose)
// ══════════════════════════════════════════════════════════════════════════════
{
  id:"floral_romance", name:"Floral Romance",
  tones:["warm","playful","luxury"], colorMoods:["light","warm"],
  headlineSizeMultiplier:1.18,
  palette:{ background:"#fdf4f7", surface:"rgba(255,255,255,0.82)", primary:"#c2185b",
    secondary:"#f48fb1", text:"#2d0018", textMuted:"#8d4060", highlight:"#c2185b" },
  background:{ kind:"linear_gradient", colors:["#fdf4f7","#fce4ec","#fdf4f7"], angle:130 },
  typography:{
    display:"Cormorant Garamond", body:"Lato",
    headline: { fontFamily:"Cormorant Garamond", fontWeight:700, color:"#2d0018",  letterSpacing:-0.005, fontSizeMultiplier:1.18 },
    subhead:  { fontFamily:"Lato",               fontWeight:400, color:"#8d4060",  letterSpacing:0.04 },
    body_text:{ fontFamily:"Lato",               fontWeight:400, color:"#8d4060" },
    cta:      { fontFamily:"Lato",               fontWeight:700, color:"#ffffff" },
    badge:    { fontFamily:"Lato",               fontWeight:600, color:"#c2185b",  textTransform:"uppercase", letterSpacing:0.18 },
    eyebrow:  { fontFamily:"Lato",               fontWeight:400, color:"#c2185b",  textTransform:"uppercase", letterSpacing:0.26 },
  },
  decorations:[
    // Signature flowers — corner accents
    { kind:"flower",    x:90,  y:5,   r:58, petals:8, color:"#f48fb1", opacity:0.6 },
    { kind:"flower",    x:4,   y:84,  r:38, petals:6, color:"#f48fb1", opacity:0.45 },
    { kind:"flower",    x:88,  y:80,  r:24, petals:5, color:"#c2185b", opacity:0.22 },
    // Decorative squiggles
    { kind:"squiggle",  x:5,   y:13,  w:28, color:"#f48fb1", opacity:0.6, strokeWidth:2.5 },
    { kind:"squiggle",  x:66,  y:76,  w:24, color:"#c2185b", opacity:0.4, strokeWidth:2 },
    // Floating card behind body copy
    { kind:"card_panel",x:5,   y:58,  w:90, h:26, color:"rgba(255,255,255,0.72)", opacity:1, rx:18 },
    // Corner dots
    { kind:"dots_grid", x:4,   y:3,   cols:3,rows:3, gap:12, r:2.2, color:"#c2185b", opacity:0.18 },
    // Bottom-right arc
    { kind:"arc_stroke",x:92,  y:92,  r:40, startAngle:180, endAngle:270, color:"#f48fb1", opacity:0.4, strokeWidth:1.5 },
    // Heart icon accents
    { kind:"icon_symbol", x:92, y:50, size:14, icon:"heart", color:"#f48fb1", opacity:0.35 },
    { kind:"icon_symbol", x:6,  y:48, size:10, icon:"heart", color:"#c2185b", opacity:0.22 },
    // Ornamental divider
    { kind:"section_divider", x:20, y:54, w:60, color:"#f48fb1", opacity:0.3, strokeWidth:0.8, ornament:"dot" },
  ],
  ctaStyle:{ backgroundColor:"#c2185b", textColor:"#ffffff", borderRadius:50, paddingH:36, paddingV:16, shadow:true },
  overlayOpacity:0.0, overlayColor:"#2d0018",
},

// ══════════════════════════════════════════════════════════════════════════════
// 5. COSMIC PURPLE — Tech, gaming, crypto  (deep space purple mesh)
// ══════════════════════════════════════════════════════════════════════════════
{
  id:"cosmic_purple", name:"Cosmic Purple",
  tones:["bold","energetic","luxury"], colorMoods:["dark","vibrant","cool"],
  headlineSizeMultiplier:1.34,
  palette:{ background:"#0c001f", surface:"rgba(255,255,255,0.06)", primary:"#7c3aed",
    secondary:"#a78bfa", text:"#ffffff", textMuted:"rgba(255,255,255,0.55)", highlight:"#e879f9" },
  background:{ kind:"mesh", colors:["#0c001f","#1a0045","#0c0028"] },
  typography:{
    display:"Raleway", body:"Lato",
    headline: { fontFamily:"Raleway", fontWeight:900, color:"#ffffff",  letterSpacing:-0.025, fontSizeMultiplier:1.34 },
    subhead:  { fontFamily:"Lato",    fontWeight:300, color:"rgba(255,255,255,0.6)", letterSpacing:0.08 },
    body_text:{ fontFamily:"Lato",    fontWeight:400, color:"rgba(255,255,255,0.48)" },
    cta:      { fontFamily:"Raleway", fontWeight:800, color:"#0c001f", textTransform:"uppercase", letterSpacing:0.08 },
    badge:    { fontFamily:"Raleway", fontWeight:700, color:"#e879f9", textTransform:"uppercase", letterSpacing:0.2 },
    eyebrow:  { fontFamily:"Lato",    fontWeight:400, color:"#a78bfa", textTransform:"uppercase", letterSpacing:0.28 },
  },
  decorations:[
    // Ambient glows
    { kind:"glow_circle",  x:82,  y:12,  r:320, color:"#7c3aed", opacity:0.22 },
    { kind:"glow_circle",  x:12,  y:82,  r:260, color:"#a78bfa", opacity:0.16 },
    // Concentric rings
    { kind:"deco_ring",    x:82,  y:12,  r:65,  color:"#a78bfa", opacity:0.55, strokeWidth:1.8 },
    { kind:"deco_ring",    x:82,  y:12,  r:85,  color:"#7c3aed", opacity:0.28, strokeWidth:1,  dash:5 },
    { kind:"deco_ring",    x:82,  y:12,  r:108, color:"#7c3aed", opacity:0.12, strokeWidth:0.8 },
    // Organic blobs
    { kind:"blob",         x:92,  y:-5,  size:240, color:"rgba(168,85,247,0.14)", opacity:1, seed:42 },
    { kind:"blob",         x:-5,  y:88,  size:190, color:"rgba(124,58,237,0.12)", opacity:1, seed:77 },
    // Cross accents
    { kind:"cross",        x:9,   y:11,  size:20, thickness:2.5, color:"#e879f9", opacity:0.75, rotation:45 },
    { kind:"cross",        x:88,  y:84,  size:14, thickness:2,   color:"#a78bfa", opacity:0.5,  rotation:0 },
    // Bottom accent
    { kind:"line",         x1:0,  y1:97.5,x2:55,y2:97.5, color:"#7c3aed", opacity:0.7, width:3.5 },
    // Lightning icon — tech/gaming vibe
    { kind:"icon_symbol",  x:8,   y:48,   size:16, icon:"lightning", color:"#e879f9", opacity:0.4 },
    // Sparkle accents
    { kind:"icon_symbol",  x:75,  y:68,   size:10, icon:"sparkle", color:"#a78bfa", opacity:0.35 },
    { kind:"icon_symbol",  x:18,  y:76,   size:8,  icon:"sparkle", color:"#e879f9", opacity:0.25 },
    // Texture fill — subtle depth
    { kind:"texture_fill", x:0,   y:0,    w:100, h:100, pattern:"crosses", color:"rgba(168,85,247,0.06)", opacity:1, scale:4 },
  ],
  ctaStyle:{ backgroundColor:"#e879f9", textColor:"#0c001f", borderRadius:50, paddingH:40, paddingV:18, shadow:true },
  overlayOpacity:0.52, overlayColor:"#0c001f",
},

// ══════════════════════════════════════════════════════════════════════════════
// 6. POWER BLACK — Editorial, sport, music  (stark B&W + yellow)
// ══════════════════════════════════════════════════════════════════════════════
{
  id:"power_black", name:"Power Black",
  tones:["bold","professional","urgent"], colorMoods:["monochrome","dark"],
  headlineSizeMultiplier:1.45,
  palette:{ background:"#090909", surface:"rgba(255,255,255,0.04)", primary:"#f5c518",
    secondary:"#ffffff", text:"#ffffff", textMuted:"rgba(255,255,255,0.48)", highlight:"#f5c518" },
  background:{ kind:"solid", color:"#090909" },
  typography:{
    display:"Oswald", body:"Lato",
    headline: { fontFamily:"Oswald", fontWeight:700, color:"#ffffff", textTransform:"uppercase", letterSpacing:0.02, fontSizeMultiplier:1.45 },
    subhead:  { fontFamily:"Lato",   fontWeight:300, color:"rgba(255,255,255,0.52)", letterSpacing:0.08 },
    body_text:{ fontFamily:"Lato",   fontWeight:400, color:"rgba(255,255,255,0.42)" },
    cta:      { fontFamily:"Oswald", fontWeight:700, color:"#090909", textTransform:"uppercase", letterSpacing:0.12 },
    badge:    { fontFamily:"Oswald", fontWeight:700, color:"#f5c518", textTransform:"uppercase", letterSpacing:0.22 },
    eyebrow:  { fontFamily:"Lato",   fontWeight:700, color:"#f5c518", textTransform:"uppercase", letterSpacing:0.32 },
  },
  decorations:[
    // Signature yellow side bar
    { kind:"accent_bar",  x:0,   y:0,   w:0.85, h:100, color:"#f5c518", rx:0 },
    // Yellow bottom bar
    { kind:"rect",        x:0,   y:93,  w:100,  h:7,   color:"#f5c518", opacity:1,   rx:0 },
    // Subtle top line
    { kind:"line",        x1:4,  y1:3,  x2:96,  y2:3,  color:"#ffffff", opacity:0.2, width:1.5 },
    // Dot grid top-right
    { kind:"dots_grid",   x:72,  y:4,   cols:7, rows:5, gap:12, r:1.6, color:"#f5c518", opacity:0.2 },
    // Large ghost ring (depth)
    { kind:"deco_ring",   x:80,  y:38,  r:100,  color:"#ffffff", opacity:0.1, strokeWidth:32 },
    // ×-cross accent
    { kind:"cross",       x:90,  y:8,   size:16, thickness:2.5, color:"#f5c518", opacity:0.85, rotation:45 },
    // Corner brackets
    { kind:"corner_bracket", x:4, y:7, size:24, color:"#f5c518", opacity:0.6, strokeWidth:2.5, corner:"tl" },
    // Banner strip — bold editorial feel
    { kind:"banner_strip", x:0, y:44, w:100, h:5, color:"#f5c518", text:"", textColor:"#090909", fontSize:0, opacity:0.15 },
    // Star icon accent
    { kind:"icon_symbol",  x:92, y:50, size:14, icon:"star", color:"#f5c518", opacity:0.55 },
  ],
  ctaStyle:{ backgroundColor:"#f5c518", textColor:"#090909", borderRadius:0, paddingH:36, paddingV:16 },
  overlayOpacity:0.58, overlayColor:"#090909",
},

// ══════════════════════════════════════════════════════════════════════════════
// 7. OCEAN BLUE — Travel, lifestyle, corporate  (deep ocean gradient)
// ══════════════════════════════════════════════════════════════════════════════
{
  id:"ocean_blue", name:"Ocean Blue",
  tones:["professional","warm","energetic"], colorMoods:["cool","vibrant"],
  headlineSizeMultiplier:1.3,
  palette:{ background:"#012d6a", surface:"rgba(255,255,255,0.1)", primary:"#00b4d8",
    secondary:"#90e0ef", text:"#ffffff", textMuted:"rgba(255,255,255,0.72)", highlight:"#00f0c8" },
  background:{ kind:"linear_gradient", colors:["#012d6a","#0077b6","#0096c7"], angle:148 },
  typography:{
    display:"Poppins", body:"Lato",
    headline: { fontFamily:"Poppins", fontWeight:800, color:"#ffffff",  letterSpacing:-0.02, fontSizeMultiplier:1.3 },
    subhead:  { fontFamily:"Poppins", fontWeight:400, color:"rgba(255,255,255,0.85)" },
    body_text:{ fontFamily:"Lato",    fontWeight:400, color:"rgba(255,255,255,0.7)" },
    cta:      { fontFamily:"Poppins", fontWeight:700, color:"#012d6a", textTransform:"uppercase" },
    badge:    { fontFamily:"Poppins", fontWeight:600, color:"#012d6a", textTransform:"uppercase", letterSpacing:0.14 },
    eyebrow:  { fontFamily:"Poppins", fontWeight:600, color:"#90e0ef", textTransform:"uppercase", letterSpacing:0.24 },
  },
  decorations:[
    // Wave forms at bottom (sea effect)
    { kind:"wave",      x:0,  y:82,  w:100, amplitude:7, frequency:3, color:"rgba(255,255,255,0.18)", opacity:1, strokeWidth:0 },
    { kind:"wave",      x:0,  y:88,  w:100, amplitude:5, frequency:4, color:"rgba(255,255,255,0.12)", opacity:1, strokeWidth:0 },
    // Corner circles
    { kind:"circle",    x:92,  y:-6,  r:190, color:"rgba(255,255,255,0.14)", opacity:1 },
    { kind:"circle",    x:-6,  y:92,  r:130, color:"rgba(255,255,255,0.10)", opacity:1 },
    // Teal rings
    { kind:"deco_ring", x:86,  y:9,   r:52,  color:"#00f0c8", opacity:0.5, strokeWidth:2.2 },
    { kind:"deco_ring", x:86,  y:9,   r:68,  color:"#00f0c8", opacity:0.2, strokeWidth:1,  dash:5 },
    // Dot grid
    { kind:"dots_grid", x:4,   y:4,   cols:4,rows:6, gap:15, r:2.2, color:"#90e0ef", opacity:0.22 },
    // Corner bracket
    { kind:"corner_bracket", x:4, y:4, size:22, color:"#00f0c8", opacity:0.5, strokeWidth:2, corner:"tl" },
    // Photo circle placeholder — travel imagery framing
    { kind:"photo_circle", x:82, y:44, r:120, borderColor:"#00f0c8", borderWidth:3, opacity:0.12, shadow:false, bgColor:"rgba(255,255,255,0.08)" },
    // Play icon — video/travel content vibe
    { kind:"icon_symbol",  x:82, y:44, size:22, icon:"play", color:"rgba(255,255,255,0.3)", opacity:1 },
  ],
  ctaStyle:{ backgroundColor:"#00f0c8", textColor:"#012d6a", borderRadius:50, paddingH:40, paddingV:18, shadow:true },
  overlayOpacity:0.44, overlayColor:"#012d6a",
},

// ══════════════════════════════════════════════════════════════════════════════
// 8. CLEAN MINIMAL — Agency, portfolio, premium retail  (editorial white)
// ══════════════════════════════════════════════════════════════════════════════
{
  id:"clean_minimal", name:"Clean Minimal",
  tones:["minimal","professional","luxury"], colorMoods:["light","muted","monochrome"],
  headlineSizeMultiplier:1.32,
  palette:{ background:"#f8f7f4", surface:"rgba(0,0,0,0.03)", primary:"#191919",
    secondary:"#e63946", text:"#111111", textMuted:"#6f6f6f", highlight:"#e63946" },
  background:{ kind:"solid", color:"#f8f7f4" },
  typography:{
    display:"Cormorant Garamond", body:"DM Sans",
    headline: { fontFamily:"Cormorant Garamond", fontWeight:700, color:"#111111", letterSpacing:-0.01, fontSizeMultiplier:1.32 },
    subhead:  { fontFamily:"DM Sans",            fontWeight:400, color:"#6f6f6f", letterSpacing:0.03 },
    body_text:{ fontFamily:"DM Sans",            fontWeight:400, color:"#505050" },
    cta:      { fontFamily:"DM Sans",            fontWeight:700, color:"#f8f7f4", letterSpacing:0.07 },
    badge:    { fontFamily:"DM Sans",            fontWeight:700, color:"#e63946", textTransform:"uppercase", letterSpacing:0.2 },
    eyebrow:  { fontFamily:"DM Sans",            fontWeight:400, color:"#aaaaaa", textTransform:"uppercase", letterSpacing:0.3 },
  },
  decorations:[
    // Red accent left bar
    { kind:"accent_bar",  x:0,   y:0,   w:0.65, h:48, color:"#e63946", rx:0 },
    // Top rule
    { kind:"rect",        x:0,   y:0,   w:100,  h:0.5, color:"#111111", opacity:0.75, rx:0 },
    // Bottom rule
    { kind:"line",        x1:4,  y1:95.5,x2:96,y2:95.5, color:"#111111", opacity:0.12, width:1 },
    // Dot matrix bottom-right
    { kind:"dots_grid",   x:74,  y:67,  cols:4, rows:5, gap:14, r:2.2, color:"#e63946", opacity:0.2 },
    // Ghost ring (depth) off-canvas
    { kind:"deco_ring",   x:90,  y:-4,  r:165, color:"#111111", opacity:0.12, strokeWidth:28 },
    // Squiggle accent
    { kind:"squiggle",    x:70,  y:87,  w:24, color:"#e63946", opacity:0.5, strokeWidth:2.8 },
    // Card behind body text
    { kind:"card_panel",  x:5,   y:57,  w:90,  h:27, color:"rgba(255,255,255,0.68)", opacity:1, rx:6 },
    // Corner bracket
    { kind:"corner_bracket", x:96, y:95, size:20, color:"#111111", opacity:0.12, strokeWidth:1.5, corner:"br" },
    // Frame border — editorial framing
    { kind:"frame_border", x:3, y:3, w:94, h:94, color:"#111111", opacity:0.06, strokeWidth:0.8, gap:6, rx:0 },
    // Section divider with circle ornament
    { kind:"section_divider", x:10, y:54, w:80, color:"#e63946", opacity:0.25, strokeWidth:0.8, ornament:"circle" },
  ],
  ctaStyle:{ backgroundColor:"#191919", textColor:"#f8f7f4", borderRadius:0, paddingH:36, paddingV:16 },
  overlayOpacity:0.0, overlayColor:"#000000",
},

// ══════════════════════════════════════════════════════════════════════════════
// 9. SUNSET WARM — Food, beverage, lifestyle  (red-amber gradient)
// ══════════════════════════════════════════════════════════════════════════════
{
  id:"sunset_warm", name:"Sunset Warm",
  tones:["energetic","bold","urgent","warm"], colorMoods:["warm","vibrant"],
  headlineSizeMultiplier:1.34,
  palette:{ background:"#bf3000", surface:"rgba(255,255,255,0.1)", primary:"#ff6b35",
    secondary:"#ffa726", text:"#ffffff", textMuted:"rgba(255,255,255,0.78)", highlight:"#ffca28" },
  background:{ kind:"linear_gradient", colors:["#bf3000","#e53935","#f57c00"], angle:148 },
  typography:{
    display:"Raleway", body:"Lato",
    headline: { fontFamily:"Raleway",    fontWeight:900, color:"#ffffff",  letterSpacing:-0.025, fontSizeMultiplier:1.34 },
    subhead:  { fontFamily:"Lato",       fontWeight:400, color:"rgba(255,255,255,0.88)" },
    body_text:{ fontFamily:"Lato",       fontWeight:400, color:"rgba(255,255,255,0.75)" },
    cta:      { fontFamily:"Raleway",    fontWeight:800, color:"#bf3000",  textTransform:"uppercase" },
    badge:    { fontFamily:"Montserrat", fontWeight:700, color:"#ffffff",  textTransform:"uppercase", letterSpacing:0.16 },
    eyebrow:  { fontFamily:"Montserrat", fontWeight:600, color:"#ffca28",  textTransform:"uppercase", letterSpacing:0.22 },
  },
  decorations:[
    // Corner circles
    { kind:"circle",    x:92,  y:-8,  r:195, color:"rgba(255,255,255,0.14)", opacity:1 },
    { kind:"circle",    x:-8,  y:92,  r:120, color:"rgba(255,255,255,0.10)", opacity:1 },
    // White rings
    { kind:"deco_ring", x:82,  y:8,   r:52,  color:"rgba(255,255,255,0.32)", opacity:1, strokeWidth:2.2 },
    { kind:"deco_ring", x:82,  y:8,   r:68,  color:"rgba(255,255,255,0.14)", opacity:1, strokeWidth:1.2 },
    // Amber bottom bar
    { kind:"rect",      x:0,   y:94,  w:100, h:6,  color:"#ffca28", opacity:0.88, rx:0 },
    // Cross accent
    { kind:"cross",     x:7,   y:7,   size:18, thickness:2.8, color:"rgba(255,255,255,0.48)", opacity:1, rotation:45 },
    // Dot grid
    { kind:"dots_grid", x:4,   y:66,  cols:4, rows:4, gap:13, r:2.5, color:"#ffca28", opacity:0.35 },
    // Diagonal band subtle
    { kind:"diagonal_band", color:"rgba(255,255,255,0.08)", opacity:1, angle:35, thickness:18 },
    // Ribbon — promo corner badge
    { kind:"ribbon", x:72, y:2, w:28, h:28, color:"#ffca28", text:"HOT", textColor:"#bf3000", fontSize:13, opacity:0.85, corner:"tr" },
    // Starburst behind headline
    { kind:"starburst", x:50, y:28, r:380, rays:20, color:"rgba(255,255,255,0.03)", opacity:1, rotation:5 },
  ],
  ctaStyle:{ backgroundColor:"#ffffff", textColor:"#bf3000", borderRadius:50, paddingH:36, paddingV:16, shadow:true },
  overlayOpacity:0.28, overlayColor:"#000000",
},

// ══════════════════════════════════════════════════════════════════════════════
// 10. SAGE WELLNESS — Health, yoga, natural products  (muted sage)
// ══════════════════════════════════════════════════════════════════════════════
{
  id:"sage_wellness", name:"Sage Wellness",
  tones:["minimal","warm","playful"], colorMoods:["muted","light"],
  headlineSizeMultiplier:1.2,
  palette:{ background:"#ecf3ed", surface:"rgba(255,255,255,0.78)", primary:"#276749",
    secondary:"#6ab187", text:"#1a3d2a", textMuted:"#4a7260", highlight:"#276749" },
  background:{ kind:"linear_gradient", colors:["#ecf3ed","#d6eada","#ecf3ed"], angle:142 },
  typography:{
    display:"DM Sans", body:"Lato",
    headline: { fontFamily:"DM Sans", fontWeight:700, color:"#1a3d2a", letterSpacing:-0.02, fontSizeMultiplier:1.2 },
    subhead:  { fontFamily:"Lato",    fontWeight:400, color:"#4a7260" },
    body_text:{ fontFamily:"Lato",    fontWeight:400, color:"#4a7260" },
    cta:      { fontFamily:"DM Sans", fontWeight:700, color:"#ffffff", textTransform:"uppercase" },
    badge:    { fontFamily:"DM Sans", fontWeight:600, color:"#276749", textTransform:"uppercase", letterSpacing:0.16 },
    eyebrow:  { fontFamily:"DM Sans", fontWeight:600, color:"#6ab187", textTransform:"uppercase", letterSpacing:0.24 },
  },
  decorations:[
    // Organic blobs
    { kind:"blob",      x:88,  y:-5,  size:230, color:"rgba(39,103,73,0.09)",   opacity:1, seed:7 },
    { kind:"blob",      x:-4,  y:82,  size:175, color:"rgba(106,177,135,0.11)", opacity:1, seed:23 },
    // Botanical flowers
    { kind:"flower",    x:90,  y:7,   r:32, petals:6, color:"#6ab187", opacity:0.48 },
    { kind:"flower",    x:4,   y:88,  r:22, petals:5, color:"#276749", opacity:0.32 },
    { kind:"flower",    x:92,  y:78,  r:16, petals:8, color:"#276749", opacity:0.18 },
    // Card behind body text
    { kind:"card_panel",x:5,   y:56,  w:90, h:26, color:"rgba(255,255,255,0.75)", opacity:1, rx:16 },
    // Ring accent
    { kind:"deco_ring", x:86,  y:86,  r:36, color:"#276749", opacity:0.14, strokeWidth:1.2 },
    // Short accent line under eyebrow
    { kind:"line",      x1:6,  y1:14, x2:22, y2:14, color:"#6ab187", opacity:0.55, width:2 },
    // Checklist for wellness tips
    { kind:"checklist", x:8, y:60, w:42, items:["Mindful","Balanced","Renewed"], color:"#1a3d2a", checkColor:"#276749", fontSize:12, opacity:0.45 },
    // Section divider
    { kind:"section_divider", x:15, y:54, w:70, color:"#6ab187", opacity:0.22, strokeWidth:0.8, ornament:"dot" },
  ],
  ctaStyle:{ backgroundColor:"#276749", textColor:"#ffffff", borderRadius:50, paddingH:32, paddingV:14 },
  overlayOpacity:0.0, overlayColor:"#ffffff",
},

// ══════════════════════════════════════════════════════════════════════════════
// 11. NAVY PRO — Finance, consulting, B2B SaaS  (corporate navy)
// ══════════════════════════════════════════════════════════════════════════════
{
  id:"navy_pro", name:"Navy Pro",
  tones:["professional","bold","minimal"], colorMoods:["dark","cool","muted"],
  headlineSizeMultiplier:1.36,
  palette:{ background:"#091525", surface:"rgba(255,255,255,0.05)", primary:"#0ea5e9",
    secondary:"#38bdf8", text:"#ffffff", textMuted:"rgba(255,255,255,0.46)", highlight:"#0ea5e9" },
  background:{ kind:"linear_gradient", colors:["#091525","#0d2444","#091525"], angle:153 },
  typography:{
    display:"Montserrat", body:"Lato",
    headline: { fontFamily:"Montserrat", fontWeight:900, color:"#ffffff",  letterSpacing:-0.025, fontSizeMultiplier:1.36 },
    subhead:  { fontFamily:"Lato",       fontWeight:300, color:"rgba(255,255,255,0.5)", letterSpacing:0.07 },
    body_text:{ fontFamily:"Lato",       fontWeight:400, color:"rgba(255,255,255,0.4)" },
    cta:      { fontFamily:"Montserrat", fontWeight:800, color:"#091525", textTransform:"uppercase", letterSpacing:0.1 },
    badge:    { fontFamily:"Montserrat", fontWeight:700, color:"#0ea5e9", textTransform:"uppercase", letterSpacing:0.22 },
    eyebrow:  { fontFamily:"Montserrat", fontWeight:700, color:"#0ea5e9", textTransform:"uppercase", letterSpacing:0.28 },
  },
  decorations:[
    // Dense dot matrix (data/grid feel)
    { kind:"dots_grid",   x:58,  y:0,   cols:12,rows:9, gap:17, r:2, color:"#0ea5e9", opacity:0.2 },
    // Blue bottom bar
    { kind:"rect",        x:0,   y:95,  w:100,  h:5,  color:"#0ea5e9", opacity:0.85, rx:0 },
    // Left vertical rule
    { kind:"line",        x1:4,  y1:5,  x2:4,  y2:94, color:"#0ea5e9", opacity:0.38, width:3.5 },
    // Ambient glow
    { kind:"glow_circle", x:86,  y:14,  r:220, color:"#0ea5e9", opacity:0.2 },
    // Cross accents
    { kind:"cross",       x:92,  y:8,   size:17, thickness:2.2, color:"#0ea5e9", opacity:0.6, rotation:0 },
    { kind:"cross",       x:7,   y:88,  size:11, thickness:1.8, color:"#38bdf8", opacity:0.38, rotation:45 },
    // Dashed ring
    { kind:"deco_ring",   x:86,  y:14,  r:62, color:"#0ea5e9", opacity:0.22, strokeWidth:1.5, dash:6 },
    // Corner bracket
    { kind:"corner_bracket", x:96, y:4, size:22, color:"#0ea5e9", opacity:0.45, strokeWidth:2, corner:"tr" },
    // Checklist — SaaS feature list feel
    { kind:"checklist", x:8, y:58, w:40, items:["Analytics","Dashboard","Reports"], color:"rgba(255,255,255,0.5)", checkColor:"#0ea5e9", fontSize:12, opacity:0.55 },
    // Texture fill — tech grid feel
    { kind:"texture_fill", x:60, y:0, w:40, h:100, pattern:"lines", color:"rgba(14,165,233,0.04)", opacity:1, scale:3 },
  ],
  ctaStyle:{ backgroundColor:"#0ea5e9", textColor:"#091525", borderRadius:4, paddingH:36, paddingV:16, shadow:true },
  overlayOpacity:0.54, overlayColor:"#091525",
},

// ══════════════════════════════════════════════════════════════════════════════
// 12. MODERN EDITORIAL — Magazine, publishing, high fashion  (warm off-white)
// ══════════════════════════════════════════════════════════════════════════════
{
  id:"modern_editorial", name:"Modern Editorial",
  tones:["bold","minimal","professional"], colorMoods:["light","muted"],
  headlineSizeMultiplier:1.42,
  palette:{ background:"#f1ece3", surface:"rgba(0,0,0,0.03)", primary:"#1a1a1a",
    secondary:"#cc2936", text:"#0f0f0f", textMuted:"#7a7a7a", highlight:"#cc2936" },
  background:{ kind:"solid", color:"#f1ece3" },
  typography:{
    display:"Oswald", body:"Lato",
    headline: { fontFamily:"Oswald",     fontWeight:700, color:"#0f0f0f", textTransform:"uppercase", letterSpacing:0.02, fontSizeMultiplier:1.42 },
    subhead:  { fontFamily:"Lato",       fontWeight:400, color:"#7a7a7a", letterSpacing:0.05 },
    body_text:{ fontFamily:"Lato",       fontWeight:400, color:"#555555" },
    cta:      { fontFamily:"Oswald",     fontWeight:700, color:"#f1ece3", textTransform:"uppercase", letterSpacing:0.12 },
    badge:    { fontFamily:"Montserrat", fontWeight:600, color:"#cc2936", textTransform:"uppercase", letterSpacing:0.22 },
    eyebrow:  { fontFamily:"Montserrat", fontWeight:600, color:"#aaaaaa", textTransform:"uppercase", letterSpacing:0.28 },
  },
  decorations:[
    // Red left accent bar (magazine-style)
    { kind:"accent_bar",  x:0,   y:0,   w:1.0, h:48, color:"#cc2936", rx:0 },
    // Top rule
    { kind:"rect",        x:0,   y:0,   w:100, h:0.6, color:"#0f0f0f", opacity:0.85, rx:0 },
    // Bottom rule
    { kind:"line",        x1:4,  y1:96, x2:72, y2:96, color:"#0f0f0f", opacity:0.2,  width:1 },
    // Dot matrix
    { kind:"dots_grid",   x:74,  y:66,  cols:4, rows:5, gap:14, r:2.2, color:"#cc2936", opacity:0.2 },
    // Ghost ring
    { kind:"deco_ring",   x:90,  y:-4,  r:168, color:"#0f0f0f", opacity:0.12, strokeWidth:30 },
    // Squiggle
    { kind:"squiggle",    x:68,  y:86,  w:26, color:"#cc2936", opacity:0.55, strokeWidth:2.8 },
    // Card behind body text
    { kind:"card_panel",  x:4,   y:57,  w:92,  h:30, color:"rgba(255,255,255,0.58)", opacity:1, rx:4 },
    // Corner bracket bottom-right
    { kind:"corner_bracket", x:96, y:96, size:22, color:"#0f0f0f", opacity:0.15, strokeWidth:1.5, corner:"br" },
    // Frame border — magazine page feel
    { kind:"frame_border", x:2, y:2, w:96, h:96, color:"#0f0f0f", opacity:0.06, strokeWidth:0.8, gap:5, rx:0 },
    // Banner strip — section highlight
    { kind:"banner_strip", x:0, y:45, w:100, h:4, color:"#cc2936", text:"", textColor:"#f1ece3", fontSize:0, opacity:0.08 },
  ],
  ctaStyle:{ backgroundColor:"#1a1a1a", textColor:"#f1ece3", borderRadius:0, paddingH:36, paddingV:16 },
  overlayOpacity:0.0, overlayColor:"#000000",
},

// ══════════════════════════════════════════════════════════════════════════════
// 13. PEACH BLISS — Self-care, beauty, wellness tips  (warm peach-to-coral)
// ══════════════════════════════════════════════════════════════════════════════
{
  id:"peach_bliss", name:"Peach Bliss",
  tones:["warm","playful","minimal"], colorMoods:["warm","light","muted"],
  headlineSizeMultiplier:1.24,
  palette:{ background:"#fff5ee", surface:"rgba(255,255,255,0.85)", primary:"#e8734a",
    secondary:"#f4a574", text:"#3d1e0e", textMuted:"#8b5e4b", highlight:"#e8734a" },
  background:{ kind:"linear_gradient", colors:["#fff5ee","#ffe8d6","#ffdbc4"], angle:155 },
  typography:{
    display:"Nunito", body:"Lato",
    headline: { fontFamily:"Nunito", fontWeight:800, color:"#3d1e0e", letterSpacing:-0.015, fontSizeMultiplier:1.24 },
    subhead:  { fontFamily:"Lato",   fontWeight:400, color:"#8b5e4b", letterSpacing:0.03 },
    body_text:{ fontFamily:"Lato",   fontWeight:400, color:"#8b5e4b" },
    cta:      { fontFamily:"Nunito", fontWeight:700, color:"#ffffff" },
    badge:    { fontFamily:"Nunito", fontWeight:700, color:"#e8734a", textTransform:"uppercase", letterSpacing:0.16 },
    eyebrow:  { fontFamily:"Nunito", fontWeight:600, color:"#f4a574", textTransform:"uppercase", letterSpacing:0.24 },
  },
  decorations:[
    // Soft corner blobs
    { kind:"blob",       x:88,  y:-4,  size:280, color:"rgba(232,115,74,0.1)",  opacity:1, seed:31 },
    { kind:"blob",       x:-6,  y:86,  size:220, color:"rgba(244,165,116,0.12)", opacity:1, seed:53 },
    // Warm circles
    { kind:"circle",     x:92,  y:6,   r:120, color:"rgba(232,115,74,0.08)", opacity:1 },
    { kind:"circle",     x:5,   y:90,  r:90,  color:"rgba(244,165,116,0.1)", opacity:1 },
    // Decorative flowers
    { kind:"flower",     x:90,  y:8,   r:36, petals:7, color:"#f4a574", opacity:0.5 },
    { kind:"flower",     x:6,   y:86,  r:24, petals:5, color:"#e8734a", opacity:0.35 },
    // Card panel behind body
    { kind:"card_panel", x:5,   y:56,  w:90, h:28, color:"rgba(255,255,255,0.75)", opacity:1, rx:16 },
    // Short accent line
    { kind:"line",       x1:6,  y1:14, x2:24, y2:14, color:"#e8734a", opacity:0.5, width:2.5 },
    // Corner dots
    { kind:"dots_grid",  x:4,   y:4,   cols:3, rows:3, gap:12, r:2.2, color:"#e8734a", opacity:0.2 },
    // Squiggle accent
    { kind:"squiggle",   x:68,  y:86,  w:22, color:"#f4a574", opacity:0.5, strokeWidth:2.5 },
    // Heart icon — beauty/self-care feel
    { kind:"icon_symbol", x:50, y:4, size:12, icon:"heart", color:"#e8734a", opacity:0.3 },
    // Sticker circle
    { kind:"sticker_circle", x:88, y:82, r:36, color:"#e8734a", text:"TIP", textColor:"#ffffff", fontSize:13, rotation:-12, opacity:0.55 },
  ],
  ctaStyle:{ backgroundColor:"#e8734a", textColor:"#ffffff", borderRadius:50, paddingH:34, paddingV:15, shadow:true },
  overlayOpacity:0.0, overlayColor:"#000000",
},

// ══════════════════════════════════════════════════════════════════════════════
// 14. TROPICAL PARADISE — Travel, summer, vacation  (teal-to-yellow gradient)
// ══════════════════════════════════════════════════════════════════════════════
{
  id:"tropical_paradise", name:"Tropical Paradise",
  tones:["energetic","playful","bold"], colorMoods:["vibrant","warm","light"],
  headlineSizeMultiplier:1.36,
  palette:{ background:"#006d5b", surface:"rgba(255,255,255,0.12)", primary:"#00b894",
    secondary:"#fdcb6e", text:"#ffffff", textMuted:"rgba(255,255,255,0.82)", highlight:"#fdcb6e" },
  background:{ kind:"mesh", colors:["#006d5b","#00b894","#009688"] },
  typography:{
    display:"Poppins", body:"Lato",
    headline: { fontFamily:"Poppins",    fontWeight:900, color:"#ffffff", letterSpacing:-0.02, fontSizeMultiplier:1.36 },
    subhead:  { fontFamily:"Lato",       fontWeight:400, color:"rgba(255,255,255,0.9)" },
    body_text:{ fontFamily:"Lato",       fontWeight:400, color:"rgba(255,255,255,0.78)" },
    cta:      { fontFamily:"Poppins",    fontWeight:700, color:"#006d5b", textTransform:"uppercase" },
    badge:    { fontFamily:"Montserrat", fontWeight:700, color:"#ffffff", textTransform:"uppercase", letterSpacing:0.14 },
    eyebrow:  { fontFamily:"Montserrat", fontWeight:600, color:"#fdcb6e", textTransform:"uppercase", letterSpacing:0.22 },
  },
  decorations:[
    // Sun circle top-right
    { kind:"circle",     x:88,  y:-5,  r:200, color:"rgba(253,203,110,0.18)", opacity:1 },
    { kind:"glow_circle",x:88,  y:5,   r:160, color:"#fdcb6e", opacity:0.12 },
    // Yellow ring accents
    { kind:"deco_ring",  x:86,  y:10,  r:55,  color:"#fdcb6e", opacity:0.5,  strokeWidth:2.2 },
    { kind:"deco_ring",  x:86,  y:10,  r:72,  color:"#fdcb6e", opacity:0.22, strokeWidth:1, dash:5 },
    // Wave forms at bottom (ocean effect)
    { kind:"wave",       x:0,   y:84,  w:100, amplitude:6, frequency:3, color:"rgba(255,255,255,0.14)", opacity:1, strokeWidth:0 },
    { kind:"wave",       x:0,   y:90,  w:100, amplitude:4, frequency:4, color:"rgba(255,255,255,0.1)",  opacity:1, strokeWidth:0 },
    // Bottom gold bar
    { kind:"rect",       x:0,   y:95.5,w:100, h:4.5, color:"#fdcb6e", opacity:0.85, rx:0 },
    // Cross accents
    { kind:"cross",      x:7,   y:8,   size:18, thickness:2.8, color:"rgba(255,255,255,0.4)", opacity:1, rotation:45 },
    // Dot grid bottom-left
    { kind:"dots_grid",  x:4,   y:68,  cols:4, rows:4, gap:14, r:2.5, color:"#fdcb6e", opacity:0.32 },
    // Corner bracket
    { kind:"corner_bracket", x:5, y:5, size:22, color:"#fdcb6e", opacity:0.5, strokeWidth:2, corner:"tl" },
    // Photo circle — travel destination imagery
    { kind:"photo_circle", x:80, y:40, r:130, borderColor:"#fdcb6e", borderWidth:3, opacity:0.1, shadow:false, bgColor:"rgba(255,255,255,0.06)" },
    // Sticker circle — travel promo
    { kind:"sticker_circle", x:14, y:82, r:40, color:"#fdcb6e", text:"GO!", textColor:"#006d5b", fontSize:15, rotation:15, opacity:0.6 },
  ],
  ctaStyle:{ backgroundColor:"#fdcb6e", textColor:"#006d5b", borderRadius:50, paddingH:38, paddingV:16, shadow:true },
  overlayOpacity:0.22, overlayColor:"#004d40",
},

// ══════════════════════════════════════════════════════════════════════════════
// 15. RETRO POP — Fun, 90s vibe, social media tips  (pink + yellow + purple)
// ══════════════════════════════════════════════════════════════════════════════
{
  id:"retro_pop", name:"Retro Pop",
  tones:["playful","energetic","bold"], colorMoods:["vibrant","warm","light"],
  headlineSizeMultiplier:1.38,
  palette:{ background:"#ffe0f0", surface:"rgba(255,255,255,0.6)", primary:"#ff2d87",
    secondary:"#ffd23f", text:"#2d0033", textMuted:"#7a3d6e", highlight:"#ff2d87" },
  background:{ kind:"linear_gradient", colors:["#ffe0f0","#fff0e0","#ffe0f0"], angle:135 },
  typography:{
    display:"Montserrat", body:"Nunito",
    headline: { fontFamily:"Montserrat", fontWeight:900, color:"#2d0033", letterSpacing:-0.02, fontSizeMultiplier:1.38 },
    subhead:  { fontFamily:"Nunito",     fontWeight:400, color:"#7a3d6e" },
    body_text:{ fontFamily:"Nunito",     fontWeight:400, color:"#7a3d6e" },
    cta:      { fontFamily:"Montserrat", fontWeight:800, color:"#ffffff", textTransform:"uppercase" },
    badge:    { fontFamily:"Montserrat", fontWeight:700, color:"#ff2d87", textTransform:"uppercase", letterSpacing:0.16 },
    eyebrow:  { fontFamily:"Montserrat", fontWeight:700, color:"#ff2d87", textTransform:"uppercase", letterSpacing:0.24 },
  },
  decorations:[
    // Big colorful circles
    { kind:"circle",     x:90,  y:-6,  r:180, color:"rgba(255,45,135,0.12)", opacity:1 },
    { kind:"circle",     x:-6,  y:88,  r:140, color:"rgba(255,210,63,0.18)", opacity:1 },
    { kind:"circle",     x:50,  y:50,  r:380, color:"rgba(168,85,247,0.04)", opacity:1 },
    // Yellow accent shapes
    { kind:"rect",       x:0,   y:94,  w:100, h:6,  color:"#ffd23f", opacity:0.85, rx:0 },
    { kind:"accent_bar", x:0,   y:0,   w:100, h:0.6, color:"#ff2d87", rx:0 },
    // Dot grid pattern
    { kind:"dots_grid",  x:72,  y:4,   cols:5, rows:5, gap:14, r:3, color:"#ff2d87", opacity:0.2 },
    { kind:"dots_grid",  x:4,   y:68,  cols:4, rows:4, gap:13, r:2.5, color:"#ffd23f", opacity:0.3 },
    // Fun cross accents
    { kind:"cross",      x:88,  y:88,  size:16, thickness:3, color:"#ff2d87", opacity:0.5, rotation:45 },
    { kind:"cross",      x:8,   y:8,   size:14, thickness:2.5, color:"#ffd23f", opacity:0.55, rotation:0 },
    // Card panel
    { kind:"card_panel", x:5,   y:56,  w:90, h:28, color:"rgba(255,255,255,0.72)", opacity:1, rx:18 },
    // Squiggle
    { kind:"squiggle",   x:62,  y:86,  w:28, color:"#ff2d87", opacity:0.45, strokeWidth:3 },
    // Starburst — retro pop accent
    { kind:"starburst",  x:86, y:50, r:80, rays:16, color:"rgba(255,45,135,0.1)", opacity:1, rotation:12 },
    // Sparkle icons scattered
    { kind:"icon_symbol", x:76, y:12, size:10, icon:"sparkle", color:"#ffd23f", opacity:0.55 },
    { kind:"icon_symbol", x:20, y:78, size:8,  icon:"sparkle", color:"#ff2d87", opacity:0.4 },
    // Confetti texture
    { kind:"texture_fill", x:0, y:0, w:100, h:100, pattern:"confetti", color:"rgba(255,45,135,0.05)", opacity:1, scale:5 },
  ],
  ctaStyle:{ backgroundColor:"#ff2d87", textColor:"#ffffff", borderRadius:50, paddingH:38, paddingV:16, shadow:true },
  overlayOpacity:0.0, overlayColor:"#000000",
},

// ══════════════════════════════════════════════════════════════════════════════
// 16. GOLDEN HOUR — Motivation, coaching, productivity  (warm amber-gold)
// ══════════════════════════════════════════════════════════════════════════════
{
  id:"golden_hour", name:"Golden Hour",
  tones:["warm","bold","professional"], colorMoods:["warm","vibrant","muted"],
  headlineSizeMultiplier:1.3,
  palette:{ background:"#1c1206", surface:"rgba(255,200,60,0.06)", primary:"#f0a500",
    secondary:"#ffd166", text:"#ffffff", textMuted:"rgba(255,255,255,0.62)", highlight:"#ffd166" },
  background:{ kind:"linear_gradient", colors:["#1c1206","#2d1e0e","#1c1206"], angle:150 },
  typography:{
    display:"Raleway", body:"Lato",
    headline: { fontFamily:"Raleway", fontWeight:900, color:"#ffffff", letterSpacing:-0.02, fontSizeMultiplier:1.3 },
    subhead:  { fontFamily:"Lato",    fontWeight:300, color:"rgba(255,255,255,0.6)", letterSpacing:0.08 },
    body_text:{ fontFamily:"Lato",    fontWeight:400, color:"rgba(255,255,255,0.5)" },
    cta:      { fontFamily:"Raleway", fontWeight:800, color:"#1c1206", textTransform:"uppercase", letterSpacing:0.08 },
    badge:    { fontFamily:"Raleway", fontWeight:700, color:"#ffd166", textTransform:"uppercase", letterSpacing:0.2 },
    eyebrow:  { fontFamily:"Lato",    fontWeight:400, color:"#ffd166", textTransform:"uppercase", letterSpacing:0.28 },
  },
  decorations:[
    // Amber glow
    { kind:"glow_circle", x:80,  y:16,  r:300, color:"#f0a500", opacity:0.18 },
    // Concentric gold rings
    { kind:"deco_ring",   x:85,  y:12,  r:55,  color:"#ffd166", opacity:0.5,  strokeWidth:1.8 },
    { kind:"deco_ring",   x:85,  y:12,  r:72,  color:"#f0a500", opacity:0.22, strokeWidth:1, dash:4 },
    { kind:"deco_ring",   x:85,  y:12,  r:92,  color:"#f0a500", opacity:0.1,  strokeWidth:0.8 },
    // Left gold bar
    { kind:"accent_bar",  x:0,   y:8,   w:0.6, h:82, color:"#f0a500", rx:0 },
    // Bottom gold line
    { kind:"rect",        x:0,   y:95,  w:100, h:5,  color:"#f0a500", opacity:0.8, rx:0 },
    // Dot matrix
    { kind:"dots_grid",   x:70,  y:70,  cols:5, rows:5, gap:13, r:1.4, color:"#ffd166", opacity:0.18 },
    // Arc accent
    { kind:"arc_stroke",  x:4,   y:6,   r:38, startAngle:90, endAngle:180, color:"#ffd166", opacity:0.28, strokeWidth:1.2 },
    // Diagonal band
    { kind:"diagonal_band", color:"rgba(240,165,0,0.06)", opacity:1, angle:32, thickness:20 },
    // Star icon — motivation/achievement
    { kind:"icon_symbol", x:92, y:48, size:16, icon:"star", color:"#ffd166", opacity:0.4 },
    // Section divider with star ornament
    { kind:"section_divider", x:12, y:52, w:76, color:"#ffd166", opacity:0.18, strokeWidth:0.8, ornament:"star" },
  ],
  ctaStyle:{ backgroundColor:"#f0a500", textColor:"#1c1206", borderRadius:4, paddingH:36, paddingV:16, shadow:true },
  overlayOpacity:0.48, overlayColor:"#1c1206",
},

// ══════════════════════════════════════════════════════════════════════════════
// 17. LAVENDER DREAM — Creativity, mindfulness, study tips  (soft purple pastel)
// ══════════════════════════════════════════════════════════════════════════════
{
  id:"lavender_dream", name:"Lavender Dream",
  tones:["minimal","warm","playful"], colorMoods:["light","cool","muted"],
  headlineSizeMultiplier:1.22,
  palette:{ background:"#f3edff", surface:"rgba(255,255,255,0.8)", primary:"#7c5cbf",
    secondary:"#b39ddb", text:"#1e0a3c", textMuted:"#6a4d8a", highlight:"#7c5cbf" },
  background:{ kind:"linear_gradient", colors:["#f3edff","#ede4ff","#f3edff"], angle:140 },
  typography:{
    display:"DM Sans", body:"Lato",
    headline: { fontFamily:"DM Sans", fontWeight:700, color:"#1e0a3c", letterSpacing:-0.015, fontSizeMultiplier:1.22 },
    subhead:  { fontFamily:"Lato",    fontWeight:400, color:"#6a4d8a" },
    body_text:{ fontFamily:"Lato",    fontWeight:400, color:"#6a4d8a" },
    cta:      { fontFamily:"DM Sans", fontWeight:700, color:"#ffffff", textTransform:"uppercase" },
    badge:    { fontFamily:"DM Sans", fontWeight:600, color:"#7c5cbf", textTransform:"uppercase", letterSpacing:0.16 },
    eyebrow:  { fontFamily:"DM Sans", fontWeight:600, color:"#b39ddb", textTransform:"uppercase", letterSpacing:0.24 },
  },
  decorations:[
    // Soft blobs
    { kind:"blob",       x:88,  y:-4,  size:250, color:"rgba(124,92,191,0.08)",  opacity:1, seed:19 },
    { kind:"blob",       x:-5,  y:84,  size:200, color:"rgba(179,157,219,0.1)",  opacity:1, seed:41 },
    // Flowers
    { kind:"flower",     x:90,  y:8,   r:30, petals:6, color:"#b39ddb", opacity:0.45 },
    { kind:"flower",     x:5,   y:88,  r:20, petals:5, color:"#7c5cbf", opacity:0.3 },
    // Card panel
    { kind:"card_panel", x:5,   y:56,  w:90, h:26, color:"rgba(255,255,255,0.78)", opacity:1, rx:16 },
    // Deco ring
    { kind:"deco_ring",  x:88,  y:86,  r:34, color:"#7c5cbf", opacity:0.16, strokeWidth:1.2 },
    // Short accent
    { kind:"line",       x1:6,  y1:14, x2:20, y2:14, color:"#7c5cbf", opacity:0.5, width:2 },
    // Dots
    { kind:"dots_grid",  x:4,   y:4,   cols:3, rows:3, gap:11, r:2, color:"#b39ddb", opacity:0.22 },
    // Squiggle
    { kind:"squiggle",   x:66,  y:86,  w:24, color:"#7c5cbf", opacity:0.42, strokeWidth:2.2 },
    // Top accent bar
    { kind:"accent_bar", x:0,   y:0,   w:100, h:0.5, color:"#7c5cbf", rx:0 },
    // Checklist — study/creativity tips
    { kind:"checklist", x:8, y:60, w:40, items:["Create","Learn","Grow"], color:"#1e0a3c", checkColor:"#7c5cbf", fontSize:12, opacity:0.4 },
    // Sparkle icons
    { kind:"icon_symbol", x:88, y:48, size:12, icon:"sparkle", color:"#b39ddb", opacity:0.38 },
    { kind:"icon_symbol", x:78, y:72, size:8, icon:"sparkle", color:"#7c5cbf", opacity:0.25 },
  ],
  ctaStyle:{ backgroundColor:"#7c5cbf", textColor:"#ffffff", borderRadius:50, paddingH:34, paddingV:14, shadow:true },
  overlayOpacity:0.0, overlayColor:"#000000",
},

// ══════════════════════════════════════════════════════════════════════════════
// 18. SKY FRESH — Fitness, health, hydration  (bright sky blue + white)
// ══════════════════════════════════════════════════════════════════════════════
{
  id:"sky_fresh", name:"Sky Fresh",
  tones:["energetic","bold","warm"], colorMoods:["cool","light","vibrant"],
  headlineSizeMultiplier:1.32,
  palette:{ background:"#e8f4fd", surface:"rgba(255,255,255,0.8)", primary:"#0288d1",
    secondary:"#4fc3f7", text:"#042a44", textMuted:"#3a6e8a", highlight:"#0288d1" },
  background:{ kind:"linear_gradient", colors:["#e8f4fd","#d4ecfb","#e8f4fd"], angle:145 },
  typography:{
    display:"Poppins", body:"Lato",
    headline: { fontFamily:"Poppins", fontWeight:800, color:"#042a44", letterSpacing:-0.02, fontSizeMultiplier:1.32 },
    subhead:  { fontFamily:"Lato",    fontWeight:400, color:"#3a6e8a" },
    body_text:{ fontFamily:"Lato",    fontWeight:400, color:"#3a6e8a" },
    cta:      { fontFamily:"Poppins", fontWeight:700, color:"#ffffff", textTransform:"uppercase" },
    badge:    { fontFamily:"Poppins", fontWeight:600, color:"#0288d1", textTransform:"uppercase", letterSpacing:0.14 },
    eyebrow:  { fontFamily:"Poppins", fontWeight:600, color:"#4fc3f7", textTransform:"uppercase", letterSpacing:0.22 },
  },
  decorations:[
    // Big soft circles
    { kind:"circle",     x:90,  y:-4,  r:200, color:"rgba(2,136,209,0.08)", opacity:1 },
    { kind:"circle",     x:-5,  y:88,  r:150, color:"rgba(79,195,247,0.1)", opacity:1 },
    // Wave shapes (fresh water feel)
    { kind:"wave",       x:0,   y:84,  w:100, amplitude:5, frequency:3, color:"rgba(2,136,209,0.12)", opacity:1, strokeWidth:0 },
    { kind:"wave",       x:0,   y:90,  w:100, amplitude:3, frequency:5, color:"rgba(79,195,247,0.08)", opacity:1, strokeWidth:0 },
    // Card panel
    { kind:"card_panel", x:5,   y:55,  w:90, h:28, color:"rgba(255,255,255,0.75)", opacity:1, rx:14 },
    // Ring accent
    { kind:"deco_ring",  x:86,  y:10,  r:48, color:"#0288d1", opacity:0.3, strokeWidth:2 },
    { kind:"deco_ring",  x:86,  y:10,  r:64, color:"#4fc3f7", opacity:0.14, strokeWidth:1, dash:4 },
    // Top accent
    { kind:"rect",       x:0,   y:0,   w:100, h:0.5, color:"#0288d1", opacity:0.6, rx:0 },
    // Bottom line
    { kind:"line",       x1:6,  y1:95, x2:50, y2:95, color:"#0288d1", opacity:0.35, width:2 },
    // Dots
    { kind:"dots_grid",  x:4,   y:4,   cols:4, rows:3, gap:14, r:2.2, color:"#4fc3f7", opacity:0.22 },
    // Arrow icon — fitness/action vibe
    { kind:"icon_symbol", x:92, y:50, size:16, icon:"arrow", color:"#0288d1", opacity:0.35 },
    // Photo circle — athlete/fitness imagery
    { kind:"photo_circle", x:78, y:38, r:110, borderColor:"#4fc3f7", borderWidth:2.5, opacity:0.1, shadow:false, bgColor:"rgba(2,136,209,0.05)" },
  ],
  ctaStyle:{ backgroundColor:"#0288d1", textColor:"#ffffff", borderRadius:50, paddingH:36, paddingV:16, shadow:true },
  overlayOpacity:0.0, overlayColor:"#000000",
},

// ══════════════════════════════════════════════════════════════════════════════
// 19. CORAL ENERGY — Marketing, food, lifestyle  (bold coral-to-pink)
// ══════════════════════════════════════════════════════════════════════════════
{
  id:"coral_energy", name:"Coral Energy",
  tones:["bold","energetic","urgent"], colorMoods:["vibrant","warm"],
  headlineSizeMultiplier:1.38,
  palette:{ background:"#ff6b6b", surface:"rgba(255,255,255,0.14)", primary:"#ff6b6b",
    secondary:"#feca57", text:"#ffffff", textMuted:"rgba(255,255,255,0.82)", highlight:"#feca57" },
  background:{ kind:"mesh", colors:["#ff6b6b","#ee5a24","#ff6b6b"] },
  typography:{
    display:"Montserrat", body:"Lato",
    headline: { fontFamily:"Montserrat", fontWeight:900, color:"#ffffff", letterSpacing:-0.025, fontSizeMultiplier:1.38 },
    subhead:  { fontFamily:"Lato",       fontWeight:400, color:"rgba(255,255,255,0.9)" },
    body_text:{ fontFamily:"Lato",       fontWeight:400, color:"rgba(255,255,255,0.78)" },
    cta:      { fontFamily:"Montserrat", fontWeight:800, color:"#ff6b6b", textTransform:"uppercase" },
    badge:    { fontFamily:"Montserrat", fontWeight:700, color:"#ffffff", textTransform:"uppercase", letterSpacing:0.16 },
    eyebrow:  { fontFamily:"Montserrat", fontWeight:700, color:"#feca57", textTransform:"uppercase", letterSpacing:0.22 },
  },
  decorations:[
    // Big white corner circles
    { kind:"circle",     x:92,  y:-8,  r:200, color:"rgba(255,255,255,0.12)", opacity:1 },
    { kind:"circle",     x:-8,  y:92,  r:140, color:"rgba(255,255,255,0.1)",  opacity:1 },
    // Yellow ring accents
    { kind:"deco_ring",  x:88,  y:8,   r:56,  color:"#feca57", opacity:0.55, strokeWidth:2.5 },
    { kind:"deco_ring",  x:88,  y:8,   r:74,  color:"#feca57", opacity:0.2,  strokeWidth:1.2, dash:5 },
    // Yellow bottom bar
    { kind:"rect",       x:0,   y:95,  w:100, h:5,  color:"#feca57", opacity:0.9, rx:0 },
    // Dot grid
    { kind:"dots_grid",  x:4,   y:68,  cols:5, rows:4, gap:14, r:2.8, color:"#feca57", opacity:0.35 },
    // Cross accents
    { kind:"cross",      x:7,   y:7,   size:18, thickness:3, color:"rgba(255,255,255,0.42)", opacity:1, rotation:45 },
    { kind:"cross",      x:88,  y:86,  size:13, thickness:2, color:"rgba(255,255,255,0.3)",  opacity:1, rotation:0 },
    // Diagonal band
    { kind:"diagonal_band", color:"rgba(255,255,255,0.06)", opacity:1, angle:38, thickness:22 },
    // Ribbon — promo/sale corner
    { kind:"ribbon", x:72, y:2, w:28, h:26, color:"#feca57", text:"SALE", textColor:"#ff6b6b", fontSize:12, opacity:0.8, corner:"tr" },
    // Price tag
    { kind:"price_tag", x:6, y:72, w:28, h:8, color:"rgba(255,255,255,0.2)", text:"$19.99", textColor:"#ffffff", fontSize:14, opacity:0.6 },
  ],
  ctaStyle:{ backgroundColor:"#ffffff", textColor:"#ff6b6b", borderRadius:50, paddingH:40, paddingV:18, shadow:true },
  overlayOpacity:0.18, overlayColor:"#000000",
},

// ══════════════════════════════════════════════════════════════════════════════
// 20. EARTH COFFEE — Café, books, cozy, artisan  (rich brown + cream)
// ══════════════════════════════════════════════════════════════════════════════
{
  id:"earth_coffee", name:"Earth Coffee",
  tones:["warm","professional","minimal"], colorMoods:["warm","muted","dark"],
  headlineSizeMultiplier:1.22,
  palette:{ background:"#2c1810", surface:"rgba(255,235,200,0.06)", primary:"#d4a574",
    secondary:"#e8c9a0", text:"#fff5e6", textMuted:"rgba(255,245,230,0.55)", highlight:"#d4a574" },
  background:{ kind:"linear_gradient", colors:["#2c1810","#3e2419","#2c1810"], angle:155 },
  typography:{
    display:"Playfair Display", body:"Lato",
    headline: { fontFamily:"Playfair Display", fontWeight:700, color:"#fff5e6", letterSpacing:-0.01, fontSizeMultiplier:1.22 },
    subhead:  { fontFamily:"Lato",             fontWeight:300, color:"rgba(255,245,230,0.58)", letterSpacing:0.1 },
    body_text:{ fontFamily:"Lato",             fontWeight:400, color:"rgba(255,245,230,0.45)" },
    cta:      { fontFamily:"Lato",             fontWeight:700, color:"#2c1810", letterSpacing:0.1 },
    badge:    { fontFamily:"Lato",             fontWeight:700, color:"#d4a574", textTransform:"uppercase", letterSpacing:0.22 },
    eyebrow:  { fontFamily:"Lato",             fontWeight:400, color:"#d4a574", textTransform:"uppercase", letterSpacing:0.28 },
  },
  decorations:[
    // Warm cream glow
    { kind:"glow_circle",  x:80,  y:18, r:280, color:"#d4a574", opacity:0.15 },
    // Cream rings
    { kind:"deco_ring",    x:86,  y:10, r:50,  color:"#d4a574", opacity:0.5,  strokeWidth:1.5 },
    { kind:"deco_ring",    x:86,  y:10, r:66,  color:"#d4a574", opacity:0.22, strokeWidth:1, dash:4 },
    { kind:"deco_ring",    x:86,  y:10, r:84,  color:"#d4a574", opacity:0.1,  strokeWidth:0.8 },
    // Left bar
    { kind:"accent_bar",   x:0,   y:10, w:0.55, h:78, color:"#d4a574", rx:0 },
    // Bottom rule
    { kind:"line",         x1:4,  y1:96, x2:96, y2:96, color:"#d4a574", opacity:0.22, width:0.8 },
    // Dot matrix
    { kind:"dots_grid",    x:72,  y:72, cols:5, rows:5, gap:13, r:1.2, color:"#d4a574", opacity:0.16 },
    // Arc
    { kind:"arc_stroke",   x:4,   y:6,  r:35, startAngle:90, endAngle:180, color:"#d4a574", opacity:0.22, strokeWidth:1 },
    // Noise overlay for texture
    { kind:"noise_overlay", opacity:0.04 },
    // Frame border — artisan feel
    { kind:"frame_border", x:4, y:4, w:92, h:92, color:"#d4a574", opacity:0.1, strokeWidth:0.8, gap:6, rx:2 },
    // Section divider with diamond
    { kind:"section_divider", x:15, y:52, w:70, color:"#d4a574", opacity:0.18, strokeWidth:0.8, ornament:"diamond" },
  ],
  ctaStyle:{ backgroundColor:"#d4a574", textColor:"#2c1810", borderRadius:4, paddingH:36, paddingV:15 },
  overlayOpacity:0.42, overlayColor:"#2c1810",
},

// ══════════════════════════════════════════════════════════════════════════════
// 21. SCRIPT ELEGANCE — Wellness, self-care, lifestyle  (cursive headline, Step 64)
// ══════════════════════════════════════════════════════════════════════════════
{
  id:"script_elegance", name:"Script Elegance",
  tones:["warm","minimal","professional"], colorMoods:["muted","warm","light"],
  headlineSizeMultiplier:1.55,
  palette:{ background:"#fdf6ef", surface:"rgba(120,75,60,0.06)", primary:"#b46a55",
    secondary:"#6a8a6e", text:"#2e2420", textMuted:"rgba(46,36,32,0.55)", highlight:"#c9a46a" },
  background:{ kind:"linear_gradient", colors:["#fdf6ef","#f6ead9"], angle:165 },
  typography:{
    display:"Dancing Script", body:"Lato",
    headline: { fontFamily:"Dancing Script", fontWeight:700, color:"#2e2420", letterSpacing:-0.005, fontSizeMultiplier:1.55 },
    subhead:  { fontFamily:"Lato",           fontWeight:400, color:"rgba(46,36,32,0.70)", letterSpacing:0.04 },
    body_text:{ fontFamily:"Lato",           fontWeight:400, color:"rgba(46,36,32,0.60)" },
    cta:      { fontFamily:"Lato",           fontWeight:700, color:"#fdf6ef", letterSpacing:0.1 },
    badge:    { fontFamily:"Lato",           fontWeight:700, color:"#b46a55", textTransform:"uppercase", letterSpacing:0.22 },
    eyebrow:  { fontFamily:"Lato",           fontWeight:400, color:"#6a8a6e", textTransform:"uppercase", letterSpacing:0.28 },
  },
  decorations:[
    // Soft wash of warm cream behind headline
    { kind:"glow_circle",  x:50, y:30, r:260, color:"#f2dcc3", opacity:0.55 },
    // Corner botanical strokes — framing language for the script headline
    { kind:"arc_stroke",   x:8,  y:6,  r:40, startAngle:120, endAngle:220, color:"#6a8a6e", opacity:0.35, strokeWidth:1.4 },
    { kind:"arc_stroke",   x:92, y:94, r:40, startAngle:300, endAngle:40,  color:"#b46a55", opacity:0.35, strokeWidth:1.4 },
    // Delicate thin frame
    { kind:"frame_border", x:5, y:5, w:90, h:90, color:"#b46a55", opacity:0.22, strokeWidth:0.6, gap:4, rx:3 },
    // Typographic ornament divider between headline + body
    { kind:"section_divider", x:30, y:52, w:40, color:"#c9a46a", opacity:0.55, strokeWidth:0.8, ornament:"diamond" },
    // Tiny flourish accents
    { kind:"squiggle",     x:12, y:88, w:16, color:"#6a8a6e", opacity:0.45, strokeWidth:1.2 },
    { kind:"squiggle",     x:72, y:12, w:16, color:"#b46a55", opacity:0.45, strokeWidth:1.2 },
    // Subtle noise to break flat wash
    { kind:"noise_overlay", opacity:0.03 },
  ],
  ctaStyle:{ backgroundColor:"#b46a55", textColor:"#fdf6ef", borderRadius:28, paddingH:36, paddingV:14 },
  overlayOpacity:0, overlayColor:"#fdf6ef",
},

// ══════════════════════════════════════════════════════════════════════════════
// 22. TRAVEL VISTA — Travel, outdoors, adventure  (mountain+lake scene, Step 65)
// Hero headline over a painted landscape. Matches "Travel Inspiration" /
// "Stress Relief Methods" / "Workout of the Day" in the reference pack.
// ══════════════════════════════════════════════════════════════════════════════
{
  id:"travel_vista", name:"Travel Vista",
  tones:["professional","minimal","warm"], colorMoods:["cool","light","muted"],
  headlineSizeMultiplier:1.38,
  palette:{ background:"#b9d9eb", surface:"rgba(255,255,255,0.22)", primary:"#2f5d7c",
    secondary:"#f4a259", text:"#ffffff", textMuted:"rgba(255,255,255,0.85)", highlight:"#fcd27b" },
  // palette index map for the scene: 0=sky top, 1=sky bot, 2=far mtn, 3=near mtn,
  //   4=lake top, 5=lake bot, 6=sun
  background:{ kind:"scene", scene:"mountain_lake",
    palette:["#9ec8e3","#f2d6b2","#6b8eb1","#2c3e50","#a5c4dd","#486b8a","#fcd27b"],
    atmosphere:"dusk" },
  typography:{
    display:"Playfair Display", body:"Lato",
    headline: { fontFamily:"Playfair Display", fontWeight:700, color:"#ffffff", letterSpacing:-0.01, fontSizeMultiplier:1.38 },
    subhead:  { fontFamily:"Lato",             fontWeight:400, color:"rgba(255,255,255,0.92)", letterSpacing:0.04 },
    body_text:{ fontFamily:"Lato",             fontWeight:400, color:"rgba(255,255,255,0.85)" },
    cta:      { fontFamily:"Lato",             fontWeight:700, color:"#2f5d7c",  letterSpacing:0.08 },
    badge:    { fontFamily:"Lato",             fontWeight:700, color:"#ffffff",  textTransform:"uppercase", letterSpacing:0.2 },
    eyebrow:  { fontFamily:"Lato",             fontWeight:600, color:"#fcd27b",  textTransform:"uppercase", letterSpacing:0.28 },
  },
  decorations:[
    // Torn-paper window behind headline so it floats over the scene
    { kind:"torn_paper_frame", x:12, y:18, w:76, h:40, color:"#fdfaf2", shadowColor:"#000000", opacity:0.92, seed:911 },
    // Foliage silhouette at bottom for immersive foreground
    { kind:"foliage_silhouette", anchor:"bottom", palette:["#1e3a2a","#2c5139","#3d6a49"], density:14, height:12, opacity:0.9 },
    // Subtle botanical corner flourish
    { kind:"watercolor_corner", corner:"tr", size:22, palette:["#f4d7ae","#6b8eb1","#f4a259"], opacity:0.55 },
    { kind:"noise_overlay", opacity:0.035 },
  ],
  ctaStyle:{ backgroundColor:"#ffffff", textColor:"#2f5d7c", borderRadius:50, paddingH:40, paddingV:16, shadow:true },
  overlayOpacity:0, overlayColor:"#000000",
},

// ══════════════════════════════════════════════════════════════════════════════
// 23. WELLNESS MEADOW — Self-care, mindfulness, wellness  (meadow scene, Step 65)
// Soft rolling hills + wildflower specks anchor a calm headline. Matches
// "Self-Care Reminders" / "Heart Health Tips" painterly register.
// ══════════════════════════════════════════════════════════════════════════════
{
  id:"wellness_meadow", name:"Wellness Meadow",
  tones:["warm","minimal","professional"], colorMoods:["light","muted","warm"],
  headlineSizeMultiplier:1.28,
  palette:{ background:"#eaf1dc", surface:"rgba(255,255,255,0.45)", primary:"#4d8640",
    secondary:"#e76f51", text:"#2b3b26", textMuted:"rgba(43,59,38,0.62)", highlight:"#f4a261" },
  background:{ kind:"scene", scene:"meadow",
    palette:["#e6efd6","#cfe0b1","#9ac47a","#74a859","#4d8640","#f4a261","#e76f51"],
    atmosphere:"noon" },
  typography:{
    display:"Caveat", body:"Nunito",
    headline: { fontFamily:"Caveat",  fontWeight:700, color:"#2b3b26", letterSpacing:-0.005, fontSizeMultiplier:1.28 },
    subhead:  { fontFamily:"Nunito",  fontWeight:400, color:"rgba(43,59,38,0.75)" },
    body_text:{ fontFamily:"Nunito",  fontWeight:400, color:"rgba(43,59,38,0.70)" },
    cta:      { fontFamily:"Nunito",  fontWeight:700, color:"#ffffff", letterSpacing:0.06 },
    badge:    { fontFamily:"Nunito",  fontWeight:700, color:"#4d8640", textTransform:"uppercase", letterSpacing:0.22 },
    eyebrow:  { fontFamily:"Nunito",  fontWeight:600, color:"#e76f51", textTransform:"uppercase", letterSpacing:0.26 },
  },
  decorations:[
    { kind:"watercolor_corner", corner:"tl", size:22, palette:["#cfe0b1","#4d8640","#f4a261"], opacity:0.7 },
    { kind:"watercolor_corner", corner:"br", size:20, palette:["#f5dcc0","#4d8640","#e76f51"], opacity:0.65 },
    { kind:"section_divider", x:28, y:52, w:44, color:"#4d8640", opacity:0.45, strokeWidth:0.8, ornament:"diamond" },
    { kind:"noise_overlay", opacity:0.03 },
  ],
  ctaStyle:{ backgroundColor:"#4d8640", textColor:"#ffffff", borderRadius:40, paddingH:36, paddingV:14 },
  overlayOpacity:0, overlayColor:"#ffffff",
},

// ══════════════════════════════════════════════════════════════════════════════
// 24. VINTAGE PAPER — Quotes, tips, motivational  (torn-paper + flat-lay, Step 65)
// Kraft / notebook-page look matching "Quick Tips for Success" and
// "Monday Motivation" in the reference pack.
// ══════════════════════════════════════════════════════════════════════════════
{
  id:"vintage_paper", name:"Vintage Paper",
  tones:["warm","minimal","professional"], colorMoods:["muted","warm","light"],
  headlineSizeMultiplier:1.32,
  palette:{ background:"#e9dcc2", surface:"rgba(90,62,40,0.06)", primary:"#3b2a1a",
    secondary:"#a65233", text:"#2e2016", textMuted:"rgba(46,32,22,0.62)", highlight:"#a65233" },
  background:{ kind:"linear_gradient", colors:["#efe2c9","#d9c7a5"], angle:160 },
  typography:{
    display:"Cormorant Garamond", body:"Lato",
    headline: { fontFamily:"Cormorant Garamond", fontWeight:700, color:"#2e2016", letterSpacing:-0.005, fontSizeMultiplier:1.32 },
    subhead:  { fontFamily:"Lato",               fontWeight:400, color:"rgba(46,32,22,0.72)", letterSpacing:0.05 },
    body_text:{ fontFamily:"Lato",               fontWeight:400, color:"rgba(46,32,22,0.66)" },
    cta:      { fontFamily:"Lato",               fontWeight:700, color:"#efe2c9", letterSpacing:0.08 },
    badge:    { fontFamily:"Lato",               fontWeight:700, color:"#a65233", textTransform:"uppercase", letterSpacing:0.22 },
    eyebrow:  { fontFamily:"Lato",               fontWeight:600, color:"#a65233", textTransform:"uppercase", letterSpacing:0.28 },
  },
  decorations:[
    // Notebook-page torn frame as the main content surface
    { kind:"torn_paper_frame", x:10, y:12, w:80, h:68, color:"#fdf8ec", shadowColor:"#3b2a1a", opacity:0.98, seed:271 },
    // Floral corner flourishes evoking "Monday Motivation"
    { kind:"themed_cluster", x:18, y:88, size:22, theme:"floral", palette:["#4d8640","#e76f51","#f4a261","#a65233"], opacity:0.9 },
    { kind:"themed_cluster", x:82, y:14, size:18, theme:"floral", palette:["#4d8640","#e76f51","#f4a261","#a65233"], opacity:0.85 },
    { kind:"section_divider", x:30, y:58, w:40, color:"#a65233", opacity:0.55, strokeWidth:0.8, ornament:"diamond" },
    { kind:"noise_overlay", opacity:0.04 },
  ],
  ctaStyle:{ backgroundColor:"#3b2a1a", textColor:"#efe2c9", borderRadius:2, paddingH:36, paddingV:14 },
  overlayOpacity:0, overlayColor:"#efe2c9",
},

// ══════════════════════════════════════════════════════════════════════════════
// 25. TROPICAL JUNGLE — Food, fitness, travel  (dense jungle scene, Step 65)
// Immersive painted jungle as the background — matches "Workout of the Day"
// and "Stress Relief" in the reference pack.
// ══════════════════════════════════════════════════════════════════════════════
{
  id:"tropical_jungle", name:"Tropical Jungle",
  tones:["energetic","warm","bold"], colorMoods:["vibrant","warm","cool"],
  headlineSizeMultiplier:1.35,
  palette:{ background:"#2f5a3e", surface:"rgba(255,255,255,0.14)", primary:"#1f4532",
    secondary:"#f4a259", text:"#ffffff", textMuted:"rgba(255,255,255,0.85)", highlight:"#ffd27a" },
  background:{ kind:"scene", scene:"jungle",
    palette:["#2f5a3e","#cfe5d4","#3d6b4b","#2f5a3e","#1f4532"],
    atmosphere:"noon" },
  typography:{
    display:"Montserrat", body:"Lato",
    headline: { fontFamily:"Montserrat", fontWeight:900, color:"#ffffff", letterSpacing:-0.02, fontSizeMultiplier:1.35 },
    subhead:  { fontFamily:"Montserrat", fontWeight:500, color:"rgba(255,255,255,0.90)" },
    body_text:{ fontFamily:"Lato",       fontWeight:400, color:"rgba(255,255,255,0.85)" },
    cta:      { fontFamily:"Montserrat", fontWeight:800, color:"#1f4532", textTransform:"uppercase", letterSpacing:0.08 },
    badge:    { fontFamily:"Montserrat", fontWeight:700, color:"#ffd27a", textTransform:"uppercase", letterSpacing:0.2 },
    eyebrow:  { fontFamily:"Montserrat", fontWeight:700, color:"#ffd27a", textTransform:"uppercase", letterSpacing:0.26 },
  },
  decorations:[
    { kind:"torn_paper_frame", x:14, y:20, w:72, h:38, color:"#fdfaf2", shadowColor:"#000000", opacity:0.92, seed:431 },
    { kind:"foliage_silhouette", anchor:"bottom", palette:["#0f2a1e","#1f4532","#2f5a3e"], density:10, height:10, opacity:0.85 },
    { kind:"noise_overlay", opacity:0.04 },
  ],
  ctaStyle:{ backgroundColor:"#ffd27a", textColor:"#1f4532", borderRadius:40, paddingH:40, paddingV:16, shadow:true },
  overlayOpacity:0.08, overlayColor:"#000000",
},

// ══════════════════════════════════════════════════════════════════════════════
// 26. HEART HEALTH — Wellness, affirmation, relationship  (heart panel, Step 66)
// Headline sits inside a pink heart. Matches "Heart Health Tips" in the
// reference pack.
// ══════════════════════════════════════════════════════════════════════════════
{
  id:"heart_health", name:"Heart Health",
  tones:["warm","minimal","professional"], colorMoods:["warm","light","vibrant"],
  headlineSizeMultiplier:1.20,
  palette:{ background:"#fde7ec", surface:"rgba(255,255,255,0.5)", primary:"#e85a79",
    secondary:"#f7b8c3", text:"#ffffff", textMuted:"rgba(255,255,255,0.85)", highlight:"#c92f55" },
  background:{ kind:"linear_gradient", colors:["#ffd0db","#ffa3b8"], angle:170 },
  typography:{
    display:"Poppins", body:"Nunito",
    headline: { fontFamily:"Poppins", fontWeight:800, color:"#ffffff", letterSpacing:-0.01, fontSizeMultiplier:1.20 },
    subhead:  { fontFamily:"Nunito",  fontWeight:500, color:"rgba(255,255,255,0.88)" },
    body_text:{ fontFamily:"Nunito",  fontWeight:400, color:"#ffffff" },
    cta:      { fontFamily:"Poppins", fontWeight:700, color:"#e85a79", letterSpacing:0.06 },
    badge:    { fontFamily:"Poppins", fontWeight:700, color:"#ffffff", textTransform:"uppercase", letterSpacing:0.18 },
    eyebrow:  { fontFamily:"Poppins", fontWeight:600, color:"#c92f55", textTransform:"uppercase", letterSpacing:0.26 },
  },
  decorations:[
    // The heart itself — big soft pink heart hosting the headline
    { kind:"shape_panel",  x:10, y:10, w:80, h:72, shape:"heart", color:"#e85a79", opacity:0.95 },
    { kind:"shape_panel",  x:10, y:10, w:80, h:72, shape:"heart", color:"#ffffff", strokeColor:"#ffffff", strokeWidth:1.6, opacity:0.25 },
    // Sparkles around the heart
    { kind:"icon_symbol",  x:14, y:22, size:8, icon:"sparkle", color:"#ffffff", opacity:0.85 },
    { kind:"icon_symbol",  x:84, y:18, size:6, icon:"sparkle", color:"#ffffff", opacity:0.8 },
    { kind:"icon_symbol",  x:82, y:82, size:5, icon:"sparkle", color:"#ffffff", opacity:0.7 },
    { kind:"icon_symbol",  x:16, y:80, size:6, icon:"sparkle", color:"#ffffff", opacity:0.75 },
    { kind:"noise_overlay", opacity:0.03 },
  ],
  ctaStyle:{ backgroundColor:"#ffffff", textColor:"#e85a79", borderRadius:50, paddingH:40, paddingV:14, shadow:true },
  overlayOpacity:0, overlayColor:"#ffffff",
},

// ══════════════════════════════════════════════════════════════════════════════
// 27. STYLE PHOTO — Fashion / lifestyle  (photo_shape-driven, Step 66)
// A large photo tile is the hero element, headline overlaid. Matches
// "Style Guide" in the reference pack.
// ══════════════════════════════════════════════════════════════════════════════
{
  id:"style_photo", name:"Style Photo",
  tones:["professional","minimal","luxury"], colorMoods:["muted","cool","light"],
  headlineSizeMultiplier:1.18,
  palette:{ background:"#e5efed", surface:"rgba(255,255,255,0.55)", primary:"#2b3f47",
    secondary:"#b7c4c5", text:"#2b3f47", textMuted:"rgba(43,63,71,0.70)", highlight:"#d38e6d" },
  background:{ kind:"linear_gradient", colors:["#eaf2ef","#c9d6d1"], angle:175 },
  typography:{
    display:"Allura",           body:"Cormorant Garamond",
    headline: { fontFamily:"Allura",              fontWeight:400, color:"#2b3f47", letterSpacing:-0.005, fontSizeMultiplier:1.18 },
    subhead:  { fontFamily:"Cormorant Garamond",  fontWeight:500, color:"rgba(43,63,71,0.78)", letterSpacing:0.04, textTransform:"uppercase" },
    body_text:{ fontFamily:"Cormorant Garamond",  fontWeight:400, color:"rgba(43,63,71,0.68)" },
    cta:      { fontFamily:"Cormorant Garamond",  fontWeight:600, color:"#ffffff", letterSpacing:0.2, textTransform:"uppercase" },
    badge:    { fontFamily:"Cormorant Garamond",  fontWeight:600, color:"#2b3f47", textTransform:"uppercase", letterSpacing:0.24 },
    eyebrow:  { fontFamily:"Cormorant Garamond",  fontWeight:500, color:"#d38e6d", textTransform:"uppercase", letterSpacing:0.3 },
  },
  decorations:[
    // Large rounded photo panel on the right-half — placeholder if no CDN
    { kind:"photo_shape", x:52, y:10, w:42, h:80, shape:"rounded",
      photoSlug:"fashion-street-style", fallbackColor:"#b7c4c5", opacity:1, shadow:true },
    // Soft washi tape pinning the top of the photo
    { kind:"washi_tape", x:56, y:8, w:20, h:4, rotation:-6, colorA:"rgba(255,255,255,0.72)", colorB:"#d38e6d", opacity:0.82, stripes:6 },
    // Tiny photo accent tucked bottom-left
    { kind:"photo_shape", x:8, y:66, w:18, h:22, shape:"rounded",
      photoSlug:"fashion-accessories", fallbackColor:"#2b3f47", opacity:1, shadow:true },
    { kind:"section_divider", x:6, y:36, w:40, color:"#d38e6d", opacity:0.8, strokeWidth:0.8, ornament:"diamond" },
    { kind:"noise_overlay", opacity:0.025 },
  ],
  ctaStyle:{ backgroundColor:"#2b3f47", textColor:"#ffffff", borderRadius:2, paddingH:32, paddingV:12 },
  overlayOpacity:0, overlayColor:"#ffffff",
},

// ══════════════════════════════════════════════════════════════════════════════
// 28. SCRAPBOOK POP — Tips, motivation, education  (washi + shapes, Step 66)
// Playful layered composition with torn paper + washi tape + blob panel.
// Matches "Boost Your Confidence!" / "Quick Tips for Success" energy.
// ══════════════════════════════════════════════════════════════════════════════
{
  id:"scrapbook_pop", name:"Scrapbook Pop",
  tones:["energetic","warm","bold"], colorMoods:["vibrant","light","warm"],
  headlineSizeMultiplier:1.28,
  palette:{ background:"#fff5ee", surface:"rgba(255,255,255,0.7)", primary:"#f06292",
    secondary:"#ffb74d", text:"#3a2a2a", textMuted:"rgba(58,42,42,0.68)", highlight:"#26a69a" },
  background:{ kind:"linear_gradient", colors:["#fff5ee","#ffe8d6"], angle:170 },
  typography:{
    display:"Caveat",  body:"Nunito",
    headline: { fontFamily:"Caveat",  fontWeight:700, color:"#3a2a2a", letterSpacing:-0.005, fontSizeMultiplier:1.28 },
    subhead:  { fontFamily:"Nunito",  fontWeight:500, color:"rgba(58,42,42,0.76)" },
    body_text:{ fontFamily:"Nunito",  fontWeight:400, color:"rgba(58,42,42,0.70)" },
    cta:      { fontFamily:"Nunito",  fontWeight:700, color:"#ffffff", letterSpacing:0.06 },
    badge:    { fontFamily:"Nunito",  fontWeight:700, color:"#f06292", textTransform:"uppercase", letterSpacing:0.2 },
    eyebrow:  { fontFamily:"Nunito",  fontWeight:600, color:"#26a69a", textTransform:"uppercase", letterSpacing:0.24 },
  },
  decorations:[
    // Playful blob behind headline
    { kind:"shape_panel", x:8, y:14, w:60, h:36, shape:"blob", color:"#ffe0b2", opacity:0.95, seed:173 },
    // Torn paper scrap for supporting text
    { kind:"torn_paper_frame", x:14, y:54, w:72, h:30, color:"#fffdf7", shadowColor:"#3a2a2a", opacity:0.95, seed:331 },
    // Washi tape pinning the corner of the torn paper
    { kind:"washi_tape", x:10, y:52, w:18, h:4, rotation:-15, colorA:"#f06292", colorB:"#ffffff", opacity:0.8, stripes:5 },
    { kind:"washi_tape", x:72, y:82, w:18, h:4, rotation:12,  colorA:"#26a69a", colorB:"#ffffff", opacity:0.8, stripes:5 },
    // Scalloped badge top-right
    { kind:"shape_panel", x:80, y:6, w:18, h:18, shape:"badge", color:"#f06292", opacity:0.95 },
    { kind:"icon_symbol", x:20, y:24, size:6, icon:"sparkle", color:"#26a69a", opacity:0.85 },
    { kind:"icon_symbol", x:58, y:22, size:5, icon:"star",    color:"#ffb74d", opacity:0.85 },
    { kind:"noise_overlay", opacity:0.035 },
  ],
  ctaStyle:{ backgroundColor:"#f06292", textColor:"#ffffff", borderRadius:40, paddingH:36, paddingV:14, shadow:true },
  overlayOpacity:0, overlayColor:"#ffffff",
},

];

// ── Theme selection ───────────────────────────────────────────────────────────
// Uses SHUFFLE-BASED SELECTION with category style pack awareness.
//
// Algorithm:
//  1. Detect category from brief via CategoryStylePack system
//  2. Score each theme by:
//     a) tone/colorMood match from brief
//     b) category style pack preferred themes (stronger boost)
//     c) category paletteMood → colorMood alignment
//  3. Penalise recently-used themes to prevent repetition
//  4. Use time + variationIdx as seed for weighted random selection
//
// This guarantees that consecutive generations produce visually distinct results
// while respecting category-specific visual identity.

// Track recently used themes to avoid repetition across close-in-time generations
const _recentThemeIds: string[] = [];
const RECENT_HISTORY_SIZE = 6;

// Exported so svg-builder and layout-intelligence can access the detected pack
export { detectCategoryPack } from "../style/category-style-packs";

export function selectTheme(brief: BriefAnalysis, variationIdx = 0): DesignTheme {
  // Detect category style pack from brief content
  const pack = detectCategoryPack(brief);

  // Derive colorMood boost targets from the pack's palette mood
  const packMoodTargets = pack ? paletteMoodToColorMoods(pack.paletteMood) : [];

  const scored = THEMES.map(theme => {
    let relevance = 0;

    // Tone and colorMood matching from brief
    if (theme.tones.includes(brief.tone))           relevance += 2;
    if (theme.colorMoods.includes(brief.colorMood)) relevance += 1;
    const toneIdx = theme.tones.indexOf(brief.tone);
    if (toneIdx > 0) relevance += 1;
    const moodIdx = theme.colorMoods.indexOf(brief.colorMood);
    if (moodIdx > 0) relevance += 1;

    if (pack) {
      // Category style pack preferred themes get a strong boost
      if (pack.preferredThemeIds.includes(theme.id)) {
        relevance += 4;
      }

      // Category paletteMood → colorMood alignment
      for (const targetMood of packMoodTargets) {
        if (theme.colorMoods.includes(targetMood)) {
          relevance += 2;
          break;
        }
      }
    }

    return { theme, relevance };
  });

  // Every theme gets a strong BASE weight (15) with only a small relevance
  // bonus (3 per point). This ensures the full color spectrum is used.
  const BASE_WEIGHT = 15;
  const RELEVANCE_BONUS = 3;

  // Penalise recently-used themes so back-to-back generations look different
  const weighted = scored.map(s => {
    let weight = BASE_WEIGHT + s.relevance * RELEVANCE_BONUS;
    const recIdx = _recentThemeIds.indexOf(s.theme.id);
    if (recIdx !== -1) {
      // More recent = heavier penalty (most recent gets 80% penalty)
      const recency = 1 - recIdx / RECENT_HISTORY_SIZE;
      weight *= Math.max(0.2, 1 - recency * 0.8);
    }
    return { theme: s.theme, weight };
  });

  // Use time + variationIdx as seed. Each variationIdx gets a wildly different
  // seed so multi-variation batches always use different themes.
  const seed = Date.now() + variationIdx * 104729;

  // Weighted random selection
  const totalWeight = weighted.reduce((sum, w) => sum + w.weight, 0);
  const roll = pseudoRandom(seed) * totalWeight;
  let cumulative = 0;
  let selected = weighted[weighted.length - 1].theme;
  for (const w of weighted) {
    cumulative += w.weight;
    if (roll < cumulative) { selected = w.theme; break; }
  }

  // Record the selection in recent history
  _recentThemeIds.unshift(selected.id);
  if (_recentThemeIds.length > RECENT_HISTORY_SIZE) _recentThemeIds.pop();

  return selected;
}

function pseudoRandom(seed: number): number {
  // Simple but effective pseudo-random from a numeric seed
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return x - Math.floor(x);
}

export function applyBrandColors(
  theme: DesignTheme,
  brand?: { primaryColor: string; secondaryColor: string }
): DesignTheme {
  if (!brand) return theme;
  return {
    ...theme,
    palette: { ...theme.palette, primary:brand.primaryColor, secondary:brand.secondaryColor, highlight:brand.primaryColor },
    ctaStyle:{ ...theme.ctaStyle, backgroundColor:brand.primaryColor },
  };
}
