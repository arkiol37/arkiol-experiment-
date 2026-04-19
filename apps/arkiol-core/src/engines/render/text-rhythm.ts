// src/engines/render/text-rhythm.ts
//
// Text spacing & readability utilities. Three responsibilities:
//
//   1. Zone insets — text should never kiss the zone edge. A zone touching
//      the canvas border effectively puts text at the canvas edge, which
//      reads as "unpolished." This module returns inner padding per zone.
//
//   2. Line-height policy — the baseline `computeLineHeight` was tuned for
//      display-weight zones; bullet/contact/legal inherited a 1.25 default
//      that feels cramped at body sizes. This module returns a role-aware,
//      font-size-aware leading with comfortable reading rhythm.
//
//   3. Widow/orphan rebalance — the existing rule catches 1-word orphans
//      ≤6 chars. This module extends coverage to short trailing lines in
//      general (last line width < 25% of previous line) and to 2-word
//      orphans when both words are short. Keeps headlines visually balanced.
//
// No imports from the layout engine — this module is renderer-local so it
// can't depend on zone classification logic above it.

import type { Zone } from "../layout/families";
import { measureLineWidth } from "./text-measure";

// ── 1. Zone insets ─────────────────────────────────────────────────────────

export interface TextInset {
  x: number;   // horizontal inset in px (applied to both left & right)
  y: number;   // vertical inset in px (applied to both top & bottom)
}

// Zones that sit flush against the canvas edge get a larger inset so text
// doesn't look crammed into the corner. Interior zones get a smaller inset
// — just enough to keep text from touching an adjacent image/frame.
function edgeProximity(zone: Zone): "edge" | "near-edge" | "interior" {
  const leftEdge   = zone.x;
  const rightEdge  = 100 - (zone.x + zone.width);
  const topEdge    = zone.y;
  const bottomEdge = 100 - (zone.y + zone.height);
  const minEdge    = Math.min(leftEdge, rightEdge, topEdge, bottomEdge);
  if (minEdge <= 1.5) return "edge";
  if (minEdge <= 4)   return "near-edge";
  return "interior";
}

// Role-specific inset policy. Display zones need more breathing room to
// feel "set"; micro labels (badge/eyebrow) hug tighter since their own
// chrome (pill, accent bar) provides visual padding.
const ROLE_INSET_BASE: Partial<Record<string, { x: number; y: number }>> = {
  headline: { x: 0.10, y: 0.18 },
  name:     { x: 0.10, y: 0.18 },
  subhead:  { x: 0.08, y: 0.14 },
  tagline:  { x: 0.08, y: 0.14 },
  body:     { x: 0.06, y: 0.10 },
  contact:  { x: 0.06, y: 0.10 },
  company:  { x: 0.06, y: 0.10 },
  bullet_1: { x: 0.05, y: 0.08 },
  bullet_2: { x: 0.05, y: 0.08 },
  bullet_3: { x: 0.05, y: 0.08 },
  legal:    { x: 0.04, y: 0.06 },
  cta:      { x: 0.00, y: 0.00 }, // chrome provides its own padding
  badge:    { x: 0.00, y: 0.00 },
  eyebrow:  { x: 0.00, y: 0.00 },
};

/**
 * Compute a horizontal + vertical pixel inset for a text zone. The inset is
 * relative to the zone's own dimensions (not the canvas) so narrower zones
 * get proportionally smaller padding. Zones at the canvas edge get a
 * minimum absolute inset (≥12px at 1080 canvas) to guarantee readable
 * margin from the canvas border.
 */
export function computeTextInset(
  zone:   Zone,
  zoneId: string,
  canvasW:number,
  canvasH:number,
): TextInset {
  const zoneWpx = (zone.width  / 100) * canvasW;
  const zoneHpx = (zone.height / 100) * canvasH;

  const role = ROLE_INSET_BASE[zoneId] ?? { x: 0.06, y: 0.10 };
  let insetX = zoneWpx * role.x;
  let insetY = zoneHpx * role.y;

  // Edge-adjacent zones need a minimum absolute margin from the canvas border.
  const prox = edgeProximity(zone);
  if (prox === "edge") {
    const minEdge = Math.max(canvasW, canvasH) * 0.015; // ≈16px @ 1080
    insetX = Math.max(insetX, minEdge);
    insetY = Math.max(insetY, minEdge * 0.75);
  } else if (prox === "near-edge") {
    const minNearEdge = Math.max(canvasW, canvasH) * 0.008;
    insetX = Math.max(insetX, minNearEdge);
    insetY = Math.max(insetY, minNearEdge * 0.75);
  }

  // Hard cap: the inset should never consume more than ~25% of the zone in
  // any direction, otherwise wrap target becomes unreadable.
  insetX = Math.min(insetX, zoneWpx * 0.20);
  insetY = Math.min(insetY, zoneHpx * 0.30);

  return { x: insetX, y: insetY };
}

