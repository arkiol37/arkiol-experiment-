// apps/animation-studio/backend/src/billing/sharedCreditAdapter.ts
//
// REPLACES billingService credit functions for Animation Studio.
// All credit debit/refund operations go through the shared Prisma ledger.
// The old billingService.debitCredits / refundCredits MUST NOT be called.
//
// This adapter bridges the Studio's Knex-based DB access to the shared
// Prisma-based credit service by using a shared Prisma client pointed at
// the same DATABASE_URL.

import { PrismaClient } from '@prisma/client';
import {
  createCreditService,
  InsufficientCreditsError,
} from '@arkiol/shared';
import {
  studioRenderModeToCreditKey,
  preflightJob,
  OrgEnforcementSnapshot,
  getPlanConfig,
} from '@arkiol/shared';
import { db } from '../config/database';
import { logger } from '../config/logger';
import { AppError } from '../middleware/errorHandler';
import { config } from '../config/env';

// Singleton Prisma client for the shared credit operations.
// Points to the same DATABASE_URL as Knex — via validated config (never process.env).
let _prisma: PrismaClient | null = null;
function getSharedPrisma(): PrismaClient {
  if (!_prisma) {
    _prisma = new PrismaClient({
      datasources: { db: { url: config.DATABASE_URL } },
      log: ['error'],
    });
  }
  return _prisma;
}

// ── Load org enforcement snapshot from shared DB ─────────────────────────
async function loadOrgSnapshot(orgId: string): Promise<OrgEnforcementSnapshot> {
  const prisma = getSharedPrisma();
  const org = await prisma.org.findUniqueOrThrow({
    where: { id: orgId },
    select: {
      plan: true, creditBalance: true, dailyCreditBalance: true,
      subscriptionStatus: true, gracePeriodEndsAt: true,
      costProtectionBlocked: true,
    },
  });
  return {
    orgId,
    plan:                  org.plan,
    creditBalance:         org.creditBalance,
    dailyCreditBalance:    org.dailyCreditBalance,
    subscriptionStatus:    org.subscriptionStatus,
    gracePeriodEndsAt:     org.gracePeriodEndsAt,
    costProtectionBlocked: org.costProtectionBlocked ?? false,
  };
}

// ── Pre-flight check for a Studio render job ──────────────────────────────
// Replaces: enforceCreditsForRender() from old billingService
// Launch modes: Normal Ads (20cr) and Cinematic Ads (35cr). Free tier: 1 Normal Ad/day free.
export async function enforceStudioRenderCredits(params: {
  orgId:         string;
  renderMode:    string;   // 'Normal Ad' | 'Cinematic Ad' (also accepts legacy aliases)
  resolution?:   string;   // '1080p' | '4K'
  currentRunningJobs: number;
  todayVideoJobs: number;
}): Promise<void> {
  const reason = studioRenderModeToCreditKey(params.renderMode);
  const snap   = await loadOrgSnapshot(params.orgId);

  const result = preflightJob({
    org: snap,
    reason,
    currentRunning: params.currentRunningJobs,
    todayVideoJobs: params.todayVideoJobs,
    resolution: params.resolution,
  });

  if (!result.allowed) {
    // Map to AppError so Express error handler formats it correctly
    const status = (result as any).httpStatus ?? 403;
    throw new AppError(result.reason, status, (result as any).code);
  }
}

// ── Debit credits for a Studio render job ────────────────────────────────
// Replaces: debitCredits() from old billingService
export async function debitStudioCredits(params: {
  orgId:      string;
  renderJobId: string;
  renderMode: string;
}): Promise<void> {
  const prisma = getSharedPrisma();
  const svc    = createCreditService(prisma);
  const reason = studioRenderModeToCreditKey(params.renderMode);

  try {
    await svc.consumeCredits({
      orgId:  params.orgId,
      jobId:  params.renderJobId,
      reason,
    });
    logger.info({ orgId: params.orgId, jobId: params.renderJobId, reason }, '[studio-credits] debited');
  } catch (err) {
    if (err instanceof InsufficientCreditsError) {
      throw new AppError(err.message, 402, 'INSUFFICIENT_CREDITS');
    }
    throw err;
  }
}

// ── Refund credits for a failed Studio render job ────────────────────────
// Replaces: refundCredits() from old billingService
export async function refundStudioCredits(params: {
  orgId:      string;
  renderJobId: string;
  renderMode: string;
}): Promise<void> {
  const prisma = getSharedPrisma();
  const svc    = createCreditService(prisma);
  const reason = studioRenderModeToCreditKey(params.renderMode);

  try {
    await svc.refundCredits({
      orgId:  params.orgId,
      jobId:  params.renderJobId,
      reason,
    });
    logger.info({ orgId: params.orgId, jobId: params.renderJobId, reason }, '[studio-credits] refunded');
  } catch (err) {
    // Refunds should never crash the main flow — log and continue
    logger.error({ err, orgId: params.orgId, jobId: params.renderJobId }, '[studio-credits] refund failed');
  }
}

// ── Get credit balance for a Studio org ──────────────────────────────────
export async function getStudioOrgBalance(orgId: string): Promise<number> {
  const prisma = getSharedPrisma();
  const org = await prisma.org.findUniqueOrThrow({
    where: { id: orgId },
    select: { creditBalance: true },
  });
  return org.creditBalance;
}
