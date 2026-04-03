// apps/animation-studio/backend/src/billing/arkiolCreditsBridge.ts
// Animation Studio credit bridge.
// All credit operations go through @arkiol/shared credit ledger (Org.creditBalance).
//
// Launch credit costs (imported from shared — no local definitions):
//   Normal Ad (2D):       20 credits  → reason: 'normal_ad'  / 'video_std'
//   Cinematic Ad (2.5D):  35 credits  → reason: 'cinematic_ad' / 'video_hq'
//   FREE tier:            1 free Normal Ad/day (watermarked, no deduction)

import { db } from '../config/database';
import { logger } from '../config/logger';
import { CREDIT_COSTS } from '@arkiol/shared';

// Studio reason keys — use canonical names from shared
export type StudioReason = 'normal_ad' | 'cinematic_ad' | 'video_std' | 'video_hq' | 'gif' | 'export_zip';

// Consume credits from shared Arkiol ledger (Org.creditBalance)
export async function consumeStudioCredits(params: {
  orgId: string;
  jobId: string;
  reason: StudioReason;
}): Promise<void> {
  const cost = CREDIT_COSTS[params.reason as keyof typeof CREDIT_COSTS] ?? CREDIT_COSTS.normal_ad;
  const key  = `consume:${params.jobId}`;

  await db.transaction(async (trx) => {
    // Idempotency
    const existing = await trx('CreditTransaction').where({ idempotencyKey: key }).first();
    if (existing) return;

    const org = await trx('Org').where({ id: params.orgId }).select('creditBalance').forUpdate().first();
    if (!org) throw new Error(`Org ${params.orgId} not found`);
    if (org.creditBalance < cost) throw new Error(`Insufficient credits: need ${cost}, have ${org.creditBalance}`);

    await trx('Org').where({ id: params.orgId }).decrement('creditBalance', cost);
    await trx('CreditTransaction').insert({
      id: crypto.randomUUID(),
      orgId: params.orgId,
      type: 'consume',
      amount: -cost,
      unit: 'credits',
      reason: params.reason,
      refId: params.jobId,
      idempotencyKey: key,
      createdAt: new Date(),
    });
  });

  logger.info({ orgId: params.orgId, jobId: params.jobId, cost, reason: params.reason }, 'Studio credits consumed');
}

// Refund credits to shared ledger
export async function refundStudioCreditsToLedger(params: {
  orgId: string;
  jobId: string;
  reason: StudioReason;
}): Promise<void> {
  const cost = CREDIT_COSTS[params.reason as keyof typeof CREDIT_COSTS] ?? CREDIT_COSTS.normal_ad;
  const key  = `refund:${params.jobId}`;

  await db.transaction(async (trx) => {
    const existing = await trx('CreditTransaction').where({ idempotencyKey: key }).first();
    if (existing) return;

    await trx('Org').where({ id: params.orgId }).increment('creditBalance', cost);
    await trx('CreditTransaction').insert({
      id: crypto.randomUUID(),
      orgId: params.orgId,
      type: 'refund',
      amount: cost,
      unit: 'credits',
      reason: params.reason,
      refId: params.jobId,
      idempotencyKey: key,
      createdAt: new Date(),
    });
  });

  logger.info({ orgId: params.orgId, jobId: params.jobId, cost, reason: params.reason }, 'Studio credits refunded');
}

// Get org credit balance (read from shared Org table)
export async function getOrgBalance(orgId: string): Promise<number> {
  const org = await db('Org').where({ id: orgId }).select('creditBalance').first();
  return org?.creditBalance ?? 0;
}
