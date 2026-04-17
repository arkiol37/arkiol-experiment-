// src/engines/cocreation/design-mutator.ts
//
// Applies structured edit operations to existing SvgContent without regenerating
// from scratch. Each mutation is localized and predictable — only the targeted
// property changes, everything else stays intact.

import type { SvgContent } from "../render/svg-builder-ultimate";
import type { EditOperation, ParsedInstruction } from "./instruction-parser";
import { resolveNamedColor } from "./instruction-parser";

// ── Mutation result ─────────────────────────────────────────────────────────

export interface MutationAction {
  operation: EditOperation;
  applied: boolean;
  description: string;
}

export interface MutationResult {
  content: SvgContent;
  actions: MutationAction[];
  changeCount: number;
}

// ── Main mutator ────────────────────────────────────────────────────────────

export function applyInstructions(
  content: SvgContent,
  parsed: ParsedInstruction,
): MutationResult {
  let current = deepCloneContent(content);
  const actions: MutationAction[] = [];

  for (const op of parsed.operations) {
    const result = applyOperation(current, op);
    current = result.content;
    actions.push({
      operation: op,
      applied: result.changed,
      description: result.description,
    });
  }

  return {
    content: current,
    actions,
    changeCount: actions.filter(a => a.applied).length,
  };
}

// ── Operation dispatcher ────────────────────────────────────────────────────

