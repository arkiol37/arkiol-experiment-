/**
 * Font Loader
 * ═══════════════════════════════════════════════════════════════════════════════
 * Loads web fonts from remote URLs, registers them for SVG/CSS text rendering,
 * caches them to disk to avoid re-fetching across frames, and provides a
 * deterministic fallback chain when fonts are unavailable.
 *
 * Architecture:
 *   - Fonts are fetched once per render job and written to a temp dir.
 *   - SVG <text> elements reference fonts by family name in their inline style.
 *   - Sharp (which uses libvips → librsvg) resolves fonts from the system font
 *     path. We symlink/copy downloaded fonts to the Sharp font search path.
 *   - On systems without librsvg font path support, we fall back to embedding
 *     the font as a base64 @font-face rule inside the SVG itself.
 *
 * Supported formats: woff2, woff, ttf, otf.
 *
 * Built-in fonts (always available, no download needed):
 *   Inter, Roboto, Montserrat, Poppins, Playfair Display, Oswald, Raleway
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { logger } from '../../../config/logger';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface FontSpec {
  family: string;
  url: string;
  weight?: number;  // 100–900, default 400
  style?: 'normal' | 'italic';
  format?: 'woff2' | 'woff' | 'ttf' | 'otf';
}

export interface LoadedFont {
  family: string;
  weight: number;
  style: string;
  /** Base64-encoded font data for SVG embedding. */
  base64: string;
  format: string;
  /** Path to temp file (for system font path registration). */
  localPath: string;
}

