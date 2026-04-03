/**
 * Cinematic Motion Renderer
 * ─────────────────────────────────────────────────────────────────────────────
 * Upgrades the visual output layer for "Premium Cinematic" ad style.
 *
 * Architecture:
 *   Normal Ad  → existing 2D motion renderer (unchanged)
 *   Cinematic  → this module (drop-in replacement at the renderer layer only)
 *
 * Pipeline position (no AI engines modified):
 *   Ad Script AI → Scene Planning AI → Brand Asset Engine
 *     → Scene Composer → [CinematicMotionRenderer | NormalRenderer]
 *     → Video Export
 *
 * Capabilities:
 *   - Multi-layer 2.5D depth composition (background → mid → foreground → overlay)
 *   - Parallax motion with depth-proportional velocity
 *   - Camera push/pull, horizontal drift
 *   - Perspective scaling per layer
 *   - Realistic brand asset treatment (cutout-ready, shadow, soft depth blur)
 *   - Premium typography motion (staggered reveal, tracking animation)
 *   - Scene-role-aware motion presets (hook, problem, solution, proof, etc.)
 */

import { logger } from '../config/logger';
import type { SceneData, RenderConfig } from '../jobs/renderQueue';
import type { EnrichedSceneSpec, SceneAssetLayer } from './brandAssetSceneInjector';

// ── Depth Layer System ────────────────────────────────────────────────────────
// Depth 0 = far background, Depth 1 = nearest foreground overlay
// Parallax velocity = depthFactor * baseVelocity (deeper layers move slower)

export type DepthLayer =
  | 'background'     // depth 0.0 – environment, gradient, texture
  | 'midground'      // depth 0.25 – supporting shapes, blurred product context
  | 'subject'        // depth 0.5 – primary brand asset / product
  | 'headline'       // depth 0.65 – hero text
  | 'supporting'     // depth 0.75 – body copy, sub-headline
  | 'overlay'        // depth 0.9 – logo, CTA button
  | 'vignette';      // depth 1.0 – full-screen atmosphere layer

export const DEPTH_CONFIG: Record<DepthLayer, {
  zIndex: number;
  parallaxFactor: number;   // 0 = no movement, 1 = full camera movement
  blurRadius: number;       // px soft blur (depth-of-field simulation)
  scaleReserve: number;     // extra scale so parallax doesn't reveal canvas edge
}> = {
  background:  { zIndex: 0,  parallaxFactor: 0.06, blurRadius: 1.2, scaleReserve: 1.08 },
  midground:   { zIndex: 1,  parallaxFactor: 0.14, blurRadius: 0.4, scaleReserve: 1.05 },
  subject:     { zIndex: 2,  parallaxFactor: 0.22, blurRadius: 0.0, scaleReserve: 1.03 },
  headline:    { zIndex: 3,  parallaxFactor: 0.30, blurRadius: 0.0, scaleReserve: 1.02 },
  supporting:  { zIndex: 4,  parallaxFactor: 0.32, blurRadius: 0.0, scaleReserve: 1.02 },
  overlay:     { zIndex: 5,  parallaxFactor: 0.36, blurRadius: 0.0, scaleReserve: 1.01 },
  vignette:    { zIndex: 6,  parallaxFactor: 0.0,  blurRadius: 0.0, scaleReserve: 1.00 },
};

// ── Camera Movement Presets ───────────────────────────────────────────────────

export type CameraMove =
  | 'push_in'          // gentle forward zoom
  | 'pull_back'        // dramatic zoom out
  | 'horizontal_drift' // slow lateral pan
  | 'ken_burns'        // diagonal push with slight rotation
  | 'static_lock'      // no camera move — for text-heavy scenes
  | 'rise_up';         // subtle upward drift

export interface CameraKeyframe {
  timeMs: number;
  scale: number;
  translateX: number;  // percent
  translateY: number;  // percent
  easing: string;
}

