/**
 * Built-in Executable Templates
 * ═══════════════════════════════════════════════════════════════════════════════
 * Production-ready templates for common ad scene types.
 * Each template defines slots, positioning, animation, and safe areas.
 *
 * Templates are designed for 1080p base resolution and adapt to all three
 * aspect ratios (9:16, 1:1, 16:9) via per-ratio slot positions.
 */

import type { ExecutableTemplate, TemplateSlot, NormRect, SlotAnimation, AnimKeyframe } from '../types';

// ═══════════════════════════════════════════════════════════════════════════════
// ANIMATION PRESETS
// ═══════════════════════════════════════════════════════════════════════════════

const FADE_IN: SlotAnimation = {
  entry: {
    keyframes: [
      { offset: 0, opacity: 0 },
      { offset: 1, opacity: 1 },
    ],
    durationMs: 400,
    delayMs: 0,
    easing: 'ease-out',
  },
  main: { keyframes: [], durationMs: 0, delayMs: 0, easing: 'linear' },
  exit: {
    keyframes: [
      { offset: 0, opacity: 1 },
      { offset: 1, opacity: 0 },
    ],
    durationMs: 300,
    delayMs: 0,
    easing: 'ease-in',
  },
};

const SLIDE_UP_IN: SlotAnimation = {
  entry: {
    keyframes: [
      { offset: 0, y: 0.05, opacity: 0 },
      { offset: 1, y: 0, opacity: 1 },
    ],
    durationMs: 500,
    delayMs: 100,
    easing: 'ease-out',
  },
  main: { keyframes: [], durationMs: 0, delayMs: 0, easing: 'linear' },
  exit: {
    keyframes: [
      { offset: 0, y: 0, opacity: 1 },
      { offset: 1, y: -0.03, opacity: 0 },
    ],
    durationMs: 300,
    delayMs: 0,
    easing: 'ease-in',
  },
};

const SCALE_POP: SlotAnimation = {
  entry: {
    keyframes: [
      { offset: 0, scaleX: 0.8, scaleY: 0.8, opacity: 0 },
      { offset: 0.7, scaleX: 1.05, scaleY: 1.05, opacity: 1 },
      { offset: 1, scaleX: 1, scaleY: 1, opacity: 1 },
    ],
    durationMs: 600,
    delayMs: 200,
    easing: 'spring',
  },
  main: { keyframes: [], durationMs: 0, delayMs: 0, easing: 'linear' },
  exit: {
    keyframes: [
      { offset: 0, scaleX: 1, scaleY: 1, opacity: 1 },
      { offset: 1, scaleX: 0.9, scaleY: 0.9, opacity: 0 },
    ],
    durationMs: 300,
    delayMs: 0,
    easing: 'ease-in',
  },
};

const REVEAL_LEFT: SlotAnimation = {
  entry: {
    keyframes: [
      { offset: 0, clipRight: 1 },
      { offset: 1, clipRight: 0 },
    ],
    durationMs: 600,
    delayMs: 150,
    easing: 'ease-out',
  },
  main: { keyframes: [], durationMs: 0, delayMs: 0, easing: 'linear' },
  exit: FADE_IN.exit,
};

const STAGGER_DELAY = (baseAnim: SlotAnimation, delayMs: number): SlotAnimation => ({
  ...baseAnim,
  entry: { ...baseAnim.entry, delayMs },
});

const FLOAT_SUBTLE: SlotAnimation = {
  entry: FADE_IN.entry,
  main: {
    keyframes: [
      { offset: 0, y: 0 },
      { offset: 0.5, y: -0.005 },
      { offset: 1, y: 0 },
    ],
    durationMs: 3000,
    delayMs: 0,
    easing: 'ease-in-out',
    repeat: 'loop',
  },
  exit: FADE_IN.exit,
};

// ═══════════════════════════════════════════════════════════════════════════════
// CANVAS SIZES
// ═══════════════════════════════════════════════════════════════════════════════

