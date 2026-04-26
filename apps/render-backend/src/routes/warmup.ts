// apps/render-backend/src/routes/warmup.ts
//
// GET /warmup
//
// Render free / starter spin instances down after ~15 minutes of
// idle traffic, and the cold-start cost (Node + Prisma + libvips +
// font-registry init) regularly added 30-60s to the user's first
// generate request. Vercel can hit this endpoint from a cron, the
// dashboard mount, or right before /api/generate is called to
// prewarm the slow bits BEFORE the user sees a spinner.
//
// Side effects on hit:
//   1. Prisma connects (the first query opens the pool)
//   2. Sharp / libvips lazy-loads its native bindings
//   3. Custom fonts are downloaded into /tmp via initUltimateFonts()
//   4. The Design Brain module is imported so its DOMAIN_PROFILES
//      table is paged in
//
// All four are idempotent; subsequent warmup calls are essentially
// free. The route is unauth'd because it leaks no data and the
// existing CORS rules already restrict who can call it from a
// browser; back-end probes (Render's health checker, our cron) hit
// it server-to-server.
import { Router, type Request, type Response } from 'express';
import { prisma } from '../lib/prisma';

export const warmupRouter = Router();

warmupRouter.get('/', async (_req: Request, res: Response, next) => {
  try {
    const startedAt = Date.now();
    const timings: Record<string, number> = {};

    // (1) DB warmup. Opens the Prisma connection pool. SELECT 1 is
    // cheap; the win is forcing the first round-trip while the
    // user isn't waiting on it.
    const t1 = Date.now();
    try {
      await prisma.$queryRaw`SELECT 1`;
      timings.databaseMs = Date.now() - t1;
    } catch (err: any) {
      timings.databaseMs = Date.now() - t1;
      // eslint-disable-next-line no-console
      console.warn(`[warmup] db probe failed: ${err?.message ?? err}`);
    }

    // (2) Sharp / libvips warmup. Loading sharp's native bindings
    // is the single largest cold-start cost on Render free
    // (300-800ms on first call). We force it here so the first
    // real render doesn't pay it.
    const t2 = Date.now();
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('sharp');
      timings.sharpMs = Date.now() - t2;
    } catch (err: any) {
      timings.sharpMs = Date.now() - t2;
      // eslint-disable-next-line no-console
      console.warn(`[warmup] sharp load failed: ${err?.message ?? err}`);
    }

    // (3) Font registry warmup. The Google Fonts download to /tmp
    // is the slowest single step in the inline pipeline's font_init
    // stage (1-3s on cold). Pre-loading here lets the actual
    // generate call skip straight to brief_analyze.
    const t3 = Date.now();
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { initUltimateFonts } = require('../../../arkiol-core/src/engines/render/font-registry-ultimate');
      await initUltimateFonts();
      timings.fontsMs = Date.now() - t3;
    } catch (err: any) {
      timings.fontsMs = Date.now() - t3;
      // eslint-disable-next-line no-console
      console.warn(`[warmup] fonts init failed: ${err?.message ?? err}`);
    }

    // (4) Design Brain module warmup. Import is enough — the
    // DOMAIN_PROFILES table is computed at module-load time so this
    // pages it into V8's compiled-code cache.
    const t4 = Date.now();
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../../arkiol-core/src/engines/design-brain');
      timings.designBrainMs = Date.now() - t4;
    } catch (err: any) {
      timings.designBrainMs = Date.now() - t4;
      // eslint-disable-next-line no-console
      console.warn(`[warmup] design-brain load failed: ${err?.message ?? err}`);
    }

    const totalMs = Date.now() - startedAt;
    // eslint-disable-next-line no-console
    console.info(
      `[render-backend] warmup_completed ` +
      `totalMs=${totalMs} ` +
      `databaseMs=${timings.databaseMs ?? -1} ` +
      `sharpMs=${timings.sharpMs ?? -1} ` +
      `fontsMs=${timings.fontsMs ?? -1} ` +
      `designBrainMs=${timings.designBrainMs ?? -1} ` +
      `uptime=${Math.round(process.uptime())}s`,
    );

    res.json({
      service: 'arkiol-render-backend',
      warmup:  'ok',
      uptime:  Math.round(process.uptime()),
      totalMs,
      timings,
    });
  } catch (err) {
    next(err);
  }
});
