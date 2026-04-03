// apps/animation-studio/backend/src/billing/billingService.ts
//
// BILLING SERVICE — Animation Studio
//
// IMPORTANT: All plan definitions and credit costs are imported from
// @arkiol/shared (packages/shared/src/plans.ts) — the single source of truth.
// No credit values or plan names are defined locally here.
//
// Launch configuration:
//   • Normal Ads  (2D):      20 credits per generation
//   • Cinematic Ads (2.5D):  35 credits per generation
//   • FREE tier:             1 free watermarked Normal Ad per day (no credits deducted)
//
// Credit operations (debit/refund) are delegated to sharedCreditAdapter.ts,
// which uses the shared Prisma ledger. The local debitCredits/refundCredits
// functions must NOT be called — use debitStudioCredits/refundStudioCredits instead.

import Stripe from 'stripe';
import { db } from '../config/database';
import { config } from '../config/env';
import { logger } from '../config/logger';
import { AppError } from '../middleware/errorHandler';
import { auditLog } from '../services/auditService';
import { sendEmail } from '../services/emailService';
import {
  PLANS,
  CREDIT_COSTS,
  getPlanConfig,
  resolvePlan,
  getSubscriptionStripePriceId,
  TOPUP_PACKS,
  getTopupPack,
  type PlanKey,
} from '@arkiol/shared';

const stripe = new Stripe(config.STRIPE_SECRET_KEY, { apiVersion: '2024-04-10' });

// ── Re-export canonical definitions for callers that import from here ─────────
// These are the shared values — NOT locally defined.
export { PLANS, CREDIT_COSTS, getPlanConfig, resolvePlan };
export type { PlanKey };

// ── GPU cost estimation (for margin alerting only — not billing) ──────────────
// Maps launch render modes to estimated GPU cost per scene.
export function estimateGpuCost(renderMode: string, scenes: number): number {
  // GPU cost per scene by render mode. Legacy aliases kept for existing DB job records.
  const costPerScene: Record<string, number> = {
    'Normal Ad':        0.50,   // 2D  — launch mode
    'Cinematic Ad':     2.50,   // 2.5D — launch mode
    '2D Standard':      0.50,   // legacy alias → Normal Ad
    '2D Extended':      0.50,   // legacy alias → Normal Ad
    'Premium Cinematic':2.50,   // legacy alias → Cinematic Ad
  };
  return (costPerScene[renderMode] ?? 0.50) * scenes;
}

// ── Revenue estimation (for margin alerting only) ─────────────────────────────
export function estimateRevenue(credits: number, plan: string): number {
  const resolved = resolvePlan(plan);
  const priceUsd = PLANS[resolved]?.priceUsd ?? 0;
  if (priceUsd <= 0) return 0;
  const monthlyCredits = PLANS[resolved]?.credits ?? 1;
  const ratePerCredit = monthlyCredits > 0 ? priceUsd / monthlyCredits : 0;
  return credits * ratePerCredit;
}

// ── Create Stripe customer ─────────────────────────────────────────────────────
export async function createStripeCustomer(params: {
  workspaceId: string;
  email: string;
  name: string;
}) {
  const customer = await stripe.customers.create({
    email: params.email,
    name: params.name,
    metadata: { workspace_id: params.workspaceId },
  });

  await db('workspaces').where({ id: params.workspaceId }).update({ stripe_customer_id: customer.id });
  return customer;
}

// ── Get or create Stripe customer ─────────────────────────────────────────────
async function getOrCreateStripeCustomer(workspaceId: string) {
  const workspace = await db('workspaces').where({ id: workspaceId }).first();
  if (!workspace) throw new AppError('Workspace not found', 404);

  if (workspace.stripe_customer_id) {
    return stripe.customers.retrieve(workspace.stripe_customer_id);
  }

  const owner = await db('users as u')
    .join('workspace_members as wm', 'u.id', 'wm.user_id')
    .where({ 'wm.workspace_id': workspaceId, 'wm.role': 'owner' })
    .first();

  return createStripeCustomer({
    workspaceId,
    email: owner?.email || 'unknown@animationstudio.ai',
    name: workspace.name,
  });
}

