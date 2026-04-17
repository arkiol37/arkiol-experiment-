// src/engines/render/style-intelligence.ts
//
// Visual style intelligence layer.
// Analyzes brief intent, category, and brand context to dynamically select
// color palettes, typography pairings, spacing density, and composition mood.
// Produces a StyleDirective applied to the selected theme so each design
// adapts its aesthetic to content rather than using static style choices.

import type { BriefAnalysis } from "../ai/brief-analyzer";
import type { DesignTheme, ThemeFont } from "./design-themes";
import type { CategoryStylePack } from "./category-style-packs";

// ── Style intent dimensions ──────────────────────────────────────────────────

export interface StyleIntent {
  energy: number;      // 0=calm/zen → 1=high-energy/urgent
  formality: number;   // 0=casual/playful → 1=corporate/formal
  warmth: number;      // 0=cool/tech → 1=warm/organic
  luxury: number;      // 0=budget/mass → 1=premium/exclusive
  minimalism: number;  // 0=decorated/rich → 1=stripped/clean
}

// ── Directive sub-components ─────────────────────────────────────────────────

export interface PaletteDirective {
  saturationBias: number;
  warmthShift: number;
  contrastLevel: "low" | "medium" | "high";
  accentStrategy: "monochrome" | "complementary" | "analogous";
  lightness: "dark" | "balanced" | "light";
}

export interface TypographyDirective {
  headlineWeight: "light" | "regular" | "bold" | "black";
  bodyWeight: "light" | "regular" | "medium";
  headlineTracking: "tight" | "normal" | "wide";
  headlineCase: "none" | "uppercase";
  pairingStrategy: "contrast" | "harmonious" | "display-only";
  displayFont?: ThemeFont;
  bodyFont?: ThemeFont;
}

export interface SpacingDirective {
  density: "airy" | "balanced" | "compact";
  verticalRhythm: "even" | "proportional" | "dramatic";
  breathingRoom: number;
}

export interface MoodDirective {
  decorationDensity: "minimal" | "moderate" | "rich";
  visualEnergy: "calm" | "dynamic" | "explosive";
  bgComplexity: "simple" | "layered" | "rich";
  overlayIntensity: number;
}

export interface StyleDirective {
  intent: StyleIntent;
  palette: PaletteDirective;
  typography: TypographyDirective;
  spacing: SpacingDirective;
  mood: MoodDirective;
}

// ── Intent analysis ──────────────────────────────────────────────────────────

const URGENCY_KEYWORDS = new Set([
  "sale", "free", "now", "limited", "hurry", "today", "exclusive",
  "save", "deal", "offer", "discount", "flash", "last chance", "ending",
]);

