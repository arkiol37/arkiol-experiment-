import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/authMiddleware';
import * as billingService from '../billing/billingService';
import { db } from '../config/database';
// All configuration via validated env module — no direct process.env.
import { config } from '../config/env';
// v12 fix: use canonical plan + credit definitions from shared package
import { PLANS as SHARED_PLANS, CREDIT_COSTS as SHARED_CREDIT_COSTS } from '@arkiol/shared';

const router = Router();

// Stripe webhooks (raw body, no auth)
import webhookRouter from './webhooks';

router.use(authenticate);

// GET /api/billing/plans
// Returns canonical plan definitions from @arkiol/shared (single source of truth).
// Previously returned billingService.PLANS which had stale local values (free=3cr, pro=100cr, scale=500cr).
router.get('/plans', (req: Request, res: Response) => {
  res.json({ plans: SHARED_PLANS, creditCosts: SHARED_CREDIT_COSTS });
});

// GET /api/billing/usage
router.get('/usage', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const workspace = await db('workspaces').where({ id: req.user!.workspaceId }).first();
    if (!workspace) return res.status(404).json({ error: 'Workspace not found' });

    const transactions = await db('credit_transactions')
      .where({ workspace_id: req.user!.workspaceId })
      .orderBy('created_at', 'desc')
      .limit(50);

    res.json({
      plan: workspace.plan,
      creditsBalance: workspace.credits_balance,
      creditsUsedThisPeriod: workspace.credits_used_this_period,
      creditsResetAt: workspace.credits_reset_at,
      subscriptionStatus: workspace.subscription_status,
      subscriptionEndsAt: workspace.subscription_ends_at,
      storageUsedBytes: workspace.storage_used_bytes,
      storageLimitBytes: workspace.storage_limit_bytes,
      transactions,
    });
  } catch (err) { next(err); }
});

// POST /api/billing/checkout
router.post('/checkout', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { plan, period } = z.object({
      plan: z.enum(['creator', 'pro', 'studio']),  // v12: canonical plan keys (removed stale 'scale')
      period: z.enum(['monthly', 'yearly']),
    }).parse(req.body);

    const session = await billingService.createCheckoutSession({
      workspaceId: req.user!.workspaceId!,
      plan,
      period,
      successUrl: `${config.FRONTEND_URL}/billing/success`,
      cancelUrl: `${config.FRONTEND_URL}/pricing`,
    });

    res.json({ url: session.url });
  } catch (err) { next(err); }
});

// POST /api/billing/portal
router.post('/portal', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = await billingService.createPortalSession(
      req.user!.workspaceId!,
      `${config.FRONTEND_URL}/settings/billing`
    );
    res.json({ url: session.url });
  } catch (err) { next(err); }
});

// POST /api/billing/credit-pack
router.post('/credit-pack', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { packSize } = z.object({ packSize: z.union([z.literal(25), z.literal(100), z.literal(500)]) }).parse(req.body);
    const session = await billingService.purchaseOveragePack({
      workspaceId: req.user!.workspaceId!,
      packSize,
      successUrl: `${config.FRONTEND_URL}/billing/credits-success`,
      cancelUrl: `${config.FRONTEND_URL}/settings/billing`,
    });
    res.json({ url: session.url });
  } catch (err) { next(err); }
});

// GET /api/billing/invoices
router.get('/invoices', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const workspace = await db('workspaces').where({ id: req.user!.workspaceId }).first();
    if (!workspace?.stripe_customer_id) return res.json({ invoices: [] });

    const invoices = await billingService.stripe.invoices.list({
      customer: workspace.stripe_customer_id,
      limit: 20,
    });

    res.json({ invoices: invoices.data.map(inv => ({
      id: inv.id,
      amount: inv.amount_paid / 100,
      currency: inv.currency,
      status: inv.status,
      date: new Date(inv.created * 1000),
      url: inv.hosted_invoice_url,
      pdf: inv.invoice_pdf,
    }))});
  } catch (err) { next(err); }
});

export default router;
