/**
 * Brand Asset Scene Injector
 * ─────────────────────────────────────────────────────────────────────────────
 * Integrates processed brand assets into the 2D ad script engine's scene
 * templates. This layer sits between the AdScriptEngine and the renderer,
 * enriching each SceneSpec with:
 *
 *   - Asset slot assignments (which asset appears where)
 *   - Animation parameters per asset (motion style, timing, easing)
 *   - Brand-consistent color overrides
 *   - Visual hierarchy guidance
 *   - Motion template selection per scene × asset type combination
 *
 * Scene Slot Types:
 *   logo_slot         — Brand logo, typically 30-50% canvas width
 *   product_slot      — Product hero, 50-70% canvas width
 *   screenshot_slot   — App/UI screenshot, 40-65% canvas width
 *   brand_reveal_slot — Full-canvas brand reveal (logo centered)
 *   background_slot   — Pattern/texture behind all content
 *   accent_slot       — Small supporting element
 */

import type { SceneSpec, SceneRole, AdScript } from './adScriptEngine';
import type { AssetSlotAssignment, MotionStyle } from './brandAssetProcessor';
import { resolveAssetSlotsForAd, mergeBrandPalette } from './brandAssetProcessor';
import { logger } from '../config/logger';

// ── Types ──────────────────────────────────────────────────────────────────

export interface AssetAnimation {
  motion: MotionStyle;
  durationMs: number;
  delayMs: number;
  easing: string;
  repeat: 'once' | 'loop' | 'ping-pong';
  scaleFrom: number;
  scaleTo: number;
  opacityFrom: number;
  opacityTo: number;
  translateX: number; // percent of canvas width
  translateY: number; // percent of canvas height
}

export interface SceneAssetLayer {
  slotName: string;
  assetId: string;
  assetType: string;
  cdnUrl: string;
  vectorUrl: string | null;
  position: {
    x: number; // percent 0-100
    y: number;
    width: number;
    height: number;
    zIndex: number;
  };
  animation: AssetAnimation;
  filters?: {
    brightness?: number;
    contrast?: number;
    saturation?: number;
    shadow?: string;
  };
}

export interface EnrichedSceneSpec extends SceneSpec {
  // Original fields from SceneSpec +
  assetLayers: SceneAssetLayer[];
  brandColors: {
    primary: string;
    secondary: string;
    accent: string;
    background: string;
  };
  hasAssets: boolean;
  layoutMode: 'asset_hero' | 'asset_supporting' | 'text_only' | 'brand_reveal';
}

export interface BrandAssetAdScript {
  placement: string;
  totalDurationSec: number;
  titleSuggestion: string;
  ctaText: string;
  brandPalette: string[];
  scenes: EnrichedSceneSpec[];
  assetIds: string[];
  assetSlots: Record<string, string>; // slotName → assetId
}

// ── Motion Animation Templates ─────────────────────────────────────────────