export function analyzeStyleIntent(
  brief: BriefAnalysis,
  categoryId?: string,
): StyleIntent {
  const tone = brief.tone ?? "";
  const mood = brief.colorMood ?? "";
  const allText = `${brief.headline ?? ""} ${brief.subhead ?? ""} ${brief.body ?? ""} ${brief.cta ?? ""} ${(brief.keywords ?? []).join(" ")}`.toLowerCase();
  const hasUrgencyKeywords = [...URGENCY_KEYWORDS].some(k => allText.includes(k));
  const cat = (categoryId ?? "").toLowerCase();

  let energy = 0.5;
  if (tone === "urgent") energy = 1.0;
  else if (tone === "energetic") energy = 0.85;
  else if (tone === "bold") energy = 0.7;
  else if (tone === "playful") energy = 0.6;
  else if (tone === "professional") energy = 0.35;
  else if (tone === "luxury") energy = 0.25;
  else if (tone === "minimal") energy = 0.15;
  if (brief.cta) energy = Math.min(1, energy + 0.1);
  if (hasUrgencyKeywords) energy = Math.min(1, energy + 0.15);

  let formality = 0.5;
  if (tone === "luxury") formality = 0.9;
  else if (tone === "professional") formality = 0.85;
  else if (tone === "minimal") formality = 0.7;
  else if (tone === "bold") formality = 0.45;
  else if (tone === "energetic") formality = 0.3;
  else if (tone === "playful") formality = 0.2;
  if (cat.includes("business") || cat.includes("finance")) formality = Math.min(1, formality + 0.15);
  if (cat.includes("fashion")) formality = Math.min(1, formality + 0.1);
  if (cat.includes("tech")) formality = Math.min(1, formality + 0.05);

  let warmth = 0.5;
  if (mood === "warm") warmth = 0.85;
  else if (mood === "cool") warmth = 0.2;
  else if (mood === "vibrant") warmth = 0.6;
  else if (mood === "muted") warmth = 0.4;
  else if (mood === "dark") warmth = 0.35;
  else if (mood === "light") warmth = 0.65;
  if (cat.includes("wellness") || cat.includes("beauty")) warmth = Math.min(1, warmth + 0.15);
  if (cat.includes("tech") || cat.includes("business")) warmth = Math.max(0, warmth - 0.15);

  let luxury = 0.4;
  if (tone === "luxury") luxury = 0.95;
  else if (tone === "minimal") luxury = 0.7;
  else if (tone === "professional") luxury = 0.65;
  else if (tone === "bold") luxury = 0.35;
  else if (tone === "playful") luxury = 0.2;
  else if (tone === "urgent") luxury = 0.15;
  if (cat.includes("fashion")) luxury = Math.min(1, luxury + 0.2);
  if (cat.includes("beauty")) luxury = Math.min(1, luxury + 0.15);

  let minimalism = 0.35;
  if (tone === "minimal") minimalism = 0.9;
  else if (tone === "luxury") minimalism = 0.65;
  else if (tone === "professional") minimalism = 0.55;
  else if (tone === "playful") minimalism = 0.2;
  else if (tone === "bold") minimalism = 0.15;
  else if (tone === "energetic") minimalism = 0.1;
  else if (tone === "urgent") minimalism = 0.05;

  return { energy, formality, warmth, luxury, minimalism };
}

// ── Directive derivation ─────────────────────────────────────────────────────

