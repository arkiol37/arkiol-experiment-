// packages/shared/src/ai/archetypes/archetypes.ts
// All 20 Arkiol archetypes as a strict TypeScript module.
// No global/window usage. No process.env access. Pure functions only.
// Converted from archetypes_1-20_compiled.js.

import { Archetype, ArchetypeId, Canvas, ArchetypeContext, CompiledTemplate } from './types';
import {
  scale, normalizeHeadline, normalize, fitTextToZone,
  imageBlock, textBlock, overlayBlock, backgroundBlock, badgeBlock, lineBlock,
  requireImage, requireFace, validateOnlyAllowedBlocks, validateNoOverlap,
} from './helpers';

// ── Template builder ──────────────────────────────────────────────────────────

function template(canvas: Canvas, archetypeId: ArchetypeId, blocks: ReturnType<typeof imageBlock>[]): CompiledTemplate {
  return { canvas, archetypeId, blocks };
}

// ── Zone calculators ──────────────────────────────────────────────────────────

function zonesAggressive(c: Canvas, faceDetected: boolean) {
  const s = c.safe, W = c.w - s * 2, H = c.h - s * 2;
  const image     = faceDetected ? { x: s, y: s, w: W * 0.72, h: H } : { x: s, y: s, w: W, h: H };
  const text      = faceDetected ? { x: s + W * 0.72, y: s, w: W * 0.28, h: H } : { x: s + W * 0.10, y: s + H * 0.68, w: W * 0.80, h: H * 0.26 };
  const kicker    = faceDetected ? { x: text.x, y: text.y + text.h * 0.58, w: text.w, h: text.h * 0.42 } : { ...text };
  return { image, text, kicker };
}
function zonesMinimal(c: Canvas)    { const s = c.safe, W = c.w-s*2, H = c.h-s*2; return { full: {x:s,y:s,w:W,h:H}, title: {x:s,y:s+H*0.30,w:W,h:H*0.22}, divider: {x:s,y:s+H*0.56,w:W*0.42,h:0}, sub: {x:s,y:s+H*0.60,w:W*0.72,h:H*0.25} }; }
function zonesMystery(c: Canvas)    { const s = c.safe, W = c.w-s*2, H = c.h-s*2; return { image: {x:s,y:s,w:W,h:H}, fade: {x:s,y:s+H*0.55,w:W,h:H*0.45}, text: {x:s+W*0.08,y:s+H*0.66,w:W*0.84,h:H*0.22}, badge: {x:s+W*0.88,y:s+H*0.58,w:W*0.08,h:H*0.08} }; }
function zonesProduct(c: Canvas)    { const s = c.safe, W = c.w-s*2, H = c.h-s*2; return { full: {x:s,y:s,w:W,h:H}, image: {x:s+W*0.1,y:s+H*0.08,w:W*0.8,h:H*0.7}, caption: {x:s,y:s+H*0.82,w:W,h:H*0.16} }; }
function zonesTrust(c: Canvas)      { const s = c.safe, W = c.w-s*2, H = c.h-s*2; return { full: {x:s,y:s,w:W,h:H}, image: {x:s,y:s,w:W*0.45,h:H}, title: {x:s+W*0.5,y:s+H*0.25,w:W*0.45,h:H*0.25}, sub: {x:s+W*0.5,y:s+H*0.52,w:W*0.45,h:H*0.28} }; }
function zonesNews(c: Canvas)       { const s = c.safe, W = c.w-s*2, H = c.h-s*2; return { banner: {x:s,y:s+H*0.35,w:W,h:H*0.3}, rule: {x:s,y:s+H*0.67,w:W,h:0} }; }
function zonesCinematic(c: Canvas)  { const s = c.safe, W = c.w-s*2, H = c.h-s*2; return { image: {x:s,y:s,w:W,h:H}, text: {x:s+W*0.15,y:s+H*0.7,w:W*0.7,h:H*0.25} }; }
function zonesSports(c: Canvas)     { const s = c.safe, W = c.w-s*2, H = c.h-s*2; return { image: {x:s,y:s,w:W,h:H}, motion: {x:s,y:s+H*0.15,w:W,h:H*0.2}, text: {x:s+W*0.1,y:s+H*0.05,w:W*0.8,h:H*0.2} }; }
function zonesMusic(c: Canvas)      { const s = c.safe, W = c.w-s*2, H = c.h-s*2; return { image: {x:s,y:s,w:W,h:H}, text: {x:s+W*0.2,y:s+H*0.35,w:W*0.6,h:H*0.3} }; }
function zonesVS(c: Canvas)         { const s = c.safe, W = c.w-s*2, H = c.h-s*2; return { left: {x:s,y:s,w:W*0.45,h:H}, right: {x:s+W*0.55,y:s,w:W*0.45,h:H}, badge: {x:s+W*0.45,y:s+H*0.42,w:W*0.10,h:H*0.16}, text: {x:s+W*0.15,y:s+H*0.82,w:W*0.7,h:H*0.15} }; }
function zonesBold(c: Canvas)       { const s = c.safe, W = c.w-s*2, H = c.h-s*2; return { full: {x:s,y:s,w:W,h:H}, center: {x:s+W*0.1,y:s+H*0.3,w:W*0.8,h:H*0.4} }; }
function zonesFace(c: Canvas)       { const s = c.safe, W = c.w-s*2, H = c.h-s*2; return { image: {x:s,y:s,w:W,h:H}, text: {x:s+W*0.15,y:s+H*0.7,w:W*0.7,h:H*0.22} }; }
function zonesEdu(c: Canvas)        { const s = c.safe, W = c.w-s*2, H = c.h-s*2; return { full: {x:s,y:s,w:W,h:H}, image: {x:s,y:s,w:W*0.45,h:H}, title: {x:s+W*0.5,y:s+H*0.2,w:W*0.45,h:H*0.25}, sub: {x:s+W*0.5,y:s+H*0.5,w:W*0.45,h:H*0.3} }; }
function zonesKids(c: Canvas)       { const s = c.safe, W = c.w-s*2, H = c.h-s*2; return { full: {x:s,y:s,w:W,h:H}, image: {x:s+W*0.1,y:s+H*0.1,w:W*0.8,h:H*0.55}, text: {x:s+W*0.15,y:s+H*0.7,w:W*0.7,h:H*0.2}, sticker: {x:s+W*0.05,y:s+H*0.05,w:W*0.2,h:H*0.15} }; }
function zonesLuxury(c: Canvas)     { const s = c.safe, W = c.w-s*2, H = c.h-s*2; return { image: {x:s,y:s,w:W,h:H}, text: {x:s+W*0.15,y:s+H*0.65,w:W*0.7,h:H*0.25} }; }
function zonesAuthority(c: Canvas)  { const s = c.safe, W = c.w-s*2, H = c.h-s*2; return { full: {x:s,y:s,w:W,h:H}, image: {x:s,y:s,w:W*0.4,h:H}, title: {x:s+W*0.45,y:s+H*0.25,w:W*0.5,h:H*0.25}, sub: {x:s+W*0.45,y:s+H*0.55,w:W*0.5,h:H*0.3} }; }
function zonesTech(c: Canvas)       { const s = c.safe, W = c.w-s*2, H = c.h-s*2; return { image: {x:s,y:s,w:W,h:H}, text: {x:s+W*0.15,y:s+H*0.4,w:W*0.7,h:H*0.25} }; }
function zonesReligion(c: Canvas)   { const s = c.safe, W = c.w-s*2, H = c.h-s*2; return { full: {x:s,y:s,w:W,h:H}, title: {x:s+W*0.1,y:s+H*0.35,w:W*0.8,h:H*0.2}, sub: {x:s+W*0.1,y:s+H*0.58,w:W*0.8,h:H*0.25} }; }
function zonesFun(c: Canvas)        { const s = c.safe, W = c.w-s*2, H = c.h-s*2; return { full: {x:s,y:s,w:W,h:H}, image: {x:s+W*0.15,y:s+H*0.1,w:W*0.7,h:H*0.55}, text: {x:s+W*0.2,y:s+H*0.7,w:W*0.6,h:H*0.2}, emoji: {x:s+W*0.05,y:s+H*0.05,w:W*0.15,h:H*0.15} }; }
function zonesEmotion(c: Canvas)    { const s = c.safe, W = c.w-s*2, H = c.h-s*2; return { image: {x:s,y:s,w:W,h:H}, fade: {x:s,y:s+H*0.55,w:W,h:H*0.45}, text: {x:s+W*0.15,y:s+H*0.65,w:W*0.7,h:H*0.25} }; }

