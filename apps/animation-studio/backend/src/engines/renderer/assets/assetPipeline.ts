/**
 * Asset Pipeline
 * ═══════════════════════════════════════════════════════════════════════════════
 * Manages loading, caching, and preparation of all rendering resources:
 *   - Fonts: registered globally for canvas text rendering
 *   - Images: fetched from URLs/S3, decoded, resized, cached in memory
 *   - Logos: prepared with transparent background, sized to fit slots
 *   - Colors: parsed and validated
 *
 * All assets are pre-loaded before rendering starts so that frame generation
 * is purely CPU-bound with no I/O stalls.
 */

import sharp from 'sharp';
import fs from 'fs/promises';
import path from 'path';
import { logger } from '../../../config/logger';
import type { SceneBindings, SlotBinding, BrandBinding, BackgroundDef } from '../types';
import { loadFontsForScene, type FontRegistry, type FontSpec } from './fontLoader';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface LoadedAssets {
  /** Image buffers keyed by slot ID. Already decoded + resized to target dimensions. */
  images: Map<string, { buffer: Buffer; width: number; height: number; channels: number }>;
  /** Background image buffer (if background type is 'image'). */
  backgroundImage?: { buffer: Buffer; width: number; height: number };
  /** Logo buffer (from brand binding). */
  logoBuf?: { buffer: Buffer; width: number; height: number };
  /** Registered font families available for text rendering. */
  fonts: Set<string>;
  /** Loaded font registry — available for SVG @font-face embedding. */
  fontRegistry?: FontRegistry;
}

interface ImageCacheEntry {
  buffer: Buffer;
  width: number;
  height: number;
  channels: number;
  fetchedAt: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// IN-MEMORY CACHE
// ═══════════════════════════════════════════════════════════════════════════════

const imageCache = new Map<string, ImageCacheEntry>();
const MAX_CACHE_SIZE = 200;
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

function getCached(key: string): ImageCacheEntry | null {
  const entry = imageCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > CACHE_TTL_MS) {
    imageCache.delete(key);
    return null;
  }
  return entry;
}

function setCache(key: string, entry: ImageCacheEntry): void {
  // Evict oldest entries if cache is full
  if (imageCache.size >= MAX_CACHE_SIZE) {
    const oldest = [...imageCache.entries()]
      .sort((a, b) => a[1].fetchedAt - b[1].fetchedAt)
      .slice(0, 20);
    for (const [k] of oldest) imageCache.delete(k);
  }
  imageCache.set(key, entry);
}

// ═══════════════════════════════════════════════════════════════════════════════
// IMAGE LOADING
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Fetch an image from a URL or local path, decode it, return raw RGBA buffer.
 * v27: includes retry with exponential backoff and generated placeholder fallback.
 */
async function loadImage(
  src: string,
  targetWidth?: number,
  targetHeight?: number,
): Promise<{ buffer: Buffer; width: number; height: number; channels: number }> {
  const cacheKey = `${src}:${targetWidth ?? 'auto'}x${targetHeight ?? 'auto'}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  let inputBuffer: Buffer | null = null;
  const MAX_RETRIES = 2;

  if (src.startsWith('http://') || src.startsWith('https://')) {
    // Fetch from URL with retry
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30_000);
        try {
          const res = await fetch(src, { signal: controller.signal });
          if (!res.ok) throw new Error(`HTTP ${res.status} fetching image: ${src}`);
          inputBuffer = Buffer.from(await res.arrayBuffer());
        } finally {
          clearTimeout(timeout);
        }
        break; // success
      } catch (err: any) {
        if (attempt < MAX_RETRIES) {
          logger.warn(`[AssetPipeline] Image fetch retry ${attempt + 1}/${MAX_RETRIES}: ${err.message}`);
          await new Promise(r => setTimeout(r, 1000 * (attempt + 1))); // exponential backoff
        } else {
          logger.warn(`[AssetPipeline] Image fetch failed after ${MAX_RETRIES + 1} attempts: ${err.message}`);
        }
      }
    }
  } else if (src.startsWith('data:')) {
    const match = src.match(/^data:[^;]+;base64,(.+)$/);
    if (!match) throw new Error('Invalid data URL');
    inputBuffer = Buffer.from(match[1], 'base64');
  } else {
    try {
      inputBuffer = await fs.readFile(src);
    } catch {
      logger.warn(`[AssetPipeline] Local file not found: ${src}`);
    }
  }

  // v27: Generate placeholder if all fetch attempts failed
  if (!inputBuffer) {
    const w = targetWidth || 400;
    const h = targetHeight || 400;
    logger.info(`[AssetPipeline] Generating placeholder for failed asset: ${src.substring(0, 80)}`);
    // Create a subtle branded placeholder (warm neutral gradient)
    const placeholderSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
      <defs><linearGradient id="pg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" style="stop-color:#f1ece3;stop-opacity:1"/>
        <stop offset="100%" style="stop-color:#e8e0d4;stop-opacity:1"/>
      </linearGradient></defs>
      <rect width="${w}" height="${h}" fill="url(#pg)"/>
    </svg>`;
    inputBuffer = Buffer.from(placeholderSvg);
  }

  // Decode and optionally resize with Sharp
  let pipeline = sharp(inputBuffer).ensureAlpha();

  if (targetWidth && targetHeight) {
    pipeline = pipeline.resize(targetWidth, targetHeight, {
      fit: 'cover',
      position: 'centre',
    });
  } else if (targetWidth) {
    pipeline = pipeline.resize(targetWidth, undefined, { fit: 'inside' });
  }

  const { data, info } = await pipeline.raw().toBuffer({ resolveWithObject: true });

  const entry: ImageCacheEntry = {
    buffer: data,
    width: info.width,
    height: info.height,
    channels: info.channels,
    fetchedAt: Date.now(),
  };

  setCache(cacheKey, entry);
  return entry;
}

