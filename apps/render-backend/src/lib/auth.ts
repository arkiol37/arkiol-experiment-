// apps/render-backend/src/lib/auth.ts
//
// The generation backend is invoked exclusively by the Vercel
// frontend's /api/generate route. Requests must carry a shared
// secret (RENDER_GENERATION_KEY) in the X-Arkiol-Render-Key header
// — we intentionally do NOT re-implement NextAuth here because the
// frontend has already authenticated the user and enforced plan /
// rate limit / credit rules before forwarding.
//
// This guard closes the obvious hole: stopping randoms on the
// internet from POSTing /generate and burning OpenAI credits.
import type { Request, Response, NextFunction } from 'express';

export function requireSharedSecret(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const expected = process.env.RENDER_GENERATION_KEY?.trim();
  if (!expected) {
    // Fail closed. A missing secret means the operator forgot to
    // configure it — refusing all traffic is safer than accepting
    // anonymous requests that would consume paid AI calls.
    res.status(503).json({
      error: 'RENDER_GENERATION_KEY not configured on the backend',
    });
    return;
  }

  const provided = String(req.header('x-arkiol-render-key') ?? '').trim();
  if (provided !== expected) {
    res.status(401).json({ error: 'Invalid render key' });
    return;
  }

  next();
}
