/**
 * Layout / Constraint Engine
 * ═══════════════════════════════════════════════════════════════════════════════
 * Resolves all visual geometry deterministically before rendering begins.
 *
 * Responsibilities:
 *   1. Convert normalised slot positions to pixel-space rects for the target
 *      canvas size and aspect ratio.
 *   2. Enforce safe-area constraints — text layers that bleed outside the safe
 *      zone are clamped inward (never silently overflowed).
 *   3. Shrink-to-fit: compute the largest font size that makes text fit inside
 *      its slot without clipping, down to minFontSize.
 *   4. Multi-aspect layout adaptation: derive 1:1 and 16:9 positions from a
 *      9:16 "master" definition when explicit per-ratio positions are absent.
 *   5. Layer conflict detection: warn when two same-depth layers overlap
 *      significantly (potential occlusion).
 *   6. Z-order consistency: ensure zIndex order matches the layer array order.
 *
 * The engine is called once per scene (before animation begins) to produce a
 * ResolvedLayout that the animation timeline uses as its geometric baseline.
 *
 * Pure computation — no I/O, no Sharp, no side effects.
 */

import type {
  ExecutableTemplate, TemplateSlot, SceneBindings,
  NormRect, PxRect, AspectRatio, TextStyle, OverflowBehavior,
} from '../types';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface ResolvedLayout {
  canvasWidth: number;
  canvasHeight: number;
  aspectRatio: AspectRatio;
  /** Safe area as pixel insets. */
  safeArea: SafeAreaPx;
  /** Per-slot resolved geometry. */
  slots: Map<string, ResolvedSlotGeometry>;
  /** Any constraint violations detected. */
  violations: ConstraintViolation[];
}

export interface SafeAreaPx {
  top: number;
  right: number;
  bottom: number;
  left: number;
  /** The inner safe rect. */
  inner: PxRect;
}

export interface ResolvedSlotGeometry {
  slotId: string;
  /** Base rect (without animation offsets). */
  baseBounds: PxRect;
  /** Padding insets in px. */
  paddingPx: { top: number; right: number; bottom: number; left: number };
  /** Inner content rect (baseBounds shrunk by padding). */
  contentRect: PxRect;
  /** Whether this slot's base bounds are within the safe area. */
  withinSafeArea: boolean;
  /** Clamped bounds (if slot was adjusted for safe area). */
  clampedBounds: PxRect;
  /** For text slots: resolved font size after shrink-to-fit. */
  resolvedFontSize?: number;
  /** For text slots: estimated line count at resolved font size. */
  estimatedLineCount?: number;
}

export interface ConstraintViolation {
  severity: 'warning' | 'error';
  slotId: string;
  code: string;
  message: string;
  /** Suggested fix (applied automatically if autoFix=true). */
  fix?: string;
}

