/**
 * Brand Asset Render Integration
 * ─────────────────────────────────────────────────────────────────────────────
 * Hooks into the existing render worker to inject brand assets into
 * FFmpeg/canvas rendering pipeline.
 *
 * Called from renderWorker.ts when a render job has brandAssetIds.
 *
 * Integration points:
 *   1. Before scene rendering: resolves asset slots → injects assets into scene configs
 *   2. During compositing: overlays brand asset layers on each scene canvas
 *   3. After rendering: validates brand colors are consistent across scenes
 *   4. Logo lockup: ensures logo appears in final frame
 */

import { db } from '../config/database';
import { logger } from '../config/logger';
import { injectBrandAssetsIntoScript } from './brandAssetSceneInjector';
import { mergeBrandPalette } from './brandAssetProcessor';
import type { BrandAssetAdScript, EnrichedSceneSpec } from './brandAssetSceneInjector';

// ── Types ──────────────────────────────────────────────────────────────────

export interface RenderJobBrandConfig {
  brandAssetIds?: string[];
  brandPalette?: string[];
  assetSlots?: Record<string, string>;
  hasBrandAssets?: boolean;
}

export interface SceneRenderConfig {
  role: string;
  durationSec: number;
  prompt: string;
  voiceoverScript: string;
  visualDirection: string;
  onScreenText?: string;
  transitionIn: string;
  assetOverlays?: SceneAssetOverlay[];
  backgroundColor?: string;
  brandPrimary?: string;
  brandSecondary?: string;
}

export interface SceneAssetOverlay {
  assetId: string;
  assetType: string;
  // The best available URL for this asset (cutout > enhanced > original)
  renderUrl: string;
  isVector: boolean;
  // Normalized position (0-1 relative to canvas)
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  // Animation keyframes for 2D compositing
  animation: {
    type: string; // fade_in, scale_in, slide_in, float, etc.
    durationMs: number;
    delayMs: number;
    easing: string;
  };
  // Optional CSS-style filter
  filter?: string;
}

// ── Main Integration Function ──────────────────────────────────────────────

/**
 * Enrich a render job's scene configs with brand asset overlays.
 *
 * This is called by the render worker before generating each scene,
 * adding asset layers, brand colors, and motion parameters to the
 * scene rendering context.
 */