const STANDARD_CANVAS = {
  '9:16': { width: 1080, height: 1920 },
  '1:1':  { width: 1080, height: 1080 },
  '16:9': { width: 1920, height: 1080 },
};

const SAFE_AREA: NormRect = { x: 0.05, y: 0.05, w: 0.9, h: 0.9 };

// ═══════════════════════════════════════════════════════════════════════════════
// TEMPLATE: HOOK — Bold headline with optional background image
// ═══════════════════════════════════════════════════════════════════════════════

export const HOOK_TEMPLATE: ExecutableTemplate = {
  id: 'tmpl_exec_hook',
  name: 'Hook Scene',
  version: 1,
  category: 'hook',
  supportedAspects: ['9:16', '1:1', '16:9'],
  canvasSizes: STANDARD_CANVAS,
  safeArea: SAFE_AREA,
  background: { type: 'gradient', stops: [{ color: '#0f0c29', position: 0 }, { color: '#302b63', position: 0.5 }, { color: '#24243e', position: 1 }], angle: 135 },
  defaultDurationMs: 4000,
  transitions: { entryType: 'crossfade', entryDurationMs: 400, exitType: 'crossfade', exitDurationMs: 300 },
  slots: [
    {
      id: 'bg_overlay', name: 'Background Overlay', type: 'shape',
      positions: { '9:16': { x: 0, y: 0, w: 1, h: 1 }, '1:1': { x: 0, y: 0, w: 1, h: 1 }, '16:9': { x: 0, y: 0, w: 1, h: 1 } },
      zIndex: 1, alignment: { horizontal: 'center', vertical: 'center' },
      overflow: 'clip', imageFit: 'cover',
      padding: { top: 0, right: 0, bottom: 0, left: 0 }, required: false,
      style: { backgroundColor: '#00000066', opacity: 0.4 },
      animation: FADE_IN, depthLayer: 'background',
    },
    {
      id: 'headline', name: 'Hook Headline', type: 'text',
      positions: {
        '9:16': { x: 0.08, y: 0.30, w: 0.84, h: 0.25 },
        '1:1':  { x: 0.08, y: 0.25, w: 0.84, h: 0.30 },
        '16:9': { x: 0.15, y: 0.25, w: 0.70, h: 0.30 },
      },
      zIndex: 10, alignment: { horizontal: 'center', vertical: 'center' },
      overflow: 'shrink-to-fit', imageFit: 'cover',
      padding: { top: 0.02, right: 0.02, bottom: 0.02, left: 0.02 }, required: true,
      style: {
        text: {
          fontFamily: 'Inter', fontSize: 72, fontWeight: 800,
          color: '#FFFFFF', lineHeight: 1.1, letterSpacing: -1,
          textTransform: 'uppercase', textAlign: 'center', maxLines: 3, minFontSize: 36,
        },
      },
      animation: SLIDE_UP_IN, depthLayer: 'headline',
    },
    {
      id: 'subtext', name: 'Supporting Text', type: 'text',
      positions: {
        '9:16': { x: 0.10, y: 0.56, w: 0.80, h: 0.10 },
        '1:1':  { x: 0.10, y: 0.58, w: 0.80, h: 0.10 },
        '16:9': { x: 0.20, y: 0.58, w: 0.60, h: 0.10 },
      },
      zIndex: 9, alignment: { horizontal: 'center', vertical: 'top' },
      overflow: 'ellipsis', imageFit: 'cover',
      padding: { top: 0, right: 0.02, bottom: 0, left: 0.02 }, required: false,
      fallback: { type: 'none' },
      style: {
        text: {
          fontFamily: 'Inter', fontSize: 28, fontWeight: 400,
          color: '#FFFFFFCC', lineHeight: 1.4, letterSpacing: 0.5,
          textTransform: 'none', textAlign: 'center', maxLines: 2,
        },
      },
      animation: STAGGER_DELAY(SLIDE_UP_IN, 300), depthLayer: 'supporting',
    },
    {
      id: 'logo', name: 'Brand Logo', type: 'logo',
      positions: {
        '9:16': { x: 0.35, y: 0.82, w: 0.30, h: 0.06 },
        '1:1':  { x: 0.35, y: 0.82, w: 0.30, h: 0.08 },
        '16:9': { x: 0.40, y: 0.82, w: 0.20, h: 0.08 },
      },
      zIndex: 11, alignment: { horizontal: 'center', vertical: 'center' },
      overflow: 'shrink-to-fit', imageFit: 'contain',
      padding: { top: 0.01, right: 0.01, bottom: 0.01, left: 0.01 }, required: false,
      style: { opacity: 0.9 },
      animation: STAGGER_DELAY(FADE_IN, 600), depthLayer: 'overlay',
    },
  ],
};

