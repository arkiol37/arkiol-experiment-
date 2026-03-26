// packages/shared/src/exportIdempotency.ts
// ─────────────────────────────────────────────────────────────────────────────
// EXPORT IDEMPOTENCY PROTECTION — Task #5
//
// Prevents duplicate export jobs from being created within a configurable
// time window for the same user + asset set + format combination.
//
// Uses the database (Job table) as the source of truth — no Redis dependency —
// so it survives restarts and works across multiple server instances.
//
// Usage:
//   const guard = createExportIdempotencyGuard(prisma);
//   const existing = await guard.check({ userId, assetIds, format });
//   if (existing) return existing; // return the already-queued job
//   // ... create job ...
//   // idempotencyKey is already computed — pass it to job creation
// ─────────────────────────────────────────────────────────────────────────────

import { PrismaClient } from '@prisma/client';
import { createHash } from 'crypto';

export interface ExportIdempotencyParams {
  userId: string;
  orgId: string;
  assetIds: string[];
  format: string;
  /** Window in milliseconds during which duplicates are blocked. Default: 60s */
  windowMs?: number;
}

export interface ExistingExportJob {
  jobId: string;
  status: string;
  createdAt: Date;
  idempotencyKey: string;
}

/**
 * Deterministic idempotency key for an export request.
 * Stable across restarts — hash of sorted assetIds + format + userId.
 */
export function computeExportIdempotencyKey(params: {
  userId: string;
  assetIds: string[];
  format: string;
}): string {
  const { userId, assetIds, format } = params;
  const sorted = [...assetIds].sort().join(',');
  const raw = `export:${userId}:${sorted}:${format}`;
  return 'exp_' + createHash('sha256').update(raw).digest('hex').slice(0, 40);
}

export function createExportIdempotencyGuard(prisma: PrismaClient) {
  /**
   * Check for a duplicate export job within the time window.
   *
   * Returns the existing job if a duplicate is found, or null if the
   * request is new and should proceed to job creation.
   */
  async function check(params: ExportIdempotencyParams): Promise<ExistingExportJob | null> {
    const { userId, orgId, assetIds, format, windowMs = 60_000 } = params;

    const idempotencyKey = computeExportIdempotencyKey({ userId, assetIds, format });
    const windowStart = new Date(Date.now() - windowMs);

    // First: check by idempotency key (strongest dedup — survives retries)
    const byKey = await prisma.job.findFirst({
      where: {
        idempotencyKey,
        userId,
        orgId,
        status: { notIn: ['FAILED', 'CANCELED', 'CANCELLED', 'REFUNDED'] },
      },
      select: { id: true, status: true, createdAt: true, idempotencyKey: true },
    }).catch(() => null);

    if (byKey) {
      return {
        jobId: byKey.id,
        status: byKey.status,
        createdAt: byKey.createdAt,
        idempotencyKey: byKey.idempotencyKey ?? idempotencyKey,
      };
    }

    // Second: time-window check for same user + format + asset set
    // Catches cases where a job was created without an idempotency key
    const recent = await prisma.job.findFirst({
      where: {
        userId,
        orgId,
        type: 'EXPORT_BUNDLE' as any,
        status: { notIn: ['FAILED', 'CANCELED', 'CANCELLED', 'REFUNDED'] },
        createdAt: { gte: windowStart },
        payload: {
          // JSON contains check — works with Prisma's Json filter
          path: ['format'],
          equals: format,
        },
      },
      select: { id: true, status: true, createdAt: true, idempotencyKey: true, payload: true },
      orderBy: { createdAt: 'desc' },
    }).catch(() => null);

    if (recent) {
      // Verify asset IDs match (the payload.path filter above only checks format)
      const payload = recent.payload as any;
      const existingAssets: string[] = (payload?.assetIds ?? (payload?.assetId ? [payload.assetId] : []));
      const requestedSorted = [...assetIds].sort().join(',');
      const existingSorted = [...existingAssets].sort().join(',');

      if (requestedSorted === existingSorted) {
        return {
          jobId: recent.id,
          status: recent.status,
          createdAt: recent.createdAt,
          idempotencyKey: recent.idempotencyKey ?? idempotencyKey,
        };
      }
    }

    return null;
  }

  /**
   * Compute the idempotency key for use when creating the job.
   * Always pass this key to Job.create() / exportQueue.add().
   */
  function keyFor(params: { userId: string; assetIds: string[]; format: string }): string {
    return computeExportIdempotencyKey(params);
  }

  return { check, keyFor };
}

export type ExportIdempotencyGuard = ReturnType<typeof createExportIdempotencyGuard>;
