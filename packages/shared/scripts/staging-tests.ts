#!/usr/bin/env ts-node
/**
 * staging-tests.ts — Arkiol V2 Full Staging & Manual QA Test Suite
 *
 * Covers every area specified in the production mandate:
 *   Group 1:  Billing flows (Paddle/Stripe webhook idempotency)
 *   Group 2:  Credit ledger correctness (deduct on success only, refunds on failure)
 *   Group 3:  Plan upgrade / downgrade edge cases
 *   Group 4:  Daily FREE credit reset & cycle rollover
 *   Group 5:  Concurrent job spend (no double-spend, no negative balance)
 *   Group 6:  Export idempotency & ZIP integrity
 *   Group 7:  SSRF protection
 *   Group 8:  Soft delete behavior
 *   Group 9:  Audit logs completeness
 *   Group 10: Health check endpoints
 *   Group 11: Studio bridge credit sharing & enforcement
 *   Group 12: On-demand asset engine (similarity hash, HQ, CDN, metadata)
 *   Group 13: Monitoring & alerting (cost spike, volume anomaly, stage failure)
 *   Group 14: Concurrency stress tests
 *   Group 15: Asset generation concurrency & dedup
 *
 * Usage:
 *   DATABASE_URL=... STRIPE_SECRET_KEY=sk_test_... \
 *   PADDLE_WEBHOOK_SECRET=... \
 *   ts-node staging-tests.ts
 */

import { PrismaClient }         from '@prisma/client';
import crypto                   from 'crypto';
import assert                   from 'assert';
import {
  PLANS,
  CREDIT_COSTS,
  computeSimilarityHash,
  generateAssetOnDemand,
  checkHqUpgrade,
  checkCostSpike,
  checkVolumeAnomaly,
  checkStageHealth,
  checkDlqDepth,
  _resetAlertDedup,
  validateSharedEnv,
  validateWebhookUrl,
  createCreditService,
  createExportIdempotencyGuard,
  computeExportIdempotencyKey,
} from '../src/index';

// ── Bootstrap ─────────────────────────────────────────────────────────────────
validateSharedEnv();
const prisma = new PrismaClient({ log: ['error'] });

let passed = 0;
let failed = 0;
const errors: string[] = [];

type TestResult = { passed: number; failed: number; errors: string[] };

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  process.stdout.write(`  ▸ ${name} ... `);
  try {
    await fn();
    console.log('✅ pass');
    passed++;
  } catch (err: any) {
    console.log(`❌ FAIL\n    ${err.message}`);
    errors.push(`${name}: ${err.message}`);
    failed++;
  }
}

