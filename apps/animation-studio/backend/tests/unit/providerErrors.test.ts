/**
 * apps/animation-studio/backend/tests/unit/providerErrors.test.ts
 *
 * Unit tests for providers/providerAdapter.ts pure exports:
 *  - ProviderError class
 *  - isRetryableStatus function
 *
 * No DB, no network calls.
 */

jest.mock('../../../src/config/env', () => ({
  config: {
    AWS_REGION: 'us-east-1',
    AWS_ACCESS_KEY_ID: 'key',
    AWS_SECRET_ACCESS_KEY: 'secret',
    CDN_URL: 'https://cdn.example.com',
    ENCRYPTION_KEY: 'a'.repeat(64),
    STRIPE_SECRET_KEY: 'sk_test_xxx',
    DATABASE_URL: 'postgresql://localhost/test',
    RATE_LIMIT_WINDOW_MS: 60000,
    RATE_LIMIT_MAX_REQUESTS: 100,
    RENDER_RATE_LIMIT_MAX: 10,
  },
}));
jest.mock('../../../src/config/logger', () => ({ logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() } }));

import { ProviderError, isRetryableStatus } from '../../../src/providers/providerAdapter';

// ══════════════════════════════════════════════════════════════════════════════
// ProviderError
// ══════════════════════════════════════════════════════════════════════════════
describe('ProviderError', () => {
  it('is an instance of Error', () => {
    expect(new ProviderError('openai', 500, 'Server error')).toBeInstanceOf(Error);
  });

  it('is an instance of ProviderError', () => {
    expect(new ProviderError('openai', 500, 'Server error')).toBeInstanceOf(ProviderError);
  });

  it('name is ProviderError', () => {
    expect(new ProviderError('openai', 500, 'msg').name).toBe('ProviderError');
  });

  it('message includes provider name and original message', () => {
    const err = new ProviderError('replicate', 503, 'Service unavailable');
    expect(err.message).toContain('replicate');
    expect(err.message).toContain('Service unavailable');
  });

  it('provider field is set', () => {
    expect(new ProviderError('stability', 400, 'Bad request').provider).toBe('stability');
  });

  it('statusCode field is set', () => {
    expect(new ProviderError('openai', 429, 'Rate limited').statusCode).toBe(429);
  });

  it('retryable defaults to false', () => {
    expect(new ProviderError('openai', 500, 'error').retryable).toBe(false);
  });

  it('retryable can be set to true', () => {
    expect(new ProviderError('openai', 500, 'error', true).retryable).toBe(true);
  });

  it('can be thrown and caught', () => {
    expect(() => { throw new ProviderError('openai', 500, 'err'); }).toThrow(Error);
  });

  it('different providers produce different message prefixes', () => {
    const a = new ProviderError('openai', 500, 'msg');
    const b = new ProviderError('anthropic', 500, 'msg');
    expect(a.message).not.toBe(b.message);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// isRetryableStatus
// ══════════════════════════════════════════════════════════════════════════════
describe('isRetryableStatus', () => {
  const RETRYABLE = [429, 500, 502, 503, 504];
  const NOT_RETRYABLE = [200, 201, 400, 401, 403, 404, 422];

  for (const status of RETRYABLE) {
    it(`${status} is retryable`, () => {
      expect(isRetryableStatus(status)).toBe(true);
    });
  }

  for (const status of NOT_RETRYABLE) {
    it(`${status} is NOT retryable`, () => {
      expect(isRetryableStatus(status)).toBe(false);
    });
  }

  it('is deterministic', () => {
    expect(isRetryableStatus(429)).toBe(isRetryableStatus(429));
    expect(isRetryableStatus(200)).toBe(isRetryableStatus(200));
  });
});
