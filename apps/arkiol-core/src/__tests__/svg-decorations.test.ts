/**
 * apps/arkiol-core/src/__tests__/svg-decorations.test.ts
 *
 * Unit tests for engines/render/svg-decorations.ts
 *
 * Pure string-generation functions — no DOM, no HTTP, no DB.
 *
 * Covers:
 *  - renderDecoration    — all 20+ shape kinds, output is valid SVG fragment,
 *                          color/opacity are embedded, unknown kind → ""
 *  - renderDecorations   — joins multiple shapes, empty array → ""
 *  - buildBackgroundDefs — all 5 bg kinds, returns defs + fill strings
 *  - renderMeshOverlay   — mesh returns rects, non-mesh returns ""
 */

import {
  renderDecoration,
  renderDecorations,
  buildBackgroundDefs,
  renderMeshOverlay,
} from '../engines/render/svg-decorations';

import type { DecorShape, BgTreatment } from '../engines/render/design-themes';

// ── Helpers ───────────────────────────────────────────────────────────────────
const W = 1080;
const H = 1080;

function circle(overrides?: Partial<Extract<DecorShape, { kind: 'circle' }>>): Extract<DecorShape, { kind: 'circle' }> {
  return { kind: 'circle', x: 50, y: 50, r: 20, color: '#ff0000', opacity: 0.8, ...overrides };
}

// ══════════════════════════════════════════════════════════════════════════════
// renderDecoration — output shape
// ══════════════════════════════════════════════════════════════════════════════
describe('renderDecoration — output is non-empty SVG string', () => {
  const SHAPES: DecorShape[] = [
    { kind: 'circle',          x:50, y:50, r:20,     color:'#fff', opacity:0.9 },
    { kind: 'circle',          x:50, y:50, r:20,     color:'#fff', opacity:0.9, stroke:true, strokeWidth:2 },
    { kind: 'rect',            x:10, y:10, w:30, h:20, color:'#abc', opacity:0.5, rx:4 },
    { kind: 'blob',            x:50, y:50, size:30,  color:'#def', opacity:0.7, seed:42 },
    { kind: 'line',            x1:0, y1:0, x2:100, y2:100, color:'#111', opacity:1, width:2 },
    { kind: 'dots_grid',       x:5, y:5, cols:4, rows:3, gap:10, r:2, color:'#ccc', opacity:0.6 },
    { kind: 'diagonal_stripe', x:0, y:0, w:100, h:10, color:'#eee', opacity:0.3 },
    { kind: 'half_circle',     x:50, y:0, r:40, color:'#f00', opacity:0.8, rotation:0 },
    { kind: 'accent_bar',      x:5, y:90, w:20, h:2, color:'#f90', rx:1 },
    { kind: 'badge_pill',      x:10, y:5, w:30, h:8, color:'#000', text:'NEW', textColor:'#fff', fontSize:14 },
    { kind: 'deco_ring',       x:80, y:20, r:15, color:'#9f9', opacity:0.7, strokeWidth:2 },
    { kind: 'triangle',        x:50, y:50, size:30, color:'#f00', opacity:0.9, rotation:0 },
    { kind: 'cross',           x:50, y:50, size:20, thickness:3, color:'#0f0', opacity:0.8, rotation:45 },
    { kind: 'wave',            x:0, y:80, w:100, amplitude:5, frequency:3, color:'#00f', opacity:0.4, strokeWidth:1 },
    { kind: 'card_panel',      x:10, y:10, w:80, h:60, color:'#fff', opacity:0.95, rx:8 },
    { kind: 'card_panel',      x:10, y:10, w:80, h:60, color:'#fff', opacity:0.95, rx:8, shadow:true },
    { kind: 'glow_circle',     x:50, y:50, r:30, color:'#9f6', opacity:0.6 },
    { kind: 'flower',          x:50, y:50, r:20, petals:6, color:'#f9c', opacity:0.8 },
    { kind: 'squiggle',        x:10, y:50, w:80, color:'#fa0', opacity:0.9, strokeWidth:3 },
    { kind: 'arc_stroke',      x:50, y:50, r:30, startAngle:0, endAngle:180, color:'#0af', opacity:1, strokeWidth:4 },
    { kind: 'corner_bracket',  x:10, y:10, size:10, color:'#fff', opacity:1, strokeWidth:2, corner:'tl' },
    { kind: 'corner_bracket',  x:90, y:10, size:10, color:'#fff', opacity:1, strokeWidth:2, corner:'tr' },
    { kind: 'corner_bracket',  x:10, y:90, size:10, color:'#fff', opacity:1, strokeWidth:2, corner:'bl' },
    { kind: 'corner_bracket',  x:90, y:90, size:10, color:'#fff', opacity:1, strokeWidth:2, corner:'br' },
    { kind: 'diagonal_band',   color:'#f00', opacity:0.2, angle:45, thickness:15 },
    { kind: 'noise_overlay',   opacity:0.08 },
  ];

  for (const shape of SHAPES) {
    it(`${shape.kind}${(shape as any).corner ? `-${(shape as any).corner}` : ''}${(shape as any).shadow ? '-shadow' : ''} returns non-empty string`, () => {
      const svg = renderDecoration(shape, W, H);
      expect(typeof svg).toBe('string');
      expect(svg.length).toBeGreaterThan(0);
    });
  }

  it('unknown kind returns empty string', () => {
    const svg = renderDecoration({ kind: 'unknown_shape' } as any, W, H);
    expect(svg).toBe('');
  });
});

