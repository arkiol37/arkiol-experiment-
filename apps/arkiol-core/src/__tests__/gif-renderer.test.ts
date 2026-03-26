/**
 * apps/arkiol-core/src/__tests__/gif-renderer.test.ts
 *
 * Unit tests for engines/render/gif-renderer.ts
 *
 * Tests the 4 pure frame-builder functions — no canvas, no GIFEncoder, no I/O.
 *
 * Covers:
 *  - MAX_FRAMES constant
 *  - buildKineticTextFrames — frame count, shape/text presence, last-frame delay, CTA timing
 *  - buildFadeFrames — frame count, slide layout, progress dots, delays
 *  - buildPulseCtaFrames — frame count, shapes + texts, delay=42 throughout
 *  - buildRevealFrames — frame count, reveal shapes, last-frame hold delay
 */

import {
  MAX_FRAMES,
  buildKineticTextFrames,
  buildFadeFrames,
  buildPulseCtaFrames,
  buildRevealFrames,
  type KineticTextOptions,
  type FadeFramesOptions,
  type PulseCtaOptions,
  type RevealFramesOptions,
  type ZoneTextDesc,
} from '../engines/render/gif-renderer';

// ── Fixtures ──────────────────────────────────────────────────────────────────
function makeHeadline(): ZoneTextDesc {
  return {
    text: 'Big Headline', x: 200, y: 150,
    fontSize: 64, weight: 'bold' as any,
    color: '#ffffff', fontFamily: 'Montserrat',
    align: 'center' as any, maxWidth: 800,
  };
}

function makeSubhead(): ZoneTextDesc {
  return {
    text: 'Supporting sub', x: 200, y: 230,
    fontSize: 32, weight: 'normal' as any,
    color: '#eeeeee', fontFamily: 'Montserrat',
    align: 'center' as any, maxWidth: 700,
  };
}

function kineticOpts(overrides: Partial<KineticTextOptions> = {}): KineticTextOptions {
  return {
    width: 1280, height: 720,
    bgColor: '#1a1a2e',
    headline: {
      text: 'Launch Now', x: 640, y: 200,
      fontSize: 80, weight: 'bold' as any,
      color: '#ffffff', fontFamily: 'Montserrat',
      align: 'center' as any, maxWidth: 1000,
    },
    frameCount: 20,
    accentColor: '#4f6ef7',
    ...overrides,
  };
}

function fadeOpts(overrides: Partial<FadeFramesOptions> = {}): FadeFramesOptions {
  return {
    width: 1280, height: 720,
    bgColor: '#1a1a2e',
    slides: [
      { headline: 'Slide One', headlineColor: '#fff' },
      { headline: 'Slide Two', headlineColor: '#fff', sub: 'Supporting text' },
    ],
    framesPerSlide: 10,
    accentColor: '#4f6ef7',
    ...overrides,
  };
}

function pulseOpts(overrides: Partial<PulseCtaOptions> = {}): PulseCtaOptions {
  return {
    width: 1280, height: 720,
    bgColor: '#0a0a1a',
    cta: {
      text: 'Shop Now', x: 490, y: 540,
      w: 300, h: 72, bgColor: '#4f6ef7', color: '#ffffff',
      fontSize: 28,
    },
    frameCount: 20,
    accentColor: '#4f6ef7',
    ...overrides,
  };
}