export interface ConstraintEngineOptions {
  /**
   * Automatically clamp violating slots into the safe area.
   * Default: true.
   */
  autoFixSafeArea?: boolean;
  /**
   * Automatically compute shrink-to-fit font sizes.
   * Default: true.
   */
  autoShrinkText?: boolean;
  /**
   * Warn when two layers overlap by more than this fraction (0–1).
   * Default: 0.7 (70% overlap = warning).
   */
  overlapWarnThreshold?: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CANVAS SIZE MAP (matches ExecutableTemplate.canvasSizes)
// ═══════════════════════════════════════════════════════════════════════════════

const CANVAS_SIZES: Record<AspectRatio, { width: number; height: number }> = {
  '9:16': { width: 1080, height: 1920 },
  '1:1':  { width: 1080, height: 1080 },
  '16:9': { width: 1920, height: 1080 },
};

// ═══════════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Resolve the full layout for a scene.
 * Call this once before rendering the first frame.
 */
export function resolveLayout(
  template: ExecutableTemplate,
  bindings: SceneBindings,
  options: ConstraintEngineOptions = {},
): ResolvedLayout {
  const {
    autoFixSafeArea = true,
    autoShrinkText = true,
    overlapWarnThreshold = 0.7,
  } = options;

  const aspect = bindings.aspectRatio;
  const canvas = template.canvasSizes[aspect] || CANVAS_SIZES[aspect];
  const { width: cw, height: ch } = canvas;

  // Safe area in px
  const sa = template.safeArea;
  const safeArea: SafeAreaPx = {
    top:    Math.round(sa.y * ch),
    left:   Math.round(sa.x * cw),
    right:  Math.round((1 - sa.x - sa.w) * cw),
    bottom: Math.round((1 - sa.y - sa.h) * ch),
    inner: {
      x: Math.round(sa.x * cw),
      y: Math.round(sa.y * ch),
      w: Math.round(sa.w * cw),
      h: Math.round(sa.h * ch),
    },
  };

  const violations: ConstraintViolation[] = [];
  const slots = new Map<string, ResolvedSlotGeometry>();

  // Resolve each slot
  for (const slot of template.slots) {
    const binding = bindings.slots[slot.id];

    // Skip hidden slots
    if (binding?.hidden) continue;

    // Get normalised position for this aspect ratio
    const normPos = resolveNormPos(slot, aspect);
    const baseBounds = normToPx(normPos, cw, ch);

    // Padding in px
    const p = slot.padding;
    const paddingPx = {
      top:    Math.round(p.top    * baseBounds.h),
      right:  Math.round(p.right  * baseBounds.w),
      bottom: Math.round(p.bottom * baseBounds.h),
      left:   Math.round(p.left   * baseBounds.w),
    };

    const contentRect: PxRect = {
      x: baseBounds.x + paddingPx.left,
      y: baseBounds.y + paddingPx.top,
      w: Math.max(1, baseBounds.w - paddingPx.left - paddingPx.right),
      h: Math.max(1, baseBounds.h - paddingPx.top - paddingPx.bottom),
    };

    // Safe area check
    const withinSafeArea = isWithinSafeArea(baseBounds, safeArea.inner);
    let clampedBounds = { ...baseBounds };

    if (!withinSafeArea && (slot.type === 'text' || slot.type === 'icon')) {
      const v: ConstraintViolation = {
        severity: 'warning',
        slotId: slot.id,
        code: 'SAFE_AREA_VIOLATION',
        message: `Text slot "${slot.name}" extends outside safe area`,
        fix: 'Clamped to safe area boundary',
      };
      violations.push(v);

      if (autoFixSafeArea) {
        clampedBounds = clampToSafeArea(baseBounds, safeArea.inner);
      }
    }

    // Zero/negative dimensions check
    if (baseBounds.w <= 0 || baseBounds.h <= 0) {
      violations.push({
        severity: 'error',
        slotId: slot.id,
        code: 'ZERO_DIMENSIONS',
        message: `Slot "${slot.name}" has zero or negative dimensions (${baseBounds.w}x${baseBounds.h})`,
      });
    }

    // Shrink-to-fit computation
    let resolvedFontSize: number | undefined;
    let estimatedLineCount: number | undefined;

    if (autoShrinkText && slot.type === 'text' && slot.overflow === 'shrink-to-fit') {
      const textContent = binding?.text || slot.fallback?.value || '';
      const baseStyle = slot.style.text;

      if (textContent && baseStyle) {
        const result = computeShrinkToFit(
          textContent,
          baseStyle,
          contentRect.w,
          contentRect.h,
        );
        resolvedFontSize = result.fontSize;
        estimatedLineCount = result.lineCount;

        if (result.fontSize < (baseStyle.minFontSize ?? 12)) {
          violations.push({
            severity: 'warning',
            slotId: slot.id,
            code: 'TEXT_OVERFLOW',
            message: `Text in "${slot.name}" overflows even at minFontSize — may be clipped`,
          });
        }
      }
    }

    slots.set(slot.id, {
      slotId: slot.id,
      baseBounds,
      paddingPx,
      contentRect,
      withinSafeArea,
      clampedBounds,
      resolvedFontSize,
      estimatedLineCount,
    });
  }

  // Overlap detection (warn only — don't reposition)
  if (overlapWarnThreshold < 1) {
    const slotEntries = [...slots.entries()];
    for (let i = 0; i < slotEntries.length; i++) {
      for (let j = i + 1; j < slotEntries.length; j++) {
        const [idA, geoA] = slotEntries[i];
        const [idB, geoB] = slotEntries[j];

        const slotA = template.slots.find(s => s.id === idA);
        const slotB = template.slots.find(s => s.id === idB);

        // Only warn when same depth layer and z-index are close
        if (slotA && slotB && slotA.depthLayer === slotB.depthLayer) {
          const overlapFraction = computeOverlapFraction(
            geoA.clampedBounds,
            geoB.clampedBounds,
          );
          if (overlapFraction > overlapWarnThreshold) {
            violations.push({
              severity: 'warning',
              slotId: idA,
              code: 'LAYER_OVERLAP',
              message: `Slots "${idA}" and "${idB}" overlap by ${Math.round(overlapFraction * 100)}% at depth "${slotA.depthLayer}"`,
            });
          }
        }
      }
    }
  }

  // Z-order consistency check
  const slotsSorted = template.slots
    .filter(s => slots.has(s.id))
    .sort((a, b) => a.zIndex - b.zIndex);

  for (let i = 0; i < slotsSorted.length - 1; i++) {
    if (slotsSorted[i].zIndex === slotsSorted[i + 1].zIndex) {
      violations.push({
        severity: 'warning',
        slotId: slotsSorted[i].id,
        code: 'Z_INDEX_TIE',
        message: `Slots "${slotsSorted[i].id}" and "${slotsSorted[i + 1].id}" share zIndex ${slotsSorted[i].zIndex} — rendering order is deterministic but may not match intent`,
      });
    }
  }

  return {
    canvasWidth: cw,
    canvasHeight: ch,
    aspectRatio: aspect,
    safeArea,
    slots,
    violations,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// ASPECT RATIO ADAPTATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get the normalised position for a slot given a target aspect ratio.
 * Falls back to intelligent derivation if the exact ratio isn't defined.
 */
export function resolveNormPos(slot: TemplateSlot, aspect: AspectRatio): NormRect {
  // Direct match
  if (slot.positions[aspect]) return slot.positions[aspect]!;

  // Derive from available positions
  const available = Object.keys(slot.positions) as AspectRatio[];
  if (available.length === 0) return { x: 0, y: 0, w: 1, h: 1 };

  // Prefer 9:16 as master source
  const master = slot.positions['9:16'] || slot.positions[available[0]]!;

  switch (aspect) {
    case '1:1':
      return deriveSquareFrom916(master);
    case '16:9':
      return deriveLandscapeFrom916(master);
    case '9:16':
      return master;
    default:
      return master;
  }
}

/**
 * Derive a 1:1 position from a 9:16 master.
 * Strategy: compress vertically, maintain horizontal proportions.
 */
function deriveSquareFrom916(src: NormRect): NormRect {
  // 9:16 → 1:1: height compression factor = 9/16 ≈ 0.5625
  // We shift y to keep elements visually centred
  const yScale = 9 / 16;
  const yOffset = (1 - yScale) / 2; // centres the 9:16 content in 1:1

  return {
    x: src.x,
    y: Math.max(0, src.y * yScale + yOffset),
    w: src.w,
    h: Math.min(src.h * yScale, 1 - (src.y * yScale + yOffset)),
  };
}

/**
 * Derive a 16:9 position from a 9:16 master.
 * Strategy: expand horizontally, compress vertically, letterbox-style centering.
 */
function deriveLandscapeFrom916(src: NormRect): NormRect {
  const yScale = 9 / 16;
  const xScale = 16 / 9;

  // Center the 9:16 content in 16:9
  const xOffset = (1 - 1 / xScale) / 2;
  const yOffset = (1 - yScale) / 2;

  return {
    x: Math.max(0, src.x / xScale + xOffset),
    y: Math.max(0, src.y * yScale + yOffset),
    w: Math.min(src.w / xScale, 1 - (src.x / xScale + xOffset)),
    h: Math.min(src.h * yScale, 1 - (src.y * yScale + yOffset)),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// GEOMETRY UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

/** Convert a normalised rect to pixel space. */
export function normToPx(norm: NormRect, cw: number, ch: number): PxRect {
  return {
    x: Math.round(norm.x * cw),
    y: Math.round(norm.y * ch),
    w: Math.max(1, Math.round(norm.w * cw)),
    h: Math.max(1, Math.round(norm.h * ch)),
  };
}

/** Convert a pixel rect to normalised space. */
export function pxToNorm(px: PxRect, cw: number, ch: number): NormRect {
  return {
    x: px.x / cw,
    y: px.y / ch,
    w: px.w / cw,
    h: px.h / ch,
  };
}

/** Test whether a rect is fully within the safe area. */
function isWithinSafeArea(rect: PxRect, safeInner: PxRect): boolean {
  return (
    rect.x >= safeInner.x &&
    rect.y >= safeInner.y &&
    rect.x + rect.w <= safeInner.x + safeInner.w &&
    rect.y + rect.h <= safeInner.y + safeInner.h
  );
}

/** Clamp a rect to fit within the safe area. */
function clampToSafeArea(rect: PxRect, safeInner: PxRect): PxRect {
  const x = Math.max(rect.x, safeInner.x);
  const y = Math.max(rect.y, safeInner.y);
  const maxRight = safeInner.x + safeInner.w;
  const maxBottom = safeInner.y + safeInner.h;
  const w = Math.min(rect.w, maxRight - x);
  const h = Math.min(rect.h, maxBottom - y);
  return { x, y, w: Math.max(1, w), h: Math.max(1, h) };
}

/**
 * Compute the fractional overlap between two rects.
 * Returns the area of intersection / area of the smaller rect.
 */
function computeOverlapFraction(a: PxRect, b: PxRect): number {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const intersection = ix * iy;
  if (intersection === 0) return 0;
  const areaA = a.w * a.h;
  const areaB = b.w * b.h;
  return intersection / Math.min(areaA, areaB);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SHRINK-TO-FIT SOLVER
// ═══════════════════════════════════════════════════════════════════════════════

interface ShrinkResult {
  fontSize: number;
  lineCount: number;
  fits: boolean;
}

/**
 * Binary-search for the largest font size that fits text in the given area.
 *
 * v27 upgrade: includes word-break fallback when even minFontSize doesn't fit.
 * Uses an approximation: average char width = fontSize × 0.55,
 * line height = fontSize × lineHeightMultiplier.
 */
export function computeShrinkToFit(
  text: string,
  style: TextStyle,
  maxWidthPx: number,
  maxHeightPx: number,
): ShrinkResult {
  const minFontSize = style.minFontSize ?? 12;
  const maxFontSize = style.fontSize;
  const lineHeightMult = style.lineHeight ?? 1.2;
  const maxLines = style.maxLines ?? Infinity;

  let lo = minFontSize;
  let hi = maxFontSize;
  let bestFit: ShrinkResult = { fontSize: minFontSize, lineCount: 1, fits: false };

  // Binary search over font size
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const result = measureTextFit(text, mid, lineHeightMult, maxWidthPx, maxHeightPx, maxLines);

    if (result.fits) {
      bestFit = { fontSize: mid, lineCount: result.lineCount, fits: true };
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  // v27: if text doesn't fit even at minFontSize, try word-break splitting
  if (!bestFit.fits) {
    const wordBreakResult = measureTextFitWithWordBreak(text, minFontSize, lineHeightMult, maxWidthPx, maxHeightPx, maxLines);
    if (wordBreakResult.fits) {
      bestFit = { fontSize: minFontSize, lineCount: wordBreakResult.lineCount, fits: true };
    }
  }

  return bestFit;
}

interface FitResult {
  fits: boolean;
  lineCount: number;
}

function measureTextFit(
  text: string,
  fontSize: number,
  lineHeightMult: number,
  maxWidthPx: number,
  maxHeightPx: number,
  maxLines: number,
): FitResult {
  const avgCharWidth = fontSize * 0.55;
  const lineHeight = fontSize * lineHeightMult;
  const charsPerLine = Math.max(1, Math.floor(maxWidthPx / avgCharWidth));

  const words = text.split(/\s+/);
  let lines = 1;
  let currentLineLen = 0;

  for (const word of words) {
    if (currentLineLen === 0) {
      currentLineLen = word.length;
    } else if (currentLineLen + 1 + word.length <= charsPerLine) {
      currentLineLen += 1 + word.length;
    } else {
      lines++;
      currentLineLen = word.length;
      if (lines > maxLines) return { fits: false, lineCount: lines };
    }
  }

  const requiredHeight = lines * lineHeight;
  return {
    fits: requiredHeight <= maxHeightPx,
    lineCount: lines,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// ASPECT RATIO RULES (for external use)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Canonical canvas sizes — use these when creating templates or checking
 * output dimensions.
 */
export const CANONICAL_CANVAS_SIZES = CANVAS_SIZES;

/**
 * Safe area fractions per platform.
 * These match common platform safe zones for ads.
 */
export const PLATFORM_SAFE_AREAS: Record<string, NormRect> = {
  instagram_reels: { x: 0.04, y: 0.07, w: 0.92, h: 0.78 },
  tiktok:          { x: 0.04, y: 0.07, w: 0.88, h: 0.75 },
  youtube_shorts:  { x: 0.04, y: 0.08, w: 0.92, h: 0.76 },
  instagram_feed:  { x: 0.05, y: 0.05, w: 0.90, h: 0.90 },
  facebook_feed:   { x: 0.05, y: 0.05, w: 0.90, h: 0.90 },
  youtube:         { x: 0.05, y: 0.05, w: 0.90, h: 0.90 },
  default:         { x: 0.05, y: 0.06, w: 0.90, h: 0.88 },
};

// ═══════════════════════════════════════════════════════════════════════════════
// v27: WORD-BREAK MEASUREMENT (for overflow fallback)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * v27: Measure text fit with character-level word-breaking.
 * Used as a fallback when word-level wrapping doesn't fit at minFontSize.
 */
function measureTextFitWithWordBreak(
  text: string,
  fontSize: number,
  lineHeightMult: number,
  maxWidthPx: number,
  maxHeightPx: number,
  maxLines: number,
): FitResult {
  const avgCharWidth = fontSize * 0.55;
  const lineHeight = fontSize * lineHeightMult;
  const charsPerLine = Math.max(1, Math.floor(maxWidthPx / avgCharWidth));

  // Break at character boundaries instead of word boundaries
  let lines = 1;
  let currentLineLen = 0;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\n') {
      lines++;
      currentLineLen = 0;
      if (lines > maxLines) return { fits: false, lineCount: lines };
      continue;
    }
    currentLineLen++;
    if (currentLineLen > charsPerLine) {
      lines++;
      currentLineLen = 1;
      if (lines > maxLines) return { fits: false, lineCount: lines };
    }
  }

  const requiredHeight = lines * lineHeight;
  return {
    fits: requiredHeight <= maxHeightPx,
    lineCount: lines,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// v27: Z-ORDER ENFORCEMENT
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * v27: Validate that z-order of resolved slots matches the expected
 * back-to-front ordering. Issues a warning if ordering is inconsistent.
 */
export function enforceZOrder(
  slots: Map<string, ResolvedSlotGeometry>,
  templateSlots: Array<{ id: string; zIndex: number }>,
): ConstraintViolation[] {
  const violations: ConstraintViolation[] = [];
  const sortedByZ = [...templateSlots].sort((a, b) => a.zIndex - b.zIndex);

  for (let i = 0; i < sortedByZ.length - 1; i++) {
    const current = sortedByZ[i];
    const next = sortedByZ[i + 1];
    if (current.zIndex === next.zIndex) {
      violations.push({
        severity: 'warning',
        slotId: current.id,
        code: 'DUPLICATE_ZINDEX',
        message: `Slots "${current.id}" and "${next.id}" share zIndex ${current.zIndex} — compositing order may be non-deterministic`,
        fix: `Consider assigning unique zIndex values`,
      });
    }
  }

  return violations;
}
