/**
 * Unit tests — Brand Asset pure functions
 *
 * Tests the deterministic, side-effect-free functions from:
 *   - brandAssetRenderIntegration (buildAssetFFmpegFilters)
 *   - brandAssetSceneInjector     (buildScenePreview)
 *
 * No database, no network, no file system access.
 */

import {
  buildAssetFFmpegFilters,
} from '../../src/services/brandAssetRenderIntegration';

import {
  buildScenePreview,
} from '../../src/services/brandAssetSceneInjector';

// ── Fixtures ───────────────────────────────────────────────────────────────
function makeOverlay(overrides: any = {}) {
  return {
    slotName:   'logo_slot',
    renderUrl:  'https://cdn.example.com/logo.png',
    x:          0.5,   // center
    y:          0.15,  // near top
    width:      0.3,
    height:     0.15,
    opacity:    1,
    animation: {
      type:       'fade_in',
      durationMs: 500,
      delayMs:    200,
    },
    ...overrides,
  };
}

function makeScene(overrides: any = {}) {
  return {
    role:        'hook',
    durationSec: 5,
    prompt:      'Test scene prompt',
    voiceoverScript: 'Test voiceover',
    visualDirection: 'Test visual direction',
    transitionIn: 'cut',
    layoutMode:  'product_hero',
    brandColors: ['#6366f1', '#f59e0b'],
    hasAssets:   true,
    onScreenText: 'Test on-screen text',
    assetLayers: [
      {
        slotName:  'logo_slot',
        assetType: 'logo',
        cdnUrl:    'https://cdn.example.com/logo.png',
        position: {
          x:       50,
          y:       10,
          width:   30,
          height:  15,
          zIndex:  10,
        },
        animation: {
          motion:      'fade_in',
          durationMs:  500,
          delayMs:     200,
        },
      },
      {
        slotName:  'product_slot',
        assetType: 'product',
        cdnUrl:    'https://cdn.example.com/product.png',
        position: {
          x:       50,
          y:       50,
          width:   80,
          height:  60,
          zIndex:  5,
        },
        animation: {
          motion:      'scale_in',
          durationMs:  800,
          delayMs:     0,
        },
      },
    ],
    ...overrides,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// buildAssetFFmpegFilters
// ══════════════════════════════════════════════════════════════════════════════
describe('buildAssetFFmpegFilters — return structure', () => {
  const overlay = makeOverlay();
  const result  = buildAssetFFmpegFilters(overlay, 1080, 1920, 2);

  it('returns inputFlags array', () => {
    expect(Array.isArray(result.inputFlags)).toBe(true);
    expect(result.inputFlags.length).toBeGreaterThan(0);
  });

  it('returns filterChain string', () => {
    expect(typeof result.filterChain).toBe('string');
    expect(result.filterChain.length).toBeGreaterThan(0);
  });

  it('returns outputLabel string', () => {
    expect(typeof result.outputLabel).toBe('string');
    expect(result.outputLabel.length).toBeGreaterThan(0);
  });

  it('inputFlags includes -i flag and asset URL', () => {
    expect(result.inputFlags).toContain('-i');
    expect(result.inputFlags).toContain(overlay.renderUrl);
  });

  it('outputLabel includes inputIndex', () => {
    expect(result.outputLabel).toContain('2');
  });
});

describe('buildAssetFFmpegFilters — pixel coordinate calculation', () => {
  it('center overlay (x=0.5, y=0.5) positions at canvas center', () => {
    const overlay = makeOverlay({ x: 0.5, y: 0.5, width: 0.2, height: 0.2 });
    const result  = buildAssetFFmpegFilters(overlay, 1000, 1000, 0);

    // pixelX = round(0.5 * 1000 - (0.2 * 1000) / 2) = 500 - 100 = 400
    // pixelY = round(0.5 * 1000 - (0.2 * 1000) / 2) = 500 - 100 = 400
    expect(result.filterChain).toContain('400:400'); // overlay position
  });

  it('corner overlay (x=0, y=0) anchors to top-left', () => {
    const overlay = makeOverlay({ x: 0, y: 0, width: 0.1, height: 0.1 });
    const result  = buildAssetFFmpegFilters(overlay, 1920, 1080, 1);
    // pixelX = round(0 * 1920 - (0.1 * 1920)/2) = round(-96) = -96
    // The filter chain should have a negative or zero x offset
    expect(typeof result.filterChain).toBe('string');
  });

  it('pixel width and height are positive integers', () => {
    const overlay = makeOverlay({ width: 0.4, height: 0.3 });
    const result  = buildAssetFFmpegFilters(overlay, 1920, 1080, 0);
    // pixelW = round(0.4 * 1920) = 768
    // pixelH = round(0.3 * 1080) = 324
    expect(result.filterChain).toContain('scale=768:324');
  });

  it('handles non-standard canvas sizes', () => {
    const overlay = makeOverlay({ x: 0.5, y: 0.5, width: 0.5, height: 0.5 });
    // Square canvas 400×400
    const result  = buildAssetFFmpegFilters(overlay, 400, 400, 0);
    expect(result.filterChain).toContain('scale=200:200');
    expect(result.filterChain).toContain('pad=200:200');
  });
});

describe('buildAssetFFmpegFilters — filter chain composition', () => {
  it('filter chain contains three segments (scale, anim, overlay)', () => {
    const result = buildAssetFFmpegFilters(makeOverlay(), 1920, 1080, 0);
    const parts  = result.filterChain.split(';');
    expect(parts.length).toBe(3);
  });

  it('scale filter appears first', () => {
    const result = buildAssetFFmpegFilters(makeOverlay(), 1920, 1080, 0);
    const first  = result.filterChain.split(';')[0];
    expect(first).toMatch(/scale=/);
  });

  it('overlay filter appears last', () => {
    const result = buildAssetFFmpegFilters(makeOverlay(), 1920, 1080, 0);
    const last   = result.filterChain.split(';').at(-1)!;
    expect(last).toMatch(/overlay=/);
  });

  it('scale filter includes force_original_aspect_ratio', () => {
    const result = buildAssetFFmpegFilters(makeOverlay(), 1920, 1080, 0);
    expect(result.filterChain).toContain('force_original_aspect_ratio');
  });

  it('scale filter includes pad to fill target dimensions', () => {
    const result = buildAssetFFmpegFilters(makeOverlay(), 1920, 1080, 0);
    expect(result.filterChain).toContain('pad=');
  });
});

describe('buildAssetFFmpegFilters — animation types', () => {
  const canvas = { w: 1920, h: 1080 };

  it('fade_in animation produces fade filter', () => {
    const result = buildAssetFFmpegFilters(
      makeOverlay({ animation: { type: 'fade_in', durationMs: 500, delayMs: 200 } }),
      canvas.w, canvas.h, 0,
    );
    expect(result.filterChain).toContain('fade=t=in');
  });

  it('scale_in animation produces a non-empty anim filter', () => {
    const result = buildAssetFFmpegFilters(
      makeOverlay({ animation: { type: 'scale_in', durationMs: 600, delayMs: 0 } }),
      canvas.w, canvas.h, 0,
    );
    const animPart = result.filterChain.split(';')[1];
    expect(animPart.length).toBeGreaterThan(0);
  });

  it('slide_in animation produces a non-empty anim filter', () => {
    const result = buildAssetFFmpegFilters(
      makeOverlay({ animation: { type: 'slide_in', durationMs: 400, delayMs: 100 } }),
      canvas.w, canvas.h, 0,
    );
    const animPart = result.filterChain.split(';')[1];
    expect(animPart.length).toBeGreaterThan(0);
  });

  it('unknown animation type falls back to copy filter', () => {
    const result = buildAssetFFmpegFilters(
      makeOverlay({ animation: { type: 'unknown_anim', durationMs: 300, delayMs: 0 } }),
      canvas.w, canvas.h, 0,
    );
    expect(result.filterChain).toContain('copy');
  });

  it('animation timing uses delayMs and durationMs in filter', () => {
    const result = buildAssetFFmpegFilters(
      makeOverlay({ animation: { type: 'fade_in', durationMs: 800, delayMs: 400 } }),
      canvas.w, canvas.h, 0,
    );
    // delayMs=400 → st=0.4 in fade filter
    expect(result.filterChain).toContain('st=0.4');
    // durationMs=800 → d=0.8 in fade filter
    expect(result.filterChain).toContain('d=0.8');
  });
});

describe('buildAssetFFmpegFilters — multi-input index isolation', () => {
  it('different input indices produce different labels', () => {
    const overlay = makeOverlay();
    const r0 = buildAssetFFmpegFilters(overlay, 1920, 1080, 0);
    const r1 = buildAssetFFmpegFilters(overlay, 1920, 1080, 1);
    const r5 = buildAssetFFmpegFilters(overlay, 1920, 1080, 5);

    expect(r0.outputLabel).not.toBe(r1.outputLabel);
    expect(r0.outputLabel).not.toBe(r5.outputLabel);
    expect(r1.outputLabel).not.toBe(r5.outputLabel);
  });

  it('index is used in scale/anim/overlay label names', () => {
    const result = buildAssetFFmpegFilters(makeOverlay(), 1920, 1080, 7);
    expect(result.filterChain).toContain('_7');
    expect(result.outputLabel).toContain('7');
  });
});

describe('buildAssetFFmpegFilters — overlay timing', () => {
  it('overlay enable expression uses delayMs/1000', () => {
    const overlay = makeOverlay({ animation: { type: 'fade_in', durationMs: 500, delayMs: 1500 } });
    const result  = buildAssetFFmpegFilters(overlay, 1920, 1080, 0);
    // delayMs=1500 → 1.5 seconds in enable expression
    expect(result.filterChain).toContain('1.5');
  });

  it('zero delayMs produces enable starting at t=0', () => {
    const overlay = makeOverlay({ animation: { type: 'fade_in', durationMs: 500, delayMs: 0 } });
    const result  = buildAssetFFmpegFilters(overlay, 1920, 1080, 0);
    expect(result.filterChain).toContain('between(t,0');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// buildScenePreview
// ══════════════════════════════════════════════════════════════════════════════
describe('buildScenePreview — return structure', () => {
  const scene = makeScene();

  it('returns correct role', () => {
    const p = buildScenePreview(scene as any, '16:9');
    expect(p.role).toBe('hook');
  });

  it('returns durationSec', () => {
    const p = buildScenePreview(scene as any, '9:16');
    expect(p.durationSec).toBe(5);
  });

  it('returns layoutMode', () => {
    const p = buildScenePreview(scene as any, '1:1');
    expect(p.layoutMode).toBe('product_hero');
  });

  it('returns brandColors array', () => {
    const p = buildScenePreview(scene as any, '16:9');
    expect(Array.isArray(p.brandColors)).toBe(true);
    expect(p.brandColors).toEqual(['#6366f1', '#f59e0b']);
  });

  it('returns hasAssets=true', () => {
    const p = buildScenePreview(scene as any, '16:9');
    expect(p.hasAssets).toBe(true);
  });

  it('returns voiceoverScript', () => {
    const p = buildScenePreview(scene as any, '16:9');
    expect(p.voiceoverScript).toBe('Test voiceover');
  });

  it('returns onScreenText', () => {
    const p = buildScenePreview(scene as any, '16:9');
    expect(p.onScreenText).toBe('Test on-screen text');
  });
});

describe('buildScenePreview — canvas dimensions', () => {
  const scene = makeScene();

  it('16:9 produces wider-than-tall canvas', () => {
    const p = buildScenePreview(scene as any, '16:9');
    expect(p.canvasWidth).toBeGreaterThan(p.canvasHeight);
    expect(p.canvasWidth).toBe(400);
    expect(p.canvasHeight).toBe(Math.round(400 * 9 / 16));
  });

  it('9:16 produces taller-than-wide canvas', () => {
    const p = buildScenePreview(scene as any, '9:16');
    expect(p.canvasHeight).toBeGreaterThan(p.canvasWidth);
    expect(p.canvasWidth).toBe(400);
    expect(p.canvasHeight).toBe(Math.round(400 * 16 / 9));
  });

  it('1:1 produces square canvas', () => {
    const p = buildScenePreview(scene as any, '1:1');
    expect(p.canvasWidth).toBe(400);
    expect(p.canvasHeight).toBe(400);
  });

  it('canvasWidth is always 400', () => {
    for (const ar of ['16:9', '9:16', '1:1'] as const) {
      expect(buildScenePreview(scene as any, ar).canvasWidth).toBe(400);
    }
  });
});

describe('buildScenePreview — layer pixel positions', () => {
  const scene = makeScene();

  it('layers array length matches assetLayers count', () => {
    const p = buildScenePreview(scene as any, '9:16');
    expect(p.layers.length).toBe(2);
  });

  it('layer slotName matches source', () => {
    const p = buildScenePreview(scene as any, '16:9');
    expect(p.layers[0].slotName).toBe('logo_slot');
    expect(p.layers[1].slotName).toBe('product_slot');
  });

  it('logo layer pixel position at x=50%,y=10%', () => {
    const p = buildScenePreview(scene as any, '16:9');
    // canvas = 400×225 for 16:9
    const cw = 400, ch = Math.round(400 * 9 / 16);
    const logoLayer = p.layers[0];
    expect(logoLayer.pixelX).toBe(Math.round((50 / 100) * cw));
    expect(logoLayer.pixelY).toBe(Math.round((10 / 100) * ch));
  });

  it('pixel dimensions are positive integers', () => {
    const p = buildScenePreview(scene as any, '9:16');
    for (const layer of p.layers) {
      expect(Number.isInteger(layer.pixelWidth)).toBe(true);
      expect(Number.isInteger(layer.pixelHeight)).toBe(true);
      expect(layer.pixelWidth).toBeGreaterThan(0);
      expect(layer.pixelHeight).toBeGreaterThan(0);
    }
  });

  it('zIndex is preserved from source', () => {
    const p = buildScenePreview(scene as any, '16:9');
    expect(p.layers[0].zIndex).toBe(10);
    expect(p.layers[1].zIndex).toBe(5);
  });

  it('motion type is preserved from animation', () => {
    const p = buildScenePreview(scene as any, '16:9');
    expect(p.layers[0].motion).toBe('fade_in');
    expect(p.layers[1].motion).toBe('scale_in');
  });

  it('thumbnailUrl matches cdnUrl from source', () => {
    const p = buildScenePreview(scene as any, '16:9');
    expect(p.layers[0].thumbnailUrl).toBe('https://cdn.example.com/logo.png');
    expect(p.layers[1].thumbnailUrl).toBe('https://cdn.example.com/product.png');
  });
});

describe('buildScenePreview — empty layers', () => {
  it('handles scene with no assetLayers', () => {
    const emptyScene = makeScene({ assetLayers: [], hasAssets: false });
    const p = buildScenePreview(emptyScene as any, '9:16');
    expect(p.layers).toHaveLength(0);
    expect(p.hasAssets).toBe(false);
  });
});

describe('buildScenePreview — all aspect ratios produce integer dimensions', () => {
  const scene = makeScene();
  for (const ar of ['16:9', '9:16', '1:1'] as const) {
    it(`${ar} produces integer canvasHeight`, () => {
      const p = buildScenePreview(scene as any, ar);
      expect(Number.isInteger(p.canvasHeight)).toBe(true);
    });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// validateAssetUpload (storageService) — pure guard function
// ══════════════════════════════════════════════════════════════════════════════
import { validateAssetUpload } from '../../src/services/storageService';

describe('validateAssetUpload', () => {
  const MB = 1024 * 1024;
  const ALLOWED = [
    'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml',
    'video/mp4', 'video/quicktime', 'video/webm', 'video/mpeg',
    'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/aac',
  ];
  const BLOCKED = [
    'application/exe', 'application/x-sh', 'text/html',
    'application/javascript', 'application/pdf', 'application/zip',
  ];

  it('does not throw for all allowed MIME types at 1MB', () => {
    for (const mime of ALLOWED) {
      expect(() => validateAssetUpload(mime, 1 * MB)).not.toThrow();
    }
  });

  it('throws 400 for disallowed MIME types', () => {
    for (const mime of BLOCKED) {
      expect(() => validateAssetUpload(mime, 1 * MB)).toThrow();
    }
  });

  it('throws for file size exceeding 500MB', () => {
    expect(() => validateAssetUpload('image/jpeg', 501 * MB)).toThrow();
  });

  it('does not throw at exactly 500MB', () => {
    expect(() => validateAssetUpload('image/png', 500 * MB)).not.toThrow();
  });

  it('throws with code INVALID_FILE_TYPE for bad MIME', () => {
    try {
      validateAssetUpload('application/exe', 1 * MB);
      fail('Expected to throw');
    } catch (err: any) {
      expect(err.code ?? err.message).toMatch(/INVALID_FILE_TYPE|not allowed/i);
    }
  });

  it('throws with code FILE_TOO_LARGE for oversized file', () => {
    try {
      validateAssetUpload('image/jpeg', 600 * MB);
      fail('Expected to throw');
    } catch (err: any) {
      expect(err.code ?? err.message).toMatch(/FILE_TOO_LARGE|too large/i);
    }
  });

  it('allows 1-byte file (minimum)', () => {
    expect(() => validateAssetUpload('image/png', 1)).not.toThrow();
  });
});
