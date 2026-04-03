/**
 * Frame Renderer
 * ═══════════════════════════════════════════════════════════════════════════════
 * The pixel-producing core of the rendering engine.
 *
 * Takes ResolvedElement[] (from animationTimeline) + LoadedAssets (from
 * assetPipeline) and composites them into a single RGBA frame buffer.
 *
 * Rendering stack: Sharp (libvips) for image compositing + SVG overlay
 * for text rendering. This avoids the node-canvas native dependency while
 * producing high-quality anti-aliased text and image composites.
 *
 * Pipeline per frame:
 *   1. Create background layer (solid, gradient, or image)
 *   2. For each element (back-to-front by zIndex):
 *      a. Prepare element image (text→SVG→PNG, image→resize, shape→solid)
 *      b. Apply transforms (scale, rotation, opacity, blur, clip)
 *      c. Composite onto canvas at computed position
 *   3. Return raw RGBA buffer
 */

import sharp, { OverlayOptions } from 'sharp';
import { logger } from '../../../config/logger';
import type {
  ResolvedElement, PxRect, TextStyle, BoxShadow, RenderedFrame,
  BackgroundDef, HexColor, ImageFit,
} from '../types';
import type { LoadedAssets } from '../assets/assetPipeline';
import { parseColor, createSolidBuffer, createGradientBuffer } from '../assets/assetPipeline';
import type { FontRegistry } from '../assets/fontLoader';
import { buildFontStack } from '../assets/fontLoader';

// ═══════════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════════

export interface FrameRenderConfig {
  width: number;
  height: number;
  background: BackgroundDef;
  /** Optional font registry — enables @font-face embedding in SVG text renders. */
  fontRegistry?: FontRegistry;
}

/**
 * Render a single frame from resolved elements.
 * Returns a raw RGBA buffer (width * height * 4 bytes).
 */
export async function renderFrame(
  elements: ResolvedElement[],
  assets: LoadedAssets,
  config: FrameRenderConfig,
  frameIndex: number,
): Promise<Buffer> {
  const { width, height } = config;

  // 1. Build background
  let canvas = await buildBackground(config.background, width, height, assets);

  // 2. Composite each element
  const overlays: OverlayOptions[] = [];

  for (const el of elements) {
    if (el.opacity <= 0.01) continue; // skip invisible elements

    try {
      const overlay = await renderElement(el, assets, width, height, config.fontRegistry);
      if (overlay) overlays.push(overlay);
    } catch (err: any) {
      // Don't fail the whole frame for one element
      if (frameIndex === 0) {
        logger.warn(`[FrameRenderer] Element ${el.slotId} render failed: ${err.message}`);
      }
    }
  }

  if (overlays.length > 0) {
    canvas = await sharp(canvas, { raw: { width, height, channels: 4 } })
      .composite(overlays)
      .raw()
      .toBuffer();
  }

  return canvas;
}

/**
 * Render a frame and encode as PNG (for thumbnails/previews).
 */
export async function renderFrameAsPng(
  elements: ResolvedElement[],
  assets: LoadedAssets,
  config: FrameRenderConfig,
  frameIndex: number,
): Promise<Buffer> {
  const raw = await renderFrame(elements, assets, config, frameIndex);
  return sharp(raw, { raw: { width: config.width, height: config.height, channels: 4 } })
    .png()
    .toBuffer();
}

// ═══════════════════════════════════════════════════════════════════════════════
// BACKGROUND
// ═══════════════════════════════════════════════════════════════════════════════

