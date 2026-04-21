// src/engines/render/font-registry-ultimate.ts
//
// ─── Arkiol Ultimate: Extended Font Registry ─────────────────────────────────
//
// Extends the base font registry with the full set of Google Fonts used by
// the design theme engine. Each font maps to a downloadable TTF that the
// worker fetches and caches on startup.
//
// Font download strategy:
//   1. At worker startup, call initUltimateFonts() once
//   2. Fonts are fetched from Google Fonts CDN and written to /tmp/arkiol-fonts/
//   3. Subsequent calls use the local cache (fast path)
//   4. registerFont() binds each TTF to its CSS family name for node-canvas
//   5. SVG @font-face rules reference the same files via FONT_CDN_BASE_URL
//
// Font pairing system:
//   Each ThemeFont has a defined stack: display font + body fallback.
//   This matches exactly what Canva uses internally for their templates.

import path from "path";
import fs   from "fs";
import https from "https";

export type UltimateFont =
  | "Montserrat"
  | "Playfair Display"
  | "Oswald"
  | "Poppins"
  | "Raleway"
  | "Nunito"
  | "Nunito Sans"
  | "Lato"
  | "Bebas Neue"
  | "DM Sans"
  | "Cormorant Garamond"
  // Step 64 — script / cursive faces (display-only, headline roles)
  | "Dancing Script"
  | "Caveat"
  | "Sacramento"
  | "Allura"
  | "Pacifico";

export interface FontVariant {
  family:  UltimateFont;
  weight:  300 | 400 | 600 | 700 | 800 | 900;
  style:   "normal" | "italic";
  // Google Fonts API URL pattern for this variant
  googleId: string;
  // Local filename in FONTS_DIR
  file: string;
}

const FONTS_CACHE_DIR = process.env.FONT_CACHE_DIR ?? "/tmp/arkiol-fonts";