const CAMERA_MOVES: Record<CameraMove, (durationMs: number) => CameraKeyframe[]> = {
  push_in: (d) => [
    { timeMs: 0,    scale: 1.00, translateX: 0,    translateY: 0,    easing: 'cubic-bezier(0.25, 0.1, 0.25, 1)' },
    { timeMs: d,    scale: 1.06, translateX: 0,    translateY: -0.5, easing: 'cubic-bezier(0.25, 0.1, 0.25, 1)' },
  ],
  pull_back: (d) => [
    { timeMs: 0,    scale: 1.08, translateX: 0,    translateY: 0,    easing: 'cubic-bezier(0.42, 0, 0.58, 1)' },
    { timeMs: d,    scale: 1.00, translateX: 0,    translateY: 0.5,  easing: 'cubic-bezier(0.42, 0, 0.58, 1)' },
  ],
  horizontal_drift: (d) => [
    { timeMs: 0,    scale: 1.04, translateX: -1.0, translateY: 0,    easing: 'linear' },
    { timeMs: d,    scale: 1.04, translateX:  1.0, translateY: 0,    easing: 'linear' },
  ],
  ken_burns: (d) => [
    { timeMs: 0,    scale: 1.00, translateX: -0.5, translateY: 0.5,  easing: 'cubic-bezier(0.25, 0.1, 0.25, 1)' },
    { timeMs: d,    scale: 1.08, translateX:  0.5, translateY: -0.5, easing: 'cubic-bezier(0.25, 0.1, 0.25, 1)' },
  ],
  static_lock: (d) => [
    { timeMs: 0,    scale: 1.00, translateX: 0,    translateY: 0,    easing: 'linear' },
    { timeMs: d,    scale: 1.00, translateX: 0,    translateY: 0,    easing: 'linear' },
  ],
  rise_up: (d) => [
    { timeMs: 0,    scale: 1.03, translateX: 0,    translateY: 1.0,  easing: 'cubic-bezier(0.25, 0.1, 0.25, 1)' },
    { timeMs: d,    scale: 1.06, translateX: 0,    translateY: -0.5, easing: 'cubic-bezier(0.25, 0.1, 0.25, 1)' },
  ],
};

// ── Typography Motion ─────────────────────────────────────────────────────────

export interface TypographyMotion {
  enterType: 'word_stagger' | 'line_reveal' | 'fade_up' | 'tracking_in' | 'mask_reveal';
  exitType: 'fade_out' | 'slide_out' | 'scale_out';
  enterDurationMs: number;
  staggerMs: number;         // per word/character delay
  fontScale: 'display' | 'headline' | 'body' | 'caption';
  letterSpacing: number;     // em units — premium feel
  lineHeight: number;
}

const TYPOGRAPHY_PRESETS: Record<string, TypographyMotion> = {
  hook_headline: {
    enterType: 'tracking_in', exitType: 'fade_out',
    enterDurationMs: 600, staggerMs: 40,
    fontScale: 'display', letterSpacing: -0.02, lineHeight: 1.0,
  },
  solution_headline: {
    enterType: 'word_stagger', exitType: 'fade_out',
    enterDurationMs: 500, staggerMs: 80,
    fontScale: 'headline', letterSpacing: -0.01, lineHeight: 1.1,
  },
  proof_body: {
    enterType: 'line_reveal', exitType: 'fade_out',
    enterDurationMs: 400, staggerMs: 60,
    fontScale: 'body', letterSpacing: 0.01, lineHeight: 1.4,
  },
  cta_display: {
    enterType: 'mask_reveal', exitType: 'scale_out',
    enterDurationMs: 700, staggerMs: 0,
    fontScale: 'display', letterSpacing: 0.04, lineHeight: 1.0,
  },
  brand_reveal: {
    enterType: 'fade_up', exitType: 'fade_out',
    enterDurationMs: 800, staggerMs: 0,
    fontScale: 'headline', letterSpacing: 0.08, lineHeight: 1.2,
  },
};

