/**
 * Spec Builder
 * ═══════════════════════════════════════════════════════════════════════════════
 * Converts the orchestrator's PipelineContext (+ enriched scenes + brand data)
 * into a validated RenderSpecCollection of strict, executable SceneSpecs.
 *
 * This is the "contract layer" between the intelligence pipeline and the
 * rendering engine. Every field in a SceneSpec must be resolvable here —
 * if data is missing, defaults are applied and violations are recorded.
 *
 * Pipeline:
 *   PipelineContext → SpecBuilder → SceneSpec[] → TemplateExecutionEngine
 *
 * The SpecBuilder:
 *   1. Iterates each storyboard scene.
 *   2. Selects the best matching ExecutableTemplate.
 *   3. Resolves all slot bindings from scene + brand + enriched asset data.
 *   4. Builds a CameraSpec from cinematic descriptors or presets.
 *   5. Builds background, brand, typography, and audio sync specs.
 *   6. Validates the resulting SceneSpec and reports violations.
 *   7. Returns a RenderSpecCollection with all validated specs.
 */

import { logger } from '../../../config/logger';
import type { PipelineContext } from '../../orchestrator/intelligenceOrchestrator';
import type { StoryboardScene } from '../../types';
import type { EnrichedSceneSpec } from '../../../services/brandAssetSceneInjector';
import type { CinematicSceneDescriptor } from '../../../services/cinematicMotionRenderer';
import {
  getTemplateForRole, getExecutableTemplate,
} from '../templates/builtinTemplates';
import type { ExecutableTemplate, AspectRatio, BackgroundDef, HexColor } from '../types';
import {
  type SceneSpec, type RenderSpecCollection, type LayerSpec, type LayerContent,
  type LayerLayout, type LayerStyle, type LayerAnimation, type AnimPhase,
  type AnimKeyframeSpec, type CameraSpec, type CameraKeyframeSpec,
  type TransitionSpec, type TypographySpec, type BrandSpec,
  type AudioSyncPoint, type SpecSourceMeta, type SafeAreaSpec,
  type TextLayerContent, type ImageLayerContent, type LogoLayerContent,
  type ShapeLayerContent, type EmptyLayerContent,
  SCENE_SPEC_VERSION, validateSceneSpec,
} from '../schema/sceneSpec';
import type { TemplateSlot, SlotType, EasingFn } from '../types';
import { PLATFORM_SAFE_AREAS } from '../layout/constraintEngine';

// ═══════════════════════════════════════════════════════════════════════════════
// BUILDER INPUT / OUTPUT
// ═══════════════════════════════════════════════════════════════════════════════

export interface SpecBuilderInput {
  pipelineCtx: PipelineContext;
  enrichedScenes?: EnrichedSceneSpec[];
  cinematicDescriptors?: CinematicSceneDescriptor[];
  brandData?: {
    primaryColor: string;
    secondaryColor: string;
    accentColor: string;
    backgroundColor: string;
    fontFamily?: string;
    logoUrl?: string;
  };
  fps?: number;
  platform?: string;
}