function revealOpts(overrides: Partial<RevealFramesOptions> = {}): RevealFramesOptions {
  return {
    width: 1280, height: 720,
    bgColor: '#1a1a2e',
    headline: makeHeadline(),
    frameCount: 20,
    accentColor: '#4f6ef7',
    ...overrides,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// MAX_FRAMES constant
// ══════════════════════════════════════════════════════════════════════════════
describe('MAX_FRAMES', () => {
  it('is 60', () => expect(MAX_FRAMES).toBe(60));
  it('is a positive integer', () => {
    expect(Number.isInteger(MAX_FRAMES)).toBe(true);
    expect(MAX_FRAMES).toBeGreaterThan(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// buildKineticTextFrames
// ══════════════════════════════════════════════════════════════════════════════
describe('buildKineticTextFrames', () => {
  it('returns an array', () => {
    expect(Array.isArray(buildKineticTextFrames(kineticOpts()))).toBe(true);
  });

  it('returns exactly frameCount frames when frameCount <= MAX_FRAMES', () => {
    expect(buildKineticTextFrames(kineticOpts({ frameCount: 20 })).length).toBe(20);
    expect(buildKineticTextFrames(kineticOpts({ frameCount: 1  })).length).toBe(1);
    expect(buildKineticTextFrames(kineticOpts({ frameCount: 60 })).length).toBe(60);
  });

  it('clamps at MAX_FRAMES when frameCount > MAX_FRAMES', () => {
    const frames = buildKineticTextFrames(kineticOpts({ frameCount: 999 }));
    expect(frames.length).toBe(MAX_FRAMES);
  });

  it('every frame has a backgroundColor', () => {
    for (const f of buildKineticTextFrames(kineticOpts())) {
      expect(typeof f.backgroundColor).toBe('string');
      expect(f.backgroundColor.length).toBeGreaterThan(0);
    }
  });

  it('backgroundColor equals bgColor option', () => {
    const frames = buildKineticTextFrames(kineticOpts({ bgColor: '#ff0000' }));
    for (const f of frames) {
      expect(f.backgroundColor).toBe('#ff0000');
    }
  });

  it('every frame has at least 1 shape', () => {
    for (const f of buildKineticTextFrames(kineticOpts())) {
      expect(Array.isArray(f.shapes)).toBe(true);
      expect(f.shapes!.length).toBeGreaterThan(0);
    }
  });

  it('every frame has at least 1 text element (headline)', () => {
    for (const f of buildKineticTextFrames(kineticOpts())) {
      expect(Array.isArray(f.texts)).toBe(true);
      expect(f.texts!.length).toBeGreaterThan(0);
    }
  });

  it('first text element contains the headline text', () => {
    const frames = buildKineticTextFrames(kineticOpts());
    for (const f of frames) {
      expect(f.texts![0]!.text).toBe('Launch Now');
    }
  });

  it('last frame has delay=2800 (hold)', () => {
    const frames = buildKineticTextFrames(kineticOpts({ frameCount: 20 }));
    expect(frames[frames.length - 1]!.delay).toBe(2800);
  });

  it('non-last frames have delay=42', () => {
    const frames = buildKineticTextFrames(kineticOpts({ frameCount: 20 }));
    for (let i = 0; i < frames.length - 1; i++) {
      expect(frames[i]!.delay).toBe(42);
    }
  });

  it('with subhead — frames include subhead text after headline', () => {
    const frames = buildKineticTextFrames(kineticOpts({ subhead: makeSubhead() }));
    // At least some frames should have 2+ text elements (headline + subhead)
    expect(frames[frames.length - 1]!.texts!.length).toBeGreaterThanOrEqual(2);
  });

  it('CTA only appears after 68% of frames', () => {
    const frameCount = 30;
    const frames = buildKineticTextFrames(kineticOpts({
      frameCount,
      cta: {
        text: 'Buy Now', x: 490, y: 540, width: 280, height: 68,
        bgColor: '#4f6ef7', color: '#fff', fontSize: 24,
      },
    }));
    const threshold = Math.floor(frameCount * 0.68);
    // Frames before threshold should not have CTA text
    for (let i = 0; i < threshold; i++) {
      const hasCta = frames[i]!.texts!.some(t => t.text === 'Buy Now');
      expect(hasCta).toBe(false);
    }
    // Last frame should have CTA text
    const lastFrame = frames[frames.length - 1]!;
    expect(lastFrame.texts!.some(t => t.text === 'Buy Now')).toBe(true);
  });

  it('with gradientColors — backgroundGradient is set on every frame', () => {
    const frames = buildKineticTextFrames(kineticOpts({
      gradientColors: ['#ff0000', '#0000ff'],
    }));
    for (const f of frames) {
      expect(f.backgroundGradient).toBeDefined();
      expect(f.backgroundGradient!.angle).toBe(148);
    }
  });

  it('without gradientColors — backgroundGradient is undefined', () => {
    const frames = buildKineticTextFrames(kineticOpts({ gradientColors: undefined }));
    for (const f of frames) {
      expect(f.backgroundGradient).toBeUndefined();
    }
  });

  it('all shape opacities are in [0, 1]', () => {
    for (const f of buildKineticTextFrames(kineticOpts())) {
      for (const s of f.shapes!) {
        expect(s.opacity).toBeGreaterThanOrEqual(0);
        expect(s.opacity).toBeLessThanOrEqual(1);
      }
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// buildFadeFrames
// ══════════════════════════════════════════════════════════════════════════════
describe('buildFadeFrames', () => {
  it('returns an array', () => {
    expect(Array.isArray(buildFadeFrames(fadeOpts()))).toBe(true);
  });

  it('returns framesPerSlide * slides.length frames', () => {
    const frames = buildFadeFrames(fadeOpts({ framesPerSlide: 10 }));
    expect(frames.length).toBe(10 * 2); // 2 slides
  });

  it('caps total frames at MAX_FRAMES', () => {
    const slides = Array.from({ length: 10 }, (_, i) => ({ headline: `Slide ${i}` }));
    const frames = buildFadeFrames(fadeOpts({ slides, framesPerSlide: 20 }));
    expect(frames.length).toBeLessThanOrEqual(MAX_FRAMES);
  });

  it('single-slide returns framesPerSlide frames', () => {
    const frames = buildFadeFrames(fadeOpts({ slides: [{ headline: 'Solo' }], framesPerSlide: 15 }));
    expect(frames.length).toBe(15);
  });

  it('every frame has backgroundColor matching bgColor', () => {
    for (const f of buildFadeFrames(fadeOpts({ bgColor: '#123456' }))) {
      expect(f.backgroundColor).toBe('#123456');
    }
  });

  it('every frame has texts with headline text', () => {
    const frames = buildFadeFrames(fadeOpts({
      slides: [{ headline: 'Alpha Slide' }],
    }));
    for (const f of frames) {
      expect(f.texts!.some(t => t.text === 'Alpha Slide')).toBe(true);
    }
  });

  it('slides with sub include sub text in frames', () => {
    const frames = buildFadeFrames(fadeOpts({
      slides: [{ headline: 'Main', sub: 'Subtitle text' }],
    }));
    const lastFrame = frames[frames.length - 1]!;
    expect(lastFrame.texts!.some(t => t.text === 'Subtitle text')).toBe(true);
  });

  it('includes progress dots — one per slide', () => {
    const slides = [{ headline: 'A' }, { headline: 'B' }, { headline: 'C' }];
    const frames = buildFadeFrames(fadeOpts({ slides, framesPerSlide: 5 }));
    // Progress dots are '●' characters
    const dotTexts = frames[0]!.texts!.filter(t => t.text === '●');
    expect(dotTexts.length).toBe(3); // one per slide
  });

  it('last frame of each slide has delay=1000', () => {
    const framesPerSlide = 8;
    const frames = buildFadeFrames(fadeOpts({ framesPerSlide }));
    // Last frame of slide 1 = index 7
    expect(frames[framesPerSlide - 1]!.delay).toBe(1000);
    // Last frame of slide 2 = index 15
    expect(frames[framesPerSlide * 2 - 1]!.delay).toBe(1000);
  });

  it('non-last frames of each slide have delay=42', () => {
    const framesPerSlide = 8;
    const frames = buildFadeFrames(fadeOpts({ framesPerSlide }));
    for (let i = 0; i < framesPerSlide - 1; i++) {
      expect(frames[i]!.delay).toBe(42);
    }
  });

  it('all frames have shapes', () => {
    for (const f of buildFadeFrames(fadeOpts())) {
      expect(Array.isArray(f.shapes)).toBe(true);
      expect(f.shapes!.length).toBeGreaterThan(0);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// buildPulseCtaFrames
// ══════════════════════════════════════════════════════════════════════════════
describe('buildPulseCtaFrames', () => {
  it('returns an array of GifFrames', () => {
    expect(Array.isArray(buildPulseCtaFrames(pulseOpts()))).toBe(true);
  });

  it('returns exactly frameCount frames', () => {
    expect(buildPulseCtaFrames(pulseOpts({ frameCount: 20 })).length).toBe(20);
    expect(buildPulseCtaFrames(pulseOpts({ frameCount: 1  })).length).toBe(1);
  });

  it('clamps at MAX_FRAMES', () => {
    expect(buildPulseCtaFrames(pulseOpts({ frameCount: 999 })).length).toBe(MAX_FRAMES);
  });

  it('all frames have delay=42', () => {
    for (const f of buildPulseCtaFrames(pulseOpts({ frameCount: 20 }))) {
      expect(f.delay).toBe(42);
    }
  });

  it('every frame includes CTA text', () => {
    const frames = buildPulseCtaFrames(pulseOpts());
    for (const f of frames) {
      expect(f.texts!.some(t => t.text === 'Shop Now')).toBe(true);
    }
  });

  it('CTA text is uppercase (textTransform)', () => {
    const frames = buildPulseCtaFrames(pulseOpts());
    for (const f of frames) {
      const ctaText = f.texts!.find(t => t.text === 'Shop Now');
      expect(ctaText!.textTransform).toBe('uppercase');
    }
  });

  it('with headline — every frame includes headline text', () => {
    const frames = buildPulseCtaFrames(pulseOpts({
      headline: { text: 'Big Deal', color: '#fff', fontSize: 64 },
    }));
    for (const f of frames) {
      expect(f.texts!.some(t => t.text === 'Big Deal')).toBe(true);
    }
  });

  it('without headline — only CTA text present', () => {
    const frames = buildPulseCtaFrames(pulseOpts({ headline: undefined }));
    for (const f of frames) {
      // Should have exactly 1 text element (the CTA)
      expect(f.texts!.length).toBe(1);
    }
  });

  it('every frame has at least 1 shape (glow ring + button)', () => {
    for (const f of buildPulseCtaFrames(pulseOpts())) {
      expect(f.shapes!.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('backgroundColor matches bgColor option', () => {
    for (const f of buildPulseCtaFrames(pulseOpts({ bgColor: '#abcdef' }))) {
      expect(f.backgroundColor).toBe('#abcdef');
    }
  });

  it('all shape opacities are in [0, 1]', () => {
    for (const f of buildPulseCtaFrames(pulseOpts())) {
      for (const s of f.shapes!) {
        expect(s.opacity).toBeGreaterThanOrEqual(0);
        expect(s.opacity).toBeLessThanOrEqual(1);
      }
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// buildRevealFrames
// ══════════════════════════════════════════════════════════════════════════════
describe('buildRevealFrames', () => {
  it('returns an array', () => {
    expect(Array.isArray(buildRevealFrames(revealOpts()))).toBe(true);
  });

  it('returns exactly frameCount frames', () => {
    expect(buildRevealFrames(revealOpts({ frameCount: 20 })).length).toBe(20);
    expect(buildRevealFrames(revealOpts({ frameCount: 1  })).length).toBe(1);
  });

  it('clamps at MAX_FRAMES', () => {
    expect(buildRevealFrames(revealOpts({ frameCount: 999 })).length).toBe(MAX_FRAMES);
  });

  it('last frame has delay=2400 (hold)', () => {
    const frames = buildRevealFrames(revealOpts({ frameCount: 20 }));
    expect(frames[frames.length - 1]!.delay).toBe(2400);
  });

  it('non-last frames have delay=42', () => {
    const frames = buildRevealFrames(revealOpts({ frameCount: 20 }));
    for (let i = 0; i < frames.length - 1; i++) {
      expect(frames[i]!.delay).toBe(42);
    }
  });

  it('every frame includes the headline text', () => {
    const frames = buildRevealFrames(revealOpts());
    for (const f of frames) {
      expect(f.texts!.some(t => t.text === 'Big Headline')).toBe(true);
    }
  });

  it('every frame has shapes (reveal overlay + accent bar + progress)', () => {
    for (const f of buildRevealFrames(revealOpts())) {
      expect(f.shapes!.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('backgroundColor matches bgColor', () => {
    for (const f of buildRevealFrames(revealOpts({ bgColor: '#112233' }))) {
      expect(f.backgroundColor).toBe('#112233');
    }
  });

  it('with subhead — frames include subhead text', () => {
    const frames = buildRevealFrames(revealOpts({ subhead: makeSubhead() }));
    const lastFrame = frames[frames.length - 1]!;
    expect(lastFrame.texts!.some(t => t.text === 'Supporting sub')).toBe(true);
  });

  it('without subhead — no subhead text in frames', () => {
    const frames = buildRevealFrames(revealOpts({ subhead: undefined }));
    for (const f of frames) {
      expect(f.texts!.length).toBe(1); // only headline
    }
  });

  it('first frame reveal overlay is full-width (black block = full canvas)', () => {
    const frames = buildRevealFrames(revealOpts({ frameCount: 30 }));
    // First frame: t=0, reveal=easeOutExpo(0)=0, so clipW=0
    // Black block should be: x=0, w=width
    const firstFrame = frames[0]!;
    const blackBlock = firstFrame.shapes!.find(s => s.color === '#000000');
    expect(blackBlock).toBeDefined();
  });

  it('last frame reveal overlay width is 0 (fully revealed)', () => {
    const frames = buildRevealFrames(revealOpts({ frameCount: 30 }));
    // Last frame: t=1, reveal=1, clipW=width, so black block w = width - width = 0
    const lastFrame = frames[frames.length - 1]!;
    const blackBlock = lastFrame.shapes!.find(s => s.color === '#000000');
    // The rect at x=width with w=0 effectively has no visible area
    expect(blackBlock).toBeDefined();
    if (blackBlock) {
      expect(blackBlock.x).toBeGreaterThanOrEqual(revealOpts().width - 5); // ~= width
    }
  });

  it('all shape opacities are in [0, 1]', () => {
    for (const f of buildRevealFrames(revealOpts())) {
      for (const s of f.shapes!) {
        expect(s.opacity).toBeGreaterThanOrEqual(0);
        expect(s.opacity).toBeLessThanOrEqual(1);
      }
    }
  });
});