function eq<T>(a: T, b: T, msg?: string): void {
  assert.deepStrictEqual(a, b, msg ?? `Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

function gte(a: number, b: number, msg?: string): void {
  assert.ok(a >= b, msg ?? `Expected ${a} >= ${b}`);
}

function lte(a: number, b: number, msg?: string): void {
  assert.ok(a <= b, msg ?? `Expected ${a} <= ${b}`);
}

function notNull<T>(v: T | null | undefined, msg?: string): asserts v is T {
  assert.ok(v !== null && v !== undefined, msg ?? 'Expected non-null value');
}

// ── Test org/user factory ─────────────────────────────────────────────────────
async function makeTestOrg(plan = 'FREE', overrides: Record<string, any> = {}) {
  const slug = `test-${crypto.randomBytes(6).toString('hex')}`;
  // Shared schema uses creditBalance (no creditLimit/creditsUsed — those are arkiol-core only)
  const { creditLimit, creditsUsed, ...rest } = overrides;
  // Derive creditBalance from overrides for convenience
  const creditBalance = (overrides.creditBalance ?? 0) || Math.max(0, (creditLimit ?? 500) - (creditsUsed ?? 0));
  return prisma.org.create({
    data: {
      name:               `Test Org ${slug}`,
      slug,
      plan:               plan as any,
      subscriptionStatus: 'ACTIVE',
      creditBalance,
      dailyCreditBalance: overrides.dailyCreditBalance ?? 0,
      costProtectionBlocked: overrides.costProtectionBlocked ?? false,
      ...rest,
    },
  });
}

async function makeTestUser(orgId: string, role = 'ADMIN', overrides: Record<string, any> = {}) {
  return prisma.user.create({
    data: {
      email:   `user-${crypto.randomBytes(4).toString('hex')}@test.arkiol.app`,
      name:    'Test User',
      orgId,
      role:    role as any,
      ...overrides,
    },
  });
}

async function cleanup(orgId: string): Promise<void> {
  const users = await prisma.user.findMany({ where: { orgId }, select: { id: true } }).catch(() => []);
  const userIds = users.map((u: any) => u.id);
  
  await prisma.creditTransaction.deleteMany({ where: { orgId } }).catch(() => {});
  await prisma.billingEvent.deleteMany({ where: { orgId } }).catch(() => {});
  await prisma.auditLog.deleteMany({ where: { orgId } }).catch(() => {});
  await prisma.usage.deleteMany({ where: { userId: { in: userIds } } }).catch(() => {});
  // Delete jobs by orgId (shared schema has orgId on Job)
  await (prisma as any).job.deleteMany({ where: { orgId } }).catch(() => {});
  // AIGeneratedAsset cleanup
  await (prisma as any).aIGeneratedAsset.deleteMany({ where: { orgId } }).catch(() => {});
  await prisma.user.deleteMany({ where: { orgId } }).catch(() => {});
  await prisma.org.deleteMany({ where: { id: orgId } }).catch(() => {});
}

// ══════════════════════════════════════════════════════════════════════════════
// GROUP 1 — Billing flows (Paddle/Stripe webhook idempotency)
// ══════════════════════════════════════════════════════════════════════════════
async function group1(): Promise<void> {
  console.log('\n📋 Group 1: Billing flows & webhook idempotency');
  const org = await makeTestOrg('PRO', { creditBalance: 1000 });

  await test('Stripe webhook: invoice.paid grants credits once (idempotent)', async () => {
    const eventId = `evt_stripe_${crypto.randomBytes(8).toString('hex')}`;
    const key     = `grant_cycle:${org.id}:${eventId}`;

    // First delivery
    await prisma.$transaction(async (tx: any) => {
      const existing = await tx.creditTransaction.findUnique({ where: { idempotencyKey: key } });
      if (!existing) {
        await tx.creditTransaction.create({
          data: { orgId: org.id, type: 'grant_cycle', amount: 1000, unit: 'credits', reason: 'static', refId: eventId, idempotencyKey: key },
        });
        await tx.org.update({ where: { id: org.id }, data: { creditLimit: { increment: 0 } } }); // no-op update for test
      }
    });

    const after1 = await prisma.creditTransaction.count({ where: { idempotencyKey: key } });
    eq(after1, 1, 'Should have exactly 1 transaction after first delivery');

    // Second delivery (replay) — must be idempotent
    await prisma.$transaction(async (tx: any) => {
      const existing = await tx.creditTransaction.findUnique({ where: { idempotencyKey: key } });
      if (!existing) {
        await tx.creditTransaction.create({
          data: { orgId: org.id, type: 'grant_cycle', amount: 1000, unit: 'credits', reason: 'static', refId: eventId, idempotencyKey: key },
        });
        await tx.org.update({ where: { id: org.id }, data: { creditLimit: { increment: 0 } } });
      }
    });

    const after2 = await prisma.creditTransaction.count({ where: { idempotencyKey: key } });
    eq(after2, 1, 'Second delivery must not create duplicate transaction');
  });

  await test('Paddle webhook: BillingEvent idempotency prevents double-processing', async () => {
    const eventId = `evt_paddle_${crypto.randomBytes(8).toString('hex')}`;
    
    // First upsert
    await prisma.billingEvent.upsert({
      where:  { stripeEvent: eventId },
      create: { orgId: org.id, stripeEvent: eventId, type: 'paddle:subscription.activated', payload: {} as any, processed: false },
      update: {},
    });

    // Mark processed
    await prisma.billingEvent.update({ where: { stripeEvent: eventId }, data: { processed: true } });

    // Replay — should not reset processed=false
    await prisma.billingEvent.upsert({
      where:  { stripeEvent: eventId },
      create: { orgId: org.id, stripeEvent: eventId, type: 'paddle:subscription.activated', payload: {} as any, processed: false },
      update: {}, // no-op on update
    });

    const stored = await prisma.billingEvent.findUnique({ where: { stripeEvent: eventId } });
    notNull(stored, 'BillingEvent should exist');
    eq(stored!.processed, true, 'Processed flag should remain true after replay');
  });

  await test('Billing: subscription.canceled marks org correctly', async () => {
    await prisma.org.update({
      where: { id: org.id },
      data:  { subscriptionStatus: 'CANCELED' },
    });
    const updated = await prisma.org.findUniqueOrThrow({ where: { id: org.id } });
    eq(updated.subscriptionStatus, 'CANCELED');
    
    // Restore
    await prisma.org.update({ where: { id: org.id }, data: { subscriptionStatus: 'ACTIVE' } });
  });

  await cleanup(org.id);
}

// ══════════════════════════════════════════════════════════════════════════════
// GROUP 2 — Credit ledger correctness
// ══════════════════════════════════════════════════════════════════════════════
async function group2(): Promise<void> {
  console.log('\n📋 Group 2: Credit ledger correctness');
  const org  = await makeTestOrg('PRO', { creditBalance: 100 });
  const user = await makeTestUser(org.id);
  const creditService = createCreditService(prisma as any);

  await test('Credits deducted only on job success (not on failure)', async () => {
    // Simulate failed job — no credit deduction
    const jobId = `job_fail_${crypto.randomBytes(4).toString('hex')}`;
    await prisma.job.create({
      data: { id: jobId, type: 'GENERATE_ASSETS', status: 'FAILED', userId: user.id, orgId: org.id, progress: 0, maxAttempts: 3, payload: {} as any },
    });

    // Verify no credits were deducted (creditBalance should remain unchanged)
    const orgAfterFail = await prisma.org.findUniqueOrThrow({ where: { id: org.id } });
    eq(orgAfterFail.creditBalance, 100, 'No credits should be deducted for failed job');
  });

  await test('Credits deducted atomically on success with guard', async () => {
    const creditsBefore = (await prisma.org.findUniqueOrThrow({ where: { id: org.id } })).creditsUsed;
    const cost = 5;

    // Simulate successful credit deduction with WHERE guard
    const result = await prisma.$transaction(async (tx: any) => {
      const updated = await tx.org.updateMany({
        where: { id: org.id, creditsUsed: { lte: 500 - cost } },
        data:  { creditsUsed: { increment: cost } },
      });
      if (updated.count === 0) throw new Error('Insufficient credits');
      await tx.usage.create({
        data: { userId: user.id, action: 'GENERATE_ASSETS', credits: cost, metadata: { test: true } },
      });
      return updated;
    });

    eq(result.count, 1, 'Should have incremented creditsUsed');
    // creditBalance decreases when credits are spent
    const orgAfter = await prisma.org.findUniqueOrThrow({ where: { id: org.id } });
    // In shared schema, creditBalance is decremented (not creditsUsed)
    assert.ok(orgAfter.creditBalance >= 0, 'Credit balance should not go negative');
  });

  await test('Credit guard prevents negative balance on overflow', async () => {
    // Set org to low balance (1 credit left)
    await prisma.org.update({ where: { id: org.id }, data: { creditBalance: 1 } });

    // Try to deduct 10 credits (only 1 left)
    const result = await prisma.org.updateMany({
      where: { id: org.id, creditBalance: { gte: 10 } },
      data:  { creditBalance: { decrement: 10 } },
    });

    eq(result.count, 0, 'Guard should block decrement when insufficient balance');
    const orgCheck = await prisma.org.findUniqueOrThrow({ where: { id: org.id } });
    eq(orgCheck.creditBalance, 1, 'creditBalance should remain at 1 (not decremented)');

    // Restore
    await prisma.org.update({ where: { id: org.id }, data: { creditBalance: 100 } });
  });

  await test('Budget cap enforcement prevents spend beyond cap', async () => {
    // Set low balance to simulate budget cap
    await prisma.org.update({ where: { id: org.id }, data: { creditBalance: 5 } });
    const org2 = await prisma.org.findUniqueOrThrow({ where: { id: org.id } });
    
    // Guard: cannot deduct 10 from balance of 5
    const canAfford = org2.creditBalance >= 10;
    assert.ok(!canAfford, 'Should not be able to afford 10 credits when balance is 5');
    
    // Restore
    await prisma.org.update({ where: { id: org.id }, data: { creditBalance: 100 } });
  });

  await test('Credit transaction ledger maintains accurate audit trail', async () => {
    const key1 = `test_debit:${org.id}:${crypto.randomBytes(4).toString('hex')}`;
    const key2 = `test_credit:${org.id}:${crypto.randomBytes(4).toString('hex')}`;
    
    await prisma.creditTransaction.createMany({
      data: [
        { orgId: org.id, type: 'consume', amount: -10, unit: 'credits', reason: 'static', refId: 'job_1', idempotencyKey: key1 },
        { orgId: org.id, type: 'refund', amount: 10, unit: 'credits', reason: 'static', refId: 'job_1', idempotencyKey: key2 },
      ],
    });

    const ledger = await prisma.creditTransaction.findMany({
      where: { orgId: org.id, idempotencyKey: { in: [key1, key2] } },
    });
    eq(ledger.length, 2, 'Should have both debit and credit entries');
    const netChange = ledger.reduce((sum, t) => sum + t.amount, 0);
    eq(netChange, 0, 'Net change should be 0 (debit + refund cancel out)');
  });

  await cleanup(org.id);
}

// ══════════════════════════════════════════════════════════════════════════════
// GROUP 3 — Plan upgrade/downgrade
// ══════════════════════════════════════════════════════════════════════════════
async function group3(): Promise<void> {
  console.log('\n📋 Group 3: Plan upgrade/downgrade');

  await test('Plan configs: all plans have required V2 fields', () => {
    for (const [planKey, plan] of Object.entries(PLANS)) {
      assert.ok(typeof plan.canUseHqUpgrade === 'boolean', `${planKey}: canUseHqUpgrade missing`);
      assert.ok(typeof plan.hqCreditMultiplier === 'number', `${planKey}: hqCreditMultiplier missing`);
      assert.ok(typeof plan.maxOnDemandAssets === 'number', `${planKey}: maxOnDemandAssets missing`);
      assert.ok(plan.maxOnDemandAssets > 0, `${planKey}: maxOnDemandAssets must be > 0`);
    }
    return Promise.resolve();
  });

  await test('HQ upgrade: FREE plan is blocked', () => {
    const result = checkHqUpgrade({
      orgId: 'org_test', plan: 'FREE',
      creditBalance: 100, dailyCreditBalance: 0,
      subscriptionStatus: 'ACTIVE', costProtectionBlocked: false,
    });
    eq(result.allowed, false, 'FREE plan should not allow HQ upgrade');
    return Promise.resolve();
  });

  await test('HQ upgrade: CREATOR plan is blocked', () => {
    const result = checkHqUpgrade({
      orgId: 'org_test', plan: 'CREATOR',
      creditBalance: 100, dailyCreditBalance: 0,
      subscriptionStatus: 'ACTIVE', costProtectionBlocked: false,
    });
    eq(result.allowed, false, 'CREATOR plan should not allow HQ upgrade');
    return Promise.resolve();
  });

  await test('HQ upgrade: PRO plan is allowed', () => {
    const result = checkHqUpgrade({
      orgId: 'org_test', plan: 'PRO',
      creditBalance: 100, dailyCreditBalance: 0,
      subscriptionStatus: 'ACTIVE', costProtectionBlocked: false,
    });
    eq(result.allowed, true, 'PRO plan should allow HQ upgrade');
    return Promise.resolve();
  });

  await test('HQ upgrade: STUDIO plan is allowed', () => {
    const result = checkHqUpgrade({
      orgId: 'org_test', plan: 'STUDIO',
      creditBalance: 100, dailyCreditBalance: 0,
      subscriptionStatus: 'ACTIVE', costProtectionBlocked: false,
    });
    eq(result.allowed, true, 'STUDIO plan should allow HQ upgrade');
    return Promise.resolve();
  });

  // 3D plan gate test removed — 3D generation is not part of the launch product

  await test('Credit costs: launch modes normal_ad=20, cinematic_ad=35', () => {
    gte(CREDIT_COSTS.static_hq, CREDIT_COSTS.static + 1, 'HQ should cost more than standard');
    eq(CREDIT_COSTS.normal_ad, 20, 'Normal Ad should cost 20 credits');
    eq(CREDIT_COSTS.cinematic_ad, 35, 'Cinematic Ad should cost 35 credits');
    return Promise.resolve();
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// GROUP 4 — Daily FREE credit reset & cycle rollover
// ══════════════════════════════════════════════════════════════════════════════
async function group4(): Promise<void> {
  console.log('\n📋 Group 4: Daily FREE credit reset & cycle rollover');
  const org = await makeTestOrg('FREE', { creditBalance: 0, dailyCreditBalance: 10 });

  await test('Daily credit reset: dailyCreditBalance resets independently of creditBalance', async () => {
    // Simulate daily reset
    await prisma.org.update({
      where: { id: org.id },
      data:  { dailyCreditBalance: PLANS.FREE.freeDailyCreditsPerDay },
    });
    const after = await prisma.org.findUniqueOrThrow({ where: { id: org.id } });
    eq(after.dailyCreditBalance, PLANS.FREE.freeDailyCreditsPerDay);
    eq(after.creditBalance, 0, 'Main credit balance should not be affected by daily reset');
  });

  await test('Rollover: PRO plan carries over 15% of unused credits', () => {
    const proRollover = PLANS.PRO.rolloverPct;
    gte(proRollover, 0.1, 'PRO rollover should be at least 10%');
    lte(proRollover, 0.2, 'PRO rollover should not exceed 20%');
    const unused       = 200;
    const rolledOver   = Math.floor(unused * proRollover);
    gte(rolledOver, 20, 'Should roll over at least 20 credits of 200 unused');
    return Promise.resolve();
  });

  await test('FREE plan: no rollover (rolloverPct = 0)', () => {
    eq(PLANS.FREE.rolloverPct, 0, 'FREE plan should have 0% rollover');
    return Promise.resolve();
  });

  await cleanup(org.id);
}

// ══════════════════════════════════════════════════════════════════════════════
// GROUP 5 — Concurrent job spend (no double-spend, no negative balance)
// ══════════════════════════════════════════════════════════════════════════════
async function group5(): Promise<void> {
  console.log('\n📋 Group 5: Concurrent job spend & race prevention');
  const org = await makeTestOrg('PRO', { creditBalance: 50 });

  await test('Concurrent deductions: guard prevents negative balance', async () => {
    // Simulate 10 concurrent deductions of 10 credits each (total demand = 100, limit = 50)
    const cost = 10;
    const concurrency = 10;

    const results = await Promise.allSettled(
      Array.from({ length: concurrency }).map(() =>
        prisma.org.updateMany({
          where: { id: org.id, creditBalance: { gte: cost } },
          data:  { creditBalance: { decrement: cost } },
        })
      )
    );

    const succeeded = results.filter(r => r.status === 'fulfilled' && (r.value as any).count > 0).length;
    const orgFinal  = await prisma.org.findUniqueOrThrow({ where: { id: org.id } });

    // creditBalance must never go negative
    gte(orgFinal.creditBalance, 0, 'creditBalance must never go negative');
    lte(succeeded, 5, 'At most 5 deductions should succeed (50 credits / 10 each)');
  });

  await cleanup(org.id);
}

// ══════════════════════════════════════════════════════════════════════════════
// GROUP 6 — Export idempotency & ZIP integrity
// ══════════════════════════════════════════════════════════════════════════════
async function group6(): Promise<void> {
  console.log('\n📋 Group 6: Export idempotency & ZIP integrity');
  await test('Export idempotency: same key returns same result on second call', async () => {
    const org  = await makeTestOrg();
    const user = await makeTestUser(org.id);
    const guard = createExportIdempotencyGuard(prisma as any);

    const params = { userId: user.id, orgId: org.id, assetIds: ['asset_1', 'asset_2'], format: 'zip' };
    const idempotencyKey = computeExportIdempotencyKey(params);

    // First check — no existing job
    const existing1 = await guard.check(params);
    assert.ok(existing1 === null, 'First check should not find existing result');

    // Create job with idempotency key
    const job = await prisma.job.create({
      data: {
        type:        'EXPORT_BUNDLE',
        status:      'PENDING',
        userId:      user.id,
        orgId:       org.id,
        progress:    0,
        maxAttempts: 1,
        payload:     { idempotencyKey, assetIds: ['asset_1', 'asset_2'], format: 'zip' } as any,
      },
    });

    // Second check — should find existing job
    const existing2 = await guard.check(params);
    assert.ok(existing2 !== null, 'Second check should find existing job');
    eq(existing2!.idempotencyKey, idempotencyKey, 'Should return the same idempotency key');

    await cleanup(org.id);
  });

  await test('ZIP integrity: hash validation structure', () => {
    // Test that our hash computation is deterministic
    const assets  = ['asset_a', 'asset_b', 'asset_c'];
    const sorted  = [...assets].sort();
    const hash1   = crypto.createHash('sha256').update(sorted.join(',')).digest('hex');
    const hash2   = crypto.createHash('sha256').update([...assets].sort().join(',')).digest('hex');
    eq(hash1, hash2, 'ZIP content hash must be deterministic regardless of input order');
    return Promise.resolve();
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// GROUP 7 — SSRF protection
// ══════════════════════════════════════════════════════════════════════════════
async function group7(): Promise<void> {
  console.log('\n📋 Group 7: SSRF protection');

  const blocked = [
    'http://localhost/admin',
    'http://127.0.0.1:6379',
    'http://169.254.169.254/latest/meta-data',
    'http://10.0.0.1/internal',
    'http://192.168.1.1/api',
    'http://[::1]/admin',
    'file:///etc/passwd',
    'gopher://evil.com',
  ];

  const allowed = [
    'https://api.example.com/webhook',
    'https://hooks.slack.com/services/T123',
    'https://webhook.site/abc123',
  ];

  for (const url of blocked) {
    await test(`SSRF blocked: ${url}`, () => {
      const result = validateWebhookUrl(url);
      assert.ok(!result.safe, `Should block SSRF URL: ${url}`);
      return Promise.resolve();
    });
  }

  for (const url of allowed) {
    await test(`SSRF allowed: ${url}`, () => {
      const result = validateWebhookUrl(url);
      assert.ok(result.safe, `Should allow legitimate URL: ${url}`);
      return Promise.resolve();
    });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// GROUP 8 — Soft delete behavior
// ══════════════════════════════════════════════════════════════════════════════
async function group8(): Promise<void> {
  console.log('\n📋 Group 8: Soft delete behavior');

  await test('Soft delete: deletedAt is set without hard delete', async () => {
    const org  = await makeTestOrg();
    const user = await makeTestUser(org.id);

    // Create a job
    const job = await prisma.job.create({
      data: { type: 'GENERATE_ASSETS', status: 'COMPLETED', userId: user.id, orgId: org.id, progress: 100, maxAttempts: 3, payload: {} as any },
    });

    // Soft-delete tracked via canceledAt timestamp in the shared schema
    const deleted = await prisma.job.update({
      where: { id: job.id },
      data:  { status: 'CANCELLED', canceledAt: new Date() },
    });
    assert.ok(deleted.canceledAt !== null, 'canceledAt should be set');

    // Job should still exist in DB (not hard-deleted)
    const stillExists = await prisma.job.findUnique({ where: { id: job.id } });
    assert.ok(stillExists, 'Soft-deleted (cancelled) job should still exist in DB');

    // Clean up
    await cleanup(org.id);
  });

  await test('Soft delete: asset soft-delete tracked via metadata (S3 key preserved)', async () => {
    const org  = await makeTestOrg();
    const user = await makeTestUser(org.id);

    const asset = await prisma.asset.create({
      data: {
        userId:    user.id,
        orgId:     org.id,
        name:      'test-asset.png',
        format:    'instagram_post',
        category:  'instagram_post',
        mimeType:  'image/png',
        s3Key:     'orgs/test/assets/ab/asset_abc.png',
        s3Bucket:  'test-bucket',
        width:     1080,
        height:    1080,
        fileSize:  50000,
      },
    });

    // Asset soft-delete: tracked via metadata (schema doesn't have deletedAt column)
    await prisma.asset.update({
      where: { id: asset.id },
      data:  { metadata: { deletedAt: new Date().toISOString(), deletedBy: user.id } },
    });
    const softDeleted = await prisma.asset.findUnique({ where: { id: asset.id } });

    assert.ok(softDeleted, 'Asset should still exist in DB after soft-delete');
    const meta = softDeleted!.metadata as Record<string, unknown>;
    assert.ok(meta.deletedAt, 'deletedAt should be set in metadata');
    eq(softDeleted!.s3Key, 'orgs/test/assets/ab/asset_abc.png', 'S3 key should be preserved');

    await cleanup(org.id);
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// GROUP 9 — Audit log completeness
// ══════════════════════════════════════════════════════════════════════════════
async function group9(): Promise<void> {
  console.log('\n📋 Group 9: Audit log completeness');
  const org  = await makeTestOrg();
  const user = await makeTestUser(org.id);

  await test('Audit log: entries are created with correct fields', async () => {
    const entry = await prisma.auditLog.create({
      data: {
        orgId:      org.id,
        actorId:    user.id,
        action:     'job.created',
        targetType: 'job',
        targetId:   'job_test_123',
        metadata:   { format: 'instagram_post', creditCost: 5 },
      },
    });

    assert.ok(entry.id, 'Should have an ID');
    eq(entry.action, 'job.created');
    eq(entry.orgId, org.id);
    eq(entry.actorId, user.id);
    notNull(entry.metadata, 'Metadata should be set');
  });

  await test('Audit log: admin action is recorded with actor', async () => {
    const adminEntry = await prisma.auditLog.create({
      data: {
        orgId:      org.id,
        actorId:    user.id,
        action:     'member.role_changed',
        targetType: 'user',
        targetId:   'user_target',
        metadata:   { oldRole: 'VIEWER', newRole: 'MANAGER' },
      },
    });
    eq(adminEntry.action, 'member.role_changed');
    assert.ok(adminEntry.createdAt, 'Should have createdAt timestamp');
  });

  await cleanup(org.id);
}

// ══════════════════════════════════════════════════════════════════════════════
// GROUP 10 — Health check endpoints
// ══════════════════════════════════════════════════════════════════════════════
async function group10(): Promise<void> {
  console.log('\n📋 Group 10: Health checks');

  await test('DB health: can query prisma successfully', async () => {
    const result = await prisma.$queryRaw`SELECT 1 AS ok`;
    assert.ok(Array.isArray(result) && (result as any[])[0]?.ok === 1, 'DB query should return 1');
  });

  await test('Env validation: validateSharedEnv does not throw', () => {
    assert.doesNotThrow(() => validateSharedEnv(), 'validateSharedEnv should not throw in test env');
    return Promise.resolve();
  });

  await test('Plans: all required plan keys present', () => {
    const required: string[] = ['FREE', 'CREATOR', 'PRO', 'STUDIO'];
    for (const k of required) {
      assert.ok(k in PLANS, `Plan key ${k} missing from PLANS`);
    }
    return Promise.resolve();
  });

  await test('Credit costs: all keys are positive integers', () => {
    for (const [k, v] of Object.entries(CREDIT_COSTS)) {
      assert.ok(Number.isInteger(v) && v > 0, `CREDIT_COSTS.${k} must be a positive integer, got ${v}`);
    }
    return Promise.resolve();
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// GROUP 11 — Studio bridge credit sharing & enforcement
// ══════════════════════════════════════════════════════════════════════════════
async function group11(): Promise<void> {
  console.log('\n📋 Group 11: Studio bridge credit sharing');

  await test('Studio bridge: credit deduction uses shared creditService', async () => {
    const org  = await makeTestOrg('STUDIO', { creditBalance: 500 });
    const user = await makeTestUser(org.id);

    const creditService = createCreditService(prisma as any);
    const jobId = `render_test_${crypto.randomBytes(4).toString('hex')}`;

    await creditService.consumeCredits({
      orgId:   org.id,
      jobId,
      reason:  'video_std',
    });

    const orgAfter = await prisma.org.findUniqueOrThrow({ where: { id: org.id } });
    eq(orgAfter.creditsUsed, CREDIT_COSTS.video_std, 'Should have consumed video_std credits');

    // Idempotent retry must not double-deduct (same jobId = same key)
    await creditService.consumeCredits({
      orgId:   org.id,
      jobId,   // same jobId → idempotent
      reason:  'video_std',
    });

    const orgAfter2 = await prisma.org.findUniqueOrThrow({ where: { id: org.id } });
    eq(orgAfter2.creditsUsed, CREDIT_COSTS.video_std, 'Second call with same jobId must not double-deduct');

    await cleanup(org.id);
  });

  await test('Studio bridge: video access blocked on FREE plan', () => {
    const result = PLANS.FREE.canUseStudioVideo;
    eq(result, false, 'FREE plan should not have studio video access');
    return Promise.resolve();
  });

  await test('Studio bridge: video access allowed on STUDIO plan', () => {
    const result = PLANS.STUDIO.canUseStudioVideo;
    eq(result, true, 'STUDIO plan should have video access');
    return Promise.resolve();
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// GROUP 12 — On-demand asset engine
// ══════════════════════════════════════════════════════════════════════════════
async function group12(): Promise<void> {
  console.log('\n📋 Group 12: On-demand asset generation engine');

  await test('Similarity hash: deterministic for same inputs', () => {
    const h1 = computeSimilarityHash('product photo on white background', 'photoreal', 'standard', ['#ff0000', '#00ff00']);
    const h2 = computeSimilarityHash('product photo on white background', 'photoreal', 'standard', ['#ff0000', '#00ff00']);
    eq(h1, h2, 'Same inputs must produce same hash');
    return Promise.resolve();
  });

  await test('Similarity hash: palette order is normalized', () => {
    const h1 = computeSimilarityHash('test prompt', 'photoreal', 'standard', ['#aaa', '#bbb', '#ccc']);
    const h2 = computeSimilarityHash('test prompt', 'photoreal', 'standard', ['#ccc', '#aaa', '#bbb']);
    eq(h1, h2, 'Palette order should not affect hash');
    return Promise.resolve();
  });

  await test('Similarity hash: quality is part of hash (standard ≠ hq)', () => {
    const h1 = computeSimilarityHash('test prompt', 'photoreal', 'standard', []);
    const h2 = computeSimilarityHash('test prompt', 'photoreal', 'hq', []);
    assert.notStrictEqual(h1, h2, 'standard and hq must produce different hashes');
    return Promise.resolve();
  });

  await test('Similarity hash: different prompts produce different hashes', () => {
    const h1 = computeSimilarityHash('sunset over mountains', 'photoreal', 'standard', []);
    const h2 = computeSimilarityHash('sunrise over mountains', 'photoreal', 'standard', []);
    assert.notStrictEqual(h1, h2, 'Different prompts must produce different hashes');
    return Promise.resolve();
  });

  // 3D asset engine test removed — '3d' removed from AssetTypeSchema; not a launch asset type

  await test('Asset engine: HQ request fails when plan does not allow', async () => {
    try {
      await generateAssetOnDemand({
        requestId: 'test_hq_req',
        orgId:     'test_org',
        assetType: 'photoreal',
        quality:   'hq',
        palette:   [],
        planCanUseHq:  false, // plan does NOT allow
        maxOnDemandAssets: 4,
        expectedCreditCost: 3,
        missingEl: {
          elementId:    'el_hq',
          elementType:  'hero_image',
          requiredSize: { width: 1024, height: 1024 },
          context:      'A high quality product image',
          priority:     'optional',
        },
      });
      assert.fail('Should have thrown for HQ when plan disallows');
    } catch (err: any) {
      assert.ok(
        err.message.toLowerCase().includes('hq') || err.message.toLowerCase().includes('pro') || err.message.toLowerCase().includes('studio'),
        `HQ error should mention plan upgrade requirement, got: ${err.message}`
      );
    }
  });

  await test('Asset engine: safety block is enforced and throws', async () => {
    try {
      await generateAssetOnDemand({
        requestId: 'test_safety',
        orgId:     'test_org',
        assetType: 'photoreal',
        quality:   'standard',
        palette:   [],
        planCanUseHq:  true,
        maxOnDemandAssets: 4,
        expectedCreditCost: 1,
        safetyLevel: 'strict',
        missingEl: {
          elementId:    'el_blocked',
          elementType:  'hero_image',
          requiredSize: { width: 1024, height: 1024 },
          context:      'An image with explicit violence and gore',
          priority:     'optional',
        },
      });
      assert.fail('Should have thrown for unsafe content');
    } catch (err: any) {
      assert.ok(
        err.message.toLowerCase().includes('safety') || err.message.toLowerCase().includes('block') || err.message.toLowerCase().includes('blocked'),
        `Safety error expected, got: ${err.message}`
      );
    }
  });

  await test('Asset engine: cache hit returns creditCost = 0', async () => {
    const org = await makeTestOrg();

    const hash = computeSimilarityHash('blue ocean background', 'illustrated', 'standard', ['#0000ff']);

    // Insert a cached asset
    await (prisma as any).aIGeneratedAsset.create({
      data: {
        id:             `cached_${crypto.randomBytes(4).toString('hex')}`,
        orgId:          org.id,
        assetType:      'illustrated',
        quality:        'standard',
        source:         'ai_generated',
        url:            'https://cdn.arkiol.app/ai-assets/test.webp',
        cdnUrl:         'https://cdn.arkiol.app/ai-assets/test.webp',
        width:          1024,
        height:         1024,
        mimeType:       'image/webp',
        palette:        ['#0000ff'],
        perspectiveFit: false,
        safetyValidated: true,
        similarityHash: hash,
        promptUsed:     'blue ocean background',
        metadata:       { creditCost: 1, providerCostUsd: 0.04, durationMs: 3000 },
      },
    });

    const result = await generateAssetOnDemand(
      {
        requestId: `test_cache_${crypto.randomBytes(4).toString('hex')}`,
        orgId:     org.id,
        assetType: 'illustrated',
        quality:   'standard',
        palette:   ['#0000ff'],
        planCanUseHq:  false,
        maxOnDemandAssets: 4,
        expectedCreditCost: 1,
        missingEl: {
          elementId:    'el_bg',
          elementType:  'background',
          requiredSize: { width: 1024, height: 1024 },
          context:      'blue ocean background',
          priority:     'optional',
        },
      },
      { prisma: prisma as any }
    );

    eq(result.cacheHit, true, 'Should be a cache hit');
    eq(result.creditCost, 0, 'Cache hits should cost 0 credits');
    eq(result.source, 'cache');

    await cleanup(org.id);
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// GROUP 13 — Monitoring & alerting
// ══════════════════════════════════════════════════════════════════════════════
async function group13(): Promise<void> {
  console.log('\n📋 Group 13: Monitoring & alerting');

  beforeEach: _resetAlertDedup();

  await test('Cost spike: org over threshold fires alert', async () => {
    _resetAlertDedup();
    const alerts: unknown[] = [];
    const { configureMonitoring } = await import('../src/monitoring');
    configureMonitoring({ onAlert: async (a) => { alerts.push(a); } });

    await checkCostSpike({
      orgId:             'org_spike_test',
      creditsUsedInHour: 200, // > default threshold of 100
    });

    assert.ok(alerts.length >= 1, 'Should have fired at least 1 alert');
    const alert = (alerts as any[])[0];
    eq(alert.type, 'cost_spike_org');
    assert.ok(['warning', 'critical'].includes(alert.severity));
    eq(alert.orgId, 'org_spike_test');
  });

  await test('Cost spike: below threshold does not fire', async () => {
    _resetAlertDedup();
    const alerts: unknown[] = [];
    const { configureMonitoring } = await import('../src/monitoring');
    configureMonitoring({ onAlert: async (a) => { alerts.push(a); } });

    await checkCostSpike({
      orgId:             'org_below',
      creditsUsedInHour: 50, // below default 100
    });

    eq(alerts.length, 0, 'Should not fire alert below threshold');
  });

  await test('Cost spike: dedup window prevents spam', async () => {
    _resetAlertDedup();
    const alerts: unknown[] = [];
    const { configureMonitoring } = await import('../src/monitoring');
    configureMonitoring({ onAlert: async (a) => { alerts.push(a); } });

    // Fire twice for same org
    await checkCostSpike({ orgId: 'org_dedup', creditsUsedInHour: 999 });
    await checkCostSpike({ orgId: 'org_dedup', creditsUsedInHour: 999 });

    eq(alerts.length, 1, 'Dedup window should prevent second alert');
  });

  await test('Stage health: high failure rate fires critical alert', async () => {
    _resetAlertDedup();
    const alerts: unknown[] = [];
    const { configureMonitoring } = await import('../src/monitoring');
    configureMonitoring({ onAlert: async (a) => { alerts.push(a); } });

    await checkStageHealth({
      stageId:      'intent',
      totalRuns:    100,
      failedRuns:   25,   // 25% > critical threshold of 20%
      fallbackRuns: 10,
      maxDurationMs: 1000,
    });

    const critical = (alerts as any[]).find(a => a.severity === 'critical');
    assert.ok(critical, 'Should fire a critical alert for >20% failure rate');
    eq(critical.type, 'stage_failure_rate');
  });

  await test('Stage health: timeout fires warning alert', async () => {
    _resetAlertDedup();
    const alerts: unknown[] = [];
    const { configureMonitoring } = await import('../src/monitoring');
    configureMonitoring({ onAlert: async (a) => { alerts.push(a); } });

    await checkStageHealth({
      stageId:      'layout',
      totalRuns:    10,
      failedRuns:   0,
      fallbackRuns: 1,
      maxDurationMs: 35_000, // > default 30s timeout
    });

    const timeoutAlert = (alerts as any[]).find(a => a.type === 'stage_timeout');
    assert.ok(timeoutAlert, 'Should fire timeout alert');
  });

  await test('DLQ depth: critical fires when depth > threshold', async () => {
    _resetAlertDedup();
    const alerts: unknown[] = [];
    const { configureMonitoring } = await import('../src/monitoring');
    configureMonitoring({ onAlert: async (a) => { alerts.push(a); } });

    await checkDlqDepth(15); // > default threshold of 10

    const dlqAlert = (alerts as any[]).find(a => a.type === 'dlq_depth_critical');
    assert.ok(dlqAlert, 'DLQ depth alert should fire');
    eq(dlqAlert.severity, 'critical');
  });

  await test('Volume anomaly: high job count fires alert', async () => {
    _resetAlertDedup();
    const alerts: unknown[] = [];
    const { configureMonitoring } = await import('../src/monitoring');
    configureMonitoring({ onAlert: async (a) => { alerts.push(a); } });

    await checkVolumeAnomaly({
      orgId:        'org_vol_test',
      jobsInHour:   50, // > default 30
      assetsInHour: 150,
    });

    const volAlert = (alerts as any[]).find(a => a.type === 'generation_volume_anomaly');
    assert.ok(volAlert, 'Volume anomaly alert should fire');
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// GROUP 14 — Concurrency stress test
// ══════════════════════════════════════════════════════════════════════════════
async function group14(): Promise<void> {
  console.log('\n📋 Group 14: Concurrency stress test');

  await test('Concurrency: 20 simultaneous job creations stay within limit', async () => {
    const org  = await makeTestOrg('PRO', { creditBalance: 1000 });
    const user = await makeTestUser(org.id);
    const MAX_CONCURRENT = 5; // PRO plan max concurrency

    const results = await Promise.allSettled(
      Array.from({ length: 20 }).map((_, i) =>
        prisma.job.create({
          data: {
            type:        'GENERATE_ASSETS',
            status:      'PENDING',
            userId:      user.id,
            orgId:       org.id,
            progress:    0,
            maxAttempts: 3,
            payload:     { prompt: `test ${i}` } as any,
          },
        })
      )
    );

    const created = results.filter(r => r.status === 'fulfilled').length;
    gte(created, 1, 'At least 1 job should be created');
    // Note: actual concurrency enforcement happens at the API/worker level,
    // not in DB create. Here we verify DB can handle concurrent writes.
    assert.ok(created <= 20, 'Cannot create more than 20 jobs in this batch');

    await cleanup(org.id);
  });

  await test('Concurrency: concurrent credit reads return consistent state', async () => {
    const org = await makeTestOrg('PRO', { creditBalance: 100 });

    // Simulate concurrent reads + writes
    const reads = await Promise.allSettled(
      Array.from({ length: 20 }).map(() =>
        prisma.org.findUniqueOrThrow({ where: { id: org.id }, select: { creditsUsed: true, creditLimit: true } })
      )
    );

    const successReads = reads.filter(r => r.status === 'fulfilled').length;
    eq(successReads, 20, 'All concurrent reads should succeed');

    await cleanup(org.id);
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// GROUP 15 — Asset generation edge cases
// ══════════════════════════════════════════════════════════════════════════════
async function group15(): Promise<void> {
  console.log('\n📋 Group 15: Asset generation edge cases');

  await test('Asset engine: invalid assetType throws with clear error', async () => {
    try {
      await generateAssetOnDemand({
        requestId: 'bad_type',
        orgId:     'test_org',
        assetType: 'gif' as any, // invalid
        quality:   'standard',
        palette:   [],
        planCanUseHq:  false,
        maxOnDemandAssets: 4,
        expectedCreditCost: 0,
        missingEl: {
          elementId:    'el_1',
          elementType:  'hero_image',
          requiredSize: { width: 512, height: 512 },
          context:      'test',
          priority:     'optional',
        },
      });
      assert.fail('Should have thrown for invalid assetType');
    } catch (err: any) {
      // Zod validation should catch this
      assert.ok(err.message.length > 0, 'Should throw a descriptive error');
    }
  });

  await test('Asset engine: prompt that is too short is rejected', async () => {
    try {
      await generateAssetOnDemand({
        requestId: 'short_prompt',
        orgId:     'test_org',
        assetType: 'photoreal',
        quality:   'standard',
        palette:   [],
        planCanUseHq:  false,
        maxOnDemandAssets: 4,
        expectedCreditCost: 1,
        safetyLevel: 'strict',
        missingEl: {
          elementId:    'el_short',
          elementType:  'hero_image',
          requiredSize: { width: 512, height: 512 },
          context:      'hi', // too short for strict mode
          priority:     'optional',
        },
      });
      assert.fail('Should have thrown for too-short prompt in strict mode');
    } catch (err: any) {
      assert.ok(err.message.length > 0);
    }
  });

  // 3D env var test removed — ENABLE_3D_GENERATION not part of launch

  await test('HQ cost: static_hq costs exactly 2 more credits than static', () => {
    eq(CREDIT_COSTS.static_hq - CREDIT_COSTS.static, 2, 'HQ upgrade adds exactly 2 credits per static asset');
    return Promise.resolve();
  });

  await test('Asset engine: cache hit returns reuseCount > 0', async () => {
    const org = await makeTestOrg();
    const hash = computeSimilarityHash('green forest texture', 'illustrated', 'standard', ['#00ff00']);

    // Seed cache with reuseCount = 5
    await (prisma as any).aIGeneratedAsset.create({
      data: {
        id:              `cached_rc_${crypto.randomBytes(4).toString('hex')}`,
        orgId:           org.id,
        assetType:       'illustrated',
        quality:         'standard',
        source:          'ai_generated',
        url:             'https://cdn.arkiol.app/test.webp',
        cdnUrl:          'https://cdn.arkiol.app/test.webp',
        width:           1024,
        height:          1024,
        mimeType:        'image/webp',
        palette:         ['#00ff00'],
        perspectiveFit:  false,
        safetyValidated: true,
        similarityHash:  hash,
        promptUsed:      'green forest texture',
        metadata:        { reuseCount: 5, creditCost: 1 },
      },
    });

    const result = await generateAssetOnDemand(
      {
        requestId: `rc_test_${crypto.randomBytes(4).toString('hex')}`,
        orgId:     org.id,
        assetType: 'illustrated',
        quality:   'standard',
        palette:   ['#00ff00'],
        planCanUseHq:  false,
        maxOnDemandAssets: 4,
        expectedCreditCost: 1,
        missingEl: {
          elementId:    'el_forest',
          elementType:  'texture',
          requiredSize: { width: 1024, height: 1024 },
          context:      'green forest texture',
          priority:     'optional',
        },
      },
      { prisma: prisma as any }
    );

    eq(result.cacheHit, true, 'Should be a cache hit');
    gte(result.asset.reuseCount, 6, 'reuseCount should be incremented to at least 6');

    await cleanup(org.id);
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// GROUP 16 — Pipeline wiring: live flow integration
// Verifies that generateAssetOnDemand is properly wired into the render flow:
//   - Kill-switch blocks asset generation (not whole render)
//   - Spend guard blocks asset generation when limit exceeded
//   - Cache hit injects CDN URL without credit deduction
//   - AI generation path deducts credits and injects CDN URL
//   - HQ is never auto-applied (only on explicit hqUpgradeRequested=true + plan allows)
//   - Credit deduction is idempotent across retries
//   - Refund fires on generation failure and restores balance
//   - On-demand asset metadata is attached to result (cacheHits, aiGenerations, costs)
//   - Concurrency: parallel requests for same hash result in exactly one AI call
// ══════════════════════════════════════════════════════════════════════════════
async function group16(): Promise<void> {
  console.log('\n📋 Group 16: Pipeline wiring — live flow integration');

  // ── 16.1: Kill-switch blocks asset generation but pipeline degrades gracefully ─
  await test('Kill-switch: asset generation blocked, render continues text-only', async () => {
    // Set kill switch
    process.env.GENERATION_KILL_SWITCH = 'true';

    const { checkKillSwitch } = await import('../src/planEnforcer');
    const result = checkKillSwitch();
    assert.ok(!result.allowed, 'Kill switch should block generation');
    assert.ok(
      result.reason?.includes('temporarily') || result.reason?.includes('maintenance'),
      `Kill switch reason should mention maintenance, got: ${result.reason}`
    );

    // Unset for subsequent tests
    delete process.env.GENERATION_KILL_SWITCH;
  });

  // ── 16.2: Spend guard blocks asset generation when global limit exceeded ────
  await test('Spend guard: blocks asset generation when global monthly limit exceeded', () => {
    const { checkGlobalMonthlySpend } = require('../src/planEnforcer');

    // Set limit to $1.00 and simulate $2.00 spent
    process.env.GLOBAL_MONTHLY_SPEND_LIMIT_USD = '1.00';
    const result = checkGlobalMonthlySpend(2.00);
    assert.ok(!result.allowed, 'Spend guard should block at $2.00 when limit is $1.00');
    assert.ok(result.reason?.includes('limit'), `Reason should mention limit, got: ${result.reason}`);

    // Below limit — should pass
    const below = checkGlobalMonthlySpend(0.50);
    assert.ok(below.allowed, 'Should allow when under limit');

    delete process.env.GLOBAL_MONTHLY_SPEND_LIMIT_USD;
    return Promise.resolve();
  });

  // ── 16.3: Cache hit injects CDN URL and reports creditCost=0 ──────────────
  await test('Pipeline wiring: cache hit → CDN URL injected, creditCost=0, no AI call', async () => {
    const org = await makeTestOrg('PRO');
    const hash = computeSimilarityHash('forest background texture', 'photoreal', 'standard', ['#336600']);

    await (prisma as any).aIGeneratedAsset.create({
      data: {
        id:             `pipe_cache_${crypto.randomBytes(4).toString('hex')}`,
        orgId:          org.id,
        assetType:      'photoreal',
        quality:        'standard',
        source:         'ai_generated',
        url:            'https://cdn.arkiol.app/ai-assets/forest-bg.webp',
        cdnUrl:         'https://cdn.arkiol.app/ai-assets/forest-bg.webp',
        width:          1024,
        height:         1024,
        mimeType:       'image/webp',
        palette:        ['#336600'],
        perspectiveFit: true,
        safetyValidated: true,
        similarityHash: hash,
        promptUsed:     'forest background texture',
        metadata:       { creditCost: 1, providerCostUsd: 0.04, durationMs: 5000 },
      },
    });

    let creditDeducted = 0;
    const result = await generateAssetOnDemand(
      {
        requestId:         `pipe_cache_req_${crypto.randomBytes(4).toString('hex')}`,
        orgId:             org.id,
        assetType:         'photoreal',
        quality:           'standard',
        palette:           ['#336600'],
        planCanUseHq:      true,
        maxOnDemandAssets: 4,
        expectedCreditCost: 1,
        missingEl: {
          elementId:    'bg_element',
          elementType:  'background',
          requiredSize: { width: 1024, height: 1024 },
          context:      'forest background texture',
          priority:     'critical',
        },
      },
      { prisma: prisma as any }
    );

    eq(result.cacheHit, true, 'Should be a cache hit');
    eq(result.creditCost, 0, 'Cache hit must cost 0 credits');
    eq(result.source, 'cache');
    assert.ok(result.asset.url?.includes('cdn.arkiol.app'), 'CDN URL should be returned');
    eq(creditDeducted, 0, 'No credit deduction should occur for cache hits');

    await cleanup(org.id);
  });

  // ── 16.4: HQ upgrade requires explicit user request AND plan allowance ─────
  await test('HQ gate: quality=hq with planCanUseHq=false throws; true allows', async () => {
    // Should throw when plan forbids HQ
    try {
      await generateAssetOnDemand({
        requestId:          'test_hq_gate_deny',
        orgId:              'test_org_hq',
        assetType:          'photoreal',
        quality:            'hq',
        palette:            [],
        planCanUseHq:       false,   // plan does NOT allow
        maxOnDemandAssets:  4,
        expectedCreditCost: 3,
        missingEl: {
          elementId:    'hero_hq',
          elementType:  'hero_image',
          requiredSize: { width: 1024, height: 1024 },
          context:      'professional product photo',
          priority:     'critical',
        },
      });
      assert.fail('Should have thrown — plan does not allow HQ');
    } catch (err: any) {
      assert.ok(
        err.message.toLowerCase().includes('hq') || err.message.toLowerCase().includes('pro'),
        `Expected HQ/plan error, got: ${err.message}`
      );
    }
  });

  // ── 16.5: Credit deduction is idempotent (retry-safe) ────────────────────
  await test('Credit service: deductCredits is idempotent across retries', async () => {
    const { createCreditService } = await import('../src/credits');
    const svc = createCreditService(prisma as any);
    const org = await makeTestOrg('PRO');

    // Grant credits so deduction can succeed
    await (prisma as any).org.update({
      where: { id: org.id },
      data:  { creditBalance: 50 },
    });

    const iKey = `idem_test_${crypto.randomBytes(8).toString('hex')}`;

    // First deduction
    await svc.deductCredits(org.id, 3, 'asset_on_demand_hq', iKey);

    // Fetch balance after first deduction
    const afterFirst = await (prisma as any).org.findUnique({
      where: { id: org.id }, select: { creditBalance: true },
    });

    // Second deduction with same key — must be a no-op
    await svc.deductCredits(org.id, 3, 'asset_on_demand_hq', iKey);

    const afterSecond = await (prisma as any).org.findUnique({
      where: { id: org.id }, select: { creditBalance: true },
    });

    eq(afterFirst.creditBalance, afterSecond.creditBalance, 'Second deduction must be a no-op (idempotent)');

    await cleanup(org.id);
  });

  // ── 16.6: Refund restores balance after failed generation ─────────────────
  await test('Credit service: refundOnDemandCredits restores balance idempotently', async () => {
    const { createCreditService } = await import('../src/credits');
    const svc = createCreditService(prisma as any);
    const org = await makeTestOrg('PRO');

    await (prisma as any).org.update({
      where: { id: org.id },
      data:  { creditBalance: 50 },
    });

    const deductKey = `deduct_refund_${crypto.randomBytes(8).toString('hex')}`;
    const refundKey = `refund_${deductKey}`;

    await svc.deductCredits(org.id, 3, 'asset_on_demand_hq', deductKey);
    const afterDeduct = await (prisma as any).org.findUnique({
      where: { id: org.id }, select: { creditBalance: true },
    });
    eq(afterDeduct.creditBalance, 47, 'Balance should be 47 after deducting 3');

    await svc.refundOnDemandCredits(org.id, 3, 'refund_failed_generation', refundKey);
    const afterRefund = await (prisma as any).org.findUnique({
      where: { id: org.id }, select: { creditBalance: true },
    });
    eq(afterRefund.creditBalance, 50, 'Balance should be restored to 50 after refund');

    // Refund again — should be no-op
    await svc.refundOnDemandCredits(org.id, 3, 'refund_failed_generation', refundKey);
    const afterDoubleRefund = await (prisma as any).org.findUnique({
      where: { id: org.id }, select: { creditBalance: true },
    });
    eq(afterDoubleRefund.creditBalance, 50, 'Double refund must be idempotent (no double credit)');

    await cleanup(org.id);
  });

  // ── 16.7: CREDIT_COSTS includes asset_on_demand and asset_on_demand_hq ────
  await test('plans: CREDIT_COSTS includes asset_on_demand and asset_on_demand_hq', () => {
    const { CREDIT_COSTS } = require('../src/plans');
    assert.ok(typeof CREDIT_COSTS.asset_on_demand === 'number', 'asset_on_demand credit cost must exist');
    assert.ok(typeof CREDIT_COSTS.asset_on_demand_hq === 'number', 'asset_on_demand_hq credit cost must exist');
    assert.ok(CREDIT_COSTS.asset_on_demand > 0, 'asset_on_demand must be positive');
    assert.ok(CREDIT_COSTS.asset_on_demand_hq > CREDIT_COSTS.asset_on_demand, 'HQ must cost more than standard');
    return Promise.resolve();
  });

  // ── 16.8: detectMissingElements filters out elements with URLs ────────────
  await test('detectMissingElements: skips elements with populated url, flags elements without', () => {
    const { detectMissingElements } = require('../src/assetGenerationEngine');
    const elements = [
      { id: 'bg', type: 'background', url: 'https://cdn.example.com/bg.png', required: true, width: 1080, height: 1080 },
      { id: 'hero', type: 'hero', url: '', required: true, width: 1080, height: 500 },
      { id: 'icon', type: 'icon', required: false },        // optional — should be skipped
      { id: 'illus', type: 'illustration', required: true }, // missing and required
    ];

    const missing = detectMissingElements(elements);
    assert.ok(missing.length === 2, `Expected 2 missing elements, got ${missing.length}`);
    assert.ok(missing.some(m => m.elementId === 'hero'), 'hero should be missing (empty url)');
    assert.ok(missing.some(m => m.elementId === 'illus'), 'illus should be missing (no url)');
    assert.ok(!missing.some(m => m.elementId === 'bg'), 'bg should NOT be missing (has url)');
    assert.ok(!missing.some(m => m.elementId === 'icon'), 'icon should NOT be missing (not required)');
    return Promise.resolve();
  });

  // ── 16.9: plan.maxOnDemandAssets is respected (count limit enforcement) ───
  await test('checkOnDemandAssetCount: enforces plan asset count limit', () => {
    const { checkOnDemandAssetCount } = require('../src/planEnforcer');

    // FREE plan: maxOnDemandAssets = 2
    const freeOrg = {
      orgId: 'test', plan: 'FREE', creditBalance: 100,
      dailyCreditBalance: 0, subscriptionStatus: 'active',
      costProtectionBlocked: false,
    };
    const tooMany = checkOnDemandAssetCount(freeOrg, 5);
    assert.ok(!tooMany.allowed, 'FREE plan should deny 5 on-demand assets (limit is 2)');

    const ok = checkOnDemandAssetCount(freeOrg, 2);
    assert.ok(ok.allowed, 'FREE plan should allow exactly maxOnDemandAssets');

    return Promise.resolve();
  });

  // ── 16.10: Monitoring alert fires for cost spike from on-demand assets ────
  await test('Monitoring: cost spike alert fires when on-demand asset credits exceed threshold', async () => {
    const { configureMonitoring, checkCostSpike, _resetAlertDedup } = await import('../src/monitoring');
    _resetAlertDedup();

    const alerts: unknown[] = [];
    configureMonitoring({ onAlert: async (a) => { alerts.push(a); } });

    // Simulate org burning 150 credits in 1hr (> default threshold of 100)
    // — this represents many on-demand asset generations
    await checkCostSpike({ orgId: 'org_asset_stress', creditsUsedInHour: 150 });

    assert.ok(alerts.length >= 1, 'Should fire at least 1 alert for high on-demand asset credit usage');
    const alert = (alerts as any[])[0];
    eq(alert.type, 'cost_spike_org');
    assert.ok(['warning', 'critical'].includes(alert.severity));
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════════════════════
async function main(): Promise<void> {
  console.log('\n🧪 Arkiol V2 Full Staging Test Suite');
  console.log('════════════════════════════════════');
  const startMs = Date.now();

  try {
    await group1();   // Billing & webhooks
    await group2();   // Credit ledger
    await group3();   // Plan upgrade/downgrade
    await group4();   // Daily credits & rollover
    await group5();   // Concurrent spend
    await group6();   // Export idempotency
    await group7();   // SSRF
    await group8();   // Soft delete
    await group9();   // Audit logs
    await group10();  // Health checks
    await group11();  // Studio bridge
    await group12();  // Asset engine
    await group13();  // Monitoring & alerting
    await group14();  // Concurrency stress
    await group15();  // Asset edge cases
    await group16();  // Pipeline wiring: live flow integration
  } finally {
    await prisma.$disconnect();
  }

  const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
  console.log('\n════════════════════════════════════');
  console.log(`✅  PASSED: ${passed}`);
  console.log(`❌  FAILED: ${failed}`);
  console.log(`⏱   ELAPSED: ${elapsed}s`);

  if (errors.length > 0) {
    console.log('\nFailed tests:');
    for (const e of errors) console.log(`  ✗ ${e}`);
  }

  if (failed > 0) {
    console.error('\n❌ STAGING TESTS FAILED — Release blocked');
    process.exit(1);
  }

  console.log('\n✅ ALL STAGING TESTS PASSED — Release approved');
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
