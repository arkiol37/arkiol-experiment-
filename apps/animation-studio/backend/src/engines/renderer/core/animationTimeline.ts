/**
 * Animation Timeline Runtime
 * ═══════════════════════════════════════════════════════════════════════════════
 * Resolves the animated state of every slot for every frame in a scene.
 *
 * Pipeline per frame:
 *   1. Determine animation phase (entry → main → exit)
 *   2. Find the two bracketing keyframes for the current time
 *   3. Interpolate all properties with easing
 *   4. Apply camera/parallax offsets based on depth layer
 *   5. Return a ResolvedElement with final pixel-space bounds + visual state
 *
 * This module is pure computation — no I/O, no rendering. It feeds the
 * FrameRenderer with fully computed element states.
 */

import type {
  ExecutableTemplate, TemplateSlot, SceneBindings, SlotBinding,
  AnimKeyframe, AnimationSequence, CameraKF, ResolvedElement,
  PxRect, NormRect, AspectRatio, EasingFn, DepthLayerName,
  TextStyle, SlotStyle, ImageFit,
  DEPTH_FACTORS as DepthFactorsType,
} from '../types';
import { DEPTH_FACTORS } from '../types';
import { applyEasing, lerp, easedLerp } from './easing';

// ═══════════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════════

export interface TimelineConfig {
  fps: number;
  canvasWidth: number;
  canvasHeight: number;
}

/**
 * Resolve the state of all elements for a single frame.
 */
export function resolveFrame(
  template: ExecutableTemplate,
  bindings: SceneBindings,
  frameIndex: number,
  totalFrames: number,
  config: TimelineConfig,
): ResolvedElement[] {
  const timeMs = (frameIndex / config.fps) * 1000;
  const durationMs = bindings.durationMs;

  // Compute camera state for parallax
  const cameraState = bindings.camera
    ? interpolateCamera(bindings.camera.keyframes, timeMs)
    : { scale: 1, translateX: 0, translateY: 0, rotation: 0 };

  const depthScale = bindings.camera?.depthScale ?? 1;

  const elements: ResolvedElement[] = [];

  for (const slot of template.slots) {
    const binding = bindings.slots[slot.id];

    // Skip hidden slots
    if (binding?.hidden) continue;

    // Skip unbound required slots with no fallback
    if (!binding && slot.required && !slot.fallback) continue;

    const resolved = resolveSlot(
      slot, binding, template, bindings, timeMs, durationMs,
      cameraState, depthScale, config,
    );

    if (resolved) elements.push(resolved);
  }

  // Sort by zIndex for correct compositing order
  elements.sort((a, b) => a.zIndex - b.zIndex);

  return elements;
}

/**
 * Resolve total frame count for a scene.
 */
