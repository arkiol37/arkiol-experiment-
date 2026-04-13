/**
 * Integration Bridge
 * ═══════════════════════════════════════════════════════════════════════════════
 * Translates the orchestrator's planning output into SceneBindings that the
 * template execution engine can render.
 *
 * This is the seam between the existing intelligence pipeline (19+ planning
 * stages) and the new rendering runtime. All existing engines continue to
 * work unchanged — their output is consumed here and translated into the
 * renderer's type system.
 *
 * Input:  PipelineContext (from intelligenceOrchestrator)
 *         + StoryboardScene[] + brand assets + camera plans
 * Output: SceneBindings[] (one per scene, ready for renderSceneClip)
 */

import { logger } from '../../../config/logger';
import type {
  SceneBindings, SlotBinding, CameraBinding, CameraKF, BrandBinding,
  AudioSyncBinding, BackgroundDef, AspectRatio, EasingFn,
  ExecutableTemplate,
} from '../types';
import type {
  StoryboardScene, DirectorIntent, CameraKeyframe, DepthLayerSpec,
  AudioSyncPoint, MotionPlan, ShotPlan,
} from '../../types';
import type { PipelineContext } from '../../orchestrator/intelligenceOrchestrator';
import type { EnrichedSceneSpec, SceneAssetLayer } from '../../../services/brandAssetSceneInjector';
import type { CinematicSceneDescriptor } from '../../../services/cinematicMotionRenderer';
import { getTemplateForRole, getExecutableTemplate } from '../templates/builtinTemplates';

// ═══════════════════════════════════════════════════════════════════════════════
// CAMERA PRESET MAPPING (matches cinematicMotionRenderer presets)
// ═══════════════════════════════════════════════════════════════════════════════

type CameraPresetName = 'push_in' | 'pull_back' | 'horizontal_drift'
  | 'ken_burns' | 'static_lock' | 'rise_up' | 'orbit' | 'crane_down'
  | 'dolly_left' | 'dolly_right';

function buildCameraKeyframes(preset: CameraPresetName, durationMs: number): CameraKF[] {
  const presets: Record<string, (d: number) => CameraKF[]> = {
    push_in: (d) => [
      { timeMs: 0, scale: 1.00, translateX: 0, translateY: 0, rotation: 0, easing: 'ease-in-out' },
      { timeMs: d, scale: 1.06, translateX: 0, translateY: -0.005, rotation: 0, easing: 'ease-in-out' },
    ],
    pull_back: (d) => [
      { timeMs: 0, scale: 1.08, translateX: 0, translateY: 0, rotation: 0, easing: 'ease-in-out' },
      { timeMs: d, scale: 1.00, translateX: 0, translateY: 0.005, rotation: 0, easing: 'ease-in-out' },
    ],
    horizontal_drift: (d) => [
      { timeMs: 0, scale: 1.04, translateX: -0.01, translateY: 0, rotation: 0, easing: 'linear' },
      { timeMs: d, scale: 1.04, translateX: 0.01, translateY: 0, rotation: 0, easing: 'linear' },
    ],
    ken_burns: (d) => [
      { timeMs: 0, scale: 1.00, translateX: -0.005, translateY: 0.005, rotation: 0, easing: 'ease-in-out' },
      { timeMs: d, scale: 1.08, translateX: 0.005, translateY: -0.005, rotation: 0, easing: 'ease-in-out' },
    ],
    static_lock: (d) => [
      { timeMs: 0, scale: 1.00, translateX: 0, translateY: 0, rotation: 0, easing: 'linear' },
      { timeMs: d, scale: 1.00, translateX: 0, translateY: 0, rotation: 0, easing: 'linear' },
    ],
    rise_up: (d) => [
      { timeMs: 0, scale: 1.03, translateX: 0, translateY: 0.01, rotation: 0, easing: 'ease-in-out' },
      { timeMs: d, scale: 1.06, translateX: 0, translateY: -0.005, rotation: 0, easing: 'ease-in-out' },
    ],
    orbit: (d) => [
      { timeMs: 0, scale: 1.02, translateX: -0.008, translateY: 0, rotation: -0.5, easing: 'ease-in-out' },
      { timeMs: d * 0.5, scale: 1.05, translateX: 0, translateY: -0.003, rotation: 0, easing: 'ease-in-out' },
      { timeMs: d, scale: 1.02, translateX: 0.008, translateY: 0, rotation: 0.5, easing: 'ease-in-out' },
    ],
    crane_down: (d) => [
      { timeMs: 0, scale: 1.06, translateX: 0, translateY: -0.015, rotation: 0, easing: 'ease-out' },
      { timeMs: d, scale: 1.00, translateX: 0, translateY: 0, rotation: 0, easing: 'ease-out' },
    ],
    dolly_left: (d) => [
      { timeMs: 0, scale: 1.03, translateX: 0.015, translateY: 0, rotation: 0, easing: 'ease-in-out' },
      { timeMs: d, scale: 1.03, translateX: -0.015, translateY: 0, rotation: 0, easing: 'ease-in-out' },
    ],
    dolly_right: (d) => [
      { timeMs: 0, scale: 1.03, translateX: -0.015, translateY: 0, rotation: 0, easing: 'ease-in-out' },
      { timeMs: d, scale: 1.03, translateX: 0.015, translateY: 0, rotation: 0, easing: 'ease-in-out' },
    ],
  };

  const builder = presets[preset] || presets.static_lock;
  return builder(durationMs);
}