// ── Font variant definitions ─────────────────────────────────────────────────
// Only the weights we actually use in themes — not all variants
export const ULTIMATE_FONTS: FontVariant[] = [
  // Montserrat — primary display for energetic/bold/professional themes
  { family: "Montserrat", weight: 400, style: "normal", googleId: "Montserrat:wght@400", file: "Montserrat-Regular.ttf" },
  { family: "Montserrat", weight: 600, style: "normal", googleId: "Montserrat:wght@600", file: "Montserrat-SemiBold.ttf" },
  { family: "Montserrat", weight: 700, style: "normal", googleId: "Montserrat:wght@700", file: "Montserrat-Bold.ttf" },
  { family: "Montserrat", weight: 800, style: "normal", googleId: "Montserrat:wght@800", file: "Montserrat-ExtraBold.ttf" },
  { family: "Montserrat", weight: 900, style: "normal", googleId: "Montserrat:wght@900", file: "Montserrat-Black.ttf" },

  // Playfair Display — serif elegance for luxe/romance/editorial themes
  { family: "Playfair Display", weight: 700, style: "normal", googleId: "Playfair+Display:wght@700", file: "PlayfairDisplay-Bold.ttf" },
  { family: "Playfair Display", weight: 900, style: "normal", googleId: "Playfair+Display:wght@900", file: "PlayfairDisplay-Black.ttf" },
  { family: "Playfair Display", weight: 700, style: "italic", googleId: "Playfair+Display:ital,wght@1,700", file: "PlayfairDisplay-BoldItalic.ttf" },

  // Oswald — condensed display for editorial/power/sport themes
  { family: "Oswald", weight: 600, style: "normal", googleId: "Oswald:wght@600", file: "Oswald-SemiBold.ttf" },
  { family: "Oswald", weight: 700, style: "normal", googleId: "Oswald:wght@700", file: "Oswald-Bold.ttf" },

  // Poppins — geometric sans for lifestyle/wellness themes
  { family: "Poppins", weight: 400, style: "normal", googleId: "Poppins:wght@400", file: "Poppins-Regular.ttf" },
  { family: "Poppins", weight: 600, style: "normal", googleId: "Poppins:wght@600", file: "Poppins-SemiBold.ttf" },
  { family: "Poppins", weight: 700, style: "normal", googleId: "Poppins:wght@700", file: "Poppins-Bold.ttf" },
  { family: "Poppins", weight: 800, style: "normal", googleId: "Poppins:wght@800", file: "Poppins-ExtraBold.ttf" },

  // Raleway — elegant sans for sophisticated/travel themes
  { family: "Raleway", weight: 400, style: "normal", googleId: "Raleway:wght@400", file: "Raleway-Regular.ttf" },
  { family: "Raleway", weight: 700, style: "normal", googleId: "Raleway:wght@700", file: "Raleway-Bold.ttf" },
  { family: "Raleway", weight: 900, style: "normal", googleId: "Raleway:wght@900", file: "Raleway-Black.ttf" },

  // Lato — body text universal
  { family: "Lato", weight: 300, style: "normal", googleId: "Lato:wght@300", file: "Lato-Light.ttf" },
  { family: "Lato", weight: 400, style: "normal", googleId: "Lato:wght@400", file: "Lato-Regular.ttf" },
  { family: "Lato", weight: 700, style: "normal", googleId: "Lato:wght@700", file: "Lato-Bold.ttf" },

  // DM Sans — modern neutral for wellness/tech themes
  { family: "DM Sans", weight: 400, style: "normal", googleId: "DM+Sans:wght@400", file: "DMSans-Regular.ttf" },
  { family: "DM Sans", weight: 700, style: "normal", googleId: "DM+Sans:wght@700", file: "DMSans-Bold.ttf" },

  // Cormorant Garamond — high-fashion editorial
  { family: "Cormorant Garamond", weight: 600, style: "normal", googleId: "Cormorant+Garamond:wght@600", file: "CormorantGaramond-SemiBold.ttf" },
  { family: "Cormorant Garamond", weight: 700, style: "normal", googleId: "Cormorant+Garamond:wght@700", file: "CormorantGaramond-Bold.ttf" },

  // Nunito — rounded friendly sans for warm/playful themes (peach, wellness)
  { family: "Nunito", weight: 400, style: "normal", googleId: "Nunito:wght@400", file: "Nunito-Regular.ttf" },
  { family: "Nunito", weight: 600, style: "normal", googleId: "Nunito:wght@600", file: "Nunito-SemiBold.ttf" },
  { family: "Nunito", weight: 700, style: "normal", googleId: "Nunito:wght@700", file: "Nunito-Bold.ttf" },
  { family: "Nunito", weight: 800, style: "normal", googleId: "Nunito:wght@800", file: "Nunito-ExtraBold.ttf" },

  // Step 64 — script / cursive display faces. Single weight each — these
  // fonts are almost always shipped in a single cut because their
  // letterforms don't benefit from multiple weights.
  { family: "Dancing Script", weight: 700, style: "normal", googleId: "Dancing+Script:wght@700", file: "DancingScript-Bold.ttf" },
  { family: "Caveat",         weight: 700, style: "normal", googleId: "Caveat:wght@700",         file: "Caveat-Bold.ttf" },
  { family: "Sacramento",     weight: 400, style: "normal", googleId: "Sacramento:wght@400",     file: "Sacramento-Regular.ttf" },
  { family: "Allura",         weight: 400, style: "normal", googleId: "Allura:wght@400",         file: "Allura-Regular.ttf" },
  { family: "Pacifico",       weight: 400, style: "normal", googleId: "Pacifico:wght@400",       file: "Pacifico-Regular.ttf" },
];

// ── Char-width ratios for text measurement (em units at 100px) ───────────────
// Measured empirically from each font. Used by text-measure.ts fallback path.
export const ULTIMATE_CHAR_WIDTH_RATIOS: Record<string, number> = {
  "Montserrat":         0.52,
  "Playfair Display":   0.53,
  "Oswald":             0.42,   // condensed — narrower than average
  "Poppins":            0.535,
  "Raleway":            0.505,
  "Lato":               0.505,
  "DM Sans":            0.51,
  "Cormorant Garamond": 0.48,
  "Nunito":             0.53,
  "Nunito Sans":        0.52,
  "Bebas Neue":         0.44,
  // Step 64 — scripts have ligature-driven widths; measured averages
  // across uppercase + lowercase strings at headline sizes.
  "Dancing Script":     0.45,
  "Caveat":             0.42,
  "Sacramento":         0.40,
  "Allura":             0.38,
  "Pacifico":           0.50,
};

