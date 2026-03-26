#!/usr/bin/env tsx
/**
 * staging-validation.ts — Arkiol V17 Staging Validation Suite
 *
 * Validates the following without a live database:
 *   1.  process.env hygiene — no direct reads in key modules
 *   2.  Billing provider guards — provider-switch 404 enforcement
 *   3.  Kill-switch behavior — structured error, no placeholder output
 *   4.  AI metadata persistence — AIJobMetadata + AIStageTrace schema
 *   5.  Env validation — required vars enforced per provider
 *   6.  Admin observability — all sections present and query-ready
 *
 * Usage:
 *   tsx packages/shared/scripts/staging-validation.ts
 *
 * Returns exit 0 on all-pass, exit 1 on any failure.
 */

import * as fs    from 'fs';
import * as path  from 'path';
import * as assert from 'assert';

const ROOT = path.resolve(__dirname, '../../../');
const PASS = '  ✅';
const FAIL = '  ❌';
const INFO = '  ℹ️ ';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function ok(label: string) {
  console.log(`${PASS} ${label}`);
  passed++;
}

function fail(label: string, detail?: string) {
  console.log(`${FAIL} ${label}`);
  if (detail) console.log(`     ${detail}`);
  failed++;
  failures.push(label);
}

function section(name: string) {
  const dashes = Math.max(0, 50 - name.length);
  console.log(`\n── ${name} ${'─'.repeat(dashes)}`);
}

