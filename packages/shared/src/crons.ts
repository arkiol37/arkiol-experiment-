// packages/shared/src/crons.ts
// SCHEDULED JOBS — wire these up in your cron/scheduler (Vercel Cron, Railway, BullMQ).
// Each function is idempotent and safe to run more often than scheduled.

import { PrismaClient } from '@prisma/client';
import { createCreditService } from './credits';
import { processAutoRefill } from './autoRefill';

export function createCronJobs(prisma: PrismaClient) {
  const creditSvc = createCreditService(prisma);

  // ── Daily 00:00 UTC: reset daily credit buckets for Free users ─────────────
  async function dailyCreditReset(): Promise<{ processed: number; granted: number }> {
    const freeOrgs = await prisma.org.findMany({
      where: { plan: { in: ['FREE'] } },
      select: { id: true },
    });
    let granted = 0;
    for (const org of freeOrgs) {
      try {
        const n = await creditSvc.grantDailyCredits(org.id);
        if (n > 0) granted++;
      } catch (err) {
        console.error(`[cron:daily-credits] org ${org.id}:`, err);
      }
    }
    console.info(`[cron:daily-credits] granted=${granted}/${freeOrgs.length}`);
    return { processed: freeOrgs.length, granted };
  }

  // ── Daily 00:01 UTC: reset per-org provider cost-protection counters ────────
  async function dailySpendReset(): Promise<{ count: number }> {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const result = await prisma.org.updateMany({
      where: { dailySpendDate: { lt: today } },
      data:  { dailySpendUsd: 0, costProtectionBlocked: false },
    });
    console.info(`[cron:daily-spend-reset] reset ${result.count} orgs`);
    return { count: result.count };
  }

  // ── Hourly: downgrade orgs whose grace period has expired ──────────────────
  async function gracePeriodDowngrade(): Promise<{ downgraded: number }> {
    const expired = await prisma.org.findMany({
      where: {
        gracePeriodEndsAt: { lt: new Date() },
        subscriptionStatus: { in: ['PAST_DUE', 'UNPAID'] },
      },
      select: { id: true },
    });
    for (const org of expired) {
      await prisma.org.update({
        where: { id: org.id },
        data: {
          plan:               'FREE',
          subscriptionStatus: 'CANCELED',
          gracePeriodEndsAt:  null,
          canUseStudioVideo:   false,
          canUseGifMotion:     false,
          canBatchGenerate:    false,
          maxConcurrency:      1,
          queuePriority:       0,
          maxDailyVideoJobs:   0,
          freeWatermarkEnabled: true,
        },
      });
      await prisma.auditLog.create({
        data: {
          orgId: org.id, actorId: 'system', action: 'plan_change',
          metadata: { reason: 'grace_period_expired', newPlan: 'FREE' },
        },
      });
    }
    console.info(`[cron:grace-downgrade] downgraded=${expired.length}`);
    return { downgraded: expired.length };
  }

  // ── Every 10 minutes: process auto-refill for low-balance orgs ─────────────
  async function autoRefillRun(stripe: import("stripe").default, sendEmail?: (p: { to: string; subject: string; text: string }) => Promise<void>): Promise<{ triggered: number; failed: number }> {
    return processAutoRefill({ prisma, stripe, sendEmail });
  }

  // ── Reconciliation: verify cached balances match ledger sums ───────────────
  // Run occasionally (e.g. nightly) to catch any drift.
  async function reconcileAllBalances(): Promise<{ checked: number; corrected: number }> {
    const orgs = await prisma.org.findMany({ select: { id: true, creditBalance: true } });
    let corrected = 0;
    for (const org of orgs) {
      try {
        const correct = await creditSvc.reconcileBalance(org.id);
        if (correct !== org.creditBalance) corrected++;
      } catch {}
    }
    console.info(`[cron:reconcile] checked=${orgs.length} corrected=${corrected}`);
    return { checked: orgs.length, corrected };
  }

  return { dailyCreditReset, dailySpendReset, gracePeriodDowngrade, autoRefillRun, reconcileAllBalances };
}