// ── Create checkout session ────────────────────────────────────────────────────
// Plan keys: 'creator' | 'pro' | 'studio' (canonical — no legacy scale/enterprise)
export async function createCheckoutSession(params: {
  workspaceId: string;
  plan: 'creator' | 'pro' | 'studio';
  period: 'monthly' | 'yearly';
  successUrl: string;
  cancelUrl: string;
}) {
  const customer = await getOrCreateStripeCustomer(params.workspaceId);
  const planKey = resolvePlan(params.plan) as PlanKey;
  const priceId = getSubscriptionStripePriceId(planKey);

  if (!priceId) {
    throw new AppError(`No Stripe price configured for plan: ${params.plan}/${params.period}`, 400);
  }

  const session = await stripe.checkout.sessions.create({
    customer: typeof customer === 'string' ? customer : customer.id,
    payment_method_types: ['card'],
    line_items: [{ price: priceId, quantity: 1 }],
    mode: 'subscription',
    success_url: `${params.successUrl}?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: params.cancelUrl,
    metadata: { workspace_id: params.workspaceId, plan: planKey },
    subscription_data: {
      metadata: { workspace_id: params.workspaceId, plan: planKey },
    },
    allow_promotion_codes: true,
  });

  await auditLog({
    workspaceId: params.workspaceId,
    action: 'billing.checkout_started',
    after: { plan: planKey, period: params.period },
  });

  return session;
}

// ── Create billing portal ──────────────────────────────────────────────────────
export async function createPortalSession(workspaceId: string, returnUrl: string) {
  const workspace = await db('workspaces').where({ id: workspaceId }).first();
  if (!workspace?.stripe_customer_id) throw new AppError('No billing account found', 404);

  const session = await stripe.billingPortal.sessions.create({
    customer: workspace.stripe_customer_id,
    return_url: returnUrl,
  });

  return session;
}

// ── Purchase credit top-up pack ───────────────────────────────────────────────
// Uses canonical TOPUP_PACKS from @arkiol/shared — no local pack definitions.
export async function purchaseTopupPack(params: {
  workspaceId: string;
  packId: string;   // e.g. 'pack_100', 'pack_500', 'pack_2000'
  successUrl: string;
  cancelUrl: string;
}) {
  const pack = getTopupPack(params.packId);
  if (!pack) throw new AppError(`Unknown top-up pack: ${params.packId}`, 400);

  const customer = await getOrCreateStripeCustomer(params.workspaceId);

  const session = await stripe.checkout.sessions.create({
    customer: typeof customer === 'string' ? customer : customer.id,
    payment_method_types: ['card'],
    line_items: [{
      price_data: {
        currency: 'usd',
        product_data: { name: `Arkiol Studio ${pack.name}` },
        unit_amount: pack.priceCents,
      },
      quantity: 1,
    }],
    mode: 'payment',
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
    metadata: {
      workspace_id: params.workspaceId,
      credits: pack.credits.toString(),
      pack_id: params.packId,
      type: 'credit_pack',
    },
  });

  return session;
}

// ── Handle Stripe webhook ──────────────────────────────────────────────────────
// IMPORTANT: All business logic is delegated to @arkiol/shared handleStripeEvent.
// This file only handles signature verification and idempotency storage.
export async function handleStripeWebhook(rawBody: Buffer, signature: string) {
  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, config.STRIPE_WEBHOOK_SECRET);
  } catch (err: any) {
    logger.error('[Stripe] Webhook signature verification failed:', err.message);
    throw new AppError('Invalid webhook signature', 400);
  }

  // Idempotency check
  const existing = await db('billing_events').where({ stripe_event_id: event.id }).first();
  if (existing) {
    logger.info(`[Stripe] Duplicate webhook ignored: ${event.id}`);
    return;
  }

  await db('billing_events').insert({
    stripe_event_id: event.id,
    stripe_object_id: (event.data.object as any).id,
    event_type: event.type,
    payload: JSON.stringify(event.data.object),
  });

  logger.info(`[Stripe] Webhook received: ${event.type} — delegating to @arkiol/shared`);

  const { handleStripeEvent } = await import('@arkiol/shared');
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient({ datasources: { db: { url: config.DATABASE_URL } }, log: ['error'] });
  try {
    await handleStripeEvent(event, { prisma: prisma as any, stripe });
    logger.info(`[Stripe] Webhook processed: ${event.type}`);
  } finally {
    await prisma.$disconnect();
  }
}

export { stripe };
