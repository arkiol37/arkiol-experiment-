/**
 * apps/animation-studio/backend/tests/unit/buildScenePreview.test.ts
 *
 * Unit tests for services/brandAssetSceneInjector.ts → buildScenePreview()
 *
 * Pure function — no DB, no network, no file I/O.
 *
 * Covers:
 *  - Canvas dimensions per aspect ratio (16:9, 9:16, 1:1)
 *  - Pixel position math (percent 0-100 → absolute px)
 *  - All SceneSpec fields preserved in output
 *  - Layer mapping: thumbnailUrl, zIndex, motion
 *  - Empty asset layers
 *  - Multiple layers
 */

import { buildScenePreview } from '../../../../src/services/brandAssetSceneInjector';
import type { EnrichedSceneSpec, SceneAssetLayer } from '../../../../src/services/brandAssetSceneInjector';

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeLayer(overrides: Partial<SceneAssetLayer> = {}): SceneAssetLayer {
  return {
    slotName:  'logo_slot',
    assetId:   'asset-001',
    assetType: 'logo',
    cdnUrl:    'https://cdn.test/logo.png',
    vectorUrl: null,
    position:  { x: 50, y: 50, width: 30, height: 15, zIndex: 10 },
    animation: {
      motion:       'fade' as any,
      durationMs:   500,
      delayMs:      200,
      easing:       'ease-in-out',
      repeat:       'once',
      scaleFrom:    0.8,
      scaleTo:      1.0,
      opacityFrom:  0,
      opacityTo:    1,
      translateX:   0,
      translateY:   0,
    },
    ...overrides,
  };
}

