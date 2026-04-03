/**
 * Scene Specification Schema
 * ═══════════════════════════════════════════════════════════════════════════════
 * A SceneSpec is the canonical, strictly-typed, fully-resolved intermediate
 * representation that the Integration Bridge produces from orchestrator output
 * and which the Template Execution Engine consumes to render frames.
 *
 * Design contract:
 *   - Every field must be resolvable at bridge time — no lazy/nullable planning data.
 *   - The spec is self-contained: given a SceneSpec + loaded assets, a renderer
 *     must produce the same visual output every time (deterministic).
 *   - Spec versioning ensures backward compat as the schema evolves.
 *
 * Data flow:
 *   OrchestratorOutput → IntegrationBridge → SceneSpec[] → TemplateExecutionEngine
 */

import type {
  AspectRatio, BackgroundDef, HexColor, EasingFn,
  TransitionType, DepthLayerName, ImageFit, OverflowBehavior,
} from '../types';

// ═══════════════════════════════════════════════════════════════════════════════
// SPEC VERSION
// ═══════════════════════════════════════════════════════════════════════════════

export const SCENE_SPEC_VERSION = 1;

// ═══════════════════════════════════════════════════════════════════════════════
// ROOT SCENE SPEC
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * The complete, executable specification for a single rendered scene.
 * Produced once by the Integration Bridge and consumed by the TEE.
 */
export interface SceneSpec {
  /** Schema version for forward/backward compatibility. */
  specVersion: typeof SCENE_SPEC_VERSION;

  // Identity
  sceneId: string;
  renderJobId: string;
  sceneIndex: number;        // 0-based position in the ad
  totalScenes: number;

  // Template selection
  templateId: string;
  templateCategory: TemplateCategory;

  // Canvas
  aspectRatio: AspectRatio;
  canvasWidth: number;       // px
  canvasHeight: number;      // px
  fps: number;

  // Duration
  durationMs: number;

  // Background
  background: BackgroundDef;

  // Safe area (normalised 0–1 insets — content must stay within)
  safeArea: SafeAreaSpec;

  // Layer hierarchy — ordered back-to-front
  layers: LayerSpec[];

  // Camera / parallax plan
  camera: CameraSpec;

  // Scene-level animation: entry/exit transitions
  transition: TransitionSpec;

  // Typography override (brand fonts applied globally to this scene)
  typography?: TypographySpec;

  // Brand context baked in
  brand: BrandSpec;

  // Audio sync points that drive animation triggers
  audioSyncPoints: AudioSyncPoint[];

  // Source metadata (debug/learning — not used by renderer)
  source: SpecSourceMeta;
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEMPLATE CATEGORIES
// ═══════════════════════════════════════════════════════════════════════════════

export type TemplateCategory =
  | 'hook' | 'problem' | 'solution' | 'proof' | 'cta'
  | 'brand_reveal' | 'offer' | 'close' | 'testimonial'
  | 'product_hero' | 'text_overlay' | 'split_screen' | 'fullscreen_media';

// ═══════════════════════════════════════════════════════════════════════════════
// SAFE AREA
// ═══════════════════════════════════════════════════════════════════════════════

export interface SafeAreaSpec {
  /** Inner safe rectangle — normalised 0–1 fractions from canvas edges. */
  top: number;
  right: number;
  bottom: number;
  left: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// LAYER SPEC — one entry per visual element
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * A LayerSpec fully describes one visual element in the scene.
 * Layers are ordered back-to-front (index 0 = farthest back).
 */
export interface LayerSpec {
  /** Matches a TemplateSlot.id */
  slotId: string;
  slotName: string;
  type: LayerType;

  // Z-order (higher = on top; must match back-to-front array order)
  zIndex: number;

  // Depth / parallax
  depthLayer: DepthLayerName;

  // Layout — resolved position per aspect ratio
  layout: LayerLayout;

  // Content binding
  content: LayerContent;

