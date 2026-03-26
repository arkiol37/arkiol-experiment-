// packages/shared/src/billingProvider.ts
// V16: BillingProvider abstraction — BILLING_PROVIDER=paddle|stripe switch
// Shared plans, credits ledger, cost protection, and concurrency enforcement
// remain the SINGLE SOURCE OF TRUTH regardless of which provider is active.
// Server-side only — never import in browser bundles.
// All env access via getEnv() — no direct process.env.

import { PrismaClient }   from '@prisma/client';
import { PlanKey, getPlanConfig, resolvePlan, PLANS } from './plans';
import { createCreditService } from './credits';
import { createAuditLogger }   from './auditLogger';
import { getEnv } from './env';

// ── Provider type ──────────────────────────────────────────────────────────────
export type BillingProviderName = 'stripe' | 'paddle';

export function getActiveBillingProvider(): BillingProviderName {
  const p = (getEnv().BILLING_PROVIDER ?? 'paddle').toLowerCase();
  if (p === 'stripe') return 'stripe';
  return 'paddle'; // default to paddle for any other value
}

// ── Paddle price-ID → PlanKey mapping ────────────────────────────────────────
export function paddlePlanFromPriceId(priceId: string): PlanKey | null {
  const env = getEnv();
  const candidates: Array<[string | undefined, PlanKey]> = [
    [env.PADDLE_PRICE_CREATOR, 'CREATOR'],
    [env.PADDLE_PRICE_PRO,     'PRO'],
    [env.PADDLE_PRICE_STUDIO,  'STUDIO'],
  ];
  for (const [envId, plan] of candidates) {
    if (envId && envId === priceId) return plan;
  }
  return null;
}

// ── Plan flag updates helper (shared by both providers) ──────────────────────
export function planFlagUpdates(planKey: PlanKey | string) {
  const p = getPlanConfig(planKey);
  return {
    canUseStudioVideo:    p.canUseStudioVideo,
    canUseGifMotion:      p.canUseGifMotion,
    canBatchGenerate:     p.canBatchGenerate,
    canUseZipExport:      p.canUseZipExport,
    canUseAutomation:     p.canUseAutomation,
    maxConcurrency:       p.maxConcurrency,
    queuePriority:        p.queuePriority,
    maxDailyVideoJobs:    p.maxDailyVideoJobs,
    maxFormatsPerRun:     p.maxFormatsPerRun,
    maxVariationsPerRun:  p.maxVariationsPerRun,
    maxExportResolution:  p.maxExportResolution,
    freeWatermarkEnabled: p.freeWatermarkEnabled,
    freeDailyCreditsPerDay: p.freeDailyCreditsPerDay,
    freeMonthlyCapCredits:  p.freeMonthlyCapCredits,
  };
}

// ── Canonical plan provisioning — used by BOTH Paddle and Stripe handlers ────
// This is the ONLY place plan assignment, credit grants, downgrades, and
// cancellations are executed. Neither webhook module contains any business logic.
export async function provisionPlanChange(
  prisma: PrismaClient,
  orgId: string,
  planKey: PlanKey,
  opts: {
    subscriptionId?:   string;
    priceId?:          string;
    cycleStart?:       Date;
    cycleEnd?:         Date;
    status?:           string;
    invoiceId?:        string;
    auditActor?:       string;
    provider:          BillingProviderName;
  }
): Promise<void> {
  const credits  = createCreditService(prisma);
  const auditSvc = createAuditLogger(prisma);
  const planCfg  = getPlanConfig(planKey);

  const updateData: Record<string, unknown> = {
    plan:             planKey,
    subscriptionStatus: (opts.status ?? 'ACTIVE') as any,
    ...planFlagUpdates(planKey),
  };

  if (opts.subscriptionId) {
    if (opts.provider === 'paddle') {
      updateData.paddleSubscriptionId = opts.subscriptionId;
    } else {
      updateData.stripeSubscriptionId = opts.subscriptionId;
    }
  }
  if (opts.priceId)    updateData[opts.provider === 'paddle' ? 'paddlePriceId' : 'stripePriceId'] = opts.priceId;
  if (opts.cycleStart) updateData.currentCycleStart = opts.cycleStart;
  if (opts.cycleEnd)   updateData.currentCycleEnd   = opts.cycleEnd;
  if (planCfg.priceUsd) updateData.monthlyPriceUsd  = planCfg.priceUsd;

  await prisma.org.update({ where: { id: orgId }, data: updateData });

  // Grant monthly credits via shared ledger (idempotent)
  if (opts.invoiceId && planCfg.credits > 0) {
    await credits.grantCycleCredits(orgId, opts.invoiceId);
  }

  // Audit log
  await auditSvc.log({
    orgId,
    actor:  opts.auditActor ?? 'billing-webhook',
    action: `billing.plan_provisioned.${opts.provider}`,
    target: orgId,
    meta:   { planKey, provider: opts.provider, subscriptionId: opts.subscriptionId },
  });
}

export async function provisionCancellation(
  prisma: PrismaClient,
  orgId: string,
  opts: { provider: BillingProviderName; subscriptionId?: string; auditActor?: string }
): Promise<void> {
  const auditSvc = createAuditLogger(prisma);
  const freePlan = planFlagUpdates('FREE');

  await prisma.org.update({
    where: { id: orgId },
    data: {
      plan:                'FREE',
      subscriptionStatus:  'CANCELED',
      stripeSubscriptionId: opts.provider === 'stripe' ? null : undefined,
      paddleSubscriptionId: opts.provider === 'paddle' ? null : undefined,
      creditBalance: 0,
      ...freePlan,
    },
  });

  await auditSvc.log({
    orgId,
    actor:  opts.auditActor ?? 'billing-webhook',
    action: `billing.subscription_cancelled.${opts.provider}`,
    target: orgId,
    meta:   { provider: opts.provider, subscriptionId: opts.subscriptionId },
  });
}
