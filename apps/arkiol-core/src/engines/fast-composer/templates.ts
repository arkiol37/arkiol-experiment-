// src/engines/fast-composer/templates.ts
// ─────────────────────────────────────────────────────────────────────────────
// Layout templates for the fast composer.
//
// Each template is a deterministic function that takes a Design Brain
// plan + brief content + canvas dimensions and returns a polished
// SVG string. The layouts differ in *structure* (focal placement,
// text stack arrangement, decoration density) but share the same
// palette/typography/CTA from the plan — exactly the "vary
// composition, not domain or feel" contract.
//
// The four templates:
//   • hero   — centred focal, large headline below, accent CTA
//   • split  — 50/50 image|text, weighted left or right by index
//   • card   — framed inset card with rounded background
//   • stack  — text-driven vertical stack, hero as accent
//
// All four guarantee at least: background layer + decorative
// accents + hero shape + headline + supporting copy + CTA.
// No template ever produces a plain gradient or a text-only
// composition — the strict-quality contract holds even though we
// don't run the marketplace gate on the output.
// ─────────────────────────────────────────────────────────────────────────────
import type { DesignBrainPlan } from "../design-brain";
import { buildHeroShape } from "./hero-shapes";

export interface FastTemplateInput {
  plan:     DesignBrainPlan;
  width:    number;
  height:   number;
  /** Headline (always present), optional supporting copy + CTA. */
  headline: string;
  subhead?: string;
  cta?:     string;
  badge?:   string;
}

export type LayoutKind = "hero" | "split" | "card" | "stack";

/** Map the Design Brain typography style to a CSS font-family
 *  declaration. Stays short and self-contained — no Google Fonts
 *  download in the fast path. */
function fontFamilyFor(typography: DesignBrainPlan["typography"]): {
  display: string;
  body:    string;
  weight:  number;
} {
  switch (typography) {
    case "bold_headline":     return { display: "Inter, sans-serif",     body: "Inter, sans-serif",     weight: 900 };
    case "modern_sans":       return { display: "Inter, sans-serif",     body: "Inter, sans-serif",     weight: 700 };
    case "editorial_serif":   return { display: "Georgia, serif",        body: "Georgia, serif",        weight: 700 };
    case "script_accent":     return { display: "'Brush Script MT', cursive", body: "Inter, sans-serif", weight: 700 };
    case "rounded_friendly":  return { display: "'Quicksand', 'Inter', sans-serif", body: "'Quicksand', 'Inter', sans-serif", weight: 700 };
    default:                  return { display: "Inter, sans-serif",     body: "Inter, sans-serif",     weight: 800 };
  }
}

/** Wrap a string into N display-text spans. Naive word-break that
 *  respects the maxChars budget — good enough for a headline / 1-2
 *  line subhead. Returns an array of `<tspan>` strings. */