  // Visual style overrides (merged on top of template defaults)
  style: LayerStyle;

  // Animation definition for this layer
  animation: LayerAnimation;

  // Whether to render this layer
  visible: boolean;
}

export type LayerType = 'text' | 'image' | 'logo' | 'shape' | 'video' | 'icon' | 'container';

// ── Layout ───────────────────────────────────────────────────────────────────

/**
 * Fully resolved layout for a layer.
 * All positions are normalised 0–1 fractions of the canvas.
 */
export interface LayerLayout {
  /** Normalised position rect. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Padding inside the layer rect (normalised fractions of layer dims). */
  paddingTop: number;
  paddingRight: number;
  paddingBottom: number;
  paddingLeft: number;
  /** Alignment of content within the layer bounds. */
  alignH: 'left' | 'center' | 'right';
  alignV: 'top' | 'center' | 'bottom';
  /** Overflow behaviour for content that exceeds the layer bounds. */
  overflow: OverflowBehavior;
  /** How images/videos are fitted into the layer bounds. */
  imageFit: ImageFit;
  /** True if content must be clipped to safeArea. */
  enforceSafeArea: boolean;
}

// ── Content ──────────────────────────────────────────────────────────────────

/** The actual data bound into the layer. Exactly one of these will be set. */
export type LayerContent =
  | TextLayerContent
  | ImageLayerContent
  | LogoLayerContent
  | ShapeLayerContent
  | VideoLayerContent
  | EmptyLayerContent;

export interface TextLayerContent {
  type: 'text';
  text: string;
  /** Fallback text if `text` is empty. */
  fallback: string;
  /** Apply text transform before rendering. */
  transform: 'none' | 'uppercase' | 'lowercase' | 'capitalize';
}

export interface ImageLayerContent {
  type: 'image';
  /** CDN URL or local path. */
  src: string;
  /** Alt text (for logging/debugging). */
  alt?: string;
  /** If true, load failure uses fallback colour instead of throwing. */
  graceful: boolean;
  fallbackColor: HexColor;
}

export interface LogoLayerContent {
  type: 'logo';
  src: string;
  /** Whether to remove background (if pre-processed). */
  bgRemoved: boolean;
  fallbackColor: HexColor;
}

export interface ShapeLayerContent {
  type: 'shape';
  fill: HexColor;
  borderRadius: number; // px
}

export interface VideoLayerContent {
  type: 'video';
  src: string;
  loop: boolean;
  muted: boolean;
  startSec: number;
}

export interface EmptyLayerContent {
  type: 'empty';
}

// ── Style ────────────────────────────────────────────────────────────────────

export interface LayerStyle {
  /** Text typography (for text/icon layers). */
  text?: TextStyleSpec;
  /** Background colour behind the layer content. */
  backgroundColor?: HexColor;
  /** Opacity 0–1. */
  opacity: number;
  /** Gaussian blur (px). 0 = none. */
  blur: number;
  /** Brightness multiplier (1.0 = unchanged). */
  brightness: number;
  /** Clockwise rotation in degrees. */
  rotation: number;
  /** Border radius (px) for shape/container layers. */
  borderRadius: number;
  /** Drop shadow. */
  shadow?: ShadowSpec;
}

export interface TextStyleSpec {
  fontFamily: string;
  fontSize: number;         // px at 1080p reference canvas
  fontWeight: 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900;
  color: HexColor;
  lineHeight: number;       // multiplier, e.g. 1.2
  letterSpacing: number;    // px
  textAlign: 'left' | 'center' | 'right';
  maxLines: number;         // 0 = unlimited
  minFontSize: number;      // for shrink-to-fit overflow
  stroke?: { color: HexColor; width: number };
  shadow?: { color: HexColor; offsetX: number; offsetY: number; blur: number };
}

export interface ShadowSpec {
  color: HexColor;
  offsetX: number;
  offsetY: number;
  blur: number;
  spread: number;
}

// ── Animation ────────────────────────────────────────────────────────────────

/**
 * Complete animation definition for a single layer.
 * Consists of entry, main loop, and exit phases.
 * Each phase has a keyframe list that the timeline runtime interpolates.
 */
export interface LayerAnimation {
  entry: AnimPhase;
  main: AnimPhase;
  exit: AnimPhase;
}

export interface AnimPhase {
  /** Delay before this phase starts (ms from scene start or phase start). */
  delayMs: number;
  /** Duration of this phase (ms). */
  durationMs: number;
  /** Default easing for keyframe interpolation. */
  easing: EasingFn;
  /** For main phase: whether to loop/ping-pong. */
  repeat: 'once' | 'loop' | 'ping-pong';
  /** Ordered keyframes (offset 0–1 within this phase). */
  keyframes: AnimKeyframeSpec[];
}

/**
 * A single keyframe within an animation phase.
 * All properties are optional — only specified ones are animated.
 */
export interface AnimKeyframeSpec {
  /** Position within the phase (0 = start, 1 = end). */
  offset: number;
  /** Per-segment easing override. */
  easing?: EasingFn;
  // Transform
  translateX?: number;   // normalised canvas fraction
  translateY?: number;
  scaleX?: number;
  scaleY?: number;
  rotation?: number;     // degrees
  // Visual
  opacity?: number;      // 0–1
  blur?: number;         // px
  brightness?: number;   // multiplier
  // Clip reveal (0–1 fraction clipped from that edge)
  clipTop?: number;
  clipBottom?: number;
  clipLeft?: number;
  clipRight?: number;
  // Text
  letterSpacing?: number;
}

// ── Camera ───────────────────────────────────────────────────────────────────

export interface CameraSpec {
  /** Named preset from the cinematic direction system. */
  preset: string;
  /** How strongly depth layers respond to camera movement (0=flat, 1=full). */
  depthScale: number;
  /** Explicit keyframes (override preset if provided). */
  keyframes: CameraKeyframeSpec[];
}

export interface CameraKeyframeSpec {
  timeMs: number;
  scale: number;
  translateX: number;  // normalised canvas fraction
  translateY: number;
  rotation: number;    // degrees
  easing: EasingFn;
}

// ── Transitions ──────────────────────────────────────────────────────────────

export interface TransitionSpec {
  /** Scene entry transition (from previous scene). */
  entry: {
    type: TransitionType;
    durationMs: number;
  };
  /** Scene exit transition (to next scene). */
  exit: {
    type: TransitionType;
    durationMs: number;
  };
}

// ── Typography ───────────────────────────────────────────────────────────────

export interface TypographySpec {
  /** Primary brand font for headlines. */
  headlineFont: string;
  /** Secondary font for body copy. */
  bodyFont: string;
  /** Whether fonts need to be loaded from a remote CDN. */
  requiresRemoteFonts: boolean;
  fontUrls: Array<{ family: string; url: string; weight?: number }>;
}

// ── Brand ────────────────────────────────────────────────────────────────────

export interface BrandSpec {
  primaryColor: HexColor;
  secondaryColor: HexColor;
  accentColor: HexColor;
  backgroundColor: HexColor;
  logoSrc?: string;
  logoIsTransparent: boolean;
}

// ── Audio sync ───────────────────────────────────────────────────────────────

export interface AudioSyncPoint {
  timeMs: number;
  type: 'beat' | 'accent' | 'transition' | 'vocal_start' | 'vocal_end';
  /** Normalised intensity 0–1. Used to scale animation magnitude. */
  intensity: number;
}

// ── Source metadata ──────────────────────────────────────────────────────────

/** Traceability — which orchestrator data produced this spec. */
export interface SpecSourceMeta {
  /** Which orchestrator stages produced the source data. */
  pipelineStages: string[];
  /** Storyboard scene role. */
  sceneRole: string;
  /** Mood used for background/style selection. */
  mood: string;
  /** Camera preset name resolved by cinematicDirectionEngine. */
  resolvedCameraPreset: string;
  /** Whether brand assets were available and injected. */
  hasBrandAssets: boolean;
  /** Whether cinematic motion descriptors were applied. */
  cinematicApplied: boolean;
  /** Timestamp of spec creation (ISO string). */
  createdAt: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SPEC COLLECTION
// ═══════════════════════════════════════════════════════════════════════════════

/** All scene specs for a single render job. */
export interface RenderSpecCollection {
  renderJobId: string;
  specVersion: typeof SCENE_SPEC_VERSION;
  aspectRatio: AspectRatio;
  totalDurationMs: number;
  scenes: SceneSpec[];
  globalTypography?: TypographySpec;
  globalBrand: BrandSpec;
  fps: number;
  createdAt: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// VALIDATION
// ═══════════════════════════════════════════════════════════════════════════════

export interface SpecValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate a SceneSpec for structural completeness.
 * Catches missing required fields, out-of-range values, and logic errors.
 */
export function validateSceneSpec(spec: SceneSpec): SpecValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!spec.sceneId) errors.push('Missing sceneId');
  if (!spec.renderJobId) errors.push('Missing renderJobId');
  if (!spec.templateId) errors.push('Missing templateId');
  if (spec.durationMs <= 0) errors.push(`Invalid durationMs: ${spec.durationMs}`);
  if (spec.canvasWidth <= 0 || spec.canvasHeight <= 0) {
    errors.push(`Invalid canvas dimensions: ${spec.canvasWidth}x${spec.canvasHeight}`);
  }
  if (!['9:16', '1:1', '16:9'].includes(spec.aspectRatio)) {
    errors.push(`Unsupported aspectRatio: ${spec.aspectRatio}`);
  }
  if (spec.layers.length === 0) {
    warnings.push('Scene has no layers — will render only background');
  }

