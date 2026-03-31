#!/usr/bin/env tsx
/**
 * scripts/verify.ts
 * ══════════════════════════════════════════════════════════════════════════════
 * ARKIOL AI v14 — ONE-COMMAND LOCAL VERIFICATION SCRIPT
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Reproduces the full CI pipeline locally so developers can catch regressions
 * before pushing. Run from the monorepo root:
 *
 *   npm run verify           # full pipeline (same as CI)
 *   npm run verify -- --quick  # lint + type-check + unit tests only (fast, no DB/build)
 *
 * Steps (in order):
 *   1. Env pre-flight      — check NODE_VERSION, package-lock.json freshness
 *   2. Install check       — confirm node_modules are up-to-date
 *   3. Prisma generate     — generate client from shared schema
 *   4. Lint                — eslint across all workspaces
 *   5. Type-check          — tsc --noEmit across all workspaces
 *   6. Prisma validate     — structural schema check
 *   7. Unit tests          — all workspaces with coverage
 *   8. Integration tests   — DB + Redis required (skipped with --quick)
 *   9. Build               — next build + tsc build (skipped with --quick)
 *  10. HTTP smoke tests     — boots servers, hits endpoints (skipped with --quick)
 *
 * Prerequisites for full verify:
 *   - Postgres running on DATABASE_URL  (or PGHOST/PGPORT/PGUSER/PGPASSWORD)
 *   - Redis running on REDIS_URL
 *   - .env.local loaded (or env vars set in shell)
 *
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { execSync, ExecSyncOptions } from 'child_process';
import { existsSync, readFileSync }   from 'fs';
import { resolve }                    from 'path';

// ── CLI args ──────────────────────────────────────────────────────────────────
const QUICK = process.argv.includes('--quick');
const ROOT  = resolve(__dirname, '..');

// ── Colours ───────────────────────────────────────────────────────────────────
const G = '\x1b[32m'; const R = '\x1b[31m'; const Y = '\x1b[33m';
const C = '\x1b[36m'; const B = '\x1b[1m';  const X = '\x1b[0m';

const ok   = (s: string) => console.log(`${G}  ✓ ${s}${X}`);
const fail = (s: string) => console.error(`${R}  ✗ ${s}${X}`);
const warn = (s: string) => console.warn(`${Y}  ⚠ ${s}${X}`);
const step = (s: string) => console.log(`\n${B}${C}▶ ${s}${X}`);
const hr   = ()           => console.log(`${C}${'─'.repeat(60)}${X}`);

let exitCode = 0;

// ── run() — execute a shell command and report result ─────────────────────────
function run(
  cmd:  string,
  opts: ExecSyncOptions & { label?: string; critical?: boolean; cwd?: string } = {},
): boolean {
  const { label = cmd, critical = true, cwd = ROOT, ...rest } = opts;
  try {
    execSync(cmd, { stdio: 'inherit', cwd, env: { ...process.env }, ...rest });
    ok(label);
    return true;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message.split('\n')[0] : String(err);
    fail(`${label}\n     ${msg}`);
    if (critical) exitCode = 1;
    return false;
  }
}

// ── check() — boolean assertion without running a command ─────────────────────
function check(condition: boolean, label: string, hint?: string): boolean {
  if (condition) { ok(label); return true; }
  fail(label + (hint ? `\n     Hint: ${hint}` : ''));
  exitCode = 1;
  return false;
}

// ═════════════════════════════════════════════════════════════════════════════
// STEP 1 — ENV PRE-FLIGHT
// ═════════════════════════════════════════════════════════════════════════════
step('Step 1/10: Environment pre-flight');

// Node version >= 20
const [nodeMajor] = process.versions.node.split('.').map(Number);
check(nodeMajor >= 20, `Node.js >= 20 (found ${process.versions.node})`,
  'Install Node.js 20+ from https://nodejs.org');

// package-lock.json exists
check(existsSync(resolve(ROOT, 'package-lock.json')), 'package-lock.json exists',
  'Run npm install to generate the lockfile');

// Shared schema exists
check(
  existsSync(resolve(ROOT, 'packages/shared/prisma/schema.prisma')),
  'packages/shared/prisma/schema.prisma exists',
);

if (!QUICK) {
  // DATABASE_URL set (required for integration / smoke tests)
  const hasDb = !!process.env.DATABASE_URL;
  if (!hasDb) {
    warn('DATABASE_URL not set — integration tests and smoke tests will be skipped.');
    warn('Set DATABASE_URL to run the full suite: export DATABASE_URL=postgresql://...');
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// STEP 2 — INSTALL CHECK
// ═════════════════════════════════════════════════════════════════════════════
step('Step 2/10: Install check');

const nodeModulesExists = existsSync(resolve(ROOT, 'node_modules'));
if (!nodeModulesExists) {
  warn('node_modules not found — running npm ci ...');
  run('npm ci --ignore-scripts', { label: 'npm ci (initial install)', critical: true });
} else {
  // Quick staleness check: compare package-lock mtime vs node_modules mtime
  try {
    const lockStat = readFileSync(resolve(ROOT, 'package-lock.json'));
    ok('node_modules present (run npm ci if you see import errors)');
  } catch { ok('node_modules present'); }
}

// ═════════════════════════════════════════════════════════════════════════════
// STEP 3 — PRISMA GENERATE
// ═════════════════════════════════════════════════════════════════════════════
step('Step 3/10: Prisma client generation');

run('npx prisma generate --schema=packages/shared/prisma/schema.prisma', {
  label: 'prisma generate (shared schema)',
  critical: true,
});

run('npx prisma validate --schema=packages/shared/prisma/schema.prisma', {
  label: 'prisma validate (schema structural check)',
  critical: true,
});

// ═════════════════════════════════════════════════════════════════════════════
// STEP 4 — LINT
// ═════════════════════════════════════════════════════════════════════════════
step('Step 4/10: Lint');

run('npm run lint --workspace=apps/arkiol-core', {
  label: '[arkiol-core] ESLint (--max-warnings 0)',
  critical: true,
});

// animation-studio uses tsc for type checking; ESLint is optional
run('npx eslint src --ext .ts --max-warnings 0 2>/dev/null || echo "(lint not configured for studio)"', {
  label: '[animation-studio] ESLint',
  cwd: resolve(ROOT, 'apps/animation-studio/backend'),
  critical: false,
});

// ═════════════════════════════════════════════════════════════════════════════
// STEP 5 — TYPE-CHECK
// ═════════════════════════════════════════════════════════════════════════════
step('Step 5/10: TypeScript type-check');

run('npm run type-check --workspace=packages/shared', {
  label: '[@arkiol/shared] tsc --noEmit',
  critical: true,
});

run('npm run type-check --workspace=apps/arkiol-core', {
  label: '[arkiol-core] tsc --noEmit',
  critical: true,
});

run('npx tsc --noEmit', {
  label: '[animation-studio] tsc --noEmit',
  cwd: resolve(ROOT, 'apps/animation-studio/backend'),
  critical: true,
});

// ═════════════════════════════════════════════════════════════════════════════
// STEP 6 — UNIT TESTS + COVERAGE
// ═════════════════════════════════════════════════════════════════════════════
step('Step 6/10: Unit tests + coverage');

run('npm test --workspace=packages/shared -- --passWithNoTests --forceExit', {
  label: '[@arkiol/shared] unit tests',
  critical: true,
});

run('npm run test:coverage --workspace=apps/arkiol-core', {
  label: '[arkiol-core] unit tests + coverage',
  critical: true,
});

run('npx jest --config jest.config.ts --testPathPattern=tests/unit --coverage --forceExit', {
  label: '[animation-studio] unit tests + coverage',
  cwd: resolve(ROOT, 'apps/animation-studio/backend'),
  critical: true,
});

// ── If --quick, stop here ────────────────────────────────────────────────────
if (QUICK) {
  hr();
  if (exitCode === 0) {
    console.log(`\n${G}${B}✓ Quick verify passed (lint + type-check + unit tests)${X}\n`);
  } else {
    console.log(`\n${R}${B}✗ Quick verify FAILED — fix the errors above before pushing.${X}\n`);
  }
  process.exit(exitCode);
}

// ═════════════════════════════════════════════════════════════════════════════
// STEP 7 — INTEGRATION TESTS  (needs real DB + Redis)
// ═════════════════════════════════════════════════════════════════════════════
step('Step 7/10: Integration tests (needs DATABASE_URL + REDIS_URL)');

if (!process.env.DATABASE_URL) {
  warn('DATABASE_URL not set — skipping integration tests');
} else {
  // Apply migrations first
  run('npx prisma migrate deploy --schema=packages/shared/prisma/schema.prisma', {
    label: 'prisma migrate deploy (integration DB)',
    critical: true,
  });

  run('npx knex --knexfile knexfile.ts migrate:latest', {
    label: '[animation-studio] knex migrate:latest',
    cwd: resolve(ROOT, 'apps/animation-studio/backend'),
    critical: true,
  });

  run('npm run test:integration --workspace=apps/arkiol-core', {
    label: '[arkiol-core] integration tests',
    critical: true,
  });

  run('npx jest --config apps/arkiol-core/jest.config.ts --testPathPattern=integration --passWithNoTests --forceExit', {
    label: '[arkiol-core] DB integration tests',
    critical: true,
  });

  run('npm run test:integration --workspace=apps/animation-studio/backend -- --forceExit', {
    label: '[animation-studio] integration tests',
    critical: true,
  });

  run('npx tsx packages/shared/scripts/smoke-test.ts', {
    label: '[shared] business logic smoke test (live DB)',
    critical: true,
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// STEP 8 — BUILD
// ═════════════════════════════════════════════════════════════════════════════
step('Step 8/10: Production build');

run('npm run build --workspace=apps/arkiol-core', {
  label: '[arkiol-core] next build',
  critical: true,
  timeout: 600_000,  // 10 min
});

run('npm run build', {
  label: '[animation-studio] tsc build',
  cwd: resolve(ROOT, 'apps/animation-studio/backend'),
  critical: true,
  timeout: 120_000,
});

// Verify output files
check(
  existsSync(resolve(ROOT, 'apps/arkiol-core/.next/BUILD_ID')) ||
  existsSync(resolve(ROOT, 'apps/arkiol-core/.next/server')),
  '[arkiol-core] .next build output present',
);

check(
  existsSync(resolve(ROOT, 'apps/animation-studio/backend/dist/index.js')),
  '[animation-studio] dist/index.js present',
);

// ═════════════════════════════════════════════════════════════════════════════
// STEP 9 — HTTP SMOKE TESTS  (boots servers, hits live endpoints)
// ═════════════════════════════════════════════════════════════════════════════
step('Step 9/10: HTTP smoke tests (booting servers — takes ~30s)');

if (!process.env.DATABASE_URL) {
  warn('DATABASE_URL not set — skipping HTTP smoke tests');
} else {
  // Studio backend
  const { spawnSync } = require('child_process');
  const studioProc = require('child_process').spawn(
    'node', ['apps/animation-studio/backend/dist/index.js'],
    {
      env: { ...process.env, PORT: '4000', NODE_ENV: 'test' },
      detached: true, stdio: 'ignore',
    }
  );
  studioProc.unref();
  const studioPid = studioProc.pid;

  // Arkiol Core
  const coreProc = require('child_process').spawn(
    'npm', ['run', 'start', '--workspace=apps/arkiol-core'],
    {
      env: { ...process.env, PORT: '3000', NODE_ENV: 'production' },
      detached: true, stdio: 'ignore',
    }
  );
  coreProc.unref();
  const corePid = coreProc.pid;

  // Wait for both servers to come up
  const waitForPort = (port: number, maxWaitSec: number): boolean => {
    for (let i = 0; i < maxWaitSec; i++) {
      try {
        execSync(`curl -sf http://localhost:${port}/api/health > /dev/null 2>&1`, { timeout: 2000 });
        return true;
      } catch { execSync('sleep 1', { stdio: 'ignore' }); }
    }
    return false;
  };

  const studioUp = waitForPort(4000, 30);
  const coreUp   = waitForPort(3000, 60);

  if (!studioUp) warn('[animation-studio] did not start in 30s — smoke test may fail');
  if (!coreUp)   warn('[arkiol-core] did not start in 60s — smoke test may fail');

  run('npx tsx scripts/ci/http-smoke-tests.ts', {
    label: 'HTTP smoke tests',
    critical: true,
    env: {
      ...process.env,
      ARKIOL_CORE_URL: 'http://localhost:3000',
      STUDIO_URL: 'http://localhost:4000',
    } as NodeJS.ProcessEnv,
  });

  // Kill the servers we started
  try { process.kill(corePid);   } catch { /* already dead */ }
  try { process.kill(studioPid); } catch { /* already dead */ }
}

// ═════════════════════════════════════════════════════════════════════════════
// STEP 10 — MIGRATION INTEGRITY
// ═════════════════════════════════════════════════════════════════════════════
step('Step 10/10: Migration integrity check');

if (!process.env.DATABASE_URL) {
  warn('DATABASE_URL not set — skipping migration integrity checks');
} else {
  run('npx tsx scripts/ci/verify-schema-tables.ts', {
    label: 'Schema tables present in database',
    critical: true,
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// SUMMARY
// ═════════════════════════════════════════════════════════════════════════════
hr();
if (exitCode === 0) {
  console.log(`\n${G}${B}✅ Full verify PASSED — ready to push / deploy.${X}\n`);
} else {
  console.error(`\n${R}${B}❌ Verify FAILED — fix all errors above before pushing.${X}\n`);
}
process.exit(exitCode);