// ── 2. Line-height policy ──────────────────────────────────────────────────
//
// Body text at 1.55 leading reads loosely for long paragraphs but becomes
// airy for single-line body. We return multipliers that are:
//   • Tight for large display (<60px headlines need room, >80px need to
//     hug) — follows the inverse-relationship rule from editorial design.
//   • Comfortable for body/contact/bullet — 1.42–1.48 range.
//   • Generous for bullets so each scan-line is distinct.

export function refinedLineHeight(
  fontSize: number,
  zoneId:   string,
  themeMultiplier?: number,
): number {
  if (themeMultiplier) return fontSize * themeMultiplier;

  // Display roles — inverse relationship: larger size → tighter leading.
  if (zoneId === "headline" || zoneId === "name") {
    if (fontSize >= 96) return fontSize * 1.00;
    if (fontSize >= 72) return fontSize * 1.06;
    if (fontSize >= 54) return fontSize * 1.10;
    if (fontSize >= 38) return fontSize * 1.15;
    return fontSize * 1.20;
  }

  // Sub-display — slightly looser than headline but tighter than body.
  if (zoneId === "subhead" || zoneId === "tagline" || zoneId === "title") {
    if (fontSize >= 40) return fontSize * 1.22;
    return fontSize * 1.28;
  }

  // Body — professional reading rhythm. Slightly tighter than our old 1.55.
  if (zoneId === "body" || zoneId === "body_text") {
    if (fontSize >= 28) return fontSize * 1.38;
    if (fontSize >= 18) return fontSize * 1.45;
    return fontSize * 1.50;
  }

  // Bullets — need more leading than body so each item reads as a discrete
  // scan-line, not a continuation paragraph.
  if (zoneId.startsWith("bullet_")) {
    return fontSize * 1.55;
  }

  // Contact / company / legal — multi-line stacks read better with a
  // slightly tighter rhythm so the block feels unified.
  if (zoneId === "contact" || zoneId === "company" || zoneId === "legal") {
    return fontSize * 1.40;
  }

  // Micro labels — inherently single-line, keep tight.
  if (zoneId === "eyebrow" || zoneId === "badge" || zoneId === "section_header") {
    return fontSize * 1.15;
  }

  return fontSize * 1.30;
}

// ── 3. Widow / orphan rebalance ────────────────────────────────────────────

function lineWidth(
  text: string, fontSize: number, fontFamily: string, fontWeight: number,
): number {
  return measureLineWidth(text, fontSize, fontFamily, fontWeight);
}

/**
 * Rebalance trailing lines to prevent:
 *   • single-word orphans (last line = 1 short word)
 *   • narrow tail lines (last line < 25% of previous line's width)
 *   • 2-word short orphans (e.g. "now →" dangling)
 *
 * Returns a new array; never mutates the input. Safe for any line count.
 */
export function rebalanceShortTail(
  lines:      string[],
  fontSize:   number,
  fontFamily: string,
  fontWeight: number,
  maxWidth:   number,
): string[] {
  if (lines.length < 2) return lines.slice();
  const out   = lines.slice();

  // Multiple passes — a single pull can expose a new orphan from the now-shorter
  // previous line. Cap at 2 iterations to avoid unbounded reshuffling.
  for (let pass = 0; pass < 2; pass++) {
    const lastIdx  = out.length - 1;
    const last     = out[lastIdx];
    const prev     = out[lastIdx - 1];
    const lastW    = lineWidth(last, fontSize, fontFamily, fontWeight);
    const prevW    = lineWidth(prev, fontSize, fontFamily, fontWeight);
    const lastWords = last.split(/\s+/);
    const prevWords = prev.split(/\s+/);

    const isOneWordOrphan = lastWords.length === 1 && lastWords[0].length <= 8;
    const isTwoShortOrphan =
      lastWords.length === 2 &&
      lastWords[0].length <= 5 &&
      lastWords[1].length <= 5;
    const isNarrowTail = lastW < prevW * 0.25;

    if (!isOneWordOrphan && !isTwoShortOrphan && !isNarrowTail) break;
    if (prevWords.length < 3) break;

    // Pull the last word of the previous line down to balance.
    const pulled     = prevWords.pop()!;
    const newPrev    = prevWords.join(" ");
    const newLast    = `${pulled} ${last}`;

    // Safety check: the rebalanced last line must still fit maxWidth.
    if (lineWidth(newLast, fontSize, fontFamily, fontWeight) > maxWidth) break;

    out[lastIdx - 1] = newPrev;
    out[lastIdx]     = newLast;
  }

  return out;
}