export function deriveStyleDirective(
  intent: StyleIntent,
  pack?: CategoryStylePack | null,
  brand?: { primaryColor: string; secondaryColor: string },
): StyleDirective {
  // ── Palette directive ──
  let saturationBias = 0;
  if (intent.minimalism > 0.6) saturationBias = -0.3;
  else if (intent.energy > 0.8) saturationBias = 0.2;
  else if (intent.luxury > 0.7) saturationBias = -0.1;

  const warmthShift = (intent.warmth - 0.5) * 0.6;

  const contrastLevel: PaletteDirective["contrastLevel"] =
    intent.energy > 0.7 || intent.luxury > 0.7 ? "high" :
    intent.minimalism > 0.6 ? "low" : "medium";

  const accentStrategy: PaletteDirective["accentStrategy"] =
    intent.minimalism > 0.6 ? "monochrome" :
    intent.luxury > 0.7 ? "analogous" : "complementary";

  const lightness: PaletteDirective["lightness"] =
    pack?.paletteMood === "dark" ? "dark" :
    pack?.paletteMood === "light" ? "light" :
    intent.luxury > 0.7 ? "dark" : "balanced";

  // ── Typography directive ──
  const headlineWeight: TypographyDirective["headlineWeight"] =
    intent.energy > 0.7 ? "black" :
    intent.luxury > 0.7 ? "light" :
    intent.formality > 0.7 ? "bold" : "bold";

  const bodyWeight: TypographyDirective["bodyWeight"] =
    intent.formality > 0.7 || intent.luxury > 0.7 ? "light" : "regular";

  const headlineTracking: TypographyDirective["headlineTracking"] =
    intent.luxury > 0.7 ? "wide" :
    intent.energy > 0.7 ? "tight" : "normal";

  const headlineCase: TypographyDirective["headlineCase"] =
    pack?.preferUppercase ? "uppercase" :
    intent.energy > 0.7 && intent.formality < 0.5 ? "uppercase" :
    intent.luxury > 0.7 ? "none" : "none";

  const pairingStrategy: TypographyDirective["pairingStrategy"] =
    intent.luxury > 0.7 ? "contrast" :
    intent.formality > 0.7 ? "harmonious" :
    intent.energy > 0.7 ? "display-only" : "harmonious";

  const { displayFont, bodyFont } = selectFontPairing(pairingStrategy, intent, pack, !!brand);

  // ── Spacing directive ──
  const density: SpacingDirective["density"] =
    pack?.spacingDensity ?? (
      intent.minimalism > 0.6 ? "airy" :
      intent.energy > 0.7 ? "compact" : "balanced"
    );

  const verticalRhythm: SpacingDirective["verticalRhythm"] =
    intent.luxury > 0.7 ? "dramatic" :
    intent.energy > 0.7 ? "proportional" : "even";

  const breathingRoom = clamp(intent.minimalism * 0.6 + intent.luxury * 0.3 - intent.energy * 0.15, 0, 1);

  // ── Mood directive ──
  const decorationDensity: MoodDirective["decorationDensity"] =
    intent.minimalism > 0.6 ? "minimal" :
    intent.energy > 0.7 || intent.luxury < 0.3 ? "rich" : "moderate";

  const visualEnergy: MoodDirective["visualEnergy"] =
    intent.energy > 0.8 ? "explosive" :
    intent.energy > 0.5 ? "dynamic" : "calm";

  const bgComplexity: MoodDirective["bgComplexity"] =
    intent.minimalism > 0.6 ? "simple" :
    intent.energy > 0.7 ? "rich" : "layered";

  const overlayIntensity = clamp(intent.formality * 0.2 + intent.luxury * 0.15, 0, 0.5);

  return {
    intent,
    palette: { saturationBias, warmthShift, contrastLevel, accentStrategy, lightness },
    typography: { headlineWeight, bodyWeight, headlineTracking, headlineCase, pairingStrategy, displayFont, bodyFont },
    spacing: { density, verticalRhythm, breathingRoom },
    mood: { decorationDensity, visualEnergy, bgComplexity, overlayIntensity },
  };
}

// ── Font pairing selection ───────────────────────────────────────────────────

function selectFontPairing(
  strategy: TypographyDirective["pairingStrategy"],
  intent: StyleIntent,
  pack?: CategoryStylePack | null,
  hasBrand?: boolean,
): { displayFont?: ThemeFont; bodyFont?: ThemeFont } {
  if (pack?.preferredDisplayFonts?.length || hasBrand) return {};

  switch (strategy) {
    case "contrast":
      return {
        displayFont: intent.warmth > 0.6 ? "Cormorant Garamond" : "Playfair Display",
        bodyFont: intent.formality > 0.7 ? "DM Sans" : "Lato",
      };
    case "display-only":
      return {
        displayFont: intent.energy > 0.8 ? "Bebas Neue" : "Oswald",
        bodyFont: "Montserrat",
      };
    case "harmonious":
    default:
      if (intent.formality > 0.6) {
        return { displayFont: "Montserrat", bodyFont: "DM Sans" };
      }
      return { displayFont: "Poppins", bodyFont: "Nunito Sans" };
  }
}

// ── Apply style directive to theme ───────────────────────────────────────────

export function applyStyleDirective(
  theme: DesignTheme,
  directive: StyleDirective,
  hasBrand = false,
): DesignTheme {
  let result = { ...theme };
  result = applyPaletteDirective(result, directive.palette, hasBrand);
  result = applyTypographyDirective(result, directive.typography);
  result = applyMoodDirective(result, directive.mood);
  return result;
}

// ── Palette application ──────────────────────────────────────────────────────