// ═══════════════════════════════════════════════════════════════════════════════
// TEMPLATE: PRODUCT HERO — Large product image with text overlay
// ═══════════════════════════════════════════════════════════════════════════════

export const PRODUCT_HERO_TEMPLATE: ExecutableTemplate = {
  id: 'tmpl_exec_product_hero',
  name: 'Product Hero',
  version: 1,
  category: 'product_hero',
  supportedAspects: ['9:16', '1:1', '16:9'],
  canvasSizes: STANDARD_CANVAS,
  safeArea: SAFE_AREA,
  background: { type: 'gradient', stops: [{ color: '#1a1a2e', position: 0 }, { color: '#16213e', position: 1 }], angle: 180 },
  defaultDurationMs: 5000,
  transitions: { entryType: 'zoom-in', entryDurationMs: 500, exitType: 'crossfade', exitDurationMs: 400 },
  slots: [
    {
      id: 'product_image', name: 'Product Image', type: 'image',
      positions: {
        '9:16': { x: 0.10, y: 0.15, w: 0.80, h: 0.45 },
        '1:1':  { x: 0.10, y: 0.08, w: 0.80, h: 0.50 },
        '16:9': { x: 0.05, y: 0.05, w: 0.50, h: 0.90 },
      },
      zIndex: 5, alignment: { horizontal: 'center', vertical: 'center' },
      overflow: 'shrink-to-fit', imageFit: 'contain',
      padding: { top: 0.02, right: 0.02, bottom: 0.02, left: 0.02 }, required: false,
      fallback: { type: 'color', color: '#FFFFFF11' },
      style: {},
      animation: FLOAT_SUBTLE, depthLayer: 'subject',
    },
    {
      id: 'headline', name: 'Product Name', type: 'text',
      positions: {
        '9:16': { x: 0.08, y: 0.62, w: 0.84, h: 0.12 },
        '1:1':  { x: 0.08, y: 0.60, w: 0.84, h: 0.12 },
        '16:9': { x: 0.55, y: 0.15, w: 0.40, h: 0.15 },
      },
      zIndex: 10, alignment: { horizontal: 'center', vertical: 'center' },
      overflow: 'shrink-to-fit', imageFit: 'cover',
      padding: { top: 0, right: 0.02, bottom: 0, left: 0.02 }, required: true,
      style: {
        text: {
          fontFamily: 'Inter', fontSize: 56, fontWeight: 700,
          color: '#FFFFFF', lineHeight: 1.15, letterSpacing: -0.5,
          textTransform: 'none', textAlign: 'center', maxLines: 2, minFontSize: 32,
        },
      },
      animation: SLIDE_UP_IN, depthLayer: 'headline',
    },
    {
      id: 'description', name: 'Product Description', type: 'text',
      positions: {
        '9:16': { x: 0.10, y: 0.75, w: 0.80, h: 0.08 },
        '1:1':  { x: 0.10, y: 0.73, w: 0.80, h: 0.08 },
        '16:9': { x: 0.55, y: 0.35, w: 0.40, h: 0.15 },
      },
      zIndex: 9, alignment: { horizontal: 'center', vertical: 'top' },
      overflow: 'ellipsis', imageFit: 'cover',
      padding: { top: 0, right: 0.02, bottom: 0, left: 0.02 }, required: false,
      style: {
        text: {
          fontFamily: 'Inter', fontSize: 24, fontWeight: 400,
          color: '#FFFFFFAA', lineHeight: 1.5, letterSpacing: 0.3,
          textTransform: 'none', textAlign: 'center', maxLines: 3,
        },
      },
      animation: STAGGER_DELAY(SLIDE_UP_IN, 200), depthLayer: 'supporting',
    },
    {
      id: 'logo', name: 'Brand Logo', type: 'logo',
      positions: {
        '9:16': { x: 0.36, y: 0.88, w: 0.28, h: 0.05 },
        '1:1':  { x: 0.36, y: 0.88, w: 0.28, h: 0.06 },
        '16:9': { x: 0.55, y: 0.75, w: 0.20, h: 0.08 },
      },
      zIndex: 11, alignment: { horizontal: 'center', vertical: 'center' },
      overflow: 'shrink-to-fit', imageFit: 'contain',
      padding: { top: 0.01, right: 0.01, bottom: 0.01, left: 0.01 }, required: false,
      style: { opacity: 0.85 },
      animation: STAGGER_DELAY(FADE_IN, 500), depthLayer: 'overlay',
    },
  ],
};

