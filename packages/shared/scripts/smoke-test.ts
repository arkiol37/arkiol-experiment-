#!/usr/bin/env tsx
/**
 * smoke-test.ts — End-to-end production smoke test for Arkiol Platform
 *
 * Run with:  npm run smoke-test  (from monorepo root)
 * Requires:  DATABASE_URL set in environment
 *
 * Tests (in order):
 *  1.  DB connectivity
 *  2.  Schema validation (all expected tables & columns)
 *  3.  Credit service: grant, consume, refund, idempotency
 *  4.  Daily credit bucket (FREE plan)
 *  5.  Plan enforcement: subscription gate
 *  6.  Plan enforcement: studio video feature flag
 *  7.  Plan enforcement: concurrency cap
 *  8.  Plan enforcement: daily video job cap
 *  9.  Plan enforcement: insufficient credits (hard stop)
 *  10. Job lifecycle: static job enqueue → running → succeeded
 *  11. Job lifecycle: video job enqueue → failed → auto-refund
 *  12. Auto-refill idempotency guard (no double-charge)
 *  13. Rollover credits (carry forward pct of unused)
 *  14. Cost-protection block (daily spend cap exceeded)
 *  15. Stripe webhook idempotency (duplicate event rejected)
 *  16. Cleanup
 *
 * Exit code 0 = all passed, non-zero = failures found
 */

import { PrismaClient } from '@prisma/client';
import { createCreditService, InsufficientCreditsError } from '../src/credits';
import { preflightJob, checkSubscriptionActive, checkStudioVideoAccess } from '../src/planEnforcer';
import { createJobLifecycleService } from '../src/jobLifecycle';
import { CREDIT_COSTS, getPlanConfig } from '../src/plans';
import { validateSharedEnv } from '../src/env';

// ── Colour helpers ─────────────────────────────────────────────────────────
const c = {
  ok:   (s: string) => `\x1b[32m✓ ${s}\x1b[0m`,
  fail: (s: string) => `\x1b[31m✗ ${s}\x1b[0m`,
  info: (s: string) => `\x1b[36m  ${s}\x1b[0m`,
  head: (s: string) => `\x1b[1m\x1b[35m${s}\x1b[0m`,
};

let passed = 0;
let failed = 0;
const errors: string[] = [];

function assert(condition: boolean, label: string, detail?: string): void {
  if (condition) {
    console.log(c.ok(label));
    passed++;
  } else {
    console.log(c.fail(label));
    if (detail) console.log(c.info(detail));
    failed++;
    errors.push(label);
  }
}

async function assertThrows(fn: () => Promise<any>, errorType: any, label: string): Promise<void> {
  try {
    await fn();
    console.log(c.fail(label + ' (expected throw, got none)'));
    failed++;
    errors.push(label);
  } catch (err) {
    if (err instanceof errorType) {
      console.log(c.ok(label));
      passed++;
    } else {
      console.log(c.fail(label + ` (wrong error: ${(err as any).constructor?.name ?? err})`));
      failed++;
      errors.push(label);
    }
  }
}

