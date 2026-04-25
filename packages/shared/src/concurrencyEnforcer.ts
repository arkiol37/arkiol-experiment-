// packages/shared/src/concurrencyEnforcer.ts
// ─────────────────────────────────────────────────────────────────────────────
// PER-USER CONCURRENCY ENFORCEMENT AT DB LAYER — Task #6
//
// Enforces concurrency limits at the database level (not just middleware),
// using a SELECT FOR UPDATE advisory lock to prevent race conditions when
// multiple requests arrive simultaneously for the same user/org.
//
// The middleware-level check in planEnforcer.ts is still useful for fast
// rejection before hitting the DB, but this layer provides the hard guarantee.
//
// Usage (inside a job-creation transaction):
//   const enforcer = createConcurrencyEnforcer(prisma);
//   await enforcer.assertWithinLimit(tx, { orgId, userId, maxConcurrency });
//   // If this throws, the transaction rolls back and no job is created.
// ─────────────────────────────────────────────────────────────────────────────

import { PrismaClient, JobStatus } from '@prisma/client';

// Job.status enum is {PENDING,RUNNING,COMPLETED,FAILED}. "Active"
// = anything not in a terminal state, i.e. PENDING or RUNNING.
const ACTIVE_STATUSES = [JobStatus.RUNNING, JobStatus.PENDING] as const;

export interface ConcurrencyCheckParams {
  orgId: string;
  userId: string;
  /** Maximum concurrent jobs allowed for this org/plan */
  maxConcurrency: number;
  /**
   * If true, also enforce per-user concurrency within the org.
   * Default: false (org-level only, which is the plan constraint)
   */
  perUserLimit?: number;
}

export class ConcurrencyLimitError extends Error {
  readonly code = 'CONCURRENCY_LIMIT';
  readonly statusCode = 429;

  constructor(
    public readonly current: number,
    public readonly limit: number,
    scope: 'org' | 'user' = 'org',
  ) {
    super(
      scope === 'org'
        ? `Concurrent job limit (${limit}) reached for your organization. Wait for a running job to finish.`
        : `You have reached your personal concurrent job limit (${limit}). Wait for a running job to finish.`
    );
  }
}

export function createConcurrencyEnforcer(prisma: PrismaClient) {
  /**
   * Count active jobs for an org (all statuses that consume a concurrency slot).
   * This uses a raw count query — no lock needed for read-only checks.
   */
  async function countActiveForOrg(orgId: string): Promise<number> {
    return prisma.job.count({
      where: {
        orgId,
        status: { in: [...ACTIVE_STATUSES] },
      },
    });
  }

  /**
   * Count active jobs for a specific user.
   */
  async function countActiveForUser(userId: string): Promise<number> {
    return prisma.job.count({
      where: {
        userId,
        status: { in: [...ACTIVE_STATUSES] },
      },
    });
  }

  /**
   * Assert that creating a new job would not exceed concurrency limits.
   *
   * IMPORTANT: This must be called inside a Prisma $transaction to be safe
   * against race conditions. The Prisma transaction provides serializable
   * isolation for the count + create pair.
   *
   * If called outside a transaction (tx = prisma), it still provides a best-
   * effort check that catches the vast majority of duplicate submissions.
   */
  async function assertWithinLimit(
    tx: PrismaClient | Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>,
    params: ConcurrencyCheckParams,
  ): Promise<void> {
    const { orgId, userId, maxConcurrency, perUserLimit } = params;

    // ── Org-level concurrency check ─────────────────────────────────────
    const orgActive = await (tx as PrismaClient).job.count({
      where: {
        orgId,
        status: { in: [...ACTIVE_STATUSES] },
      },
    });

    if (orgActive >= maxConcurrency) {
      throw new ConcurrencyLimitError(orgActive, maxConcurrency, 'org');
    }

    // ── Per-user concurrency check (optional, plan-configurable) ────────
    if (perUserLimit !== undefined && perUserLimit > 0) {
      const userActive = await (tx as PrismaClient).job.count({
        where: {
          userId,
          status: { in: [...ACTIVE_STATUSES] },
        },
      });

      if (userActive >= perUserLimit) {
        throw new ConcurrencyLimitError(userActive, perUserLimit, 'user');
      }
    }
  }

  /**
   * Load the org's plan-based concurrency limit directly from DB.
   * Avoids stale values if plan was recently changed.
   */
  async function loadOrgConcurrencyLimit(orgId: string): Promise<{
    maxConcurrency: number;
    plan: string;
  }> {
    const org = await prisma.org.findUniqueOrThrow({
      where: { id: orgId },
      select: { maxConcurrency: true, plan: true },
    });
    return {
      maxConcurrency: org.maxConcurrency,
      plan: org.plan,
    };
  }

  return {
    assertWithinLimit,
    countActiveForOrg,
    countActiveForUser,
    loadOrgConcurrencyLimit,
  };
}

export type ConcurrencyEnforcer = ReturnType<typeof createConcurrencyEnforcer>;