// ═══════════════════════════════════════════════════════════════════════════════
// TEMPLATE: CTA — Call to action with button-style emphasis
// ═══════════════════════════════════════════════════════════════════════════════

export const CTA_TEMPLATE: ExecutableTemplate = {
  id: 'tmpl_exec_cta',
  name: 'Call to Action',
  version: 1,
  category: 'cta',
  supportedAspects: ['9:16', '1:1', '16:9'],
  canvasSizes: STANDARD_CANVAS,
  safeArea: SAFE_AREA,
  background: { type: 'gradient', stops: [{ color: '#0f2027', position: 0 }, { color: '#203a43', position: 0.5 }, { color: '#2c5364', position: 1 }], angle: 135 },
  defaultDurationMs: 4000,
  transitions: { entryType: 'push-up', entryDurationMs: 400, exitType: 'crossfade', exitDurationMs: 500 },
  slots: [
    {
      id: 'headline', name: 'CTA Headline', type: 'text',
      positions: {
        '9:16': { x: 0.08, y: 0.28, w: 0.84, h: 0.18 },
        '1:1':  { x: 0.08, y: 0.22, w: 0.84, h: 0.22 },
        '16:9': { x: 0.15, y: 0.18, w: 0.70, h: 0.25 },
      },
      zIndex: 10, alignment: { horizontal: 'center', vertical: 'center' },
      overflow: 'shrink-to-fit', imageFit: 'cover',
      padding: { top: 0, right: 0.02, bottom: 0, left: 0.02 }, required: true,
      style: {
        text: {
          fontFamily: 'Inter', fontSize: 64, fontWeight: 800,
          color: '#FFFFFF', lineHeight: 1.1, letterSpacing: -1,
          textTransform: 'none', textAlign: 'center', maxLines: 3, minFontSize: 36,
        },
      },
      animation: SLIDE_UP_IN, depthLayer: 'headline',
    },
    {
      id: 'cta_button', name: 'CTA Button', type: 'container',
      positions: {
        '9:16': { x: 0.15, y: 0.52, w: 0.70, h: 0.07 },
        '1:1':  { x: 0.20, y: 0.52, w: 0.60, h: 0.08 },
        '16:9': { x: 0.30, y: 0.55, w: 0.40, h: 0.10 },
      },
      zIndex: 12, alignment: { horizontal: 'center', vertical: 'center' },
      overflow: 'clip', imageFit: 'cover',
      padding: { top: 0.01, right: 0.04, bottom: 0.01, left: 0.04 }, required: true,
      style: { backgroundColor: '#4F46E5', borderRadius: 12 },
      animation: SCALE_POP, depthLayer: 'overlay',
    },
    {
      id: 'cta_text', name: 'CTA Button Text', type: 'text',
      positions: {
        '9:16': { x: 0.15, y: 0.525, w: 0.70, h: 0.06 },
        '1:1':  { x: 0.20, y: 0.53, w: 0.60, h: 0.06 },
        '16:9': { x: 0.30, y: 0.56, w: 0.40, h: 0.08 },
      },
      zIndex: 13, alignment: { horizontal: 'center', vertical: 'center' },
      overflow: 'shrink-to-fit', imageFit: 'cover',
      padding: { top: 0, right: 0, bottom: 0, left: 0 }, required: true,
      style: {
        text: {
          fontFamily: 'Inter', fontSize: 32, fontWeight: 700,
          color: '#FFFFFF', lineHeight: 1, letterSpacing: 1,
          textTransform: 'uppercase', textAlign: 'center', maxLines: 1,
        },
      },
      animation: STAGGER_DELAY(SCALE_POP, 100), depthLayer: 'overlay',
    },
    {
      id: 'subtext', name: 'Urgency Text', type: 'text',
      positions: {
        '9:16': { x: 0.12, y: 0.62, w: 0.76, h: 0.06 },
        '1:1':  { x: 0.12, y: 0.63, w: 0.76, h: 0.06 },
        '16:9': { x: 0.25, y: 0.68, w: 0.50, h: 0.06 },
      },
      zIndex: 9, alignment: { horizontal: 'center', vertical: 'top' },
      overflow: 'ellipsis', imageFit: 'cover',
      padding: { top: 0, right: 0, bottom: 0, left: 0 }, required: false,
      style: {
        text: {
          fontFamily: 'Inter', fontSize: 20, fontWeight: 400,
          color: '#FFFFFF88', lineHeight: 1.4, letterSpacing: 0.5,
          textTransform: 'none', textAlign: 'center', maxLines: 1,
        },
      },
      animation: STAGGER_DELAY(FADE_IN, 800), depthLayer: 'supporting',
    },
    {
      id: 'logo', name: 'Brand Logo', type: 'logo',
      positions: {
        '9:16': { x: 0.36, y: 0.88, w: 0.28, h: 0.05 },
        '1:1':  { x: 0.36, y: 0.85, w: 0.28, h: 0.07 },
        '16:9': { x: 0.40, y: 0.82, w: 0.20, h: 0.08 },
      },
      zIndex: 11, alignment: { horizontal: 'center', vertical: 'center' },
      overflow: 'shrink-to-fit', imageFit: 'contain',
      padding: { top: 0.01, right: 0.01, bottom: 0.01, left: 0.01 }, required: false,
      style: { opacity: 0.85 },
      animation: STAGGER_DELAY(FADE_IN, 700), depthLayer: 'overlay',
    },
  ],
};

