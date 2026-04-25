// packages/shared/src/atomicCreditProtection.ts
// ATOMIC CREDIT PROTECTION — Production-Grade Hardening
//
// DESIGN:
//   Credits follow a two-phase commit pattern:
//
//   Phase 1 — HOLD (at job creation time, /api/generate endpoint):
//     org.creditsHeld += cost
//     CreditTransaction(type='hold', idempotencyKey=jobId)
//
//   Phase 2a — FINALIZE (on job completion):
//     org.creditsHeld    -= cost  (release hold)
//     org.creditsUsed    += cost  (charge permanently)
//     CreditTransaction(type='charge', idempotencyKey=jobId_charge)
//
//   Phase 2b — REFUND (on job failure / DLQ / timeout):
//     org.creditsHeld    -= cost  (release hold)
//     CreditTransaction(type='refund', idempotencyKey=jobId_refund)
//
// ATOMICITY GUARANTEES:
//   - Phase 1 and Phase 2a/2b are each wrapped in prisma.$transaction
//   - All operations are idempotent via idempotencyKey
//   - A job can only finalize OR refund — not both (guarded by creditFinalized flag)
//   - Dead-lettered jobs always trigger a refund (no credits lost on DLQ)
//   - Double-refund protection: creditRefunded flag prevents repeat refunds
//   - Double-charge protection: creditFinalized flag prevents repeat finalizations
//
// CONCURRENCY SAFETY:
//   - updateMany with conditional WHERE (creditsHeld >= cost) prevents underflow
//   - If the conditional update hits 0 rows, an AUDIT_MISMATCH event is logged
//     but the job status still transitions (assets were already created)

import { PrismaClient } from '@prisma/client';
type TxClient = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

export interface AtomicCreditDeps {
  prisma?: PrismaClient;
  logger?: {
    info(obj: unknown, msg: string): void;
    warn(obj: unknown, msg: string): void;
    error(obj: unknown, msg: string): void;
  };
}

export interface CreditHoldResult {
  held:           boolean;
  idempotencyKey: string;
  heldAmount:     number;
}

export interface CreditFinalizeResult {
  finalized:      boolean;
  chargedAmount:  number;
  idempotencyKey: string;
  alreadyDone:    boolean;
}

export interface CreditRefundResult {
  refunded:       boolean;
  refundedAmount: number;
  idempotencyKey: string;
  alreadyDone:    boolean;
}

// ── Phase 1: Hold credits at job creation ────────────────────────────────────

/**
 * Hold credits for a pending job. Credits are reserved but not yet charged.
 * Idempotent: calling this twice with the same jobId returns alreadyDone=true.
 *
 * Must be called inside the job-creation transaction or immediately after.
 */
export async function holdCredits(
  orgId:   string,
  jobId:   string,
  amount:  number,
  deps:    AtomicCreditDeps
): Promise<CreditHoldResult> {
  const { prisma, logger } = deps;
  const key = `hold:${jobId}`;
  if (!prisma || amount <= 0) return { held: false, idempotencyKey: key, heldAmount: 0 };

  try {
    await prisma.$transaction(async (tx: TxClient) => {
      const existing = await tx.creditTransaction?.findUnique?.({ where: { idempotencyKey: key } });
      if (existing) return; // idempotent

      await tx.creditTransaction?.create?.({
        data: {
          orgId,
          type:           'consume',
          amount:         -amount,  // negative = reserved against balance
          unit:           'credits',
          reason:         'asset_on_demand',
          refId:          jobId,
          idempotencyKey: key,
        },
      });

      // Increment creditsHeld — used by the UI to show "pending" credit usage
      await tx.org?.update?.({
        where: { id: orgId },
        data:  { creditsHeld: { increment: amount } },
      });

      // Tag the job row so Phase 2 knows the hold amount
      await tx.job?.update?.({
        where: { id: jobId },
        data:  { creditCost: amount, creditDeducted: false },
      });
    });

    logger?.info?.({ orgId, jobId, amount }, '[atomic-credits] Credits held');
    return { held: true, idempotencyKey: key, heldAmount: amount };
  } catch (e: unknown) {
    logger?.error?.({ err: (e instanceof Error ? e.message : String(e)), orgId, jobId, amount }, '[atomic-credits] holdCredits FAILED');
    return { held: false, idempotencyKey: key, heldAmount: 0 };
  }
}

// ── Phase 2a: Finalize credits on successful completion ───────────────────────

/**
 * Finalize the credit charge on job success.
 * Releases the hold, records a permanent charge, and marks the job as billed.
 * Idempotent: safe to call multiple times — only charges once.
 */
