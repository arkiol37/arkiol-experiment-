// packages/shared/src/ai/archetypes/helpers.ts
// Shared low-level helpers used by all archetype compile functions.
// No global/window usage. Pure functions only.

import { Zone, Canvas, Block, BlockType } from './types';

// ── Stable hash (FNV-1a) ──────────────────────────────────────────────────────

export function stableHash(s: string): number {
  let h = 2166136261;
  const str = String(s ?? '');
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0);
}

// ── Scale ─────────────────────────────────────────────────────────────────────

export function scale(canvas: Canvas, v: number): number {
  const baseW = 1280;
  const k = (canvas?.w ?? baseW) / baseW;
  return Math.round(v * k);
}

// ── Zone rounding ─────────────────────────────────────────────────────────────

export function roundZone(z: Zone): Zone {
  return {
    x: Math.round(z.x),
    y: Math.round(z.y),
    w: Math.round(z.w),
    h: Math.round(z.h),
  };
}

// ── Block ID generation ───────────────────────────────────────────────────────

export function uid(seed: string): string {
  return `${seed}-${Math.abs(stableHash(seed)).toString(16).slice(0, 6)}`;
}

// ── Block factories ───────────────────────────────────────────────────────────

export function imageBlock(role: string, zone: Zone, style: Record<string, unknown>, z: number): Block {
  return { id: uid(role), type: 'image', role, zone: roundZone(zone), style, z };
}

export function textBlock(role: string, zone: Zone, value: string, style: Record<string, unknown>, z: number): Block {
  return { id: uid(role), type: 'text', role, zone: roundZone(zone), style: { ...style, value }, z };
}

export function overlayBlock(role: string, zone: Zone, style: Record<string, unknown>, z: number): Block {
  return { id: uid(role), type: 'overlay', role, zone: roundZone(zone), style, z };
}

export function backgroundBlock(role: string, zone: Zone, style: Record<string, unknown>, z: number): Block {
  return { id: uid(role), type: 'background', role, zone: roundZone(zone), style, z };
}

export function badgeBlock(role: string, zone: Zone, style: Record<string, unknown>, z: number): Block {
  return { id: uid(role), type: 'badge', role, zone: roundZone(zone), style, z };
}

export function lineBlock(role: string, zone: Zone, style: Record<string, unknown>, z: number): Block {
  return { id: uid(role), type: 'line', role, zone: roundZone(zone), style, z };
}

// ── Validation helpers ────────────────────────────────────────────────────────

export function requireImage(ctx: { imageProvided: boolean }): void {
  if (!ctx.imageProvided) throw new Error('Image required for this archetype');
}

export function requireFace(ctx: { faceDetected: boolean }): void {
  if (!ctx.faceDetected) throw new Error('Face detection required for this archetype');
}

export function validateOnlyAllowedBlocks(blocks: Block[], allowed: BlockType[]): void {
  for (const b of blocks) {
    if (!allowed.includes(b.type)) {
      throw new Error(`Disallowed block type "${b.type}" in archetype`);
    }
  }
}

export function validateNoOverlap(blocks: Block[], textRoles: string[], otherRoles: string[]): void {
  const byRole = new Map(blocks.map(b => [b.role, b]));
  for (const tr of textRoles) {
    const t = byRole.get(tr);
    if (!t) continue;
    for (const or of otherRoles) {
      const o = byRole.get(or);
      if (!o) continue;
      if (rectsOverlap(t.zone, o.zone)) {
        throw new Error(`Block overlap between "${tr}" and "${or}"`);
      }
    }
  }
}

function rectsOverlap(a: Zone, b: Zone): boolean {
  return !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
}

// ── Text normalization ────────────────────────────────────────────────────────

export function normalize(t: string | undefined, maxWords: number): string {
  return String(t ?? '').trim().split(/\s+/).filter(Boolean).slice(0, maxWords).join(' ');
}

export function sentenceCase(s: string): string {
  const t = s.trim();
  if (!t) return '';
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
}

export function titleCase(s: string): string {
  return s.trim().split(/\s+/).filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

export function normalizeHeadline(
  headline: string | undefined,
  opts: { maxWords?: number; casing?: 'UPPER' | 'TITLE' | 'SENTENCE' }
): string {
  const maxWords = opts.maxWords ?? 8;
  const casing   = opts.casing   ?? 'SENTENCE';
  let t = normalize(headline, maxWords);
  if      (casing === 'UPPER')    t = t.toUpperCase();
  else if (casing === 'TITLE')    t = titleCase(t);
  else if (casing === 'SENTENCE') t = sentenceCase(t);
  return t;
}

// ── Text fitting ──────────────────────────────────────────────────────────────

export interface FitTextOpts {
  baseFontSize:  number;
  minFontSize:   number;
  lineHeight:    number;
  maxLines:      number;
  letterSpacing: number;
}

export interface FittedText {
  text:      string;
  fontSize:  number;
  lineHeight: number;
}

export function fitTextToZone(textValue: string | undefined, zone: Zone, opts: FitTextOpts): FittedText {
  let fontSize = opts.baseFontSize;
  const min    = opts.minFontSize;
  const clean  = String(textValue ?? '').trim();
  if (!clean) return { text: '', fontSize, lineHeight: opts.lineHeight };

  while (fontSize >= min) {
    const lines = estimateLines(clean, zone.w, fontSize, opts.letterSpacing);
    if (lines <= opts.maxLines) return { text: clean, fontSize, lineHeight: opts.lineHeight };
    fontSize = Math.max(min, Math.floor(fontSize * 0.92));
    if (fontSize === min) break;
  }

  const finalLines = estimateLines(clean, zone.w, min, opts.letterSpacing);
  if (finalLines > opts.maxLines) throw new Error(`Text cannot fit in zone: "${clean.slice(0, 40)}..."`);
  return { text: clean, fontSize: min, lineHeight: opts.lineHeight };
}

function estimateLines(text: string, widthPx: number, fontSizePx: number, letterSpacing: number): number {
  const ls = Number.isFinite(letterSpacing) ? letterSpacing : 0;
  const avgCharW = Math.max(1, fontSizePx * 0.55 + ls * 0.25);
  const charsPerLine = Math.max(1, Math.floor(widthPx / avgCharW));
  return Math.ceil(text.length / charsPerLine);
}