function applyPaletteDirective(
  theme: DesignTheme,
  dir: PaletteDirective,
  hasBrand: boolean,
): DesignTheme {
  const palette = { ...theme.palette };

  if (!hasBrand) {
    if (Math.abs(dir.saturationBias) > 0.05) {
      palette.primary = adjustSaturation(palette.primary, dir.saturationBias);
      palette.secondary = adjustSaturation(palette.secondary, dir.saturationBias);
      palette.highlight = adjustSaturation(palette.highlight, dir.saturationBias);
    }

    if (Math.abs(dir.warmthShift) > 0.05) {
      const hueShift = dir.warmthShift * 20;
      palette.primary = shiftHue(palette.primary, hueShift);
      palette.secondary = shiftHue(palette.secondary, hueShift);
      palette.highlight = shiftHue(palette.highlight, hueShift);
    }
  }

  if (dir.contrastLevel === "high") {
    palette.text = adjustLightness(palette.text, -0.05);
    palette.textMuted = adjustLightness(palette.textMuted, -0.03);
  }

  return { ...theme, palette };
}

// ── Typography application ───────────────────────────────────────────────────

function applyTypographyDirective(
  theme: DesignTheme,
  dir: TypographyDirective,
): DesignTheme {
  const weightMap: Record<TypographyDirective["headlineWeight"], number> = {
    light: 300, regular: 400, bold: 700, black: 900,
  };
  const bodyWeightMap: Record<TypographyDirective["bodyWeight"], number> = {
    light: 300, regular: 400, medium: 500,
  };
  const trackingMap: Record<TypographyDirective["headlineTracking"], number> = {
    tight: -0.02, normal: 0, wide: 0.06,
  };

  const typo = {
    ...theme.typography,
    headline: {
      ...theme.typography.headline,
      fontWeight: weightMap[dir.headlineWeight],
      letterSpacing: trackingMap[dir.headlineTracking],
      ...(dir.headlineCase === "uppercase" ? { textTransform: "uppercase" as const } : {}),
    },
    body_text: {
      ...theme.typography.body_text,
      fontWeight: bodyWeightMap[dir.bodyWeight],
    },
  };

  if (dir.displayFont) {
    typo.display = dir.displayFont;
    typo.headline = { ...typo.headline, fontFamily: dir.displayFont };
  }
  if (dir.bodyFont) {
    typo.body = dir.bodyFont;
    typo.body_text = { ...typo.body_text, fontFamily: dir.bodyFont };
    typo.subhead = { ...typo.subhead, fontFamily: dir.bodyFont };
  }

  return { ...theme, typography: typo };
}

// ── Mood application ─────────────────────────────────────────────────────────

function applyMoodDirective(theme: DesignTheme, dir: MoodDirective): DesignTheme {
  let overlayOpacity = theme.overlayOpacity ?? 0;
  if (dir.overlayIntensity > overlayOpacity) {
    overlayOpacity = clamp(dir.overlayIntensity, 0, 0.6);
  }

  let hMult = theme.headlineSizeMultiplier ?? 1.0;
  if (dir.visualEnergy === "explosive") hMult *= 1.08;
  else if (dir.visualEnergy === "calm") hMult *= 0.95;

  return { ...theme, overlayOpacity, headlineSizeMultiplier: hMult };
}

// ── HSL color helpers ────────────────────────────────────────────────────────

function hexToHSL(hex: string): [number, number, number] {
  hex = hex.replace(/^#/, "");
  if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;

  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;

  return [h * 360, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  h = ((h % 360) + 360) % 360;
  s = clamp(s, 0, 1);
  l = clamp(l, 0, 1);

  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;

  if (h < 60)       { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else              { r = c; b = x; }

  const toHex = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return "#" + toHex(r) + toHex(g) + toHex(b);
}

function adjustSaturation(hex: string, bias: number): string {
  if (!hex.startsWith("#")) return hex;
  const [h, s, l] = hexToHSL(hex);
  return hslToHex(h, clamp(s * (1 + bias * 0.5), 0, 1), l);
}

function shiftHue(hex: string, degrees: number): string {
  if (!hex.startsWith("#")) return hex;
  const [h, s, l] = hexToHSL(hex);
  return hslToHex(h + degrees, s, l);
}

function adjustLightness(hex: string, delta: number): string {
  if (!hex.startsWith("#")) return hex;
  const [h, s, l] = hexToHSL(hex);
  return hslToHex(h, s, clamp(l + delta, 0, 1));
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
