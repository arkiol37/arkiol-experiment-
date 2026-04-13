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

export type ThemeFont =
  | "Montserrat" | "Playfair Display" | "Oswald"  | "Poppins"
  | "Raleway"    | "Nunito"           | "Lato"     | "Bebas Neue"
  | "DM Sans"    | "Cormorant Garamond";

export interface ThemePalette {
  background: string; surface: string;  primary:   string;
  secondary:  string; text:    string;  textMuted: string; highlight: string;
}

export type BgTreatment =
  | { kind: "solid";           color: string }
  | { kind: "linear_gradient"; colors: string[]; angle: number }
  | { kind: "radial_gradient"; colors: string[]; cx: number; cy: number }
  | { kind: "mesh";            colors: string[] }
  | { kind: "split";           colors: [string, string]; splitY: number }

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
    { kind:"circle",      x:95,  y:-8,  r:220, color:"rgba(255,255,255,0.06)", opacity:1 },
    { kind:"circle",      x:-8,  y:95,  r:150, color:"rgba(255,255,255,0.05)", opacity:1 },
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
    { kind:"glow_circle",  x:82,  y:18,  r:280, color:"#c9a84c", opacity:0.07 },
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
    { kind:"line",        x1:4,  y1:3,  x2:96,  y2:3,  color:"#ffffff", opacity:0.08, width:1 },
    // Dot grid top-right
    { kind:"dots_grid",   x:72,  y:4,   cols:7, rows:5, gap:12, r:1.6, color:"#f5c518", opacity:0.2 },
    // Large ghost ring (depth)
    { kind:"deco_ring",   x:80,  y:38,  r:100,  color:"#ffffff", opacity:0.025, strokeWidth:32 },
    // ×-cross accent
    { kind:"cross",       x:90,  y:8,   size:16, thickness:2.5, color:"#f5c518", opacity:0.85, rotation:45 },
    // Corner brackets
    { kind:"corner_bracket", x:4, y:7, size:24, color:"#f5c518", opacity:0.6, strokeWidth:2.5, corner:"tl" },
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
    { kind:"wave",      x:0,  y:82,  w:100, amplitude:7, frequency:3, color:"rgba(255,255,255,0.09)", opacity:1, strokeWidth:0 },
    { kind:"wave",      x:0,  y:88,  w:100, amplitude:5, frequency:4, color:"rgba(255,255,255,0.05)", opacity:1, strokeWidth:0 },
    // Corner circles
    { kind:"circle",    x:92,  y:-6,  r:190, color:"rgba(255,255,255,0.07)", opacity:1 },
    { kind:"circle",    x:-6,  y:92,  r:130, color:"rgba(255,255,255,0.05)", opacity:1 },
    // Teal rings
    { kind:"deco_ring", x:86,  y:9,   r:52,  color:"#00f0c8", opacity:0.5, strokeWidth:2.2 },
    { kind:"deco_ring", x:86,  y:9,   r:68,  color:"#00f0c8", opacity:0.2, strokeWidth:1,  dash:5 },
    // Dot grid
    { kind:"dots_grid", x:4,   y:4,   cols:4,rows:6, gap:15, r:2.2, color:"#90e0ef", opacity:0.22 },
    // Corner bracket
    { kind:"corner_bracket", x:4, y:4, size:22, color:"#00f0c8", opacity:0.5, strokeWidth:2, corner:"tl" },
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
    { kind:"deco_ring",   x:90,  y:-4,  r:165, color:"#111111", opacity:0.035, strokeWidth:28 },
    // Squiggle accent
    { kind:"squiggle",    x:70,  y:87,  w:24, color:"#e63946", opacity:0.5, strokeWidth:2.8 },
    // Card behind body text
    { kind:"card_panel",  x:5,   y:57,  w:90,  h:27, color:"rgba(255,255,255,0.68)", opacity:1, rx:6 },
    // Corner bracket
    { kind:"corner_bracket", x:96, y:95, size:20, color:"#111111", opacity:0.12, strokeWidth:1.5, corner:"br" },
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
    { kind:"circle",    x:92,  y:-8,  r:195, color:"rgba(255,255,255,0.07)", opacity:1 },
    { kind:"circle",    x:-8,  y:92,  r:120, color:"rgba(255,255,255,0.06)", opacity:1 },
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
    { kind:"diagonal_band", color:"rgba(255,255,255,0.025)", opacity:1, angle:35, thickness:18 },
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
    { kind:"dots_grid",   x:58,  y:0,   cols:12,rows:9, gap:17, r:1.4, color:"#0ea5e9", opacity:0.075 },
    // Blue bottom bar
    { kind:"rect",        x:0,   y:95,  w:100,  h:5,  color:"#0ea5e9", opacity:0.85, rx:0 },
    // Left vertical rule
    { kind:"line",        x1:4,  y1:5,  x2:4,  y2:94, color:"#0ea5e9", opacity:0.38, width:3.5 },
    // Ambient glow
    { kind:"glow_circle", x:86,  y:14,  r:220, color:"#0ea5e9", opacity:0.09 },
    // Cross accents
    { kind:"cross",       x:92,  y:8,   size:17, thickness:2.2, color:"#0ea5e9", opacity:0.6, rotation:0 },
    { kind:"cross",       x:7,   y:88,  size:11, thickness:1.8, color:"#38bdf8", opacity:0.38, rotation:45 },
    // Dashed ring
    { kind:"deco_ring",   x:86,  y:14,  r:62, color:"#0ea5e9", opacity:0.22, strokeWidth:1.5, dash:6 },
    // Corner bracket
    { kind:"corner_bracket", x:96, y:4, size:22, color:"#0ea5e9", opacity:0.45, strokeWidth:2, corner:"tr" },
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
    { kind:"deco_ring",   x:90,  y:-4,  r:168, color:"#0f0f0f", opacity:0.038, strokeWidth:30 },
    // Squiggle
    { kind:"squiggle",    x:68,  y:86,  w:26, color:"#cc2936", opacity:0.55, strokeWidth:2.8 },
    // Card behind body text
    { kind:"card_panel",  x:4,   y:57,  w:92,  h:30, color:"rgba(255,255,255,0.58)", opacity:1, rx:4 },
    // Corner bracket bottom-right
    { kind:"corner_bracket", x:96, y:96, size:22, color:"#0f0f0f", opacity:0.15, strokeWidth:1.5, corner:"br" },
  ],
  ctaStyle:{ backgroundColor:"#1a1a1a", textColor:"#f1ece3", borderRadius:0, paddingH:36, paddingV:16 },
  overlayOpacity:0.0, overlayColor:"#000000",
},

];