const MOTION_ANIMATIONS: Record<MotionStyle, Omit<AssetAnimation, 'delayMs'>> = {
  float: {
    motion: 'float',
    durationMs: 4000,
    easing: 'ease-in-out',
    repeat: 'ping-pong',
    scaleFrom: 1.0,
    scaleTo: 1.03,
    opacityFrom: 1,
    opacityTo: 1,
    translateX: 0,
    translateY: -8,
  },
  spin: {
    motion: 'spin',
    durationMs: 8000,
    easing: 'linear',
    repeat: 'loop',
    scaleFrom: 1,
    scaleTo: 1,
    opacityFrom: 1,
    opacityTo: 1,
    translateX: 0,
    translateY: 0,
  },
  scale_in: {
    motion: 'scale_in',
    durationMs: 800,
    easing: 'cubic-bezier(0.175, 0.885, 0.32, 1.275)',
    repeat: 'once',
    scaleFrom: 0.3,
    scaleTo: 1,
    opacityFrom: 0,
    opacityTo: 1,
    translateX: 0,
    translateY: 0,
  },
  slide_in: {
    motion: 'slide_in',
    durationMs: 700,
    easing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)',
    repeat: 'once',
    scaleFrom: 1,
    scaleTo: 1,
    opacityFrom: 0,
    opacityTo: 1,
    translateX: -30,
    translateY: 0,
  },
  parallax: {
    motion: 'parallax',
    durationMs: 8000,
    easing: 'linear',
    repeat: 'loop',
    scaleFrom: 1.1,
    scaleTo: 1.2,
    opacityFrom: 0.8,
    opacityTo: 0.8,
    translateX: -5,
    translateY: -3,
  },
  reveal: {
    motion: 'reveal',
    durationMs: 1200,
    easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
    repeat: 'once',
    scaleFrom: 0.8,
    scaleTo: 1,
    opacityFrom: 0,
    opacityTo: 1,
    translateX: 0,
    translateY: 20,
  },
  bounce: {
    motion: 'bounce',
    durationMs: 1000,
    easing: 'cubic-bezier(0.36, 0.07, 0.19, 0.97)',
    repeat: 'once',
    scaleFrom: 0,
    scaleTo: 1,
    opacityFrom: 0,
    opacityTo: 1,
    translateX: 0,
    translateY: 0,
  },
  fade_in: {
    motion: 'fade_in',
    durationMs: 600,
    easing: 'ease-out',
    repeat: 'once',
    scaleFrom: 1,
    scaleTo: 1,
    opacityFrom: 0,
    opacityTo: 1,
    translateX: 0,
    translateY: 0,
  },
  none: {
    motion: 'none',
    durationMs: 0,
    easing: 'linear',
    repeat: 'once',
    scaleFrom: 1,
    scaleTo: 1,
    opacityFrom: 1,
    opacityTo: 1,
    translateX: 0,
    translateY: 0,
  },
};

// ── Position Presets ───────────────────────────────────────────────────────

const POSITION_PRESETS: Record<string, { x: number; y: number }> = {
  center:      { x: 50, y: 50 },
  left:        { x: 25, y: 50 },
  right:       { x: 75, y: 50 },
  top:         { x: 50, y: 25 },
  bottom:      { x: 50, y: 75 },
  top_left:    { x: 25, y: 25 },
  top_right:   { x: 75, y: 25 },
  bottom_left: { x: 25, y: 75 },
  bottom_right:{ x: 75, y: 75 },
};

const Z_LAYER_INDEX: Record<string, number> = {
  background: 1,
  midground: 5,
  foreground: 10,
};

// ── Scene Role → Layout Mode ───────────────────────────────────────────────

function deriveLayoutMode(
  sceneRole: SceneRole,
  hasAssets: boolean,
  assetType?: string
): 'asset_hero' | 'asset_supporting' | 'text_only' | 'brand_reveal' {
  if (!hasAssets) return 'text_only';
  if (sceneRole === 'brand_reveal') return 'brand_reveal';
  if (['hook', 'solution', 'offer'].includes(sceneRole) && assetType === 'product') return 'asset_hero';
  if (['cta'].includes(sceneRole) && assetType === 'logo') return 'brand_reveal';
  return 'asset_supporting';
}

// ── Per-Scene Asset Layer Builder ──────────────────────────────────────────

function buildAssetLayer(
  assignment: AssetSlotAssignment,
  sceneRole: SceneRole,
  sceneDurationSec: number,
  layerIndex: number
): SceneAssetLayer {
  const animBase = MOTION_ANIMATIONS[assignment.motion] || MOTION_ANIMATIONS.fade_in;
  const posPreset = POSITION_PRESETS[assignment.position] || POSITION_PRESETS.center;
  const zIdx = Z_LAYER_INDEX[assignment.zLayer] + layerIndex;

  // Stagger delay per layer
  const delayMs = layerIndex * 150;

  // Scale: convert scalePercent to canvas-relative width/height
  const w = assignment.scalePercent;
  const h = assignment.scalePercent; // square default, renderer adjusts for aspect ratio

  // Filters based on z-layer
  const filters: SceneAssetLayer['filters'] = {};
  if (assignment.zLayer === 'background') {
    filters.brightness = 0.85;
    filters.saturation = 0.9;
  } else if (assignment.zLayer === 'foreground') {
    filters.shadow = '0 20px 60px rgba(0,0,0,0.3)';
  }

  return {
    slotName: assignment.slotName,
    assetId: assignment.assetId,
    assetType: assignment.assetType,
    cdnUrl: assignment.cdnUrl,
    vectorUrl: assignment.vectorUrl,
    position: {
      x: posPreset.x,
      y: posPreset.y,
      width: w,
      height: h,
      zIndex: zIdx,
    },
    animation: {
      ...animBase,
      delayMs,
    },
    filters: Object.keys(filters).length > 0 ? filters : undefined,
  };
}