// ── Archetype 1: AGGRESSIVE_POWER ─────────────────────────────────────────────

const AggressivePower: Archetype = {
  id: 'AGGRESSIVE_POWER',
  compile(canvas, ctx) {
    requireImage(ctx);
    const z = zonesAggressive(canvas, ctx.faceDetected);
    const headline = normalizeHeadline(ctx.headline, { maxWords: 5, casing: 'UPPER' });
    const textStyle = { family: 'condensed', weight: 900, casing: 'UPPER', letterSpacing: -1.5, fill: '#FFFFFF', stroke: { width: scale(canvas, 6), color: 'rgba(0,0,0,0.85)' }, shadow: { x: 0, y: scale(canvas, 6), blur: scale(canvas, 22), color: 'rgba(0,0,0,0.65)' } };
    const fitted = fitTextToZone(headline, z.text, { baseFontSize: scale(canvas, 98), minFontSize: scale(canvas, 54), lineHeight: 0.95, maxLines: 2, letterSpacing: -1.5 });
    const blocks = [
      imageBlock('hero',      z.image,  { cropBias: ctx.faceDetected ? 'eyes-center' : 'center' }, 10),
      overlayBlock('contrast', z.image, { type: 'gradient', direction: 'to-left', stops: [{ at: 0.0, color: 'rgba(0,0,0,0.65)' }, { at: 0.5, color: 'rgba(0,0,0,0.25)' }, { at: 1.0, color: 'rgba(0,0,0,0.00)' }] }, 20),
      overlayBlock('kickerBand', z.kicker, { type: 'solid', color: 'rgba(0,0,0,0.45)', radius: scale(canvas, 14) }, 25),
      textBlock('headline', z.text, fitted.text, { ...textStyle, fontSize: fitted.fontSize, lineHeight: fitted.lineHeight, align: 'center', padding: scale(canvas, 16) }, 30),
    ];
    validateNoOverlap(blocks, ['headline'], ['hero']);
    return template(canvas, this.id, blocks);
  },
};

