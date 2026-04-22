// apps/render-backend/src/routes/health.ts
//
// GET /health — Render's default health check probes "/" or
// "/healthz". We expose both.
import { Router, type Request, type Response } from 'express';
import { prisma } from '../lib/prisma';

export const healthRouter = Router();

healthRouter.get('/', async (_req: Request, res: Response) => {
  const checks: Record<string, unknown> = {
    service: 'arkiol-render-backend',
    status:  'ok',
    uptime:  Math.round(process.uptime()),
  };

  // DB probe is best-effort — a slow query shouldn't mark the
  // whole service unhealthy, but a hard connection failure
  // should.
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = 'ok';
  } catch (err: any) {
    checks.database = 'down';
    checks.databaseError = err?.message ?? String(err);
    res.status(503).json(checks);
    return;
  }

  res.json(checks);
});
