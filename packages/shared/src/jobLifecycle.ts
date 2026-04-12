// packages/shared/src/jobLifecycle.ts
// JOB LIFECYCLE — checklist §6
// Single place for atomic enqueue (deduct + create), fail + refund, cancel.
// Used by BOTH Arkiol Core (Next.js API routes) and Animation Studio (Express).
// Animation Studio's renderQueue calls enqueueJob() instead of enforceCreditsForRender().

import { PrismaClient } from '@prisma/client';
type TxClient = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;
import { createCreditService, InsufficientCreditsError } from './credits';
import { preflightJob, OrgEnforcementSnapshot } from './planEnforcer';
import { CREDIT_COSTS, CreditCostKey, getPlanConfig } from './plans';
import { createConcurrencyEnforcer, ConcurrencyLimitError } from './concurrencyEnforcer';
import { createAuditLogger } from './auditLogger';
import { toJsonValue, toJsonValueNullable } from './typeUtils';

// Minimal job record shape returned by this service
export interface JobRecord {
  id: string;
  orgId: string;
  userId: string;
  status: string;
  creditCost: number;
  creditDeducted: boolean;
  creditRefunded: boolean;
  type: string;
}

const VIDEO_JOB_TYPES = new Set([
  'RENDER_VIDEO_STD', 'RENDER_VIDEO_HQ',
  'RENDER_NORMAL_AD', 'RENDER_CINEMATIC_AD',
  'STUDIO_RENDER_2D', 'STUDIO_RENDER_CINEMATIC',
]);