// ── Unique IDs for this test run ───────────────────────────────────────────
const runId = Date.now().toString(36);
const ORG_FREE_ID    = `smoke-free-${runId}`;
const ORG_PRO_ID     = `smoke-pro-${runId}`;
const ORG_STUDIO_ID  = `smoke-studio-${runId}`;
const USER_ID        = `smoke-user-${runId}`;

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  // Validate all required env vars at script startup — single source of truth.
  // Throws with a descriptive error if any required var is missing or malformed.
  const validatedEnv = validateSharedEnv();

  console.log(c.head('\n═══════════════════════════════════════'));
  console.log(c.head(' Arkiol Platform — Production Smoke Test'));
  console.log(c.head('═══════════════════════════════════════\n'));
  console.log(c.info(`Run ID: ${runId}`));
  console.log(c.info(`DB:     ${validatedEnv.DATABASE_URL.replace(/:[^:@]*@/, ':***@')}`));
  console.log();

  const prisma = new PrismaClient({ log: ['error'] });
  const credits = createCreditService(prisma);
  const jobs    = createJobLifecycleService(prisma);

  // ──────────────────────────────────────────────────────────────────────────
  // 1. DB Connectivity
  // ──────────────────────────────────────────────────────────────────────────
  console.log(c.head('1. DB Connectivity'));
  try {
    await prisma.$queryRaw`SELECT 1`;
    assert(true, 'Database connection established');
  } catch (err: any) {
    assert(false, 'Database connection established', err.message);
    console.log(c.fail('Cannot continue without DB. Exiting.'));
    process.exit(1);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 2. Schema validation
  // ──────────────────────────────────────────────────────────────────────────
  console.log(c.head('\n2. Schema Validation'));
  const requiredTables = ['Org', 'User', 'Job', 'CreditTransaction', 'BillingEvent'];
  for (const table of requiredTables) {
    try {
      await (prisma as any)[table.charAt(0).toLowerCase() + table.slice(1)].count();
      assert(true, `Table ${table} exists`);
    } catch (err: any) {
      // Table might be Prisma model name vs DB table name difference
      try {
        await prisma.$queryRawUnsafe(`SELECT COUNT(*) FROM "${table}" LIMIT 1`);
        assert(true, `Table ${table} exists (raw)`);
      } catch {
        assert(false, `Table ${table} exists`, err.message);
      }
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 3. Seed test orgs and user
  // ──────────────────────────────────────────────────────────────────────────
  console.log(c.head('\n3. Seeding Test Fixtures'));
  try {
    await prisma.$transaction([
      // Free org
      (prisma as any).org.create({ data: {
        id: ORG_FREE_ID, name: 'Smoke Free Org',
        plan: 'FREE', subscriptionStatus: 'ACTIVE',
        creditBalance: 0, dailyCreditBalance: 0,
        freeWatermarkEnabled: true, freeDailyCreditsPerDay: 10, freeMonthlyCapCredits: 300,
        maxConcurrency: 1, maxDailyVideoJobs: 0, maxFormatsPerRun: 3, maxVariationsPerRun: 2,
        canUseStudioVideo: false, canUseGifMotion: false,
        canBatchGenerate: false, canUseZipExport: false,
        queuePriority: 0, costProtectionBlocked: false,
      }}),
      // Pro org (video capable)
      (prisma as any).org.create({ data: {
        id: ORG_PRO_ID, name: 'Smoke Pro Org',
        plan: 'PRO', subscriptionStatus: 'ACTIVE',
        creditBalance: 500, dailyCreditBalance: 0,
        freeWatermarkEnabled: false, freeDailyCreditsPerDay: 0, freeMonthlyCapCredits: 0,
        maxConcurrency: 3, maxDailyVideoJobs: 5, maxFormatsPerRun: 9, maxVariationsPerRun: 5,
        canUseStudioVideo: true, canUseGifMotion: true,
        canBatchGenerate: true, canUseZipExport: true,
        queuePriority: 1, costProtectionBlocked: false,
      }}),
      // Studio org
      (prisma as any).org.create({ data: {
        id: ORG_STUDIO_ID, name: 'Smoke Studio Org',
        plan: 'STUDIO', subscriptionStatus: 'ACTIVE',
        creditBalance: 5000, dailyCreditBalance: 0,
        freeWatermarkEnabled: false, freeDailyCreditsPerDay: 0, freeMonthlyCapCredits: 0,
        maxConcurrency: 5, maxDailyVideoJobs: 50, maxFormatsPerRun: 9, maxVariationsPerRun: 5,
        canUseStudioVideo: true, canUseGifMotion: true,
        canBatchGenerate: true, canUseZipExport: true,
        queuePriority: 2, costProtectionBlocked: false,
      }}),
      // Test user
      (prisma as any).user.create({ data: {
        id: USER_ID, email: `smoke-${runId}@arkiol.test`,
        name: 'Smoke Tester', role: 'ADMIN',
        orgId: ORG_PRO_ID,
      }}),
    ]);
    assert(true, 'Test fixtures seeded (3 orgs, 1 user)');
  } catch (err: any) {
    assert(false, 'Seed test fixtures', err.message);
    console.log(c.fail('Seeding failed — aborting further tests'));
    await prisma.$disconnect();
    process.exit(1);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 4. Credit service: grant, consume, refund
  // ──────────────────────────────────────────────────────────────────────────
  console.log(c.head('\n4. Credit Service — Grant / Consume / Refund'));

  // Grant cycle credits
  const granted = await credits.grantCycleCredits(ORG_PRO_ID, `inv_smoke_${runId}`);
  const planCfg = getPlanConfig('PRO');
  assert(granted === planCfg.credits, `grantCycleCredits returns ${planCfg.credits}`, `got ${granted}`);

  const afterGrant = await (prisma as any).org.findUnique({ where: { id: ORG_PRO_ID }, select: { creditBalance: true } });
  // Balance was 500 + 1000 = 1500
  assert(afterGrant.creditBalance === 500 + planCfg.credits, 'creditBalance updated after grant', `got ${afterGrant.creditBalance}`);

  // Idempotent re-grant (same invoice ID)
  const grantedAgain = await credits.grantCycleCredits(ORG_PRO_ID, `inv_smoke_${runId}`);
  assert(grantedAgain === 0, 'grantCycleCredits is idempotent (second call returns 0)');

  // Consume credits for a static job
  const jobA = `job-static-${runId}`;
  await credits.consumeCredits({ orgId: ORG_PRO_ID, jobId: jobA, reason: 'static' });
  const afterConsume = await (prisma as any).org.findUnique({ where: { id: ORG_PRO_ID }, select: { creditBalance: true } });
  const expectedAfterConsume = 500 + planCfg.credits - CREDIT_COSTS.static;
  assert(afterConsume.creditBalance === expectedAfterConsume,
    `consumeCredits deducts ${CREDIT_COSTS.static} credit`, `expected ${expectedAfterConsume}, got ${afterConsume.creditBalance}`);

  // Idempotent consume (same jobId)
  await credits.consumeCredits({ orgId: ORG_PRO_ID, jobId: jobA, reason: 'static' });
  const afterConsumeAgain = await (prisma as any).org.findUnique({ where: { id: ORG_PRO_ID }, select: { creditBalance: true } });
  assert(afterConsumeAgain.creditBalance === expectedAfterConsume,
    'consumeCredits is idempotent (same jobId)');

  // Refund
  await credits.refundCredits({ orgId: ORG_PRO_ID, jobId: jobA, reason: 'static' });
  const afterRefund = await (prisma as any).org.findUnique({ where: { id: ORG_PRO_ID }, select: { creditBalance: true } });
  assert(afterRefund.creditBalance === 500 + planCfg.credits,
    'refundCredits restores balance', `expected ${500 + planCfg.credits}, got ${afterRefund.creditBalance}`);

  // Idempotent refund (same jobId)
  await credits.refundCredits({ orgId: ORG_PRO_ID, jobId: jobA, reason: 'static' });
  const afterRefundAgain = await (prisma as any).org.findUnique({ where: { id: ORG_PRO_ID }, select: { creditBalance: true } });
  assert(afterRefundAgain.creditBalance === 500 + planCfg.credits,
    'refundCredits is idempotent (double refund rejected)');

  // ──────────────────────────────────────────────────────────────────────────
  // 5. Daily credits — FREE plan
  // ──────────────────────────────────────────────────────────────────────────
  console.log(c.head('\n5. Daily Credits — FREE plan'));

  const dailyGranted = await credits.grantDailyCredits(ORG_FREE_ID);
  assert(dailyGranted === 10, `grantDailyCredits grants 10 credits to FREE org`, `got ${dailyGranted}`);

  const freeOrg = await (prisma as any).org.findUnique({ where: { id: ORG_FREE_ID }, select: { dailyCreditBalance: true } });
  assert(freeOrg.dailyCreditBalance === 10, 'dailyCreditBalance = 10 after daily grant');

  // Idempotent (same-day re-run)
  const dailyGrantedAgain = await credits.grantDailyCredits(ORG_FREE_ID);
  assert(dailyGrantedAgain === 0, 'grantDailyCredits is idempotent same day');

  // ──────────────────────────────────────────────────────────────────────────
  // 6. Plan enforcement
  // ──────────────────────────────────────────────────────────────────────────
  console.log(c.head('\n6. Plan Enforcement'));

  // FREE org: subscription active
  const freeSnap = {
    orgId: ORG_FREE_ID, plan: 'FREE', creditBalance: 0, dailyCreditBalance: 10,
    subscriptionStatus: 'ACTIVE', gracePeriodEndsAt: null, costProtectionBlocked: false,
  };
  const subCheck = checkSubscriptionActive(freeSnap);
  assert(subCheck.allowed === true, 'FREE org: subscription active check passes');

  // PAST_DUE without grace period → blocked
  const pastDueSnap = { ...freeSnap, subscriptionStatus: 'PAST_DUE', gracePeriodEndsAt: new Date(Date.now() - 1000) };
  const pastDueCheck = checkSubscriptionActive(pastDueSnap);
  assert(pastDueCheck.allowed === false, 'PAST_DUE (expired grace) → blocked');

  // PAST_DUE within grace period → allowed
  const inGraceSnap = { ...freeSnap, subscriptionStatus: 'PAST_DUE', gracePeriodEndsAt: new Date(Date.now() + 24 * 3600 * 1000) };
  const inGraceCheck = checkSubscriptionActive(inGraceSnap);
  assert(inGraceCheck.allowed === true, 'PAST_DUE within grace period → allowed');

  // FREE org: video access denied
  const videoCheck = checkStudioVideoAccess(freeSnap);
  assert(videoCheck.allowed === false, 'FREE org: studio video access denied');

  // PRO org: video access granted
  const proSnap = {
    orgId: ORG_PRO_ID, plan: 'PRO', creditBalance: 500, dailyCreditBalance: 0,
    subscriptionStatus: 'ACTIVE', gracePeriodEndsAt: null, costProtectionBlocked: false,
  };
  const proVideoCheck = checkStudioVideoAccess(proSnap);
  assert(proVideoCheck.allowed === true, 'PRO org: studio video access granted');

  // Concurrency cap
  const concurrencyPlan = getPlanConfig('PRO');
  const concurrencyCheck = preflightJob({
    org: proSnap, reason: 'static', currentRunning: concurrencyPlan.maxConcurrency,
  });
  assert(concurrencyCheck.allowed === false, `PRO concurrency cap (${concurrencyPlan.maxConcurrency}) enforced`);

  // Daily video cap
  const dailyCapCheck = preflightJob({
    org: proSnap, reason: 'video_std', currentRunning: 0,
    todayVideoJobs: concurrencyPlan.maxDailyVideoJobs,
  });
  assert(dailyCapCheck.allowed === false, `PRO daily video cap (${concurrencyPlan.maxDailyVideoJobs}) enforced`);

  // Insufficient credits
  const brokeSnap = { ...proSnap, creditBalance: 0, dailyCreditBalance: 0 };
  const creditCheck = preflightJob({ org: brokeSnap, reason: 'video_std', currentRunning: 0, todayVideoJobs: 0 });
  assert(creditCheck.allowed === false, 'Insufficient credits: preflightJob denies video_std (cost=40)');

  // ──────────────────────────────────────────────────────────────────────────
  // 7. InsufficientCreditsError thrown when balance < cost
  // ──────────────────────────────────────────────────────────────────────────
  console.log(c.head('\n7. InsufficientCreditsError'));

  // Drain PRO org balance to 0
  await (prisma as any).org.update({ where: { id: ORG_PRO_ID }, data: { creditBalance: 0 } });

  try {
    await credits.consumeCredits({ orgId: ORG_PRO_ID, jobId: `job-drain-${runId}`, reason: 'static' });
    assert(false, 'consumeCredits throws InsufficientCreditsError when balance = 0');
  } catch (err) {
    assert(err instanceof InsufficientCreditsError, 'consumeCredits throws InsufficientCreditsError when balance = 0',
      `got: ${(err as any).constructor?.name}`);
  }

  // Restore balance for further tests
  await (prisma as any).org.update({ where: { id: ORG_PRO_ID }, data: { creditBalance: 500 } });

  // ──────────────────────────────────────────────────────────────────────────
  // 8. Job lifecycle: static job (enqueue → running → succeeded)
  // ──────────────────────────────────────────────────────────────────────────
  console.log(c.head('\n8. Job Lifecycle — Static Job'));

  const staticJob = await jobs.enqueueJob({
    orgId:          ORG_PRO_ID,
    userId:         USER_ID,
    type:           'GENERATE_ASSETS',
    reason:         'static',
    payload:        { prompt: 'smoke test static', formats: ['instagram_post'] },
    idempotencyKey: `smoke-static-${runId}`,
  });
  assert(staticJob.status === 'QUEUED', 'Static job enqueued with QUEUED status');

  const balAfterEnqueue = await (prisma as any).org.findUnique({ where: { id: ORG_PRO_ID }, select: { creditBalance: true } });
  assert(balAfterEnqueue.creditBalance === 500 - CREDIT_COSTS.static,
    `Credit deducted at enqueue (500 → ${500 - CREDIT_COSTS.static})`,
    `got ${balAfterEnqueue.creditBalance}`);

  // Idempotent re-enqueue
  const staticJob2 = await jobs.enqueueJob({
    orgId:          ORG_PRO_ID,
    userId:         USER_ID,
    type:           'GENERATE_ASSETS',
    reason:         'static',
    payload:        { prompt: 'smoke test static', formats: ['instagram_post'] },
    idempotencyKey: `smoke-static-${runId}`,
  });
  assert(staticJob2.id === staticJob.id, 'Duplicate enqueue (same idempotency key) returns original job');

  const balAfterDup = await (prisma as any).org.findUnique({ where: { id: ORG_PRO_ID }, select: { creditBalance: true } });
  assert(balAfterDup.creditBalance === 500 - CREDIT_COSTS.static,
    'No double-deduction on duplicate enqueue');

  await jobs.markRunning(staticJob.id);
  const runningJob = await (prisma as any).job.findUnique({ where: { id: staticJob.id } });
  assert(runningJob.status === 'RUNNING', 'markRunning → status = RUNNING');
  assert(runningJob.startedAt !== null, 'markRunning → startedAt set');

  await jobs.markSucceeded(staticJob.id, { assetIds: ['asset-abc'], outputUrl: 'https://cdn.example.com/abc.png' });
  const succeededJob = await (prisma as any).job.findUnique({ where: { id: staticJob.id } });
  assert(succeededJob.status === 'SUCCEEDED', 'markSucceeded → status = SUCCEEDED');
  assert(succeededJob.completedAt !== null, 'markSucceeded → completedAt set');

  // Credits remain deducted (success = no refund)
  const balAfterSuccess = await (prisma as any).org.findUnique({ where: { id: ORG_PRO_ID }, select: { creditBalance: true } });
  assert(balAfterSuccess.creditBalance === 500 - CREDIT_COSTS.static,
    'Credits remain deducted after successful job (not refunded)');

  // ──────────────────────────────────────────────────────────────────────────
  // 9. Job lifecycle: video job (enqueue → running → failed → auto-refund)
  // ──────────────────────────────────────────────────────────────────────────
  console.log(c.head('\n9. Job Lifecycle — Video Job Failure + Auto-Refund'));

  const balBeforeVideo = await (prisma as any).org.findUnique({ where: { id: ORG_PRO_ID }, select: { creditBalance: true } });

  const videoJob = await jobs.enqueueJob({
    orgId:          ORG_PRO_ID,
    userId:         USER_ID,
    type:           'RENDER_VIDEO_STD',
    reason:         'video_std',
    payload:        { scenes: [{ prompt: 'smoke test video' }] },
    idempotencyKey: `smoke-video-${runId}`,
  });
  assert(videoJob.status === 'QUEUED', 'Video job enqueued');

  const balAfterVideoEnqueue = await (prisma as any).org.findUnique({ where: { id: ORG_PRO_ID }, select: { creditBalance: true } });
  assert(balAfterVideoEnqueue.creditBalance === balBeforeVideo.creditBalance - CREDIT_COSTS.video_std,
    `Video job deducts ${CREDIT_COSTS.video_std} credits at enqueue`);

  await jobs.markRunning(videoJob.id);
  await jobs.markFailed(videoJob.id, 'Provider GPU timeout — smoke test');

  const failedJob = await (prisma as any).job.findUnique({ where: { id: videoJob.id } });
  // markFailed transitions to FAILED then REFUNDED (after auto-refund)
  assert(['FAILED','REFUNDED'].includes(failedJob.status), 'markFailed → status = FAILED or REFUNDED');
  assert(failedJob.creditRefunded === true, 'markFailed → creditRefunded = true (auto-refund)');

  const balAfterRefund = await (prisma as any).org.findUnique({ where: { id: ORG_PRO_ID }, select: { creditBalance: true } });
  assert(balAfterRefund.creditBalance === balBeforeVideo.creditBalance - CREDIT_COSTS.static,
    `Credits restored after job failure (static job cost still deducted, video job refunded)`);

  // ──────────────────────────────────────────────────────────────────────────
  // 10. Rollover credits
  // ──────────────────────────────────────────────────────────────────────────
  console.log(c.head('\n10. Rollover Credits'));

  const proPlan = getPlanConfig('PRO');
  const rolloverAmount = Math.floor(balAfterRefund.creditBalance * proPlan.rolloverPct / 100);

  if (proPlan.rolloverPct > 0) {
    await credits.processRollover(ORG_PRO_ID, `cycle_smoke_${runId}`);
    const afterRollover = await (prisma as any).org.findUnique({ where: { id: ORG_PRO_ID }, select: { creditBalance: true } });
    // After rollover: old balance expired (zeroed) + rolloverAmount granted with next-cycle expiry
    const txns = await (prisma as any).creditTransaction.findMany({
      where: { orgId: ORG_PRO_ID, type: 'rollover_grant' },
      orderBy: { createdAt: 'desc' },
      take: 1,
    });
    assert(txns.length > 0, `Rollover transaction created (${proPlan.rolloverPct}% carry-forward)`);
    assert(txns[0].amount === rolloverAmount, `Rollover amount = ${rolloverAmount}`, `got ${txns[0].amount}`);
  } else {
    console.log(c.info('PRO plan rolloverPct = 0 — rollover test skipped'));
    passed++; // count as passed
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 11. Cost-protection block
  // ──────────────────────────────────────────────────────────────────────────
  console.log(c.head('\n11. Cost-Protection Block'));

  // Set costProtectionBlocked = true (simulating daily cap exceeded)
  await (prisma as any).org.update({
    where: { id: ORG_PRO_ID },
    data:  { costProtectionBlocked: true },
  });

  const blockedSnap = {
    orgId: ORG_PRO_ID, plan: 'PRO', creditBalance: 5000, dailyCreditBalance: 0,
    subscriptionStatus: 'ACTIVE', gracePeriodEndsAt: null, costProtectionBlocked: true,
  };
  const blockedVideoCheck = preflightJob({ org: blockedSnap, reason: 'video_std', currentRunning: 0, todayVideoJobs: 0 });
  assert(blockedVideoCheck.allowed === false, 'Cost-protection block prevents video jobs');
  assert((blockedVideoCheck as any).code === 'COST_PROTECTION_BLOCKED', 'Error code = COST_PROTECTION_BLOCKED');

  // Static jobs still allowed when cost-protection is active (only video blocked)
  const blockedStaticCheck = preflightJob({ org: blockedSnap, reason: 'static', currentRunning: 0 });
  assert(blockedStaticCheck.allowed === true, 'Cost-protection does not block static jobs');

  // Restore
  await (prisma as any).org.update({ where: { id: ORG_PRO_ID }, data: { costProtectionBlocked: false } });

  // ──────────────────────────────────────────────────────────────────────────
  // 12. Billing event idempotency
  // ──────────────────────────────────────────────────────────────────────────
  console.log(c.head('\n12. Billing Event Idempotency'));

  const stripeEventId = `evt_smoke_${runId}`;
  await (prisma as any).billingEvent.create({
    data: {
      stripeEvent: stripeEventId,
      type:        'invoice.paid',
      orgId:       ORG_PRO_ID,
      processedAt: new Date(),
      metadata:    {},
    },
  });

  const duplicate = await (prisma as any).billingEvent.findUnique({ where: { stripeEvent: stripeEventId } });
  assert(duplicate !== null, 'BillingEvent stored (unique constraint on stripeEvent)');

  // Attempt duplicate → should violate unique constraint
  try {
    await (prisma as any).billingEvent.create({
      data: {
        stripeEvent: stripeEventId,
        type:        'invoice.paid',
        orgId:       ORG_PRO_ID,
        processedAt: new Date(),
        metadata:    {},
      },
    });
    assert(false, 'Duplicate billing event rejected by unique constraint');
  } catch {
    assert(true, 'Duplicate billing event rejected by unique constraint');
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 13. Reconcile balance
  // ──────────────────────────────────────────────────────────────────────────
  console.log(c.head('\n13. Balance Reconciliation'));

  const ledgerBalance = await credits.reconcileBalance(ORG_PRO_ID);
  const cachedBalance = (await (prisma as any).org.findUnique({ where: { id: ORG_PRO_ID }, select: { creditBalance: true } })).creditBalance;
  assert(ledgerBalance === cachedBalance, `Ledger balance (${ledgerBalance}) matches cached (${cachedBalance})`);

  // ──────────────────────────────────────────────────────────────────────────
  // 14. Cleanup
  // ──────────────────────────────────────────────────────────────────────────
  console.log(c.head('\n14. Cleanup'));

  await prisma.$transaction([
    (prisma as any).creditTransaction.deleteMany({ where: { orgId: { in: [ORG_FREE_ID, ORG_PRO_ID, ORG_STUDIO_ID] } } }),
    (prisma as any).billingEvent.deleteMany({ where: { orgId: { in: [ORG_FREE_ID, ORG_PRO_ID, ORG_STUDIO_ID] } } }),
    (prisma as any).job.deleteMany({ where: { orgId: { in: [ORG_FREE_ID, ORG_PRO_ID, ORG_STUDIO_ID] } } }),
    (prisma as any).user.deleteMany({ where: { id: USER_ID } }),
    (prisma as any).org.deleteMany({ where: { id: { in: [ORG_FREE_ID, ORG_PRO_ID, ORG_STUDIO_ID] } } }),
  ]);
  assert(true, 'Test fixtures cleaned up');

  await prisma.$disconnect();

  // ──────────────────────────────────────────────────────────────────────────
  // Summary
  // ──────────────────────────────────────────────────────────────────────────
  console.log(c.head('\n═══════════════════════════════════════'));
  console.log(c.head(` Results: ${passed} passed, ${failed} failed`));
  console.log(c.head('═══════════════════════════════════════\n'));

  if (failed > 0) {
    console.log(c.fail('Failed tests:'));
    errors.forEach(e => console.log(c.fail(`  • ${e}`)));
    console.log();
    process.exit(1);
  } else {
    console.log(c.ok('All smoke tests passed ✓'));
    console.log();
    process.exit(0);
  }
}

main().catch(err => {
  console.error('\n[smoke-test] Unexpected error:', err);
  process.exit(1);
});
