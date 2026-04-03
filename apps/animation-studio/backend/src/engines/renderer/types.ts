/**
 * Template Execution Engine — Type Definitions
 * ═══════════════════════════════════════════════════════════════════════════════
 * Core types for the internal rendering runtime. Every template, slot, layer,
 * keyframe, and rendered frame is described by these types.
 *
 * Design principles:
 *   - Templates are executable: given data bindings, they deterministically
 *     produce the same visual output every time.
 *   - Slots define spatial/content contracts: position, sizing, overflow, crop.
 *   - Keyframes drive animation: per-property, per-element, eased over time.
 *   - The renderer walks the timeline frame-by-frame, compositing all layers
 *     into pixel buffers that are piped to FFmpeg for clip encoding.
 */

// ═══════════════════════════════════════════════════════════════════════════════
// UNITS & PRIMITIVES
// ═══════════════════════════════════════════════════════════════════════════════

/** All spatial values normalised to 0–1 (fraction of canvas dimension). */
export interface NormRect {
  x: number;      // left edge, 0–1
  y: number;      // top edge, 0–1
  w: number;      // width, 0–1
  h: number;      // height, 0–1
}

/** Pixel-space rectangle (resolved at render time from NormRect + canvas size). */
export interface PxRect {
  x: number; y: number; w: number; h: number;
}

export interface RGBA {
  r: number; g: number; b: number; a: number;
}

export type HexColor = string;   // '#RRGGBB' or '#RRGGBBAA'
export type AspectRatio = '9:16' | '1:1' | '16:9';
export type EasingFn = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out'
  | 'spring' | 'bounce' | 'elastic' | 'cubic-bezier';

// ═══════════════════════════════════════════════════════════════════════════════
// TEMPLATE DEFINITION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * An ExecutableTemplate is the core rendering unit.
 * It defines the visual structure of a single scene: which slots exist,
 * where they go, how they animate, and what constraints they have.
 */
export interface ExecutableTemplate {
  id: string;
  name: string;
  version: number;
  category: TemplateCategory;
  /** Which aspect ratios this template natively supports. */
  supportedAspects: AspectRatio[];
  /** Canvas dimensions per aspect ratio (px). */
  canvasSizes: Record<AspectRatio, { width: number; height: number }>;
  /** Safe area insets (fraction of canvas). Content should stay inside. */
  safeArea: NormRect;
  /** Background definition. */
  background: BackgroundDef;
  /** Ordered list of slots (back-to-front z-order). */
  slots: TemplateSlot[];
  /** Default scene duration in ms. */
  defaultDurationMs: number;
  /** Entry/exit transition defaults. */
  transitions: {
    entryType: TransitionType;
    entryDurationMs: number;
    exitType: TransitionType;
    exitDurationMs: number;
  };
  /** Optional metadata for the template learning system. */
  metadata?: Record<string, unknown>;
}

export type TemplateCategory =
  | 'hook' | 'problem' | 'solution' | 'proof' | 'cta'
  | 'brand_reveal' | 'offer' | 'close' | 'testimonial'
  | 'product_hero' | 'text_overlay' | 'split_screen' | 'fullscreen_media';

// ═══════════════════════════════════════════════════════════════════════════════
// BACKGROUND
// ═══════════════════════════════════════════════════════════════════════════════

export type BackgroundDef =
  | { type: 'solid'; color: HexColor }
  | { type: 'gradient'; stops: Array<{ color: HexColor; position: number }>; angle: number }
  | { type: 'image'; src: string; fit: 'cover' | 'contain' | 'fill'; blur?: number }
  | { type: 'video'; src: string; fit: 'cover' | 'contain' | 'fill' };

// ═══════════════════════════════════════════════════════════════════════════════
// TEMPLATE SLOTS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * A TemplateSlot is a named region in the template that accepts bound data.
 * Slots have deterministic layout rules:
 *   - position: normalised rect (adapts per aspect ratio)
 *   - alignment: how content aligns within the slot
 *   - overflow: what happens when content exceeds the slot
 *   - crop: how images are cropped to fit
 */
export interface TemplateSlot {
  id: string;
  name: string;
  type: SlotType;
  /** Position per aspect ratio. Falls back to first defined if ratio missing. */
  positions: Partial<Record<AspectRatio, NormRect>>;
  /** z-index (higher = on top). */
  zIndex: number;
  /** Alignment of content within the slot bounds. */
  alignment: Alignment;
  /** What happens when content overflows the slot. */
  overflow: OverflowBehavior;
  /** How images are cropped/fitted into the slot. */
  imageFit: ImageFit;
  /** Padding inside the slot (fraction of slot dimensions). */
  padding: { top: number; right: number; bottom: number; left: number };
  /** Whether this slot is required or optional. */
  required: boolean;
  /** Fallback content if no data is bound. */
  fallback?: SlotFallback;
  /** Default style for this slot. */
  style: SlotStyle;
  /** Animation keyframes for this slot (entry, main, exit). */
  animation: SlotAnimation;
  /** Depth layer for parallax/2.5D composition. */
  depthLayer: DepthLayerName;
}