// ── Scene Role → Cinematic Config Mapping ─────────────────────────────────────

export interface CinematicSceneConfig {
  camera: CameraMove;
  depthLayers: DepthLayer[];
  typographyPreset: string;
  assetTreatment: 'hero_centered' | 'hero_left' | 'hero_right' | 'reveal_masked' | 'full_depth';
  lightingMood: 'dramatic' | 'soft_fill' | 'backlit' | 'studio' | 'natural';
  transitionIn: 'cinematic_cut' | 'depth_push' | 'light_sweep' | 'dissolve';
  transitionOut: 'cinematic_cut' | 'depth_pull' | 'light_sweep' | 'dissolve';
  overlayEffect: 'none' | 'vignette' | 'film_grain' | 'lens_flare' | 'light_leak';
}

const SCENE_ROLE_CINEMATIC: Record<string, CinematicSceneConfig> = {
  hook: {
    camera: 'push_in',
    depthLayers: ['background', 'midground', 'subject', 'headline', 'overlay'],
    typographyPreset: 'hook_headline',
    assetTreatment: 'hero_centered',
    lightingMood: 'dramatic',
    transitionIn: 'light_sweep',
    transitionOut: 'cinematic_cut',
    overlayEffect: 'vignette',
  },
  problem: {
    camera: 'ken_burns',
    depthLayers: ['background', 'midground', 'subject', 'headline', 'supporting'],
    typographyPreset: 'proof_body',
    assetTreatment: 'hero_left',
    lightingMood: 'soft_fill',
    transitionIn: 'dissolve',
    transitionOut: 'dissolve',
    overlayEffect: 'none',
  },
  solution: {
    camera: 'pull_back',
    depthLayers: ['background', 'subject', 'headline', 'supporting', 'overlay'],
    typographyPreset: 'solution_headline',
    assetTreatment: 'full_depth',
    lightingMood: 'studio',
    transitionIn: 'depth_push',
    transitionOut: 'cinematic_cut',
    overlayEffect: 'lens_flare',
  },
  proof: {
    camera: 'horizontal_drift',
    depthLayers: ['background', 'midground', 'subject', 'headline', 'supporting'],
    typographyPreset: 'proof_body',
    assetTreatment: 'hero_right',
    lightingMood: 'natural',
    transitionIn: 'dissolve',
    transitionOut: 'dissolve',
    overlayEffect: 'none',
  },
  brand_reveal: {
    camera: 'rise_up',
    depthLayers: ['background', 'midground', 'subject', 'headline', 'overlay'],
    typographyPreset: 'brand_reveal',
    assetTreatment: 'reveal_masked',
    lightingMood: 'backlit',
    transitionIn: 'light_sweep',
    transitionOut: 'light_sweep',
    overlayEffect: 'lens_flare',
  },
  offer: {
    camera: 'push_in',
    depthLayers: ['background', 'subject', 'headline', 'supporting', 'overlay'],
    typographyPreset: 'solution_headline',
    assetTreatment: 'hero_centered',
    lightingMood: 'dramatic',
    transitionIn: 'depth_push',
    transitionOut: 'cinematic_cut',
    overlayEffect: 'vignette',
  },
  cta: {
    camera: 'static_lock',
    depthLayers: ['background', 'subject', 'headline', 'overlay'],
    typographyPreset: 'cta_display',
    assetTreatment: 'full_depth',
    lightingMood: 'studio',
    transitionIn: 'depth_push',
    transitionOut: 'dissolve',
    overlayEffect: 'none',
  },
  close: {
    camera: 'pull_back',
    depthLayers: ['background', 'subject', 'headline', 'overlay'],
    typographyPreset: 'brand_reveal',
    assetTreatment: 'hero_centered',
    lightingMood: 'soft_fill',
    transitionIn: 'dissolve',
    transitionOut: 'dissolve',
    overlayEffect: 'none',
  },
};