/**
 * Load an image from a Buffer (already in memory).
 */
async function loadImageFromBuffer(
  buf: Buffer,
  targetWidth?: number,
  targetHeight?: number,
): Promise<{ buffer: Buffer; width: number; height: number; channels: number }> {
  let pipeline = sharp(buf).ensureAlpha();

  if (targetWidth && targetHeight) {
    pipeline = pipeline.resize(targetWidth, targetHeight, { fit: 'cover', position: 'centre' });
  }

  const { data, info } = await pipeline.raw().toBuffer({ resolveWithObject: true });
  return { buffer: data, width: info.width, height: info.height, channels: info.channels };
}

// ═══════════════════════════════════════════════════════════════════════════════
// FONT MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════════

/** Built-in fonts that are always available (bundled or system). */
const BUILT_IN_FONTS = new Set([
  'Inter', 'Roboto', 'Open Sans', 'Montserrat', 'Poppins',
  'Lato', 'Oswald', 'Raleway', 'Playfair Display', 'Source Sans Pro',
  'Arial', 'Helvetica', 'sans-serif',
]);

/**
 * Resolve a font family to an available font.
 * Falls back through a preference chain.
 */
export function resolveFont(requested: string): string {
  if (BUILT_IN_FONTS.has(requested)) return requested;
  // Fallback chain
  const fallbacks = ['Inter', 'Roboto', 'Arial', 'sans-serif'];
  for (const f of fallbacks) {
    if (BUILT_IN_FONTS.has(f)) return f;
  }
  return 'sans-serif';
}

// ═══════════════════════════════════════════════════════════════════════════════
// COLOR UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

/** Parse hex color to RGBA components (0–255). */
export function parseColor(hex: string): { r: number; g: number; b: number; a: number } {
  const h = hex.replace('#', '');
  if (h.length === 6) {
    return {
      r: parseInt(h.substring(0, 2), 16),
      g: parseInt(h.substring(2, 4), 16),
      b: parseInt(h.substring(4, 6), 16),
      a: 255,
    };
  }
  if (h.length === 8) {
    return {
      r: parseInt(h.substring(0, 2), 16),
      g: parseInt(h.substring(2, 4), 16),
      b: parseInt(h.substring(4, 6), 16),
      a: parseInt(h.substring(6, 8), 16),
    };
  }
  return { r: 0, g: 0, b: 0, a: 255 };
}

/** Create a solid-color raw RGBA buffer. */
export function createSolidBuffer(
  width: number,
  height: number,
  color: string,
): Buffer {
  const { r, g, b, a } = parseColor(color);
  const buf = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const offset = i * 4;
    buf[offset] = r;
    buf[offset + 1] = g;
    buf[offset + 2] = b;
    buf[offset + 3] = a;
  }
  return buf;
}

/**
 * Create a linear gradient raw RGBA buffer.
 */
export function createGradientBuffer(
  width: number,
  height: number,
  stops: Array<{ color: string; position: number }>,
  angleDeg: number,
): Buffer {
  const buf = Buffer.alloc(width * height * 4);
  const angleRad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);

  const parsedStops = stops
    .map(s => ({ ...parseColor(s.color), pos: s.position }))
    .sort((a, b) => a.pos - b.pos);

  if (parsedStops.length === 0) return buf;
  if (parsedStops.length === 1) return createSolidBuffer(width, height, stops[0].color);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Project pixel position onto gradient axis
      const nx = x / width - 0.5;
      const ny = y / height - 0.5;
      const t = Math.max(0, Math.min(1, (nx * cos + ny * sin) + 0.5));

      // Find bracketing stops
      let from = parsedStops[0];
      let to = parsedStops[parsedStops.length - 1];
      for (let i = 0; i < parsedStops.length - 1; i++) {
        if (t >= parsedStops[i].pos && t <= parsedStops[i + 1].pos) {
          from = parsedStops[i];
          to = parsedStops[i + 1];
          break;
        }
      }

      const range = to.pos - from.pos;
      const localT = range > 0 ? (t - from.pos) / range : 0;

      const offset = (y * width + x) * 4;
      buf[offset] = Math.round(from.r + (to.r - from.r) * localT);
      buf[offset + 1] = Math.round(from.g + (to.g - from.g) * localT);
      buf[offset + 2] = Math.round(from.b + (to.b - from.b) * localT);
      buf[offset + 3] = Math.round(from.a + (to.a - from.a) * localT);
    }
  }

  return buf;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN ASSET LOADER
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Pre-load all assets needed for a scene render.
 * Call once before frame rendering starts.
 */
