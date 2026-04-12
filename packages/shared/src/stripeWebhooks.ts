// packages/shared/src/stripeWebhooks.ts
// UNIFIED STRIPE WEBHOOK HANDLER — checklist §5
// Used by BOTH apps. All billing state changes happen here, nowhere else.
// Idempotent: every Stripe event stored + processed exactly once.
// Retry-safe: throws on processing failure so Stripe retries.
// All env access via getEnv() — no direct process.env.

import Stripe from 'stripe';
import { PrismaClient } from '@prisma/client';
import {
  getPlanConfig, PLANS, PlanKey, resolvePlan,
  getTopupPack, getTopupStripePriceId,
} from './plans';
import { createCreditService } from './credits';
import { createAuditLogger } from './auditLogger';
import { getEnv } from './env';
import { toJsonValue } from './typeUtils';

export type WebhookDeps = {
  prisma: PrismaClient;
  stripe: Stripe;
  sendEmail?: (p: { to: string; subject: string; text: string }) => Promise<void>;
};

// Apply all feature flags from a plan to an Org update payload
function planFlagUpdates(planKey: string) {
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

// ── Sandbox/live mode guard ────────────────────────────────────────────────
// Prevents cross-environment event acceptance: a live-mode key must only
// accept live events; a test-mode key must only accept test events.
function assertStripeModeConsistency(event: Stripe.Event): void {
  const key = getEnv().STRIPE_SECRET_KEY;
  const isLiveKey = key?.startsWith('sk_live_');
  const isTestKey = key?.startsWith('sk_test_');
  const eventLive: boolean = 'livemode' in event && (event as unknown as Record<string, unknown>).livemode === true;
  if (isLiveKey && !eventLive) {
    throw new Error(
      `Stripe mode mismatch: STRIPE_SECRET_KEY is live-mode but received test-mode event ${event.id}. ` +
      'Configure a separate STRIPE_WEBHOOK_SECRET for each environment.'
    );
  }
  if (isTestKey && eventLive) {
    throw new Error(
      `Stripe mode mismatch: STRIPE_SECRET_KEY is test-mode but received live-mode event ${event.id}. ` +
      'Ensure your Stripe webhook is pointed at the correct environment endpoint.'
    );
  }
  if (!isLiveKey && !isTestKey) {
    console.warn('[stripe-webhook] STRIPE_SECRET_KEY has unexpected prefix — skipping mode check');
  }
}

// Resolve plan key from a Stripe Price ID
// Checks all STRIPE_PRICE_* env vars at call time (not import time).
// Legacy aliases (STARTER, ENTERPRISE) are intentionally removed — all
// price-ID mappings must be explicit to prevent accidental mis-routing.
function planFromPriceId(priceId: string): PlanKey | null {
  const e = getEnv();
  const candidates: Array<[string | undefined, PlanKey]> = [
    [e.STRIPE_PRICE_CREATOR, 'CREATOR'],
    [e.STRIPE_PRICE_PRO,     'PRO'],
    [e.STRIPE_PRICE_STUDIO,  'STUDIO'],
  ];
  for (const [envPriceId, plan] of candidates) {
    if (envPriceId && envPriceId === priceId) return plan;
  }
  return null;
}

async function findOrgByCustomer(prisma: PrismaClient, customerId: string) {
  return prisma.org.findFirst({ where: { stripeCustomerId: customerId } });
}

export async function handleStripeEvent(event: Stripe.Event, deps: WebhookDeps): Promise<void> {
  const { prisma, stripe, sendEmail } = deps;
  const credits    = createCreditService(prisma);
  const auditSvc   = createAuditLogger(prisma);

  // ── Sandbox/live consistency guard ──────────────────────────────────────
  // Must run before any DB mutations so cross-environment events are rejected.
  assertStripeModeConsistency(event);

  switch (event.type) {

    // ── Subscription created ───────────────────────────────────────────────
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const sub = event.data.object as unknown as Stripe.Subscription;
      const org = await findOrgByCustomer(prisma, sub.customer as string);
      if (!org) break;

      const priceId = sub.items.data[0]?.price.id ?? '';
      const planKey = planFromPriceId(priceId) ?? resolvePlan(sub.metadata?.plan ?? 'FREE');
      const planCfg = getPlanConfig(planKey);

      // Grace period on past_due
      let gracePeriodEndsAt: Date | null = org.gracePeriodEndsAt;
      if (sub.status === 'past_due' && !gracePeriodEndsAt) {
        gracePeriodEndsAt = new Date(Date.now() + 5 * 24 * 3600 * 1000);
      } else if (sub.status === 'active') {
        gracePeriodEndsAt = null;
      }

      await prisma.org.update({
        where: { id: org.id },
        data: {
          plan:                 planKey,
          stripeSubscriptionId: sub.id,
          stripePriceId:        priceId,
          subscriptionStatus:   sub.status.toUpperCase() as 'ACTIVE' | 'TRIALING' | 'PAST_DUE' | 'CANCELED' | 'UNPAID' | 'INCOMPLETE',
          billingCycleAnchor:   new Date(sub.billing_cycle_anchor * 1000),
          currentCycleStart:    new Date(sub.current_period_start * 1000),
          currentCycleEnd:      new Date(sub.current_period_end * 1000),
          monthlyPriceUsd:      planCfg.priceUsd,
          gracePeriodEndsAt,
          ...planFlagUpdates(planKey),
        },
      });

      await prisma.auditLog.create({
        data: {
          orgId: org.id, actorId: 'stripe', action: 'plan_change',
          targetType: 'subscription',
          metadata: toJsonValue({ plan: planKey, status: sub.status, event: event.type }),
        },
      });
      break;
    }

    // ── Subscription deleted ───────────────────────────────────────────────
    case 'customer.subscription.deleted': {
      const sub = event.data.object as unknown as Stripe.Subscription;
      const org = await findOrgByCustomer(prisma, sub.customer as string);
      if (!org) break;

      await prisma.org.update({
        where: { id: org.id },
        data: {
          plan:               'FREE',
          subscriptionStatus: 'CANCELED',
          gracePeriodEndsAt:  null,
          stripeSubscriptionId: null,
          ...planFlagUpdates('FREE'),
        },
      });

      await prisma.auditLog.create({
        data: { orgId: org.id, actorId: 'stripe', action: 'plan_change', metadata: toJsonValue({ plan: 'FREE', event: event.type }) },
      });
      break;
    }

    // ── Invoice paid → grant monthly credits + process rollover ────────────
    case 'invoice.paid': {
      const invoice = event.data.object as unknown as Stripe.Invoice;
      const org = await findOrgByCustomer(prisma, invoice.customer as string);
      if (!org) break;

      if (!('subscription' in invoice) || !(invoice as unknown as Record<string, unknown>).subscription) break; // skip one-time invoices (handled by checkout.session.completed)

      // 1. Process rollover from previous cycle before granting new credits
      if (org.subscriptionStatus === 'ACTIVE') {
        await credits.processRollover(org.id, `prev:${invoice.id}`).catch(() => {});
      }

      // 2. Grant cycle credits (idempotent per invoice.id)
      const granted = await credits.grantCycleCredits(org.id, invoice.id);

      // 3. Clear past_due state and reset daily spend
      await prisma.org.update({
        where: { id: org.id },
        data: {
          subscriptionStatus:    'ACTIVE',
          gracePeriodEndsAt:     null,
          dailySpendUsd:         0,
          dailySpendDate:        new Date(),
          costProtectionBlocked: false,
          currentCycleStart:     new Date(((invoice as unknown as Record<string, number>).period_start) * 1000),
          currentCycleEnd:       new Date(((invoice as unknown as Record<string, number>).period_end) * 1000),
        },
      });

      console.info(`[stripe-webhook] invoice.paid: +${granted} credits to org ${org.id}`);
      break;
    }

    // ── Invoice payment failed ─────────────────────────────────────────────
    case 'invoice.payment_failed': {
      const invoice = event.data.object as unknown as Stripe.Invoice;
      const org = await findOrgByCustomer(prisma, invoice.customer as string);
      if (!org) break;

      const gracePeriodEndsAt = new Date(Date.now() + 5 * 24 * 3600 * 1000);
      await prisma.org.update({
        where: { id: org.id },
        data: { subscriptionStatus: 'PAST_DUE', gracePeriodEndsAt },
      });

      // Audit: billing payment failed (Task #9)
      await auditSvc.logBillingEvent({
        orgId: org.id, actorId: 'stripe',
        action: 'billing.payment_failed',
        stripeEventId: event.id,
        amount: (invoice.amount_due ?? 0),
        currency: invoice.currency ?? 'usd',
      }).catch(() => {});

      // Audit: grace period started
      await auditSvc.logPlanChange({
        orgId: org.id, actorId: 'stripe',
        action: 'plan.grace_period_started',
        stripeEventId: event.id,
      }).catch(() => {});

      if (sendEmail) {
        const owner = await prisma.user.findFirst({
          where: { orgId: org.id, role: { in: ['ADMIN', 'SUPER_ADMIN'] } },
          select: { email: true },
        });
        if (owner) {
          await sendEmail({
            to: owner.email,
            subject: 'Arkiol: Payment failed — action required',
            text: `Your Arkiol payment failed. You have a 5-day grace period. Please update your billing details at https://app.arkiol.com/settings?tab=billing`,
          }).catch(() => {});
        }
      }
      break;
    }

    // ── Checkout session completed (top-up purchase) ───────────────────────
    // checklist §4.6 / §5.2
    case 'checkout.session.completed': {
      const session = event.data.object as unknown as Stripe.Checkout.Session;
      if (session.mode !== 'payment') break; // subscriptions handled by invoice.paid

      const org = await findOrgByCustomer(prisma, session.customer as string);
      if (!org) break;

      const packId = session.metadata?.packId;
      if (!packId) break;

      const pack = getTopupPack(packId);
      if (!pack) {
        console.error(`[stripe-webhook] Unknown pack ID in checkout metadata: ${packId}`);
        break;
      }

      // expiresAt = end of current billing cycle
      const expiresAt = org.currentCycleEnd ?? undefined;
      const paymentIntentId = session.payment_intent as string;

      await credits.topupCredits({
        orgId: org.id,
        credits: pack.credits,
        stripePaymentIntentId: paymentIntentId,
        expiresAt,
      });

      await prisma.auditLog.create({
        data: {
          orgId: org.id, actorId: 'stripe', action: 'credit_refill',
          metadata: toJsonValue({ packId, credits: pack.credits, paymentIntentId }),
        },
      });
      break;
    }

    default:
      // Unhandled events are silently accepted (200 OK) — Stripe won't retry
      break;
  }
}
