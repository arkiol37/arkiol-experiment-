/**
 * Unit tests — platformSpecs.ts
 *
 * Tests the ad platform specification registry: all placement specs,
 * derived mappings, and pure utility functions.
 *
 * All pure functions — no DB, no HTTP.
 */

import {
  PLACEMENT_SPECS,
  PLACEMENTS_BY_PLATFORM,
  PLATFORM_META,
  getPlacementSpec,
  getResolution,
  estimateDuration,
  type AdPlacement,
  type Platform,
} from '../../src/services/platformSpecs';

// ══════════════════════════════════════════════════════════════════════════════
// PLACEMENT_SPECS integrity
// ══════════════════════════════════════════════════════════════════════════════
describe('PLACEMENT_SPECS — shape and completeness', () => {
  const ALL_PLACEMENTS: AdPlacement[] = [
    'youtube_instream', 'youtube_shorts',
    'facebook_feed', 'facebook_reel', 'facebook_story',
    'instagram_feed', 'instagram_reel', 'instagram_story',
    'tiktok_feed', 'tiktok_topview',
  ];

  it('contains all 10 expected placements', () => {
    for (const p of ALL_PLACEMENTS) {
      expect(PLACEMENT_SPECS[p]).toBeDefined();
    }
  });

  it('every spec has required fields', () => {
    for (const [, spec] of Object.entries(PLACEMENT_SPECS)) {
      expect(typeof spec.platform).toBe('string');
      expect(typeof spec.placement).toBe('string');
      expect(typeof spec.label).toBe('string');
      expect(typeof spec.aspectRatio).toBe('string');
      expect(spec.resolution1080p).toBeDefined();
      expect(spec.resolution4k).toBeDefined();
      expect(typeof spec.minDurationSec).toBe('number');
      expect(typeof spec.maxDurationSec).toBe('number');
      expect(typeof spec.recommendedScenes).toBe('number');
      expect(typeof spec.secPerScene).toBe('number');
      expect(typeof spec.promptModifier).toBe('string');
    }
  });

  it('every spec key matches its own placement field', () => {
    for (const [key, spec] of Object.entries(PLACEMENT_SPECS)) {
      expect(spec.placement).toBe(key);
    }
  });

  it('all 1080p resolutions have positive integer dimensions', () => {
    for (const [, spec] of Object.entries(PLACEMENT_SPECS)) {
      expect(Number.isInteger(spec.resolution1080p.w)).toBe(true);
      expect(Number.isInteger(spec.resolution1080p.h)).toBe(true);
      expect(spec.resolution1080p.w).toBeGreaterThan(0);
      expect(spec.resolution1080p.h).toBeGreaterThan(0);
    }
  });

  it('4K resolutions are exactly 2× the 1080p dimensions', () => {
    for (const [, spec] of Object.entries(PLACEMENT_SPECS)) {
      expect(spec.resolution4k.w).toBe(spec.resolution1080p.w * 2);
      expect(spec.resolution4k.h).toBe(spec.resolution1080p.h * 2);
    }
  });

  it('minDurationSec < maxDurationSec for all placements', () => {
    for (const [, spec] of Object.entries(PLACEMENT_SPECS)) {
      expect(spec.minDurationSec).toBeLessThan(spec.maxDurationSec);
    }
  });

  it('recommendedScenes is a positive integer', () => {
    for (const [, spec] of Object.entries(PLACEMENT_SPECS)) {
      expect(Number.isInteger(spec.recommendedScenes)).toBe(true);
      expect(spec.recommendedScenes).toBeGreaterThan(0);
    }
  });

  it('secPerScene is a positive number', () => {
    for (const [, spec] of Object.entries(PLACEMENT_SPECS)) {
      expect(spec.secPerScene).toBeGreaterThan(0);
    }
  });

  it('promptModifier is non-empty for all placements', () => {
    for (const [, spec] of Object.entries(PLACEMENT_SPECS)) {
      expect(spec.promptModifier.length).toBeGreaterThan(10);
    }
  });

  it('safeZoneRatio is between 0 and 0.25', () => {
    for (const [, spec] of Object.entries(PLACEMENT_SPECS)) {
      expect(spec.safeZoneRatio).toBeGreaterThanOrEqual(0);
      expect(spec.safeZoneRatio).toBeLessThanOrEqual(0.25);
    }
  });

  it('targetBitrateKbps is a positive integer', () => {
    for (const [, spec] of Object.entries(PLACEMENT_SPECS)) {
      expect(spec.targetBitrateKbps).toBeGreaterThan(0);
    }
  });

  it('maxFileSizeMb is a positive integer', () => {
    for (const [, spec] of Object.entries(PLACEMENT_SPECS)) {
      expect(spec.maxFileSizeMb).toBeGreaterThan(0);
    }
  });

  it('audioSampleRate is 44100 or 48000', () => {
    for (const [, spec] of Object.entries(PLACEMENT_SPECS)) {
      expect([44100, 48000]).toContain(spec.audioSampleRate);
    }
  });

  it('accentColor is a valid hex color', () => {
    for (const [, spec] of Object.entries(PLACEMENT_SPECS)) {
      expect(spec.accentColor).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Aspect ratio consistency
// ══════════════════════════════════════════════════════════════════════════════
describe('PLACEMENT_SPECS — aspect ratio consistency', () => {
  it('youtube_instream is 16:9', () => {
    expect(PLACEMENT_SPECS.youtube_instream.aspectRatio).toBe('16:9');
    expect(PLACEMENT_SPECS.youtube_instream.resolution1080p).toEqual({ w: 1920, h: 1080, label: '1080p' });
  });

  it('youtube_shorts is 9:16', () => {
    expect(PLACEMENT_SPECS.youtube_shorts.aspectRatio).toBe('9:16');
    expect(PLACEMENT_SPECS.youtube_shorts.resolution1080p.w).toBeLessThan(PLACEMENT_SPECS.youtube_shorts.resolution1080p.h);
  });

  it('portrait placements are taller than wide', () => {
    const portraitPlacements: AdPlacement[] = [
      'youtube_shorts', 'facebook_story', 'instagram_reel',
      'instagram_story', 'tiktok_feed', 'tiktok_topview'
    ];
    for (const p of portraitPlacements) {
      const spec = PLACEMENT_SPECS[p];
      expect(spec.resolution1080p.h).toBeGreaterThan(spec.resolution1080p.w);
    }
  });

  it('landscape placements are wider than tall', () => {
    const landscapePlacements: AdPlacement[] = ['youtube_instream', 'facebook_feed'];
    for (const p of landscapePlacements) {
      const spec = PLACEMENT_SPECS[p];
      expect(spec.resolution1080p.w).toBeGreaterThan(spec.resolution1080p.h);
    }
  });

  it('instagram_feed is 1:1 (square)', () => {
    const spec = PLACEMENT_SPECS.instagram_feed;
    expect(spec.aspectRatio).toBe('1:1');
    expect(spec.resolution1080p.w).toBe(spec.resolution1080p.h);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// PLACEMENTS_BY_PLATFORM
// ══════════════════════════════════════════════════════════════════════════════
describe('PLACEMENTS_BY_PLATFORM', () => {
  const PLATFORMS: Platform[] = ['youtube', 'facebook', 'instagram', 'tiktok'];

  it('has all 4 platforms', () => {
    for (const p of PLATFORMS) {
      expect(PLACEMENTS_BY_PLATFORM[p]).toBeDefined();
    }
  });

  it('each platform has at least 2 placements', () => {
    for (const p of PLATFORMS) {
      expect(PLACEMENTS_BY_PLATFORM[p].length).toBeGreaterThanOrEqual(2);
    }
  });

  it('youtube has instream and shorts', () => {
    expect(PLACEMENTS_BY_PLATFORM.youtube).toContain('youtube_instream');
    expect(PLACEMENTS_BY_PLATFORM.youtube).toContain('youtube_shorts');
  });

  it('facebook has feed, reel, story', () => {
    expect(PLACEMENTS_BY_PLATFORM.facebook).toContain('facebook_feed');
    expect(PLACEMENTS_BY_PLATFORM.facebook).toContain('facebook_reel');
    expect(PLACEMENTS_BY_PLATFORM.facebook).toContain('facebook_story');
  });

  it('instagram has feed, reel, story', () => {
    expect(PLACEMENTS_BY_PLATFORM.instagram).toContain('instagram_feed');
    expect(PLACEMENTS_BY_PLATFORM.instagram).toContain('instagram_reel');
    expect(PLACEMENTS_BY_PLATFORM.instagram).toContain('instagram_story');
  });

  it('tiktok has feed and topview', () => {
    expect(PLACEMENTS_BY_PLATFORM.tiktok).toContain('tiktok_feed');
    expect(PLACEMENTS_BY_PLATFORM.tiktok).toContain('tiktok_topview');
  });

  it('every listed placement exists in PLACEMENT_SPECS', () => {
    for (const [, placements] of Object.entries(PLACEMENTS_BY_PLATFORM)) {
      for (const p of placements) {
        expect(PLACEMENT_SPECS[p as AdPlacement]).toBeDefined();
      }
    }
  });

  it('platform of each spec matches the key in PLACEMENTS_BY_PLATFORM', () => {
    for (const [platform, placements] of Object.entries(PLACEMENTS_BY_PLATFORM)) {
      for (const p of placements) {
        expect(PLACEMENT_SPECS[p as AdPlacement].platform).toBe(platform);
      }
    }
  });

  it('no placement is listed under multiple platforms', () => {
    const seen = new Set<string>();
    for (const [, placements] of Object.entries(PLACEMENTS_BY_PLATFORM)) {
      for (const p of placements) {
        expect(seen.has(p)).toBe(false);
        seen.add(p);
      }
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// PLATFORM_META
// ══════════════════════════════════════════════════════════════════════════════
describe('PLATFORM_META', () => {
  it('has entries for all 4 platforms', () => {
    expect(PLATFORM_META.youtube).toBeDefined();
    expect(PLATFORM_META.facebook).toBeDefined();
    expect(PLATFORM_META.instagram).toBeDefined();
    expect(PLATFORM_META.tiktok).toBeDefined();
  });

  it('all platforms have non-empty label, icon, color', () => {
    for (const [, meta] of Object.entries(PLATFORM_META)) {
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.icon.length).toBeGreaterThan(0);
      expect(meta.color.length).toBeGreaterThan(0);
    }
  });

  it('platform colors are valid hex codes', () => {
    for (const [, meta] of Object.entries(PLATFORM_META)) {
      expect(meta.color).toMatch(/^#[0-9A-Fa-f]{3,6}$/);
    }
  });

  it('youtube color is red (#FF0000)', () => {
    expect(PLATFORM_META.youtube.color.toLowerCase()).toBe('#ff0000');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// getPlacementSpec
// ══════════════════════════════════════════════════════════════════════════════
describe('getPlacementSpec', () => {
  it('returns spec for a valid placement', () => {
    const spec = getPlacementSpec('youtube_instream');
    expect(spec.placement).toBe('youtube_instream');
  });

  it('returned spec is the same object as PLACEMENT_SPECS entry', () => {
    const spec = getPlacementSpec('tiktok_feed');
    expect(spec).toBe(PLACEMENT_SPECS.tiktok_feed);
  });

  it('throws for an unknown placement', () => {
    expect(() => getPlacementSpec('snapchat_story' as any)).toThrow('Unknown placement');
  });

  it('all valid placements resolve without throwing', () => {
    for (const p of Object.keys(PLACEMENT_SPECS) as AdPlacement[]) {
      expect(() => getPlacementSpec(p)).not.toThrow();
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// getResolution
// ══════════════════════════════════════════════════════════════════════════════
describe('getResolution', () => {
  const spec = PLACEMENT_SPECS.youtube_instream;

  it('returns 1080p resolution when is4K=false', () => {
    const res = getResolution(spec, false);
    expect(res).toBe(spec.resolution1080p);
    expect(res).toEqual({ w: 1920, h: 1080, label: '1080p' });
  });

  it('returns 4K resolution when is4K=true', () => {
    const res = getResolution(spec, true);
    expect(res).toBe(spec.resolution4k);
    expect(res).toEqual({ w: 3840, h: 2160, label: '4K' });
  });

  it('4K resolution is exactly 2× 1080p for all placements', () => {
    for (const [, s] of Object.entries(PLACEMENT_SPECS)) {
      const r1080 = getResolution(s, false);
      const r4k   = getResolution(s, true);
      expect(r4k.w).toBe(r1080.w * 2);
      expect(r4k.h).toBe(r1080.h * 2);
    }
  });

  it('1080p label is "1080p"', () => {
    for (const [, s] of Object.entries(PLACEMENT_SPECS)) {
      expect(getResolution(s, false).label).toBe('1080p');
    }
  });

  it('4K label is "4K"', () => {
    for (const [, s] of Object.entries(PLACEMENT_SPECS)) {
      expect(getResolution(s, true).label).toBe('4K');
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// estimateDuration
// ══════════════════════════════════════════════════════════════════════════════
describe('estimateDuration', () => {
  describe('youtube_instream (min=6, max=60, secPerScene=7)', () => {
    const spec = PLACEMENT_SPECS.youtube_instream;

    it('1 scene = 7s (above min)', () => {
      expect(estimateDuration(spec, 1)).toBe(7);
    });

    it('5 scenes = 35s', () => {
      expect(estimateDuration(spec, 5)).toBe(35);
    });

    it('0 scenes clamps to minDurationSec', () => {
      expect(estimateDuration(spec, 0)).toBe(spec.minDurationSec);
    });

    it('100 scenes clamps to maxDurationSec=60', () => {
      expect(estimateDuration(spec, 100)).toBe(60);
    });

    it('8 scenes = 56s (not clamped yet)', () => {
      expect(estimateDuration(spec, 8)).toBe(56);
    });

    it('9 scenes clamps to 60s', () => {
      expect(estimateDuration(spec, 9)).toBe(60);
    });
  });

  it('result is always within [minDurationSec, maxDurationSec]', () => {
    for (const [, spec] of Object.entries(PLACEMENT_SPECS)) {
      for (const scenes of [0, 1, 3, 5, 10, 50]) {
        const duration = estimateDuration(spec, scenes);
        expect(duration).toBeGreaterThanOrEqual(spec.minDurationSec);
        expect(duration).toBeLessThanOrEqual(spec.maxDurationSec);
      }
    }
  });

  it('duration increases monotonically with scene count until cap', () => {
    const spec = PLACEMENT_SPECS.tiktok_feed;
    let prev = estimateDuration(spec, 0);
    for (let n = 1; n <= 10; n++) {
      const curr = estimateDuration(spec, n);
      expect(curr).toBeGreaterThanOrEqual(prev);
      prev = curr;
    }
  });
});