// ── Archetype 2: MINIMAL_CLEAN ────────────────────────────────────────────────

const MinimalClean: Archetype = {
  id: 'MINIMAL_CLEAN',
  compile(canvas, ctx) {
    const z = zonesMinimal(canvas);
    const headline = normalizeHeadline(ctx.headline, { maxWords: 10, casing: 'SENTENCE' });
    const style = { family: 'sans', weight: 400, casing: 'SENTENCE', letterSpacing: 0, fill: '#111111' };
    const fitted = fitTextToZone(headline, z.title, { baseFontSize: scale(canvas, 64), minFontSize: scale(canvas, 36), lineHeight: 1.22, maxLines: 2, letterSpacing: 0 });
    const blocks = [
      backgroundBlock('paper', z.full, { color: '#FFFFFF' }, 0),
      lineBlock('divider', z.divider, { color: 'rgba(17,17,17,0.12)', thickness: Math.max(1, scale(canvas, 2)) }, 5),
      textBlock('headline', z.title, fitted.text, { ...style, fontSize: fitted.fontSize, lineHeight: fitted.lineHeight, align: 'left', padding: 0 }, 10),
      ...(ctx.subhead ? [textBlock('subhead', z.sub, normalizeHeadline(ctx.subhead, { maxWords: 18, casing: 'SENTENCE' }), { family: 'sans', weight: 300, casing: 'SENTENCE', letterSpacing: 0, fill: 'rgba(17,17,17,0.72)', fontSize: scale(canvas, 28), lineHeight: 1.25, align: 'left', maxLines: 3, padding: 0 }, 12)] : []),
    ];
    validateOnlyAllowedBlocks(blocks, ['background', 'line', 'text']);
    return template(canvas, this.id, blocks);
  },
};

// ── Archetype 3: CURIOSITY_MYSTERY ───────────────────────────────────────────

const CuriosityMystery: Archetype = {
  id: 'CURIOSITY_MYSTERY',
  compile(canvas, ctx) {
    requireImage(ctx); requireFace(ctx);
    const z = zonesMystery(canvas);
    const headline = normalizeHeadline(ctx.headline, { maxWords: 6, casing: 'TITLE' });
    const style = { family: 'sans', weight: 750, casing: 'TITLE', letterSpacing: -0.5, fill: '#FFFFFF', shadow: { x: 0, y: scale(canvas, 4), blur: scale(canvas, 14), color: 'rgba(0,0,0,0.55)' } };
    const fitted = fitTextToZone(headline, z.text, { baseFontSize: scale(canvas, 72), minFontSize: scale(canvas, 44), lineHeight: 1.04, maxLines: 2, letterSpacing: -0.5 });
    const blocks = [
      imageBlock('hero', z.image, { cropBias: 'eyes-center', zoom: 1.12 }, 10),
      overlayBlock('fade', z.fade, { type: 'gradient', direction: 'to-top', stops: [{ at: 0.0, color: 'rgba(0,0,0,0.78)' }, { at: 0.55, color: 'rgba(0,0,0,0.18)' }, { at: 1.0, color: 'rgba(0,0,0,0.00)' }] }, 20),
      textBlock('headline', z.text, fitted.text, { ...style, fontSize: fitted.fontSize, lineHeight: fitted.lineHeight, align: 'center', padding: scale(canvas, 16) }, 30),
      badgeBlock('hint', z.badge, { label: '?', fill: 'rgba(255,255,255,0.92)', textColor: 'rgba(0,0,0,0.85)', radius: scale(canvas, 999), fontSize: scale(canvas, 26), weight: 800, paddingX: scale(canvas, 14), paddingY: scale(canvas, 8) }, 35),
    ];
    validateOnlyAllowedBlocks(blocks, ['image', 'overlay', 'text', 'badge']);
    validateNoOverlap(blocks, ['headline'], ['hint']);
    return template(canvas, this.id, blocks);
  },
};

// ── Archetype 4: PRODUCT_FOCUS ────────────────────────────────────────────────

