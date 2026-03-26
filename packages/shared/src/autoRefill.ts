// packages/shared/src/autoRefill.ts
// AUTO-REFILL SERVICE — checklist §4.7
// Charges the org's Stripe payment method when balance drops below threshold.
// Idempotent: uses a daily refill key to prevent double-charging.
// On Stripe failure: disables auto-refill + notifies owner.

import Stripe from 'stripe';
import { PrismaClient } from '@prisma/client';
import { getTopupPack, getTopupStripePriceId } from './plans';
import { createCreditService } from './credits';

export type AutoRefillDeps = {
  prisma: PrismaClient;
  stripe: Stripe;
  sendEmail?: (p: { to: string; subject: string; text: string }) => Promise<void>;
};

// ── Process auto-refill for all eligible orgs ──────────────────────────────
// Called by cron job every 5–15 minutes.
export async function processAutoRefill(deps: AutoRefillDeps): Promise<{ triggered: number; failed: number }> {
  const { prisma, stripe, sendEmail } = deps;
  const credits = createCreditService(prisma);

  const candidates = await prisma.org.findMany({
    where: {
      autoRefillEnabled: true,
      refillThreshold:   { not: null },
      refillPackId:      { not: null },
      stripeCustomerId:  { not: null },
      subscriptionStatus: { in: ['ACTIVE' as any, 'TRIALING' as any] },
    },
    select: {
      id: true, creditBalance: true, refillThreshold: true,
      refillPackId: true, stripeCustomerId: true, currentCycleEnd: true,
    },
  });

  let triggered = 0;
  let failed    = 0;

  for (const org of candidates) {
    const balance   = org.creditBalance ?? 0;
    const threshold = org.refillThreshold ?? 0;
    if (balance >= threshold) continue;

    const packId = org.refillPackId!;
    const pack   = getTopupPack(packId);
    if (!pack) {
      console.error(`[auto-refill] org ${org.id}: unknown packId ${packId}`);
      continue;
    }

    // Idempotency: allow only one auto-refill per org per calendar day
    const todayStr = new Date().toISOString().slice(0, 10);
    const idempKey = `autorefill:${org.id}:${todayStr}:${packId}`;

    // Check if already refilled today
    const alreadyDone = await (prisma as any).creditTransaction.findFirst({
      where: {
        orgId: org.id,
        type: 'topup',
        idempotencyKey: { contains: `autorefill:${org.id}:${todayStr}` },
      },
    });
    if (alreadyDone) continue;

    try {
      // Create a PaymentIntent against the customer's default payment method
      // The pack's priceCents is the authoritative amount — no placeholder
      const intent = await stripe.paymentIntents.create({
        amount:   pack.priceCents,        // e.g. 900 for $9.00 (100 credits)
        currency: 'usd',
        customer: org.stripeCustomerId!,
        // Use the customer's saved default payment method
        payment_method: await getDefaultPaymentMethod(stripe, org.stripeCustomerId!),
        confirm:        true,
        off_session:    true,
        metadata: {
          orgId:           org.id,
          packId,
          credits:         pack.credits.toString(),
          type:            'auto_refill',
          idempotencyKey:  idempKey,
        },
      });

      if (intent.status === 'succeeded') {
        // Credit the org's account via the shared ledger
        const expiresAt = org.currentCycleEnd ?? undefined;
        await credits.topupCredits({
          orgId:                org.id,
          credits:              pack.credits,
          stripePaymentIntentId: intent.id,
          expiresAt,
        });

        await (prisma as any).auditLog.create({
          data: {
            orgId: org.id, actorId: 'system', action: 'credit_refill',
            metadata: { packId, credits: pack.credits, paymentIntentId: intent.id, trigger: 'auto_refill' },
          },
        });
        triggered++;
        console.info(`[auto-refill] org ${org.id}: +${pack.credits} credits (${pack.name})`);
      }

    } catch (err: any) {
      failed++;
      console.error(`[auto-refill] org ${org.id} FAILED: ${err.message}`);

      // Disable auto-refill to prevent repeated failed charge attempts
      await prisma.org.update({
        where: { id: org.id },
        data:  { autoRefillEnabled: false },
      });

      // Notify owner
      if (sendEmail) {
        const owner = await prisma.user.findFirst({
          where:  { orgId: org.id, role: { in: ['ADMIN' as any, 'SUPER_ADMIN' as any] } },
          select: { email: true },
        });
        if (owner) {
          await sendEmail({
            to:      owner.email,
            subject: 'Arkiol: Auto-refill failed',
            text: [
              `Your Arkiol auto-refill for the ${pack.name} pack could not be processed.`,
              `Reason: ${err.message}`,
              `Auto-refill has been disabled to prevent further failed charges.`,
              `Please visit https://app.arkiol.com/settings?tab=billing to update your payment method and re-enable auto-refill.`,
            ].join('\n\n'),
          }).catch(() => {});
        }
      }
    }
  }

  return { triggered, failed };
}

// ── Create a Stripe Checkout session for a one-time top-up purchase ─────────
// Called from the billing UI when user clicks "Buy credits".
export async function createTopupCheckoutSession(params: {
  orgId:      string;
  packId:     string;
  customerId: string;
  successUrl: string;
  cancelUrl:  string;
  stripe:     Stripe;
}): Promise<string> {
  const { packId, customerId, successUrl, cancelUrl, stripe, orgId } = params;

  const pack = getTopupPack(packId);
  if (!pack) throw new Error(`Unknown pack ID: ${packId}`);

  const priceId = getTopupStripePriceId(packId);

  let sessionParams: Stripe.Checkout.SessionCreateParams;

  if (priceId) {
    // Use a pre-configured Stripe Price (recommended: set up in Stripe Dashboard)
    sessionParams = {
      customer:              customerId,
      payment_method_types:  ['card'],
      line_items:            [{ price: priceId, quantity: 1 }],
      mode:                  'payment',
      success_url:           `${successUrl}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:            cancelUrl,
      metadata:              { orgId, packId, type: 'topup' },
    };
  } else {
    // Fallback: create ad-hoc price on the fly (works without pre-configured Stripe Prices)
    sessionParams = {
      customer:             customerId,
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency:     'usd',
          unit_amount:  pack.priceCents,  // canonical amount from TOPUP_PACKS
          product_data: {
            name:        pack.name,
            description: `${pack.credits} credits for Arkiol`,
          },
        },
        quantity: 1,
      }],
      mode:        'payment',
      success_url: `${successUrl}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  cancelUrl,
      metadata:    { orgId, packId, type: 'topup' },
    };
  }

  const session = await stripe.checkout.sessions.create(sessionParams);
  return session.url!;
}

// ── Helper: get default payment method for a customer ─────────────────────
async function getDefaultPaymentMethod(stripe: Stripe, customerId: string): Promise<string> {
  const customer = await stripe.customers.retrieve(customerId) as Stripe.Customer;
  const defaultPM = customer.invoice_settings?.default_payment_method;
  if (typeof defaultPM === 'string') return defaultPM;
  if (defaultPM && typeof defaultPM === 'object') return defaultPM.id;

  // Fallback: list payment methods
  const pms = await stripe.paymentMethods.list({ customer: customerId, type: 'card', limit: 1 });
  if (pms.data.length > 0) return pms.data[0].id;

  throw new Error('No payment method on file. Please add a card in billing settings.');
}
