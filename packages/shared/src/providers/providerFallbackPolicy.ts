/**
 * Provider Fallback Policy — defines failover chains and circuit-breaker
 * thresholds for video generation providers.
 */
export interface FallbackPolicy {
  primaryProvider: string;
  fallbackChain: string[];
  circuitBreakerThreshold: number;    // consecutive failures before circuit opens
  circuitBreakerCooldownMs: number;   // ms before retrying after circuit opens
  maxRetriesPerProvider: number;
  retryDelayMs: number;
  timeoutMs: number;
}

export const DEFAULT_FALLBACK_POLICY: FallbackPolicy = {
  primaryProvider: 'runway',
  fallbackChain: ['pika', 'sora'],
  circuitBreakerThreshold: 3,
  circuitBreakerCooldownMs: 60000,
  maxRetriesPerProvider: 2,
  retryDelayMs: 3000,
  timeoutMs: 120000,
};

export const CINEMATIC_FALLBACK_POLICY: FallbackPolicy = {
  primaryProvider: 'sora',
  fallbackChain: ['runway', 'pika'],
  circuitBreakerThreshold: 2,
  circuitBreakerCooldownMs: 90000,
  maxRetriesPerProvider: 1,
  retryDelayMs: 5000,
  timeoutMs: 180000,
};

export function getFallbackPolicy(renderMode: string): FallbackPolicy {
  if (renderMode === 'Cinematic Ad') return CINEMATIC_FALLBACK_POLICY;
  return DEFAULT_FALLBACK_POLICY;
}

export function getNextProvider(current: string, policy: FallbackPolicy): string | null {
  if (current === policy.primaryProvider) return policy.fallbackChain[0] || null;
  const idx = policy.fallbackChain.indexOf(current);
  if (idx >= 0 && idx < policy.fallbackChain.length - 1) return policy.fallbackChain[idx + 1];
  return null;
}
