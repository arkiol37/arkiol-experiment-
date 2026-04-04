// src/lib/error-handling.ts
import { detectCapabilities } from '@arkiol/shared';
import { NextRequest, NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { ApiError } from './types';

type Handler = (req: NextRequest, ctx?: any) => Promise<NextResponse>;

export function withErrorHandling(handler: Handler): Handler {
  return async (req: NextRequest, ctx?: any) => {
    try {
      return await handler(req, ctx);
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        const payload: Record<string, unknown> = { error: err.message };
        if (err.code) payload.code = err.code;
        return NextResponse.json(payload, { status: err.statusCode ?? (err as any).status ?? 500 });
      }
      if (err instanceof ZodError) {
        return NextResponse.json({ error: 'Validation failed', details: err.flatten() }, { status: 400 });
      }
      const errorId = crypto.randomUUID();
      console.error(`[${errorId}] Unhandled error in ${req.method} ${req.url}:`, err);
      if (detectCapabilities().sentry) {
        try {
          const Sentry = await import('@sentry/nextjs');
          Sentry.captureException(err, { extra: { url: req.url, method: req.method, errorId } });
        } catch { /* non-fatal */ }
      }
      return NextResponse.json({ error: 'An unexpected error occurred', errorId }, { status: 500 });
    }
  };
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: { maxAttempts?: number; baseDelayMs?: number; maxDelayMs?: number; onRetry?: (attempt: number, err: unknown) => void } = {}
): Promise<T> {
  const { maxAttempts = 3, baseDelayMs = 1000, maxDelayMs = 30_000, onRetry } = options;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try { return await fn(); }
    catch (err: any) {
      lastErr = err;
      const status = err?.status ?? err?.response?.status;
      if (status && status >= 400 && status < 500 && status !== 429) throw err;
      if (attempt < maxAttempts) {
        const delay = Math.min(baseDelayMs * Math.pow(2, attempt - 1) + Math.random() * 500, maxDelayMs);
        onRetry?.(attempt, err);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastErr;
}

// ── Capability guard helpers ──────────────────────────────────────────────────

/** Returns a 503 response when a required capability is missing */
export function featureUnavailable(feature: string, missing: string): NextResponse {
  return NextResponse.json(
    {
      error:     'Feature unavailable',
      feature,
      message:   `${feature} requires ${missing} to be configured.`,
      configure: `Add the required environment variables to enable this feature.`,
    },
    { status: 503 }
  );
}

/** Returns a 503 response when database is not configured */
export function dbUnavailable(): NextResponse {
  return featureUnavailable('Database', 'DATABASE_URL');
}

/** Returns a 503 response when auth is not configured */
export function authUnavailable(): NextResponse {
  return featureUnavailable('Authentication', 'NEXTAUTH_SECRET and DATABASE_URL');
}

/** Returns a 503 response when AI is not configured */
export function aiUnavailable(): NextResponse {
  return featureUnavailable('AI Generation', 'OPENAI_API_KEY');
}

/** Returns a 503 response when storage is not configured */
export function storageUnavailable(): NextResponse {
  return featureUnavailable('Storage', 'AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, and S3_BUCKET_NAME');
}

/** Returns a 503 response when billing is not configured */
export function billingUnavailable(): NextResponse {
  return featureUnavailable('Billing', 'PADDLE_API_KEY (or STRIPE_SECRET_KEY) and related billing environment variables');
}

/** Returns a 503 response when queue/Redis is not configured */
export function queueUnavailable(): NextResponse {
  return featureUnavailable('Job Queue', 'REDIS_HOST');
}
