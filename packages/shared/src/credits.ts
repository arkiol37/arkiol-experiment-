// packages/shared/src/credits.ts
// THE ONLY CREDIT LEDGER SERVICE for the entire Arkiol platform.
// Both Arkiol Core AND Animation Studio must use this exclusively.
// Animation Studio's billingService credit functions are REPLACED by this.
//
// Design:
//   - Org.creditBalance is the cached running total (fast reads)
//   - CreditTransaction is the ledger (audit trail + reconciliation)
//   - Every operation is idempotent via idempotencyKey
//   - Daily credits use a separate Org.dailyCreditBalance bucket
//   - Rollover credits are new ledger entries with next-cycle expiry

import { PrismaClient } from '@prisma/client';
type TxClient = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;
import { CREDIT_COSTS, CreditCostKey, getPlanConfig } from './plans';
import { toJsonValue } from './typeUtils';

export function createCreditService(prisma: PrismaClient) {

  // ── Internal helper: update cached balance ─────────────────────────────────
  async function _updateBalance(tx: TxClient, orgId: string, delta: number) {
    await tx.org.update({
      where: { id: orgId },
      data: { creditBalance: { increment: delta } },
    });
  }

  // ── Grant monthly cycle credits (idempotent per invoiceId) ─────────────────
  async function grantCycleCredits(orgId: string, invoiceId: string): Promise<number> {
    const org = await prisma.org.findUniqueOrThrow({ where: { id: orgId } });
    const plan = getPlanConfig(org.plan);
    if (plan.credits <= 0) return 0;

    const key = `grant_cycle:${orgId}:${invoiceId}`;
    const cycleEnd = org.currentCycleEnd ?? new Date(Date.now() + 30 * 24 * 3600 * 1000);

    await prisma.$transaction(async (tx: TxClient) => {
      const existing = await tx.creditTransaction.findUnique({ where: { idempotencyKey: key } });
      if (existing) return; // already granted — idempotent

      await tx.creditTransaction.create({
        data: {
          orgId,
          type: 'grant_cycle',
          amount: plan.credits,
          unit: 'credits',
          reason: 'admin_adjust',
          refId: invoiceId,
          idempotencyKey: key,
          expiresAt: cycleEnd,
        },
      });
      await _updateBalance(tx, orgId, plan.credits);
    });

    return plan.credits;
  }

  // ── Grant daily free credits (idempotent per day) ──────────────────────────
  // Daily credits go into dailyCreditBalance — NEVER into the main creditBalance.
  // They expire at midnight and cannot accumulate.
  async function grantDailyCredits(orgId: string): Promise<number> {
    const org = await prisma.org.findUniqueOrThrow({ where: { id: orgId } });
    const plan = getPlanConfig(org.plan);
    if (plan.freeDailyCreditsPerDay <= 0) return 0;

    const todayStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const key = `daily_grant:${orgId}:${todayStr}`;

    // Check monthly cap
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const monthlySum = await prisma.creditTransaction.aggregate({
      where: { orgId, type: 'daily_grant', createdAt: { gte: monthStart } },
      _sum: { amount: true },
    });
    if (Number((monthlySum as { _sum?: { amount?: number | null } })?._sum?.amount ?? 0) >= plan.freeMonthlyCapCredits) return 0;

    const tomorrowMidnight = new Date(todayStr);
    tomorrowMidnight.setDate(tomorrowMidnight.getDate() + 1);

    await prisma.$transaction(async (tx: TxClient) => {
      const existing = await tx.creditTransaction.findUnique({ where: { idempotencyKey: key } });
      if (existing) return;

      await tx.creditTransaction.create({
        data: {
          orgId,
          type: 'daily_grant',
          amount: plan.freeDailyCreditsPerDay,
          unit: 'credits',
          reason: 'admin_adjust',
          idempotencyKey: key,
          expiresAt: tomorrowMidnight,
        },
      });

      // Reset daily bucket (no accumulation)
      await tx.org.update({
        where: { id: orgId },
        data: {
          dailyCreditBalance: plan.freeDailyCreditsPerDay,
          dailyCreditLastReset: new Date(),
        },
      });
    });

    return plan.freeDailyCreditsPerDay;
  }

  // ── Consume credits (atomic, idempotent) ──────────────────────────────────
  // Deducts from the correct bucket (daily vs main) based on plan.
  // Throws InsufficientCreditsError if balance too low.
  // Returns newBalance after deduction.
  async function consumeCredits(params: {
    orgId: string;
    jobId: string;                // unique job ID — used as part of idempotency key
    reason: CreditCostKey;
    useDaily?: boolean;           // override: force daily bucket
  }): Promise<{ newBalance: number; cost: number }> {
    const cost = CREDIT_COSTS[params.reason];
    const key  = `consume:${params.jobId}`;

    const result = await prisma.$transaction(async (tx: TxClient) => {
      // Idempotency — if we already deducted for this job, return current balance
      const existing = await tx.creditTransaction.findUnique({ where: { idempotencyKey: key } });
      if (existing) {
        const org = await tx.org.findUniqueOrThrow({ where: { id: params.orgId }, select: { creditBalance: true } });
        return { newBalance: org.creditBalance, cost };
      }

      const org = await tx.org.findUniqueOrThrow({
        where: { id: params.orgId },
        select: { creditBalance: true, dailyCreditBalance: true, plan: true },
      });

      const plan = getPlanConfig(org.plan);
      const useDaily = params.useDaily ?? plan.freeDailyCreditsPerDay > 0;

      if (useDaily) {
        if (org.dailyCreditBalance < cost) {
          throw new InsufficientCreditsError(cost, org.dailyCreditBalance, 'daily');
        }
        await tx.org.update({
          where: { id: params.orgId },
          data: { dailyCreditBalance: { decrement: cost } },
        });
        await tx.creditTransaction.create({
          data: {
            orgId: params.orgId,
            type: 'consume',
            amount: -cost,
            unit: 'credits',
            reason: params.reason,
            refId: params.jobId,
            idempotencyKey: key,
          },
        });
        const updated = await tx.org.findUniqueOrThrow({ where: { id: params.orgId }, select: { dailyCreditBalance: true } });
        return { newBalance: updated.dailyCreditBalance, cost };
      } else {
        if (org.creditBalance < cost) {
          throw new InsufficientCreditsError(cost, org.creditBalance, 'main');
        }
        await _updateBalance(tx, params.orgId, -cost);
        await tx.creditTransaction.create({
          data: {
            orgId: params.orgId,
            type: 'consume',
            amount: -cost,
            unit: 'credits',
            reason: params.reason,
            refId: params.jobId,
            idempotencyKey: key,
          },
        });
        const updated = await tx.org.findUniqueOrThrow({ where: { id: params.orgId }, select: { creditBalance: true } });
        return { newBalance: updated.creditBalance, cost };
      }
    });

    return result;
  }

  // ── Refund credits (idempotent) ────────────────────────────────────────────
  // Safe to call multiple times — second call is a no-op.
  async function refundCredits(params: {
    orgId: string;
    jobId: string;
    reason: CreditCostKey;
  }): Promise<void> {
    const cost = CREDIT_COSTS[params.reason];
    const key  = `refund:${params.jobId}`;

    await prisma.$transaction(async (tx: TxClient) => {
      const existing = await tx.creditTransaction.findUnique({ where: { idempotencyKey: key } });
      if (existing) return; // already refunded

      await tx.creditTransaction.create({
        data: {
          orgId: params.orgId,
          type: 'refund',
          amount: cost,
          unit: 'credits',
          reason: params.reason,
          refId: params.jobId,
          idempotencyKey: key,
        },
      });
      await _updateBalance(tx, params.orgId, cost);
    });
  }

  // ── Top-up (one-time Stripe purchase, idempotent per paymentIntentId) ──────
  async function topupCredits(params: {
    orgId: string;
    credits: number;
    stripePaymentIntentId: string;
    expiresAt?: Date;
  }): Promise<void> {
    const key = `topup:${params.stripePaymentIntentId}`;

    await prisma.$transaction(async (tx: TxClient) => {
      // Idempotency check FIRST — if already processed, skip balance update entirely
      const existing = await tx.creditTransaction.findUnique({ where: { idempotencyKey: key } });
      if (existing) return; // already applied — do NOT update balance again

      await tx.creditTransaction.create({
        data: {
          orgId: params.orgId,
          type: 'topup',
          amount: params.credits,
          unit: 'credits',
          reason: 'admin_adjust',
          refId: params.stripePaymentIntentId,
          idempotencyKey: key,
          expiresAt: params.expiresAt,
        },
      });
      await _updateBalance(tx, params.orgId, params.credits);
    });
  }

  // ── Soft rollover (Pro/Studio only) ───────────────────────────────────────
  // Called at the start of a new billing cycle, before grantCycleCredits.
  // Carries forward rolloverPct% of previous-cycle unused balance.
  async function processRollover(orgId: string, prevInvoiceId: string): Promise<number> {
    const org = await prisma.org.findUniqueOrThrow({ where: { id: orgId } });
    const plan = getPlanConfig(org.plan);
    if (plan.rolloverPct <= 0) return 0;

    const unused = Math.max(0, org.creditBalance);
    if (unused === 0) return 0;
    const rolloverAmount = Math.floor(unused * (plan.rolloverPct / 100));
    if (rolloverAmount === 0) return 0;

    const expireKey = `rollover_expire:${orgId}:${prevInvoiceId}`;
    const grantKey  = `rollover_grant:${orgId}:${prevInvoiceId}`;
    const nextCycleEnd = org.currentCycleEnd
      ? new Date(org.currentCycleEnd.getTime() + 30 * 24 * 3600 * 1000)
      : new Date(Date.now() + 60 * 24 * 3600 * 1000);

    await prisma.$transaction(async (tx: TxClient) => {
      const existingGrant = await tx.creditTransaction.findUnique({ where: { idempotencyKey: grantKey } });
      if (existingGrant) return; // already processed

      // Expire the old balance
      await tx.creditTransaction.create({
        data: {
          orgId, type: 'rollover_expire', amount: -unused, unit: 'credits',
          reason: 'admin_adjust', refId: prevInvoiceId, idempotencyKey: expireKey,
        },
      });
      // Grant the rollover amount with next-cycle expiry
      await tx.creditTransaction.create({
        data: {
          orgId, type: 'rollover_grant', amount: rolloverAmount, unit: 'credits',
          reason: 'admin_adjust', refId: prevInvoiceId, idempotencyKey: grantKey,
          expiresAt: nextCycleEnd,
        },
      });
      // Net effect: balance changes by (rolloverAmount - unused)
      await _updateBalance(tx, orgId, rolloverAmount - unused);
    });

    return rolloverAmount;
  }

  // ── Admin manual adjustment ────────────────────────────────────────────────
  async function adminAdjust(params: {
    orgId: string; amount: number; reasonNote: string; actorId: string;
  }): Promise<void> {
    const key = `adjustment:${params.orgId}:${params.actorId}:${Date.now()}`;
    await prisma.$transaction(async (tx: TxClient) => {
      await tx.creditTransaction.create({
        data: {
          orgId: params.orgId, type: 'adjustment', amount: params.amount,
          unit: 'credits', reason: 'admin_adjust', refId: params.actorId,
          idempotencyKey: key, metadata: toJsonValue({ note: params.reasonNote }),
        },
      });
      await _updateBalance(tx, params.orgId, params.amount);
      await tx.auditLog.create({
        data: {
          orgId: params.orgId, actorId: params.actorId, action: 'admin_adjust',
          targetType: 'credits', metadata: toJsonValue({ amount: params.amount, note: params.reasonNote }),
        },
      });
    });
  }

  // ── Reconcile: recompute cached balance from ledger ────────────────────────
  // Run this if you suspect drift. Returns the corrected balance.
  async function reconcileBalance(orgId: string): Promise<number> {
    const result = await prisma.$queryRaw`
      SELECT COALESCE(SUM(amount), 0) AS total
      FROM "CreditTransaction"
      WHERE "orgId" = ${orgId}
        AND ("expiresAt" IS NULL OR "expiresAt" > NOW())
    ` as Array<{ total: bigint }>;
    const correct = Number(result[0]?.total ?? 0);
    await prisma.org.update({ where: { id: orgId }, data: { creditBalance: correct } });
    return correct;
  }

  // ── Balance summary ────────────────────────────────────────────────────────
  async function getBalanceSummary(orgId: string) {
    const org = await prisma.org.findUniqueOrThrow({
      where: { id: orgId },
      select: {
        creditBalance: true, dailyCreditBalance: true, dailyCreditLastReset: true,
        currentCycleEnd: true, plan: true,
      },
    });
    const plan = getPlanConfig(org.plan);
    return {
      balance:        org.creditBalance,
      dailyBalance:   org.dailyCreditBalance,
      dailyLastReset: org.dailyCreditLastReset,
      cycleEndsAt:    org.currentCycleEnd,
      plan:           org.plan,
      planCredits:    plan.credits,
    };
  }

  // ── On-demand asset credit deduction (idempotent, flexible amount) ────────────
  // Used by the render pipeline for per-asset charges (not tied to a fixed CreditCostKey).
  // idempotencyKey is caller-supplied — typically `on_demand_asset:{jobId}:{assetId}`.
  async function deductCredits(
    orgId:           string,
    amount:          number,
    reason:          string,
    idempotencyKey:  string,
    metadata?:       Record<string, unknown>
  ): Promise<void> {
    if (amount <= 0) return;

    await prisma.$transaction(async (tx: TxClient) => {
      const existing = await tx.creditTransaction.findUnique({ where: { idempotencyKey } });
      if (existing) return; // already deducted — idempotent

      const org = await tx.org.findUniqueOrThrow({
        where: { id: orgId },
        select: { creditBalance: true },
      });
      if (org.creditBalance < amount) {
        throw new InsufficientCreditsError(amount, org.creditBalance, 'main');
      }
      await _updateBalance(tx, orgId, -amount);
      await tx.creditTransaction.create({
        data: {
          orgId,
          type:           'consume',
          amount:         -amount,
          unit:           'credits',
          reason:         'asset_on_demand',
          refId:          idempotencyKey,
          idempotencyKey,
          metadata:       toJsonValue(metadata ?? {}),
        },
      });
    });
  }

  // ── On-demand asset credit refund (idempotent, flexible amount) ────────────
  // Mirrors deductCredits — safe to call multiple times for same idempotencyKey.
  async function refundOnDemandCredits(
    orgId:           string,
    amount:          number,
    reason:          string,
    idempotencyKey:  string,
    metadata?:       Record<string, unknown>
  ): Promise<void> {
    if (amount <= 0) return;

    await prisma.$transaction(async (tx: TxClient) => {
      const existing = await tx.creditTransaction.findUnique({ where: { idempotencyKey } });
      if (existing) return; // already refunded — idempotent

      await _updateBalance(tx, orgId, amount);
      await tx.creditTransaction.create({
        data: {
          orgId,
          type:           'refund',
          amount,
          unit:           'credits',
          reason:         'asset_on_demand_refund',
          refId:          idempotencyKey,
          idempotencyKey,
          metadata:       toJsonValue(metadata ?? {}),
        },
      });
    });
  }

  return {
    grantCycleCredits,
    grantDailyCredits,
    consumeCredits,
    refundCredits,
    topupCredits,
    processRollover,
    adminAdjust,
    reconcileBalance,
    getBalanceSummary,
    deductCredits,
    refundOnDemandCredits,
  };
}

// ── Custom errors ──────────────────────────────────────────────────────────
export class InsufficientCreditsError extends Error {
  readonly code = 'INSUFFICIENT_CREDITS';
  readonly statusCode = 402;
  constructor(required: number, available: number, bucket: 'main' | 'daily' = 'main') {
    super(`Insufficient ${bucket} credits: need ${required}, have ${available}`);
    this.name = 'InsufficientCreditsError';
    
    
  }
}

export type CreditService = ReturnType<typeof createCreditService>;