const ProductFocus: Archetype = {
  id: 'PRODUCT_FOCUS',
  compile(canvas, ctx) {
    requireImage(ctx);
    const z = zonesProduct(canvas);
    const headline = normalizeHeadline(ctx.headline, { maxWords: 4, casing: 'UPPER' });
    const fitted = fitTextToZone(headline, z.caption, { baseFontSize: scale(canvas, 42), minFontSize: scale(canvas, 26), lineHeight: 1.0, maxLines: 1, letterSpacing: -0.5 });
    const blocks = [
      backgroundBlock('paper', z.full, { color: '#FFFFFF' }, 0),
      imageBlock('product', z.image, { cropBias: 'center', zoom: 1.08 }, 10),
      textBlock('caption', z.caption, fitted.text, { family: 'sans', weight: 700, casing: 'UPPER', fill: '#111111', fontSize: fitted.fontSize, lineHeight: fitted.lineHeight, letterSpacing: -0.5, align: 'center' }, 20),
    ];
    validateOnlyAllowedBlocks(blocks, ['background', 'image', 'text']);
    return template(canvas, this.id, blocks);
  },
};

// ── Archetype 5: TRUST_FRIENDLY ──────────────────────────────────────────────

const TrustFriendly: Archetype = {
  id: 'TRUST_FRIENDLY',
  compile(canvas, ctx) {
    requireImage(ctx);
    const z = zonesTrust(canvas);
    const headline = normalizeHeadline(ctx.headline, { maxWords: 8, casing: 'SENTENCE' });
    const sub = normalizeHeadline(ctx.subhead, { maxWords: 14, casing: 'SENTENCE' });
    const hFit = fitTextToZone(headline, z.title, { baseFontSize: scale(canvas, 52), minFontSize: scale(canvas, 34), lineHeight: 1.18, maxLines: 2, letterSpacing: 0 });
    const blocks = [
      backgroundBlock('soft', z.full, { color: '#F4F7F8' }, 0),
      imageBlock('portrait', z.image, { cropBias: 'eyes-center', zoom: 1.04 }, 10),
      textBlock('headline', z.title, hFit.text, { family: 'sans', weight: 500, casing: 'SENTENCE', fill: '#1A1A1A', fontSize: hFit.fontSize, lineHeight: hFit.lineHeight, align: 'left' }, 20),
      ...(sub ? [textBlock('subhead', z.sub, sub, { family: 'sans', weight: 400, casing: 'SENTENCE', fill: 'rgba(26,26,26,0.75)', fontSize: scale(canvas, 28), lineHeight: 1.25, align: 'left' }, 22)] : []),
    ];
    validateOnlyAllowedBlocks(blocks, ['background', 'image', 'text']);
    return template(canvas, this.id, blocks);
  },
};

// ── Archetype 6: NEWS_URGENT ──────────────────────────────────────────────────

const NewsUrgent: Archetype = {
  id: 'NEWS_URGENT',
  compile(canvas, ctx) {
    const z = zonesNews(canvas);
    const headline = normalizeHeadline(ctx.headline, { maxWords: 6, casing: 'UPPER' });
    const fitted = fitTextToZone(headline, z.banner, { baseFontSize: scale(canvas, 58), minFontSize: scale(canvas, 38), lineHeight: 1.05, maxLines: 2, letterSpacing: -0.8 });
    const blocks = [
      backgroundBlock('alert', z.banner, { color: '#C62828' }, 0),
      textBlock('headline', z.banner, fitted.text, { family: 'condensed', weight: 900, casing: 'UPPER', fill: '#FFFFFF', fontSize: fitted.fontSize, lineHeight: fitted.lineHeight, align: 'center' }, 10),
      lineBlock('rule', z.rule, { color: '#C62828', thickness: Math.max(2, scale(canvas, 3)) }, 12),
    ];
    validateOnlyAllowedBlocks(blocks, ['background', 'text', 'line']);
    return template(canvas, this.id, blocks);
  },
};

// ── Archetype 7: CINEMATIC_DARK ──────────────────────────────────────────────

const CinematicDark: Archetype = {
  id: 'CINEMATIC_DARK',
  compile(canvas, ctx) {
    requireImage(ctx);
    const z = zonesCinematic(canvas);
    const title = normalize(ctx.headline, 5).toUpperCase();
    const fitted = fitTextToZone(title, z.text, { baseFontSize: scale(canvas, 64), minFontSize: scale(canvas, 40), maxLines: 2, lineHeight: 1.0, letterSpacing: -1 });
    const blocks = [
      imageBlock('hero', z.image, { cropBias: 'center' }, 10),
      overlayBlock('vignette', z.image, { type: 'radial', inner: 'rgba(0,0,0,0.0)', outer: 'rgba(0,0,0,0.7)' }, 20),
      textBlock('headline', z.text, fitted.text, { family: 'condensed', weight: 800, casing: 'UPPER', fill: '#FFFFFF', fontSize: fitted.fontSize, lineHeight: fitted.lineHeight, letterSpacing: -1, shadow: { x: 0, y: 4, blur: 16, color: 'rgba(0,0,0,0.6)' } }, 30),
    ];
    validateOnlyAllowedBlocks(blocks, ['image', 'overlay', 'text']);
    return template(canvas, this.id, blocks);
  },
};

