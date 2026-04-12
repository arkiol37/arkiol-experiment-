// apps/arkiol-core/src/app/api/billing/paddle/webhook/route.ts
// V16 — Paddle webhook endpoint.
// Delegates ALL business logic to @arkiol/shared paddleWebhooks.
// This file is responsible ONLY for:
//   1. Provider-switch guard — returns 404 if BILLING_PROVIDER != paddle
//   2. HMAC-SHA256 signature verification (server-side, Paddle API key never exposed)
//   3. Idempotency check (stored event IDs in BillingEvent table)
//   4. Calling the shared handler and recording the result
//
// NO business logic, NO plan assignment, NO credit grants here.
// NO direct process.env usage — all config from validated env module.

import 'server-only';
import { detectCapabilities } from '@arkiol/shared';
import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { prisma } from '../../../../../lib/prisma';
import { handlePaddleEvent, getEnv, getActiveBillingProvider } from '@arkiol/shared';
import { billingUnavailable } from "../../../../../lib/error-handling";

export const dynamic = 'force-dynamic';
/**
 * Verify Paddle webhook signature (HMAC-SHA256).
 * Paddle sends: Paddle-Signature: ts=<timestamp>;h1=<hmac>
 * We compute: HMAC-SHA256(key=PADDLE_WEBHOOK_SECRET, data=ts:rawBody)
 */
function verifyPaddleSignature(rawBody: string, signatureHeader: string, secret: string): boolean {
  // Parse ts and h1 from header
  const parts: Record<string, string> = {};
  for (const part of signatureHeader.split(';')) {
    const [k, v] = part.split('=');
    if (k && v) parts[k.trim()] = v.trim();
  }
  const ts = parts['ts'];
  const h1 = parts['h1'];
  if (!ts || !h1) return false;

  // Paddle signs: "<timestamp>:<rawBody>"
  const signed   = `${ts}:${rawBody}`;
  const expected = crypto.createHmac('sha256', secret).update(signed).digest('hex');

  // Constant-time comparison to prevent timing attacks
  try {
    return crypto.timingSafeEqual(Buffer.from(h1, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  if (!detectCapabilities().billing) return billingUnavailable();

  // ── Provider-switch guard — inactive providers return 404 ─────────────────
  // Ensures Paddle endpoints are fully disabled when Stripe is active.
  if (getActiveBillingProvider() !== 'paddle') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Use validated env — never process.env directly
  const secret = getEnv().PADDLE_WEBHOOK_SECRET!; // guaranteed by validateSharedEnv when provider=paddle

  const rawBody = await req.text();
  const sigHeader = req.headers.get('paddle-signature') ?? '';

  // ── 1. HMAC-SHA256 signature verification ─────────────────────────────────
  if (!verifyPaddleSignature(rawBody, sigHeader, secret)) {
    console.warn('[paddle-webhook] Signature verification failed');
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  let event: any;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const eventId   = event?.event_id as string | undefined;
  const eventType = event?.event_type as string | undefined;

  if (!eventId || !eventType) {
    return NextResponse.json({ error: 'Missing event_id or event_type' }, { status: 400 });
  }

  // ── 2. Idempotency check — enforce exactly-once processing ────────────────
  const existing = await prisma.billingEvent.findUnique({ where: { stripeEvent: eventId } });
  if (existing?.processed) {
    return NextResponse.json({ received: true, skipped: 'already_processed' });
  }

  // Store event (upsert — safe for retries before first processing)
  await prisma.billingEvent.upsert({
    where:  { stripeEvent: eventId },
    create: {
      stripeEvent: eventId,
      orgId:       'system',
      type:        `paddle:${eventType}`,
      payload:     event,
      processed:   false,
    },
    update: {},
  });

  // ── 3. Delegate to shared handler ─────────────────────────────────────────
  try {
    await handlePaddleEvent(event, { prisma: prisma as any });
    await prisma.billingEvent.update({
      where: { stripeEvent: eventId },
      data:  { processed: true, processedAt: new Date() },
    });
    return NextResponse.json({ received: true, type: eventType });
  } catch (err: any) {
    console.error(`[paddle-webhook] Failed to process ${eventType}:`, err);
    await prisma.billingEvent.update({
      where: { stripeEvent: eventId },
      data:  { error: err.message },
    }).catch(() => {});
    // Return 500 so Paddle retries
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 });
  }
}
