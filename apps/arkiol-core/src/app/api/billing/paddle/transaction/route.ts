// apps/arkiol-core/src/app/api/billing/paddle/transaction/route.ts
// V16 — Paddle transaction endpoint (backend, server-side only).
// Creates Paddle transactions server-side using PADDLE_API_KEY (never exposed client-side).
// Client receives only a transaction_id / checkout URL for Paddle.js to handle.
// Paddle checkout itself is driven by client-side Paddle.js with a client-side token.
// NO direct process.env usage — all config from validated env module.

import 'server-only';
import { detectCapabilities } from '@arkiol/shared';
import { getRequestUser, authOptions } from '../../../../../lib/auth';
import { NextRequest, NextResponse } from 'next/server';
import { prisma }           from '../../../../../lib/prisma';
import { rateLimit }        from '../../../../../lib/rate-limit';
import { z }                from 'zod';
import { billingUnavailable } from "../../../../../lib/error-handling";
import {
  PLANS, PlanKey,
  getActiveBillingProvider,
  getEnv,
} from '@arkiol/shared';

// Supported paddle plan keys
const PADDLE_PLAN_KEYS: PlanKey[] = ['CREATOR', 'PRO', 'STUDIO'];

const TransactionSchema = z.object({
  planKey:  z.enum(['CREATOR', 'PRO', 'STUDIO'] as const),
  mode:     z.enum(['sandbox', 'live']).default('live'),
});

function getPaddleApiKey(): string {
  const key = getEnv().PADDLE_API_KEY;
  if (!key) throw new Error('PADDLE_API_KEY is not configured (server-side)');
  return key;
}

function getPaddlePriceId(planKey: PlanKey): string {
  const env = getEnv();
  const map: Record<string, string | undefined> = {
    CREATOR: env.PADDLE_PRICE_CREATOR,
    PRO:     env.PADDLE_PRICE_PRO,
    STUDIO:  env.PADDLE_PRICE_STUDIO,
  };
  const id = map[planKey];
  if (!id) throw new Error(`No Paddle price configured for plan ${planKey}`);
  return id;
}

function getPaddleApiBase(mode: 'sandbox' | 'live'): string {
  return mode === 'sandbox'
    ? 'https://sandbox-api.paddle.com'
    : 'https://api.paddle.com';
}

// ── POST /api/billing/paddle/transaction ──────────────────────────────────────
export async function POST(req: NextRequest) {
  if (!detectCapabilities().billing) return billingUnavailable();

  try {
    const _ru = await getRequestUser(req).catch(() => null);
  const session = _ru ? { user: { id: _ru.id, email: _ru.email, orgId: _ru.orgId, role: _ru.role } } : null;
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Verify Paddle is the active provider
    if (getActiveBillingProvider() !== 'paddle') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const rl = await rateLimit(session.user.id, 'billing');
    if (!rl.success) {
      return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
    }

    const body   = await req.json().catch(() => ({}));
    const parsed = TransactionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
    }
    const { planKey, mode } = parsed.data;

    const user = await prisma.user.findUnique({
      where:   { id: session.user.id },
      include: { org: true },
    });
    if (!user?.org) {
      return NextResponse.json({ error: 'No organization found' }, { status: 400 });
    }

    const priceId  = getPaddlePriceId(planKey);
    const apiKey   = getPaddleApiKey();
    const apiBase  = getPaddleApiBase(mode);
    const planCfg  = PLANS[planKey];

    // Build Paddle transaction payload (server-side Paddle API call)
    const arkiolEnv = getEnv();
    const transactionPayload = {
      items: [
        {
          price_id: priceId,
          quantity: 1,
        },
      ],
      customer_id: user.org.paddleCustomerId ?? undefined,
      custom_data: {
        orgId:   user.org.id,
        userId:  user.id,
        planKey,
      },
      // Return URL after checkout completes
      checkout: {
        url: arkiolEnv.NEXTAUTH_URL
          ? `${arkiolEnv.NEXTAUTH_URL}/dashboard?billing=success`
          : undefined,
      },
    };

    // Server-side Paddle API call (PADDLE_API_KEY never leaves server)
    const paddleRes = await fetch(`${apiBase}/transactions`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(transactionPayload),
    });

    if (!paddleRes.ok) {
      const errText = await paddleRes.text().catch(() => '');
      console.error(`[paddle-transaction] Paddle API error: ${paddleRes.status} ${errText}`);
      return NextResponse.json({ error: 'Failed to create Paddle transaction' }, { status: 502 });
    }

    const paddleData = await paddleRes.json();
    const transactionId   = paddleData?.data?.id as string | undefined;
    const checkoutUrl     = paddleData?.data?.checkout?.url as string | undefined;

    if (!transactionId) {
      return NextResponse.json({ error: 'Paddle did not return a transaction ID' }, { status: 502 });
    }

    // Store paddle customer ID if we got one back
    if (paddleData?.data?.customer_id && !user.org.paddleCustomerId) {
      await prisma.org.update({
        where: { id: user.org.id },
        data:  { paddleCustomerId: paddleData.data.customer_id },
      }).catch(() => {});
    }

    return NextResponse.json({
      transactionId,
      checkoutUrl,
      planKey,
      priceId,
      // Client-side token for Paddle.js inline checkout (NOT the API key)
      clientToken: getEnv().PADDLE_CLIENT_TOKEN,
      environment: mode,
    });

  } catch (err: any) {
    console.error('[paddle-transaction] Error:', err.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
