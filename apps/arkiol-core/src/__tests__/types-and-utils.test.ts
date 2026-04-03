/**
 * apps/arkiol-core/src/__tests__/types-and-utils.test.ts
 *
 * Unit tests for canonical types, dimension registry, credit costs,
 * export profiles, error classes, and utility functions.
 *
 * No database, no network, no Next.js server runtime required.
 *
 * Covers:
 *  - FORMAT_DIMS       — all 9 format dimensions are correct
 *  - ARKIOL_CATEGORIES — set is complete and consistent
 *  - CATEGORY_LABELS   — all formats have labels
 *  - getCategoryLabel  — known / unknown formats
 *  - getCreditCost     — base cost, GIF surcharge, heavy formats
 *  - EXPORT_PROFILES   — GIF eligibility, SVG support, PNG scale
 *  - GIF_ELIGIBLE_FORMATS — derived from EXPORT_PROFILES, consistent
 *  - ApiError          — constructor, statusCode alias, instanceof
 *  - withRetry         — success, retry on retryable errors, skip on 4xx
 */

import {
  FORMAT_DIMS,
  ARKIOL_CATEGORIES,
  CATEGORY_LABELS,
  EXPORT_PROFILES,
  GIF_ELIGIBLE_FORMATS,
  getCategoryLabel,
  getCreditCost,
  ApiError,
  type ArkiolCategory,
} from '../lib/types';