function readFile(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

function fileContains(relPath: string, pattern: string | RegExp): boolean {
  try {
    const content = readFile(relPath);
    return typeof pattern === 'string' ? content.includes(pattern) : pattern.test(content);
  } catch {
    return false;
  }
}

function countMatches(relPath: string, pattern: RegExp): number {
  try {
    const content = readFile(relPath);
    return (content.match(pattern) ?? []).length;
  } catch {
    return 0;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1: process.env hygiene
// ─────────────────────────────────────────────────────────────────────────────
section('1. process.env hygiene');

const CLEAN_MODULES: Array<[string, string]> = [
  ['packages/shared/src/billingProvider.ts', 'billingProvider (shared)'],
  ['packages/shared/src/planEnforcer.ts',    'planEnforcer (shared)'],
  ['packages/shared/src/stripeWebhooks.ts',  'stripeWebhooks (shared)'],
  ['packages/shared/src/paddleWebhooks.ts',  'paddleWebhooks (shared)'],
  ['packages/shared/src/assetGenerationEngine.ts', 'assetGenerationEngine (shared)'],
  ['apps/arkiol-core/src/lib/openai.ts',     'lib/openai (core)'],
  ['apps/arkiol-core/src/lib/queue.ts',      'lib/queue (core)'],
  ['apps/arkiol-core/src/lib/s3.ts',         'lib/s3 (core)'],
  ['apps/arkiol-core/src/lib/rate-limit.ts', 'lib/rate-limit (core)'],
  // ── v21: Animation Studio clean modules ───────────────────────────────
  ['apps/animation-studio/backend/src/routes/billing.ts',              'studio routes/billing'],
  ['apps/animation-studio/backend/src/routes/assets.ts',               'studio routes/assets'],
  ['apps/animation-studio/backend/src/billing/billingService.ts',      'studio billing/billingService'],
  ['apps/animation-studio/backend/src/billing/sharedCreditAdapter.ts', 'studio billing/sharedCreditAdapter'],
  ['apps/animation-studio/backend/src/auth/arkiolSessionBridge.ts',    'studio auth/arkiolSessionBridge'],
  ['apps/animation-studio/backend/src/services/ffmpeg/ffmpegPipeline.ts', 'studio ffmpegPipeline'],
  ['apps/animation-studio/backend/src/workers/renderWorker.ts',        'studio workers/renderWorker'],
  // ── v22: Core bootstrap modules — use bootstrapEnv(), not process.env ──────
  ['apps/arkiol-core/src/lib/logger.ts', 'core lib/logger (bootstrapEnv)'],
  ['apps/arkiol-core/src/lib/prisma.ts', 'core lib/prisma (bootstrapEnv)'],
];

for (const [relPath, label] of CLEAN_MODULES) {
  const content = readFile(relPath);
  // Strip comments and safeRead usages
  const stripped = content
    .replace(/\/\/.*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/safeRead\('[A-Z_]+'\)/g, '')
    .replace(/safeEnvRead\('[A-Z_]+'\)/g, '');

  const direct = (stripped.match(/process\.env\./g) ?? []).length;
  if (direct === 0) {
    ok(`No direct process.env in ${label}`);
  } else {
    fail(`Found ${direct} direct process.env reads in ${label}`);
  }
}

// Check orchestrator kill-switch uses checkKillSwitch() not process.env
const orchContent = readFile('apps/arkiol-core/src/engines/ai/pipeline-orchestrator.ts');
const orchKillDirect = /process\.env\.GENERATION_KILL_SWITCH/.test(orchContent);
const orchKillFn     = /checkKillSwitch\(\)/.test(orchContent);
if (!orchKillDirect && orchKillFn) {
  ok('Orchestrator uses checkKillSwitch() — no direct process.env.GENERATION_KILL_SWITCH');
} else if (orchKillDirect) {
  fail('Orchestrator still reads process.env.GENERATION_KILL_SWITCH directly');
} else if (!orchKillFn) {
  fail('Orchestrator missing checkKillSwitch() call');
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2: Billing provider guards
// ─────────────────────────────────────────────────────────────────────────────
section('2. Billing provider guards (404 for inactive provider)');

const paddleWebhook = readFile('apps/arkiol-core/src/app/api/billing/paddle/webhook/route.ts');
const stripeWebhook = readFile('apps/arkiol-core/src/app/api/billing/webhook/route.ts');
const paddleTx      = readFile('apps/arkiol-core/src/app/api/billing/paddle/transaction/route.ts');

function hasProviderGuard(content: string, expectedProvider: string): boolean {
  return content.includes('getActiveBillingProvider()') &&
         content.includes(`!== '${expectedProvider}'`) &&
         content.includes('status: 404');
}

if (hasProviderGuard(paddleWebhook, 'paddle')) {
  ok('Paddle webhook route returns 404 when not paddle provider');
} else {
  fail('Paddle webhook route missing provider guard');
}

if (hasProviderGuard(stripeWebhook, 'stripe')) {
  ok('Stripe webhook route returns 404 when not stripe provider');
} else {
  fail('Stripe webhook route missing provider guard');
}

if (hasProviderGuard(paddleTx, 'paddle')) {
  ok('Paddle transaction route returns 404 when not paddle provider');
} else {
  fail('Paddle transaction route missing provider guard');
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3: Kill-switch — no placeholder outputs
// ─────────────────────────────────────────────────────────────────────────────
section('3. Kill-switch behavior — no placeholder SVG outputs');

const orchFile = readFile('apps/arkiol-core/src/engines/ai/pipeline-orchestrator.ts');
const workerFile = readFile('apps/arkiol-core/src/workers/generation.worker.ts');

// Orchestrator must NOT contain inline SVG placeholder
const hasPlaceholderSvg = /<svg[^>]*>[\s\S]{10,}Generation halted/i.test(orchFile) ||
                          /<svg[^>]*>[\s\S]{10,}maintenance/i.test(orchFile);
if (!hasPlaceholderSvg) {
  ok('Orchestrator contains no placeholder SVG output');
} else {
  fail('Orchestrator still contains placeholder SVG — should throw KillSwitchError instead');
}

// Orchestrator must throw KillSwitchError
if (orchFile.includes('throw new KillSwitchError(')) {
  ok('Orchestrator throws KillSwitchError on kill-switch');
} else {
  fail('Orchestrator missing KillSwitchError throw');
}

// Orchestrator must throw PipelineHardFailureError on hard render failure
if (orchFile.includes('throw new PipelineHardFailureError(')) {
  ok('Orchestrator throws PipelineHardFailureError on hard render failure');
} else {
  fail('Orchestrator missing PipelineHardFailureError throw');
}

// Worker must catch KillSwitchError and mark job FAILED with userMessage
const workerHandlesKill = workerFile.includes('instanceof KillSwitchError') &&
                          workerFile.includes('taskErr.userMessage') &&
                          workerFile.includes('"FAILED"');
if (workerHandlesKill) {
  ok('Worker catches KillSwitchError and marks job FAILED with user message');
} else {
  fail('Worker missing proper KillSwitchError handler');
}

// Worker must catch PipelineHardFailureError
const workerHandlesPipeline = workerFile.includes('instanceof PipelineHardFailureError');
if (workerHandlesPipeline) {
  ok('Worker catches PipelineHardFailureError');
} else {
  fail('Worker missing PipelineHardFailureError handler');
}

// Credits are deducted post-success only (not before)
const creditDeductAfterSuccess = /createdAssetIds\.length > 0/.test(workerFile) &&
                                  /totalCreditCost > 0/.test(workerFile);
if (creditDeductAfterSuccess) {
  ok('Credits deducted only after successful asset creation');
} else {
  fail('Cannot confirm credit deduction gating');
}

// Webhook delivery on job failure
const deliverWebhookOnFail = workerFile.includes('deliverWebhooks(orgId, "job.failed"');
if (deliverWebhookOnFail) {
  ok('Webhook delivered on job failure (job.failed event)');
} else {
  fail('Missing webhook delivery on job failure');
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4: AI metadata persistence
// ─────────────────────────────────────────────────────────────────────────────
section('4. AI metadata persistence — Prisma models + stageTrace module');

const schema = readFile('packages/shared/prisma/schema.prisma');
const stageTrace = readFile('packages/shared/src/stageTrace.ts');

// Prisma models
if (schema.includes('model AIJobMetadata')) {
  ok('Prisma: AIJobMetadata model present');
} else {
  fail('Prisma: AIJobMetadata model missing from schema');
}

if (schema.includes('model AIStageTrace')) {
  ok('Prisma: AIStageTrace model present');
} else {
  fail('Prisma: AIStageTrace model missing from schema');
}

// AIJobMetadata fields
const jmFields = ['jobId', 'orgId', 'stageTimings', 'fallbackReasons', 'overallScore',
                   'totalFallbacks', 'killSwitchActive', 'globalSpendBlocked'];
for (const f of jmFields) {
  if (schema.includes(`AIJobMetadata`) && schema.match(new RegExp(`model AIJobMetadata[\\s\\S]{0,2000}${f}`))) {
    ok(`AIJobMetadata has field: ${f}`);
  } else {
    fail(`AIJobMetadata missing field: ${f}`);
  }
}

// AIStageTrace fields
const stFields = ['jobId', 'assetId', 'orgId', 'stageId', 'durationMs', 'fallback', 'fallbackReason', 'decision'];
for (const f of stFields) {
  if (schema.match(new RegExp(`model AIStageTrace[\\s\\S]{0,2000}${f}`))) {
    ok(`AIStageTrace has field: ${f}`);
  } else {
    fail(`AIStageTrace missing field: ${f}`);
  }
}

// stageTrace module exports
const stageTraceExports = ['writeStageTrace', 'writeStageTraces', 'upsertJobMetadata', 'buildStageTracesFromPerfs'];
for (const fn of stageTraceExports) {
  if (stageTrace.includes(`export`) && stageTrace.includes(fn)) {
    ok(`stageTrace exports: ${fn}`);
  } else {
    fail(`stageTrace missing export: ${fn}`);
  }
}

// Worker calls stage trace persistence
if (workerFile.includes('writeStageTraces') && workerFile.includes('upsertJobMetadata')) {
  ok('Generation worker persists stage traces and job metadata');
} else {
  fail('Generation worker missing stage trace persistence calls');
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 5: Env validation — provider-conditional requirements
// ─────────────────────────────────────────────────────────────────────────────
section('5. Env validation — provider-conditional requirements');

const envTs = readFile('packages/shared/src/env.ts');

// Paddle price IDs required when provider=paddle
if (envTs.includes('PADDLE_PRICE_CREATOR') && envTs.includes('providerErrors.push')) {
  ok('Env validation enforces PADDLE_PRICE_CREATOR when provider=paddle');
} else {
  fail('Env validation missing PADDLE_PRICE_CREATOR enforcement');
}

// Security: NEXT_PUBLIC_PADDLE_API_KEY is blocked
if (envTs.includes('NEXT_PUBLIC_PADDLE_API_KEY') && envTs.includes('SECURITY')) {
  ok('Env validation blocks NEXT_PUBLIC_PADDLE_API_KEY exposure');
} else {
  fail('Env validation missing NEXT_PUBLIC_PADDLE_API_KEY security check');
}

// Optional schema coverage
const optionalVars = ['SMTP_HOST', 'GOOGLE_CLIENT_ID', 'APPLE_ID', 'UPSTASH_REDIS_REST_URL',
                      'MONITORING_SECRET', 'WORKER_CONCURRENCY', 'CLOUDFRONT_DOMAIN', 'OPENAI_API_KEY'];
for (const v of optionalVars) {
  if (envTs.includes(v)) {
    ok(`Env schema covers optional var: ${v}`);
  } else {
    fail(`Env schema missing optional var: ${v}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 6: Admin observability — all sections present
// ─────────────────────────────────────────────────────────────────────────────
section('6. Admin API observability — all sections present');

const adminRoute = readFile('apps/arkiol-core/src/app/api/admin/route.ts');

const adminSections = [
  'ai-health', 'pipeline-scores', 'ab-results', 'brand-learning', 'stage-traces', 'recent-failures'
];
for (const sec of adminSections) {
  if (adminRoute.includes(`"${sec}"`)) {
    ok(`Admin API: section "${sec}" present`);
  } else {
    fail(`Admin API: missing section "${sec}"`);
  }
}

// Key data points per section
const adminChecks: Array<[string, string]> = [
  ['aIJobSummary',        'pipeline-scores queries aIJobSummary (Prisma camelCase)'],
  ['aIABResult',          'ab-results queries aIABResult (Prisma camelCase)'],
  ['aIStylePerformance',  'brand-learning queries aIStylePerformance (Prisma camelCase)'],
  ['aIStageTrace',        'stage-traces queries aIStageTrace (Prisma camelCase)'],
  ['killSwitchActive',    'ai-health exposes killSwitchActive'],
  ['systemHealth',        'ai-health returns systemHealth object'],
];
for (const [pattern, label] of adminChecks) {
  if (adminRoute.includes(pattern)) {
    ok(`Admin API: ${label}`);
  } else {
    fail(`Admin API: missing — ${label}`);
  }
}

// Access control enforced
if (adminRoute.includes('SUPER_ADMIN') || adminRoute.includes('ADMIN')) {
  ok('Admin API: role-based access control enforced');
} else {
  fail('Admin API: missing access control');
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 7: Provider-switch complete coverage
// ─────────────────────────────────────────────────────────────────────────────
section('7. Provider-switch — billing route coverage');

const billingRoute = readFile('apps/arkiol-core/src/app/api/billing/route.ts');

// Main billing route should import getActiveBillingProvider (even if Stripe-specific)
if (billingRoute.includes('getActiveBillingProvider') || billingRoute.includes('getEnv')) {
  ok('Main billing route uses validated env/provider abstraction (getActiveBillingProvider or getEnv)');
} else {
  fail('Main billing route missing env/provider abstraction');
}

// No direct process.env in any billing route
const billingRoutes = [
  'apps/arkiol-core/src/app/api/billing/route.ts',
  'apps/arkiol-core/src/app/api/billing/webhook/route.ts',
  'apps/arkiol-core/src/app/api/billing/paddle/webhook/route.ts',
  'apps/arkiol-core/src/app/api/billing/paddle/transaction/route.ts',
];
for (const relPath of billingRoutes) {
  try {
    const content = readFile(relPath)
      .replace(/\/\/.*/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    const hits = (content.match(/process\.env\./g) ?? []).length;
    if (hits === 0) {
      ok(`No direct process.env in ${path.basename(path.dirname(relPath))}/${path.basename(relPath)}`);
    } else {
      fail(`Found ${hits} direct process.env in ${relPath}`);
    }
  } catch {
    fail(`Could not read ${relPath}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 8: Animation Studio process.env hygiene (v21)
// ─────────────────────────────────────────────────────────────────────────────
section('8. Animation Studio process.env hygiene');

const STUDIO_CLEAN_MODULES: Array<[string, string]> = [
  ['apps/animation-studio/backend/src/routes/billing.ts',       'studio/routes/billing'],
  ['apps/animation-studio/backend/src/routes/assets.ts',        'studio/routes/assets'],
  ['apps/animation-studio/backend/src/billing/billingService.ts','studio/billing/billingService'],
  ['apps/animation-studio/backend/src/billing/sharedCreditAdapter.ts','studio/billing/sharedCreditAdapter'],
  ['apps/animation-studio/backend/src/auth/arkiolSessionBridge.ts',   'studio/auth/arkiolSessionBridge'],
  ['apps/animation-studio/backend/src/services/ffmpeg/ffmpegPipeline.ts','studio/ffmpegPipeline'],
  ['apps/animation-studio/backend/src/workers/renderWorker.ts', 'studio/workers/renderWorker'],
];

for (const [relPath, label] of STUDIO_CLEAN_MODULES) {
  const content = readFile(relPath)
    .replace(/\/\/.*/g, '')         // strip line comments
    .replace(/\/\*[\s\S]*?\*\//g, ''); // strip block comments
  const direct = (content.match(/process\.env\./g) ?? []).length;
  if (direct === 0) {
    ok(`No direct process.env in ${label}`);
  } else {
    fail(`Found ${direct} direct process.env reads in ${label}`);
  }
}

// knexfile.ts is a special case: it imports from src/config/env so all values
// come through validated config — verify it imports appConfig correctly.
const knexfileContent = readFile('apps/animation-studio/backend/knexfile.ts');
const knexImportsConfig = knexfileContent.includes("from './src/config/env'");
const knexUsesConfig    = knexfileContent.includes('appConfig.DATABASE_URL');
const knexNoBareEnv     = !/process\.env\.DATABASE_URL/.test(knexfileContent);
if (knexImportsConfig && knexUsesConfig && knexNoBareEnv) {
  ok('knexfile.ts uses validated appConfig — no direct process.env.DATABASE_URL');
} else {
  fail('knexfile.ts still reads process.env.DATABASE_URL directly or missing config import');
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 9: Kill-switch consistency across all layers (v21)
// ─────────────────────────────────────────────────────────────────────────────
section('9. Kill-switch hard-block at all layers');

// 9a. pipeline.ts must throw (not degrade) on kill-switch
const pipelineContent = readFile('apps/arkiol-core/src/engines/render/pipeline.ts');
const pipelineThrowsOnKill  = /throw new KillSwitchError/.test(pipelineContent);
const pipelineHasSpendError = /SpendGuardError/.test(pipelineContent);
const pipelineThrowsOnSpend = /throw new SpendGuardError/.test(pipelineContent);
const pipelineNoDegrades    = !/Propagate as a violation but do not throw/.test(pipelineContent);
if (pipelineThrowsOnKill) {
  ok('pipeline.ts throws KillSwitchError on kill-switch (hard block, no silent degradation)');
} else {
  fail('pipeline.ts does not throw on kill-switch — silent degradation still present');
}
if (pipelineThrowsOnSpend && pipelineHasSpendError) {
  ok('pipeline.ts throws SpendGuardError on spend guard (hard block, billing integrity preserved)');
} else {
  fail('pipeline.ts does not hard-block on spend guard — silent degradation still present');
}
if (pipelineNoDegrades) {
  ok('pipeline.ts has no silent-degradation comment (old degrade path removed)');
} else {
  fail('pipeline.ts still has silent degradation path on kill-switch');
}

// 9b. generation.worker.ts handles SpendGuardError explicitly
const workerContent = readFile('apps/arkiol-core/src/workers/generation.worker.ts');
const workerHandlesSpendGuard  = /instanceof SpendGuardError/.test(workerContent);
const workerEarlyKillCheck     = /earlyKillResult/.test(workerContent) || /EARLY KILL-SWITCH/.test(workerContent);
if (workerHandlesSpendGuard) {
  ok('generation.worker.ts catches SpendGuardError with structured job-failure path');
} else {
  fail('generation.worker.ts missing SpendGuardError handler');
}
if (workerEarlyKillCheck) {
  ok('generation.worker.ts has early kill-switch check before brief analysis');
} else {
  fail('generation.worker.ts missing early kill-switch check before brief analysis');
}

// 9c. Animation Studio renders route checks kill-switch before accepting jobs
const rendersContent = readFile('apps/animation-studio/backend/src/routes/renders.ts');
const rendersChecksKill  = /checkKillSwitch/.test(rendersContent);
const rendersThrowsOnKill = /throw new AppError.*KILL_SWITCH_ACTIVE/.test(rendersContent) ||
                             /KILL_SWITCH_ACTIVE/.test(rendersContent);
if (rendersChecksKill && rendersThrowsOnKill) {
  ok('Animation Studio renders route enforces kill-switch before job submission');
} else {
  fail('Animation Studio renders route missing kill-switch enforcement at submission point');
}

// 9d. Animation Studio renderQueue worker checks kill-switch before processing
const renderQueueContent = readFile('apps/animation-studio/backend/src/jobs/renderQueue.ts');
const queueChecksKill    = /checkKillSwitch/.test(renderQueueContent);
const queueRefundsOnKill = /refundStudioCredits.*renderJobId/.test(renderQueueContent);
if (queueChecksKill) {
  ok('Animation Studio renderQueue worker checks kill-switch at job processing start');
} else {
  fail('Animation Studio renderQueue worker missing kill-switch check');
}
if (queueRefundsOnKill) {
  ok('Animation Studio renderQueue worker refunds credits on kill-switch activation');
} else {
  fail('Animation Studio renderQueue worker missing credit refund on kill-switch');
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 10: bootstrapEnv adoption — v22 single source of truth (v22)
// ─────────────────────────────────────────────────────────────────────────────
section('10. bootstrapEnv adoption — single config source of truth (v22)');

// 10a. bootstrapEnv must be exported from the shared env module
const sharedEnvContent = readFile('packages/shared/src/env.ts');
const hasBootstrapEnvExport = /export function bootstrapEnv/.test(sharedEnvContent);
const hasBootstrapKeyType   = /export type BootstrapKey/.test(sharedEnvContent);
if (hasBootstrapEnvExport && hasBootstrapKeyType) {
  ok('shared env.ts exports bootstrapEnv() with BootstrapKey allowlist');
} else {
  fail('shared env.ts missing bootstrapEnv() export or BootstrapKey type');
}

// 10b. logger.ts must import bootstrapEnv from @arkiol/shared (no raw process.env)
const loggerContent = readFile('apps/arkiol-core/src/lib/logger.ts');
const loggerUsesBootstrap = /bootstrapEnv\(/.test(loggerContent);
const loggerNoRawEnv = !/process\.env\.[A-Z]/.test(
  loggerContent.replace(/\/\/.*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
);
if (loggerUsesBootstrap) {
  ok('logger.ts uses bootstrapEnv() for NODE_ENV / LOG_LEVEL / SENTRY_DSN');
} else {
  fail('logger.ts still reads process.env directly instead of bootstrapEnv()');
}
if (loggerNoRawEnv) {
  ok('logger.ts has no raw process.env.VAR reads (all via bootstrapEnv)');
} else {
  fail('logger.ts still has raw process.env.VAR reads outside comments');
}

// 10c. prisma.ts must import bootstrapEnv (no raw process.env)
const prismaContent = readFile('apps/arkiol-core/src/lib/prisma.ts');
const prismaUsesBootstrap = /bootstrapEnv\(/.test(prismaContent);
const prismaNoRawEnv = !/process\.env\.[A-Z]/.test(
  prismaContent.replace(/\/\/.*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
);
if (prismaUsesBootstrap) {
  ok('prisma.ts uses bootstrapEnv() for NODE_ENV log-level selection');
} else {
  fail('prisma.ts still reads process.env directly for NODE_ENV');
}
if (prismaNoRawEnv) {
  ok('prisma.ts has no raw process.env.VAR reads (all via bootstrapEnv)');
} else {
  fail('prisma.ts still has raw process.env.VAR reads outside comments');
}

// 10d. verify-production.ts must use validateSharedEnv, not a manual loop
const verifyContent = readFile('packages/shared/scripts/verify-production.ts');
const verifyUsesValidateSharedEnv = /validateSharedEnv/.test(verifyContent);
const verifyNoManualLoop = !/for.*requiredVars/.test(verifyContent);
if (verifyUsesValidateSharedEnv) {
  ok('verify-production.ts delegates env validation to validateSharedEnv()');
} else {
  fail('verify-production.ts still uses a manual env check loop instead of validateSharedEnv()');
}
if (verifyNoManualLoop) {
  ok('verify-production.ts has no duplicate manual requiredVars loop');
} else {
  fail('verify-production.ts still has manual requiredVars loop (duplicates shared validator)');
}

// 10e. smoke-test.ts must use validateSharedEnv, not process.env.DATABASE_URL
const smokeContent = readFile('packages/shared/scripts/smoke-test.ts');
const smokeUsesValidateSharedEnv = /validateSharedEnv/.test(smokeContent);
const smokeNoDirectDbUrl = !/process\.env\.DATABASE_URL/.test(smokeContent);
if (smokeUsesValidateSharedEnv) {
  ok('smoke-test.ts validates env via validateSharedEnv() at startup');
} else {
  fail('smoke-test.ts reads process.env.DATABASE_URL directly instead of validateSharedEnv()');
}
if (smokeNoDirectDbUrl) {
  ok('smoke-test.ts has no direct process.env.DATABASE_URL access');
} else {
  fail('smoke-test.ts still accesses process.env.DATABASE_URL directly');
}

// 10f. Animation Studio health.ts must use bootstrapEnv for npm_package_version
const healthContent = readFile('apps/animation-studio/backend/src/routes/health.ts');
const healthUsesBootstrap = /bootstrapEnv\(/.test(healthContent);
const healthNoNpmEnv = !/process\.env\['npm_package_version'\]/.test(healthContent) &&
                        !/process\.env\.npm_package_version/.test(healthContent);
if (healthUsesBootstrap && healthNoNpmEnv) {
  ok('Animation Studio health.ts uses bootstrapEnv() for npm_package_version');
} else {
  fail('Animation Studio health.ts still reads process.env.npm_package_version directly');
}

// 10g. middleware.ts must be documented as an explicit edge-runtime exception
const middlewareContent = readFile('apps/arkiol-core/src/middleware.ts');
const middlewareHasEdgeComment = /EDGE RUNTIME CONSTRAINT/.test(middlewareContent) ||
                                  /edge runtime/.test(middlewareContent.toLowerCase());
if (middlewareHasEdgeComment) {
  ok('middleware.ts documents edge-runtime constraint justifying direct process.env reads');
} else {
  fail('middleware.ts missing edge-runtime constraint documentation');
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 11: v22 stabilization — spend guard, monitoring, instrumentation
// ─────────────────────────────────────────────────────────────────────────────
section('11. v22 stabilization — spend guard, monitoring, instrumentation');

// 11a. monitoring.ts must use getEnv(), not raw process.env
const monitoringContent = readFile('packages/shared/src/monitoring.ts');
const monitoringUsesGetEnv = /getEnv\(\)/.test(monitoringContent);
const monitoringNoRawEnv   = !/process\.env\[/.test(
  monitoringContent.replace(/\/\/.*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
);
if (monitoringUsesGetEnv) {
  ok('monitoring.ts reads ALERT_* thresholds via getEnv() (not raw process.env)');
} else {
  fail('monitoring.ts still reads ALERT_* keys via raw process.env — must use getEnv()');
}
if (monitoringNoRawEnv) {
  ok('monitoring.ts has no raw process.env[key] access in code (all via getEnv)');
} else {
  fail('monitoring.ts still has raw process.env[key] access in non-comment code');
}

// 11b. ALERT_* threshold keys must be in the shared optional env schema
const sharedEnvContent2 = readFile('packages/shared/src/env.ts');
const alertKeysInSchema = [
  'ALERT_COST_SPIKE_ORG_PER_HOUR',
  'ALERT_COST_SPIKE_GLOBAL_USD_PER_HOUR',
  'ALERT_VOLUME_JOBS_PER_ORG_HOUR',
  'ALERT_STAGE_FAILURE_RATE_WARNING',
  'ALERT_STAGE_FAILURE_RATE_CRITICAL',
  'ALERT_DEDUP_WINDOW_MS',
];
for (const key of alertKeysInSchema) {
  if (sharedEnvContent2.includes(key)) {
    ok(`shared env schema covers monitoring threshold: ${key}`);
  } else {
    fail(`shared env schema missing monitoring threshold: ${key}`);
  }
}

// 11c. NEXTAUTH_SECRET must be in shared optional env schema
if (sharedEnvContent2.includes('NEXTAUTH_SECRET')) {
  ok('shared env schema covers NEXTAUTH_SECRET');
} else {
  fail('shared env schema missing NEXTAUTH_SECRET');
}

// 11d. instrumentation.ts must use validated env object, not process.env[v] loop
const instrContent = readFile('apps/arkiol-core/instrumentation.ts');
const instrUsesValidatedEnv = /env\.NEXTAUTH_SECRET/.test(instrContent) ||
                               /env\[/.test(instrContent) ||
                               /!env\.NEXTAUTH/.test(instrContent);
const instrNoRawLoop = !/process\.env\[v\]/.test(instrContent) &&
                        !/coreRequired\.filter.*process\.env/.test(instrContent);
if (instrUsesValidatedEnv) {
  ok('instrumentation.ts checks NEXTAUTH_* via validated env object (not process.env[v] loop)');
} else {
  fail('instrumentation.ts still uses process.env[v] loop instead of validated env object');
}
if (instrNoRawLoop) {
  ok('instrumentation.ts has no raw process.env[v] array-based check');
} else {
  fail('instrumentation.ts still has raw coreRequired.filter(v => !process.env[v]) pattern');
}

// 11e. Animation Studio renders route must call checkGlobalMonthlySpend()
const rendersContentV22 = readFile('apps/animation-studio/backend/src/routes/renders.ts');
const rendersCallsSpend  = /checkGlobalMonthlySpend\(/.test(rendersContentV22);
const rendersSpendThrows = /SPEND_GUARD_ACTIVE/.test(rendersContentV22);
if (rendersCallsSpend) {
  ok('Animation Studio renders route CALLS checkGlobalMonthlySpend() (not just imports it)');
} else {
  fail('Animation Studio renders route imports but never calls checkGlobalMonthlySpend()');
}
if (rendersSpendThrows) {
  ok('Animation Studio renders route throws on spend guard activation (hard block)');
} else {
  fail('Animation Studio renders route missing SPEND_GUARD_ACTIVE error throw');
}

// 11f. Animation Studio renderQueue worker must call checkGlobalMonthlySpend()
const renderQueueContentV22 = readFile('apps/animation-studio/backend/src/jobs/renderQueue.ts');
const workerCallsSpend  = /checkGlobalMonthlySpend\(/.test(renderQueueContentV22);
const workerSpendRefunds = /Spend-guard credit refund/.test(renderQueueContentV22) ||
                            /spend.*guard.*refund/i.test(renderQueueContentV22);
const workerSpendFailClosed = /SPEND_GUARD_FETCH_FAILED/.test(renderQueueContentV22) ||
                               /fail-closed/.test(renderQueueContentV22);
if (workerCallsSpend) {
  ok('Animation Studio renderQueue worker CALLS checkGlobalMonthlySpend() at job pickup');
} else {
  fail('Animation Studio renderQueue worker imports but never calls checkGlobalMonthlySpend()');
}
if (workerSpendRefunds) {
  ok('Animation Studio renderQueue worker refunds credits on spend guard activation');
} else {
  fail('Animation Studio renderQueue worker missing credit refund on spend guard');
}
if (workerSpendFailClosed) {
  ok('Animation Studio renderQueue worker is fail-closed on spend fetch error');
} else {
  fail('Animation Studio renderQueue worker missing fail-closed spend guard logic');
}

// 11g. No duplicate merged/ folder at project root
try {
  readFile('merged/package.json'); // will throw if file doesn't exist
  fail('Rogue merged/ duplicate folder still exists at project root');
} catch {
  ok('No duplicate merged/ folder at project root');
}

// ─────────────────────────────────────────────────────────────────────────────
// SUMMARY
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n' + '═'.repeat(60));
console.log(`  STAGING VALIDATION RESULTS`);
console.log('═'.repeat(60));
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
if (failures.length > 0) {
  console.log('\n  Failures:');
  for (const f of failures) {
    console.log(`  ${FAIL} ${f}`);
  }
}
console.log('═'.repeat(60));

process.exit(failed === 0 ? 0 : 1);