// ── Archetype 8: SPORTS_ACTION ───────────────────────────────────────────────

const SportsAction: Archetype = {
  id: 'SPORTS_ACTION',
  compile(canvas, ctx) {
    requireImage(ctx); requireFace(ctx);
    const z = zonesSports(canvas);
    const title = normalize(ctx.headline, 4).toUpperCase();
    const fitted = fitTextToZone(title, z.text, { baseFontSize: scale(canvas, 72), minFontSize: scale(canvas, 44), maxLines: 1, lineHeight: 0.95, letterSpacing: -1.2 });
    const blocks = [
      imageBlock('action', z.image, { cropBias: 'eyes-center', zoom: 1.12 }, 10),
      overlayBlock('motion', z.motion, { type: 'diagonal', color: 'rgba(255,255,255,0.15)' }, 20),
      textBlock('headline', z.text, fitted.text, { family: 'condensed', weight: 900, casing: 'UPPER', fill: '#FFFFFF', fontSize: fitted.fontSize, lineHeight: fitted.lineHeight, letterSpacing: -1.2, stroke: { width: scale(canvas, 4), color: 'rgba(0,0,0,0.9)' } }, 30),
    ];
    validateOnlyAllowedBlocks(blocks, ['image', 'overlay', 'text']);
    return template(canvas, this.id, blocks);
  },
};

// ── Archetype 9: MUSIC_ARTISTIC ──────────────────────────────────────────────

const MusicArtistic: Archetype = {
  id: 'MUSIC_ARTISTIC',
  compile(canvas, ctx) {
    requireImage(ctx);
    const z = zonesMusic(canvas);
    const title = normalize(ctx.headline, 6);
    const fitted = fitTextToZone(title, z.text, { baseFontSize: scale(canvas, 56), minFontSize: scale(canvas, 36), maxLines: 2, lineHeight: 1.15, letterSpacing: -0.3 });
    const blocks = [
      imageBlock('art', z.image, { cropBias: 'center' }, 10),
      overlayBlock('tint', z.image, { type: 'solid', color: 'rgba(0,0,0,0.25)' }, 20),
      textBlock('headline', z.text, fitted.text, { family: 'serif', weight: 600, casing: 'SENTENCE', fill: '#FFFFFF', fontSize: fitted.fontSize, lineHeight: fitted.lineHeight, letterSpacing: -0.3, shadow: { x: 0, y: 2, blur: 10, color: 'rgba(0,0,0,0.4)' } }, 30),
    ];
    validateOnlyAllowedBlocks(blocks, ['image', 'overlay', 'text']);
    return template(canvas, this.id, blocks);
  },
};

// ── Archetype 10: COMPARISON_VS ──────────────────────────────────────────────

const ComparisonVS: Archetype = {
  id: 'COMPARISON_VS',
  compile(canvas, ctx) {
    requireImage(ctx);
    const z = zonesVS(canvas);
    const title = normalize(ctx.headline, 5).toUpperCase();
    const fitted = fitTextToZone(title, z.text, { baseFontSize: scale(canvas, 52), minFontSize: scale(canvas, 34), maxLines: 2, lineHeight: 1.05, letterSpacing: -0.8 });
    const blocks = [
      imageBlock('left',   z.left,  { cropBias: 'center' }, 10),
      imageBlock('right',  z.right, { cropBias: 'center' }, 10),
      badgeBlock('vs', z.badge, { label: 'VS', fill: '#FFFFFF', textColor: '#111111', radius: scale(canvas, 999), fontSize: scale(canvas, 32), weight: 900, paddingX: scale(canvas, 20), paddingY: scale(canvas, 12) }, 20),
      textBlock('headline', z.text, fitted.text, { family: 'condensed', weight: 800, casing: 'UPPER', fill: '#FFFFFF', fontSize: fitted.fontSize, lineHeight: fitted.lineHeight, align: 'center', shadow: { x: 0, y: 3, blur: 12, color: 'rgba(0,0,0,0.6)' } }, 30),
    ];
    validateOnlyAllowedBlocks(blocks, ['image', 'badge', 'text']);
    return template(canvas, this.id, blocks);
  },
};

// ── Archetype 11: BOLD_CLAIM ─────────────────────────────────────────────────

