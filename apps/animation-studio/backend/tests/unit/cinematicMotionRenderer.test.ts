/**
 * Unit Tests — Cinematic Motion Renderer
 *
 * Verifies:
 *   1. isCinematicMode detection
 *   2. buildCinematicPrompt enrichment
 *   3. buildCinematicSceneDescriptor structure & correctness
 *   4. enrichScenesForCinematicMode batch processing
 *   5. Camera keyframe generation per move type
 *   6. Depth layer configuration consistency
 *   7. Asset layer construction (positions, keyframes, shadows)
 *   8. Typography motion preset assignment
 *   9. FFmpeg filter chain generation
 *  10. Normal mode passthrough (no cinematic layers added)
 *  11. Graceful degradation (missing assets, unknown roles)
 *  12. AD_STYLE_CONFIGS contract
 */

import {
  isCinematicMode,
  buildCinematicPrompt,
  buildCinematicSceneDescriptor,
  enrichScenesForCinematicMode,
  DEPTH_CONFIG,
  AD_STYLE_CONFIGS,
  type DepthLayer,
  type CameraMove,
} from '../../src/services/cinematicMotionRenderer';
import type { RenderConfig, SceneData } from '../../src/jobs/renderQueue';

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeRenderConfig(overrides: Partial<RenderConfig> = {}): RenderConfig {
  return {
    aspectRatio: '9:16',
    renderMode: 'Cinematic Ad',
    resolution: '1080p',
    mood: 'Cinematic',
    voice: { gender: 'Female', tone: 'Confident', accent: 'American English', speed: 'Normal' },
    music: { style: 'Cinematic Ambient', energyCurve: 'Build Up', beatSync: true },
    creditsToCharge: 35,
    adStyle: 'cinematic',
    ...overrides,
  };
}

function makeScene(overrides: Partial<SceneData> & { role?: string } = {}): SceneData & { role: string } {
  return {
    id: 'scene-test-001',
    position: 0,
    prompt: 'Product hero shot showing the app dashboard',
    voiceoverScript: 'Transform your workflow with one tool.',
    role: 'hook',
    timing: { durationSec: 7 },
    visualConfig: { onScreenText: 'Work Smarter.' },
    ...overrides,
  } as any;
}

// ── 1. isCinematicMode ────────────────────────────────────────────────────────

describe('isCinematicMode', () => {
  it('returns true for Premium Cinematic renderMode', () => {
    expect(isCinematicMode(makeRenderConfig({ renderMode: 'Cinematic Ad' }))).toBe(true);
  });

  it('returns true for adStyle=cinematic', () => {
    expect(isCinematicMode(makeRenderConfig({ renderMode: 'Normal Ad', adStyle: 'cinematic' }))).toBe(true);
  });

  it('returns false for 2D Standard without adStyle', () => {
    expect(isCinematicMode(makeRenderConfig({ renderMode: 'Normal Ad', adStyle: 'normal' }))).toBe(false);
  });

  it('returns false for non-cinematic modes', () => {
    expect(isCinematicMode(makeRenderConfig({ renderMode: 'Cinematic Ad', adStyle: 'normal' }))).toBe(false);
  });
});

// ── 2. buildCinematicPrompt ───────────────────────────────────────────────────

describe('buildCinematicPrompt', () => {
  it('appends lighting descriptor to base prompt', () => {
    const { cinematicConfig } = buildCinematicSceneDescriptor(makeScene(), makeRenderConfig(), 7000);
    const result = buildCinematicPrompt('Product showcase', cinematicConfig);
    expect(result).toContain('Product showcase');
    expect(result.length).toBeGreaterThan('Product showcase'.length);
  });

  it('includes brand colors when provided', () => {
    const { cinematicConfig } = buildCinematicSceneDescriptor(makeScene(), makeRenderConfig(), 7000);
    const result = buildCinematicPrompt('Hero shot', cinematicConfig, ['#FF5500', '#1A1A2E']);
    expect(result).toContain('#FF5500');
    expect(result).toContain('#1A1A2E');
  });

  it('includes quality cue for 8K premium output', () => {
    const { cinematicConfig } = buildCinematicSceneDescriptor(makeScene({ role: 'solution' }), makeRenderConfig(), 7000);
    const result = buildCinematicPrompt('Solution scene', cinematicConfig);
    expect(result).toMatch(/8K|photorealistic|premium/i);
  });

  it('includes depth cue for parallax', () => {
    const { cinematicConfig } = buildCinematicSceneDescriptor(makeScene(), makeRenderConfig(), 7000);
    const result = buildCinematicPrompt('Scene', cinematicConfig);
    expect(result).toMatch(/depth|parallax|2\.5D/i);
  });

  it('does not produce duplicate separator sequences', () => {
    const { cinematicConfig } = buildCinematicSceneDescriptor(makeScene(), makeRenderConfig(), 7000);
    const result = buildCinematicPrompt('Scene', cinematicConfig);
    expect(result).not.toMatch(/\. \. /); // no double-period gaps
  });
});

