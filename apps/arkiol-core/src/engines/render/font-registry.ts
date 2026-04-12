// src/engines/render/font-registry.ts
//
// Canonical font registry for ALL renderers — SVG, PNG (canvas), and GIF.
//
// WHY THIS MATTERS:
//   SVG fonts are resolved by the viewer's OS font stack.
//   Canvas fonts are resolved by the worker's system font stack.
//   If these differ, the same fontSize produces different rendered widths,
//   causing text-measure.ts to wrap at different points → format drift.
//
// THE FIX:
//   We bundle exact TTF files into assets/fonts/ and register them with
//   node-canvas at worker startup via registerFont(). The same physical
//   font files are referenced in SVG @font-face rules and in canvas.font
//   strings, so measureText() and SVG rendering use exactly the same metrics.
//
// FONT MAP:
//   "Arial"        → DejaVu Sans      (metrically similar, Apache 2.0)
//   "Georgia"      → DejaVu Serif     (metrically similar, Apache 2.0)
//   "Courier New"  → DejaVu Sans Mono (metrically similar, Apache 2.0)
//   "Verdana"      → Liberation Sans  (metrically similar, SIL OFL)
//   "Impact"       → Liberation Sans Bold (closest open substitute)
//   "Trebuchet MS" → DejaVu Sans      (fallback)
//
// IMPORTANT: The font family names passed to registerFont must match EXACTLY
// what canvas uses in its ctx.font string. We use the ALIAS names (Arial,
// Georgia, etc.) so that all existing call sites work without change.

import path from "path";
import fs   from "fs";

// ── Font definitions ──────────────────────────────────────────────────────────
const FONTS_DIR = path.join(process.cwd(), "assets", "fonts");

export interface FontDef {
  family:  string;  // CSS family name (the alias we use in code)
  file:    string;  // filename in assets/fonts/
  weight:  "normal" | "bold";
  style:   "normal" | "italic";
}

export const FONT_DEFINITIONS: FontDef[] = [
  // Arial → DejaVu Sans
  { family: "Arial", file: "DejaVuSans-Regular.ttf",  weight: "normal", style: "normal" },
  { family: "Arial", file: "DejaVuSans-Bold.ttf",     weight: "bold",   style: "normal" },
  { family: "Arial", file: "DejaVuSans-Italic.ttf",   weight: "normal", style: "italic" },

  // Georgia → DejaVu Serif
  { family: "Georgia", file: "DejaVuSerif-Regular.ttf", weight: "normal", style: "normal" },
  { family: "Georgia", file: "DejaVuSerif-Bold.ttf",    weight: "bold",   style: "normal" },

  // Courier New → DejaVu Sans Mono
  { family: "Courier New", file: "DejaVuSansMono-Regular.ttf", weight: "normal", style: "normal" },

  // Verdana, Impact, Trebuchet MS → Liberation Sans (closest open substitute)
  { family: "Verdana",      file: "LiberationSans-Regular.ttf", weight: "normal", style: "normal" },
  { family: "Verdana",      file: "LiberationSans-Bold.ttf",    weight: "bold",   style: "normal" },
  { family: "Impact",       file: "LiberationSans-Bold.ttf",    weight: "bold",   style: "normal" },
  { family: "Trebuchet MS", file: "LiberationSans-Regular.ttf", weight: "normal", style: "normal" },
  { family: "Trebuchet MS", file: "LiberationSans-Bold.ttf",    weight: "bold",   style: "normal" },
];

// ── Registration state ────────────────────────────────────────────────────────
let registered = false;

/**
 * Register all bundled fonts with node-canvas.
 * MUST be called once at worker startup before any canvas rendering.
 * Safe to call multiple times — idempotent.
 *
 * In serverless/API environments (no native canvas), this is a no-op
 * because the text-measure fallback uses char-width ratios instead.
 */
export function registerFonts(): { ok: boolean; registered: number; error?: string } {
  if (registered) return { ok: true, registered: FONT_DEFINITIONS.length };

  // Verify font directory exists
  if (!fs.existsSync(FONTS_DIR)) {
    return { ok: false, registered: 0, error: `Font directory not found: ${FONTS_DIR}` };
  }

  // Try to load canvas — only available in worker environment
  let registerFont: (path: string, props: { family: string; weight: string; style: string }) => void;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    registerFont = require("canvas").registerFont;
  } catch {
    // canvas not available (e.g. Vercel serverless) — skip registration
    return { ok: true, registered: 0, error: "canvas not available (serverless env)" };
  }

  let count = 0;
  const errors: string[] = [];

  for (const def of FONT_DEFINITIONS) {
    const fontPath = path.join(FONTS_DIR, def.file);
    if (!fs.existsSync(fontPath)) {
      errors.push(`Missing font file: ${def.file}`);
      continue;
    }
    try {
      registerFont(fontPath, { family: def.family, weight: def.weight, style: def.style });
      count++;
    } catch (err: any) {
      errors.push(`Failed to register ${def.family} (${def.file}): ${err.message}`);
    }
  }

  registered = true;
  return {
    ok:         errors.length === 0,
    registered: count,
    error:      errors.length > 0 ? errors.join("; ") : undefined,
  };
}

/**
 * Build SVG @font-face declarations for the bundled font set.
 * Called by svg-builder.ts to embed font references in every SVG.
 * SVG viewers that cannot load the external URLs will fall back to system fonts
 * of the same family name, which is acceptable for on-screen display.
 *
 * In production, serve assets/fonts/ from S3/CDN and set FONT_CDN_BASE_URL.
 */
export function buildSvgFontFaces(cdnBase?: string): string {
  let envBase: string | undefined;
  try {
    const { getEnv } = require('@arkiol/shared'); // lazy to avoid circular deps
    envBase = getEnv?.()?.FONT_CDN_BASE_URL;
  } catch { /* pre-init — fall back to no CDN */ }
  const base = cdnBase ?? envBase ?? "";
  if (!base) return ""; // No CDN configured — omit @font-face (use system fonts)

  const seen = new Set<string>();
  const rules: string[] = [];

  for (const def of FONT_DEFINITIONS) {
    const key = `${def.family}-${def.weight}-${def.style}`;
    if (seen.has(key)) continue;
    seen.add(key);

    rules.push([
      `@font-face {`,
      `  font-family: "${def.family}";`,
      `  font-weight: ${def.weight === "bold" ? "700" : "400"};`,
      `  font-style: ${def.style};`,
      `  src: url("${base}/${def.file}") format("truetype");`,
      `  font-display: block;`,
      `}`,
    ].join("\n"));
  }

  return rules.join("\n");
}

/**
 * Char-width ratios for the REGISTERED fonts (used by text-measure.ts fallback).
 * Measured empirically against DejaVu Sans at 100px.
 */
export const REGISTERED_CHAR_WIDTH_RATIOS: Record<string, number> = {
  "Arial":        0.505,  // DejaVu Sans
  "Georgia":      0.520,  // DejaVu Serif
  "Courier New":  0.601,  // DejaVu Sans Mono (monospaced — exact)
  "Verdana":      0.515,  // Liberation Sans
  "Impact":       0.515,  // Liberation Sans Bold
  "Trebuchet MS": 0.505,  // Liberation Sans
};
