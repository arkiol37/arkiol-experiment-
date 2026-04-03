/**
 * apps/animation-studio/backend/tests/unit/brandAssetRenderIntegration.test.ts
 *
 * Unit tests for services/brandAssetRenderIntegration.ts
 *
 * Only the single pure function buildAssetFFmpegFilters is tested here —
 * all async DB functions are integration concerns.
 *
 * Covers:
 *  - pixel coordinate math (x/y/w/h from normalised 0-1 inputs)
 *  - filterChain structure: scale + anim + overlay segments present
 *  - inputFlags always includes '-i' + renderUrl
 *  - outputLabel format
 *  - animation type handling: fade_in, scale_in, slide_in, static/default
 *  - inputIndex isolation (no cross-contamination between calls)
 *  - edge cases: zero-size overlay, unit canvas, corner placements
 */

import {
  buildAssetFFmpegFilters,
  type SceneAssetOverlay,
} from '../../../../src/services/brandAssetRenderIntegration';

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeOverlay(overrides: Partial<SceneAssetOverlay> = {}): SceneAssetOverlay {
  return {
    assetId:   'asset-001',
    assetType: 'logo',
    renderUrl: 'https://cdn.test/logo.png',
    isVector:  false,
    x:         0.5,
    y:         0.5,
    width:     0.2,
    height:    0.1,
    zIndex:    10,
    animation: {
      type:       'fade_in',
      durationMs: 500,
      delayMs:    200,
      easing:     'ease-in-out',
    },
    ...overrides,
  };
}

const W = 1920;
const H = 1080;