// ── Theme selection ───────────────────────────────────────────────────────────
// Selects a theme based on brief analysis + variationIdx.
// For variety: themes with the same score are shuffled using a time-based seed
// so repeated generations of the same prompt produce different looks.
export function selectTheme(brief: BriefAnalysis, variationIdx = 0): DesignTheme {
  const scored = THEMES.map(theme => {
    let score = 0;
    // Primary matches (strong signal)
    if (theme.tones.includes(brief.tone))           score += 4;
    if (theme.colorMoods.includes(brief.colorMood)) score += 3;
    // Secondary partial matches (listed but not first position)
    const toneIdx = theme.tones.indexOf(brief.tone);
    if (toneIdx > 0) score += 1;
    const moodIdx = theme.colorMoods.indexOf(brief.colorMood);
    if (moodIdx > 0) score += 1;
    return { theme, score };
  });

  // Time-based entropy: shuffle themes within the same score tier so
  // repeated requests with the same brief produce different designs.
  const timeSeed = Math.floor(Date.now() / 1000);
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // Same score: use a deterministic-ish shuffle based on time + variationIdx
    const hashA = simpleHash(a.theme.id + timeSeed + variationIdx);
    const hashB = simpleHash(b.theme.id + timeSeed + variationIdx);
    return hashA - hashB;
  });

  // variationIdx offsets into the ranked list so multi-variation generations
  // each get a distinct theme.
  const pick = variationIdx % scored.length;
  return scored[pick].theme;
}

function simpleHash(s: string | number): number {
  const str = String(s);
  let h = 0;
  for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  return h;
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
