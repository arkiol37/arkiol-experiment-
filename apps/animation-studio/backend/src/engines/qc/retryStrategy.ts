export interface RetryDecision { shouldRetry: boolean; delayMs: number; maxAttempts: number; strategy: string; reason: string; }
export function computeRetryStrategy(error: { code?: string; message: string; retryable?: boolean }, attempt: number, maxAttempts = 3): RetryDecision {
  if (error.code === 'INVALID_INPUT' || error.code === 'INSUFFICIENT_CREDITS') return { shouldRetry: false, delayMs: 0, maxAttempts: 0, strategy: 'abort', reason: `Non-retryable: ${error.code}` };
  if (attempt >= maxAttempts) return { shouldRetry: false, delayMs: 0, maxAttempts, strategy: 'abort', reason: 'Max attempts' };
  if (error.code === 'RATE_LIMITED' || error.message.includes('429')) return { shouldRetry: true, delayMs: Math.min(30000, 5000 * 2 ** attempt), maxAttempts, strategy: 'exponential_backoff', reason: 'Rate limited' };
  if (error.code === 'PROVIDER_ERROR') return { shouldRetry: true, delayMs: 2000, maxAttempts, strategy: 'provider_failover', reason: 'Provider error' };
  if (error.retryable !== false) return { shouldRetry: true, delayMs: Math.min(8000, 1000 * 2 ** attempt), maxAttempts, strategy: 'exponential_backoff', reason: 'Transient' };
  return { shouldRetry: false, delayMs: 0, maxAttempts, strategy: 'abort', reason: 'Unknown' };
}