const BoldClaim: Archetype = {
  id: 'BOLD_CLAIM',
  compile(canvas, ctx) {
    const z = zonesBold(canvas);
    const title = normalize(ctx.headline, 4).toUpperCase();
    const fitted = fitTextToZone(title, z.center, { baseFontSize: scale(canvas, 88), minFontSize: scale(canvas, 52), maxLines: 2, lineHeight: 0.95, letterSpacing: -1.5 });
    const blocks = [
      backgroundBlock('solid', z.full, { color: '#000000' }, 0),
      textBlock('headline', z.center, fitted.text, { family: 'condensed', weight: 900, casing: 'UPPER', fill: '#FFFFFF', fontSize: fitted.fontSize, lineHeight: fitted.lineHeight, align: 'center', letterSpacing: -1.5 }, 10),
    ];
    validateOnlyAllowedBlocks(blocks, ['background', 'text']);
    return template(canvas, this.id, blocks);
  },
};

// ── Archetype 12: FACE_CLOSEUP ────────────────────────────────────────────────

const FaceCloseup: Archetype = {
  id: 'FACE_CLOSEUP',
  compile(canvas, ctx) {
    requireImage(ctx); requireFace(ctx);
    const z = zonesFace(canvas);
    const title = normalize(ctx.headline, 5).toUpperCase();
    const fitted = fitTextToZone(title, z.text, { baseFontSize: scale(canvas, 60), minFontSize: scale(canvas, 40), maxLines: 2, lineHeight: 1.0, letterSpacing: -1 });
    const blocks = [
      imageBlock('face', z.image, { cropBias: 'eyes-center', zoom: 1.18 }, 10),
      overlayBlock('shade', z.image, { type: 'gradient', direction: 'to-bottom', stops: [{ at: 0.0, color: 'rgba(0,0,0,0.0)' }, { at: 1.0, color: 'rgba(0,0,0,0.65)' }] }, 20),
      textBlock('headline', z.text, fitted.text, { family: 'condensed', weight: 800, casing: 'UPPER', fill: '#FFFFFF', fontSize: fitted.fontSize, lineHeight: fitted.lineHeight, align: 'center', shadow: { x: 0, y: 3, blur: 14, color: 'rgba(0,0,0,0.6)' } }, 30),
    ];
    validateOnlyAllowedBlocks(blocks, ['image', 'overlay', 'text']);
    return template(canvas, this.id, blocks);
  },
};

// ── Archetype 13: EDUCATIONAL_EXPLAINER ──────────────────────────────────────

const EducationalExplainer: Archetype = {
  id: 'EDUCATIONAL_EXPLAINER',
  compile(canvas, ctx) {
    const z = zonesEdu(canvas);
    const title    = normalize(ctx.headline, 8);
    const subtitle = normalize(ctx.subhead,  14);
    const titleFit = fitTextToZone(title, z.title, { baseFontSize: scale(canvas, 48), minFontSize: scale(canvas, 32), maxLines: 2, lineHeight: 1.2, letterSpacing: 0 });
    const blocks = [
      backgroundBlock('paper', z.full, { color: '#FAFAFA' }, 0),
      ...(ctx.imageProvided ? [imageBlock('illustration', z.image, { cropBias: 'center' }, 10)] : []),
      textBlock('headline', z.title, titleFit.text, { family: 'sans', weight: 600, casing: 'SENTENCE', fill: '#111111', fontSize: titleFit.fontSize, lineHeight: titleFit.lineHeight, align: 'left' }, 20),
      ...(subtitle ? [textBlock('subhead', z.sub, subtitle, { family: 'sans', weight: 400, casing: 'SENTENCE', fill: 'rgba(17,17,17,0.75)', fontSize: scale(canvas, 28), lineHeight: 1.3, align: 'left' }, 22)] : []),
    ];
    validateOnlyAllowedBlocks(blocks, ['background', 'image', 'text']);
    return template(canvas, this.id, blocks);
  },
};

// ── Archetype 14: KIDS_PLAYFUL ────────────────────────────────────────────────

const KidsPlayful: Archetype = {
  id: 'KIDS_PLAYFUL',
  compile(canvas, ctx) {
    requireImage(ctx); requireFace(ctx);
    const z   = zonesKids(canvas);
    const title = normalize(ctx.headline, 4).toUpperCase();
    const fit   = fitTextToZone(title, z.text, { baseFontSize: scale(canvas, 64), minFontSize: scale(canvas, 40), maxLines: 2, lineHeight: 1.0, letterSpacing: -0.5 });
    const blocks = [
      backgroundBlock('fun', z.full, { color: '#FFEB3B' }, 0),
      imageBlock('kid', z.image, { cropBias: 'eyes-center', zoom: 1.1 }, 10),
      badgeBlock('sticker', z.sticker, { label: 'FUN', fill: '#FF5722', textColor: '#FFFFFF', radius: scale(canvas, 999), fontSize: scale(canvas, 26), weight: 900, paddingX: scale(canvas, 18), paddingY: scale(canvas, 10) }, 15),
      textBlock('headline', z.text, fit.text, { family: 'rounded', weight: 900, casing: 'UPPER', fill: '#111111', fontSize: fit.fontSize, lineHeight: fit.lineHeight, align: 'center' }, 20),
    ];
    validateOnlyAllowedBlocks(blocks, ['background', 'image', 'badge', 'text']);
    return template(canvas, this.id, blocks);
  },
};