export type SlotType = 'text' | 'image' | 'logo' | 'shape' | 'video' | 'icon' | 'container';

export interface Alignment {
  horizontal: 'left' | 'center' | 'right';
  vertical: 'top' | 'center' | 'bottom';
}

export type OverflowBehavior =
  | 'clip'           // hard clip at slot boundary
  | 'shrink-to-fit'  // reduce font size / scale image to fit
  | 'ellipsis'       // text truncation with '...'
  | 'wrap'           // text wraps within slot
  | 'scroll';        // (reserved for future interactive)

export type ImageFit = 'cover' | 'contain' | 'fill' | 'crop-center' | 'crop-top' | 'crop-face';

export type DepthLayerName = 'background' | 'midground' | 'subject' | 'headline'
  | 'supporting' | 'overlay' | 'vignette';

export interface SlotFallback {
  type: 'text' | 'color' | 'none';
  value?: string;
  color?: HexColor;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SLOT STYLE
// ═══════════════════════════════════════════════════════════════════════════════

export interface SlotStyle {
  /** Text styling (only for text/icon slots). */
  text?: TextStyle;
  /** Background color/gradient for the slot itself. */
  backgroundColor?: HexColor;
  /** Border radius (px). */
  borderRadius?: number;
  /** Box shadow. */
  shadow?: BoxShadow;
  /** Opacity 0–1. */
  opacity?: number;
  /** Blur filter (px). */
  blur?: number;
  /** Brightness multiplier (1 = normal). */
  brightness?: number;
  /** Rotation (degrees). */
  rotation?: number;
}

export interface TextStyle {
  fontFamily: string;
  fontSize: number;        // in px at 1080p reference canvas
  fontWeight: 300 | 400 | 500 | 600 | 700 | 800 | 900;
  color: HexColor;
  lineHeight: number;      // multiplier, e.g. 1.2
  letterSpacing: number;   // px
  textTransform: 'none' | 'uppercase' | 'lowercase' | 'capitalize';
  textAlign: 'left' | 'center' | 'right';
  maxLines?: number;
  /** Minimum font size for shrink-to-fit overflow. */
  minFontSize?: number;
  /** Text stroke/outline. */
  stroke?: { color: HexColor; width: number };
  /** Text shadow. */
  shadow?: { color: HexColor; offsetX: number; offsetY: number; blur: number };
}

export interface BoxShadow {
  color: HexColor;
  offsetX: number;
  offsetY: number;
  blur: number;
  spread: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ANIMATION & KEYFRAMES
// ═══════════════════════════════════════════════════════════════════════════════

export interface SlotAnimation {
  /** Entry animation (plays at scene start). */
  entry: AnimationSequence;
  /** Main loop animation (plays during scene body). */
  main: AnimationSequence;
  /** Exit animation (plays at scene end). */
  exit: AnimationSequence;
}

export interface AnimationSequence {
  keyframes: AnimKeyframe[];
  durationMs: number;
  delayMs: number;
  easing: EasingFn;
  /** For main animation: loop behavior. */
  repeat?: 'once' | 'loop' | 'ping-pong';
}

/**
 * A single keyframe in an animation sequence.
 * All properties are optional — only specified properties are animated.
 * Unspecified properties hold their current value.
 */
export interface AnimKeyframe {
  /** Position in sequence, 0–1 (0 = start, 1 = end). */
  offset: number;
  /** Override easing for this segment. */
  easing?: EasingFn;
  // Transform properties
  x?: number;           // normalised offset from slot position
  y?: number;
  scaleX?: number;      // 1 = 100%
  scaleY?: number;
  rotation?: number;    // degrees
  // Visual properties
  opacity?: number;     // 0–1
  blur?: number;        // px
  brightness?: number;  // multiplier
  // Text-specific
  letterSpacing?: number;
  // Crop/mask (for image reveal animations)
  clipTop?: number;     // 0–1 fraction to clip from top
  clipBottom?: number;
  clipLeft?: number;
  clipRight?: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// TRANSITIONS BETWEEN SCENES
// ═══════════════════════════════════════════════════════════════════════════════

export type TransitionType =
  | 'cut' | 'crossfade' | 'push-left' | 'push-right' | 'push-up' | 'push-down'
  | 'zoom-in' | 'zoom-out' | 'wipe-left' | 'wipe-right' | 'wipe-up' | 'wipe-down'
  | 'dissolve' | 'morph' | 'slide-left' | 'slide-right';

// ═══════════════════════════════════════════════════════════════════════════════
// DATA BINDINGS — what gets bound into a template at render time
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * SceneBindings represent all the data that gets injected into a template
 * to produce a rendered scene. This comes from the orchestrator's planning
 * output + user-provided content.
 */
export interface SceneBindings {
  sceneId: string;
  templateId: string;
  durationMs: number;
  aspectRatio: AspectRatio;
  /** Slot data keyed by slot ID. */
  slots: Record<string, SlotBinding>;
  /** Background override (if different from template default). */
  background?: BackgroundDef;
  /** Camera movement for 2.5D parallax. */
  camera?: CameraBinding;
  /** Brand context for color/font overrides. */
  brand?: BrandBinding;
  /** Audio sync points that may affect animation timing. */
  audioSync?: AudioSyncBinding[];
}

export interface SlotBinding {
  /** Text content (for text slots). */
  text?: string;
  /** Image URL or buffer (for image/logo slots). */
  imageSrc?: string;
  imageBuffer?: Buffer;
  /** Style overrides (merged with template defaults). */
  styleOverrides?: Partial<SlotStyle>;
  /** Animation overrides. */
  animationOverrides?: Partial<SlotAnimation>;
  /** Whether to hide this slot. */
  hidden?: boolean;
}

export interface CameraBinding {
  preset: CameraPreset;
  keyframes: CameraKF[];
  depthScale: number;   // how much parallax to apply (0 = flat, 1 = full)
}

export type CameraPreset = 'push_in' | 'pull_back' | 'horizontal_drift'
  | 'ken_burns' | 'static_lock' | 'rise_up' | 'orbit' | 'crane_down'
  | 'dolly_left' | 'dolly_right';

export interface CameraKF {
  timeMs: number;
  scale: number;
  translateX: number;
  translateY: number;
  rotation: number;
  easing: EasingFn;
}

export interface BrandBinding {
  primaryColor: HexColor;
  secondaryColor: HexColor;
  accentColor: HexColor;
  backgroundColor: HexColor;
  fontFamily?: string;
  logoSrc?: string;
  logoBuffer?: Buffer;
}

export interface AudioSyncBinding {
  timeMs: number;
  type: 'beat' | 'accent' | 'transition' | 'vocal_start' | 'vocal_end';
  intensity: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// RENDERED OUTPUT TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/** A single rendered frame (raw RGBA pixel buffer). */
export interface RenderedFrame {
  frameIndex: number;
  timeMs: number;
  width: number;
  height: number;
  /** Raw RGBA buffer (width * height * 4 bytes). */
  buffer: Buffer;
}

/** Result of rendering a single scene clip. */
export interface SceneClipResult {
  sceneId: string;
  templateId: string;
  /** Path to the encoded video clip file (H.264 MP4). */
  clipPath: string;
  durationMs: number;
  frameCount: number;
  width: number;
  height: number;
  fps: number;
}

/** Result of the full internal render pipeline. */
export interface InternalRenderResult {
  renderJobId: string;
  clips: SceneClipResult[];
  /** Path to the stitched final video (before multi-format export). */
  stitchedPath: string;
  /** Paths per aspect ratio after export. */
  exports: Partial<Record<AspectRatio, string>>;
  /** v27: Path to exported GIF (if exportGif was enabled). */
  gifPath?: string;
  totalDurationMs: number;
  totalFrames: number;
  renderTimeMs: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// RESOLVED FRAME STATE — computed per-frame for each element
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * ResolvedElement is the fully computed state of a slot for a single frame.
 * The frame renderer consumes these to composite the final image.
 */
export interface ResolvedElement {
  slotId: string;
  type: SlotType;
  /** Pixel-space bounds after layout + animation + camera. */
  bounds: PxRect;
  zIndex: number;
  opacity: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  blur: number;
  brightness: number;
  /** Clip rect (0–1 fractions, for reveal/mask animations). */
  clip: { top: number; right: number; bottom: number; left: number };
  /** Resolved text content + style (for text slots). */
  text?: { content: string; style: TextStyle; measuredLines: string[] };
  /** Resolved image data (for image/logo slots). */
  image?: { buffer: Buffer; fit: ImageFit; width: number; height: number };
  /** Resolved shape/background (for shape/container slots). */
  fill?: { color: HexColor; borderRadius: number };
  /** Box shadow. */
  shadow?: BoxShadow;
}

// ═══════════════════════════════════════════════════════════════════════════════
// DEPTH / PARALLAX LAYER CONFIG (matches existing engine contract)
// ═══════════════════════════════════════════════════════════════════════════════

export const DEPTH_FACTORS: Record<DepthLayerName, {
  parallaxFactor: number;
  blurRadius: number;
  scaleReserve: number;
}> = {
  background:  { parallaxFactor: 0.06, blurRadius: 1.2,  scaleReserve: 1.08 },
  midground:   { parallaxFactor: 0.14, blurRadius: 0.4,  scaleReserve: 1.05 },
  subject:     { parallaxFactor: 0.22, blurRadius: 0.0,  scaleReserve: 1.03 },
  headline:    { parallaxFactor: 0.30, blurRadius: 0.0,  scaleReserve: 1.02 },
  supporting:  { parallaxFactor: 0.32, blurRadius: 0.0,  scaleReserve: 1.02 },
  overlay:     { parallaxFactor: 0.36, blurRadius: 0.0,  scaleReserve: 1.01 },
  vignette:    { parallaxFactor: 0.0,  blurRadius: 0.0,  scaleReserve: 1.00 },
};
