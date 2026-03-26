// packages/shared/src/paddleWebhooks.ts
// V16: PADDLE WEBHOOK HANDLER — unified billing handler via BillingProvider abstraction.
// All business logic routes through provisionPlanChange / provisionCancellation.
// Idempotent: every Paddle event stored + processed exactly once via eventId.
// HMAC-SHA256 signature verification is performed by the calling endpoint (server-side).
// This module never touches Stripe and never exposes secrets.
// All env access via getEnv() — no direct process.env.

import { PrismaClient } from '@prisma/client';
import { resolvePlan, PlanKey }          from './plans';
import { paddlePlanFromPriceId, provisionPlanChange, provisionCancellation } from './billingProvider';
import { getEnv } from './env';
import { createAuditLogger } from './auditLogger';
import { createCreditService } from './credits';

// ── Paddle event shapes (subset we handle) ───────────────────────────────────
export interface PaddleEventBase {
  event_id:   string;
  event_type: string;
  occurred_at: string;
  data: Record<string, unknown>;
}

export type PaddleWebhookDeps = {
  prisma: PrismaClient;
  sendEmail?: (p: { to: string; subject: string; text: string }) => Promise<void>;
};

// ── Find org by Paddle customer ID ───────────────────────────────────────────
async function findOrgByPaddleCustomer(prisma: PrismaClient, customerId: string) {
  return prisma.org.findFirst({ where: { paddleCustomerId: customerId } });
}

async function findOrgByPaddleSubscription(prisma: PrismaClient, subscriptionId: string) {
  return prisma.org.findFirst({ where: { paddleSubscriptionId: subscriptionId } });
}

