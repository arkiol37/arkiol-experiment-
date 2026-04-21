// src/engines/render/svg-builder.ts
//
// SVG renderer — NO <foreignObject>.
//
// All text layout uses text-measure.ts (wrapText + measureTextInZone) which is
// the SAME module used by the PNG canvas renderer and GIF renderer. This
// guarantees that the same line-breaks, font-sizes, and anchor positions appear
// in SVG, PNG, and GIF — zero cross-format drift.
//
// Rendering path for text zones:
//   measureTextInZone() → lines[] + fontSize + baselineY
//   → <text> with one <tspan dy="lineHeight"> per line
//
// CTA zones:
//   measureLineWidth() → button width → centred <rect> + <text>

import "server-only";
import { chatJSON }           from "../../lib/openai";
import { withRetry }          from "../../lib/error-handling";
import { Zone, ZoneId }       from "../layout/families";
import { BriefAnalysis }      from "../ai/brief-analyzer";
import { TextContent, enforceHierarchy } from "../hierarchy/enforcer";
import { FORMAT_DIMS }        from "../../lib/types";
import {
  measureTextInZone,
  measureLineWidth,
  getSvgLineYPositions,
} from "./text-measure";
import { buildSvgFontFaces } from "./font-registry";
import { z }                  from "zod";