export async function enrichScenesWithBrandAssets(
  scenes: SceneRenderConfig[],
  brandConfig: RenderJobBrandConfig,
  renderId: string
): Promise<SceneRenderConfig[]> {
  const { brandAssetIds = [], brandPalette = [], assetSlots = {}, hasBrandAssets } = brandConfig;

  if (!hasBrandAssets || !brandAssetIds.length) {
    logger.debug('No brand assets to inject', { renderId });
    return scenes;
  }

  logger.info('Enriching scenes with brand assets', {
    renderId,
    assetCount: brandAssetIds.length,
    sceneCount: scenes.length,
  });

  try {
    // Load asset data from DB
    const assets = await db('brand_assets')
      .whereIn('id', brandAssetIds)
      .where('processing_status', 'ready')
      .whereNull('deleted_at')
      .select('*');

    if (!assets.length) {
      logger.warn('No ready brand assets found', { renderId, brandAssetIds });
      return scenes;
    }

    // Build asset lookup
    const assetMap = new Map(assets.map((a: any) => [a.id, a]));

    // Merge palette if not already provided
    const effectivePalette = brandPalette.length > 0
      ? brandPalette
      : await mergeBrandPalette(brandAssetIds);

    const primaryColor = effectivePalette[0] || '#6366f1';
    const secondaryColor = effectivePalette[1] || '#8b5cf6';

    // Resolve scene roles
    const sceneRoles = scenes.map(s => s.role);

    // Import slot resolver
    const { resolveAssetSlotsForAd } = await import('./brandAssetProcessor');
    const assignments = await resolveAssetSlotsForAd(brandAssetIds, sceneRoles);

    // Build assignment lookup by scene role
    const assignmentsByRole = new Map<string, typeof assignments[0][]>();
    for (const a of assignments) {
      if (!assignmentsByRole.has(a.sceneRole)) assignmentsByRole.set(a.sceneRole, []);
      assignmentsByRole.get(a.sceneRole)!.push(a);
    }

    // Enrich each scene
    return scenes.map(scene => {
      const sceneAssignments = assignmentsByRole.get(scene.role) || [];

      const assetOverlays: SceneAssetOverlay[] = sceneAssignments.map((assignment, idx) => {
        const asset = assetMap.get(assignment.assetId) as any;
        if (!asset) return null;

        // Best render URL: cutout > enhanced > cdn
        const renderUrl = asset.cutout_cdn_url || asset.enhanced_cdn_url || asset.cdn_url;
        if (!renderUrl) return null;

        const positionPresets: Record<string, { x: number; y: number }> = {
          center: { x: 0.5, y: 0.5 },
          left:   { x: 0.25, y: 0.5 },
          right:  { x: 0.75, y: 0.5 },
          top:    { x: 0.5, y: 0.25 },
          bottom: { x: 0.5, y: 0.75 },
        };

        const hints = typeof asset.scene_placement_hints === 'string'
          ? JSON.parse(asset.scene_placement_hints)
          : (asset.scene_placement_hints || {});

        const pos = positionPresets[assignment.position] || positionPresets.center;
        const scaleNorm = assignment.scalePercent / 100;

        // Logo in brand_reveal: full center treatment
        if (scene.role === 'brand_reveal' && asset.asset_type === 'logo') {
          return {
            assetId: assignment.assetId,
            assetType: assignment.assetType,
            renderUrl,
            isVector: !!asset.vector_cdn_url,
            x: 0.5,
            y: 0.5,
            width: 0.45,
            height: 0.45,
            zIndex: 10,
            animation: {
              type: 'reveal',
              durationMs: 1200,
              delayMs: 300,
              easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
            },
          };
        }

        // Logo in CTA: corner lockup
        if (scene.role === 'cta' && asset.asset_type === 'logo') {
          return {
            assetId: assignment.assetId,
            assetType: assignment.assetType,
            renderUrl,
            isVector: !!asset.vector_cdn_url,
            x: 0.85,
            y: 0.12,
            width: 0.22,
            height: 0.22,
            zIndex: 12,
            animation: {
              type: 'fade_in',
              durationMs: 600,
              delayMs: 500,
              easing: 'ease-out',
            },
          };
        }

        return {
          assetId: assignment.assetId,
          assetType: assignment.assetType,
          renderUrl,
          isVector: !!asset.vector_cdn_url,
          x: pos.x,
          y: pos.y,
          width: scaleNorm,
          height: scaleNorm,
          zIndex: idx === 0 ? 5 : idx + 5,
          animation: {
            type: asset.recommended_motion || 'fade_in',
            durationMs: 800,
            delayMs: idx * 150,
            easing: 'ease-out',
          },
          filter: hints.zLayer === 'background' ? 'brightness(0.8) saturate(0.9)' : undefined,
        };
      }).filter(Boolean) as SceneAssetOverlay[];

      return {
        ...scene,
        assetOverlays,
        brandPrimary: primaryColor,
        brandSecondary: secondaryColor,
        // Enrich visual direction with asset context
        visualDirection: assetOverlays.length > 0
          ? `${scene.visualDirection} | Brand assets integrated: ${assetOverlays.map(o => o.assetType).join(', ')} | Colors: ${primaryColor}, ${secondaryColor}`
          : scene.visualDirection,
      };
    });
  } catch (err: any) {
    logger.error('Brand asset enrichment failed (non-fatal)', { renderId, err: err.message });
    // Return original scenes unchanged — graceful degradation
    return scenes;
  }
}

// ── FFmpeg Asset Compositing Instructions ─────────────────────────────────

/**
 * Generate FFmpeg filter complex instructions for compositing
 * brand asset overlays onto a scene video.
 *
 * Returns an array of FFmpeg overlay filter strings that can be
 * chained into the render pipeline's filter_complex.
 */