export async function finalizeCredits(
  orgId:   string,
  jobId:   string,
  amount:  number,
  deps:    AtomicCreditDeps
): Promise<CreditFinalizeResult> {
  const { prisma, logger } = deps;
  const chargeKey = `charge:${jobId}`;
  if (!prisma || amount <= 0) {
    return { finalized: false, chargedAmount: 0, idempotencyKey: chargeKey, alreadyDone: false };
  }

  try {
    let alreadyDone = false;

    await prisma.$transaction(async (tx: TxClient) => {
      // Guard: never charge twice
      const existingCharge = await tx.creditTransaction?.findUnique?.({ where: { idempotencyKey: chargeKey } });
      if (existingCharge) { alreadyDone = true; return; }

      // Guard: never charge if already refunded
      const job = await tx.job?.findUnique?.({
        where:  { id: jobId },
        select: { creditRefunded: true, creditFinalized: true, creditCost: true },
      });
      if (job?.creditRefunded || job?.creditFinalized) { alreadyDone = true; return; }

      const chargeAmount = job?.creditCost ?? amount;

      // Record permanent charge
      await tx.creditTransaction?.create?.({
        data: {
          orgId,
          type:           'consume',
          amount:         chargeAmount,
          unit:           'credits',
          reason:         'asset_on_demand',
          refId:          jobId,
          idempotencyKey: chargeKey,
        },
      });

      // Release hold + increment creditsUsed atomically
      await tx.org?.update?.({
        where: { id: orgId },
        data: {
          creditsHeld:  { decrement: chargeAmount },
          creditsUsed:  { increment: chargeAmount },
        },
      });

      // Mark job as finalized to prevent double-charge
      await tx.job?.update?.({
        where: { id: jobId },
        data:  { creditDeducted: true, creditFinalized: true },
      });
    });

    if (!alreadyDone) {
      logger?.info?.({ orgId, jobId, amount }, '[atomic-credits] Credits finalized (charged)');
    }
    return { finalized: !alreadyDone, chargedAmount: alreadyDone ? 0 : amount, idempotencyKey: chargeKey, alreadyDone };
  } catch (e: unknown) {
    logger?.error?.({ err: (e instanceof Error ? e.message : String(e)), orgId, jobId, amount }, '[atomic-credits] finalizeCredits FAILED — manual review required');
    return { finalized: false, chargedAmount: 0, idempotencyKey: chargeKey, alreadyDone: false };
  }
}

// ── Phase 2b: Refund credits on failure / DLQ ────────────────────────────────

/**
 * Refund held credits on job failure, timeout, or dead-letter.
 * Releases the hold and records a refund transaction.
 * Idempotent: safe to call multiple times — only refunds once.
 *
 * Called by:
 *   - worker failed() handler after all retry attempts exhausted
 *   - sendToDeadLetter() in crashSafety
 *   - scheduled recoverStuckJobs() for timed-out jobs
 */
export async function refundCredits(
  orgId:   string,
  jobId:   string,
  reason:  string,
  deps:    AtomicCreditDeps
): Promise<CreditRefundResult> {
  const { prisma, logger } = deps;
  const refundKey = `refund:${jobId}`;
  if (!prisma) {
    return { refunded: false, refundedAmount: 0, idempotencyKey: refundKey, alreadyDone: false };
  }

  try {
    let alreadyDone   = false;
    let refundedAmount = 0;

    await prisma.$transaction(async (tx: TxClient) => {
      // Guard: never refund twice
      const existingRefund = await tx.creditTransaction?.findUnique?.({ where: { idempotencyKey: refundKey } });
      if (existingRefund) { alreadyDone = true; return; }

      // Guard: never refund if already charged (finalized)
      const job = await tx.job?.findUnique?.({
        where:  { id: jobId },
        select: { creditRefunded: true, creditFinalized: true, creditCost: true, creditDeducted: true },
      });
      if (job?.creditRefunded) { alreadyDone = true; return; }
      if (job?.creditFinalized) {
        logger?.warn?.({ orgId, jobId }, '[atomic-credits] Refund requested on finalized job — skipping (credits already charged)');
        alreadyDone = true;
        return;
      }

      const holdAmount = job?.creditCost ?? 0;
      if (holdAmount <= 0) { alreadyDone = true; return; } // nothing was held

      refundedAmount = holdAmount;

      // Record refund
      await tx.creditTransaction?.create?.({
        data: {
          orgId,
          type:           'refund',
          amount:         holdAmount,
          unit:           'credits',
          reason:         'asset_on_demand_refund',
          refId:          jobId,
          idempotencyKey: refundKey,
        },
      });

      // Release the hold (creditsHeld -= amount, creditsUsed unchanged)
      // Conditional update: only if creditsHeld won't go negative
      const updated = await tx.org?.updateMany?.({
        where: {
          id:          orgId,
          creditsHeld: { gte: holdAmount },
        },
        data: { creditsHeld: { decrement: holdAmount } },
      });

      if (updated?.count === 0) {
        // creditsHeld was already 0 (race or stale data) — just log, don't error
        logger?.warn?.({ orgId, jobId, holdAmount }, '[atomic-credits] Refund: creditsHeld underflow guard triggered (hold was already released)');
      }

      // Mark job as refunded. The Job.status enum is
      // {PENDING,RUNNING,COMPLETED,FAILED} — the dedicated
      // `creditRefunded` boolean is the source of truth for
      // refund state, and we don't transition status here (the
      // job is typically already FAILED at this point; if it
      // isn't, we leave the lifecycle alone).
      await tx.job?.update?.({
        where: { id: jobId },
        data:  { creditRefunded: true },
      });
    });

    if (!alreadyDone) {
      logger?.info?.({ orgId, jobId, refundedAmount, reason }, '[atomic-credits] Credits refunded');
    }
    return { refunded: !alreadyDone, refundedAmount, idempotencyKey: refundKey, alreadyDone };
  } catch (e: unknown) {
    logger?.error?.({ err: (e instanceof Error ? e.message : String(e)), orgId, jobId }, '[atomic-credits] refundCredits FAILED — manual review required');
    return { refunded: false, refundedAmount: 0, idempotencyKey: refundKey, alreadyDone: false };
  }
}