const DEFAULT_CINEMATIC_CONFIG = SCENE_ROLE_CINEMATIC['solution'];

// ── Cinematic Layer Descriptor ────────────────────────────────────────────────

export interface CinematicLayer {
  id: string;
  depthLayer: DepthLayer;
  type: 'brand_asset' | 'background_gradient' | 'text' | 'shape' | 'overlay_effect' | 'camera_rig';
  // Geometry (normalized 0–1 relative to canvas)
  x: number;
  y: number;
  width: number;
  height: number;
  // Depth system
  zIndex: number;
  parallaxFactor: number;
  blurRadius: number;
  perspectiveScale: number;   // subtle size increase toward foreground
  // Asset-specific
  assetUrl?: string;
  assetType?: string;
  // Shadow & lighting
  dropShadow?: {
    x: number; y: number;
    blur: number; spread: number;
    color: string; opacity: number;
  };
  softLightEdge?: number;     // feather px on asset edges
  // Motion keyframes (relative to scene start)
  motionKeyframes: Array<{
    timeMs: number;
    x: number; y: number;
    scale: number;
    opacity: number;
    rotation: number;
    easing: string;
  }>;
  // Typography (for text layers)
  textContent?: string;
  typographyMotion?: TypographyMotion;
}

export interface CinematicSceneDescriptor {
  sceneId: string;
  sceneRole: string;
  durationMs: number;
  cinematicConfig: CinematicSceneConfig;
  cameraKeyframes: CameraKeyframe[];
  layers: CinematicLayer[];
  // Enhanced prompt for the AI provider with cinematic depth cues
  enrichedPrompt: string;
  // FFmpeg filter chain snippet this scene should use
  ffmpegFilters: string[];
}

// ── Asset Treatment Helpers ───────────────────────────────────────────────────