function applyOperation(
  content: SvgContent,
  op: EditOperation,
): { content: SvgContent; changed: boolean; description: string } {
  switch (op.intent) {
    // ── Color operations ──
    case "darken":
      return applyColorShift(content, -0.12 * op.magnitude, "Darkened colors");
    case "lighten":
      return applyColorShift(content, 0.12 * op.magnitude, "Lightened colors");
    case "saturate":
      return applySaturationShift(content, 0.25 * op.magnitude, "Increased saturation");
    case "desaturate":
      return applySaturationShift(content, -0.25 * op.magnitude, "Decreased saturation");
    case "shift_warm":
      return applyHueShift(content, 15 * op.magnitude, "Shifted colors warmer");
    case "shift_cool":
      return applyHueShift(content, -15 * op.magnitude, "Shifted colors cooler");
    case "set_color":
      return applySetColor(content, op.value ?? "blue");

    // ── Typography operations ──
    case "increase_font":
      return applyFontSizeChange(content, 1 + 0.2 * op.magnitude, op.target, "Increased font size");
    case "decrease_font":
      return applyFontSizeChange(content, 1 - 0.15 * op.magnitude, op.target, "Decreased font size");
    case "set_weight_bold":
      return applyFontWeight(content, 700, op.target, "Set font weight to bold");
    case "set_weight_light":
      return applyFontWeight(content, 300, op.target, "Set font weight to light");
    case "set_uppercase":
      return applyTextTransform(content, true, "Set text to uppercase");
    case "set_normal_case":
      return applyTextTransform(content, false, "Removed uppercase");

    // ── Tone operations ──
    case "tone_bold":
      return applyToneBold(content);
    case "tone_minimal":
      return applyToneMinimal(content);
    case "tone_playful":
      return applyTonePlayful(content);
    case "tone_premium":
      return applyTonePremium(content);
    case "tone_urgent":
      return applyToneUrgent(content);
    case "tone_warm":
      return applyToneWarm(content);
    case "tone_professional":
      return applyToneProfessional(content);

    // ── Spacing operations ──
    case "increase_spacing":
      return applyFontSizeChange(content, 0.92, undefined, "Reduced text size for more spacing");
    case "decrease_spacing":
      return applyFontSizeChange(content, 1.06, undefined, "Increased text size for tighter spacing");

    // ── CTA operations ──
    case "cta_bigger":
      return applyCtaSize(content, 1.2, "Enlarged CTA button");
    case "cta_smaller":
      return applyCtaSize(content, 0.85, "Reduced CTA button");
    case "cta_round":
      return applyCtaRadius(content, 50, "Made CTA button rounded");
    case "cta_sharp":
      return applyCtaRadius(content, 0, "Made CTA button sharp");
    case "cta_color":
      return applyCtaColor(content, op.value ?? "blue");

    // ── Content operations ──
    case "set_headline":
      return applyTextContent(content, "headline", op.value ?? "", "Updated headline");
    case "set_subhead":
      return applyTextContent(content, "subhead", op.value ?? "", "Updated subhead");
    case "set_cta_text":
      return applyTextContent(content, "cta", op.value ?? "", "Updated CTA text");
    case "set_body":
      return applyTextContent(content, "body", op.value ?? "", "Updated body text");

    // ── Background operations ──
    case "bg_solid":
      return applyBgSolid(content);
    case "bg_gradient":
      return applyBgGradient(content);
    case "bg_darker":
      return applyBgLightness(content, -0.15 * op.magnitude, "Darkened background");
    case "bg_lighter":
      return applyBgLightness(content, 0.15 * op.magnitude, "Lightened background");

    default:
      return { content, changed: false, description: `Unknown intent: ${op.intent}` };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// § COLOR MUTATIONS
// ═══════════════════════════════════════════════════════════════════════════════

function applyColorShift(
  content: SvgContent,
  delta: number,
  desc: string,
): { content: SvgContent; changed: boolean; description: string } {
  const c = deepCloneContent(content);
  c.backgroundColor = adjustLightness(c.backgroundColor, delta);

  if (c.backgroundGradient?.colors) {
    c.backgroundGradient = {
      ...c.backgroundGradient,
      colors: c.backgroundGradient.colors.map(col => adjustLightness(col, delta)),
    };
  }

  for (const tc of c.textContents) {
    tc.color = adjustLightness(tc.color, -delta * 0.3);
  }

  if (c.accentShape) {
    c.accentShape = { ...c.accentShape, color: adjustLightness(c.accentShape.color, delta) };
  }

  return { content: c, changed: true, description: desc };
}

function applySaturationShift(
  content: SvgContent,
  delta: number,
  desc: string,
): { content: SvgContent; changed: boolean; description: string } {
  const c = deepCloneContent(content);
  c.backgroundColor = adjustSaturation(c.backgroundColor, delta);

  if (c.backgroundGradient?.colors) {
    c.backgroundGradient = {
      ...c.backgroundGradient,
      colors: c.backgroundGradient.colors.map(col => adjustSaturation(col, delta)),
    };
  }

  if (c.accentShape) {
    c.accentShape = { ...c.accentShape, color: adjustSaturation(c.accentShape.color, delta) };
  }

  if (c.ctaStyle) {
    c.ctaStyle = { ...c.ctaStyle, backgroundColor: adjustSaturation(c.ctaStyle.backgroundColor, delta) };
  }

  return { content: c, changed: true, description: desc };
}

function applyHueShift(
  content: SvgContent,
  degrees: number,
  desc: string,
): { content: SvgContent; changed: boolean; description: string } {
  const c = deepCloneContent(content);
  c.backgroundColor = shiftHue(c.backgroundColor, degrees);

  if (c.backgroundGradient?.colors) {
    c.backgroundGradient = {
      ...c.backgroundGradient,
      colors: c.backgroundGradient.colors.map(col => shiftHue(col, degrees)),
    };
  }

  if (c.accentShape) {
    c.accentShape = { ...c.accentShape, color: shiftHue(c.accentShape.color, degrees) };
  }

  if (c.ctaStyle) {
    c.ctaStyle = { ...c.ctaStyle, backgroundColor: shiftHue(c.ctaStyle.backgroundColor, degrees) };
  }

  return { content: c, changed: true, description: desc };
}

function applySetColor(
  content: SvgContent,
  colorName: string,
): { content: SvgContent; changed: boolean; description: string } {
  const hex = resolveNamedColor(colorName);
  if (!hex) return { content, changed: false, description: `Unknown color: ${colorName}` };

  const c = deepCloneContent(content);
  if (c.accentShape) {
    c.accentShape = { ...c.accentShape, color: hex };
  }
  if (c.ctaStyle) {
    c.ctaStyle = { ...c.ctaStyle, backgroundColor: hex };
  }

  return { content: c, changed: true, description: `Set accent color to ${colorName}` };
}

// ═══════════════════════════════════════════════════════════════════════════════
// § TYPOGRAPHY MUTATIONS
// ═══════════════════════════════════════════════════════════════════════════════

function applyFontSizeChange(
  content: SvgContent,
  multiplier: number,
  target: string | undefined,
  desc: string,
): { content: SvgContent; changed: boolean; description: string } {
  const c = deepCloneContent(content);
  for (const tc of c.textContents) {
    if (target && tc.zoneId !== target) continue;
    tc.fontSize = Math.round(Math.max(10, tc.fontSize * multiplier));
  }
  return { content: c, changed: true, description: desc };
}

function applyFontWeight(
  content: SvgContent,
  weight: number,
  target: string | undefined,
  desc: string,
): { content: SvgContent; changed: boolean; description: string } {
  const c = deepCloneContent(content);
  for (const tc of c.textContents) {
    if (target && tc.zoneId !== target) continue;
    if (tc.zoneId === "headline" || tc.zoneId === "name" || !target) {
      tc.weight = weight;
    }
  }
  return { content: c, changed: true, description: desc };
}

function applyTextTransform(
  content: SvgContent,
  uppercase: boolean,
  desc: string,
): { content: SvgContent; changed: boolean; description: string } {
  const c = deepCloneContent(content);
  for (const tc of c.textContents) {
    if (tc.zoneId === "headline" || tc.zoneId === "name") {
      tc.text = uppercase ? tc.text.toUpperCase() : tc.text;
    }
  }
  return { content: c, changed: true, description: desc };
}

// ═══════════════════════════════════════════════════════════════════════════════
// § TONE MUTATIONS — compound adjustments that shift the overall feel
// ═══════════════════════════════════════════════════════════════════════════════

function applyToneBold(content: SvgContent) {
  let c = deepCloneContent(content);
  for (const tc of c.textContents) {
    if (tc.zoneId === "headline" || tc.zoneId === "name") {
      tc.weight = Math.min(900, tc.weight + 200);
      tc.fontSize = Math.round(tc.fontSize * 1.1);
    }
  }
  c.backgroundColor = adjustSaturation(c.backgroundColor, 0.15);
  return { content: c, changed: true, description: "Applied bold tone — heavier type, stronger colors" };
}

function applyToneMinimal(content: SvgContent) {
  let c = deepCloneContent(content);
  c.backgroundColor = adjustSaturation(c.backgroundColor, -0.2);
  for (const tc of c.textContents) {
    tc.weight = Math.max(300, tc.weight - 100);
  }
  c.accentShape = undefined;
  c.overlayOpacity = 0;
  return { content: c, changed: true, description: "Applied minimal tone — lighter weight, reduced decoration" };
}

function applyTonePlayful(content: SvgContent) {
  let c = deepCloneContent(content);
  c.backgroundColor = adjustSaturation(c.backgroundColor, 0.2);
  c.backgroundColor = shiftHue(c.backgroundColor, 10);
  if (c.ctaStyle) {
    c.ctaStyle = { ...c.ctaStyle, borderRadius: 50, shadow: true };
  }
  return { content: c, changed: true, description: "Applied playful tone — vibrant colors, rounded CTA" };
}

function applyTonePremium(content: SvgContent) {
  let c = deepCloneContent(content);
  c.backgroundColor = adjustLightness(c.backgroundColor, -0.15);
  c.backgroundColor = adjustSaturation(c.backgroundColor, -0.15);
  for (const tc of c.textContents) {
    if (tc.zoneId === "headline" || tc.zoneId === "name") {
      tc.weight = Math.max(300, tc.weight - 200);
    }
  }
  c.overlayOpacity = Math.min(0.5, (c.overlayOpacity ?? 0) + 0.1);
  return { content: c, changed: true, description: "Applied premium tone — darker, desaturated, lighter type" };
}

function applyToneUrgent(content: SvgContent) {
  let c = deepCloneContent(content);
  for (const tc of c.textContents) {
    if (tc.zoneId === "headline") {
      tc.weight = Math.min(900, tc.weight + 200);
      tc.fontSize = Math.round(tc.fontSize * 1.08);
    }
  }
  if (c.ctaStyle) {
    c.ctaStyle = { ...c.ctaStyle, backgroundColor: "#e53e3e" };
  }
  return { content: c, changed: true, description: "Applied urgent tone — heavier headline, red CTA" };
}

function applyToneWarm(content: SvgContent) {
  let c = deepCloneContent(content);
  c.backgroundColor = shiftHue(c.backgroundColor, 15);
  c.backgroundColor = adjustSaturation(c.backgroundColor, 0.1);
  if (c.ctaStyle) {
    c.ctaStyle = { ...c.ctaStyle, borderRadius: Math.max(c.ctaStyle.borderRadius, 12) };
  }
  return { content: c, changed: true, description: "Applied warm tone — shifted hue warm, softer CTA" };
}

function applyToneProfessional(content: SvgContent) {
  let c = deepCloneContent(content);
  c.backgroundColor = adjustSaturation(c.backgroundColor, -0.1);
  for (const tc of c.textContents) {
    tc.weight = tc.zoneId === "headline" ? 700 : 400;
  }
  if (c.ctaStyle) {
    c.ctaStyle = { ...c.ctaStyle, borderRadius: 4, shadow: false };
  }
  return { content: c, changed: true, description: "Applied professional tone — controlled palette, sharp CTA" };
}

// ═══════════════════════════════════════════════════════════════════════════════
// § CTA MUTATIONS
// ═══════════════════════════════════════════════════════════════════════════════

function applyCtaSize(
  content: SvgContent,
  multiplier: number,
  desc: string,
): { content: SvgContent; changed: boolean; description: string } {
  if (!content.ctaStyle) return { content, changed: false, description: "No CTA to modify" };
  const c = deepCloneContent(content);
  c.ctaStyle = {
    ...c.ctaStyle!,
    paddingH: Math.round(c.ctaStyle!.paddingH * multiplier),
    paddingV: Math.round(c.ctaStyle!.paddingV * multiplier),
  };
  const ctaZone = c.textContents.find(tc => tc.zoneId === "cta");
  if (ctaZone) ctaZone.fontSize = Math.round(ctaZone.fontSize * multiplier);
  return { content: c, changed: true, description: desc };
}

function applyCtaRadius(
  content: SvgContent,
  radius: number,
  desc: string,
): { content: SvgContent; changed: boolean; description: string } {
  if (!content.ctaStyle) return { content, changed: false, description: "No CTA to modify" };
  const c = deepCloneContent(content);
  c.ctaStyle = { ...c.ctaStyle!, borderRadius: radius };
  return { content: c, changed: true, description: desc };
}

function applyCtaColor(
  content: SvgContent,
  colorName: string,
): { content: SvgContent; changed: boolean; description: string } {
  if (!content.ctaStyle) return { content, changed: false, description: "No CTA to modify" };
  const hex = resolveNamedColor(colorName);
  if (!hex) return { content, changed: false, description: `Unknown color: ${colorName}` };
  const c = deepCloneContent(content);
  c.ctaStyle = { ...c.ctaStyle!, backgroundColor: hex };
  return { content: c, changed: true, description: `Set CTA color to ${colorName}` };
}

// ═══════════════════════════════════════════════════════════════════════════════
// § CONTENT MUTATIONS
// ═══════════════════════════════════════════════════════════════════════════════

function applyTextContent(
  content: SvgContent,
  zoneId: string,
  text: string,
  desc: string,
): { content: SvgContent; changed: boolean; description: string } {
  const c = deepCloneContent(content);
  const zone = c.textContents.find(tc => tc.zoneId === zoneId);
  if (!zone) return { content, changed: false, description: `Zone "${zoneId}" not found` };
  zone.text = text;
  return { content: c, changed: true, description: desc };
}

// ═══════════════════════════════════════════════════════════════════════════════
// § BACKGROUND MUTATIONS
// ═══════════════════════════════════════════════════════════════════════════════

function applyBgSolid(content: SvgContent) {
  const c = deepCloneContent(content);
  c.backgroundGradient = undefined;
  return { content: c, changed: true, description: "Removed gradient — solid background" };
}

function applyBgGradient(content: SvgContent) {
  const c = deepCloneContent(content);
  const base = c.backgroundColor;
  const lighter = adjustLightness(base, 0.15);
  c.backgroundGradient = { type: "linear", colors: [base, lighter], angle: 135 };
  return { content: c, changed: true, description: "Added gradient background" };
}

function applyBgLightness(
  content: SvgContent,
  delta: number,
  desc: string,
): { content: SvgContent; changed: boolean; description: string } {
  const c = deepCloneContent(content);
  c.backgroundColor = adjustLightness(c.backgroundColor, delta);
  if (c.backgroundGradient?.colors) {
    c.backgroundGradient = {
      ...c.backgroundGradient,
      colors: c.backgroundGradient.colors.map(col => adjustLightness(col, delta)),
    };
  }
  return { content: c, changed: true, description: desc };
}

// ═══════════════════════════════════════════════════════════════════════════════
// § HSL COLOR HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function hexToHSL(hex: string): [number, number, number] {
  hex = hex.replace(/^#/, "");
  if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  if (hex.length !== 6) return [0, 0, 0.5];
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
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }
  const toHex = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return "#" + toHex(r) + toHex(g) + toHex(b);
}

function adjustLightness(hex: string, delta: number): string {
  if (!hex.startsWith("#")) return hex;
  const [h, s, l] = hexToHSL(hex);
  return hslToHex(h, s, clamp(l + delta, 0, 1));
}

function adjustSaturation(hex: string, delta: number): string {
  if (!hex.startsWith("#")) return hex;
  const [h, s, l] = hexToHSL(hex);
  return hslToHex(h, clamp(s + delta, 0, 1), l);
}

function shiftHue(hex: string, degrees: number): string {
  if (!hex.startsWith("#")) return hex;
  const [h, s, l] = hexToHSL(hex);
  return hslToHex(h + degrees, s, l);
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

// ── Deep clone ──────────────────────────────────────────────────────────────

function deepCloneContent(content: SvgContent): SvgContent {
  return {
    backgroundColor: content.backgroundColor,
    backgroundGradient: content.backgroundGradient
      ? { ...content.backgroundGradient, colors: [...content.backgroundGradient.colors] }
      : undefined,
    textContents: content.textContents.map(tc => ({ ...tc })),
    ctaStyle: content.ctaStyle ? { ...content.ctaStyle } : undefined,
    overlayOpacity: content.overlayOpacity,
    overlayColor: content.overlayColor,
    accentShape: content.accentShape ? { ...content.accentShape } : undefined,
    _selectedTheme: content._selectedTheme,
  };
}