export interface SpecBuilderResult {
  collection: RenderSpecCollection;
  validationSummary: {
    totalScenes: number;
    validScenes: number;
    totalErrors: number;
    totalWarnings: number;
    perScene: Array<{
      sceneId: string;
      valid: boolean;
      errors: string[];
      warnings: string[];
    }>;
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// MOOD → BACKGROUND GRADIENT
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
// CAMERA PRESET KEYFRAMES
// ═══════════════════════════════════════════════════════════════════════════════

function buildCameraKeyframes(preset: string, durationMs: number): CameraKeyframeSpec[] {
  const presets: Record<string, (d: number) => CameraKeyframeSpec[]> = {
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
    dolly_left: (d) => [
      { timeMs: 0, scale: 1.03, translateX: 0.015, translateY: 0, rotation: 0, easing: 'ease-in-out' },
      { timeMs: d, scale: 1.03, translateX: -0.015, translateY: 0, rotation: 0, easing: 'ease-in-out' },
    ],
    dolly_right: (d) => [
      { timeMs: 0, scale: 1.03, translateX: -0.015, translateY: 0, rotation: 0, easing: 'ease-in-out' },
      { timeMs: d, scale: 1.03, translateX: 0.015, translateY: 0, rotation: 0, easing: 'ease-in-out' },
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
  };
  return (presets[preset] ?? presets.push_in)(durationMs);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SLOT → LAYER CONVERSION
// ═══════════════════════════════════════════════════════════════════════════════

function buildLayerContent(
  slot: TemplateSlot,
  scene: StoryboardScene,
  enriched: EnrichedSceneSpec | undefined,
  brand: BrandSpec,
  ctaText: string,
): LayerContent {
  const slotId = slot.id;

  // Text slots
  if (slot.type === 'text' || slot.type === 'icon') {
    let text = '';

    if (slotId === 'headline') {
      text = scene.onScreenText || scene.voiceoverScript?.split('.')[0] || scene.prompt || '';
    } else if (slotId === 'subtext') {
      text = scene.voiceoverScript?.split('.').slice(0, 2).join('. ') || '';
    } else if (slotId === 'body') {
      text = scene.voiceoverScript || '';
    } else if (slotId === 'cta_text') {
      text = ctaText;
    } else if (slotId === 'tagline') {
      text = (scene as any).tagline || '';
    } else if (slotId === 'attribution') {
      text = brand.logoSrc ? '' : ''; // attribution comes from testimonial data
    } else if (slotId === 'quote_mark') {
      text = '"';
    }

    const content: TextLayerContent = {
      type: 'text',
      text: text.trim(),
      fallback: slot.fallback?.value || '',
      transform: slot.style.text?.textTransform === 'uppercase' ? 'uppercase'
        : slot.style.text?.textTransform === 'lowercase' ? 'lowercase'
        : slot.style.text?.textTransform === 'capitalize' ? 'capitalize'
        : 'none',
    };
    return content;
  }

  // Logo slot
  if (slot.type === 'logo') {
    const content: LogoLayerContent = {
      type: 'logo',
      src: brand.logoSrc || '',
      bgRemoved: true,
      fallbackColor: brand.primaryColor,
    };
    return content;
  }

  // Image slot
  if (slot.type === 'image') {
    let src = '';
    if (enriched?.assetLayers && enriched.assetLayers.length > 0) {
      // Use first brand asset
      src = enriched.assetLayers[0]?.cdnUrl || '';
    }
    const content: ImageLayerContent = {
      type: 'image',
      src,
      graceful: true,
      fallbackColor: brand.backgroundColor,
    };
    return content;
  }

  // Shape / container
  if (slot.type === 'shape' || slot.type === 'container') {
    const fill = slot.style.backgroundColor || brand.accentColor || brand.primaryColor || '#e8734a';
    const content: ShapeLayerContent = {
      type: 'shape',
      fill,
      borderRadius: slot.style.borderRadius ?? 0,
    };
    return content;
  }

  const empty: EmptyLayerContent = { type: 'empty' };
  return empty;
}

function buildLayerLayout(slot: TemplateSlot, aspectRatio: AspectRatio): LayerLayout {
  const pos = slot.positions[aspectRatio]
    || slot.positions['9:16']
    || slot.positions['16:9']
    || slot.positions['1:1']
    || { x: 0, y: 0, w: 1, h: 1 };

  return {
    x: pos.x,
    y: pos.y,
    width: pos.w,
    height: pos.h,
    paddingTop:    slot.padding.top,
    paddingRight:  slot.padding.right,
    paddingBottom: slot.padding.bottom,
    paddingLeft:   slot.padding.left,
    alignH: slot.alignment.horizontal,
    alignV: slot.alignment.vertical,
    overflow: slot.overflow,
    imageFit: slot.imageFit,
    enforceSafeArea: slot.type === 'text' || slot.type === 'icon',
  };
}

function buildLayerStyle(slot: TemplateSlot, brand: BrandSpec): LayerStyle {
  const s = slot.style;
  const text = s.text ? {
    fontFamily: s.text.fontFamily,
    fontSize: s.text.fontSize,
    fontWeight: s.text.fontWeight,
    color: s.text.color,
    lineHeight: s.text.lineHeight,
    letterSpacing: s.text.letterSpacing,
    textAlign: s.text.textAlign,
    maxLines: s.text.maxLines ?? 0,
    minFontSize: s.text.minFontSize ?? 12,
    stroke: s.text.stroke,
    shadow: s.text.shadow,
  } : undefined;

  return {
    text,
    backgroundColor: slot.id === 'cta_button' ? brand.accentColor
      : slot.id === 'accent_line' ? brand.accentColor
      : s.backgroundColor,
    opacity: s.opacity ?? 1,
    blur: s.blur ?? 0,
    brightness: s.brightness ?? 1,
    rotation: s.rotation ?? 0,
    borderRadius: s.borderRadius ?? 0,
    shadow: s.shadow,
  };
}

function convertAnimSequence(seq: { keyframes: any[]; durationMs: number; delayMs: number; easing: EasingFn; repeat?: string }): AnimPhase {
  return {
    delayMs: seq.delayMs,
    durationMs: seq.durationMs,
    easing: seq.easing,
    repeat: (seq.repeat ?? 'once') as 'once' | 'loop' | 'ping-pong',
    keyframes: seq.keyframes.map(kf => ({
      offset: kf.offset,
      easing: kf.easing,
      translateX: kf.x,
      translateY: kf.y,
      scaleX: kf.scaleX,
      scaleY: kf.scaleY,
      rotation: kf.rotation,
      opacity: kf.opacity,
      blur: kf.blur,
      brightness: kf.brightness,
      clipTop: kf.clipTop,
      clipBottom: kf.clipBottom,
      clipLeft: kf.clipLeft,
      clipRight: kf.clipRight,
      letterSpacing: kf.letterSpacing,
    } as AnimKeyframeSpec)),
  };
}

function buildLayerAnimation(slot: TemplateSlot): LayerAnimation {
  return {
    entry: convertAnimSequence(slot.animation.entry),
    main: convertAnimSequence(slot.animation.main),
    exit: convertAnimSequence(slot.animation.exit),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN SPEC BUILDER
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Build a RenderSpecCollection from orchestrator output.
 * This is the primary entry point — call once per render job.
 */
export function buildRenderSpecs(input: SpecBuilderInput): SpecBuilderResult {
  const { pipelineCtx, enrichedScenes, cinematicDescriptors, brandData, fps = 24 } = input;
  const { intent, storyboard } = pipelineCtx;
  const aspectRatio = intent.aspectRatio as AspectRatio;
  const isCinematic = intent.renderMode === 'Cinematic Ad';
  const platform = input.platform || intent.platform || 'instagram';

  // Build brand spec — diverse fallback palette rotates so outputs never look
  // monotonically blue.  Keyed off a simple hash of the intent text so the
  // same brief produces the same colors, but *different* briefs get different
  // palettes.
  const _brandPalettes = [
    { primary: '#e8734a', secondary: '#f4a574', accent: '#ff6b6b', bg: '#fff5ee' },  // peach/coral
    { primary: '#00b894', secondary: '#fdcb6e', accent: '#00b894', bg: '#e8f8f0' },  // tropical teal
    { primary: '#ff2d87', secondary: '#ffd23f', accent: '#a855f7', bg: '#ffe0f0' },  // retro pop
    { primary: '#f0a500', secondary: '#ffd166', accent: '#f59e0b', bg: '#1c1206' },  // golden amber
    { primary: '#7c5cbf', secondary: '#b39ddb', accent: '#7c5cbf', bg: '#f3edff' },  // lavender
    { primary: '#0288d1', secondary: '#4fc3f7', accent: '#0288d1', bg: '#e8f4fd' },  // sky fresh
    { primary: '#e63946', secondary: '#f1faee', accent: '#e63946', bg: '#f8f7f4' },  // editorial red
    { primary: '#c2185b', secondary: '#f48fb1', accent: '#c2185b', bg: '#fdf4f7' },  // floral rose
    { primary: '#2ecc71', secondary: '#52d68a', accent: '#00e676', bg: '#0b2117' },  // lush green
    { primary: '#f4511e', secondary: '#ffd600', accent: '#ff7043', bg: '#f4511e' },  // vibrant burst
    { primary: '#d4a574', secondary: '#e8c9a0', accent: '#d4a574', bg: '#2c1810' },  // earth coffee
    { primary: '#ff6b6b', secondary: '#feca57', accent: '#ee5a24', bg: '#ff6b6b' },  // coral energy
  ];
  const _intentStr = intent.description || intent.mood || 'default';
  const _intentHash = _intentStr.split('').reduce((h: number, c: string) => (h * 31 + c.charCodeAt(0)) | 0, 0);
  const _pal = _brandPalettes[Math.abs(_intentHash) % _brandPalettes.length];
  const globalBrand: BrandSpec = {
    primaryColor: brandData?.primaryColor || _pal.primary,
    secondaryColor: brandData?.secondaryColor || _pal.secondary,
    accentColor: brandData?.accentColor || _pal.accent,
    backgroundColor: brandData?.backgroundColor || _pal.bg,
    logoSrc: brandData?.logoUrl,
    logoIsTransparent: true,
  };

  // Build typography spec
  const fontFamily = brandData?.fontFamily;
  const globalTypography: TypographySpec | undefined = fontFamily ? {
    headlineFont: fontFamily,
    bodyFont: fontFamily,
    requiresRemoteFonts: false,
    fontUrls: [],
  } : undefined;

  // Safe area for platform
  const safeAreaNorm = PLATFORM_SAFE_AREAS[platform] || PLATFORM_SAFE_AREAS.default;
  const globalSafeArea: SafeAreaSpec = {
    top: safeAreaNorm.y,
    right: 1 - safeAreaNorm.x - safeAreaNorm.w,
    bottom: 1 - safeAreaNorm.y - safeAreaNorm.h,
    left: safeAreaNorm.x,
  };

  const ctaText = (pipelineCtx.metadata as any)?.ctaText || 'Get Started';

  const scenes: SceneSpec[] = [];
  const validationResults: SpecBuilderResult['validationSummary']['perScene'] = [];

  for (let i = 0; i < storyboard.length; i++) {
    const scene = storyboard[i];
    const enriched = enrichedScenes?.[i];
    const cinematic = cinematicDescriptors?.[i];
    const durationMs = scene.durationSec * 1000;

    // Select template
    const template = getTemplateForRole(scene.role);
    const canvas = template.canvasSizes[aspectRatio] || template.canvasSizes['9:16'];

    // Build all layers from template slots
    const layers: LayerSpec[] = [];

    for (const slot of template.slots) {
      const content = buildLayerContent(slot, scene, enriched, globalBrand, ctaText);

      // Skip empty optional slots with no content
      if (content.type === 'empty' && !slot.required) continue;
      if (content.type === 'text' && (content as TextLayerContent).text === '' && !slot.required) {
        const hasNoFallback = !slot.fallback?.value;
        if (hasNoFallback) continue;
      }
      if ((content.type === 'logo' || content.type === 'image') && !(content as any).src && !slot.required) continue;

      const layout = buildLayerLayout(slot, aspectRatio);
      const style = buildLayerStyle(slot, globalBrand);
      const animation = buildLayerAnimation(slot);

      layers.push({
        slotId: slot.id,
        slotName: slot.name,
        type: slot.type as LayerSpec['type'],
        zIndex: slot.zIndex,
        depthLayer: slot.depthLayer,
        layout,
        content,
        style,
        animation,
        visible: true,
      });
    }

    // Sort layers back-to-front
    layers.sort((a, b) => a.zIndex - b.zIndex);

    // Camera spec
    const cameraPreset = scene.cameraMove || 'push_in';
    let cameraKeyframes: CameraKeyframeSpec[] = buildCameraKeyframes(cameraPreset, durationMs);

    if (cinematic?.cameraKeyframes) {
      cameraKeyframes = cinematic.cameraKeyframes.map(kf => ({
        timeMs: kf.timeMs,
        scale: kf.scale,
        translateX: kf.translateX / 100,
        translateY: kf.translateY / 100,
        rotation: 0,
        easing: 'ease-in-out' as EasingFn,
      }));
    }

    const camera: CameraSpec = {
      preset: cameraPreset,
      depthScale: isCinematic ? 1.0 : 0.5,
      keyframes: cameraKeyframes,
    };

    // Background
    let background: BackgroundDef;
    if (globalBrand.backgroundColor) {
      background = MOOD_BACKGROUNDS[intent.mood] || { type: 'solid', color: globalBrand.backgroundColor };
    } else {
      background = MOOD_BACKGROUNDS[intent.mood] || template.background;
    }

    // Transition
    const transition: TransitionSpec = {
      entry: {
        type: template.transitions.entryType,
        durationMs: template.transitions.entryDurationMs,
      },
      exit: {
        type: template.transitions.exitType,
        durationMs: template.transitions.exitDurationMs,
      },
    };

    // Audio sync
    const audioSyncPoints: AudioSyncPoint[] = (scene.audioSync || []).map(s => ({
      timeMs: s.timeMs,
      type: s.type as AudioSyncPoint['type'],
      intensity: s.intensity,
    }));

    // Source metadata
    const source: SpecSourceMeta = {
      pipelineStages: pipelineCtx.stages.map(s => s.name),
      sceneRole: scene.role,
      mood: intent.mood,
      resolvedCameraPreset: cameraPreset,
      hasBrandAssets: !!(enriched?.assetLayers?.length),
      cinematicApplied: !!cinematic,
      createdAt: new Date().toISOString(),
    };

    const spec: SceneSpec = {
      specVersion: SCENE_SPEC_VERSION,
      sceneId: scene.id,
      renderJobId: pipelineCtx.renderJobId,
      sceneIndex: i,
      totalScenes: storyboard.length,
      templateId: template.id,
      templateCategory: template.category as any,
      aspectRatio,
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      fps,
      durationMs,
      background,
      safeArea: globalSafeArea,
      layers,
      camera,
      transition,
      typography: globalTypography,
      brand: globalBrand,
      audioSyncPoints,
      source,
    };

    // Validate
    const validation = validateSceneSpec(spec);
    validationResults.push({
      sceneId: scene.id,
      valid: validation.valid,
      errors: validation.errors,
      warnings: validation.warnings,
    });

    if (!validation.valid) {
      logger.warn(`[SpecBuilder] Scene ${scene.id} has ${validation.errors.length} spec errors`, {
        errors: validation.errors,
        renderJobId: pipelineCtx.renderJobId,
      });
    }

    scenes.push(spec);
  }

  const totalDurationMs = scenes.reduce((sum, s) => sum + s.durationMs, 0);

  const collection: RenderSpecCollection = {
    renderJobId: pipelineCtx.renderJobId,
    specVersion: SCENE_SPEC_VERSION,
    aspectRatio,
    totalDurationMs,
    scenes,
    globalTypography,
    globalBrand,
    fps,
    createdAt: new Date().toISOString(),
  };

  const totalErrors = validationResults.reduce((s, r) => s + r.errors.length, 0);
  const totalWarnings = validationResults.reduce((s, r) => s + r.warnings.length, 0);
  const validScenes = validationResults.filter(r => r.valid).length;

  logger.info(`[SpecBuilder] Built ${scenes.length} scene specs`, {
    renderJobId: pipelineCtx.renderJobId,
    validScenes,
    totalErrors,
    totalWarnings,
  });

  return {
    collection,
    validationSummary: {
      totalScenes: scenes.length,
      validScenes,
      totalErrors,
      totalWarnings,
      perScene: validationResults,
    },
  };
}
