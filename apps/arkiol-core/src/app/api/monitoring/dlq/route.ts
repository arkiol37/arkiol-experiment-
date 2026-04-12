// src/app/api/monitoring/dlq/route.ts
// Dead-Letter Queue monitoring and replay endpoint.
// Only ADMIN+ may view or replay DLQ jobs.
//
// v2: Now surfaces BOTH:
//   1. BullMQ ephemeral DLQ (in-memory, lost on Redis restart)
//   2. Persistent DeadLetterJob table (authoritative, survives restarts)
//
// Use ?source=db for the persistent table, ?source=queue (default) for BullMQ.
// Replay via ?source=db marks the DB record as replayed and re-enqueues.

import { NextRequest, NextResponse } from "next/server";
import { detectCapabilities } from '@arkiol/shared';
import { getRequestUser, requirePermission } from "../../../../lib/auth";
import { withErrorHandling, dbUnavailable } from "../../../../lib/error-handling";
import { ApiError } from "../../../../lib/types";
import { dlqQueue, generationQueue } from "../../../../lib/queue";
import { logger } from "../../../../lib/logger";
import { prisma } from "../../../../lib/prisma";

// GET /api/monitoring/dlq
// ?source=queue (default) — BullMQ DLQ
// ?source=db             — Persistent DeadLetterJob table
// ?source=both           — Merged view of both sources
export const GET = withErrorHandling(async (req: NextRequest) => {
  if (!detectCapabilities().database) return dbUnavailable();

  const user = await getRequestUser(req);
  requirePermission(user.role, "MANAGE_BILLING");

  const url    = new URL(req.url);
  const source = url.searchParams.get("source") ?? "both";
  const limit  = Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10), 200);
  const orgId  = url.searchParams.get("orgId") ?? undefined;

  // ── BullMQ queue view ────────────────────────────────────────────────────
  let queueJobs: unknown[] = [];
  let queueCounts: Record<string, number> = {};

  if (source === "queue" || source === "both") {
    const [waiting, failed, counts] = await Promise.all([
      dlqQueue.getJobs(["waiting"], 0, limit - 1),
      dlqQueue.getJobs(["failed"],  0, limit - 1),
      dlqQueue.getJobCounts("waiting", "failed", "completed"),
    ]);
    queueCounts = counts as Record<string, number>;
    queueJobs = [...waiting, ...failed].slice(0, limit).map(j => ({
      _source:       "bullmq",
      id:            j.id,
      originalQueue: j.data?.originalQueue,
      jobId:         j.data?.jobId,
      orgId:         j.data?.orgId,
      userId:        j.data?.userId,
      error:         j.data?.error,
      attempts:      j.data?.attempts,
      failedAt:      j.data?.failedAt,
      addedAt:       new Date(j.timestamp).toISOString(),
    }));
  }

  // ── Persistent DB view ────────────────────────────────────────────────────
  let dbJobs: unknown[] = [];
  let dbTotal = 0;

  if (source === "db" || source === "both") {
    const where: Record<string, unknown> = {};
    if (orgId) where.orgId = orgId;

    [dbJobs, dbTotal] = await Promise.all([
      (prisma as any).deadLetterJob?.findMany?.({
        where,
        orderBy: { deadLetteredAt: "desc" },
        take:    limit,
        select: {
          id:             true,
          jobId:          true,
          orgId:          true,
          userId:         true,
          jobType:        true,
          errorCode:      true,
          errorMessage:   true,
          failureClass:   true,
          attemptCount:   true,
          creditCost:     true,
          creditRefunded: true,
          replayedAt:     true,
          replayedBy:     true,
          deadLetteredAt: true,
        },
      }).then((rows: any[]) => rows.map((r: any) => ({ _source: "db", ...r }))) ?? [],
      (prisma as any).deadLetterJob?.count?.({ where }) ?? 0,
    ]);
  }

  const alert = (queueCounts.waiting ?? 0) > 0 || (queueCounts.failed ?? 0) > 0 || dbTotal > 0
    ? {
        severity: (queueCounts.waiting ?? 0) > 10 || dbTotal > 20 ? "critical" : "warning",
        message:  [
          queueCounts.waiting ? `BullMQ: ${queueCounts.waiting} waiting` : null,
          dbTotal ? `DB: ${dbTotal} persistent dead-letter records` : null,
        ].filter(Boolean).join(", "),
      }
    : null;

  return NextResponse.json({
    source,
    queue:   source !== "db"   ? { counts: queueCounts, jobs: queueJobs } : undefined,
    db:      source !== "queue" ? { total: dbTotal, jobs: dbJobs } : undefined,
    alert,
  });
});

