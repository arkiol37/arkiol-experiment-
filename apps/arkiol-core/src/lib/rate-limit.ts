// src/lib/rate-limit.ts
// Safe rate limiter — passthrough when Upstash Redis is not configured.
import { detectCapabilities } from '@arkiol/shared';

export type LimiterKey = 'generate' | 'explore' | 'campaign' | 'export' | 'api' | 'auth' | 'webhook' | 'billing' | 'bulk';

export interface RateLimitResult {
  success:   boolean;
  remaining: number;
  reset:     number;
  limit:     number;
}

const PASSTHROUGH_RESULT: RateLimitResult = {
  success: true, remaining: 999, reset: 0, limit: 999,
};

let _limiters: any = null;

function getLimiters() {
  if (_limiters) return _limiters;
  const env = process.env;
  if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) return null;
  try {
    const { Ratelimit } = require('@upstash/ratelimit');
    const { Redis }     = require('@upstash/redis');
    const redis = new Redis({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN });
    _limiters = {
      generate: new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(20,  '1 m'),  prefix: 'rl:generate', analytics: true }),
      explore:  new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(30,  '1 m'),  prefix: 'rl:explore',  analytics: true }),
      campaign: new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(10,  '1 m'),  prefix: 'rl:campaign' }),
      export:   new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(50,  '1 m'),  prefix: 'rl:export' }),
      api:      new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(300, '1 m'),  prefix: 'rl:api' }),
      auth:     new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(10,  '15 m'), prefix: 'rl:auth',     analytics: true }),
      webhook:  new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(100, '1 m'),  prefix: 'rl:webhook' }),
      billing:  new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(10,  '1 m'),  prefix: 'rl:billing' }),
      bulk:     new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(5,   '1 m'),  prefix: 'rl:bulk',     analytics: true }),
    };
    return _limiters;
  } catch {
    return null;
  }
}

export async function rateLimit(
  identifier: string,
  key: LimiterKey = 'api'
): Promise<RateLimitResult> {
  const limiters = getLimiters();
  if (!limiters) return PASSTHROUGH_RESULT;
  try {
    const result = await limiters[key].limit(identifier);
    return { success: result.success, remaining: result.remaining, reset: result.reset, limit: result.limit };
  } catch {
    return PASSTHROUGH_RESULT;
  }
}

export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  return {
    'X-RateLimit-Limit':     String(result.limit),
    'X-RateLimit-Remaining': String(result.remaining),
    'X-RateLimit-Reset':     String(result.reset),
    ...(result.success ? {} : { 'Retry-After': String(Math.ceil((result.reset - Date.now()) / 1000)) }),
  };
}