// ── Font download (Google Fonts) ─────────────────────────────────────────────
function downloadFile(url: string, dest: string, redirects = 3): Promise<void> {
  return new Promise((resolve, reject) => {
    if (fs.existsSync(dest)) { resolve(); return; }
    const file = fs.createWriteStream(dest);
    https.get(url, (response: any) => {
      // Follow redirects (Google Fonts CDN may 301/302)
      if ([301, 302, 307, 308].includes(response.statusCode) && response.headers.location && redirects > 0) {
        file.close();
        fs.unlink(dest, () => {});
        downloadFile(response.headers.location, dest, redirects - 1).then(resolve, reject);
        return;
      }
      response.pipe(file);
      file.on("finish", () => { file.close(); resolve(); });
    }).on("error", (err: Error) => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

// ── Font registration state ──────────────────────────────────────────────────
let ultimateRegistered = false;

export interface FontInitResult {
  ok:         boolean;
  registered: number;
  downloaded: number;
  errors:     string[];
}

/**
 * Initialize the ultimate font system.
 * Downloads missing Google Fonts TTFs to the cache dir, then registers all
 * available fonts with node-canvas (if available).
 *
 * IMPORTANT: Fonts are ALWAYS downloaded to disk, even without canvas.
 * This is critical for Vercel/serverless: buildUltimateFontFaces() needs the
 * local TTF files to base64-embed them in SVG, which is the only way sharp
 * (libvips) can render custom fonts in PNG output.
 */
export async function initUltimateFonts(): Promise<FontInitResult> {
  if (ultimateRegistered) {
    return { ok: true, registered: ULTIMATE_FONTS.length, downloaded: 0, errors: [] };
  }

  const errors: string[] = [];
  let downloaded = 0;
  let registered = 0;

  // Ensure cache directory exists
  try {
    fs.mkdirSync(FONTS_CACHE_DIR, { recursive: true });
  } catch (e: any) {
    return { ok: false, registered: 0, downloaded: 0, errors: [`Cannot create font cache dir: ${e.message}`] };
  }

  // Try to load canvas (optional — only needed for GIF rendering, not SVG/PNG)
  let registerFont: ((p: string, props: object) => void) | null = null;
  try {
    registerFont = require("canvas").registerFont;
  } catch {
    // Canvas not available (serverless). Font download still proceeds below
    // so buildUltimateFontFaces() can base64-embed TTFs into SVG for sharp.
  }

  // Download missing fonts — ALWAYS, even without canvas
  const GOOGLE_FONTS_BASE = "https://fonts.gstatic.com/s";
  // Font file URL map — these are the canonical Google Fonts CDN paths
  const FONT_CDN_PATHS: Record<string, string> = {
    "Montserrat-Regular.ttf":          `${GOOGLE_FONTS_BASE}/montserrat/v25/JTUHjIg1_i6t8kCHKm4532VJOt5-QNFgpCtr6Ew-.ttf`,
    "Montserrat-SemiBold.ttf":         `${GOOGLE_FONTS_BASE}/montserrat/v25/JTUHjIg1_i6t8kCHKm4532VJOt5-QNFgpCtZ6Ew-.ttf`,
    "Montserrat-Bold.ttf":             `${GOOGLE_FONTS_BASE}/montserrat/v25/JTUHjIg1_i6t8kCHKm4532VJOt5-QNFgpCuM70w-.ttf`,
    "Montserrat-ExtraBold.ttf":        `${GOOGLE_FONTS_BASE}/montserrat/v25/JTUHjIg1_i6t8kCHKm4532VJOt5-QNFgpCvr6Ew-.ttf`,
    "Montserrat-Black.ttf":            `${GOOGLE_FONTS_BASE}/montserrat/v25/JTUHjIg1_i6t8kCHKm4532VJOt5-QNFgpCvqaEw-.ttf`,
    "PlayfairDisplay-Bold.ttf":        `${GOOGLE_FONTS_BASE}/playfairdisplay/v30/nuFvD-vYSZviVYUb_rj3ij__anPXJzDwcbmjWBN2PKdFvUDQ.ttf`,
    "PlayfairDisplay-Black.ttf":       `${GOOGLE_FONTS_BASE}/playfairdisplay/v30/nuFvD-vYSZviVYUb_rj3ij__anPXJzDwcbmjWBN2PKebvkDQ.ttf`,
    "PlayfairDisplay-BoldItalic.ttf":  `${GOOGLE_FONTS_BASE}/playfairdisplay/v30/nuFRD-vYSZviVYUb_rj3ij__anPXBYf9lWcB62Kxts-4QYbC.ttf`,
    "Oswald-SemiBold.ttf":             `${GOOGLE_FONTS_BASE}/oswald/v53/TK3_WkUHHAIjg75cFRf3bXL8LICs1_FvgUFoZAaRliE.ttf`,
    "Oswald-Bold.ttf":                 `${GOOGLE_FONTS_BASE}/oswald/v53/TK3_WkUHHAIjg75cFRf3bXL8LICs1_FvgUIOZAaRliE.ttf`,
    "Poppins-Regular.ttf":             `${GOOGLE_FONTS_BASE}/poppins/v20/pxiEyp8kv8JHgFVrJJfecg.ttf`,
    "Poppins-SemiBold.ttf":            `${GOOGLE_FONTS_BASE}/poppins/v20/pxiByp8kv8JHgFVrLEj6Z1xlFQ.ttf`,
    "Poppins-Bold.ttf":                `${GOOGLE_FONTS_BASE}/poppins/v20/pxiByp8kv8JHgFVrLCz7Z1xlFQ.ttf`,
    "Poppins-ExtraBold.ttf":           `${GOOGLE_FONTS_BASE}/poppins/v20/pxiByp8kv8JHgFVrLDD4Z1xlFQ.ttf`,
    "Raleway-Regular.ttf":             `${GOOGLE_FONTS_BASE}/raleway/v28/1Ptug8zYS_SKggPNyCMIT4ttDfCmxA.ttf`,
    "Raleway-Bold.ttf":                `${GOOGLE_FONTS_BASE}/raleway/v28/1Ptug8zYS_SKggPNyCMIT5ZtDfCmxA.ttf`,
    "Raleway-Black.ttf":               `${GOOGLE_FONTS_BASE}/raleway/v28/1Ptug8zYS_SKggPNyCMIT5NpDfCmxA.ttf`,
    "Lato-Light.ttf":                  `${GOOGLE_FONTS_BASE}/lato/v24/S6u9w4BMUTPHh7USSwiPGQ.ttf`,
    "Lato-Regular.ttf":                `${GOOGLE_FONTS_BASE}/lato/v24/S6uyw4BMUTPHjx4wWw.ttf`,
    "Lato-Bold.ttf":                   `${GOOGLE_FONTS_BASE}/lato/v24/S6u9w4BMUTPHh6UVSwiPGQ.ttf`,
    "DMSans-Regular.ttf":              `${GOOGLE_FONTS_BASE}/dmsans/v11/rP2Hp2ywxg089UriCZOIHTWEBlw.ttf`,
    "DMSans-Bold.ttf":                 `${GOOGLE_FONTS_BASE}/dmsans/v11/rP2Cp2ywxg089UriCZa4ET-DNl0.ttf`,
    "CormorantGaramond-SemiBold.ttf":  `${GOOGLE_FONTS_BASE}/cormorantgaramond/v16/co3YmX5slCNuHLi8bLeY9MK7whWMhyjYqXtK.ttf`,
    "CormorantGaramond-Bold.ttf":      `${GOOGLE_FONTS_BASE}/cormorantgaramond/v16/co3YmX5slCNuHLi8bLeY9MK7whWMhyjYrHpK.ttf`,
    // Step 64 — script faces. Google Fonts gstatic CDN paths.
    "DancingScript-Bold.ttf":          `${GOOGLE_FONTS_BASE}/dancingscript/v25/If2RXTr6YS-zF4S-kcSWSVi_sxjsohD9F50Ruu7BMSoHSec.ttf`,
    "Caveat-Bold.ttf":                 `${GOOGLE_FONTS_BASE}/caveat/v17/WnznHAc5bAfYB2QRah7pcpNvOx-pjfJ9SIKjYBxPig.ttf`,
    "Sacramento-Regular.ttf":          `${GOOGLE_FONTS_BASE}/sacramento/v13/buEzpo6gcdjy0EiZMBUG0CoV_NxLeiw.ttf`,
    "Allura-Regular.ttf":              `${GOOGLE_FONTS_BASE}/allura/v21/9oRPNYsQpS4zjuAPjAIXPtrrGA.ttf`,
    "Pacifico-Regular.ttf":            `${GOOGLE_FONTS_BASE}/pacifico/v22/FwZY7-Qmy14u9lezJ-6H6MmBp0u-.ttf`,
  };

  // Download all fonts concurrently
  await Promise.allSettled(
    ULTIMATE_FONTS.map(async (font) => {
      const dest = path.join(FONTS_CACHE_DIR, font.file);
      const url  = FONT_CDN_PATHS[font.file];
      if (!url) {
        errors.push(`No CDN path for ${font.file}`);
        return;
      }
      try {
        await downloadFile(url, dest);
        downloaded++;
      } catch (e: any) {
        errors.push(`Download failed ${font.file}: ${e.message}`);
      }
    })
  );

  // Register all successfully downloaded fonts
  for (const font of ULTIMATE_FONTS) {
    const fontPath = path.join(FONTS_CACHE_DIR, font.file);
    if (!fs.existsSync(fontPath)) continue;
    try {
      registerFont!(fontPath, {
        family: font.family,
        weight: String(font.weight),
        style:  font.style,
      });
      registered++;
    } catch (e: any) {
      errors.push(`Registration failed ${font.family} ${font.weight}: ${e.message}`);
    }
  }

  ultimateRegistered = true;
  return { ok: errors.length === 0, registered, downloaded, errors };
}

/**
 * Build @font-face CSS for SVG embedding.
 *
 * Priority order:
 *   1. Local TTF files in FONTS_CACHE_DIR -> base64 data URI (works for sharp PNG rasterization)
 *   2. FONT_CDN_BASE_URL set -> CDN URL (works for browser SVG rendering)
 *   3. Neither -> empty string (SVG viewers fall back to system fonts)
 *
 * The base64 path is the only one that works reliably for PNG output, because
 * sharp/libvips rasterizes SVG entirely in-process and cannot make HTTP requests
 * to load external @font-face URLs. Embedding the TTF directly ensures Google
 * Fonts appear identically in SVG, PNG, and all export formats.
 */
export function buildUltimateFontFaces(cdnBase?: string): string {
  const seen  = new Set<string>();
  const rules: string[] = [];

  for (const font of ULTIMATE_FONTS) {
    const key = `${font.family}-${font.weight}-${font.style}`;
    if (seen.has(key)) continue;
    seen.add(key);

    // Strategy 1: Embed as base64 data URI if local TTF is cached on disk.
    // This is the only method that works for sharp SVG->PNG rasterization,
    // since libvips cannot make HTTP requests to load external @font-face URLs.
    const localPath = path.join(FONTS_CACHE_DIR, font.file);
    let src: string | null = null;

    if (fs.existsSync(localPath)) {
      try {
        const b64 = fs.readFileSync(localPath).toString("base64");
        src = `url("data:font/truetype;base64,${b64}") format("truetype")`;
      } catch {
        // Fall through to CDN strategy
      }
    }

    // Strategy 2: CDN URL (browser SVG only -- sharp PNG will fall back to system fonts).
    if (!src) {
      const base = cdnBase ?? process.env.FONT_CDN_BASE_URL ?? "";
      if (base) {
        src = `url("${base}/${font.file}") format("truetype")`;
      }
    }

    // Strategy 3: Nothing available -- skip this font face entry.
    if (!src) continue;

    rules.push([
      `@font-face {`,
      `  font-family: "${font.family}";`,
      `  font-weight: ${font.weight};`,
      `  font-style: ${font.style};`,
      `  src: ${src};`,
      `  font-display: block;`,
      `}`,
    ].join("\n"));
  }

  return rules.join("\n");
}

/**
 * Map a theme font name to the CSS font-family stack for use in SVG and canvas.
 * Always includes a generic fallback for resilience.
 */
export function getFontStack(family: string): string {
  const fallbacks: Record<string, string> = {
    "Montserrat":           "Montserrat, Arial, sans-serif",
    "Playfair Display":     "\"Playfair Display\", Georgia, serif",
    "Oswald":               "Oswald, \"Arial Narrow\", sans-serif",
    "Poppins":              "Poppins, Arial, sans-serif",
    "Raleway":              "Raleway, Arial, sans-serif",
    "Lato":                 "Lato, Arial, sans-serif",
    "DM Sans":              "\"DM Sans\", Arial, sans-serif",
    "Cormorant Garamond":   "\"Cormorant Garamond\", Georgia, serif",
    "Nunito":               "Nunito, Arial, sans-serif",
    "Bebas Neue":           "\"Bebas Neue\", Impact, sans-serif",
    // Step 64 — scripts fall back to cursive generic family so a
    // user-agent that lacks the font still renders something
    // handwritten instead of a flat Arial.
    "Dancing Script":       "\"Dancing Script\", \"Brush Script MT\", cursive",
    "Caveat":               "Caveat, \"Segoe Script\", cursive",
    "Sacramento":           "Sacramento, \"Snell Roundhand\", cursive",
    "Allura":               "Allura, \"Apple Chancery\", cursive",
    "Pacifico":             "Pacifico, \"Brush Script MT\", cursive",
  };
  return fallbacks[family] ?? `"${family}", Arial, sans-serif`;
}