// ═══════════════════════════════════════════════════════════════════════════════
// MOOD → BACKGROUND GRADIENT MAPPING
// ═══════════════════════════════════════════════════════════════════════════════

const MOOD_BACKGROUNDS: Record<string, BackgroundDef> = {
  Luxury:     { type: 'gradient', stops: [{ color: '#1c1206', position: 0 }, { color: '#2c1810', position: 0.5 }, { color: '#0d0d0d', position: 1 }], angle: 135 },
  Energetic:  { type: 'gradient', stops: [{ color: '#ff4e50', position: 0 }, { color: '#f9d423', position: 1 }], angle: 120 },
  Minimal:    { type: 'gradient', stops: [{ color: '#f8f7f4', position: 0 }, { color: '#f3edff', position: 1 }], angle: 180 },
  Cinematic:  { type: 'gradient', stops: [{ color: '#0c001f', position: 0 }, { color: '#1a0045', position: 0.5 }, { color: '#0c0028', position: 1 }], angle: 135 },
  Playful:    { type: 'gradient', stops: [{ color: '#ffe0f0', position: 0 }, { color: '#fff0e0', position: 0.5 }, { color: '#e0f0ff', position: 1 }], angle: 120 },
  Emotional:  { type: 'gradient', stops: [{ color: '#fdf4f7', position: 0 }, { color: '#fce4ec', position: 1 }], angle: 135 },
  Corporate:  { type: 'gradient', stops: [{ color: '#091525', position: 0 }, { color: '#0d2444', position: 1 }], angle: 160 },
  Bold:       { type: 'gradient', stops: [{ color: '#090909', position: 0 }, { color: '#1c1206', position: 1 }], angle: 180 },
  Calm:       { type: 'gradient', stops: [{ color: '#ecf3ed', position: 0 }, { color: '#d6eada', position: 1 }], angle: 135 },
  Tech:       { type: 'gradient', stops: [{ color: '#0c001f', position: 0 }, { color: '#7c3aed', position: 0.5 }, { color: '#e879f9', position: 1 }], angle: 135 },
  Warm:       { type: 'gradient', stops: [{ color: '#fff5ee', position: 0 }, { color: '#ffe8d6', position: 1 }], angle: 140 },
  Fresh:      { type: 'gradient', stops: [{ color: '#e8f4fd', position: 0 }, { color: '#d4ecfb', position: 1 }], angle: 145 },
  Creative:   { type: 'gradient', stops: [{ color: '#f3edff', position: 0 }, { color: '#ede4ff', position: 1 }], angle: 140 },
  Nature:     { type: 'gradient', stops: [{ color: '#0b2117', position: 0 }, { color: '#163828', position: 1 }], angle: 150 },
};