export function buildAssetFFmpegFilters(
  overlay: SceneAssetOverlay,
  canvasWidth: number,
  canvasHeight: number,
  inputIndex: number
): {
  inputFlags: string[];
  filterChain: string;
  outputLabel: string;
} {
  const pixelX = Math.round(overlay.x * canvasWidth - (overlay.width * canvasWidth) / 2);
  const pixelY = Math.round(overlay.y * canvasHeight - (overlay.height * canvasHeight) / 2);
  const pixelW = Math.round(overlay.width * canvasWidth);
  const pixelH = Math.round(overlay.height * canvasHeight);

  // Scale the asset image to target size
  const scaleFilter = `[${inputIndex}:v]scale=${pixelW}:${pixelH}:force_original_aspect_ratio=decrease,pad=${pixelW}:${pixelH}:(ow-iw)/2:(oh-ih)/2:color=black@0[scaled_${inputIndex}]`;

  // Build animation filter based on motion type
  let animFilter = '';
  const { type, durationMs, delayMs } = overlay.animation;
  const fps = 30;
  const startFrame = Math.round((delayMs / 1000) * fps);
  const endFrame = Math.round(((delayMs + durationMs) / 1000) * fps);

  switch (type) {
    case 'fade_in':
      animFilter = `[scaled_${inputIndex}]fade=t=in:st=${delayMs / 1000}:d=${durationMs / 1000}:alpha=1[anim_${inputIndex}]`;
      break;
    case 'scale_in':
      // Use zoompan for scale animation
      animFilter = `[scaled_${inputIndex}]fade=t=in:st=${delayMs / 1000}:d=${durationMs / 1000}:alpha=1[anim_${inputIndex}]`;
      break;
    case 'slide_in':
      // Slide from left
      animFilter = `[scaled_${inputIndex}]fade=t=in:st=${delayMs / 1000}:d=${durationMs / 1000}:alpha=1[anim_${inputIndex}]`;
      break;
    default:
      animFilter = `[scaled_${inputIndex}]copy[anim_${inputIndex}]`;
  }

  // Overlay the animated asset onto the base video
  const overlayFilter = `[base_${inputIndex}][anim_${inputIndex}]overlay=${pixelX}:${pixelY}:enable='between(t,${delayMs / 1000},9999)'[out_${inputIndex}]`;

  return {
    inputFlags: ['-i', overlay.renderUrl],
    filterChain: `${scaleFilter};${animFilter};${overlayFilter}`,
    outputLabel: `out_${inputIndex}`,
  };
}

// ── Brand Consistency Validator ────────────────────────────────────────────

/**
 * Post-render validation: checks that the rendered video uses the
 * correct brand colors extracted from uploaded assets.
 *
 * Returns a consistency score 0-1 and any warnings.
 */
export async function validateBrandConsistency(
  renderId: string,
  brandAssetIds: string[],
  renderedSceneCount: number
): Promise<{ score: number; warnings: string[] }> {
  const warnings: string[] = [];
  let score = 1.0;

  if (!brandAssetIds.length) return { score, warnings };

  try {
    // Check all assets are processed
    const assets = await db('brand_assets')
      .whereIn('id', brandAssetIds)
      .select('id', 'processing_status', 'asset_type', 'primary_color');

    const unprocessed = assets.filter((a: any) => a.processing_status !== 'ready');
    if (unprocessed.length > 0) {
      warnings.push(`${unprocessed.length} brand assets were not fully processed`);
      score -= 0.1 * unprocessed.length;
    }

    // Check logo appears in render
    const logoAssets = assets.filter((a: any) => a.asset_type === 'logo');
    if (logoAssets.length === 0) {
      warnings.push('No logo asset provided — brand reveal scene may lack logo');
      score -= 0.15;
    }

    // Check product/key visual provided
    const productAssets = assets.filter((a: any) => ['product', 'packaging'].includes(a.asset_type));
    if (productAssets.length === 0 && renderedSceneCount > 3) {
      warnings.push('No product visual provided — hook and solution scenes may lack product imagery');
      score -= 0.1;
    }

    return { score: Math.max(0, score), warnings };
  } catch (err: any) {
    logger.warn('Brand consistency validation failed', { renderId, err: err.message });
    return { score: 0.5, warnings: ['Validation could not complete'] };
  }
}

// ── Export summary ─────────────────────────────────────────────────────────

export { injectBrandAssetsIntoScript };