export function createJobLifecycleService(prisma: PrismaClient) {
  const creditSvc    = createCreditService(prisma);
  const concurrencyE = createConcurrencyEnforcer(prisma);
  const auditLog     = createAuditLogger(prisma);

  // ── Count running jobs for an org ──────────────────────────────────────────
  async function countRunning(orgId: string): Promise<number> {
    return prisma.job.count({
      where: { orgId, status: { in: ['QUEUED', 'RUNNING', 'PENDING'] } },
    });
  }

  // ── Count today's video jobs ───────────────────────────────────────────────
  async function countTodayVideoJobs(orgId: string): Promise<number> {
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    return prisma.job.count({
      where: {
        orgId,
        type: { in: [...VIDEO_JOB_TYPES] },
        createdAt: { gte: midnight },
      },
    });
  }

  // ── Enqueue job — atomic: deduct credits + create Job row ─────────────────
  // checklist §6.2: deduct at enqueue (recommended).
  // If job creation fails, credits are rolled back.
  // If same idempotencyKey already exists, returns the existing job.
  async function enqueueJob(params: {
    orgId:             string;
    userId:            string;
    type:              string;
    reason:            CreditCostKey;
    payload:           Record<string, unknown>;
    idempotencyKey?:   string;
    campaignId?:       string;
    studioProjectId?:  string;
    requestedFormats?: number;
    requestedVariations?: number;
    resolution?:       string;
    estimatedProviderCostUsd?: number;
  }): Promise<JobRecord> {
    const {
      orgId, userId, type, reason, payload, idempotencyKey,
      campaignId, studioProjectId, requestedFormats, requestedVariations,
      resolution, estimatedProviderCostUsd,
    } = params;

    // Idempotency: return existing job if this key already succeeded
    if (idempotencyKey) {
      const existing = await prisma.job.findUnique({
        where: { idempotencyKey },
      }).catch(() => null);
      if (existing && !['FAILED', 'CANCELED', 'CANCELLED'].includes(existing.status)) {
        return existing as JobRecord;
      }
    }

    // Load org enforcement snapshot
    const org = await prisma.org.findUniqueOrThrow({
      where: { id: orgId },
      select: {
        creditBalance: true, dailyCreditBalance: true,
        subscriptionStatus: true, plan: true,
        gracePeriodEndsAt: true, costProtectionBlocked: true,
      },
    });

    const snap: OrgEnforcementSnapshot = {
      orgId,
      plan:                  org.plan,
      creditBalance:         org.creditBalance,
      dailyCreditBalance:    org.dailyCreditBalance,
      subscriptionStatus:    org.subscriptionStatus,
      gracePeriodEndsAt:     org.gracePeriodEndsAt,
      costProtectionBlocked: org.costProtectionBlocked ?? false,
    };

    const running    = await countRunning(orgId);
    const todayVideo = VIDEO_JOB_TYPES.has(type) ? await countTodayVideoJobs(orgId) : 0;

    const check = preflightJob({
      org: snap, reason, currentRunning: running,
      todayVideoJobs: todayVideo,
      requestedFormats,  requestedVariations, resolution,
    });

    if (!check.allowed) {
      const denied = check as { allowed: false; reason: string; code: string; httpStatus: number };
      const err = Object.assign(new Error(denied.reason), { code: denied.code, statusCode: denied.httpStatus });
      // Audit concurrency blocks (Task #9)
      if (denied.code === 'CONCURRENCY_LIMIT') {
        await auditLog.logJobEvent({
          orgId, actorId: userId, action: 'job.concurrency_blocked',
          jobId: 'pending', jobType: type, reason: denied.reason,
        });
      }
      throw err;
    }

    // ── DB-layer concurrency enforcement (Task #6) — hard guarantee ──────────
    // This runs inside the transaction below to prevent TOCTOU race conditions.
    // The middleware-level check above is a fast rejection; this is the hard gate.
    const { maxConcurrency } = await concurrencyE.loadOrgConcurrencyLimit(orgId);

    const cost     = CREDIT_COSTS[reason];
    const plan     = getPlanConfig(org.plan);
    const useDaily = plan.freeDailyCreditsPerDay > 0;
    const jobKey   = idempotencyKey ?? `job:${orgId}:${Date.now()}`;

    // Atomic: deduct + create in one transaction
    let created: JobRecord | undefined;
    try {
      await prisma.$transaction(async (tx: TxClient) => {
        // DB-layer concurrency check inside transaction (Task #6)
        await concurrencyE.assertWithinLimit(tx, {
          orgId, userId, maxConcurrency,
        });

        // Deduct credits
        await creditSvc.consumeCredits({ orgId, jobId: jobKey, reason, useDaily });

        // Create job
        const raw = await tx.job.create({
          data: {
            orgId, userId, type: type,
            status: 'QUEUED',
            payload:        toJsonValue(payload),
            campaignId:     campaignId ?? null,
            studioProjectId: studioProjectId ?? null,
            idempotencyKey: idempotencyKey ?? null,
            creditCost:     cost,
            creditDeducted: true,
            estimatedProviderCostUsd,
          },
        });
        created = raw as unknown as JobRecord;
      });
    } catch (err) {
      // If we somehow deducted before the tx rolled back, attempt refund
      if (!(err instanceof InsufficientCreditsError)) {
        await creditSvc.refundCredits({ orgId, jobId: jobKey, reason }).catch(() => {});
      }
      throw err;
    }

    // Audit: job created (Task #9)
    await auditLog.logJobEvent({
      orgId, actorId: userId, action: 'job.created',
      jobId: created!.id, jobType: type,
    }).catch(() => {}); // non-blocking

    return created!;
  }

  // ── Transition helpers ─────────────────────────────────────────────────────
  async function markRunning(jobId: string) {
    return prisma.job.update({ where: { id: jobId }, data: { status: 'RUNNING', startedAt: new Date() } });
  }

  async function markSucceeded(jobId: string, result: Record<string, unknown>, actualProviderCostUsd?: number) {
    const job = await prisma.job.update({
      where: { id: jobId },
      data: {
        status: 'SUCCEEDED',
        result: toJsonValueNullable(result),
        completedAt: new Date(),
        actualProviderCostUsd,
      },
    });

    // Update org daily spend for cost-protection
    if (actualProviderCostUsd && actualProviderCostUsd > 0) {
      await _updateDailySpend(job.orgId, actualProviderCostUsd);
    }

    return job;
  }

  // ── Mark failed + auto-refund ──────────────────────────────────────────────
  // checklist §6.3: automatic full refund on failure.
  async function markFailed(jobId: string, errorMessage: string) {
    const job = await prisma.job.findUniqueOrThrow({ where: { id: jobId } });
    if (!['QUEUED', 'RUNNING', 'PENDING'].includes(job.status)) return job; // already terminal

    await prisma.job.update({
      where: { id: jobId },
      data: {
        status:   'FAILED',
        failedAt: new Date(),
        result:   toJsonValueNullable({ error: errorMessage }),
      },
    });

    if (job.creditDeducted && !job.creditRefunded && job.creditCost > 0) {
      const reason = _reasonFromJobType(job.type);
      if (reason) {
        const refundKey = idempotencyKeyFor(job);
        await creditSvc.refundCredits({ orgId: job.orgId, jobId: refundKey, reason }).catch(err => {
          console.error(`[jobLifecycle] refund failed for job ${jobId}:`, err);
        });
        await prisma.job.update({ where: { id: jobId }, data: { creditRefunded: true, status: 'REFUNDED' } });
        // Audit: credit refund on job failure (Task #9)
        await auditLog.logCreditEvent({
          orgId: job.orgId, actorId: job.userId,
          action: 'credit.refund',
          amount: job.creditCost,
          jobId: job.id,
        }).catch(() => {});
      }
    }
    // Audit: job failed (Task #9)
    await auditLog.logJobEvent({
      orgId: job.orgId, actorId: job.userId,
      action: 'job.failed', jobId,
      jobType: job.type, errorMessage,
      creditsRefunded: job.creditDeducted && !job.creditRefunded ? job.creditCost : 0,
    }).catch(() => {});

    return job;
  }

  // ── Cancel job ────────────────────────────────────────────────────────────
  // Queued → full refund. Running → no refund (compute already consumed).
  async function cancelJob(jobId: string): Promise<void> {
    const job = await prisma.job.findUniqueOrThrow({ where: { id: jobId } });
    if (!['QUEUED', 'RUNNING', 'PENDING'].includes(job.status)) return;

    await prisma.job.update({ where: { id: jobId }, data: { status: 'CANCELED', canceledAt: new Date() } });

    if (job.status === 'QUEUED' || job.status === 'PENDING') {
      if (job.creditDeducted && !job.creditRefunded && job.creditCost > 0) {
        const reason = _reasonFromJobType(job.type);
        if (reason) {
          await creditSvc.refundCredits({ orgId: job.orgId, jobId: idempotencyKeyFor(job), reason });
          await prisma.job.update({ where: { id: jobId }, data: { creditRefunded: true } });
        }
      }
    }
    // Running jobs: decision = no refund (partial compute already consumed). Documented in README.
    // Audit: job canceled (Task #9)
    await auditLog.logJobEvent({
      orgId: job.orgId, actorId: job.userId,
      action: 'job.canceled', jobId,
      jobType: job.type,
      reason: job.status === 'QUEUED' || job.status === 'PENDING' ? 'queued_cancel_with_refund' : 'running_cancel_no_refund',
    }).catch(() => {});
  }

  // ── Daily spend tracking ───────────────────────────────────────────────────
  async function _updateDailySpend(orgId: string, amountUsd: number) {
    const org = await prisma.org.findUniqueOrThrow({
      where: { id: orgId },
      select: { dailySpendCapUsd: true, dailySpendUsd: true, dailySpendDate: true },
    });

    const today = new Date(); today.setHours(0, 0, 0, 0);
    const isToday = org.dailySpendDate && org.dailySpendDate >= today;
    const newSpend = (isToday ? (org.dailySpendUsd ?? 0) : 0) + amountUsd;
    const blocked  = (org.dailySpendCapUsd ?? null) !== null && newSpend >= org.dailySpendCapUsd!;

    await prisma.org.update({
      where: { id: orgId },
      data: { dailySpendUsd: newSpend, dailySpendDate: today, costProtectionBlocked: blocked },
    });

    if (blocked) console.warn(`[cost-protection] org ${orgId} hit $${org.dailySpendCapUsd} cap`);
  }

  return {
    enqueueJob,
    markRunning,
    markSucceeded,
    markFailed,
    cancelJob,
    countRunning,
    countTodayVideoJobs,
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────
function idempotencyKeyFor(job: { idempotencyKey?: string | null; id: string }): string {
  return job.idempotencyKey ?? job.id;
}

const JOB_REASON_MAP: Record<string, CreditCostKey> = {
  GENERATE_ASSETS:          'static',
  RENDER_GIF:               'gif',
  RENDER_VIDEO_STD:         'video_std',
  RENDER_VIDEO_HQ:          'video_hq',
  RENDER_NORMAL_AD:         'normal_ad',
  RENDER_CINEMATIC_AD:      'cinematic_ad',
  EXPORT_BUNDLE:            'export_zip',
  STUDIO_RENDER_2D:         'normal_ad',    // Normal Ad (2D) — 20 credits
  STUDIO_RENDER_CINEMATIC:  'cinematic_ad', // Cinematic Ad (2.5D) — 35 credits
  STUDIO_EXPORT:            'export_zip',
  // Legacy aliases for existing DB records
  // ── Legacy job types (pre-launch) — no new jobs should use these ───────────
  // Kept only for credit-reason lookup on existing DB rows migrated by 20260312_launch_enum_cleanup
  RENDER_VIDEO_LONG:        'cinematic_ad',   // removed pre-launch → maps to cinematic_ad
  STUDIO_RENDER_3D:         'cinematic_ad',   // tombstone only — 3D removed pre-launch; rows backfilled by 20260312_launch_enum_cleanup migration
};

function _reasonFromJobType(type: string): CreditCostKey | null {
  return JOB_REASON_MAP[type] ?? null;
}

export type JobLifecycleService = ReturnType<typeof createJobLifecycleService>;
