// src/app/api/health/route.ts
// Health check — reports capability status without crashing on missing services.
import { detectCapabilities } from '@arkiol/shared';
import { NextResponse } from 'next/server';

// Vercel route config — replaces vercel.json functions block
export const maxDuration = 10;


export const dynamic = 'force-dynamic';

export async function GET() {
  const caps = detectCapabilities();

  const checks: Record<string, any> = {};

  // Database
  if (caps.database) {
    const start = Date.now();
    try {
      const { prisma } = await import('../../../lib/prisma');
      await Promise.race([
        prisma.$queryRaw`SELECT 1`,
        new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 3000)),
      ]);
      checks.database = { status: 'ok', latencyMs: Date.now() - start };
    } catch (err: any) {
      checks.database = { status: 'error', latencyMs: Date.now() - start, detail: err.message };
    }
  } else {
    checks.database = { status: 'unconfigured', detail: 'DATABASE_URL not set' };
  }

  // Redis / Queue
  if (caps.queue) {
    const start = Date.now();
    try {
      const { generationQueue } = await import('../../../lib/queue');
      await Promise.race([
        generationQueue.getWaitingCount(),
        new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 2000)),
      ]);
      checks.redis = { status: 'ok', latencyMs: Date.now() - start };
    } catch (err: any) {
      checks.redis = { status: 'error', latencyMs: Date.now() - start, detail: err.message };
    }
  } else {
    checks.redis = { status: 'unconfigured', detail: 'REDIS_HOST not set — queue features disabled' };
  }

  // Storage
  checks.storage = caps.storage
    ? { status: 'ok', detail: `S3 configured: ${process.env.S3_BUCKET_NAME}` }
    : { status: 'unconfigured', detail: 'AWS credentials not set — file upload disabled' };

  // AI
  checks.ai = caps.ai
    ? { status: 'ok', detail: 'OPENAI_API_KEY configured' }
    : { status: 'unconfigured', detail: 'OPENAI_API_KEY not set — AI generation disabled' };

  // Auth
  checks.auth = caps.auth
    ? { status: 'ok', detail: 'NextAuth configured' }
    : { status: 'unconfigured', detail: 'NEXTAUTH_SECRET not set — authentication disabled' };

  // Billing
  checks.billing = caps.paddleBilling
    ? { status: 'ok', detail: 'Paddle configured' }
    : caps.stripeBilling
    ? { status: 'ok', detail: 'Stripe configured' }
    : { status: 'unconfigured', detail: 'No billing provider configured' };

  // Email
  checks.email = caps.email
    ? { status: 'ok', detail: `SMTP: ${process.env.SMTP_HOST}` }
    : { status: 'unconfigured', detail: 'SMTP not set — emails disabled' };

  const errors   = Object.values(checks).filter((c: any) => c.status === 'error');
  const warnings = Object.values(checks).filter((c: any) => c.status === 'unconfigured');
  const status   = errors.length > 0 ? 'degraded' : warnings.length > 0 ? 'partial' : 'ok';

  return NextResponse.json({
    status,
    timestamp: new Date().toISOString(),
    version:   process.env.npm_package_version ?? '1.0.0',
    uptime:    Math.round(process.uptime()),
    env:       process.env.NODE_ENV,
    capabilities: caps,
    checks,
  }, { status: errors.length > 0 ? 503 : 200 });
}