// ── 3. buildCinematicSceneDescriptor ─────────────────────────────────────────

describe('buildCinematicSceneDescriptor', () => {
  it('returns a valid descriptor structure', () => {
    const scene = makeScene({ role: 'hook' });
    const descriptor = buildCinematicSceneDescriptor(scene as any, makeRenderConfig(), 7000);

    expect(descriptor.sceneId).toBe('scene-test-001');
    expect(descriptor.sceneRole).toBe('hook');
    expect(descriptor.durationMs).toBe(7000);
    expect(descriptor.layers).toBeDefined();
    expect(descriptor.cameraKeyframes.length).toBeGreaterThanOrEqual(2);
    expect(descriptor.enrichedPrompt).toBeTruthy();
    expect(descriptor.ffmpegFilters).toBeInstanceOf(Array);
  });

  it('always includes a background layer as the first layer', () => {
    const descriptor = buildCinematicSceneDescriptor(makeScene() as any, makeRenderConfig(), 7000);
    const bg = descriptor.layers.find(l => l.depthLayer === 'background');
    expect(bg).toBeDefined();
    expect(bg!.zIndex).toBe(0);
  });

  it('layers are sorted by zIndex ascending', () => {
    const descriptor = buildCinematicSceneDescriptor(makeScene() as any, makeRenderConfig(), 7000);
    const zIndexes = descriptor.layers.map(l => l.zIndex);
    expect(zIndexes).toEqual([...zIndexes].sort((a, b) => a - b));
  });

  it('adds a text layer when onScreenText is present', () => {
    const scene = makeScene({ visualConfig: { onScreenText: 'Stop Struggling.' } });
    const descriptor = buildCinematicSceneDescriptor(scene as any, makeRenderConfig(), 7000);
    const textLayers = descriptor.layers.filter(l => l.type === 'text');
    expect(textLayers.length).toBeGreaterThanOrEqual(1);
    expect(textLayers[0].textContent).toBe('Stop Struggling.');
  });

  it('does not add text layer when onScreenText is absent', () => {
    const scene = makeScene({ visualConfig: {} });
    const descriptor = buildCinematicSceneDescriptor(scene as any, makeRenderConfig(), 7000);
    const textLayers = descriptor.layers.filter(l => l.type === 'text');
    expect(textLayers.length).toBe(0);
  });

  it('adds vignette layer for hook role (vignette overlayEffect)', () => {
    const descriptor = buildCinematicSceneDescriptor(makeScene({ role: 'hook' }) as any, makeRenderConfig(), 7000);
    const vignette = descriptor.layers.find(l => l.depthLayer === 'vignette');
    expect(vignette).toBeDefined();
  });

  it('does not add vignette for proof role (overlayEffect=none)', () => {
    const descriptor = buildCinematicSceneDescriptor(makeScene({ role: 'proof' }) as any, makeRenderConfig(), 7000);
    const vignette = descriptor.layers.find(l => l.depthLayer === 'vignette');
    expect(vignette).toBeUndefined();
  });

  it('falls back gracefully for unknown scene roles', () => {
    const scene = makeScene({ role: 'unknown_future_role' });
    expect(() => buildCinematicSceneDescriptor(scene as any, makeRenderConfig(), 7000)).not.toThrow();
    const descriptor = buildCinematicSceneDescriptor(scene as any, makeRenderConfig(), 7000);
    expect(descriptor.layers.length).toBeGreaterThan(0); // at least background
  });

  it('includes at least 2 camera keyframes', () => {
    const allRoles = ['hook', 'problem', 'solution', 'proof', 'brand_reveal', 'offer', 'cta', 'close'];
    for (const role of allRoles) {
      const descriptor = buildCinematicSceneDescriptor(makeScene({ role }) as any, makeRenderConfig(), 7000);
      expect(descriptor.cameraKeyframes.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('uses enriched prompt (not original base prompt)', () => {
    const scene = makeScene({ prompt: 'ORIGINAL_BASE_PROMPT' });
    const descriptor = buildCinematicSceneDescriptor(scene as any, makeRenderConfig(), 7000);
    // Enriched prompt should include the original but also add cinematic cues
    expect(descriptor.enrichedPrompt).toContain('ORIGINAL_BASE_PROMPT');
    expect(descriptor.enrichedPrompt.length).toBeGreaterThan('ORIGINAL_BASE_PROMPT'.length);
  });
});

// ── 4. enrichScenesForCinematicMode ──────────────────────────────────────────

describe('enrichScenesForCinematicMode', () => {
  it('returns same number of scenes', () => {
    const scenes = [
      makeScene({ id: 's1', role: 'hook', position: 0 }),
      makeScene({ id: 's2', role: 'solution', position: 1 }),
      makeScene({ id: 's3', role: 'cta', position: 2 }),
    ];
    const result = enrichScenesForCinematicMode(scenes as any, makeRenderConfig());
    expect(result.length).toBe(3);
  });

  it('attaches cinematicDescriptor to each scene', () => {
    const scenes = [makeScene({ id: 's1', role: 'hook', position: 0 })];
    const result = enrichScenesForCinematicMode(scenes as any, makeRenderConfig());
    expect((result[0] as any).cinematicDescriptor).toBeDefined();
    expect((result[0] as any).cinematicDescriptor.sceneId).toBe('s1');
  });

  it('replaces scene prompt with enriched cinematic prompt', () => {
    const scenes = [makeScene({ id: 's1', role: 'hook', position: 0, prompt: 'BASE_PROMPT' })];
    const result = enrichScenesForCinematicMode(scenes as any, makeRenderConfig());
    expect(result[0].prompt).not.toBe('BASE_PROMPT');
    expect(result[0].prompt).toContain('BASE_PROMPT');
  });

  it('respects timing.durationSec from scene data', () => {
    const scenes = [makeScene({ id: 's1', role: 'solution', position: 0, timing: { durationSec: 12 } })];
    const result = enrichScenesForCinematicMode(scenes as any, makeRenderConfig());
    expect((result[0] as any).cinematicDescriptor.durationMs).toBe(12000);
  });

  it('falls back to defaultDurationSec when timing is absent', () => {
    const scenes = [{ ...makeScene({ id: 's1', role: 'hook', position: 0 }), timing: undefined }];
    const result = enrichScenesForCinematicMode(scenes as any, makeRenderConfig(), 8);
    expect((result[0] as any).cinematicDescriptor.durationMs).toBe(8000);
  });

  it('processes all 7 standard scene roles without throwing', () => {
    const roles = ['hook', 'problem', 'solution', 'proof', 'brand_reveal', 'offer', 'cta'];
    const scenes = roles.map((role, i) => makeScene({ id: `s${i}`, role, position: i }));
    expect(() => enrichScenesForCinematicMode(scenes as any, makeRenderConfig())).not.toThrow();
  });
});

// ── 5. DEPTH_CONFIG integrity ─────────────────────────────────────────────────

describe('DEPTH_CONFIG', () => {
  const depthLayers: DepthLayer[] = ['background', 'midground', 'subject', 'headline', 'supporting', 'overlay', 'vignette'];

  it('defines all 7 depth layers', () => {
    for (const layer of depthLayers) {
      expect(DEPTH_CONFIG[layer]).toBeDefined();
    }
  });

  it('zIndexes are unique and ascending', () => {
    const zIndexes = depthLayers.map(l => DEPTH_CONFIG[l].zIndex);
    const unique = [...new Set(zIndexes)];
    expect(unique.length).toBe(depthLayers.length);
    expect(zIndexes).toEqual([...zIndexes].sort((a, b) => a - b));
  });

  it('parallaxFactors are between 0 and 1', () => {
    for (const layer of depthLayers) {
      const f = DEPTH_CONFIG[layer].parallaxFactor;
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThanOrEqual(1);
    }
  });

  it('background layer has lowest parallax (slowest movement)', () => {
    expect(DEPTH_CONFIG['background'].parallaxFactor).toBeLessThan(DEPTH_CONFIG['overlay'].parallaxFactor);
  });

  it('vignette has zero parallax (screen-fixed)', () => {
    expect(DEPTH_CONFIG['vignette'].parallaxFactor).toBe(0);
  });

  it('subject layer has no blur (sharp focus)', () => {
    expect(DEPTH_CONFIG['subject'].blurRadius).toBe(0);
  });

  it('background layer has positive blur (depth-of-field)', () => {
    expect(DEPTH_CONFIG['background'].blurRadius).toBeGreaterThan(0);
  });
});

// ── 6. Asset layer construction ───────────────────────────────────────────────

describe('Asset layer from enriched scene', () => {
  const mockAssetLayer = {
    slotName: 'product_slot',
    assetId: 'asset-abc-123',
    assetType: 'product_image',
    cdnUrl: 'https://cdn.arkiol.com/assets/product.webp',
    vectorUrl: null,
    position: { x: 20, y: 20, width: 60, height: 60, zIndex: 2 },
    animation: { type: 'float', durationMs: 4000, delayMs: 0, easing: 'ease-in-out' },
  };

  it('creates an asset cinematic layer with drop shadow', () => {
    const scene = { ...makeScene({ role: 'solution' }), assetLayers: [mockAssetLayer] };
    const descriptor = buildCinematicSceneDescriptor(scene as any, makeRenderConfig(), 7000);
    const assetLayers = descriptor.layers.filter(l => l.type === 'brand_asset');
    expect(assetLayers.length).toBe(1);
    expect(assetLayers[0].dropShadow).toBeDefined();
    expect(assetLayers[0].dropShadow!.opacity).toBeGreaterThan(0);
  });

  it('asset layer uses the CDN URL', () => {
    const scene = { ...makeScene({ role: 'hook' }), assetLayers: [mockAssetLayer] };
    const descriptor = buildCinematicSceneDescriptor(scene as any, makeRenderConfig(), 7000);
    const assetLayer = descriptor.layers.find(l => l.type === 'brand_asset');
    expect(assetLayer!.assetUrl).toBe('https://cdn.arkiol.com/assets/product.webp');
  });

  it('asset layer has entrance and exit keyframes', () => {
    const scene = { ...makeScene({ role: 'hook' }), assetLayers: [mockAssetLayer] };
    const descriptor = buildCinematicSceneDescriptor(scene as any, makeRenderConfig(), 7000);
    const assetLayer = descriptor.layers.find(l => l.type === 'brand_asset')!;
    expect(assetLayer.motionKeyframes.length).toBeGreaterThanOrEqual(2);
    // Entrance: opacity 0 → 1
    expect(assetLayer.motionKeyframes[0].opacity).toBe(0);
    expect(assetLayer.motionKeyframes[1].opacity).toBe(1);
    // Exit: opacity should go back to 0 at end
    const lastFrame = assetLayer.motionKeyframes[assetLayer.motionKeyframes.length - 1];
    expect(lastFrame.opacity).toBe(0);
  });

  it('asset layer has depth-appropriate parallaxFactor', () => {
    const scene = { ...makeScene({ role: 'solution' }), assetLayers: [mockAssetLayer] };
    const descriptor = buildCinematicSceneDescriptor(scene as any, makeRenderConfig(), 7000);
    const assetLayer = descriptor.layers.find(l => l.type === 'brand_asset')!;
    // Subject depth layer parallax
    expect(assetLayer.parallaxFactor).toBe(DEPTH_CONFIG['subject'].parallaxFactor);
  });
});

// ── 7. FFmpeg filter chain ────────────────────────────────────────────────────

describe('FFmpeg filter chain (cinematic mode)', () => {
  it('returns an array of filter strings', () => {
    const descriptor = buildCinematicSceneDescriptor(makeScene({ role: 'hook' }) as any, makeRenderConfig(), 7000);
    expect(descriptor.ffmpegFilters).toBeInstanceOf(Array);
    expect(descriptor.ffmpegFilters.length).toBeGreaterThan(0);
  });

  it('includes eq filter for contrast/saturation', () => {
    const descriptor = buildCinematicSceneDescriptor(makeScene({ role: 'cta' }) as any, makeRenderConfig(), 7000);
    const hasEq = descriptor.ffmpegFilters.some(f => f.startsWith('eq='));
    expect(hasEq).toBe(true);
  });

  it('includes sharpness filter', () => {
    const descriptor = buildCinematicSceneDescriptor(makeScene({ role: 'solution' }) as any, makeRenderConfig(), 7000);
    const hasUnsharp = descriptor.ffmpegFilters.some(f => f.startsWith('unsharp='));
    expect(hasUnsharp).toBe(true);
  });

  it('includes vignette filter for hook role', () => {
    const descriptor = buildCinematicSceneDescriptor(makeScene({ role: 'hook' }) as any, makeRenderConfig(), 7000);
    const hasVignette = descriptor.ffmpegFilters.some(f => f.includes('vignette'));
    expect(hasVignette).toBe(true);
  });

  it('includes color grade filter for 16:9 aspect ratio', () => {
    const cfg16x9 = makeRenderConfig({ aspectRatio: '16:9' });
    const descriptor = buildCinematicSceneDescriptor(makeScene({ role: 'solution' }) as any, cfg16x9, 7000);
    const hasColorMix = descriptor.ffmpegFilters.some(f => f.includes('colorchannelmixer'));
    expect(hasColorMix).toBe(true);
  });

  it('all filter strings are valid non-empty strings', () => {
    const descriptor = buildCinematicSceneDescriptor(makeScene() as any, makeRenderConfig(), 7000);
    for (const f of descriptor.ffmpegFilters) {
      expect(typeof f).toBe('string');
      expect(f.length).toBeGreaterThan(0);
      expect(f).not.toContain('undefined');
    }
  });
});

// ── 8. AD_STYLE_CONFIGS contract ─────────────────────────────────────────────

describe('AD_STYLE_CONFIGS', () => {
  it('defines both normal and cinematic styles', () => {
    expect(AD_STYLE_CONFIGS.normal).toBeDefined();
    expect(AD_STYLE_CONFIGS.cinematic).toBeDefined();
  });

  it('cinematic has higher creditMultiplier than normal', () => {
    expect(AD_STYLE_CONFIGS.cinematic.creditMultiplier).toBeGreaterThan(AD_STYLE_CONFIGS.normal.creditMultiplier);
  });

  it('cinematic renderMode is Premium Cinematic', () => {
    expect(AD_STYLE_CONFIGS.cinematic.renderMode).toBe('Cinematic Ad');
  });

  it('normal renderMode is 2D Standard', () => {
    expect(AD_STYLE_CONFIGS.normal.renderMode).toBe('Normal Ad');
  });

  it('both configs have non-empty features array', () => {
    expect(AD_STYLE_CONFIGS.normal.features.length).toBeGreaterThan(0);
    expect(AD_STYLE_CONFIGS.cinematic.features.length).toBeGreaterThan(0);
  });

  it('cinematic has more features than normal', () => {
    expect(AD_STYLE_CONFIGS.cinematic.features.length).toBeGreaterThan(AD_STYLE_CONFIGS.normal.features.length);
  });

  it('cinematic estimatedRenderTimeMultiplier > 1', () => {
    expect(AD_STYLE_CONFIGS.cinematic.estimatedRenderTimeMultiplier).toBeGreaterThan(1);
  });
});

// ── 9. Normal mode passthrough ────────────────────────────────────────────────

describe('Normal mode passthrough (no cinematic enrichment)', () => {
  it('isCinematicMode returns false for normal 2D Standard config', () => {
    const cfg = makeRenderConfig({ renderMode: 'Normal Ad', adStyle: 'normal' });
    expect(isCinematicMode(cfg)).toBe(false);
  });

  it('enrichScenesForCinematicMode still works when called for normal (defensive use)', () => {
    // Even if called accidentally for normal mode, should not throw
    const cfg = makeRenderConfig({ renderMode: 'Normal Ad', adStyle: 'normal' });
    const scenes = [makeScene({ id: 's1', role: 'hook', position: 0 })];
    expect(() => enrichScenesForCinematicMode(scenes as any, cfg)).not.toThrow();
  });
});

// ── 10. Brand color integration ───────────────────────────────────────────────

describe('Brand color integration in cinematic mode', () => {
  it('includes brand colors in enriched prompt when provided', () => {
    const scene = {
      ...makeScene({ role: 'brand_reveal' }),
      brandColors: { primary: '#C0A060', secondary: '#1A1A2E', accent: '#FF5500' },
    };
    const descriptor = buildCinematicSceneDescriptor(scene as any, makeRenderConfig(), 8000);
    expect(descriptor.enrichedPrompt).toContain('#C0A060');
  });

  it('does not crash when brandColors is absent', () => {
    const scene = makeScene({ role: 'solution' }); // no brandColors
    expect(() => buildCinematicSceneDescriptor(scene as any, makeRenderConfig(), 7000)).not.toThrow();
  });
});