// ═══════════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════════

export interface BridgeInput {
  pipelineCtx: PipelineContext;
  /** Enriched scenes with brand asset layers (from brandAssetSceneInjector). */
  enrichedScenes?: EnrichedSceneSpec[];
  /** Cinematic descriptors (from cinematicMotionRenderer). */
  cinematicDescriptors?: CinematicSceneDescriptor[];
  /** Brand data from the orchestrator. */
  brandData?: {
    primaryColor: string;
    secondaryColor: string;
    accentColor: string;
    backgroundColor: string;
    fontFamily?: string;
    logoUrl?: string;
  };
}

export interface BridgeOutput {
  scenes: Array<{
    template: ExecutableTemplate;
    bindings: SceneBindings;
  }>;
}

/**
 * Convert orchestrator output into renderer-ready scene specifications.
 */
export function bridgePipelineToRenderer(input: BridgeInput): BridgeOutput {
  const { pipelineCtx, enrichedScenes, cinematicDescriptors, brandData } = input;
  const { intent, storyboard } = pipelineCtx;
  const aspectRatio = intent.aspectRatio as AspectRatio;
  const isCinematic = intent.renderMode === 'Cinematic Ad';

  logger.info(`[IntegrationBridge] Converting ${storyboard.length} scenes for internal rendering`, {
    renderJobId: pipelineCtx.renderJobId,
    aspectRatio,
    mood: intent.mood,
  });

  // Build brand binding
  const brand: BrandBinding | undefined = brandData ? {
    primaryColor: brandData.primaryColor,
    secondaryColor: brandData.secondaryColor,
    accentColor: brandData.accentColor,
    backgroundColor: brandData.backgroundColor,
    fontFamily: brandData.fontFamily,
    logoSrc: brandData.logoUrl,
  } : undefined;

  const scenes: BridgeOutput['scenes'] = [];

  for (let i = 0; i < storyboard.length; i++) {
    const scene = storyboard[i];
    const enriched = enrichedScenes?.[i];
    const cinematic = cinematicDescriptors?.[i];

    // Select template based on scene role
    const template = getTemplateForRole(scene.role);

    // Build slot bindings from storyboard data
    const slots: Record<string, SlotBinding> = {};

    // Headline text (from on-screen text or voiceover script)
    const headlineText = scene.onScreenText || scene.voiceoverScript?.split('.')[0] || scene.prompt;
    slots['headline'] = { text: headlineText };

    // Supporting text
    if (scene.voiceoverScript && scene.onScreenText) {
      slots['subtext'] = { text: scene.voiceoverScript.split('.').slice(0, 2).join('. ') };
      slots['body'] = { text: scene.voiceoverScript };
    }

    // Brand logo
    if (brand?.logoSrc) {
      slots['logo'] = { imageSrc: brand.logoSrc };
    }

    // Product/scene image from enriched brand asset layers
    if (enriched?.assetLayers && enriched.assetLayers.length > 0) {
      const heroAsset = enriched.assetLayers[0];
      if (heroAsset.cdnUrl) {
        slots['product_image'] = { imageSrc: heroAsset.cdnUrl };
      }
    }

    // CTA-specific bindings
    if (scene.role === 'cta') {
      const ctaText = (pipelineCtx.metadata as any)?.ctaText || 'Get Started';
      slots['cta_text'] = { text: ctaText };
      slots['cta_button'] = {}; // container — styling from template
      if (brand) {
        slots['cta_button'] = {
          styleOverrides: { backgroundColor: brand.accentColor || brand.primaryColor },
        };
      }
    }

    // Testimonial bindings
    if (scene.role === 'proof') {
      slots['quote_mark'] = { text: '"' };
      slots['attribution'] = { text: intent.brand?.name || '' };
    }

    // Brand reveal bindings
    if (scene.role === 'brand_reveal') {
      slots['tagline'] = { text: intent.brand?.brief || intent.brand?.name || '' };
    }

    // Build camera binding from storyboard camera preset
    const durationMs = scene.durationSec * 1000;
    const cameraPreset = (scene.cameraMove || 'push_in') as CameraPresetName;
    const camera: CameraBinding = {
      preset: cameraPreset as any,
      keyframes: buildCameraKeyframes(cameraPreset, durationMs),
      depthScale: isCinematic ? 1.0 : 0.5,
    };

    // If cinematic descriptor has camera keyframes, use those
    if (cinematic?.cameraKeyframes) {
      camera.keyframes = cinematic.cameraKeyframes.map(kf => ({
        timeMs: kf.timeMs,
        scale: kf.scale,
        translateX: kf.translateX / 100, // convert from percent to fraction
        translateY: kf.translateY / 100,
        rotation: 0,
        easing: (kf.easing?.includes('cubic-bezier') ? 'ease-in-out' : 'ease-in-out') as EasingFn,
      }));
    }

    // Build audio sync bindings
    const audioSync: AudioSyncBinding[] = (scene.audioSync || []).map(sync => ({
      timeMs: sync.timeMs,
      type: sync.type as AudioSyncBinding['type'],
      intensity: sync.intensity,
    }));

    // Build background (mood-based or from brand)
    let background: BackgroundDef | undefined;
    if (brand?.backgroundColor) {
      background = { type: 'solid', color: brand.backgroundColor };
    } else if (MOOD_BACKGROUNDS[intent.mood]) {
      background = MOOD_BACKGROUNDS[intent.mood];
    }

    // Brand color overrides for template styles
    if (brand) {
      // Override CTA button color
      if (slots['cta_button']) {
        slots['cta_button'].styleOverrides = {
          ...slots['cta_button'].styleOverrides,
          backgroundColor: brand.accentColor || brand.primaryColor,
        };
      }
      // Override accent line color
      if (template.slots.find(s => s.id === 'accent_line')) {
        slots['accent_line'] = {
          styleOverrides: { backgroundColor: brand.accentColor || brand.primaryColor },
        };
      }
    }

    const bindings: SceneBindings = {
      sceneId: scene.id,
      templateId: template.id,
      durationMs,
      aspectRatio,
      slots,
      background,
      camera,
      brand,
      audioSync,
    };

    scenes.push({ template, bindings });
  }

  logger.info(`[IntegrationBridge] Generated ${scenes.length} scene bindings`);

  return { scenes };
}

