// apps/arkiol-core/src/app/api/billing/webhook/route.ts
// Delegates to @arkiol/shared stripeWebhooks — do NOT add business logic here.
// Provider-switch guard: returns 404 when BILLING_PROVIDER != stripe.
// NO direct process.env usage — all config from validated env module.

import 'server-only';
import { detectCapabilities } from '@arkiol/shared';
import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { prisma } from '../../../../lib/prisma';
import { handleStripeEvent, getEnv, getActiveBillingProvider } from '@arkiol/shared';
import { billingUnavailable } from "../../../../lib/error-handling";

export const dynamic = 'force-dynamic';
function getStripe(): Stripe {
  const key = getEnv().STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY is not configured');
  return new Stripe(key, { apiVersion: '2024-04-10', typescript: true });
}

export async function POST(req: NextRequest) {
  if (!detectCapabilities().billing) return billingUnavailable();

  // ── Provider-switch guard — inactive providers return 404 ─────────────────
  // Ensures Stripe endpoints are fully disabled when Paddle is active.
  if (getActiveBillingProvider() !== 'stripe') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const env    = getEnv();
  const sig    = req.headers.get('stripe-signature') ?? '';
  const secret = env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: 'Webhook not configured' }, { status: 503 });

  let event: Stripe.Event;
  try {
    const rawBody = await req.text();
    event = getStripe().webhooks.constructEvent(rawBody, sig, secret);
  } catch (err: any) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  const existing = await prisma.billingEvent.findUnique({ where: { stripeEvent: event.id } });
  if (existing?.processed) return NextResponse.json({ received: true, skipped: 'already processed' });

  await prisma.billingEvent.upsert({
    where:  { stripeEvent: event.id },
    create: { stripeEvent: event.id, orgId: 'system', type: event.type, payload: event as any, processed: false },
    update: {},
  });

  try {
    await handleStripeEvent(event, { prisma: prisma as any, stripe: getStripe() });
    await prisma.billingEvent.update({
      where: { stripeEvent: event.id },
      data:  { processed: true, processedAt: new Date() },
    });
    return NextResponse.json({ received: true, type: event.type });
  } catch (err: any) {
    console.error(`[stripe-webhook] Failed to process ${event.type}:`, err);
    await prisma.billingEvent.update({ where: { stripeEvent: event.id }, data: { error: err.message } }).catch(() => {});
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 });
  }
}