function wrapTextIntoLines(text: string, maxCharsPerLine: number, maxLines: number): string[] {
  const words = (text || "").trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const w of words) {
    if (lines.length >= maxLines) break;
    const candidate = current ? `${current} ${w}` : w;
    if (candidate.length > maxCharsPerLine && current) {
      lines.push(current);
      current = w;
    } else {
      current = candidate;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  return lines;
}

/** Escape text for SVG body content (text only — not attributes). */
function escapeText(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Build a CTA pill positioned at (x, y) anchored top-left.
 *  Uses palette.accent on a contrasting fill. */
function buildCtaPill(
  text:     string,
  x:        number,
  y:        number,
  fontSize: number,
  palette:  DesignBrainPlan["palette"],
): { svg: string; width: number; height: number } {
  const padX  = fontSize * 0.9;
  const padY  = fontSize * 0.55;
  const w     = Math.min(fontSize * (text.length * 0.62) + padX * 2, 720);
  const h     = fontSize + padY * 2;
  return {
    svg: `
      <g class="cta">
        <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="${palette.accent}"/>
        <text x="${x + w / 2}" y="${y + h / 2 + fontSize * 0.34}" text-anchor="middle"
              font-family="Inter, sans-serif" font-weight="900" font-size="${fontSize}"
              fill="${palette.background}" letter-spacing="${fontSize * 0.04}">
          ${escapeText(text.toUpperCase())}
        </text>
      </g>`,
    width:  w,
    height: h,
  };
}

/** Hero layout. Centred hero shape at top, large headline, subhead,
 *  CTA pill at bottom-center. Strong, single-focal composition. */
function heroLayout(input: FastTemplateInput): string {
  const { plan, width, height, headline, subhead, cta, badge } = input;
  const fonts = fontFamilyFor(plan.typography);
  const heroR = Math.min(width, height) * 0.22;
  const heroCx = width / 2;
  const heroCy = height * 0.32;

  const headlineSize = Math.round(Math.min(width, height) * 0.075);
  const headlineLines = wrapTextIntoLines(headline, 22, 3);

  const subheadSize = Math.round(headlineSize * 0.42);
  const subheadLines = subhead ? wrapTextIntoLines(subhead, 50, 2) : [];

  const ctaSize = Math.round(headlineSize * 0.36);
  const ctaText = (cta && cta.trim()) || plan.ctaSuggestion;
  const cy = height * 0.55;
  const lineH = headlineSize * 1.08;
  const subY = cy + lineH * headlineLines.length + headlineSize * 0.4;
  const ctaY = subY + (subheadLines.length > 0 ? subheadSize * 1.5 + 36 : 56);

  const pill = buildCtaPill(ctaText, 0, 0, ctaSize, plan.palette);

  const decorRadius = Math.min(width, height) * 0.32;
  const accentDots = [
    { cx: width * 0.12, cy: height * 0.12, r: decorRadius * 0.06 },
    { cx: width * 0.88, cy: height * 0.18, r: decorRadius * 0.04 },
    { cx: width * 0.05, cy: height * 0.85, r: decorRadius * 0.05 },
    { cx: width * 0.92, cy: height * 0.78, r: decorRadius * 0.07 },
  ].map(d =>
    `<circle cx="${d.cx}" cy="${d.cy}" r="${d.r}" fill="${plan.palette.accent}" opacity="0.28"/>`
  ).join("");

  const headlineTspans = headlineLines.map((l, i) =>
    `<tspan x="${width / 2}" dy="${i === 0 ? 0 : lineH}">${escapeText(l)}</tspan>`
  ).join("");
  const subheadTspans = subheadLines.map((l, i) =>
    `<tspan x="${width / 2}" dy="${i === 0 ? 0 : subheadSize * 1.35}">${escapeText(l)}</tspan>`
  ).join("");

  const badgeSvg = badge && badge.trim() ? `
    <g>
      <rect x="${width / 2 - 100}" y="${height * 0.07}" width="200" height="44" rx="22" fill="${plan.palette.primary}"/>
      <text x="${width / 2}" y="${height * 0.07 + 30}" text-anchor="middle" font-family="${fonts.body}" font-weight="800" font-size="20" fill="${plan.palette.background}">${escapeText(badge.toUpperCase())}</text>
    </g>` : "";

  return `
    <rect width="${width}" height="${height}" fill="${plan.palette.background}"/>
    ${accentDots}
    ${buildHeroShape(plan, { cx: heroCx, cy: heroCy, radius: heroR })}
    ${badgeSvg}
    <text x="${width / 2}" y="${cy}" text-anchor="middle"
          font-family="${fonts.display}" font-weight="${fonts.weight}"
          font-size="${headlineSize}" fill="${plan.palette.primary}">
      ${headlineTspans}
    </text>
    ${subheadLines.length > 0 ? `
    <text x="${width / 2}" y="${subY}" text-anchor="middle"
          font-family="${fonts.body}" font-weight="500"
          font-size="${subheadSize}" fill="${plan.palette.primary}" opacity="0.78">
      ${subheadTspans}
    </text>` : ""}
    <g transform="translate(${width / 2 - pill.width / 2}, ${ctaY})">
      ${pill.svg}
    </g>
  `;
}

/** Split layout. 50/50 image|text. Variation index decides which
 *  side carries the hero. */
function splitLayout(input: FastTemplateInput, mirror: boolean): string {
  const { plan, width, height, headline, subhead, cta, badge } = input;
  const fonts = fontFamilyFor(plan.typography);
  const heroBlockW = width * 0.5;
  const heroCx = mirror ? width - heroBlockW / 2 : heroBlockW / 2;
  const heroCy = height / 2;
  const heroR  = Math.min(heroBlockW, height) * 0.32;

  const textBlockX = mirror ? 0 : heroBlockW;
  const textPad = width * 0.07;
  const textX = textBlockX + textPad;
  const textW = heroBlockW - textPad * 2;

  const headlineSize = Math.round(Math.min(width, height) * 0.07);
  const headlineLines = wrapTextIntoLines(headline, 16, 4);
  const subheadSize = Math.round(headlineSize * 0.42);
  const subheadLines = subhead ? wrapTextIntoLines(subhead, 38, 3) : [];

  const ctaSize = Math.round(headlineSize * 0.34);
  const ctaText = (cta && cta.trim()) || plan.ctaSuggestion;
  const pill = buildCtaPill(ctaText, 0, 0, ctaSize, plan.palette);

  const lineH = headlineSize * 1.08;
  const headlineY = height * 0.32;
  const subY = headlineY + lineH * headlineLines.length + 28;
  const ctaY = subY + (subheadLines.length > 0 ? subheadSize * 1.4 * subheadLines.length + 40 : 60);

  const heroPanel = `
    <rect x="${mirror ? width - heroBlockW : 0}" y="0" width="${heroBlockW}" height="${height}" fill="${plan.palette.primary}" opacity="0.1"/>
    <circle cx="${heroCx}" cy="${heroCy}" r="${heroR * 1.1}" fill="${plan.palette.accent}" opacity="0.18"/>
    ${buildHeroShape(plan, { cx: heroCx, cy: heroCy, radius: heroR })}
  `;

  const headlineTspans = headlineLines.map((l, i) =>
    `<tspan x="${textX}" dy="${i === 0 ? 0 : lineH}">${escapeText(l)}</tspan>`
  ).join("");
  const subheadTspans = subheadLines.map((l, i) =>
    `<tspan x="${textX}" dy="${i === 0 ? 0 : subheadSize * 1.4}">${escapeText(l)}</tspan>`
  ).join("");

  const badgeSvg = badge && badge.trim() ? `
    <g>
      <rect x="${textX}" y="${headlineY - headlineSize * 1.2}" width="${Math.min(textW, badge.length * 16 + 30)}" height="36" rx="18" fill="${plan.palette.accent}"/>
      <text x="${textX + Math.min(textW, badge.length * 16 + 30) / 2}" y="${headlineY - headlineSize * 1.2 + 24}" text-anchor="middle" font-family="${fonts.body}" font-weight="800" font-size="18" fill="${plan.palette.background}">${escapeText(badge.toUpperCase())}</text>
    </g>` : "";

  return `
    <rect width="${width}" height="${height}" fill="${plan.palette.background}"/>
    ${heroPanel}
    ${badgeSvg}
    <text x="${textX}" y="${headlineY}"
          font-family="${fonts.display}" font-weight="${fonts.weight}"
          font-size="${headlineSize}" fill="${plan.palette.primary}">
      ${headlineTspans}
    </text>
    ${subheadLines.length > 0 ? `
    <text x="${textX}" y="${subY}"
          font-family="${fonts.body}" font-weight="500"
          font-size="${subheadSize}" fill="${plan.palette.primary}" opacity="0.78">
      ${subheadTspans}
    </text>` : ""}
    <g transform="translate(${textX}, ${ctaY})">
      ${pill.svg}
    </g>
  `;
}

/** Card layout. Background full-bleed in a neutral, rounded card
 *  inset with hero on the side, headline + cta on the other. */
function cardLayout(input: FastTemplateInput): string {
  const { plan, width, height, headline, subhead, cta, badge } = input;
  const fonts = fontFamilyFor(plan.typography);

  const cardPad = width * 0.06;
  const cardX = cardPad;
  const cardY = cardPad;
  const cardW = width - cardPad * 2;
  const cardH = height - cardPad * 2;

  const heroR = Math.min(cardW, cardH) * 0.22;
  const heroCx = cardX + cardW * 0.78;
  const heroCy = cardY + cardH * 0.3;

  const textX = cardX + cardW * 0.08;
  const headlineSize = Math.round(Math.min(width, height) * 0.072);
  const headlineLines = wrapTextIntoLines(headline, 18, 3);

  const subheadSize = Math.round(headlineSize * 0.4);
  const subheadLines = subhead ? wrapTextIntoLines(subhead, 42, 3) : [];
  const ctaSize = Math.round(headlineSize * 0.32);
  const ctaText = (cta && cta.trim()) || plan.ctaSuggestion;
  const pill = buildCtaPill(ctaText, 0, 0, ctaSize, plan.palette);

  const headlineY = cardY + cardH * 0.55;
  const lineH = headlineSize * 1.06;
  const subY = headlineY + lineH * headlineLines.length + 24;
  const ctaY = subY + (subheadLines.length > 0 ? subheadSize * 1.4 * subheadLines.length + 40 : 60);

  const headlineTspans = headlineLines.map((l, i) =>
    `<tspan x="${textX}" dy="${i === 0 ? 0 : lineH}">${escapeText(l)}</tspan>`
  ).join("");
  const subheadTspans = subheadLines.map((l, i) =>
    `<tspan x="${textX}" dy="${i === 0 ? 0 : subheadSize * 1.4}">${escapeText(l)}</tspan>`
  ).join("");

  const badgeSvg = badge && badge.trim() ? `
    <g>
      <rect x="${textX}" y="${headlineY - headlineSize * 1.4}" width="${Math.max(120, badge.length * 16 + 30)}" height="36" rx="18" fill="${plan.palette.primary}"/>
      <text x="${textX + Math.max(120, badge.length * 16 + 30) / 2}" y="${headlineY - headlineSize * 1.4 + 24}" text-anchor="middle" font-family="${fonts.body}" font-weight="800" font-size="18" fill="${plan.palette.background}">${escapeText(badge.toUpperCase())}</text>
    </g>` : "";

  return `
    <rect width="${width}" height="${height}" fill="${plan.palette.accent}" opacity="0.12"/>
    <rect x="${cardX}" y="${cardY}" width="${cardW}" height="${cardH}" rx="${cardW * 0.04}" fill="${plan.palette.background}"/>
    <circle cx="${heroCx}" cy="${heroCy}" r="${heroR * 1.25}" fill="${plan.palette.accent}" opacity="0.22"/>
    ${buildHeroShape(plan, { cx: heroCx, cy: heroCy, radius: heroR })}
    ${badgeSvg}
    <text x="${textX}" y="${headlineY}"
          font-family="${fonts.display}" font-weight="${fonts.weight}"
          font-size="${headlineSize}" fill="${plan.palette.primary}">
      ${headlineTspans}
    </text>
    ${subheadLines.length > 0 ? `
    <text x="${textX}" y="${subY}"
          font-family="${fonts.body}" font-weight="500"
          font-size="${subheadSize}" fill="${plan.palette.primary}" opacity="0.78">
      ${subheadTspans}
    </text>` : ""}
    <g transform="translate(${textX}, ${ctaY})">
      ${pill.svg}
    </g>
  `;
}

/** Stack layout. Vertical text-driven composition. Hero acts as a
 *  small accent at the top; the headline is the dominant element. */
function stackLayout(input: FastTemplateInput): string {
  const { plan, width, height, headline, subhead, cta, badge } = input;
  const fonts = fontFamilyFor(plan.typography);

  const heroR = Math.min(width, height) * 0.12;
  const heroCx = width / 2;
  const heroCy = height * 0.18;

  const textX = width / 2;
  const headlineSize = Math.round(Math.min(width, height) * 0.085);
  const headlineLines = wrapTextIntoLines(headline, 14, 4);
  const subheadSize = Math.round(headlineSize * 0.36);
  const subheadLines = subhead ? wrapTextIntoLines(subhead, 44, 2) : [];
  const ctaSize = Math.round(headlineSize * 0.32);
  const ctaText = (cta && cta.trim()) || plan.ctaSuggestion;
  const pill = buildCtaPill(ctaText, 0, 0, ctaSize, plan.palette);

  const headlineY = height * 0.42;
  const lineH = headlineSize * 1.04;
  const subY = headlineY + lineH * headlineLines.length + 28;
  const ctaY = subY + (subheadLines.length > 0 ? subheadSize * 1.4 * subheadLines.length + 48 : 68);

  const verticalRule = `
    <line x1="${width / 2}" y1="${height * 0.27}" x2="${width / 2}" y2="${height * 0.31}" stroke="${plan.palette.accent}" stroke-width="4" stroke-linecap="round"/>
  `;

  const headlineTspans = headlineLines.map((l, i) =>
    `<tspan x="${textX}" dy="${i === 0 ? 0 : lineH}">${escapeText(l)}</tspan>`
  ).join("");
  const subheadTspans = subheadLines.map((l, i) =>
    `<tspan x="${textX}" dy="${i === 0 ? 0 : subheadSize * 1.4}">${escapeText(l)}</tspan>`
  ).join("");

  const badgeSvg = badge && badge.trim() ? `
    <g>
      <rect x="${width / 2 - 100}" y="${height * 0.08}" width="200" height="40" rx="20" fill="${plan.palette.primary}"/>
      <text x="${width / 2}" y="${height * 0.08 + 27}" text-anchor="middle" font-family="${fonts.body}" font-weight="800" font-size="18" fill="${plan.palette.background}">${escapeText(badge.toUpperCase())}</text>
    </g>` : "";

  return `
    <rect width="${width}" height="${height}" fill="${plan.palette.background}"/>
    ${badgeSvg}
    ${buildHeroShape(plan, { cx: heroCx, cy: heroCy, radius: heroR })}
    ${verticalRule}
    <text x="${textX}" y="${headlineY}" text-anchor="middle"
          font-family="${fonts.display}" font-weight="${fonts.weight}"
          font-size="${headlineSize}" fill="${plan.palette.primary}">
      ${headlineTspans}
    </text>
    ${subheadLines.length > 0 ? `
    <text x="${textX}" y="${subY}" text-anchor="middle"
          font-family="${fonts.body}" font-weight="500"
          font-size="${subheadSize}" fill="${plan.palette.primary}" opacity="0.78">
      ${subheadTspans}
    </text>` : ""}
    <g transform="translate(${width / 2 - pill.width / 2}, ${ctaY})">
      ${pill.svg}
    </g>
  `;
}

/** Pick a layout for the given variation index. We rotate through
 *  the four templates so a 4-template gallery shows one of each. */
export function pickLayoutForVariation(variationIndex: number): LayoutKind {
  const order: LayoutKind[] = ["hero", "split", "card", "stack"];
  return order[Math.abs(variationIndex) % order.length];
}

/** Render the chosen layout for the given variation. Returns the
 *  inner SVG body — the caller wraps it in an <svg> root with the
 *  correct viewBox/width/height. */
export function renderLayout(layout: LayoutKind, variationIndex: number, input: FastTemplateInput): string {
  switch (layout) {
    case "hero":  return heroLayout(input);
    case "split": return splitLayout(input, variationIndex % 2 === 1);
    case "card":  return cardLayout(input);
    case "stack": return stackLayout(input);
    default:      return heroLayout(input);
  }
}
