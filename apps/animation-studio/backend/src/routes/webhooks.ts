import { Router, Request, Response, NextFunction } from 'express';
import { handleStripeWebhook } from '../billing/billingService';
import { logger } from '../config/logger';

const router = Router();

// POST /api/webhooks/stripe — Must use raw body
router.post('/stripe', async (req: Request, res: Response, next: NextFunction) => {
  const signature = req.headers['stripe-signature'] as string;
  if (!signature) return res.status(400).json({ error: 'Missing stripe-signature header' });

  try {
    await handleStripeWebhook(req.body as Buffer, signature);
    res.json({ received: true });
  } catch (err: any) {
    logger.error('[Webhook] Stripe webhook error:', err.message);
    res.status(400).json({ error: err.message });
  }
});

export default router;
