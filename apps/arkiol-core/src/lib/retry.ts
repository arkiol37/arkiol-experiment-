// src/lib/retry.ts
//
// Framework-neutral retry helper. Lives in its own file (not in
// error-handling.ts) so engines/* and inlineGenerate.ts can import
// it without dragging `next/server` into the module chain — this
// keeps the generation pipeline runnable on the standalone Render
// backend (apps/render-backend), which has no Next.js runtime.
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

/**
 * Safely extract a string `code` property from an Error
 * (e.g. NodeJS.ErrnoException or custom error subclasses).
 */
export function extractErrorCode(err: Error, fallback: string): string {
  if ("code" in err) {
    const code = (err as Error & { code: unknown }).code;
    if (typeof code === "string") return code;
  }
  return fallback;
}