// ── Brand Color Palette Builder ────────────────────────────────────────────

function buildBrandColors(palette: string[]): {
  primary: string;
  secondary: string;
  accent: string;
  background: string;
} {
  return {
    primary: palette[0] || '#6366f1',
    secondary: palette[1] || '#8b5cf6',
    accent: palette[2] || '#ec4899',
    background: palette[3] || '#0f0f1a',
  };
}

// ── Main Injection Function ────────────────────────────────────────────────

/**
 * Takes a standard AdScript and a list of brand asset IDs,
 * then returns a fully enriched BrandAssetAdScript with asset layers
 * and brand colors injected into every scene.
 */
export async function injectBrandAssetsIntoScript(
  adScript: AdScript,
  assetIds: string[],
  brandName?: string
): Promise<BrandAssetAdScript> {
  if (!assetIds.length) {
    // No assets — return text-only version
    return {
      placement: adScript.placement,
      totalDurationSec: adScript.totalDurationSec,
      titleSuggestion: adScript.titleSuggestion,
      ctaText: adScript.ctaText,
      brandPalette: [],
      scenes: adScript.scenes.map(scene => ({
        ...scene,
        assetLayers: [],
        brandColors: buildBrandColors([]),
        hasAssets: false,
        layoutMode: 'text_only',
      })),
      assetIds: [],
      assetSlots: {},
    };
  }

  // Extract all scene roles from the script
  const sceneRoles = adScript.scenes.map(s => s.role);

  // Resolve asset → scene slot assignments
  let assignments: AssetSlotAssignment[] = [];
  let palette: string[] = [];

  try {
    [assignments, palette] = await Promise.all([
      resolveAssetSlotsForAd(assetIds, sceneRoles),
      mergeBrandPalette(assetIds),
    ]);
  } catch (err: any) {
    logger.error('Failed to resolve asset slots', { err: err.message });
    assignments = [];
    palette = [];
  }

  const brandColors = buildBrandColors(palette);

  // Build lookup: sceneRole → assignment
  const assignmentByRole = new Map<string, AssetSlotAssignment[]>();
  for (const a of assignments) {
    if (!assignmentByRole.has(a.sceneRole)) assignmentByRole.set(a.sceneRole, []);
    assignmentByRole.get(a.sceneRole)!.push(a);
  }

  // For tracking asset → slot mapping
  const assetSlots: Record<string, string> = {};
  for (const a of assignments) {
    assetSlots[a.slotName] = a.assetId;
  }

  // Enrich each scene
  const enrichedScenes: EnrichedSceneSpec[] = adScript.scenes.map((scene, sceneIdx) => {
    const sceneAssignments = assignmentByRole.get(scene.role) || [];
    const hasAssets = sceneAssignments.length > 0;

    // Build asset layers for this scene
    const assetLayers: SceneAssetLayer[] = sceneAssignments.map((assignment, layerIdx) =>
      buildAssetLayer(assignment, scene.role, scene.durationSec, layerIdx)
    );

    // Special handling for brand_reveal scene — always show logo prominently
    if (scene.role === 'brand_reveal' && assetLayers.length > 0) {
      const logoLayer = assetLayers.find(l => l.assetType === 'logo') || assetLayers[0];
      logoLayer.position.x = 50;
      logoLayer.position.y = 50;
      logoLayer.position.width = 50;
      logoLayer.position.height = 50;
      logoLayer.animation = {
        ...MOTION_ANIMATIONS.reveal,
        delayMs: 200,
      };
    }

    // CTA scene: logo in top-right corner + product hero center
    if (scene.role === 'cta') {
      const logoLayer = assetLayers.find(l => l.assetType === 'logo');
      if (logoLayer) {
        logoLayer.position = { x: 85, y: 15, width: 25, height: 25, zIndex: 10 };
        logoLayer.animation = { ...MOTION_ANIMATIONS.fade_in, delayMs: 400 };
      }
      const productLayer = assetLayers.find(l => l.assetType === 'product' || l.assetType === 'packaging');
      if (productLayer) {
        productLayer.position = { x: 35, y: 50, width: 60, height: 60, zIndex: 5 };
        productLayer.animation = { ...MOTION_ANIMATIONS.float, delayMs: 0 };
      }
    }

    const primaryAssetType = assetLayers[0]?.assetType;
    const layoutMode = deriveLayoutMode(scene.role, hasAssets, primaryAssetType);

    // Enrich visual direction with asset context
    let enrichedVisualDirection = scene.visualDirection;
    if (hasAssets) {
      const assetDesc = assetLayers.map(l => `${l.assetType} (${l.slotName})`).join(', ');
      enrichedVisualDirection = `${scene.visualDirection} | Brand assets: ${assetDesc} | ${layoutMode} layout | Brand colors: ${brandColors.primary}, ${brandColors.secondary}`;
    }

    // Enrich prompt with brand color context
    let enrichedPrompt = scene.prompt;
    if (palette.length > 0 && hasAssets) {
      enrichedPrompt = `${scene.prompt} Use brand colors: ${palette.slice(0, 3).join(', ')}. Asset-integrated composition.`;
    }

    return {
      ...scene,
      prompt: enrichedPrompt,
      visualDirection: enrichedVisualDirection,
      assetLayers,
      brandColors,
      hasAssets,
      layoutMode,
    };
  });

  logger.info('Brand assets injected into ad script', {
    placement: adScript.placement,
    assetCount: assetIds.length,
    assignmentCount: assignments.length,
    sceneCount: enrichedScenes.length,
    paletteSize: palette.length,
  });

  return {
    placement: adScript.placement,
    totalDurationSec: adScript.totalDurationSec,
    titleSuggestion: adScript.titleSuggestion,
    ctaText: adScript.ctaText,
    brandPalette: palette,
    scenes: enrichedScenes,
    assetIds,
    assetSlots,
  };
}