// ═══════════════════════════════════════════════════════════════════════════════
// TEMPLATE: TEXT OVERLAY — Clean text-focused scene (problem/solution/proof)
// ═══════════════════════════════════════════════════════════════════════════════

export const TEXT_OVERLAY_TEMPLATE: ExecutableTemplate = {
  id: 'tmpl_exec_text_overlay',
  name: 'Text Overlay',
  version: 1,
  category: 'text_overlay',
  supportedAspects: ['9:16', '1:1', '16:9'],
  canvasSizes: STANDARD_CANVAS,
  safeArea: SAFE_AREA,
  background: { type: 'gradient', stops: [{ color: '#141e30', position: 0 }, { color: '#243b55', position: 1 }], angle: 160 },
  defaultDurationMs: 5000,
  transitions: { entryType: 'crossfade', entryDurationMs: 500, exitType: 'crossfade', exitDurationMs: 400 },
  slots: [
    {
      id: 'icon', name: 'Scene Icon', type: 'icon',
      positions: {
        '9:16': { x: 0.38, y: 0.22, w: 0.24, h: 0.08 },
        '1:1':  { x: 0.38, y: 0.18, w: 0.24, h: 0.10 },
        '16:9': { x: 0.43, y: 0.12, w: 0.14, h: 0.12 },
      },
      zIndex: 8, alignment: { horizontal: 'center', vertical: 'center' },
      overflow: 'shrink-to-fit', imageFit: 'contain',
      padding: { top: 0, right: 0, bottom: 0, left: 0 }, required: false,
      style: {
        text: {
          fontFamily: 'Inter', fontSize: 48, fontWeight: 400,
          color: '#FFFFFF66', lineHeight: 1, letterSpacing: 0,
          textTransform: 'none', textAlign: 'center',
        },
      },
      animation: STAGGER_DELAY(FADE_IN, 0), depthLayer: 'supporting',
    },
    {
      id: 'headline', name: 'Main Text', type: 'text',
      positions: {
        '9:16': { x: 0.08, y: 0.32, w: 0.84, h: 0.22 },
        '1:1':  { x: 0.08, y: 0.30, w: 0.84, h: 0.22 },
        '16:9': { x: 0.12, y: 0.28, w: 0.76, h: 0.25 },
      },
      zIndex: 10, alignment: { horizontal: 'center', vertical: 'center' },
      overflow: 'shrink-to-fit', imageFit: 'cover',
      padding: { top: 0, right: 0.02, bottom: 0, left: 0.02 }, required: true,
      style: {
        text: {
          fontFamily: 'Inter', fontSize: 52, fontWeight: 600,
          color: '#FFFFFF', lineHeight: 1.25, letterSpacing: -0.3,
          textTransform: 'none', textAlign: 'center', maxLines: 4, minFontSize: 28,
        },
      },
      animation: REVEAL_LEFT, depthLayer: 'headline',
    },
    {
      id: 'body', name: 'Body Text', type: 'text',
      positions: {
        '9:16': { x: 0.10, y: 0.56, w: 0.80, h: 0.15 },
        '1:1':  { x: 0.10, y: 0.55, w: 0.80, h: 0.15 },
        '16:9': { x: 0.15, y: 0.56, w: 0.70, h: 0.15 },
      },
      zIndex: 9, alignment: { horizontal: 'center', vertical: 'top' },
      overflow: 'wrap', imageFit: 'cover',
      padding: { top: 0, right: 0.02, bottom: 0, left: 0.02 }, required: false,
      style: {
        text: {
          fontFamily: 'Inter', fontSize: 24, fontWeight: 400,
          color: '#FFFFFFBB', lineHeight: 1.6, letterSpacing: 0.2,
          textTransform: 'none', textAlign: 'center', maxLines: 5,
        },
      },
      animation: STAGGER_DELAY(SLIDE_UP_IN, 400), depthLayer: 'supporting',
    },
    {
      id: 'accent_line', name: 'Accent Line', type: 'shape',
      positions: {
        '9:16': { x: 0.40, y: 0.54, w: 0.20, h: 0.003 },
        '1:1':  { x: 0.40, y: 0.53, w: 0.20, h: 0.004 },
        '16:9': { x: 0.42, y: 0.54, w: 0.16, h: 0.004 },
      },
      zIndex: 8, alignment: { horizontal: 'center', vertical: 'center' },
      overflow: 'clip', imageFit: 'cover',
      padding: { top: 0, right: 0, bottom: 0, left: 0 }, required: false,
      style: { backgroundColor: '#4F46E5', borderRadius: 2 },
      animation: STAGGER_DELAY(REVEAL_LEFT, 300), depthLayer: 'supporting',
    },
  ],
};