// ══════════════════════════════════════════════════════════════════════════════
// Return shape
// ══════════════════════════════════════════════════════════════════════════════
describe('buildAssetFFmpegFilters — return shape', () => {
  it('returns inputFlags, filterChain, and outputLabel', () => {
    const result = buildAssetFFmpegFilters(makeOverlay(), W, H, 0);
    expect(Array.isArray(result.inputFlags)).toBe(true);
    expect(typeof result.filterChain).toBe('string');
    expect(typeof result.outputLabel).toBe('string');
  });

  it('inputFlags contains "-i" followed by the renderUrl', () => {
    const overlay = makeOverlay({ renderUrl: 'https://cdn.test/my-asset.png' });
    const { inputFlags } = buildAssetFFmpegFilters(overlay, W, H, 0);
    expect(inputFlags).toContain('-i');
    expect(inputFlags).toContain('https://cdn.test/my-asset.png');
  });

  it('inputFlags has exactly 2 entries ["-i", url]', () => {
    const { inputFlags } = buildAssetFFmpegFilters(makeOverlay(), W, H, 0);
    expect(inputFlags.length).toBe(2);
    expect(inputFlags[0]).toBe('-i');
  });

  it('outputLabel is "out_{inputIndex}"', () => {
    expect(buildAssetFFmpegFilters(makeOverlay(), W, H, 0).outputLabel).toBe('out_0');
    expect(buildAssetFFmpegFilters(makeOverlay(), W, H, 3).outputLabel).toBe('out_3');
    expect(buildAssetFFmpegFilters(makeOverlay(), W, H, 7).outputLabel).toBe('out_7');
  });

  it('filterChain is a non-empty string', () => {
    const { filterChain } = buildAssetFFmpegFilters(makeOverlay(), W, H, 0);
    expect(filterChain.length).toBeGreaterThan(10);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Pixel coordinate math
// ══════════════════════════════════════════════════════════════════════════════
describe('buildAssetFFmpegFilters — pixel coordinate math', () => {
  it('centred overlay on 1920×1080 canvas produces correct pixel dimensions', () => {
    // x=0.5, y=0.5, width=0.2, height=0.1
    // pixelW = round(0.2 * 1920) = 384
    // pixelH = round(0.1 * 1080) = 108
    const { filterChain } = buildAssetFFmpegFilters(makeOverlay(), W, H, 0);
    expect(filterChain).toContain('scale=384:108');
  });

  it('pixel width and height appear in the scale filter', () => {
    const overlay = makeOverlay({ width: 0.25, height: 0.25, x: 0.5, y: 0.5 });
    // pixelW = round(0.25 * 1920) = 480, pixelH = round(0.25 * 1080) = 270
    const { filterChain } = buildAssetFFmpegFilters(overlay, W, H, 1);
    expect(filterChain).toContain('scale=480:270');
  });

  it('scale filter uses force_original_aspect_ratio and pad', () => {
    const { filterChain } = buildAssetFFmpegFilters(makeOverlay(), W, H, 0);
    expect(filterChain).toContain('force_original_aspect_ratio=decrease');
    expect(filterChain).toContain('pad=');
  });

  it('overlay position includes pixelX and pixelY', () => {
    // x=0.5, y=0.5, width=0.2, height=0.1
    // pixelX = round(0.5 * 1920 - (0.2 * 1920) / 2) = round(960 - 192) = 768
    // pixelY = round(0.5 * 1080 - (0.1 * 1080) / 2) = round(540 - 54) = 486
    const { filterChain } = buildAssetFFmpegFilters(makeOverlay(), W, H, 0);
    expect(filterChain).toContain('overlay=768:486');
  });

  it('top-left placement (x=0, y=0) produces pixelX and pixelY near 0', () => {
    const overlay = makeOverlay({ x: 0.1, y: 0.1, width: 0.2, height: 0.2 });
    // pixelX = round(0.1*1920 - 0.1*1920) = 0
    // pixelY = round(0.1*1080 - 0.1*1080) = 0
    const { filterChain } = buildAssetFFmpegFilters(overlay, W, H, 0);
    expect(filterChain).toContain('overlay=0:0');
  });

  it('uses Math.round for pixel values (no fractional px)', () => {
    // Use values that would produce non-integer pixels without rounding
    const overlay = makeOverlay({ x: 0.33, y: 0.33, width: 0.33, height: 0.33 });
    const { filterChain } = buildAssetFFmpegFilters(overlay, W, H, 0);
    // Just verify it produces a valid filter string (no NaN, no decimals in scale)
    expect(filterChain).toMatch(/scale=\d+:\d+/);
    expect(filterChain).not.toContain('NaN');
  });

  it('square canvas (1080×1080) produces correct pixel values', () => {
    const overlay = makeOverlay({ x: 0.5, y: 0.5, width: 0.5, height: 0.5 });
    // pixelW = round(0.5 * 1080) = 540, pixelH = round(0.5 * 1080) = 540
    const { filterChain } = buildAssetFFmpegFilters(overlay, 1080, 1080, 0);
    expect(filterChain).toContain('scale=540:540');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// FilterChain structure
// ══════════════════════════════════════════════════════════════════════════════
describe('buildAssetFFmpegFilters — filterChain structure', () => {
  it('filterChain contains three semicolon-separated segments', () => {
    const { filterChain } = buildAssetFFmpegFilters(makeOverlay(), W, H, 0);
    const segments = filterChain.split(';');
    expect(segments.length).toBe(3);
  });

  it('first segment is the scale filter', () => {
    const { filterChain } = buildAssetFFmpegFilters(makeOverlay(), W, H, 0);
    const [scaleSegment] = filterChain.split(';');
    expect(scaleSegment).toContain('scale=');
    expect(scaleSegment).toContain('[scaled_0]');
  });

  it('third segment is the overlay filter', () => {
    const { filterChain } = buildAssetFFmpegFilters(makeOverlay(), W, H, 0);
    const segments = filterChain.split(';');
    const overlaySegment = segments[2]!;
    expect(overlaySegment).toContain('overlay=');
    expect(overlaySegment).toContain('[out_0]');
  });

  it('filterChain references correct inputIndex labels throughout', () => {
    const { filterChain } = buildAssetFFmpegFilters(makeOverlay(), W, H, 5);
    expect(filterChain).toContain('[scaled_5]');
    expect(filterChain).toContain('[anim_5]');
    expect(filterChain).toContain('[out_5]');
  });

  it('inputIndex=0 and inputIndex=2 produce no label cross-contamination', () => {
    const fc0 = buildAssetFFmpegFilters(makeOverlay(), W, H, 0).filterChain;
    const fc2 = buildAssetFFmpegFilters(makeOverlay(), W, H, 2).filterChain;
    expect(fc0).not.toContain('_2]');
    expect(fc2).not.toContain('_0]');
  });

  it('overlay filter includes enable timing from delayMs', () => {
    const overlay = makeOverlay({ animation: { type: 'fade_in', durationMs: 500, delayMs: 1000, easing: 'linear' } });
    const { filterChain } = buildAssetFFmpegFilters(overlay, W, H, 0);
    // enable='between(t,1,9999)' — delayMs=1000 → 1s
    expect(filterChain).toContain("between(t,1,9999)");
  });

  it('overlay enable time is 0 when delayMs=0', () => {
    const overlay = makeOverlay({ animation: { type: 'fade_in', durationMs: 500, delayMs: 0, easing: 'linear' } });
    const { filterChain } = buildAssetFFmpegFilters(overlay, W, H, 0);
    expect(filterChain).toContain("between(t,0,9999)");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Animation types
// ══════════════════════════════════════════════════════════════════════════════
describe('buildAssetFFmpegFilters — animation types', () => {
  it('fade_in uses fade filter', () => {
    const overlay = makeOverlay({ animation: { type: 'fade_in', durationMs: 500, delayMs: 0, easing: '' } });
    const { filterChain } = buildAssetFFmpegFilters(overlay, W, H, 0);
    expect(filterChain).toContain('fade=t=in');
  });

  it('scale_in falls back to fade filter (approximation)', () => {
    const overlay = makeOverlay({ animation: { type: 'scale_in', durationMs: 400, delayMs: 0, easing: '' } });
    const { filterChain } = buildAssetFFmpegFilters(overlay, W, H, 0);
    // scale_in uses fade as approximation per implementation comment
    expect(filterChain).toContain('fade=t=in');
  });

  it('slide_in falls back to fade filter', () => {
    const overlay = makeOverlay({ animation: { type: 'slide_in', durationMs: 300, delayMs: 100, easing: '' } });
    const { filterChain } = buildAssetFFmpegFilters(overlay, W, H, 0);
    expect(filterChain).toContain('fade=t=in');
  });

  it('unknown animation type falls back to copy filter', () => {
    const overlay = makeOverlay({ animation: { type: 'unknown_type', durationMs: 500, delayMs: 0, easing: '' } });
    const { filterChain } = buildAssetFFmpegFilters(overlay, W, H, 0);
    expect(filterChain).toContain('copy');
  });

  it('static/no-animation (empty string) falls back to copy filter', () => {
    const overlay = makeOverlay({ animation: { type: '', durationMs: 0, delayMs: 0, easing: '' } });
    const { filterChain } = buildAssetFFmpegFilters(overlay, W, H, 0);
    expect(filterChain).toContain('copy');
  });

  it('fade timing uses durationMs converted to seconds', () => {
    const overlay = makeOverlay({ animation: { type: 'fade_in', durationMs: 750, delayMs: 250, easing: '' } });
    const { filterChain } = buildAssetFFmpegFilters(overlay, W, H, 0);
    // d=0.75 (750ms), st=0.25 (250ms)
    expect(filterChain).toContain('d=0.75');
    expect(filterChain).toContain('st=0.25');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Edge cases
// ══════════════════════════════════════════════════════════════════════════════
describe('buildAssetFFmpegFilters — edge cases', () => {
  it('does not throw for any valid inputIndex 0–20', () => {
    for (let i = 0; i <= 20; i++) {
      expect(() => buildAssetFFmpegFilters(makeOverlay(), W, H, i)).not.toThrow();
    }
  });

  it('different renderUrls produce different inputFlags', () => {
    const a = buildAssetFFmpegFilters(makeOverlay({ renderUrl: 'https://a.test/a.png' }), W, H, 0);
    const b = buildAssetFFmpegFilters(makeOverlay({ renderUrl: 'https://b.test/b.png' }), W, H, 0);
    expect(a.inputFlags[1]).not.toBe(b.inputFlags[1]);
  });

  it('different inputIndex values produce non-overlapping labels', () => {
    const results = [0, 1, 2, 3].map(i => buildAssetFFmpegFilters(makeOverlay(), W, H, i));
    const labels = results.map(r => r.outputLabel);
    expect(new Set(labels).size).toBe(4);
  });

  it('full-canvas overlay (width=1, height=1) produces canvas-sized pixel dims', () => {
    const overlay = makeOverlay({ x: 0.5, y: 0.5, width: 1.0, height: 1.0 });
    const { filterChain } = buildAssetFFmpegFilters(overlay, W, H, 0);
    expect(filterChain).toContain(`scale=${W}:${H}`);
  });
});
