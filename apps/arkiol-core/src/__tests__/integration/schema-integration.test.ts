/**
 * apps/arkiol-core/src/__tests__/integration/schema-integration.test.ts
 *
 * Integration tests that require a real PostgreSQL database.
 * Run with: jest --testPathPattern=integration (needs DATABASE_URL set)
 *
 * These tests verify:
 *  1. Prisma client can connect and query the DB
 *  2. All unified-schema models are accessible without runtime errors
 *  3. Basic CRUD round-trips on core models
 *  4. Relation traversals work as expected
 *
 * The DB must have been migrated before running these tests.
 * In CI: the integration-tests job handles migration first.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({ log: ['error'] });
const RUN   = Date.now().toString(36);

// ── Helpers ──────────────────────────────────────────────────────────────────
const orgId   = `int-org-${RUN}`;
const userId  = `int-user-${RUN}`;

afterAll(async () => {
  // Clean up all fixtures created during this test run
  await prisma.$transaction([
    prisma.job.deleteMany({ where: { orgId } }),
    prisma.user.deleteMany({ where: { id: userId } }),
    prisma.org.deleteMany({ where: { id: orgId } }),
  ]).catch(() => { /* best-effort cleanup */ });
  await prisma.$disconnect();
});

// ── 1. DB connectivity ────────────────────────────────────────────────────────
describe('DB connectivity', () => {
  it('executes a raw SELECT 1 without error', async () => {
    const result = await prisma.$queryRaw<[{ '?column?': number }]>`SELECT 1`;
    expect(result[0]['?column?']).toBe(1);
  });
});

// ── 2. Core model accessibility ───────────────────────────────────────────────
describe('Core model accessibility (schema validates against DB)', () => {
  const models: Array<keyof typeof prisma> = [
    'org', 'user', 'job', 'asset', 'brand', 'campaign',
    'creditTransaction', 'billingEvent', 'apiKey',
    'auditLog', 'usageRecord', 'aiGeneratedAsset', 'studioProject',
  ];

  for (const model of models) {
    it(`prisma.${model}.count() succeeds (table exists, columns resolve)`, async () => {
      // count() exercises the Prisma client model, column list, and DB connectivity
      const count = await (prisma[model] as any).count();
      expect(typeof count).toBe('number');
      expect(count).toBeGreaterThanOrEqual(0);
    });
  }
});

// ── 3. Org CRUD ───────────────────────────────────────────────────────────────
describe('Org model CRUD', () => {
  it('creates an org with all required fields', async () => {
    const org = await (prisma as any).org.create({
      data: {
        id:                     orgId,
        name:                   'Integration Test Org',
        plan:                   'FREE',
        subscriptionStatus:     'ACTIVE',
        creditBalance:          0,
        dailyCreditBalance:     0,
        freeWatermarkEnabled:   true,
        freeDailyCreditsPerDay: 10,
        freeMonthlyCapCredits:  300,
        maxConcurrency:         1,
        maxDailyVideoJobs:      0,
        maxFormatsPerRun:       3,
        maxVariationsPerRun:    2,
        canUseStudioVideo:      false,
        canUseGifMotion:        false,
        canBatchGenerate:       false,
        canUseZipExport:        false,
        queuePriority:          0,
        costProtectionBlocked:  false,
      },
    });
    expect(org.id).toBe(orgId);
    expect(org.plan).toBe('FREE');
    expect(org.creditBalance).toBe(0);
  });

  it('reads the org back by id', async () => {
    const org = await (prisma as any).org.findUnique({ where: { id: orgId } });
    expect(org).not.toBeNull();
    expect(org.name).toBe('Integration Test Org');
  });

  it('updates the org creditBalance', async () => {
    const updated = await (prisma as any).org.update({
      where: { id: orgId },
      data:  { creditBalance: 100 },
    });
    expect(updated.creditBalance).toBe(100);
  });
});

// ── 4. User + relation ────────────────────────────────────────────────────────
describe('User model + Org relation', () => {
  it('creates a user linked to the org', async () => {
    const user = await (prisma as any).user.create({
      data: {
        id:    userId,
        email: `integration-${RUN}@arkiol.test`,
        name:  'Integration Tester',
        role:  'ADMIN',
        orgId,
      },
    });
    expect(user.orgId).toBe(orgId);
    expect(user.role).toBe('ADMIN');
  });

  it('fetches user with org relation', async () => {
    const user = await (prisma as any).user.findUnique({
      where:   { id: userId },
      include: { org: true },
    });
    expect(user.org).not.toBeNull();
    expect(user.org.id).toBe(orgId);
  });
});

// ── 5. Job lifecycle ──────────────────────────────────────────────────────────
describe('Job model — lifecycle states', () => {
  let jobId: string;

  it('creates a QUEUED job', async () => {
    const job = await (prisma as any).job.create({
      data: {
        orgId,
        userId,
        type:           'GENERATE_ASSETS',
        status:         'QUEUED',
        reason:         'static',
        payload:        { prompt: 'integration test', formats: ['instagram_post'] },
        idempotencyKey: `int-job-${RUN}`,
        creditCost:     1,
        creditDeducted: false,
        creditRefunded: false,
      },
    });
    jobId = job.id;
    expect(job.status).toBe('QUEUED');
    expect(job.creditDeducted).toBe(false);
  });

  it('transitions job to RUNNING', async () => {
    const running = await (prisma as any).job.update({
      where: { id: jobId },
      data:  { status: 'RUNNING', startedAt: new Date(), creditDeducted: true },
    });
    expect(running.status).toBe('RUNNING');
    expect(running.startedAt).not.toBeNull();
    expect(running.creditDeducted).toBe(true);
  });

  it('transitions job to SUCCEEDED', async () => {
    const done = await (prisma as any).job.update({
      where: { id: jobId },
      data:  { status: 'SUCCEEDED', completedAt: new Date() },
    });
    expect(done.status).toBe('SUCCEEDED');
    expect(done.completedAt).not.toBeNull();
  });
});

// ── 6. CreditTransaction idempotency ─────────────────────────────────────────
describe('CreditTransaction unique constraint', () => {
  const txId = `tx-int-${RUN}`;

  it('creates a credit transaction', async () => {
    const tx = await (prisma as any).creditTransaction.create({
      data: {
        orgId,
        type:      'cycle_grant',
        amount:    100,
        reason:    'integration test',
        invoiceId: txId,
      },
    });
    expect(tx.amount).toBe(100);
  });

  it('rejects a duplicate invoiceId (unique constraint)', async () => {
    await expect(
      (prisma as any).creditTransaction.create({
        data: {
          orgId,
          type:      'cycle_grant',
          amount:    100,
          reason:    'duplicate',
          invoiceId: txId,
        },
      })
    ).rejects.toThrow();
  });
});