// ═══════════════════════════════════════════════════════════════════════════════
// TEMPLATE: BRAND REVEAL — Logo-centric reveal scene
// ═══════════════════════════════════════════════════════════════════════════════

export const BRAND_REVEAL_TEMPLATE: ExecutableTemplate = {
  id: 'tmpl_exec_brand_reveal',
  name: 'Brand Reveal',
  version: 1,
  category: 'brand_reveal',
  supportedAspects: ['9:16', '1:1', '16:9'],
  canvasSizes: STANDARD_CANVAS,
  safeArea: SAFE_AREA,
  background: { type: 'solid', color: '#0a0a0a' },
  defaultDurationMs: 3500,
  transitions: { entryType: 'dissolve', entryDurationMs: 600, exitType: 'crossfade', exitDurationMs: 400 },
  slots: [
    {
      id: 'logo', name: 'Brand Logo', type: 'logo',
      positions: {
        '9:16': { x: 0.20, y: 0.35, w: 0.60, h: 0.15 },
        '1:1':  { x: 0.20, y: 0.30, w: 0.60, h: 0.20 },
        '16:9': { x: 0.30, y: 0.25, w: 0.40, h: 0.25 },
      },
      zIndex: 10, alignment: { horizontal: 'center', vertical: 'center' },
      overflow: 'shrink-to-fit', imageFit: 'contain',
      padding: { top: 0.02, right: 0.02, bottom: 0.02, left: 0.02 }, required: true,
      fallback: { type: 'text', value: 'BRAND' },
      style: {},
      animation: SCALE_POP, depthLayer: 'subject',
    },
    {
      id: 'tagline', name: 'Brand Tagline', type: 'text',
      positions: {
        '9:16': { x: 0.12, y: 0.54, w: 0.76, h: 0.08 },
        '1:1':  { x: 0.12, y: 0.55, w: 0.76, h: 0.08 },
        '16:9': { x: 0.25, y: 0.55, w: 0.50, h: 0.08 },
      },
      zIndex: 9, alignment: { horizontal: 'center', vertical: 'center' },
      overflow: 'shrink-to-fit', imageFit: 'cover',
      padding: { top: 0, right: 0, bottom: 0, left: 0 }, required: false,
      style: {
        text: {
          fontFamily: 'Inter', fontSize: 28, fontWeight: 300,
          color: '#FFFFFFCC', lineHeight: 1.4, letterSpacing: 3,
          textTransform: 'uppercase', textAlign: 'center', maxLines: 1,
        },
      },
      animation: STAGGER_DELAY(FADE_IN, 600), depthLayer: 'supporting',
    },
  ],
};