// ── Scene Preview Builder ──────────────────────────────────────────────────

/**
 * Generates a lightweight preview descriptor for a single scene.
 * Used by the frontend to render scene previews before full render.
 */
export function buildScenePreview(scene: EnrichedSceneSpec, aspectRatio: '16:9' | '9:16' | '1:1') {
  const [w, h] = aspectRatio === '16:9' ? [16, 9] : aspectRatio === '9:16' ? [9, 16] : [1, 1];
  const canvasWidth = 400;
  const canvasHeight = Math.round((canvasWidth * h) / w);

  return {
    role: scene.role,
    durationSec: scene.durationSec,
    layoutMode: scene.layoutMode,
    canvasWidth,
    canvasHeight,
    brandColors: scene.brandColors,
    hasAssets: scene.hasAssets,
    layers: scene.assetLayers.map(layer => ({
      slotName: layer.slotName,
      assetType: layer.assetType,
      thumbnailUrl: layer.cdnUrl,
      // Compute pixel positions
      pixelX: Math.round((layer.position.x / 100) * canvasWidth),
      pixelY: Math.round((layer.position.y / 100) * canvasHeight),
      pixelWidth: Math.round((layer.position.width / 100) * canvasWidth),
      pixelHeight: Math.round((layer.position.height / 100) * canvasHeight),
      zIndex: layer.position.zIndex,
      motion: layer.animation.motion,
    })),
    onScreenText: scene.onScreenText,
    voiceoverScript: scene.voiceoverScript,
  };
}