export async function loadSceneAssets(
  bindings: SceneBindings,
  canvasWidth: number,
  canvasHeight: number,
  slots: Array<{ id: string; type: string; positions: Record<string, any>; imageFit: string }>,
): Promise<LoadedAssets> {
  const loaded: LoadedAssets = {
    images: new Map(),
    fonts: new Set(BUILT_IN_FONTS),
  };

  const imageJobs: Array<Promise<void>> = [];

  // Load slot images
  for (const slot of slots) {
    const binding = bindings.slots[slot.id];
    if (!binding) continue;

    if ((slot.type === 'image' || slot.type === 'logo') && (binding.imageSrc || binding.imageBuffer)) {
      const pos = slot.positions[bindings.aspectRatio] || Object.values(slot.positions)[0];
      const targetW = Math.round((pos?.w ?? 0.5) * canvasWidth);
      const targetH = Math.round((pos?.h ?? 0.5) * canvasHeight);

      imageJobs.push(
        (async () => {
          try {
            const img = binding.imageBuffer
              ? await loadImageFromBuffer(binding.imageBuffer, targetW, targetH)
              : await loadImage(binding.imageSrc!, targetW, targetH);
            loaded.images.set(slot.id, img);
          } catch (err: any) {
            logger.warn(`[AssetPipeline] Failed to load image for slot ${slot.id}: ${err.message}`);
          }
        })()
      );
    }
  }

  // Load background image
  if (bindings.background?.type === 'image' && bindings.background.src) {
    imageJobs.push(
      (async () => {
        try {
          const img = await loadImage(bindings.background!.src as any, canvasWidth, canvasHeight);
          loaded.backgroundImage = { buffer: img.buffer, width: img.width, height: img.height };
        } catch (err: any) {
          logger.warn(`[AssetPipeline] Failed to load background image: ${err.message}`);
        }
      })()
    );
  }

  // Load brand logo
  if (bindings.brand?.logoSrc || bindings.brand?.logoBuffer) {
    imageJobs.push(
      (async () => {
        try {
          const img = bindings.brand!.logoBuffer
            ? await loadImageFromBuffer(bindings.brand!.logoBuffer, 300, 300)
            : await loadImage(bindings.brand!.logoSrc!, 300, 300);
          loaded.logoBuf = { buffer: img.buffer, width: img.width, height: img.height };
        } catch (err: any) {
          logger.warn(`[AssetPipeline] Failed to load brand logo: ${err.message}`);
        }
      })()
    );
  }

  // Wait for all image loads
  await Promise.allSettled(imageJobs);

  // Load fonts asynchronously
  try {
    // Collect all font families needed by text slots
    const requiredFamilies: string[] = [];
    for (const slot of slots) {
      if (slot.type === 'text' || slot.type === 'icon') {
        const binding = bindings.slots[slot.id];
        const styleOverride = binding?.styleOverrides?.text?.fontFamily;
        if (styleOverride) requiredFamilies.push(styleOverride);
      }
    }
    // Always load Inter as the default fallback
    requiredFamilies.push('Inter');

    // Custom fonts from brand
    const customFonts: FontSpec[] = [];
    if ((bindings as any).brand?.fontFamily) {
      // Custom font spec — will be fetched if it's in BUILT_IN_FONT_SPECS or passed explicitly
      requiredFamilies.push((bindings as any).brand.fontFamily);
    }

    const fontRegistry = await loadFontsForScene(
      [...new Set(requiredFamilies)],
      customFonts,
    );
    loaded.fontRegistry = fontRegistry;
    loaded.fonts = new Set([...BUILT_IN_FONTS, ...fontRegistry.builtIn]);
  } catch (fontErr: any) {
    logger.warn(`[AssetPipeline] Font loading failed (non-fatal): ${fontErr.message}`);
  }

  logger.info(`[AssetPipeline] Loaded ${loaded.images.size} images, bg=${!!loaded.backgroundImage}, logo=${!!loaded.logoBuf}, fonts=${loaded.fontRegistry ? 'ok' : 'skipped'}`);

  return loaded;
}

/**
 * Clear the image cache (call after render job completes).
 */
export function clearAssetCache(): void {
  imageCache.clear();
}