// ═══════════════════════════════════════════════════════════════════════════════
// TEMPLATE: TESTIMONIAL — Quote + attribution
// ═══════════════════════════════════════════════════════════════════════════════

export const TESTIMONIAL_TEMPLATE: ExecutableTemplate = {
  id: 'tmpl_exec_testimonial',
  name: 'Testimonial',
  version: 1,
  category: 'testimonial',
  supportedAspects: ['9:16', '1:1', '16:9'],
  canvasSizes: STANDARD_CANVAS,
  safeArea: SAFE_AREA,
  background: { type: 'gradient', stops: [{ color: '#1a1a2e', position: 0 }, { color: '#0f3460', position: 1 }], angle: 180 },
  defaultDurationMs: 6000,
  transitions: { entryType: 'crossfade', entryDurationMs: 500, exitType: 'crossfade', exitDurationMs: 400 },
  slots: [
    {
      id: 'quote_mark', name: 'Quote Mark', type: 'text',
      positions: {
        '9:16': { x: 0.08, y: 0.22, w: 0.15, h: 0.08 },
        '1:1':  { x: 0.08, y: 0.18, w: 0.15, h: 0.10 },
        '16:9': { x: 0.10, y: 0.15, w: 0.10, h: 0.12 },
      },
      zIndex: 8, alignment: { horizontal: 'left', vertical: 'top' },
      overflow: 'clip', imageFit: 'cover',
      padding: { top: 0, right: 0, bottom: 0, left: 0 }, required: false,
      fallback: { type: 'text', value: '"' },
      style: {
        text: {
          fontFamily: 'Playfair Display', fontSize: 120, fontWeight: 700,
          color: '#4F46E533', lineHeight: 1, letterSpacing: 0,
          textTransform: 'none', textAlign: 'left',
        },
      },
      animation: FADE_IN, depthLayer: 'background',
    },
    {
      id: 'headline', name: 'Quote Text', type: 'text',
      positions: {
        '9:16': { x: 0.10, y: 0.30, w: 0.80, h: 0.30 },
        '1:1':  { x: 0.10, y: 0.25, w: 0.80, h: 0.30 },
        '16:9': { x: 0.15, y: 0.22, w: 0.70, h: 0.35 },
      },
      zIndex: 10, alignment: { horizontal: 'left', vertical: 'top' },
      overflow: 'shrink-to-fit', imageFit: 'cover',
      padding: { top: 0, right: 0.02, bottom: 0, left: 0.02 }, required: true,
      style: {
        text: {
          fontFamily: 'Inter', fontSize: 36, fontWeight: 500,
          color: '#FFFFFF', lineHeight: 1.5, letterSpacing: 0,
          textTransform: 'none', textAlign: 'left', maxLines: 6, minFontSize: 22,
        },
      },
      animation: SLIDE_UP_IN, depthLayer: 'headline',
    },
    {
      id: 'attribution', name: 'Attribution', type: 'text',
      positions: {
        '9:16': { x: 0.10, y: 0.64, w: 0.80, h: 0.06 },
        '1:1':  { x: 0.10, y: 0.60, w: 0.80, h: 0.06 },
        '16:9': { x: 0.15, y: 0.62, w: 0.70, h: 0.06 },
      },
      zIndex: 9, alignment: { horizontal: 'left', vertical: 'center' },
      overflow: 'ellipsis', imageFit: 'cover',
      padding: { top: 0, right: 0, bottom: 0, left: 0 }, required: false,
      style: {
        text: {
          fontFamily: 'Inter', fontSize: 20, fontWeight: 600,
          color: '#4F46E5', lineHeight: 1.2, letterSpacing: 0.5,
          textTransform: 'uppercase', textAlign: 'left', maxLines: 1,
        },
      },
      animation: STAGGER_DELAY(FADE_IN, 500), depthLayer: 'supporting',
    },
  ],
};