// ── Archetype 15: LUXURY_PREMIUM ─────────────────────────────────────────────

const LuxuryPremium: Archetype = {
  id: 'LUXURY_PREMIUM',
  compile(canvas, ctx) {
    requireImage(ctx);
    const z   = zonesLuxury(canvas);
    const title = normalize(ctx.headline, 6);
    const fit   = fitTextToZone(title, z.text, { baseFontSize: scale(canvas, 46), minFontSize: scale(canvas, 30), maxLines: 2, lineHeight: 1.25, letterSpacing: 0.2 });
    const blocks = [
      imageBlock('hero', z.image, { cropBias: 'center' }, 10),
      overlayBlock('fade', z.image, { type: 'gradient', direction: 'to-top', stops: [{ at: 0.0, color: 'rgba(0,0,0,0.65)' }, { at: 1.0, color: 'rgba(0,0,0,0.0)' }] }, 20),
      textBlock('headline', z.text, fit.text, { family: 'serif', weight: 500, casing: 'SENTENCE', fill: '#FFFFFF', fontSize: fit.fontSize, lineHeight: fit.lineHeight, align: 'center', letterSpacing: 0.2 }, 30),
    ];
    validateOnlyAllowedBlocks(blocks, ['image', 'overlay', 'text']);
    return template(canvas, this.id, blocks);
  },
};

// ── Archetype 16: AUTHORITY_EXPERT ───────────────────────────────────────────

const AuthorityExpert: Archetype = {
  id: 'AUTHORITY_EXPERT',
  compile(canvas, ctx) {
    const z        = zonesAuthority(canvas);
    const title    = normalize(ctx.headline, 8);
    const sub      = normalize(ctx.subhead,  12);
    const titleFit = fitTextToZone(title, z.title, { baseFontSize: scale(canvas, 54), minFontSize: scale(canvas, 34), maxLines: 2, lineHeight: 1.2, letterSpacing: 0 });
    const blocks = [
      backgroundBlock('paper', z.full, { color: '#FFFFFF' }, 0),
      ...(ctx.imageProvided ? [imageBlock('expert', z.image, { cropBias: ctx.faceDetected ? 'eyes-center' : 'center' }, 10)] : []),
      textBlock('headline', z.title, titleFit.text, { family: 'serif', weight: 600, casing: 'SENTENCE', fill: '#111111', fontSize: titleFit.fontSize, lineHeight: titleFit.lineHeight, align: 'left' }, 20),
      ...(sub ? [textBlock('subhead', z.sub, sub, { family: 'serif', weight: 400, casing: 'SENTENCE', fill: 'rgba(17,17,17,0.75)', fontSize: scale(canvas, 26), lineHeight: 1.3, align: 'left' }, 22)] : []),
    ];
    validateOnlyAllowedBlocks(blocks, ['background', 'image', 'text']);
    return template(canvas, this.id, blocks);
  },
};

// ── Archetype 17: TECH_FUTURISTIC ─────────────────────────────────────────────

const TechFuturistic: Archetype = {
  id: 'TECH_FUTURISTIC',
  compile(canvas, ctx) {
    requireImage(ctx);
    const z   = zonesTech(canvas);
    const title = normalize(ctx.headline, 6).toUpperCase();
    const fit   = fitTextToZone(title, z.text, { baseFontSize: scale(canvas, 56), minFontSize: scale(canvas, 36), maxLines: 2, lineHeight: 1.0, letterSpacing: -0.8 });
    const blocks = [
      imageBlock('tech', z.image, { cropBias: 'center' }, 10),
      overlayBlock('grid', z.image, { type: 'pattern', opacity: 0.25 }, 15),
      overlayBlock('glow', z.text,  { type: 'glow', color: '#00E5FF', blur: scale(canvas, 20) }, 18),
      textBlock('headline', z.text, fit.text, { family: 'mono', weight: 700, casing: 'UPPER', fill: '#00E5FF', fontSize: fit.fontSize, lineHeight: fit.lineHeight, letterSpacing: -0.8, shadow: { x: 0, y: 0, blur: scale(canvas, 12), color: 'rgba(0,229,255,0.8)' } }, 20),
    ];
    validateOnlyAllowedBlocks(blocks, ['image', 'overlay', 'text']);
    return template(canvas, this.id, blocks);
  },
};

// ── Archetype 18: RELIGION_CALM ──────────────────────────────────────────────

