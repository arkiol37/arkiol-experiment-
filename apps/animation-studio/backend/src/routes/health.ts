/**
 * Health Check — Animation Studio (Task #7 hardened)
 *
 * GET /api/health        — Public, basic liveness check
 * GET /api/health/ready  — Detailed readiness (DB + Redis + S3 + Stripe config)
 * GET /api/health/live   — Kubernetes liveness probe
 */
import { Router, Request, Response } from 'express';
import { db }          from '../config/database';
import { redis }       from '../config/redis';
import { renderQueue } from '../jobs/renderQueue';
import { config }      from '../config/env';
import { bootstrapEnv } from '@arkiol/shared';

const router = Router();

interface CheckResult {
  status: 'ok' | 'error' | 'warn';
  detail?: string;
  latencyMs?: number;
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, r) => setTimeout(() => r(new Error(`timeout after ${ms}ms`)), ms)),
  ]);
}

router.get('/', async (_req: Request, res: Response) => {
  // npm_package_version is injected by npm at runtime — not a config secret.
  // bootstrapEnv is the correct accessor for pre-validation, allowlisted reads.
  const version = bootstrapEnv('npm_package_version') ?? '1.0.0';
  res.json({
    status: 'ok',
    service: 'animation-studio-api',
    version,
    timestamp: new Date().toISOString(),
  });
});

router.get('/ready', async (_req: Request, res: Response) => {
  const checks: Record<string, CheckResult> = {};
  let critical = true;

  // ── Database ──────────────────────────────────────────────────────────────
  const dbStart = Date.now();
  try {
    await withTimeout(db.raw('SELECT 1'), 3000);
    checks.database = { status: 'ok', latencyMs: Date.now() - dbStart };
  } catch (e: any) {
    checks.database = { status: 'error', detail: e.message, latencyMs: Date.now() - dbStart };
    critical = false;
  }

  // ── Redis ─────────────────────────────────────────────────────────────────
  const redisStart = Date.now();
  try {
    await withTimeout(redis.ping(), 2000);
    const active = await withTimeout(renderQueue.getActiveCount(), 1000);
    checks.redis = { status: 'ok', latencyMs: Date.now() - redisStart, detail: `active jobs: ${active}` };
  } catch (e: any) {
    checks.redis = { status: 'error', detail: e.message, latencyMs: Date.now() - redisStart };
    critical = false;
  }

  // ── S3 / Storage config ───────────────────────────────────────────────────
  const hasS3 = !!(config.AWS_ACCESS_KEY_ID && config.AWS_REGION && config.S3_BUCKET_ASSETS);
  checks.storage = hasS3
    ? { status: 'ok', detail: `bucket=${config.S3_BUCKET_ASSETS} region=${config.AWS_REGION}` }
    : { status: 'error', detail: 'S3 config missing (AWS_ACCESS_KEY_ID, AWS_REGION, or S3_BUCKET_ASSETS)' };
  if (!hasS3) critical = false;

  // ── Stripe config ─────────────────────────────────────────────────────────
  const stripeOk = !!(config.STRIPE_SECRET_KEY &&
    (config.STRIPE_SECRET_KEY.startsWith('sk_live_') || config.STRIPE_SECRET_KEY.startsWith('sk_test_')));
  checks.billing = stripeOk
    ? { status: 'ok', detail: `Stripe ${config.STRIPE_SECRET_KEY.startsWith('sk_live_') ? 'live' : 'test'} mode` }
    : { status: 'error', detail: 'STRIPE_SECRET_KEY missing or malformed' };

  // ── Environment completeness ──────────────────────────────────────────────
  // Verify required config values are non-empty. We check the validated config
  // object fields directly — no direct process.env reads.
  const configMissing: string[] = [];
  if (!config.DATABASE_URL)        configMissing.push('DATABASE_URL');
  if (!config.REDIS_URL)           configMissing.push('REDIS_URL');
  if (!config.STRIPE_SECRET_KEY)   configMissing.push('STRIPE_SECRET_KEY');
  if (!config.AWS_ACCESS_KEY_ID)   configMissing.push('AWS_ACCESS_KEY_ID');
  if (!config.ENCRYPTION_KEY)      configMissing.push('ENCRYPTION_KEY');
  checks.environment = configMissing.length === 0
    ? { status: 'ok', detail: 'all required vars present' }
    : { status: 'error', detail: `Missing: ${configMissing.join(', ')}` };
  if (configMissing.length > 0) critical = false;

  const hasAnyError = Object.values(checks).some(c => c.status === 'error');
  const overallStatus = !critical ? 'unavailable' : hasAnyError ? 'degraded' : 'ready';

  res.status(critical ? 200 : 503).json({
    status: overallStatus,
    checks,
    uptime:    process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

router.get('/live', (_req: Request, res: Response) => {
  res.json({ status: 'alive', pid: process.pid });
});

export default router;