/**
 * Quick bridge for simple/direct use — builds scene bindings from minimal input
 * without requiring a full pipeline context.
 */
export function bridgeSimpleScene(params: {
  sceneId: string;
  role: string;
  headlineText: string;
  bodyText?: string;
  imageSrc?: string;
  logoSrc?: string;
  brandColors?: { primary: string; secondary: string; accent: string };
  durationMs?: number;
  aspectRatio?: AspectRatio;
  cameraPreset?: CameraPresetName;
}): { template: ExecutableTemplate; bindings: SceneBindings } {
  const template = getTemplateForRole(params.role);
  const durationMs = params.durationMs ?? template.defaultDurationMs;
  const aspectRatio = params.aspectRatio ?? '9:16';

  const slots: Record<string, SlotBinding> = {
    headline: { text: params.headlineText },
  };

  if (params.bodyText) {
    slots['subtext'] = { text: params.bodyText };
    slots['body'] = { text: params.bodyText };
  }
  if (params.imageSrc) {
    slots['product_image'] = { imageSrc: params.imageSrc };
  }
  if (params.logoSrc) {
    slots['logo'] = { imageSrc: params.logoSrc };
  }

  const cameraPreset = params.cameraPreset ?? 'push_in';

  const bindings: SceneBindings = {
    sceneId: params.sceneId,
    templateId: template.id,
    durationMs,
    aspectRatio,
    slots,
    camera: {
      preset: cameraPreset as any,
      keyframes: buildCameraKeyframes(cameraPreset, durationMs),
      depthScale: 0.6,
    },
    brand: params.brandColors ? {
      primaryColor: params.brandColors.primary,
      secondaryColor: params.brandColors.secondary,
      accentColor: params.brandColors.accent,
      backgroundColor: params.brandColors.primary || '#f8f7f4',
    } : undefined,
  };

  return { template, bindings };
}