const ReligionCalm: Archetype = {
  id: 'RELIGION_CALM',
  compile(canvas, ctx) {
    const z        = zonesReligion(canvas);
    const title    = normalize(ctx.headline, 10);
    const sub      = normalize(ctx.subhead, 16);
    const titleFit = fitTextToZone(title, z.title, { baseFontSize: scale(canvas, 48), minFontSize: scale(canvas, 32), maxLines: 2, lineHeight: 1.3, letterSpacing: 0 });
    const blocks = [
      backgroundBlock('calm', z.full, { color: '#F8F8F5' }, 0),
      textBlock('headline', z.title, titleFit.text, { family: 'serif', weight: 500, casing: 'SENTENCE', fill: '#333333', fontSize: titleFit.fontSize, lineHeight: titleFit.lineHeight, align: 'center' }, 10),
      ...(sub ? [textBlock('subhead', z.sub, sub, { family: 'serif', weight: 400, casing: 'SENTENCE', fill: 'rgba(51,51,51,0.7)', fontSize: scale(canvas, 26), lineHeight: 1.4, align: 'center' }, 12)] : []),
    ];
    validateOnlyAllowedBlocks(blocks, ['background', 'text']);
    return template(canvas, this.id, blocks);
  },
};

// ── Archetype 19: FUN_PLAYFUL ─────────────────────────────────────────────────

const FunPlayful: Archetype = {
  id: 'FUN_PLAYFUL',
  compile(canvas, ctx) {
    requireImage(ctx); requireFace(ctx);
    const z   = zonesFun(canvas);
    const title = normalize(ctx.headline, 4).toUpperCase();
    const fit   = fitTextToZone(title, z.text, { baseFontSize: scale(canvas, 60), minFontSize: scale(canvas, 40), maxLines: 2, lineHeight: 1.0, letterSpacing: -0.5 });
    const blocks = [
      backgroundBlock('play', z.full, { color: '#FFCDD2' }, 0),
      imageBlock('face', z.image, { cropBias: 'eyes-center', zoom: 1.12 }, 10),
      badgeBlock('emoji', z.emoji, { label: '😊', fill: '#FFFFFF', textColor: '#111111', radius: scale(canvas, 999), fontSize: scale(canvas, 28), weight: 800, paddingX: scale(canvas, 14), paddingY: scale(canvas, 8) }, 15),
      textBlock('headline', z.text, fit.text, { family: 'rounded', weight: 900, casing: 'UPPER', fill: '#111111', fontSize: fit.fontSize, lineHeight: fit.lineHeight, align: 'center' }, 20),
    ];
    validateOnlyAllowedBlocks(blocks, ['background', 'image', 'badge', 'text']);
    return template(canvas, this.id, blocks);
  },
};

// ── Archetype 20: EMOTIONAL_STORY ────────────────────────────────────────────

const EmotionalStory: Archetype = {
  id: 'EMOTIONAL_STORY',
  compile(canvas, ctx) {
    requireImage(ctx); requireFace(ctx);
    const z   = zonesEmotion(canvas);
    const title = normalize(ctx.headline, 6);
    const fit   = fitTextToZone(title, z.text, { baseFontSize: scale(canvas, 58), minFontSize: scale(canvas, 36), maxLines: 2, lineHeight: 1.1, letterSpacing: -0.3 });
    const blocks = [
      imageBlock('hero', z.image, { cropBias: 'eyes-center' }, 10),
      overlayBlock('fade', z.fade, { type: 'gradient', direction: 'to-top', stops: [{ at: 0.0, color: 'rgba(0,0,0,0.75)' }, { at: 1.0, color: 'rgba(0,0,0,0.0)' }] }, 20),
      textBlock('headline', z.text, fit.text, { family: 'serif', weight: 600, casing: 'SENTENCE', fill: '#FFFFFF', fontSize: fit.fontSize, lineHeight: fit.lineHeight, align: 'center', shadow: { x: 0, y: 4, blur: 14, color: 'rgba(0,0,0,0.6)' } }, 30),
    ];
    validateOnlyAllowedBlocks(blocks, ['image', 'overlay', 'text']);
    return template(canvas, this.id, blocks);
  },
};

// ── Registry ──────────────────────────────────────────────────────────────────

export const ALL_ARCHETYPES: readonly Archetype[] = Object.freeze([
  AggressivePower,
  MinimalClean,
  CuriosityMystery,
  ProductFocus,
  TrustFriendly,
  NewsUrgent,
  CinematicDark,
  SportsAction,
  MusicArtistic,
  ComparisonVS,
  BoldClaim,
  FaceCloseup,
  EducationalExplainer,
  KidsPlayful,
  LuxuryPremium,
  AuthorityExpert,
  TechFuturistic,
  ReligionCalm,
  FunPlayful,
  EmotionalStory,
]);

export const ARCHETYPE_MAP: ReadonlyMap<ArchetypeId, Archetype> = new Map(
  ALL_ARCHETYPES.map(a => [a.id, a])
);

export function getArchetype(id: ArchetypeId): Archetype {
  const a = ARCHETYPE_MAP.get(id);
  if (!a) throw new Error(`Unknown archetype id: ${id}`);
  return a;
}