// POST /api/monitoring/dlq
// Body: { dlqJobId, action: "replay"|"discard", source?: "queue"|"db" }
export const POST = withErrorHandling(async (req: NextRequest) => {
  if (!detectCapabilities().database) return dbUnavailable();

  const user = await getRequestUser(req);
  requirePermission(user.role, "MANAGE_BILLING");

  const { dlqJobId, action, source = "queue" } = await req.json().catch(() => ({}));
  if (!dlqJobId || !["replay", "discard"].includes(action)) {
    throw new ApiError(400, "dlqJobId and action (replay|discard) are required");
  }
  if (!["queue", "db"].includes(source)) {
    throw new ApiError(400, "source must be 'queue' or 'db'");
  }

  // ── BullMQ source path (unchanged behaviour) ─────────────────────────────
  if (source === "queue") {
    const job = await dlqQueue.getJob(dlqJobId);
    if (!job) throw new ApiError(404, "DLQ job not found in BullMQ queue");

    if (action === "discard") {
      await job.remove();
      logger.info({ dlqJobId, actor: user.id }, "[dlq] BullMQ job discarded by admin");
      return NextResponse.json({ ok: true, action: "discarded", source: "queue", dlqJobId });
    }

    const { originalQueue, payload } = job.data ?? {};
    if (originalQueue !== "arkiol:generation") {
      throw new ApiError(400, `Replay not supported for queue: ${originalQueue}`);
    }
    await generationQueue.add("generate", payload, {
      attempts: 3,
      backoff:  { type: "exponential", delay: 2000 },
    });
    await job.remove();
    logger.info({ dlqJobId, actor: user.id, originalQueue }, "[dlq] BullMQ job replayed by admin");
    return NextResponse.json({ ok: true, action: "replayed", source: "queue", dlqJobId, originalQueue });
  }

  // ── DB source path (persistent DeadLetterJob table) ──────────────────────
  const dbRecord = await (prisma as any).deadLetterJob?.findUnique?.({ where: { id: dlqJobId } });
  if (!dbRecord) throw new ApiError(404, "Dead-letter record not found in database");

  if (action === "discard") {
    // Soft-discard: mark replayedAt with sentinel "discarded" marker, don't delete
    await (prisma as any).deadLetterJob?.update?.({
      where: { id: dlqJobId },
      data:  { replayedAt: new Date(), replayedBy: `DISCARDED:${user.id}` },
    });
    logger.info({ dlqJobId, actor: user.id, jobId: dbRecord.jobId }, "[dlq] DB dead-letter discarded by admin");
    return NextResponse.json({ ok: true, action: "discarded", source: "db", dlqJobId });
  }

  // Replay: re-enqueue the original payload
  if (!dbRecord.payload || typeof dbRecord.payload !== "object") {
    throw new ApiError(422, "Dead-letter record has no replayable payload");
  }
  await generationQueue.add("generate", dbRecord.payload as Record<string, unknown>, {
    attempts: 3,
    backoff:  { type: "exponential", delay: 2000 },
  });
  await (prisma as any).deadLetterJob?.update?.({
    where: { id: dlqJobId },
    data:  { replayedAt: new Date(), replayedBy: user.id },
  });

  logger.info({ dlqJobId, actor: user.id, jobId: dbRecord.jobId, orgId: dbRecord.orgId }, "[dlq] DB dead-letter replayed by admin");
  return NextResponse.json({ ok: true, action: "replayed", source: "db", dlqJobId, jobId: dbRecord.jobId });
});
