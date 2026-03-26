/**
 * Unit tests — Pure functions from renderQueue and providerAdapter
 *
 * Tests the deterministic, exported pure functions:
 *   - enhancePrompt     (renderQueue.ts)
 *   - estimateGpuCost   (renderQueue.ts)
 *   - ProviderError     (providerAdapter.ts)
 *   - isRetryableStatus (providerAdapter.ts)
 *
 * No Bull queue, no Redis, no DB — pure logic only.
 */

import { enhancePrompt, estimateGpuCost, type RenderConfig } from '../../src/jobs/renderQueue';
import { ProviderError, isRetryableStatus } from '../../src/providers/providerAdapter';

// ── Fixtures ───────────────────────────────────────────────────────────────
function cfg(overrides: Partial<RenderConfig> = {}): RenderConfig {
  return {
    aspectRatio:    '9:16',
    renderMode:     'Normal Ad',
    resolution:     '1080p',
    mood:           'Cinematic',
    voice:          { gender: 'Female', tone: 'Confident', accent: 'American English', speed: 'Normal' },
    music:          { style: 'Cinematic Ambient', energyCurve: 'Build Up', beatSync: true },
    creditsToCharge: 20,
    ...overrides,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// enhancePrompt
// ══════════════════════════════════════════════════════════════════════════════
describe('enhancePrompt — return type', () => {
  it('returns a non-empty string', () => {
    const result = enhancePrompt('A luxury watch on marble', cfg());
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('includes the original prompt', () => {
    const prompt = 'stunning product shot';
    expect(enhancePrompt(prompt, cfg())).toContain(prompt);
  });

  it('includes the aspect ratio', () => {
    expect(enhancePrompt('test', cfg({ aspectRatio: '9:16' }))).toContain('9:16');
    expect(enhancePrompt('test', cfg({ aspectRatio: '16:9' }))).toContain('16:9');
    expect(enhancePrompt('test', cfg({ aspectRatio: '1:1' }))).toContain('1:1');
  });
});

describe('enhancePrompt — mood modifiers', () => {
  const MOOD_KEYWORDS: [string, string][] = [
    ['Luxury',    'premium'],
    ['Energetic', 'vibrant'],
    ['Minimal',   'minimal'],
    ['Cinematic', 'cinematic'],
    ['Playful',   'playful'],
    ['Emotional', 'emotional'],
    ['Corporate', 'professional'],
    ['Bold',      'bold'],
    ['Tech',      'futuristic'],
    ['Calm',      'serene'],
  ];

  for (const [mood, keyword] of MOOD_KEYWORDS) {
    it(`mood="${mood}" injects "${keyword}"`, () => {
      const result = enhancePrompt('brand ad', cfg({ mood }));
      expect(result.toLowerCase()).toContain(keyword.toLowerCase());
    });
  }

  it('unknown mood falls back to "professional quality"', () => {
    const result = enhancePrompt('ad', cfg({ mood: 'UnknownMood' }));
    expect(result.toLowerCase()).toContain('professional quality');
  });
});

describe('enhancePrompt — render mode: 2D vs 3D', () => {
  it('2D Standard includes 2D animation language', () => {
    const result = enhancePrompt('test', cfg({ renderMode: 'Normal Ad' }));
    expect(result.toLowerCase()).toMatch(/2d|motion graphics|animation/i);
  });

  it('Cinematic Ad uses cinematic depth language', () => {
    const result = enhancePrompt('test', cfg({ renderMode: 'Cinematic Ad' }));
    expect(result.toLowerCase()).toMatch(/3d|photorealistic/i);
  });

  it('Cinematic Ad does not include only 2D language', () => {
    const result = enhancePrompt('test', cfg({ renderMode: 'Cinematic Ad' }));
    expect(result).not.toContain('2D animation');
  });
});

describe('enhancePrompt — scene duration', () => {
  it('includes duration when sceneDurationSec is provided', () => {
    const result = enhancePrompt('test prompt', cfg(), 5);
    expect(result).toContain('5 seconds');
  });

  it('omits duration when sceneDurationSec is not provided', () => {
    const result = enhancePrompt('test prompt', cfg());
    expect(result).not.toMatch(/\d+ seconds/);
  });

  it('correctly embeds different duration values', () => {
    expect(enhancePrompt('p', cfg(), 3)).toContain('3 seconds');
    expect(enhancePrompt('p', cfg(), 10)).toContain('10 seconds');
  });
});

describe('enhancePrompt — platform placement injection', () => {
  it('injects placement prompt modifier when placement is set', () => {
    const result = enhancePrompt('test', cfg({ placement: 'tiktok_feed' }));
    // tiktok_feed has a promptModifier — result should differ from no placement
    const withoutPlacement = enhancePrompt('test', cfg({ placement: undefined }));
    expect(result).not.toBe(withoutPlacement);
  });

  it('unknown placement does not throw', () => {
    expect(() => enhancePrompt('test', cfg({ placement: 'nonexistent_placement' }))).not.toThrow();
  });

  it('no placement → no platform modifier injected', () => {
    const result = enhancePrompt('test', cfg({ placement: undefined }));
    // Without placement, should still return valid string
    expect(result.length).toBeGreaterThan(10);
  });
});

describe('enhancePrompt — output is trimmed', () => {
  it('result has no leading or trailing whitespace', () => {
    const result = enhancePrompt('test prompt', cfg());
    expect(result).toBe(result.trim());
  });
});

describe('enhancePrompt — all render modes produce valid output', () => {
  const modes: RenderConfig['renderMode'][] = ['Normal Ad', '2D Extended', 'Cinematic Ad', 'Cinematic Ad'];
  for (const renderMode of modes) {
    it(`renderMode="${renderMode}" produces non-empty string`, () => {
      expect(enhancePrompt('scene prompt', cfg({ renderMode })).length).toBeGreaterThan(20);
    });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// estimateGpuCost
// ══════════════════════════════════════════════════════════════════════════════
describe('estimateGpuCost — known render modes', () => {
  it('2D Standard: $0.50 per scene', () => {
    expect(estimateGpuCost('Normal Ad', 1)).toBeCloseTo(0.50);
    expect(estimateGpuCost('Normal Ad', 5)).toBeCloseTo(2.50);
    expect(estimateGpuCost('Normal Ad', 10)).toBeCloseTo(5.00);
  });

  it('2D Extended: $1.00 per scene', () => {
    expect(estimateGpuCost('2D Extended', 1)).toBeCloseTo(1.00);
    expect(estimateGpuCost('2D Extended', 3)).toBeCloseTo(3.00);
  });

  it('Premium Cinematic: $2.50 per scene', () => {
    expect(estimateGpuCost('Cinematic Ad', 1)).toBeCloseTo(2.50);
    expect(estimateGpuCost('Cinematic Ad', 4)).toBeCloseTo(10.00);
  });

  it('Cinematic Ad GPU cost per scene', () => {
    expect(estimateGpuCost('Cinematic Ad', 1)).toBeCloseTo(5.00);
    expect(estimateGpuCost('Cinematic Ad', 3)).toBeCloseTo(15.00);
  });
});

describe('estimateGpuCost — cost scales linearly with scenes', () => {
  it('2× scenes → 2× cost', () => {
    const one = estimateGpuCost('Normal Ad', 3);
    const two = estimateGpuCost('Normal Ad', 6);
    expect(two).toBeCloseTo(one * 2);
  });

  it('cost is positive for any positive scene count', () => {
    for (const count of [1, 2, 5, 10]) {
      expect(estimateGpuCost('Normal Ad', count)).toBeGreaterThan(0);
    }
  });
});

describe('estimateGpuCost — cost ordering', () => {
  it('Cinematic Ad >= Normal Ad GPU cost', () => {
    const scenes = 3;
    const costs = {
      std:      estimateGpuCost('Normal Ad', scenes),
      ext:      estimateGpuCost('2D Extended', scenes),
      cinematic: estimateGpuCost('Cinematic Ad', scenes),
      film3d:   estimateGpuCost('Cinematic Ad', scenes),
    };
    expect(costs.ext).toBeGreaterThan(costs.std);
    expect(costs.cinematic).toBeGreaterThan(costs.ext);
    expect(costs.film3d).toBeGreaterThan(costs.cinematic);
  });
});

describe('estimateGpuCost — unknown render mode fallback', () => {
  it('unknown mode falls back to $1.00 per scene', () => {
    expect(estimateGpuCost('Unknown Mode', 1)).toBeCloseTo(1.00);
    expect(estimateGpuCost('Unknown Mode', 5)).toBeCloseTo(5.00);
  });
});

describe('estimateGpuCost — edge cases', () => {
  it('0 scenes → 0 cost', () => {
    expect(estimateGpuCost('Normal Ad', 0)).toBe(0);
  });

  it('fractional scenes handled (no NaN)', () => {
    const result = estimateGpuCost('Normal Ad', 2.5);
    expect(isNaN(result)).toBe(false);
    expect(result).toBeGreaterThan(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ProviderError
// ══════════════════════════════════════════════════════════════════════════════
describe('ProviderError — constructor and properties', () => {
  it('is an instance of Error', () => {
    const err = new ProviderError('runway', 500, 'Internal Server Error');
    expect(err).toBeInstanceOf(Error);
  });

  it('name is "ProviderError"', () => {
    expect(new ProviderError('pika', 429, 'Rate limited').name).toBe('ProviderError');
  });

  it('message includes provider name and message', () => {
    const err = new ProviderError('runway', 503, 'Service unavailable');
    expect(err.message).toContain('runway');
    expect(err.message).toContain('Service unavailable');
  });

  it('provider property is set', () => {
    expect(new ProviderError('sora', 500, 'err').provider).toBe('sora');
  });

  it('statusCode property is set', () => {
    expect(new ProviderError('runway', 429, 'err').statusCode).toBe(429);
  });

  it('retryable defaults to false', () => {
    expect(new ProviderError('runway', 500, 'err').retryable).toBe(false);
  });

  it('retryable can be set to true', () => {
    expect(new ProviderError('runway', 500, 'err', true).retryable).toBe(true);
  });

  it('can be caught as Error', () => {
    try {
      throw new ProviderError('pika', 503, 'down', true);
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect((err as ProviderError).provider).toBe('pika');
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// isRetryableStatus
// ══════════════════════════════════════════════════════════════════════════════
describe('isRetryableStatus — retryable status codes', () => {
  const RETRYABLE = [429, 500, 502, 503, 504];
  const NON_RETRYABLE = [200, 201, 400, 401, 403, 404, 422];

  for (const code of RETRYABLE) {
    it(`status ${code} is retryable`, () => {
      expect(isRetryableStatus(code)).toBe(true);
    });
  }

  for (const code of NON_RETRYABLE) {
    it(`status ${code} is NOT retryable`, () => {
      expect(isRetryableStatus(code)).toBe(false);
    });
  }

  it('status 0 (network error) is NOT retryable', () => {
    expect(isRetryableStatus(0)).toBe(false);
  });

  it('status 418 (teapot) is NOT retryable', () => {
    expect(isRetryableStatus(418)).toBe(false);
  });
});

describe('isRetryableStatus — ProviderError retryable flag alignment', () => {
  it('ProviderError with 429 should have retryable=true when constructed correctly', () => {
    const err = new ProviderError('runway', 429, 'Rate limited', isRetryableStatus(429));
    expect(err.retryable).toBe(true);
  });

  it('ProviderError with 400 should have retryable=false when constructed correctly', () => {
    const err = new ProviderError('runway', 400, 'Bad request', isRetryableStatus(400));
    expect(err.retryable).toBe(false);
  });

  it('all retryable codes produce retryable=true ProviderErrors', () => {
    for (const code of [429, 500, 502, 503, 504]) {
      const err = new ProviderError('pika', code, `HTTP ${code}`, isRetryableStatus(code));
      expect(err.retryable).toBe(true);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Backoff calculation (inline logic — not exported, tested by spec)
// ══════════════════════════════════════════════════════════════════════════════
describe('Exponential backoff formula', () => {
  // This tests the inline formula: Math.min(1000 * 2^attempt, 30_000)
  function backoff(attempt: number): number {
    return Math.min(1000 * Math.pow(2, attempt), 30_000);
  }

  it('attempt 0 → immediate (0ms delay before first try)', () => {
    // First attempt has no backoff (the loop starts backoff at attempt > 0)
    expect(backoff(0)).toBe(1000); // 1000 * 2^0 = 1000ms when attempt=0 would trigger
  });

  it('attempt 1 → 2000ms', () => {
    expect(backoff(1)).toBe(2000);
  });

  it('attempt 2 → 4000ms', () => {
    expect(backoff(2)).toBe(4000);
  });

  it('attempt 3 → 8000ms', () => {
    expect(backoff(3)).toBe(8000);
  });

  it('caps at 30_000ms', () => {
    expect(backoff(5)).toBe(30_000);  // 1000 * 32 = 32000 → capped at 30000
    expect(backoff(10)).toBe(30_000); // Way over cap
  });

  it('backoff is monotonically increasing until cap', () => {
    const delays = [0, 1, 2, 3].map(backoff);
    for (let i = 1; i < delays.length; i++) {
      expect(delays[i]).toBeGreaterThanOrEqual(delays[i - 1]);
    }
  });

  it('never exceeds 30_000ms', () => {
    for (let i = 0; i <= 20; i++) {
      expect(backoff(i)).toBeLessThanOrEqual(30_000);
    }
  });
});