export interface FontRegistry {
  /** Fonts successfully loaded and ready to use. */
  loaded: Map<string, LoadedFont>;  // key: `${family}:${weight}:${style}`
  /** Families that failed to load (use fallback). */
  failed: Set<string>;
  /** Families that are built-in (no loading needed). */
  builtIn: Set<string>;
  /** CSS @font-face block to embed in SVG (for SVG-based text rendering). */
  svgFontFaceBlock: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// BUILT-IN FONT DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Built-in fonts loaded from Google Fonts CDN.
 * These are downloaded on first use and cached.
 */
export const BUILT_IN_FONT_SPECS: FontSpec[] = [
  {
    family: 'Inter',
    url: 'https://fonts.gstatic.com/s/inter/v13/UcCO3FwrK3iLTeHuS_fvQtMwCp50KnMw2boKoduKmMEVuLyfAZ9hiJ-Ek-_EeA.woff2',
    weight: 400, format: 'woff2',
  },
  {
    family: 'Inter',
    url: 'https://fonts.gstatic.com/s/inter/v13/UcCO3FwrK3iLTeHuS_fvQtMwCp50KnMw2boKoduKmMEVuI6fAZ9hiJ-Ek-_EeA.woff2',
    weight: 700, format: 'woff2',
  },
  {
    family: 'Inter',
    url: 'https://fonts.gstatic.com/s/inter/v13/UcCO3FwrK3iLTeHuS_fvQtMwCp50KnMw2boKoduKmMEVuGKYAZ9hiJ-Ek-_EeA.woff2',
    weight: 800, format: 'woff2',
  },
  {
    family: 'Roboto',
    url: 'https://fonts.gstatic.com/s/roboto/v30/KFOmCnqEu92Fr1Mu4mxKKTU1Kg.woff2',
    weight: 400, format: 'woff2',
  },
  {
    family: 'Roboto',
    url: 'https://fonts.gstatic.com/s/roboto/v30/KFOlCnqEu92Fr1MmWUlfBBc4AMP6lQ.woff2',
    weight: 700, format: 'woff2',
  },
  {
    family: 'Montserrat',
    url: 'https://fonts.gstatic.com/s/montserrat/v25/JTUHjIg1_i6t8kCHKm4532VJOt5-QNFgpCtr6Hw5aXo.woff2',
    weight: 700, format: 'woff2',
  },
  {
    family: 'Poppins',
    url: 'https://fonts.gstatic.com/s/poppins/v20/pxiByp8kv8JHgFVrLEj6Z1xlFd2JQEk.woff2',
    weight: 600, format: 'woff2',
  },
  {
    family: 'Poppins',
    url: 'https://fonts.gstatic.com/s/poppins/v20/pxiEyp8kv8JHgFVrJJfecg.woff2',
    weight: 400, format: 'woff2',
  },
  {
    family: 'Oswald',
    url: 'https://fonts.gstatic.com/s/oswald/v49/TK3_WkUHHAIjg75cFRf3bXL8LICs13NvgUFoZAaRliE.woff2',
    weight: 700, format: 'woff2',
  },
  {
    family: 'Playfair Display',
    url: 'https://fonts.gstatic.com/s/playfairdisplay/v30/nuFvD-vYSZviVYUb_rj3ij__anPXJzDwcbmjWBN2PKdFvUDQ.woff2',
    weight: 700, format: 'woff2',
  },
  {
    family: 'Raleway',
    url: 'https://fonts.gstatic.com/s/raleway/v28/1Ptxg8zYS_SKggPN4iEgvnHyvveLxVsEpbCIPrcVIT9d0c8.woff2',
    weight: 600, format: 'woff2',
  },
];

export const BUILT_IN_FONT_FAMILIES = new Set(
  BUILT_IN_FONT_SPECS.map(f => f.family)
);

// ═══════════════════════════════════════════════════════════════════════════════
// DISK CACHE
// ═══════════════════════════════════════════════════════════════════════════════

const FONT_CACHE_DIR = path.join(os.tmpdir(), 'arkiol-fonts');
const memCache = new Map<string, LoadedFont>();

async function ensureCacheDir(): Promise<void> {
  await fs.mkdir(FONT_CACHE_DIR, { recursive: true });
}

function fontCacheKey(spec: FontSpec): string {
  return `${spec.family.replace(/\s+/g, '-')}-w${spec.weight ?? 400}-${spec.style ?? 'normal'}`;
}

function fontCachePath(spec: FontSpec): string {
  const ext = spec.format ?? 'woff2';
  return path.join(FONT_CACHE_DIR, `${fontCacheKey(spec)}.${ext}`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// FONT LOADING
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Load a single font from URL. Returns null on failure.
 * Caches to disk and memory.
 */
async function loadFontSpec(spec: FontSpec): Promise<LoadedFont | null> {
  const key = fontCacheKey(spec);
  const memHit = memCache.get(key);
  if (memHit) return memHit;

  const diskPath = fontCachePath(spec);

  try {
    // Check disk cache
    let fontBuffer: Buffer;
    try {
      fontBuffer = await fs.readFile(diskPath);
    } catch {
      // Not cached — fetch from URL
      logger.info(`[FontLoader] Fetching font: ${spec.family} w${spec.weight ?? 400} from ${spec.url}`);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);

      try {
        const res = await fetch(spec.url, { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status} fetching font ${spec.family}`);
        fontBuffer = Buffer.from(await res.arrayBuffer());
      } finally {
        clearTimeout(timeout);
      }

      // Write to disk cache
      await ensureCacheDir();
      await fs.writeFile(diskPath, fontBuffer);
    }

    const format = spec.format ?? 'woff2';
    const mimeMap: Record<string, string> = {
      woff2: 'font/woff2',
      woff: 'font/woff',
      ttf: 'font/truetype',
      otf: 'font/opentype',
    };
    const mime = mimeMap[format] ?? 'font/woff2';
    const base64 = `data:${mime};base64,${fontBuffer.toString('base64')}`;

    const loaded: LoadedFont = {
      family: spec.family,
      weight: spec.weight ?? 400,
      style: spec.style ?? 'normal',
      base64,
      format,
      localPath: diskPath,
    };

    memCache.set(key, loaded);
    return loaded;

  } catch (err: any) {
    logger.warn(`[FontLoader] Failed to load font ${spec.family}: ${err.message}`);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Load all fonts needed for a render job.
 * Combines built-in fonts + any custom fonts from the brand/template.
 */
export async function loadFontsForScene(
  requiredFamilies: string[],
  customFonts: FontSpec[] = [],
): Promise<FontRegistry> {
  const loaded = new Map<string, LoadedFont>();
  const failed = new Set<string>();
  const builtIn = new Set<string>();

  // Collect all specs to load
  const allSpecs: FontSpec[] = [
    ...BUILT_IN_FONT_SPECS,
    ...customFonts,
  ];

  // Filter to only required families (plus Inter always as default)
  const neededFamilies = new Set(['Inter', ...requiredFamilies]);
  const specsToLoad = allSpecs.filter(s => neededFamilies.has(s.family));

  // Load in parallel
  const results = await Promise.allSettled(
    specsToLoad.map(async (spec) => {
      const font = await loadFontSpec(spec);
      return { spec, font };
    })
  );

  for (const result of results) {
    if (result.status === 'fulfilled') {
      const { spec, font } = result.value;
      if (font) {
        const key = `${spec.family}:${spec.weight ?? 400}:${spec.style ?? 'normal'}`;
        loaded.set(key, font);
        if (BUILT_IN_FONT_FAMILIES.has(spec.family)) {
          builtIn.add(spec.family);
        }
      } else {
        failed.add(spec.family);
      }
    }
  }

  // Build SVG @font-face block
  const fontFaceRules: string[] = [];
  for (const [, font] of loaded) {
    fontFaceRules.push(
      `@font-face { font-family: '${font.family}'; font-weight: ${font.weight}; font-style: ${font.style}; src: url('${font.base64}') format('${font.format}'); }`
    );
  }
  const svgFontFaceBlock = fontFaceRules.length > 0
    ? `<defs><style>${fontFaceRules.join('\n')}</style></defs>`
    : '';

  logger.info(`[FontLoader] Loaded ${loaded.size} font variants, ${failed.size} failed`, {
    families: [...neededFamilies],
    loaded: [...new Set([...loaded.values()].map(f => f.family))],
    failed: [...failed],
  });

  return { loaded, failed, builtIn, svgFontFaceBlock };
}

/**
 * Resolve a requested font family to a guaranteed-available family.
 * Uses a fallback chain: requested → Inter → system sans-serif.
 */
export function resolveFontFallback(
  requested: string,
  registry: FontRegistry,
): string {
  if (registry.loaded.has(`${requested}:400:normal`) || registry.builtIn.has(requested)) {
    return requested;
  }
  if (registry.failed.has(requested)) {
    // Try Inter first
    if (!registry.failed.has('Inter')) return 'Inter';
    return 'sans-serif';
  }
  // Unknown — default to Inter
  return registry.loaded.size > 0 ? 'Inter' : 'sans-serif';
}

/**
 * Generate a CSS font-family stack for use in SVG text elements.
 * Includes fallback fonts.
 */
export function buildFontStack(primary: string, registry: FontRegistry): string {
  const resolved = resolveFontFallback(primary, registry);
  if (resolved === 'sans-serif') return 'sans-serif';
  return `'${resolved}', 'Inter', Arial, sans-serif`;
}

/**
 * Get all loaded font weights for a family.
 */
export function getLoadedWeights(family: string, registry: FontRegistry): number[] {
  const weights: number[] = [];
  for (const [key, font] of registry.loaded) {
    if (font.family === family && font.style === 'normal') {
      weights.push(font.weight);
    }
  }
  return weights.sort((a, b) => a - b);
}

/**
 * Resolve the closest available font weight for a requested weight.
 * E.g. if 500 is requested but only 400 and 700 are loaded, returns 400.
 */
export function resolveClosestWeight(
  family: string,
  requestedWeight: number,
  registry: FontRegistry,
): number {
  const available = getLoadedWeights(family, registry);
  if (available.length === 0) return 400;
  if (available.includes(requestedWeight)) return requestedWeight;

  return available.reduce((best, w) =>
    Math.abs(w - requestedWeight) < Math.abs(best - requestedWeight) ? w : best
  );
}

/**
 * Clear the in-memory font cache.
 * Disk cache is persistent and survives process restarts.
 */
export function clearFontMemCache(): void {
  memCache.clear();
}