function makeScene(overrides: Partial<EnrichedSceneSpec> = {}): EnrichedSceneSpec {
  return {
    role:             'hook',
    durationSec:      3,
    prompt:           'Show energetic product shot',
    voiceoverScript:  'Introducing the future of fitness',
    visualDirection:  'Hero product on bright background',
    onScreenText:     'Launch Sale',
    transitionIn:     'cut',
    assetLayers:      [],
    brandColors: {
      primary:    '#FF5733',
      secondary:  '#33FF57',
      accent:     '#5733FF',
      background: '#FFFFFF',
    },
    hasAssets:   false,
    layoutMode:  'text_only',
    ...overrides,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// Canvas dimensions per aspect ratio
// ══════════════════════════════════════════════════════════════════════════════
describe('buildScenePreview — canvas dimensions', () => {
  it('16:9 → canvasWidth=400, canvasHeight=225', () => {
    const preview = buildScenePreview(makeScene(), '16:9');
    expect(preview.canvasWidth).toBe(400);
    expect(preview.canvasHeight).toBe(225); // round(400 * 9/16)
  });

  it('9:16 → canvasWidth=400, canvasHeight=711', () => {
    const preview = buildScenePreview(makeScene(), '9:16');
    expect(preview.canvasWidth).toBe(400);
    expect(preview.canvasHeight).toBe(711); // round(400 * 16/9)
  });

  it('1:1 → canvasWidth=400, canvasHeight=400', () => {
    const preview = buildScenePreview(makeScene(), '1:1');
    expect(preview.canvasWidth).toBe(400);
    expect(preview.canvasHeight).toBe(400);
  });

  it('canvasWidth is always 400 regardless of aspect ratio', () => {
    for (const ar of ['16:9', '9:16', '1:1'] as const) {
      expect(buildScenePreview(makeScene(), ar).canvasWidth).toBe(400);
    }
  });

  it('canvasHeight is a positive integer', () => {
    for (const ar of ['16:9', '9:16', '1:1'] as const) {
      const h = buildScenePreview(makeScene(), ar).canvasHeight;
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThan(0);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// SceneSpec fields preserved
// ══════════════════════════════════════════════════════════════════════════════
describe('buildScenePreview — scene fields', () => {
  it('preserves role', () => {
    expect(buildScenePreview(makeScene({ role: 'cta' }), '1:1').role).toBe('cta');
  });

  it('preserves durationSec', () => {
    expect(buildScenePreview(makeScene({ durationSec: 5 }), '1:1').durationSec).toBe(5);
  });

  it('preserves layoutMode', () => {
    expect(buildScenePreview(makeScene({ layoutMode: 'asset_hero' }), '1:1').layoutMode).toBe('asset_hero');
  });

  it('preserves brandColors', () => {
    const colors = { primary: '#AAA', secondary: '#BBB', accent: '#CCC', background: '#DDD' };
    const preview = buildScenePreview(makeScene({ brandColors: colors }), '1:1');
    expect(preview.brandColors).toEqual(colors);
  });

  it('preserves hasAssets', () => {
    expect(buildScenePreview(makeScene({ hasAssets: true }), '1:1').hasAssets).toBe(true);
    expect(buildScenePreview(makeScene({ hasAssets: false }), '1:1').hasAssets).toBe(false);
  });

  it('preserves onScreenText', () => {
    expect(buildScenePreview(makeScene({ onScreenText: 'Buy Now' }), '1:1').onScreenText).toBe('Buy Now');
  });

  it('preserves voiceoverScript', () => {
    const scene = makeScene({ voiceoverScript: 'This is the voiceover.' });
    expect(buildScenePreview(scene, '1:1').voiceoverScript).toBe('This is the voiceover.');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Layer pixel position math
// ══════════════════════════════════════════════════════════════════════════════
describe('buildScenePreview — layer pixel positions', () => {
  it('layer at (50%, 50%) on 1:1 canvas → pixelX=200, pixelY=200', () => {
    // canvasWidth=400, canvasHeight=400
    // pixelX = round(50/100 * 400) = 200
    // pixelY = round(50/100 * 400) = 200
    const layer = makeLayer({ position: { x: 50, y: 50, width: 30, height: 30, zIndex: 5 } });
    const preview = buildScenePreview(makeScene({ assetLayers: [layer] }), '1:1');
    expect(preview.layers[0]!.pixelX).toBe(200);
    expect(preview.layers[0]!.pixelY).toBe(200);
  });

  it('layer width/height in % → correct pixel dimensions', () => {
    // width=25% of 400 = 100, height=25% of 400 = 100
    const layer = makeLayer({ position: { x: 50, y: 50, width: 25, height: 25, zIndex: 5 } });
    const preview = buildScenePreview(makeScene({ assetLayers: [layer] }), '1:1');
    expect(preview.layers[0]!.pixelWidth).toBe(100);
    expect(preview.layers[0]!.pixelHeight).toBe(100);
  });

  it('layer at top-left (0%, 0%) → pixelX=0, pixelY=0', () => {
    const layer = makeLayer({ position: { x: 0, y: 0, width: 10, height: 10, zIndex: 1 } });
    const preview = buildScenePreview(makeScene({ assetLayers: [layer] }), '1:1');
    expect(preview.layers[0]!.pixelX).toBe(0);
    expect(preview.layers[0]!.pixelY).toBe(0);
  });

  it('layer at full extent (100%, 100%) → pixelX=400, pixelY=400 on 1:1', () => {
    const layer = makeLayer({ position: { x: 100, y: 100, width: 10, height: 10, zIndex: 1 } });
    const preview = buildScenePreview(makeScene({ assetLayers: [layer] }), '1:1');
    expect(preview.layers[0]!.pixelX).toBe(400);
    expect(preview.layers[0]!.pixelY).toBe(400);
  });

  it('pixel values are integers (Math.round applied)', () => {
    // Use values that would produce non-integers without rounding
    const layer = makeLayer({ position: { x: 33, y: 33, width: 33, height: 33, zIndex: 1 } });
    const preview = buildScenePreview(makeScene({ assetLayers: [layer] }), '1:1');
    expect(Number.isInteger(preview.layers[0]!.pixelX)).toBe(true);
    expect(Number.isInteger(preview.layers[0]!.pixelY)).toBe(true);
    expect(Number.isInteger(preview.layers[0]!.pixelWidth)).toBe(true);
    expect(Number.isInteger(preview.layers[0]!.pixelHeight)).toBe(true);
  });

  it('pixel dimensions scale correctly for 16:9 canvas height', () => {
    // 16:9: canvasHeight = round(400 * 9/16) = 225
    // layer y=50%, pixelY = round(50/100 * 225) = 113 (rounded)
    const layer = makeLayer({ position: { x: 50, y: 50, width: 50, height: 50, zIndex: 1 } });
    const preview = buildScenePreview(makeScene({ assetLayers: [layer] }), '16:9');
    expect(preview.layers[0]!.pixelY).toBe(113);
    expect(preview.layers[0]!.pixelHeight).toBe(113);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Layer field mapping
// ══════════════════════════════════════════════════════════════════════════════
describe('buildScenePreview — layer field mapping', () => {
  it('thumbnailUrl comes from cdnUrl', () => {
    const layer = makeLayer({ cdnUrl: 'https://cdn.test/thumb.jpg' });
    const preview = buildScenePreview(makeScene({ assetLayers: [layer] }), '1:1');
    expect(preview.layers[0]!.thumbnailUrl).toBe('https://cdn.test/thumb.jpg');
  });

  it('slotName is preserved', () => {
    const layer = makeLayer({ slotName: 'product_slot' });
    const preview = buildScenePreview(makeScene({ assetLayers: [layer] }), '1:1');
    expect(preview.layers[0]!.slotName).toBe('product_slot');
  });

  it('assetType is preserved', () => {
    const layer = makeLayer({ assetType: 'product' });
    const preview = buildScenePreview(makeScene({ assetLayers: [layer] }), '1:1');
    expect(preview.layers[0]!.assetType).toBe('product');
  });

  it('zIndex is preserved', () => {
    const layer = makeLayer({ position: { x: 50, y: 50, width: 20, height: 20, zIndex: 99 } });
    const preview = buildScenePreview(makeScene({ assetLayers: [layer] }), '1:1');
    expect(preview.layers[0]!.zIndex).toBe(99);
  });

  it('motion comes from animation.motion', () => {
    const layer = makeLayer({ animation: { ...makeLayer().animation, motion: 'float' as any } });
    const preview = buildScenePreview(makeScene({ assetLayers: [layer] }), '1:1');
    expect(preview.layers[0]!.motion).toBe('float');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Multiple layers and empty layers
// ══════════════════════════════════════════════════════════════════════════════
describe('buildScenePreview — layer count', () => {
  it('empty assetLayers → layers array is empty', () => {
    const preview = buildScenePreview(makeScene({ assetLayers: [] }), '1:1');
    expect(preview.layers).toEqual([]);
  });

  it('single layer → layers.length=1', () => {
    const preview = buildScenePreview(makeScene({ assetLayers: [makeLayer()] }), '1:1');
    expect(preview.layers.length).toBe(1);
  });

  it('three layers → layers.length=3', () => {
    const layers = [
      makeLayer({ slotName: 'logo_slot' }),
      makeLayer({ slotName: 'product_slot' }),
      makeLayer({ slotName: 'background_slot' }),
    ];
    const preview = buildScenePreview(makeScene({ assetLayers: layers }), '1:1');
    expect(preview.layers.length).toBe(3);
  });

  it('layer order is preserved', () => {
    const layers = [
      makeLayer({ slotName: 'first' }),
      makeLayer({ slotName: 'second' }),
      makeLayer({ slotName: 'third' }),
    ];
    const preview = buildScenePreview(makeScene({ assetLayers: layers }), '1:1');
    expect(preview.layers[0]!.slotName).toBe('first');
    expect(preview.layers[1]!.slotName).toBe('second');
    expect(preview.layers[2]!.slotName).toBe('third');
  });
});