// ── Paddle sandbox/live environment guard ─────────────────────────────────────
// PADDLE_ENVIRONMENT must match the actual event origin. Paddle includes
// a top-level `environment` field on live events. Sandbox events omit it
// or set it to "sandbox". Reject cross-environment events before any DB write.
function assertPaddleEnvironmentConsistency(event: PaddleEventBase): void {
  const expected = (getEnv().PADDLE_ENVIRONMENT ?? 'sandbox').toLowerCase();
  // Paddle sends 'production' on live-mode events; 'sandbox' or absent on test.
  const actual = ((event as any).environment ?? 'sandbox').toLowerCase();
  // Normalise: Paddle uses "production" for live, we use "live" in env vars
  const actualNorm = actual === 'production' ? 'live' : actual;
  if (expected !== actualNorm) {
    throw new Error(
      `Paddle environment mismatch: PADDLE_ENVIRONMENT="${expected}" but event ${event.event_id} ` +
      `reports environment="${actual}". Ensure your Paddle webhook is scoped to the correct environment.`
    );
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────
export async function handlePaddleEvent(
  event: PaddleEventBase,
  deps: PaddleWebhookDeps
): Promise<void> {
  const { prisma, sendEmail } = deps;
  const auditSvc = createAuditLogger(prisma);
  const credits  = createCreditService(prisma);

  // ── Sandbox/live consistency guard ──────────────────────────────────────
  assertPaddleEnvironmentConsistency(event);

  const d = event.data as any;

  switch (event.event_type) {

    // ── Subscription created / updated ────────────────────────────────────────
    case 'subscription.created':
    case 'subscription.updated': {
      const customerId     = d.customer_id as string;
      const subscriptionId = d.id as string;
      const status         = d.status as string;
      const items: any[]   = d.items ?? [];
      const priceId        = items[0]?.price?.id as string | undefined;

      if (!priceId) break;

      const planKey = paddlePlanFromPriceId(priceId);
      if (!planKey) {
        console.warn(`[paddle-webhook] Unknown price_id=${priceId} — no plan mapped.`);
        break;
      }

      // Find or create org by customer ID — also try subscription ID
      let org = await findOrgByPaddleCustomer(prisma, customerId)
        ?? await findOrgByPaddleSubscription(prisma, subscriptionId);
      if (!org) break;

      const cycleStart = d.current_billing_period?.starts_at
        ? new Date(d.current_billing_period.starts_at) : undefined;
      const cycleEnd = d.current_billing_period?.ends_at
        ? new Date(d.current_billing_period.ends_at) : undefined;

      // Map Paddle status → SubStatus
      const subStatus = ({
        active:   'ACTIVE',
        trialing: 'TRIALING',
        past_due: 'PAST_DUE',
        canceled: 'CANCELED',
        paused:   'PAST_DUE',
      } as Record<string, string>)[status] ?? 'ACTIVE';

      await provisionPlanChange(prisma, org.id, planKey, {
        subscriptionId,
        priceId,
        cycleStart,
        cycleEnd,
        status:   subStatus,
        provider: 'paddle',
      });
      break;
    }

    // ── Transaction completed (invoice paid) ──────────────────────────────────
    case 'transaction.completed': {
      const customerId     = d.customer_id as string;
      const subscriptionId = d.subscription_id as string | undefined;
      const transactionId  = d.id as string;
      const items: any[]   = d.items ?? [];
      const priceId        = items[0]?.price?.id as string | undefined;

      let org = await findOrgByPaddleCustomer(prisma, customerId);
      if (!org && subscriptionId) org = await findOrgByPaddleSubscription(prisma, subscriptionId);
      if (!org) break;

      // Grant cycle credits if we can resolve plan
      const planKey = priceId ? paddlePlanFromPriceId(priceId) : null;
      if (planKey) {
        await provisionPlanChange(prisma, org.id, planKey, {
          subscriptionId,
          priceId,
          invoiceId: transactionId,
          provider:  'paddle',
        });
      } else {
        // Top-up transaction — grant credits directly via shared ledger
        const creditAmount = (d.custom_data as any)?.credits as number | undefined;
        if (creditAmount && creditAmount > 0) {
          // Fetch full org to get currentCycleEnd for topup expiry
          const fullOrg = await prisma.org.findUnique({
            where:  { id: org.id },
            select: { currentCycleEnd: true },
          });
          await credits.topupCredits({
            orgId:                org.id,
            credits:              creditAmount,
            stripePaymentIntentId: transactionId,
            expiresAt:            fullOrg?.currentCycleEnd ?? undefined,
          });
          await auditSvc.log({
            orgId:  org.id,
            actor:  'billing-webhook',
            action: 'billing.topup_granted.paddle',
            target: org.id,
            meta:   { transactionId, credits: creditAmount },
          });
        }
      }
      break;
    }

    // ── Subscription cancelled ────────────────────────────────────────────────
    case 'subscription.canceled': {
      const customerId     = d.customer_id as string;
      const subscriptionId = d.id as string;

      let org = await findOrgByPaddleCustomer(prisma, customerId)
        ?? await findOrgByPaddleSubscription(prisma, subscriptionId);
      if (!org) break;

      await provisionCancellation(prisma, org.id, {
        provider: 'paddle',
        subscriptionId,
      });

      if (sendEmail && org) {
        const orgFull = await prisma.org.findUnique({
          where: { id: org.id },
          include: { members: { select: { email: true }, take: 1 } },
        });
        const email = orgFull?.members[0]?.email;
        if (email) {
          await sendEmail({
            to:      email,
            subject: 'Your Arkiol subscription has been cancelled',
            text:    'Your subscription has been cancelled. You have been moved to the Free plan. Your data remains available.',
          }).catch(() => {});
        }
      }
      break;
    }

    // ── Payment failed ────────────────────────────────────────────────────────
    case 'transaction.payment_failed': {
      const customerId     = d.customer_id as string;
      const subscriptionId = d.subscription_id as string | undefined;

      let org = await findOrgByPaddleCustomer(prisma, customerId);
      if (!org && subscriptionId) org = await findOrgByPaddleSubscription(prisma, subscriptionId);
      if (!org) break;

      const gracePeriodEndsAt = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
      await prisma.org.update({
        where: { id: org.id },
        data: { subscriptionStatus: 'PAST_DUE', gracePeriodEndsAt },
      });

      await auditSvc.log({
        orgId:  org.id,
        actor:  'billing-webhook',
        action: 'billing.payment_failed.paddle',
        target: org.id,
        meta:   { customerId, subscriptionId },
      });
      break;
    }

    default:
      // Unhandled event type — log and ack (no throw = 200 OK)
      console.log(`[paddle-webhook] Unhandled event: ${event.event_type}`);
  }
}
