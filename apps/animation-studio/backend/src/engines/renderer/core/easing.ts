/**
 * Easing Functions
 * ═══════════════════════════════════════════════════════════════════════════════
 * Pure math — no dependencies. Every animation keyframe interpolation passes
 * through one of these functions to convert linear progress (0→1) into
 * eased progress.
 */

import type { EasingFn } from './types';

/** Apply easing to a linear progress value t ∈ [0, 1]. */
export function applyEasing(t: number, easing: EasingFn): number {
  const clamped = Math.max(0, Math.min(1, t));
  switch (easing) {
    case 'linear':       return clamped;
    case 'ease-in':      return easeInCubic(clamped);
    case 'ease-out':     return easeOutCubic(clamped);
    case 'ease-in-out':  return easeInOutCubic(clamped);
    case 'spring':       return spring(clamped);
    case 'bounce':       return bounce(clamped);
    case 'elastic':      return elastic(clamped);
    case 'cubic-bezier': return easeInOutCubic(clamped); // default curve
    default:             return clamped;
  }
}

// ── Standard cubic easing ────────────────────────────────────────────────────

function easeInCubic(t: number): number {
  return t * t * t;
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function easeInOutCubic(t: number): number {
  return t < 0.5
    ? 4 * t * t * t
    : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// ── Quadratic ────────────────────────────────────────────────────────────────

export function easeInQuad(t: number): number { return t * t; }
export function easeOutQuad(t: number): number { return 1 - (1 - t) * (1 - t); }
export function easeInOutQuad(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

// ── Spring (damped oscillation) ──────────────────────────────────────────────

function spring(t: number): number {
  const c4 = (2 * Math.PI) / 3;
  if (t === 0) return 0;
  if (t === 1) return 1;
  return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
}

// ── Bounce ───────────────────────────────────────────────────────────────────

function bounce(t: number): number {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
  if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
  return n1 * (t -= 2.625 / d1) * t + 0.984375;
}

// ── Elastic ──────────────────────────────────────────────────────────────────

function elastic(t: number): number {
  const c5 = (2 * Math.PI) / 4.5;
  if (t === 0) return 0;
  if (t === 1) return 1;
  if (t < 0.5) {
    return -(Math.pow(2, 20 * t - 10) * Math.sin((20 * t - 11.125) * c5)) / 2;
  }
  return (Math.pow(2, -20 * t + 10) * Math.sin((20 * t - 11.125) * c5)) / 2 + 1;
}

// ═══════════════════════════════════════════════════════════════════════════════
// INTERPOLATION UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

/** Linearly interpolate between two numbers. */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Interpolate between two values with easing. */
export function easedLerp(a: number, b: number, t: number, easing: EasingFn): number {
  return lerp(a, b, applyEasing(t, easing));
}

/** Interpolate a hex color. */
export function lerpColor(a: string, b: string, t: number): string {
  const parse = (hex: string) => {
    const h = hex.replace('#', '');
    return {
      r: parseInt(h.substring(0, 2), 16),
      g: parseInt(h.substring(2, 4), 16),
      b: parseInt(h.substring(4, 6), 16),
    };
  };
  const ca = parse(a);
  const cb = parse(b);
  const r = Math.round(lerp(ca.r, cb.r, t));
  const g = Math.round(lerp(ca.g, cb.g, t));
  const bl = Math.round(lerp(ca.b, cb.b, t));
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${bl.toString(16).padStart(2, '0')}`;
}