// ── Schema for AI-generated SVG content ──────────────────────────────────────
const SvgContentSchema = z.object({
  backgroundColor:    z.string().regex(/^#[0-9a-fA-F]{6}$/),
  backgroundGradient: z.object({
    type:   z.enum(["linear", "radial", "none"]),
    colors: z.array(z.string().regex(/^#[0-9a-fA-F]{6}$/)).min(1).max(3),
    angle:  z.number().min(0).max(360).optional(),
  }).optional(),
  textContents: z.array(z.object({
    zoneId:     z.string(),
    text:       z.string().max(300),
    fontSize:   z.number().min(8).max(300),
    weight:     z.number().multipleOf(100).min(100).max(900),
    color:      z.string().regex(/^#[0-9a-fA-F]{6}$/),
    fontFamily: z.enum(["Arial", "Georgia", "Impact", "Trebuchet MS", "Verdana", "Courier New"]),
  })),
  ctaStyle: z.object({
    backgroundColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    textColor:       z.string().regex(/^#[0-9a-fA-F]{6}$/),
    borderRadius:    z.number().min(0).max(100),
    paddingH:        z.number().min(8).max(80),
    paddingV:        z.number().min(4).max(40),
  }).optional(),
  overlayOpacity: z.number().min(0).max(0.8).optional(),
  overlayColor:   z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  accentShape: z.object({
    type:  z.enum(["rect", "circle", "line", "none"]),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    x:     z.number(),
    y:     z.number(),
    w:     z.number(),
    h:     z.number(),
    opacity: z.number().min(0).max(1).optional(),
    borderRadius: z.number().min(0).optional(),
  }).optional(),
});

export type SvgContent = z.infer<typeof SvgContentSchema>;

export interface BuildResult {
  content:    SvgContent;
  violations: string[];
}

// ── AI Content Generator ──────────────────────────────────────────────────────
export async function buildSvgContent(
  zones:  Zone[],
  brief:  BriefAnalysis,
  format: string,
  brand?: { primaryColor: string; secondaryColor: string; fontDisplay: string }
): Promise<BuildResult> {
  const dims = FORMAT_DIMS[format] ?? { width: 1080, height: 1080 };

  const zoneDescriptions = zones
    .filter(z => !["background"].includes(z.id))
    .map(z => {
      const absX = Math.round((z.x / 100) * dims.width);
      const absY = Math.round((z.y / 100) * dims.height);
      const absW = Math.round((z.width / 100) * dims.width);
      const absH = Math.round((z.height / 100) * dims.height);
      return [
        `zone="${z.id}" [${absX},${absY} ${absW}×${absH}px]`,
        z.minFontSize ? `fontSize: ${z.minFontSize}–${z.maxFontSize ?? 96}px` : "",
        z.constraints?.maxChars ? `maxChars: ${z.constraints.maxChars}` : "",
        z.required ? "(required)" : "(optional)",
      ].filter(Boolean).join(", ");
    })
    .join("\n");

  const brandNote = brand
    ? `Brand colors: primary=${brand.primaryColor}, secondary=${brand.secondaryColor}. Prefer brand colors for key elements.`
    : "";

  const systemPrompt = `You are a visual design AI for a professional asset generation platform.
Canvas: ${dims.width}x${dims.height}px. Format: ${format}.
Brief: ${JSON.stringify(brief)}.
${brandNote}

FIXED layout zones (you CANNOT change positions or sizes):
${zoneDescriptions}

Generate visual style and text content for these zones.
Rules:
- backgroundColor: choose a color that creates strong visual impact for "${brief.colorMood}" mood
- Use backgroundGradient for richer backgrounds (type=none if flat color preferred)
- textContents: only include zones listed above; match text to brief content
- fontSize must be within each zone's min/max range
- headline text must be at most ${zones.find(z => z.id === "headline")?.constraints?.maxChars ?? 60} chars
- overlayOpacity: use 0.3-0.6 when image zone exists for text legibility
- accentShape: add a subtle branded shape element (or type=none)
- ctaStyle: provide only if "cta" zone exists in list above
- All colors: valid 6-digit hex only
- Respond ONLY with valid JSON, no markdown`;

  const raw = await withRetry(
    () => chatJSON(
      [
        { role: "system", content: systemPrompt },
        { role: "user",   content: "Generate the visual content." },
      ],
      { model: "gpt-4o", temperature: 0.65, max_tokens: 1000 }
    ),
    { maxAttempts: 2, baseDelayMs: 300 }
  );

  const parsed = SvgContentSchema.safeParse(raw);
  if (!parsed.success) {
    const fallback: SvgContent = {
      backgroundColor: brief.primaryColor ?? "#f8f7f4",
      backgroundGradient: { type: "linear", colors: [brief.primaryColor ?? "#f8f7f4", "#0f3460"], angle: 135 },
      textContents: zones
        .filter(z => z.required && z.id !== "background")
        .map(z => ({
          zoneId:     z.id,
          text:       getDefaultText(z.id, brief),
          fontSize:   z.minFontSize ?? 24,
          weight:     z.id === "headline" ? 800 : z.id === "cta" ? 700 : 400,
          color:      "#ffffff",
          fontFamily: "Arial" as const,
        })),
    };
    return { content: fallback, violations: [`Schema validation failed: used fallback. ${parsed.error.message}`] };
  }

  const content = parsed.data;

  const enforced = enforceHierarchy(
    zones,
    content.textContents as TextContent[]
  );

  return {
    content: { ...content, textContents: enforced.contents as any },
    violations: enforced.violations.map(v => `${v.zoneId}: ${v.issue} -> ${v.applied}`),
  };
}

function getDefaultText(zoneId: string, brief: BriefAnalysis): string {
  const map: Record<string, string> = {
    headline:       brief.headline,
    subhead:        brief.subhead  ?? brief.audience,
    cta:            brief.cta      ?? "Learn More",
    badge:          brief.badge    ?? "NEW",
    tagline:        brief.tagline  ?? brief.keywords[0] ?? "",
    body:           brief.body     ?? "",
    logo:           "",
    price:          brief.priceText ?? "",
    legal:          "",
    name:           brief.name    ?? brief.headline,
    title:          brief.title   ?? brief.subhead ?? "",
    company:        brief.company ?? "",
    contact:        brief.contact ?? "",
    section_header: "Experience",
    bullet_1:       brief.keywords[0] ?? "",
    bullet_2:       brief.keywords[1] ?? "",
    bullet_3:       brief.keywords[2] ?? "",
    accent:         "",
  };
  return map[zoneId] ?? "";
}

// ── SVG Renderer ──────────────────────────────────────────────────────────────
// Renders ALL text as native <text>/<tspan> elements -- NO <foreignObject>.
// Line-wrapping uses the SAME text-measure.ts as the PNG and GIF renderers,
// ensuring identical layout across all three formats.
export function renderSvg(
  zones:   Zone[],
  content: SvgContent,
  format:  string
): string {
  const { width, height } = FORMAT_DIMS[format] ?? { width: 1080, height: 1080 };
  const px = (pct: number, total: number) => Math.round((pct / 100) * total);

  // ── @font-face declarations (from bundled font set) ────────────────────────
  // When FONT_CDN_BASE_URL is set, SVG viewers load the exact same TTF files
  // used by the worker canvas → zero metric drift between SVG and PNG outputs.
  const fontFaces = buildSvgFontFaces();

  // ── Gradient defs ─────────────────────────────────────────────────────────
  let defs = "";
  const grad = content.backgroundGradient;
  if (grad && grad.type !== "none" && grad.colors.length >= 1) {
    if (grad.type === "linear") {
      const angle = grad.angle ?? 135;
      const rad   = (angle * Math.PI) / 180;
      const x2    = 50 + 50 * Math.sin(rad);
      const y2    = 50 - 50 * Math.cos(rad);
      const stops = grad.colors.map((c: string, i: number) =>
        `<stop offset="${Math.round(i / (grad.colors.length - 1) * 100)}%" stop-color="${c}"/>`
      ).join("");
      defs += `<linearGradient id="bg" x1="0%" y1="0%" x2="${x2.toFixed(1)}%" y2="${y2.toFixed(1)}%">${stops}</linearGradient>`;
    } else if (grad.type === "radial") {
      const stops = grad.colors.map((c: string, i: number) =>
        `<stop offset="${Math.round(i / (grad.colors.length - 1) * 100)}%" stop-color="${c}"/>`
      ).join("");
      defs += `<radialGradient id="bg" cx="50%" cy="50%" r="70%">${stops}</radialGradient>`;
    }
  }

  const bgFill = defs ? "url(#bg)" : content.backgroundColor;

  // ── Base elements ─────────────────────────────────────────────────────────
  let els = `<rect width="${width}" height="${height}" fill="${bgFill}"/>`;

  if (content.overlayOpacity && content.overlayOpacity > 0) {
    els += `<rect width="${width}" height="${height}" fill="${content.overlayColor ?? "#000000"}" opacity="${content.overlayOpacity}"/>`;
  }

  // Accent shape
  const shape = content.accentShape;
  if (shape && shape.type !== "none") {
    const sx = px(shape.x, width);
    const sy = px(shape.y, height);
    const sw = px(shape.w, width);
    const sh = px(shape.h, height);
    const opacity = shape.opacity ?? 0.15;
    if (shape.type === "rect") {
      els += `<rect x="${sx}" y="${sy}" width="${sw}" height="${sh}" fill="${shape.color}" opacity="${opacity}" rx="${shape.borderRadius ?? 8}"/>`;
    } else if (shape.type === "circle") {
      els += `<circle cx="${sx + sw / 2}" cy="${sy + sh / 2}" r="${Math.min(sw, sh) / 2}" fill="${shape.color}" opacity="${opacity}"/>`;
    } else if (shape.type === "line") {
      els += `<rect x="${sx}" y="${sy}" width="${sw}" height="${sh}" fill="${shape.color}" opacity="${opacity}"/>`;
    }
  }

  // ── Text zones -- native <text>/<tspan>, NO <foreignObject> ──────────────
  const zoneMap = new Map(zones.map(z => [z.id, z]));

  for (const tc of content.textContents) {
    if (!tc.text?.trim()) continue;
    const zone = zoneMap.get(tc.zoneId as ZoneId);
    if (!zone) continue;

    // ── CTA button ────────────────────────────────────────────────────────
    if (tc.zoneId === "cta" && content.ctaStyle) {
      const cs    = content.ctaStyle;
      const zoneX = px(zone.x, width);
      const zoneY = px(zone.y, height);
      const zoneW = px(zone.width, width);
      const zoneH = px(zone.height, height);

      // Use text-measure for accurate button width -- same as GIF renderer
      const textW  = measureLineWidth(tc.text, tc.fontSize, tc.fontFamily, tc.weight);
      const btnW   = Math.min(zoneW, Math.max(textW + cs.paddingH * 2, 80));
      const btnH   = tc.fontSize + cs.paddingV * 2;
      const btnX   = zone.alignH === "center" ? zoneX + (zoneW - btnW) / 2
                   : zone.alignH === "right"   ? zoneX + zoneW - btnW
                   : zoneX;
      const btnY   = zoneY + (zoneH - btnH) / 2;
      const textX  = btnX + btnW / 2;
      // SVG baseline: paddingV + cap-height approximation (0.72 * fontSize)
      const textY  = btnY + cs.paddingV + tc.fontSize * 0.72;

      els += `<rect x="${btnX.toFixed(1)}" y="${btnY.toFixed(1)}" width="${btnW.toFixed(1)}" height="${btnH.toFixed(1)}" fill="${cs.backgroundColor}" rx="${cs.borderRadius}"/>`;
      els += `<text x="${textX.toFixed(1)}" y="${textY.toFixed(1)}" font-size="${tc.fontSize}" font-weight="${tc.weight}" fill="${cs.textColor}" font-family="${escAttr(tc.fontFamily)}, sans-serif" text-anchor="middle">${escSvg(tc.text)}</text>`;
      continue;
    }

    // ── Regular text zones: measureTextInZone -> multi-line tspans ────────
    // This is the IDENTICAL measurement path used by the PNG canvas renderer
    // and GIF canvas renderer, so all formats wrap text at the same points.
    const measured = measureTextInZone(
      tc.text,
      tc.fontSize,
      tc.fontFamily,
      tc.weight,
      zone,
      width,
      height
    );

    const yPositions = getSvgLineYPositions(measured);
    // Map numeric weight to CSS font-weight string
    const fontWeightStr = tc.weight >= 700 ? "bold" : tc.weight >= 600 ? "600" : "normal";

    const tspans = measured.lines.map((line, i) =>
      `<tspan x="${measured.textAnchorX.toFixed(1)}" y="${yPositions[i].toFixed(1)}">${escSvg(line)}</tspan>`
    ).join("");

    els += `<text font-size="${measured.fontSize}" font-weight="${fontWeightStr}" fill="${tc.color}" font-family="${escAttr(tc.fontFamily)}, sans-serif" text-anchor="${measured.svgTextAnchor}">${tspans}</text>`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
     width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>${fontFaces ? `<style>${fontFaces}</style>` : ""}${defs}</defs>
  ${els}
</svg>`;
}

// ── Escape helpers ────────────────────────────────────────────────────────────
function escSvg(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function escAttr(str: string): string {
  return str.replace(/"/g, "&quot;");
}
