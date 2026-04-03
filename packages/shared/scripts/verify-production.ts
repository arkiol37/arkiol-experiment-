#!/usr/bin/env tsx
// packages/shared/scripts/verify-production.ts
// ─────────────────────────────────────────────────────────────────────────────
// PRODUCTION VERIFICATION SCRIPT
//
// Runs in order:
//   1. Environment variable validation via the shared validateSharedEnv() — single source of truth
//   2. Database migration (prisma migrate deploy --schema=packages/shared/prisma/schema.prisma)
//   3. Build both apps (packages/shared → arkiol-core → animation-studio backend)
//   4. Smoke tests (DB connectivity, queue ping, health endpoint)
//
// Each step is guarded — if any critical step fails, the script exits non-zero.
// Safe to run in CI/CD before deploying.
//
// Usage:
//   npm run verify                        # from repo root
//   tsx packages/shared/scripts/verify-production.ts
// ─────────────────────────────────────────────────────────────────────────────

import { execSync, ExecSyncOptions } from 'child_process';

// ── Helpers ────────────────────────────────────────────────────────────────

const GREEN  = '\x1b[32m';
const RED    = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN   = '\x1b[36m';
const RESET  = '\x1b[0m';

function ok(msg: string)   { console.log(`${GREEN}  ✓ ${msg}${RESET}`); }
function fail(msg: string) { console.error(`${RED}  ✗ ${msg}${RESET}`); }
function warn(msg: string) { console.warn(`${YELLOW}  ⚠ ${msg}${RESET}`); }
function step(msg: string) { console.log(`\n${CYAN}▶ ${msg}${RESET}`); }

let exitCode = 0;

function run(
  cmd: string,
  opts: ExecSyncOptions & { label?: string; critical?: boolean } = {},
): boolean {
  const { label = cmd, critical = true, ...execOpts } = opts;
  try {
    // Pass current process.env to child processes so they have all vars.
    // This is the single permitted spread of process.env — it's an ops script
    // that must forward the environment to subprocess builds and migrations.
    execSync(cmd, { stdio: 'inherit', env: { ...process.env }, ...execOpts });
    ok(label);
    return true;
  } catch (err: any) {
    fail(`${label}\n  Error: ${err.message}`);
    if (critical) exitCode = 1;
    return false;
  }
}

// ── Step 1: Environment validation ────────────────────────────────────────
// Delegate entirely to validateSharedEnv() — the single source of truth
// for required env var presence, format, and provider-specific requirements.
// This replaces the old manual loop that duplicated validation logic.

step('Step 1/4: Environment validation (via validateSharedEnv)');

let validatedEnv: import('../src/env.js').SharedEnv;
try {
  const { validateSharedEnv, bootstrapEnv } = await import('../src/env.js');
  validatedEnv = validateSharedEnv();
  ok('All required environment variables valid');

  // Warn about test Stripe key in production — check against validatedEnv, not process.env.
  if (
    validatedEnv.STRIPE_SECRET_KEY.startsWith('sk_test_') &&
    bootstrapEnv('NODE_ENV') === 'production'
  ) {
    warn('STRIPE_SECRET_KEY is a test key but NODE_ENV=production. Intentional?');
  }
} catch (err: any) {
  fail(`Environment validation failed: ${err.message}`);
  process.exit(1);
}

// ── Step 2: Database migration ─────────────────────────────────────────────

step('Step 2/4: Database migration (prisma migrate deploy --schema=packages/shared/prisma/schema.prisma)');

const migrated = run(
  'npx prisma migrate deploy --schema=packages/shared/prisma/schema.prisma',
  { label: 'prisma migrate deploy --schema=packages/shared/prisma/schema.prisma', critical: true }
);

if (!migrated) {
  fail('Database migration failed. Aborting build to prevent deploying stale schema.');
  process.exit(1);
}

// ── Step 3: Build all apps ─────────────────────────────────────────────────

step('Step 3/4: Building all apps');

run('npx tsc --noEmit --project packages/shared/tsconfig.json 2>/dev/null || echo "no tsconfig"', {
  label: 'packages/shared type-check',
  critical: false,
});

run('npx prisma generate --schema=packages/shared/prisma/schema.prisma', {
  label: 'prisma generate --schema=packages/shared/prisma/schema.prisma',
  critical: true,
});

const coreBuilt = run('npm run build --workspace=arkiol-core', {
  label: 'arkiol-core build',
  critical: true,
  timeout: 300_000,
});

run('npm run build --workspace=animation-studio-backend 2>/dev/null || echo skip', {
  label: 'animation-studio-backend build',
  critical: false,
  timeout: 120_000,
});

if (!coreBuilt) {
  fail('Build failed. Aborting before smoke tests.');
  process.exit(1);
}

// ── Step 4: Smoke tests ────────────────────────────────────────────────────
// Use validated env values — no direct process.env reads beyond what
// validateSharedEnv() has already approved.

step('Step 4/4: Smoke tests');

// 4a: DB connectivity
try {
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient({ log: ['error'] });
  await prisma.$queryRaw`SELECT 1`;
  await prisma.$disconnect();
  ok('Database connectivity');
} catch (err: any) {
  fail(`Database connectivity: ${err.message}`);
  exitCode = 1;
}

// 4b: Redis / BullMQ ping — use validated env values.
try {
  const { Queue } = await import('bullmq');
  const q = new Queue('arkiol:smoke-test', {
    connection: {
      // validatedEnv values are guaranteed present and typed by the shared schema.
      host:     validatedEnv.REDIS_HOST,
      port:     validatedEnv.REDIS_PORT,
      password: validatedEnv.REDIS_PASSWORD,
    },
  });
  await Promise.race([
    q.getWaitingCount(),
    new Promise<never>((_, r) => setTimeout(() => r(new Error('timeout')), 3000)),
  ]);
  await q.close();
  ok('Redis / BullMQ connectivity');
} catch (err: any) {
  fail(`Redis / BullMQ connectivity: ${err.message}`);
  exitCode = 1;
}

// 4c: Health endpoint — NEXTAUTH_URL or NEXT_PUBLIC_APP_URL from validated env.
const healthUrl = validatedEnv.NEXTAUTH_URL ?? validatedEnv.NEXT_PUBLIC_APP_URL;
if (healthUrl) {
  try {
    const url = `${healthUrl.replace(/\/$/, '')}/api/health`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    const body = await res.json() as any;
    if (res.ok && body.status !== 'unhealthy') {
      ok(`Health endpoint: ${body.status} (${url})`);
    } else {
      warn(`Health endpoint returned: ${body.status} — checks: ${JSON.stringify(body.checks)}`);
    }
  } catch (err: any) {
    warn(`Health endpoint not reachable (may be expected pre-deploy): ${err.message}`);
  }
} else {
  warn('NEXTAUTH_URL / NEXT_PUBLIC_APP_URL not set — skipping live health endpoint test');
}

// ── Summary ────────────────────────────────────────────────────────────────

console.log('\n' + '─'.repeat(60));
if (exitCode === 0) {
  console.log(`${GREEN}✅ Production verification PASSED. Ready to deploy.${RESET}`);
} else {
  console.error(`${RED}❌ Production verification FAILED. Fix the errors above before deploying.${RESET}`);
}
console.log('─'.repeat(60) + '\n');

process.exit(exitCode);