// ═══════════════════════════════════════════════════════════════════════════════
// TEMPLATE REGISTRY
// ═══════════════════════════════════════════════════════════════════════════════

const TEMPLATE_REGISTRY: Map<string, ExecutableTemplate> = new Map([
  [HOOK_TEMPLATE.id, HOOK_TEMPLATE],
  [PRODUCT_HERO_TEMPLATE.id, PRODUCT_HERO_TEMPLATE],
  [CTA_TEMPLATE.id, CTA_TEMPLATE],
  [TEXT_OVERLAY_TEMPLATE.id, TEXT_OVERLAY_TEMPLATE],
  [BRAND_REVEAL_TEMPLATE.id, BRAND_REVEAL_TEMPLATE],
  [TESTIMONIAL_TEMPLATE.id, TESTIMONIAL_TEMPLATE],
]);

/** Get a template by ID. */
export function getExecutableTemplate(id: string): ExecutableTemplate | undefined {
  return TEMPLATE_REGISTRY.get(id);
}

/** Get all registered templates. */
export function getAllExecutableTemplates(): ExecutableTemplate[] {
  return [...TEMPLATE_REGISTRY.values()];
}

/** Register a custom template. */
export function registerExecutableTemplate(template: ExecutableTemplate): void {
  TEMPLATE_REGISTRY.set(template.id, template);
}

/** Scene-role → best template mapping. */
const ROLE_TEMPLATE_MAP: Record<string, string> = {
  hook:         HOOK_TEMPLATE.id,
  problem:      TEXT_OVERLAY_TEMPLATE.id,
  solution:     PRODUCT_HERO_TEMPLATE.id,
  proof:        TESTIMONIAL_TEMPLATE.id,
  cta:          CTA_TEMPLATE.id,
  brand_reveal: BRAND_REVEAL_TEMPLATE.id,
  offer:        CTA_TEMPLATE.id,
  close:        BRAND_REVEAL_TEMPLATE.id,
  end:          BRAND_REVEAL_TEMPLATE.id,
};

/** Get the best template for a scene role. */
export function getTemplateForRole(role: string): ExecutableTemplate {
  const id = ROLE_TEMPLATE_MAP[role] || TEXT_OVERLAY_TEMPLATE.id;
  return TEMPLATE_REGISTRY.get(id) || TEXT_OVERLAY_TEMPLATE;
}