describe('renderDecoration — SVG content correctness', () => {
  it('circle includes cx and cy attributes', () => {
    const svg = renderDecoration(circle(), W, H);
    expect(svg).toContain('cx=');
    expect(svg).toContain('cy=');
  });

  it('circle includes the color', () => {
    const svg = renderDecoration(circle({ color: '#ab1234' }), W, H);
    expect(svg).toContain('#ab1234');
  });

  it('circle stroke variant renders stroke instead of fill', () => {
    const svg = renderDecoration(circle({ stroke: true, strokeWidth: 3 }), W, H);
    expect(svg).toContain('stroke=');
    expect(svg).toContain('fill="none"');
  });

  it('rect includes width and height attributes', () => {
    const shape: DecorShape = { kind: 'rect', x:10, y:10, w:30, h:20, color:'#abc', opacity:0.5, rx:4 };
    const svg = renderDecoration(shape, W, H);
    expect(svg).toContain('width=');
    expect(svg).toContain('height=');
  });

  it('badge_pill escapes HTML special chars in text', () => {
    const shape: DecorShape = { kind: 'badge_pill', x:10, y:5, w:30, h:8, color:'#000', text:'A&B<C>', textColor:'#fff', fontSize:14 };
    const svg = renderDecoration(shape, W, H);
    expect(svg).not.toContain('A&B<C>');
    expect(svg).toContain('&amp;');
  });

  it('line includes x1 y1 x2 y2', () => {
    const shape: DecorShape = { kind: 'line', x1:0, y1:0, x2:100, y2:100, color:'#111', opacity:1, width:2 };
    const svg = renderDecoration(shape, W, H);
    expect(svg).toContain('x1=');
    expect(svg).toContain('y1=');
    expect(svg).toContain('x2=');
    expect(svg).toContain('y2=');
  });

  it('line with dash includes stroke-dasharray', () => {
    const shape: DecorShape = { kind: 'line', x1:0, y1:0, x2:100, y2:100, color:'#111', opacity:1, width:2, dash:5 };
    const svg = renderDecoration(shape, W, H);
    expect(svg).toContain('stroke-dasharray');
  });

  it('glow_circle includes radialGradient', () => {
    const shape: DecorShape = { kind: 'glow_circle', x:50, y:50, r:30, color:'#9f6', opacity:0.6 };
    expect(renderDecoration(shape, W, H)).toContain('radialGradient');
  });

  it('wave outputs a path element', () => {
    const shape: DecorShape = { kind: 'wave', x:0, y:80, w:100, amplitude:5, frequency:3, color:'#00f', opacity:0.4, strokeWidth:1 };
    expect(renderDecoration(shape, W, H)).toContain('<path');
  });

  it('blob outputs a path element starting with M', () => {
    const shape: DecorShape = { kind: 'blob', x:50, y:50, size:30, color:'#def', opacity:0.7, seed:42 };
    const svg = renderDecoration(shape, W, H);
    expect(svg).toContain('<path');
    expect(svg).toMatch(/d="M/);
  });

  it('blob is deterministic for same seed', () => {
    const shape: DecorShape = { kind: 'blob', x:50, y:50, size:30, color:'#def', opacity:0.7, seed:99 };
    expect(renderDecoration(shape, W, H)).toBe(renderDecoration(shape, W, H));
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// renderDecorations
// ══════════════════════════════════════════════════════════════════════════════
describe('renderDecorations', () => {
  it('empty array returns empty string', () => {
    expect(renderDecorations([], W, H)).toBe('');
  });

  it('single shape returns same as renderDecoration', () => {
    const shape = circle();
    expect(renderDecorations([shape], W, H)).toContain(renderDecoration(shape, W, H));
  });

  it('multiple shapes are all included in output', () => {
    const shapes: DecorShape[] = [
      circle({ color: '#ff0000' }),
      { kind: 'rect', x:10, y:10, w:20, h:10, color:'#00ff00', opacity:0.5, rx:2 },
    ];
    const svg = renderDecorations(shapes, W, H);
    expect(svg).toContain('#ff0000');
    expect(svg).toContain('#00ff00');
  });

  it('returns a string (never throws)', () => {
    const shapes: DecorShape[] = [
      circle(),
      { kind: 'blob', x:50, y:50, size:30, color:'#abc', opacity:0.5, seed:7 },
    ];
    expect(() => renderDecorations(shapes, W, H)).not.toThrow();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// buildBackgroundDefs
// ══════════════════════════════════════════════════════════════════════════════
describe('buildBackgroundDefs', () => {
  it('solid: defs is empty, fill is the color', () => {
    const bg: BgTreatment = { kind: 'solid', color: '#1a1a2e' };
    const result = buildBackgroundDefs(bg);
    expect(result.defs).toBe('');
    expect(result.fill).toBe('#1a1a2e');
  });

  it('linear_gradient: defs contains linearGradient, fill is url()', () => {
    const bg: BgTreatment = { kind: 'linear_gradient', colors: ['#000', '#fff'], angle: 135 };
    const result = buildBackgroundDefs(bg);
    expect(result.defs).toContain('linearGradient');
    expect(result.fill).toMatch(/url\(#/);
  });

  it('linear_gradient: all colors are embedded in stops', () => {
    const bg: BgTreatment = { kind: 'linear_gradient', colors: ['#ff0000', '#0000ff'], angle: 0 };
    const result = buildBackgroundDefs(bg);
    expect(result.defs).toContain('#ff0000');
    expect(result.defs).toContain('#0000ff');
  });

  it('radial_gradient: defs contains radialGradient', () => {
    const bg: BgTreatment = { kind: 'radial_gradient', colors: ['#fff', '#000'], cx: 50, cy: 50 };
    const result = buildBackgroundDefs(bg);
    expect(result.defs).toContain('radialGradient');
    expect(result.fill).toMatch(/url\(#/);
  });

  it('mesh: defs contains multiple gradients', () => {
    const bg: BgTreatment = { kind: 'mesh', colors: ['#f4511e', '#ff7043', '#e64a19'] };
    const result = buildBackgroundDefs(bg);
    expect(result.defs).toContain('linearGradient');
    expect(result.defs).toContain('radialGradient');
    expect(result.fill).toMatch(/url\(#/);
  });

  it('split: defs contains gradient with splitY', () => {
    const bg: BgTreatment = { kind: 'split', colors: ['#000', '#fff'], splitY: 60 };
    const result = buildBackgroundDefs(bg);
    expect(result.defs).toContain('60%');
    expect(result.fill).toMatch(/url\(#/);
  });

  it('unknown kind returns safe fallback (#ffffff)', () => {
    const bg = { kind: 'unknown' } as any;
    const result = buildBackgroundDefs(bg);
    expect(result.fill).toBe('#ffffff');
  });

  it('all valid kinds return non-empty fill', () => {
    const bgs: BgTreatment[] = [
      { kind: 'solid', color: '#000' },
      { kind: 'linear_gradient', colors: ['#a', '#b'], angle: 0 },
      { kind: 'radial_gradient', colors: ['#a', '#b'], cx: 50, cy: 50 },
      { kind: 'mesh', colors: ['#a', '#b', '#c'] },
      { kind: 'split', colors: ['#a', '#b'], splitY: 50 },
    ];
    for (const bg of bgs) {
      const result = buildBackgroundDefs(bg);
      expect(result.fill.length).toBeGreaterThan(0);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// renderMeshOverlay
// ══════════════════════════════════════════════════════════════════════════════
describe('renderMeshOverlay', () => {
  it('returns empty string for non-mesh backgrounds', () => {
    expect(renderMeshOverlay({ kind: 'solid', color: '#000' }, W, H)).toBe('');
    expect(renderMeshOverlay({ kind: 'linear_gradient', colors: ['#a', '#b'], angle: 0 }, W, H)).toBe('');
  });

  it('returns non-empty string for mesh background', () => {
    const bg: BgTreatment = { kind: 'mesh', colors: ['#f4511e', '#ff7043', '#e64a19'] };
    const result = renderMeshOverlay(bg, W, H);
    expect(result.length).toBeGreaterThan(0);
  });

  it('mesh overlay contains rect elements', () => {
    const bg: BgTreatment = { kind: 'mesh', colors: ['#f4511e', '#ff7043', '#e64a19'] };
    expect(renderMeshOverlay(bg, W, H)).toContain('<rect');
  });

  it('mesh overlay references bg_mesh1 and bg_mesh2', () => {
    const bg: BgTreatment = { kind: 'mesh', colors: ['#f4511e', '#ff7043', '#e64a19'] };
    const result = renderMeshOverlay(bg, W, H);
    expect(result).toContain('bg_mesh1');
    expect(result).toContain('bg_mesh2');
  });

  it('mesh overlay uses canvas dimensions', () => {
    const bg: BgTreatment = { kind: 'mesh', colors: ['#aaa', '#bbb', '#ccc'] };
    const result = renderMeshOverlay(bg, 1080, 1920);
    expect(result).toContain('1920');
  });
});