  // Validate each layer
  for (const layer of spec.layers) {
    if (!layer.slotId) errors.push('Layer missing slotId');
    if (layer.zIndex < 0) warnings.push(`Negative zIndex on ${layer.slotId}`);

    // Layout range checks
    const { x, y, width, height } = layer.layout;
    if (x < -1 || x > 2 || y < -1 || y > 2) {
      warnings.push(`Layer ${layer.slotId} position out of expected range: (${x}, ${y})`);
    }
    if (width <= 0 || height <= 0) {
      errors.push(`Layer ${layer.slotId} has zero/negative dimensions`);
    }

    // Safe area check for text layers
    if (layer.type === 'text' && layer.layout.enforceSafeArea) {
      const sa = spec.safeArea;
      if (x < sa.left || (x + width) > (1 - sa.right)
        || y < sa.top || (y + height) > (1 - sa.bottom)) {
        warnings.push(`Text layer ${layer.slotId} extends outside safe area`);
      }
    }

    // Content type/layer type mismatch
    if (layer.type !== layer.content.type && layer.content.type !== 'empty') {
      warnings.push(`Layer ${layer.slotId} type "${layer.type}" vs content type "${layer.content.type}"`);
    }

    // Animation keyframe offsets must be 0–1
    for (const phase of ['entry', 'main', 'exit'] as const) {
      const ph = layer.animation[phase];
      for (const kf of ph.keyframes) {
        if (kf.offset < 0 || kf.offset > 1) {
          errors.push(`Layer ${layer.slotId} ${phase} keyframe offset ${kf.offset} out of [0,1]`);
        }
      }
    }
  }

  // Camera spec
  if (spec.camera.keyframes.length < 2 && spec.camera.keyframes.length !== 0) {
    warnings.push('Camera has only 1 keyframe — consider adding a second for motion');
  }

  return { valid: errors.length === 0, errors, warnings };
}