function buildAssetLayer(
  asset: SceneAssetLayer,
  treatment: CinematicSceneConfig['assetTreatment'],
  durationMs: number
): CinematicLayer {
  const depth = DEPTH_CONFIG['subject'];

  // Determine position based on treatment
  const pos: { x: number; y: number; width: number; height: number } =
    treatment === 'hero_centered' ? { x: 0.15, y: 0.15, width: 0.70, height: 0.70 } :
    treatment === 'hero_left'     ? { x: 0.03, y: 0.15, width: 0.52, height: 0.68 } :
    treatment === 'hero_right'    ? { x: 0.45, y: 0.15, width: 0.52, height: 0.68 } :
    treatment === 'full_depth'    ? { x: 0.10, y: 0.08, width: 0.80, height: 0.84 } :
    treatment === 'reveal_masked' ? { x: 0.20, y: 0.20, width: 0.60, height: 0.60 } :
    { x: 0.15, y: 0.15, width: 0.70, height: 0.70 };

  // Entrance keyframes — cinematic ease
  const enterDuration = Math.min(800, durationMs * 0.25);
  const motionKeyframes = [
    { timeMs: 0,           x: pos.x, y: pos.y + 0.025, scale: 0.97, opacity: 0, rotation: 0, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
    { timeMs: enterDuration, x: pos.x, y: pos.y,       scale: 1.00, opacity: 1, rotation: 0, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
    { timeMs: durationMs - 200, x: pos.x, y: pos.y,   scale: 1.00, opacity: 1, rotation: 0, easing: 'ease-in' },
    { timeMs: durationMs,       x: pos.x, y: pos.y,   scale: 1.00, opacity: 0, rotation: 0, easing: 'ease-in' },
  ];

  return {
    id: `asset_${asset.assetId}`,
    depthLayer: 'subject',
    type: 'brand_asset',
    ...pos,
    zIndex: depth.zIndex,
    parallaxFactor: depth.parallaxFactor,
    blurRadius: depth.blurRadius,
    perspectiveScale: 1.0,
    assetUrl: asset.cdnUrl || asset.vectorUrl || '',
    assetType: asset.assetType,
    dropShadow: {
      x: 0, y: 12, blur: 48, spread: -8,
      color: '#000000', opacity: 0.35,
    },
    softLightEdge: 8,
    motionKeyframes,
    typographyMotion: undefined,
  };
}

function buildTextLayer(
  text: string,
  depthLayer: DepthLayer,
  typographyPreset: TypographyMotion,
  yPosition: number,
  durationMs: number
): CinematicLayer {
  const depth = DEPTH_CONFIG[depthLayer];
  const enterDuration = typographyPreset.enterDurationMs;

  return {
    id: `text_${depthLayer}_${Date.now()}`,
    depthLayer,
    type: 'text',
    x: 0.05, y: yPosition,
    width: 0.90, height: 0.20,
    zIndex: depth.zIndex,
    parallaxFactor: depth.parallaxFactor,
    blurRadius: depth.blurRadius,
    perspectiveScale: 1 + (depth.parallaxFactor * 0.05),
    textContent: text,
    typographyMotion: typographyPreset,
    motionKeyframes: [
      { timeMs: 0,                x: 0.05, y: yPosition + 0.02, scale: 0.98, opacity: 0, rotation: 0, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
      { timeMs: enterDuration,    x: 0.05, y: yPosition,        scale: 1.00, opacity: 1, rotation: 0, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
      { timeMs: durationMs - 300, x: 0.05, y: yPosition,        scale: 1.00, opacity: 1, rotation: 0, easing: 'ease-in' },
      { timeMs: durationMs,       x: 0.05, y: yPosition,        scale: 1.00, opacity: 0, rotation: 0, easing: 'ease-in' },
    ],
  };
}

function buildBackgroundLayer(
  brandColors: string[],
  durationMs: number
): CinematicLayer {
  const depth = DEPTH_CONFIG['background'];
  return {
    id: 'background_gradient',
    depthLayer: 'background',
    type: 'background_gradient',
    x: -0.04, y: -0.04, width: 1.08, height: 1.08,
    zIndex: depth.zIndex,
    parallaxFactor: depth.parallaxFactor,
    blurRadius: depth.blurRadius,
    perspectiveScale: depth.scaleReserve,
    motionKeyframes: [
      { timeMs: 0,        x: -0.04, y: -0.04, scale: 1.08, opacity: 1, rotation: 0, easing: 'linear' },
      { timeMs: durationMs, x: -0.04, y: -0.04, scale: 1.08, opacity: 1, rotation: 0, easing: 'linear' },
    ],
  };
}

// ── FFmpeg Filter Chains for Cinematic Effects ─────────────────────────────────

function buildCinematicFFmpegFilters(config: CinematicSceneConfig, aspectRatio: string): string[] {
  const filters: string[] = [];

  // Vignette overlay
  if (config.overlayEffect === 'vignette') {
    filters.push('vignette=angle=PI/4:mode=forward');
  }

  // Film grain (light, professional — not VHS noise)
  if (config.overlayEffect === 'film_grain') {
    filters.push('noise=alls=3:allf=t+u');
  }

  // Cinematic letterbox (16:9 black bars for vertical content in cinematic mode)
  // Only on widescreen renders
  if (aspectRatio === '16:9') {
    // slight color grade — teal shadows, warm highlights (modern commercial look)
    filters.push('colorchannelmixer=rr=1.02:gg=1.00:bb=0.97');
  }

  // Contrast & sharpness boost for professional feel
  filters.push('eq=contrast=1.04:brightness=0.01:saturation=1.08');
  filters.push('unsharp=5:5:0.4:3:3:0.1');

  return filters;
}

// ── Cinematic Prompt Enhancement ──────────────────────────────────────────────
// Augments the existing scene prompt with depth, lighting, and cinematic cues
// WITHOUT changing any AI engine — only modifies the prompt string passed to the provider.

export function buildCinematicPrompt(
  basePrompt: string,
  config: CinematicSceneConfig,
  brandColors?: string[]
): string {
  const lightingDescriptors: Record<typeof config.lightingMood, string> = {
    dramatic:  'dramatic cinematic lighting with strong shadows and deep contrast, studio rim light, dark rich atmosphere',
    soft_fill: 'soft fill lighting, gentle diffused key light, minimal shadows, clean professional look',
    backlit:   'strong backlight creating a luminous halo, silhouette depth, premium brand atmosphere',
    studio:    'clean studio lighting, neutral white background, sharp product definition, commercial photography quality',
    natural:   'natural window light, warm golden-hour color temperature, authentic real-world setting',
  };

  const cameraDescriptors: Record<CameraMove, string> = {
    push_in:          'slow cinematic push-in camera move',
    pull_back:        'dramatic pull-back reveal',
    horizontal_drift: 'slow horizontal tracking shot',
    ken_burns:        'Ken Burns-style diagonal camera drift',
    static_lock:      'locked-off professional static frame',
    rise_up:          'slow upward camera rise',
  };

  const depthCue = 'multi-layer depth composition with clear foreground-to-background separation, 2.5D parallax depth, shallow depth of field on background';
  const qualityCue = 'ultra-high-quality commercial advertising, 8K render quality, photorealistic, professional motion graphics, premium brand campaign';
  const colorCue = brandColors && brandColors.length > 0
    ? `brand color palette: ${brandColors.slice(0, 3).join(', ')}, harmonious color grading`
    : 'sophisticated neutral color palette with premium accent tones';

  return [
    basePrompt,
    lightingDescriptors[config.lightingMood],
    cameraDescriptors[config.camera],
    depthCue,
    colorCue,
    qualityCue,
  ].filter(Boolean).join('. ');
}

// ── Main Cinematic Scene Builder ──────────────────────────────────────────────

export function buildCinematicSceneDescriptor(
  scene: SceneData & { assetLayers?: SceneAssetLayer[]; brandColors?: { primary: string; secondary: string; accent: string } },
  renderConfig: RenderConfig,
  durationMs: number
): CinematicSceneDescriptor {

  const role = (scene as any).role || 'solution';
  const config = SCENE_ROLE_CINEMATIC[role] || DEFAULT_CINEMATIC_CONFIG;
  const brandColors = scene.brandColors
    ? [scene.brandColors.primary, scene.brandColors.secondary, scene.brandColors.accent].filter(Boolean)
    : [];

  // Camera keyframes
  const cameraKeyframes = CAMERA_MOVES[config.camera](durationMs);

  // Build layer stack
  const layers: CinematicLayer[] = [];

  // 1. Background layer (always present)
  layers.push(buildBackgroundLayer(brandColors, durationMs));

  // 2. Brand asset layers (from existing asset injection system)
  const assetLayers = (scene as any).assetLayers as SceneAssetLayer[] | undefined;
  if (assetLayers && assetLayers.length > 0) {
    for (const asset of assetLayers) {
      layers.push(buildAssetLayer(asset, config.assetTreatment, durationMs));
    }
  }

  // 3. Text layers
  const onScreenText = (scene as any).onScreenText || (scene as any).visualConfig?.onScreenText;
  if (onScreenText) {
    const typoPreset = TYPOGRAPHY_PRESETS[config.typographyPreset] || TYPOGRAPHY_PRESETS['solution_headline'];
    layers.push(buildTextLayer(onScreenText, 'headline', typoPreset, 0.62, durationMs));
  }

  // 4. Vignette/overlay layer (atmospheric depth)
  if (config.overlayEffect === 'vignette' || config.overlayEffect === 'film_grain') {
    layers.push({
      id: 'vignette_overlay',
      depthLayer: 'vignette',
      type: 'overlay_effect',
      x: 0, y: 0, width: 1, height: 1,
      zIndex: DEPTH_CONFIG['vignette'].zIndex,
      parallaxFactor: 0,
      blurRadius: 0,
      perspectiveScale: 1,
      motionKeyframes: [
        { timeMs: 0,        x: 0, y: 0, scale: 1, opacity: 0.65, rotation: 0, easing: 'linear' },
        { timeMs: durationMs, x: 0, y: 0, scale: 1, opacity: 0.65, rotation: 0, easing: 'linear' },
      ],
    });
  }

  // Sort by zIndex
  layers.sort((a, b) => a.zIndex - b.zIndex);

  return {
    sceneId: scene.id,
    sceneRole: role,
    durationMs,
    cinematicConfig: config,
    cameraKeyframes,
    layers,
    enrichedPrompt: buildCinematicPrompt(scene.prompt, config, brandColors),
    ffmpegFilters: buildCinematicFFmpegFilters(config, renderConfig.aspectRatio),
  };
}

// ── Batch Scene Processing ────────────────────────────────────────────────────

export function enrichScenesForCinematicMode(
  scenes: SceneData[],
  renderConfig: RenderConfig,
  defaultDurationSec = 7
): Array<SceneData & { cinematicDescriptor: CinematicSceneDescriptor }> {

  logger.info('[CinematicRenderer] Enriching scenes for cinematic mode', {
    sceneCount: scenes.length,
    renderMode: renderConfig.renderMode,
  });

  return scenes.map((scene) => {
    const durationMs = ((scene as any).timing?.durationSec || defaultDurationSec) * 1000;
    const descriptor = buildCinematicSceneDescriptor(scene as any, renderConfig, durationMs);

    // Replace the scene prompt with the cinematic-enhanced version
    return {
      ...scene,
      prompt: descriptor.enrichedPrompt,
      cinematicDescriptor: descriptor,
    };
  });
}

// ── Cinematic Mode Detection ──────────────────────────────────────────────────

export function isCinematicMode(renderConfig: RenderConfig): boolean {
  // Launch modes: 'Normal Ad' (2D) and 'Cinematic Ad' (2.5D)
  // Legacy aliases coerced upstream; cast to string for backward-compat guard
  const mode = renderConfig.renderMode as string;
  return mode === 'Cinematic Ad' || mode === 'Premium Cinematic' ||
    (renderConfig as any).adStyle === 'cinematic';
}

// ── Ad Style Types (exposed for frontend/backend contract) ───────────────────

export type AdStyle = 'normal' | 'cinematic';

export interface AdStyleConfig {
  style: AdStyle;
  label: string;
  description: string;
  creditMultiplier: number;
  renderMode: RenderConfig['renderMode'];
  estimatedRenderTimeMultiplier: number;
  features: string[];
}

export const AD_STYLE_CONFIGS: Record<AdStyle, AdStyleConfig> = {
  normal: {
    style: 'normal',
    label: 'Normal Ad',
    description: 'Fast 2D motion graphics with standard layer animation. Ideal for high-volume campaigns.',
    creditMultiplier: 1.0,
    renderMode: 'Normal Ad',
    estimatedRenderTimeMultiplier: 1.0,
    features: [
      'Multi-layer 2D animation',
      'Standard transitions',
      'Brand asset placement',
      'Platform-optimised',
      'Fast rendering',
    ],
  },
  cinematic: {
    style: 'cinematic',
    label: 'Cinematic Ad',
    description: 'Premium 2.5D depth composition with camera movement, parallax layers, and cinematic lighting.',
    creditMultiplier: 3.5,
    renderMode: 'Cinematic Ad',   // launch mode (was 'Premium Cinematic')
    estimatedRenderTimeMultiplier: 2.2,
    features: [
      '2.5D parallax depth layers',
      'Cinematic camera movement',
      'Realistic brand asset treatment',
      'Premium typography motion',
      'Professional color grading',
      'Depth-of-field blur',
      'Atmospheric vignette & lens effects',
    ],
  },
};