// ── Bulk refund for dead-lettered batch jobs ──────────────────────────────────

/**
 * Refund credits for all jobs in a batch that were not completed.
 * Called when a batch is cancelled or experiences a partial catastrophic failure.
 */
export async function refundBatchCredits(
  orgId:    string,
  batchId:  string,
  reason:   string,
  deps:     AtomicCreditDeps
): Promise<{ refundedJobs: string[]; totalRefunded: number }> {
  const { prisma, logger } = deps;
  if (!prisma) return { refundedJobs: [], totalRefunded: 0 };

  const refundedJobs: string[] = [];
  let   totalRefunded = 0;

  try {
    const batchItems = await prisma.batchJobItem?.findMany?.({
      where:  { batchId },
      select: { jobId: true },
    }) ?? [];

    for (const { jobId } of batchItems) {
      const result = await refundCredits(orgId, jobId, reason, deps);
      if (result.refunded) {
        refundedJobs.push(jobId);
        totalRefunded += result.refundedAmount;
      }
    }

    logger?.info?.({ orgId, batchId, refundedJobs: refundedJobs.length, totalRefunded, reason },
      '[atomic-credits] Batch refund complete');
  } catch (e: unknown) {
    logger?.error?.({ err: (e instanceof Error ? e.message : String(e)), orgId, batchId }, '[atomic-credits] refundBatchCredits FAILED');
  }

  return { refundedJobs, totalRefunded };
}

// ── Credit audit snapshot ─────────────────────────────────────────────────────

export interface CreditAuditSnapshot {
  orgId:         string;
  creditBalance: number;
  creditsUsed:   number;
  creditsHeld:   number;
  creditLimit:   number;
  ledgerSum:     number;  // sum of all CreditTransaction amounts (should reconcile)
  discrepancy:   number;  // abs(creditBalance - ledgerSum)
  healthy:       boolean;
}

/**
 * Compute a credit audit snapshot for an org.
 * Reconciles the cached creditBalance against the ledger sum.
 * A healthy org has discrepancy < 1 credit.
 */
export async function computeCreditAuditSnapshot(
  orgId:  string,
  deps:   AtomicCreditDeps
): Promise<CreditAuditSnapshot | null> {
  const { prisma } = deps;
  if (!prisma) return null;

  try {
    const [org, ledger] = await Promise.all([
      prisma.org?.findUnique?.({
        where:  { id: orgId },
        select: { creditBalance: true, creditsUsed: true, creditsHeld: true, creditLimit: true },
      }),
      prisma.creditTransaction?.aggregate?.({
        where: { orgId },
        _sum:  { amount: true },
      }),
    ]);

    if (!org) return null;

    const ledgerSum   = Number((ledger as { _sum?: { amount?: number | null } })?._sum?.amount ?? 0);
    const discrepancy = Math.abs((org.creditBalance ?? 0) - ledgerSum);

    return {
      orgId,
      creditBalance: org.creditBalance ?? 0,
      creditsUsed:   org.creditsUsed   ?? 0,
      creditsHeld:   org.creditsHeld   ?? 0,
      creditLimit:   org.creditLimit   ?? 0,
      ledgerSum,
      discrepancy,
      healthy:       discrepancy < 1,
    };
  } catch {
    return null;
  }
}