export function computeFrameCount(durationMs: number, fps: number): number {
  return Math.ceil((durationMs / 1000) * fps);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SLOT RESOLUTION
// ═══════════════════════════════════════════════════════════════════════════════

interface CameraState {
  scale: number;
  translateX: number;
  translateY: number;
  rotation: number;
}

function resolveSlot(
  slot: TemplateSlot,
  binding: SlotBinding | undefined,
  template: ExecutableTemplate,
  bindings: SceneBindings,
  timeMs: number,
  durationMs: number,
  camera: CameraState,
  depthScale: number,
  config: TimelineConfig,
): ResolvedElement | null {

  const aspect = bindings.aspectRatio;

  // 1. Get base position for this aspect ratio
  const normPos = slot.positions[aspect]
    || slot.positions['9:16']
    || slot.positions['16:9']
    || slot.positions['1:1']
    || { x: 0, y: 0, w: 1, h: 1 };

  // 2. Resolve animation state
  const anim = resolveAnimationState(slot.animation, binding?.animationOverrides, timeMs, durationMs);

  // 3. Compute pixel bounds with animation offsets
  const baseX = normPos.x + (anim.x ?? 0);
  const baseY = normPos.y + (anim.y ?? 0);
  const sX = anim.scaleX ?? 1;
  const sY = anim.scaleY ?? 1;

  // 4. Apply parallax from camera movement
  const depth = DEPTH_FACTORS[slot.depthLayer] || DEPTH_FACTORS.subject;
  const parallaxX = camera.translateX * depth.parallaxFactor * depthScale;
  const parallaxY = camera.translateY * depth.parallaxFactor * depthScale;
  const parallaxScale = 1 + (camera.scale - 1) * depth.parallaxFactor * depthScale;

  // 5. Convert to pixel space
  const cw = config.canvasWidth;
  const ch = config.canvasHeight;

  const finalX = (baseX + parallaxX) * cw;
  const finalY = (baseY + parallaxY) * ch;
  const finalW = normPos.w * sX * parallaxScale * cw;
  const finalH = normPos.h * sY * parallaxScale * ch;

  // Center the scaling
  const bounds: PxRect = {
    x: finalX - (finalW - normPos.w * cw) / 2,
    y: finalY - (finalH - normPos.h * ch) / 2,
    w: finalW,
    h: finalH,
  };

  // 6. Merge styles
  const style = mergeStyles(slot.style, binding?.styleOverrides);

  // 7. Build resolved element
  const element: ResolvedElement = {
    slotId: slot.id,
    type: slot.type,
    bounds,
    zIndex: slot.zIndex,
    opacity: (anim.opacity ?? 1) * (style.opacity ?? 1),
    rotation: (anim.rotation ?? 0) + (style.rotation ?? 0) + (camera.rotation * depth.parallaxFactor * depthScale),
    scaleX: sX,
    scaleY: sY,
    blur: (anim.blur ?? 0) + (style.blur ?? 0) + (depth.blurRadius * depthScale),
    brightness: (anim.brightness ?? 1) * (style.brightness ?? 1),
    clip: {
      top: anim.clipTop ?? 0,
      right: anim.clipRight ?? 0,
      bottom: anim.clipBottom ?? 0,
      left: anim.clipLeft ?? 0,
    },
  };

  // 8. Type-specific data
  if (slot.type === 'text' || slot.type === 'icon') {
    const textContent = binding?.text ?? slot.fallback?.value ?? '';
    const textStyle = style.text ?? getDefaultTextStyle();
    element.text = {
      content: textContent,
      style: textStyle,
      measuredLines: measureTextLines(textContent, textStyle, bounds.w, slot.overflow),
    };
  }

  if (slot.type === 'image' || slot.type === 'logo') {
    if (binding?.imageBuffer) {
      element.image = {
        buffer: binding.imageBuffer,
        fit: slot.imageFit,
        width: bounds.w,
        height: bounds.h,
      };
    }
  }

  if (slot.type === 'shape' || slot.type === 'container') {
    element.fill = {
      color: style.backgroundColor ?? '#00000000',
      borderRadius: style.borderRadius ?? 0,
    };
  }

  if (style.shadow) {
    element.shadow = style.shadow;
  }

  return element;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ANIMATION STATE RESOLUTION
// ═══════════════════════════════════════════════════════════════════════════════

interface AnimState {
  x?: number; y?: number;
  scaleX?: number; scaleY?: number;
  rotation?: number; opacity?: number;
  blur?: number; brightness?: number;
  letterSpacing?: number;
  clipTop?: number; clipBottom?: number;
  clipLeft?: number; clipRight?: number;
}

function resolveAnimationState(
  animation: TemplateSlot['animation'],
  overrides: Partial<TemplateSlot['animation']> | undefined,
  timeMs: number,
  durationMs: number,
): AnimState {
  const entry = overrides?.entry ?? animation.entry;
  const main = overrides?.main ?? animation.main;
  const exit = overrides?.exit ?? animation.exit;

  const entryEnd = entry.delayMs + entry.durationMs;
  const exitStart = durationMs - exit.durationMs;

  // Determine phase
  if (timeMs < entryEnd) {
    // Entry phase
    const localT = entry.durationMs > 0
      ? Math.max(0, timeMs - entry.delayMs) / entry.durationMs
      : 1;
    return interpolateKeyframes(entry.keyframes, localT, entry.easing);
  }

  if (timeMs >= exitStart && exit.durationMs > 0) {
    // Exit phase
    const localT = (timeMs - exitStart) / exit.durationMs;
    return interpolateKeyframes(exit.keyframes, localT, exit.easing);
  }

  // Main phase
  if (main.keyframes.length === 0) {
    // No main animation — return identity
    return { opacity: 1, scaleX: 1, scaleY: 1 };
  }

  const mainElapsed = timeMs - entryEnd;
  const mainDuration = main.durationMs || (exitStart - entryEnd);

  let localT: number;
  if (main.repeat === 'loop') {
    localT = mainDuration > 0 ? (mainElapsed % mainDuration) / mainDuration : 0;
  } else if (main.repeat === 'ping-pong') {
    const cycle = mainDuration > 0 ? mainElapsed / mainDuration : 0;
    localT = Math.floor(cycle) % 2 === 0
      ? cycle % 1
      : 1 - (cycle % 1);
  } else {
    localT = mainDuration > 0 ? Math.min(1, mainElapsed / mainDuration) : 1;
  }

  return interpolateKeyframes(main.keyframes, localT, main.easing);
}

function interpolateKeyframes(
  keyframes: AnimKeyframe[],
  progress: number,
  defaultEasing: EasingFn,
): AnimState {
  if (keyframes.length === 0) return { opacity: 1, scaleX: 1, scaleY: 1 };
  if (keyframes.length === 1) return extractState(keyframes[0]);

  // Find bracketing keyframes
  let from = keyframes[0];
  let to = keyframes[keyframes.length - 1];

  for (let i = 0; i < keyframes.length - 1; i++) {
    if (progress >= keyframes[i].offset && progress <= keyframes[i + 1].offset) {
      from = keyframes[i];
      to = keyframes[i + 1];
      break;
    }
  }

  // Local progress within this segment
  const segmentRange = to.offset - from.offset;
  const segmentT = segmentRange > 0 ? (progress - from.offset) / segmentRange : 1;
  const easing = to.easing ?? defaultEasing;
  const easedT = applyEasing(segmentT, easing);

  return {
    x: lerpOpt(from.x, to.x, easedT),
    y: lerpOpt(from.y, to.y, easedT),
    scaleX: lerpOpt(from.scaleX, to.scaleX, easedT),
    scaleY: lerpOpt(from.scaleY, to.scaleY, easedT),
    rotation: lerpOpt(from.rotation, to.rotation, easedT),
    opacity: lerpOpt(from.opacity, to.opacity, easedT),
    blur: lerpOpt(from.blur, to.blur, easedT),
    brightness: lerpOpt(from.brightness, to.brightness, easedT),
    letterSpacing: lerpOpt(from.letterSpacing, to.letterSpacing, easedT),
    clipTop: lerpOpt(from.clipTop, to.clipTop, easedT),
    clipBottom: lerpOpt(from.clipBottom, to.clipBottom, easedT),
    clipLeft: lerpOpt(from.clipLeft, to.clipLeft, easedT),
    clipRight: lerpOpt(from.clipRight, to.clipRight, easedT),
  };
}

function extractState(kf: AnimKeyframe): AnimState {
  return {
    x: kf.x, y: kf.y,
    scaleX: kf.scaleX, scaleY: kf.scaleY,
    rotation: kf.rotation, opacity: kf.opacity,
    blur: kf.blur, brightness: kf.brightness,
    letterSpacing: kf.letterSpacing,
    clipTop: kf.clipTop, clipBottom: kf.clipBottom,
    clipLeft: kf.clipLeft, clipRight: kf.clipRight,
  };
}

function lerpOpt(a: number | undefined, b: number | undefined, t: number): number | undefined {
  if (a === undefined && b === undefined) return undefined;
  return lerp(a ?? b!, b ?? a!, t);
}

// ═══════════════════════════════════════════════════════════════════════════════
// CAMERA INTERPOLATION
// ═══════════════════════════════════════════════════════════════════════════════

function interpolateCamera(keyframes: CameraKF[], timeMs: number): CameraState {
  if (keyframes.length === 0) return { scale: 1, translateX: 0, translateY: 0, rotation: 0 };
  if (keyframes.length === 1) {
    const kf = keyframes[0];
    return { scale: kf.scale, translateX: kf.translateX, translateY: kf.translateY, rotation: kf.rotation };
  }

  // Find bracketing keyframes
  let from = keyframes[0];
  let to = keyframes[keyframes.length - 1];

  for (let i = 0; i < keyframes.length - 1; i++) {
    if (timeMs >= keyframes[i].timeMs && timeMs <= keyframes[i + 1].timeMs) {
      from = keyframes[i];
      to = keyframes[i + 1];
      break;
    }
  }

  const range = to.timeMs - from.timeMs;
  const localT = range > 0 ? (timeMs - from.timeMs) / range : 1;
  const easedT = applyEasing(localT, to.easing);

  return {
    scale: lerp(from.scale, to.scale, easedT),
    translateX: lerp(from.translateX, to.translateX, easedT),
    translateY: lerp(from.translateY, to.translateY, easedT),
    rotation: lerp(from.rotation, to.rotation, easedT),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEXT MEASUREMENT (simplified — full measurement done by canvas at render)
// ═══════════════════════════════════════════════════════════════════════════════

function measureTextLines(
  text: string,
  style: TextStyle,
  maxWidthPx: number,
  overflow: string,
): string[] {
  if (!text) return [];

  // Apply text transform
  let transformed = text;
  if (style.textTransform === 'uppercase') transformed = text.toUpperCase();
  if (style.textTransform === 'lowercase') transformed = text.toLowerCase();
  if (style.textTransform === 'capitalize') {
    transformed = text.replace(/\b\w/g, c => c.toUpperCase());
  }

  // Rough character-based line breaking (actual pixel measurement in FrameRenderer)
  const avgCharWidth = style.fontSize * 0.55;
  const charsPerLine = Math.max(1, Math.floor(maxWidthPx / avgCharWidth));

  if (overflow === 'clip' || overflow === 'ellipsis') {
    const maxLines = style.maxLines ?? 1;
    const lines: string[] = [];
    const words = transformed.split(/\s+/);
    let currentLine = '';

    for (const word of words) {
      const test = currentLine ? `${currentLine} ${word}` : word;
      if (test.length > charsPerLine && currentLine) {
        lines.push(currentLine);
        currentLine = word;
        if (lines.length >= maxLines) break;
      } else {
        currentLine = test;
      }
    }
    if (currentLine && lines.length < maxLines) lines.push(currentLine);

    if (overflow === 'ellipsis' && lines.length >= maxLines && words.length > 0) {
      const last = lines[lines.length - 1];
      if (last.length > charsPerLine - 3) {
        lines[lines.length - 1] = last.substring(0, charsPerLine - 3) + '...';
      }
    }

    return lines;
  }

  // Wrap mode
  const lines: string[] = [];
  const words = transformed.split(/\s+/);
  let currentLine = '';

  for (const word of words) {
    const test = currentLine ? `${currentLine} ${word}` : word;
    if (test.length > charsPerLine && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = test;
    }
  }
  if (currentLine) lines.push(currentLine);

  return lines;
}

// ═══════════════════════════════════════════════════════════════════════════════
// STYLE MERGE
// ═══════════════════════════════════════════════════════════════════════════════

function mergeStyles(base: SlotStyle, overrides?: Partial<SlotStyle>): SlotStyle {
  if (!overrides) return base;
  return {
    ...base,
    ...overrides,
    text: overrides.text ? { ...base.text!, ...overrides.text } : base.text,
  };
}

function getDefaultTextStyle(): TextStyle {
  return {
    fontFamily: 'Inter',
    fontSize: 48,
    fontWeight: 700,
    color: '#FFFFFF',
    lineHeight: 1.2,
    letterSpacing: 0,
    textTransform: 'none',
    textAlign: 'center',
  };
}