// ══════════════════════════════════════════════════════════════════════════════
// FORMAT_DIMS
// ══════════════════════════════════════════════════════════════════════════════
describe('FORMAT_DIMS — dimension registry', () => {
  const EXPECTED: Record<string, { width: number; height: number }> = {
    instagram_post:     { width: 1080, height: 1080 },
    instagram_story:    { width: 1080, height: 1920 },
    youtube_thumbnail:  { width: 1280, height: 720  },
    flyer:              { width: 2550, height: 3300 },
    poster:             { width: 2480, height: 3508 },
    presentation_slide: { width: 1920, height: 1080 },
    business_card:      { width: 1050, height: 600  },
    resume:             { width: 2550, height: 3300 },
    logo:               { width: 1000, height: 1000 },
  };

  it('exports FORMAT_DIMS object', () => {
    expect(typeof FORMAT_DIMS).toBe('object');
    expect(FORMAT_DIMS).not.toBeNull();
  });

  it('contains all 9 canonical formats', () => {
    expect(Object.keys(FORMAT_DIMS).length).toBe(9);
  });

  for (const [format, dims] of Object.entries(EXPECTED)) {
    it(`${format} has correct width=${dims.width} height=${dims.height}`, () => {
      expect(FORMAT_DIMS[format]).toBeDefined();
      expect(FORMAT_DIMS[format].width).toBe(dims.width);
      expect(FORMAT_DIMS[format].height).toBe(dims.height);
    });
  }

  it('all dimensions are positive integers', () => {
    for (const [, dims] of Object.entries(FORMAT_DIMS)) {
      expect(Number.isInteger(dims.width)).toBe(true);
      expect(Number.isInteger(dims.height)).toBe(true);
      expect(dims.width).toBeGreaterThan(0);
      expect(dims.height).toBeGreaterThan(0);
    }
  });

  it('square formats have equal width and height', () => {
    expect(FORMAT_DIMS.instagram_post.width).toBe(FORMAT_DIMS.instagram_post.height);
    expect(FORMAT_DIMS.logo.width).toBe(FORMAT_DIMS.logo.height);
  });

  it('portrait formats are taller than wide', () => {
    expect(FORMAT_DIMS.instagram_story.height).toBeGreaterThan(FORMAT_DIMS.instagram_story.width);
    expect(FORMAT_DIMS.flyer.height).toBeGreaterThan(FORMAT_DIMS.flyer.width);
    expect(FORMAT_DIMS.poster.height).toBeGreaterThan(FORMAT_DIMS.poster.width);
  });

  it('landscape formats are wider than tall', () => {
    expect(FORMAT_DIMS.youtube_thumbnail.width).toBeGreaterThan(FORMAT_DIMS.youtube_thumbnail.height);
    expect(FORMAT_DIMS.presentation_slide.width).toBeGreaterThan(FORMAT_DIMS.presentation_slide.height);
    expect(FORMAT_DIMS.business_card.width).toBeGreaterThan(FORMAT_DIMS.business_card.height);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ARKIOL_CATEGORIES and CATEGORY_LABELS
// ══════════════════════════════════════════════════════════════════════════════
describe('ARKIOL_CATEGORIES', () => {
  it('contains exactly 9 categories', () => {
    expect(ARKIOL_CATEGORIES.length).toBe(9);
  });

  it('contains no duplicates', () => {
    const unique = new Set(ARKIOL_CATEGORIES);
    expect(unique.size).toBe(ARKIOL_CATEGORIES.length);
  });

  it('every category key exists in FORMAT_DIMS', () => {
    for (const cat of ARKIOL_CATEGORIES) {
      expect(FORMAT_DIMS[cat]).toBeDefined();
    }
  });

  it('every category has a label in CATEGORY_LABELS', () => {
    for (const cat of ARKIOL_CATEGORIES) {
      expect(CATEGORY_LABELS[cat]).toBeDefined();
      expect(typeof CATEGORY_LABELS[cat]).toBe('string');
      expect(CATEGORY_LABELS[cat].length).toBeGreaterThan(0);
    }
  });
});

describe('getCategoryLabel', () => {
  it('returns human-readable label for known format', () => {
    expect(getCategoryLabel('instagram_post')).toBe('Instagram Post');
    expect(getCategoryLabel('youtube_thumbnail')).toBe('YouTube Thumbnail');
    expect(getCategoryLabel('presentation_slide')).toBe('Presentation Slide');
    expect(getCategoryLabel('business_card')).toBe('Business Card');
  });

  it('all 9 categories return their CATEGORY_LABELS value', () => {
    for (const cat of ARKIOL_CATEGORIES) {
      expect(getCategoryLabel(cat)).toBe(CATEGORY_LABELS[cat]);
    }
  });

  it('unknown format returns the format key as fallback', () => {
    expect(getCategoryLabel('custom_format')).toBe('custom_format');
    expect(getCategoryLabel('tiktok_reel')).toBe('tiktok_reel');
  });

  it('empty string returns empty string', () => {
    expect(getCategoryLabel('')).toBe('');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// getCreditCost
// ══════════════════════════════════════════════════════════════════════════════
describe('getCreditCost', () => {
  const HEAVY_FORMATS  = ['flyer', 'poster', 'resume', 'logo'];
  const LIGHT_FORMATS  = ['instagram_post', 'instagram_story', 'youtube_thumbnail',
                          'presentation_slide', 'business_card'];

  describe('base cost without GIF', () => {
    it('light formats cost 1 credit', () => {
      for (const fmt of LIGHT_FORMATS) {
        expect(getCreditCost(fmt, false)).toBe(1);
      }
    });

    it('heavy formats cost 2 credits', () => {
      for (const fmt of HEAVY_FORMATS) {
        expect(getCreditCost(fmt, false)).toBe(2);
      }
    });
  });

  describe('GIF surcharge (+2)', () => {
    it('light formats with GIF cost 3 credits', () => {
      for (const fmt of LIGHT_FORMATS) {
        expect(getCreditCost(fmt, true)).toBe(3);
      }
    });

    it('heavy formats with GIF cost 4 credits', () => {
      for (const fmt of HEAVY_FORMATS) {
        expect(getCreditCost(fmt, true)).toBe(4);
      }
    });

    it('GIF adds exactly 2 credits over base', () => {
      for (const fmt of [...LIGHT_FORMATS, ...HEAVY_FORMATS]) {
        const base = getCreditCost(fmt, false);
        const withGif = getCreditCost(fmt, true);
        expect(withGif - base).toBe(2);
      }
    });
  });

  it('all known categories return positive integer costs', () => {
    for (const fmt of ARKIOL_CATEGORIES) {
      const cost = getCreditCost(fmt, false);
      expect(Number.isInteger(cost)).toBe(true);
      expect(cost).toBeGreaterThan(0);
    }
  });

  it('unknown format defaults to light (1 credit)', () => {
    expect(getCreditCost('unknown_format', false)).toBe(1);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// EXPORT_PROFILES
// ══════════════════════════════════════════════════════════════════════════════
describe('EXPORT_PROFILES', () => {
  it('has an entry for every ARKIOL_CATEGORY', () => {
    for (const cat of ARKIOL_CATEGORIES) {
      expect(EXPORT_PROFILES[cat]).toBeDefined();
    }
  });

  it('all profiles have required boolean fields', () => {
    for (const [, p] of Object.entries(EXPORT_PROFILES)) {
      expect(typeof p.supportsSvg).toBe('boolean');
      expect(typeof p.supportsPng).toBe('boolean');
      expect(typeof p.supportsGif).toBe('boolean');
      expect(typeof p.defaultPngScale).toBe('number');
    }
  });

  it('all formats support PNG', () => {
    for (const [, p] of Object.entries(EXPORT_PROFILES)) {
      expect(p.supportsPng).toBe(true);
    }
  });

  it('resume does NOT support SVG (special case)', () => {
    expect(EXPORT_PROFILES.resume.supportsSvg).toBe(false);
  });

  it('instagram formats support GIF', () => {
    expect(EXPORT_PROFILES.instagram_post.supportsGif).toBe(true);
    expect(EXPORT_PROFILES.instagram_story.supportsGif).toBe(true);
  });

  it('high-resolution formats have defaultPngScale >= 1', () => {
    for (const [, p] of Object.entries(EXPORT_PROFILES)) {
      expect(p.defaultPngScale).toBeGreaterThanOrEqual(1);
    }
  });

  it('business_card and logo have defaultPngScale=2 (high-res)', () => {
    expect(EXPORT_PROFILES.business_card.defaultPngScale).toBe(2);
    expect(EXPORT_PROFILES.logo.defaultPngScale).toBe(2);
  });

  describe('GIF eligibility consistency', () => {
    it('only formats with supportsGif=true are in GIF_ELIGIBLE_FORMATS', () => {
      for (const [fmt, profile] of Object.entries(EXPORT_PROFILES)) {
        if (profile.supportsGif) {
          expect(GIF_ELIGIBLE_FORMATS.has(fmt)).toBe(true);
        } else {
          expect(GIF_ELIGIBLE_FORMATS.has(fmt)).toBe(false);
        }
      }
    });

    it('GIF_ELIGIBLE_FORMATS is a Set', () => {
      expect(GIF_ELIGIBLE_FORMATS).toBeInstanceOf(Set);
    });

    it('GIF_ELIGIBLE_FORMATS contains instagram_post and instagram_story', () => {
      expect(GIF_ELIGIBLE_FORMATS.has('instagram_post')).toBe(true);
      expect(GIF_ELIGIBLE_FORMATS.has('instagram_story')).toBe(true);
    });

    it('GIF_ELIGIBLE_FORMATS does NOT contain flyer or youtube_thumbnail', () => {
      expect(GIF_ELIGIBLE_FORMATS.has('flyer')).toBe(false);
      expect(GIF_ELIGIBLE_FORMATS.has('youtube_thumbnail')).toBe(false);
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ApiError
// ══════════════════════════════════════════════════════════════════════════════
describe('ApiError', () => {
  it('is an instance of Error', () => {
    expect(new ApiError(400, 'Bad request')).toBeInstanceOf(Error);
  });

  it('name is "ApiError"', () => {
    expect(new ApiError(404, 'Not found').name).toBe('ApiError');
  });

  it('message is set correctly', () => {
    expect(new ApiError(403, 'Forbidden').message).toBe('Forbidden');
  });

  it('statusCode property is set', () => {
    expect(new ApiError(422, 'Unprocessable').statusCode).toBe(422);
  });

  it('status alias property also works', () => {
    const err = new ApiError(500, 'Server error');
    expect((err as any).status).toBe(500);
  });

  it('can be thrown and caught', () => {
    expect(() => { throw new ApiError(401, 'Unauthorized'); }).toThrow('Unauthorized');
  });

  it('can be caught as Error', () => {
    try {
      throw new ApiError(429, 'Too many requests');
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect((err as ApiError).statusCode).toBe(429);
    }
  });

  it('works for all standard HTTP error codes', () => {
    const codes = [400, 401, 403, 404, 409, 422, 429, 500, 502, 503];
    for (const code of codes) {
      const err = new ApiError(code, `Error ${code}`);
      expect(err.statusCode).toBe(code);
      expect(err.message).toBe(`Error ${code}`);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// withRetry — from error-handling.ts
// ══════════════════════════════════════════════════════════════════════════════
import { withRetry } from '../lib/error-handling';

describe('withRetry', () => {
  it('returns the result when fn succeeds on first attempt', async () => {
    const result = await withRetry(() => Promise.resolve(42));
    expect(result).toBe(42);
  });

  it('retries on error and succeeds on second attempt', async () => {
    let attempts = 0;
    const result = await withRetry(async () => {
      attempts++;
      if (attempts < 2) throw new Error('transient error');
      return 'success';
    }, { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 10 });
    expect(result).toBe('success');
    expect(attempts).toBe(2);
  });

  it('retries up to maxAttempts and then throws', async () => {
    let attempts = 0;
    await expect(
      withRetry(async () => {
        attempts++;
        throw new Error('always fails');
      }, { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 5 })
    ).rejects.toThrow('always fails');
    expect(attempts).toBe(3);
  });

  it('does NOT retry on 4xx errors (except 429)', async () => {
    let attempts = 0;
    const clientError = Object.assign(new Error('bad request'), { status: 400 });
    await expect(
      withRetry(async () => {
        attempts++;
        throw clientError;
      }, { maxAttempts: 3, baseDelayMs: 1 })
    ).rejects.toThrow();
    expect(attempts).toBe(1); // no retry
  });

  it('does NOT retry on 403 Forbidden', async () => {
    let attempts = 0;
    await expect(
      withRetry(async () => {
        attempts++;
        throw Object.assign(new Error('forbidden'), { status: 403 });
      }, { maxAttempts: 3, baseDelayMs: 1 })
    ).rejects.toThrow();
    expect(attempts).toBe(1);
  });

  it('DOES retry on 429 rate limit', async () => {
    let attempts = 0;
    await expect(
      withRetry(async () => {
        attempts++;
        throw Object.assign(new Error('rate limited'), { status: 429 });
      }, { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 5 })
    ).rejects.toThrow();
    expect(attempts).toBe(3); // retried all 3 times
  });

  it('DOES retry on 500 server error', async () => {
    let attempts = 0;
    await expect(
      withRetry(async () => {
        attempts++;
        throw Object.assign(new Error('server error'), { status: 500 });
      }, { maxAttempts: 2, baseDelayMs: 1, maxDelayMs: 5 })
    ).rejects.toThrow();
    expect(attempts).toBe(2);
  });

  it('DOES retry when error has no status code (network error)', async () => {
    let attempts = 0;
    await expect(
      withRetry(async () => {
        attempts++;
        throw new Error('network error');
      }, { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 5 })
    ).rejects.toThrow();
    expect(attempts).toBe(3);
  });

  it('calls onRetry callback on each retry', async () => {
    const retryAttempts: number[] = [];
    await expect(
      withRetry(
        async () => { throw new Error('fail'); },
        {
          maxAttempts: 3,
          baseDelayMs: 1,
          maxDelayMs: 5,
          onRetry: (attempt) => retryAttempts.push(attempt),
        }
      )
    ).rejects.toThrow();
    expect(retryAttempts).toEqual([1, 2]); // called before attempts 2 and 3
  });

  it('maxAttempts=1 means no retries', async () => {
    let attempts = 0;
    await expect(
      withRetry(async () => { attempts++; throw new Error('fail'); }, { maxAttempts: 1, baseDelayMs: 1 })
    ).rejects.toThrow();
    expect(attempts).toBe(1);
  });

  it('propagates the last error after exhausting retries', async () => {
    let count = 0;
    await expect(
      withRetry(async () => {
        count++;
        throw new Error(`error ${count}`);
      }, { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 5 })
    ).rejects.toThrow('error 3');
  });

  it('uses response.status as fallback status field', async () => {
    let attempts = 0;
    const err = Object.assign(new Error('nope'), { response: { status: 404 } });
    await expect(
      withRetry(async () => { attempts++; throw err; }, { maxAttempts: 3, baseDelayMs: 1 })
    ).rejects.toThrow();
    expect(attempts).toBe(1); // 404 = no retry
  });
}, 30_000);

// ══════════════════════════════════════════════════════════════════════════════
// assertEnforcement (planGate) — pure throw logic only, no DB
// ══════════════════════════════════════════════════════════════════════════════
describe('assertEnforcement — throw logic', () => {
  // Test the pattern used in planGate.ts without importing the full module
  // (which has DB dependencies). We test the logic directly.

  function assertEnforcement(result: { allowed: boolean; reason?: string; httpStatus?: number }): void {
    if (!result.allowed) {
      const err = new ApiError(
        (result as any).httpStatus ?? 403,
        (result as any).reason ?? 'Access denied'
      );
      throw err;
    }
  }

  it('does not throw when allowed=true', () => {
    expect(() => assertEnforcement({ allowed: true })).not.toThrow();
  });

  it('throws ApiError when allowed=false', () => {
    expect(() => assertEnforcement({ allowed: false, reason: 'Plan blocked', httpStatus: 403 }))
      .toThrow(ApiError);
  });

  it('thrown error has correct statusCode', () => {
    try {
      assertEnforcement({ allowed: false, reason: 'Payment required', httpStatus: 402 });
    } catch (err) {
      expect((err as ApiError).statusCode).toBe(402);
    }
  });

  it('thrown error has correct message', () => {
    try {
      assertEnforcement({ allowed: false, reason: 'Credits exhausted', httpStatus: 402 });
    } catch (err) {
      expect((err as ApiError).message).toBe('Credits exhausted');
    }
  });

  it('falls back to 403 when httpStatus not specified', () => {
    try {
      assertEnforcement({ allowed: false, reason: 'Denied' });
    } catch (err) {
      expect((err as ApiError).statusCode).toBe(403);
    }
  });
});