async function buildBackground(
  bg: BackgroundDef,
  width: number,
  height: number,
  assets: LoadedAssets,
): Promise<Buffer> {
  switch (bg.type) {
    case 'solid':
      return createSolidBuffer(width, height, bg.color);

    case 'gradient':
      return createGradientBuffer(width, height, bg.stops, bg.angle);

    case 'image':
      if (assets.backgroundImage) {
        // Ensure it's the right size
        if (assets.backgroundImage.width === width && assets.backgroundImage.height === height) {
          return assets.backgroundImage.buffer;
        }
        return sharp(assets.backgroundImage.buffer, {
          raw: { width: assets.backgroundImage.width, height: assets.backgroundImage.height, channels: 4 },
        })
          .resize(width, height, { fit: bg.fit === 'contain' ? 'inside' : 'cover' })
          .ensureAlpha()
          .raw()
          .toBuffer();
      }
      return createSolidBuffer(width, height, '#1a1a2e');

    default:
      return createSolidBuffer(width, height, '#1a1a2e');
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ELEMENT RENDERING
// ═══════════════════════════════════════════════════════════════════════════════

async function renderElement(
  el: ResolvedElement,
  assets: LoadedAssets,
  canvasWidth: number,
  canvasHeight: number,
  fontRegistry?: FontRegistry,
): Promise<OverlayOptions | null> {
  const { bounds } = el;

  // Skip out-of-bounds elements
  if (bounds.x + bounds.w < 0 || bounds.y + bounds.h < 0
    || bounds.x > canvasWidth || bounds.y > canvasHeight) {
    return null;
  }

  // Clamp dimensions
  const elW = Math.max(1, Math.round(bounds.w));
  const elH = Math.max(1, Math.round(bounds.h));

  let elementBuffer: Buffer;

  if (el.text) {
    elementBuffer = await renderTextElement(el, elW, elH, fontRegistry);
  } else if (el.image) {
    elementBuffer = await renderImageElement(el, assets, elW, elH);
  } else if (el.fill) {
    elementBuffer = await renderShapeElement(el, elW, elH);
  } else {
    return null;
  }

  // Apply transforms: opacity, blur, rotation, clip
  let pipeline = sharp(elementBuffer, { raw: { width: elW, height: elH, channels: 4 } });

  // Apply blur
  if (el.blur > 0.5) {
    pipeline = pipeline.blur(Math.max(0.3, el.blur));
  }

  // Apply brightness
  if (Math.abs(el.brightness - 1) > 0.01) {
    pipeline = pipeline.modulate({ brightness: el.brightness });
  }

  // Apply rotation
  if (Math.abs(el.rotation) > 0.5) {
    pipeline = pipeline.rotate(el.rotation, { background: { r: 0, g: 0, b: 0, alpha: 0 } });
  }

  // Apply clipping (via extract if needed)
  const hasClip = el.clip.top > 0.01 || el.clip.bottom > 0.01
    || el.clip.left > 0.01 || el.clip.right > 0.01;
  if (hasClip) {
    const clipLeft = Math.round(el.clip.left * elW);
    const clipTop = Math.round(el.clip.top * elH);
    const clipRight = Math.round(el.clip.right * elW);
    const clipBottom = Math.round(el.clip.bottom * elH);
    const extractW = Math.max(1, elW - clipLeft - clipRight);
    const extractH = Math.max(1, elH - clipTop - clipBottom);
    pipeline = pipeline.extract({
      left: clipLeft,
      top: clipTop,
      width: extractW,
      height: extractH,
    });
  }

  // Apply opacity by pre-multiplying alpha channel of the final element
  if (el.opacity < 0.99) {
    const opacityAlpha = Math.round(el.opacity * 255);
    pipeline = pipeline.ensureAlpha().composite([{
      input: Buffer.from([0, 0, 0, opacityAlpha]),
      raw: { width: 1, height: 1, channels: 4 },
      tile: true,
      blend: 'dest-in',
    }]);
  }

  // Encode to PNG for compositing
  const compositeInput = await pipeline.png().toBuffer();

  // Compute position (clamp to canvas bounds for the left/top parameter)
  const left = Math.round(Math.max(0, bounds.x + (hasClip ? el.clip.left * elW : 0)));
  const top = Math.round(Math.max(0, bounds.y + (hasClip ? el.clip.top * elH : 0)));

  return {
    input: compositeInput,
    left,
    top,
    blend: 'over' as const,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEXT RENDERING (SVG → PNG via Sharp, with embedded @font-face)
// ═══════════════════════════════════════════════════════════════════════════════

async function renderTextElement(
  el: ResolvedElement,
  width: number,
  height: number,
  fontRegistry?: FontRegistry,
): Promise<Buffer> {
  const { content, style, measuredLines } = el.text!;
  if (!content || measuredLines.length === 0) {
    return createTransparentBuffer(width, height);
  }

  const fontSize = Math.round(style.fontSize * (el.scaleX));
  const lineHeight = fontSize * style.lineHeight;
  const fontWeight = style.fontWeight;
  // Use font stack with registry fallback if available
  const fontFamilyStack = fontRegistry
    ? buildFontStack(style.fontFamily, fontRegistry)
    : `'${style.fontFamily}', 'Inter', Arial, sans-serif`;
  const color = style.color;
  const textAlign = style.textAlign;
  const letterSpacing = style.letterSpacing;

  // Embed @font-face from registry if available (enables custom fonts via librsvg)
  const fontFaceDefs = fontRegistry?.svgFontFaceBlock || '';

  // v27: Render at 2x resolution for sub-pixel anti-aliasing, then downscale
  const renderScale = 2;
  const renderWidth = width * renderScale;
  const renderHeight = height * renderScale;
  const renderFontSize = fontSize * renderScale;
  const renderLineHeight = lineHeight * renderScale;
  const renderLetterSpacing = letterSpacing * renderScale;

  // Build SVG for text rendering with enhanced quality
  const lines = measuredLines.map((line, i) => {
    const y = renderFontSize + i * renderLineHeight;
    let anchor = 'middle';
    let x = renderWidth / 2;
    if (textAlign === 'left') { anchor = 'start'; x = 4; } // 4px padding for anti-alias
    if (textAlign === 'right') { anchor = 'end'; x = renderWidth - 4; }

    const escaped = line
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

    // v27: paint-order ensures stroke renders behind fill for cleaner text
    const strokeAttrs = style.stroke
      ? ` stroke="${style.stroke.color}" stroke-width="${style.stroke.width * renderScale}" stroke-linejoin="round" paint-order="stroke fill"`
      : '';

    return `<text x="${x}" y="${y}" font-family="${fontFamilyStack}" font-size="${renderFontSize}" font-weight="${fontWeight}" fill="${color}" text-anchor="${anchor}" letter-spacing="${renderLetterSpacing}"${strokeAttrs}>${escaped}</text>`;
  });

  // Add text shadow if specified
  let shadowDefs = '';
  let shadowFilter = '';
  if (style.shadow) {
    // v27: higher quality shadow with larger deviation range
    const shadowBlur = Math.max(0.5, style.shadow.blur * renderScale);
    shadowDefs = `<filter id="ts" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="${style.shadow.offsetX * renderScale}" dy="${style.shadow.offsetY * renderScale}" stdDeviation="${shadowBlur}" flood-color="${style.shadow.color}" flood-opacity="0.85"/></filter>`;
    shadowFilter = ' filter="url(#ts)"';
  }

  const svgHeight = Math.max(renderHeight, measuredLines.length * renderLineHeight + renderFontSize);

  // v27: shape-rendering and text-rendering hints for maximum quality
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${renderWidth}" height="${svgHeight}" shape-rendering="geometricPrecision" text-rendering="geometricPrecision">${fontFaceDefs}<defs>${shadowDefs}</defs><g${shadowFilter}>${lines.join('')}</g></svg>`;

  // Render at 2x then downscale for anti-aliasing
  let pipeline = sharp(Buffer.from(svg))
    .resize(width, height, {
      fit: 'contain',
      position: 'top',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      kernel: 'lanczos3', // v27: lanczos3 for highest quality downscale
    })
    .ensureAlpha();

  return pipeline.raw().toBuffer();
}

// ═══════════════════════════════════════════════════════════════════════════════
// IMAGE RENDERING
// ═══════════════════════════════════════════════════════════════════════════════

async function renderImageElement(
  el: ResolvedElement,
  assets: LoadedAssets,
  width: number,
  height: number,
): Promise<Buffer> {
  const loaded = assets.images.get(el.slotId);
  if (!loaded) {
    // Check logo
    if (el.type === 'logo' && assets.logoBuf) {
      return renderLoadedImage(assets.logoBuf.buffer, assets.logoBuf.width, assets.logoBuf.height, width, height, el);
    }
    return createTransparentBuffer(width, height);
  }

  return renderLoadedImage(loaded.buffer, loaded.width, loaded.height, width, height, el);
}

async function renderLoadedImage(
  imgBuf: Buffer,
  imgW: number,
  imgH: number,
  targetW: number,
  targetH: number,
  el: ResolvedElement,
): Promise<Buffer> {
  const fit = el.image?.fit ?? 'cover';

  let pipeline = sharp(imgBuf, { raw: { width: imgW, height: imgH, channels: 4 } });

  // Resize to target dimensions using the specified fit mode
  const sharpFit: Record<string, any> = {
    'cover': 'cover',
    'contain': 'inside',
    'fill': 'fill',
    'crop-center': 'cover',
    'crop-top': 'cover',
    'crop-face': 'cover', // face detection would need ML — fallback to cover
  };

  const position = fit === 'crop-top' ? 'top' : 'centre';

  pipeline = pipeline.resize(targetW, targetH, {
    fit: sharpFit[fit] || 'cover',
    position,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  });

  // Apply opacity
  if (el.opacity < 0.99) {
    pipeline = pipeline.ensureAlpha().composite([{
      input: Buffer.from([0, 0, 0, Math.round(el.opacity * 255)]),
      raw: { width: 1, height: 1, channels: 4 },
      tile: true,
      blend: 'dest-in',
    }]);
  }

  return pipeline.ensureAlpha().raw().toBuffer();
}

// ═══════════════════════════════════════════════════════════════════════════════
// SHAPE RENDERING
// ═══════════════════════════════════════════════════════════════════════════════

async function renderShapeElement(
  el: ResolvedElement,
  width: number,
  height: number,
): Promise<Buffer> {
  const fill = el.fill!;
  const { r, g, b, a } = parseColor(fill.color);
  const alpha = Math.round((a / 255) * el.opacity * 255);

  if (fill.borderRadius > 0) {
    // Rounded rectangle via SVG
    const rx = Math.min(fill.borderRadius, width / 2, height / 2);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <rect width="${width}" height="${height}" rx="${rx}" ry="${rx}"
            fill="rgba(${r},${g},${b},${alpha / 255})" />
    </svg>`;
    return sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer();
  }

  // Simple solid rectangle
  const buf = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const off = i * 4;
    buf[off] = r;
    buf[off + 1] = g;
    buf[off + 2] = b;
    buf[off + 3] = alpha;
  }
  return buf;
}

// ═══════════════════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

function createTransparentBuffer(width: number, height: number): Buffer {
  return Buffer.alloc(width * height * 4, 0);
}
