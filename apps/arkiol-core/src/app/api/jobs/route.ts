// src/app/api/jobs/route.ts
import { NextRequest, NextResponse } from "next/server";
import { detectCapabilities } from '@arkiol/shared';
import { prisma }            from "../../../lib/prisma";
import { getRequestUser }    from "../../../lib/auth";
import { withErrorHandling, queueUnavailable } from "../../../lib/error-handling";
import { ApiError }          from "../../../lib/types";
import { refundCredits }     from "@arkiol/shared";
import { logger }            from "../../../lib/logger";

// ── GET /api/jobs — list user's jobs ──────────────────────────────────────
export const GET = withErrorHandling(async (req: NextRequest) => {
  if (!detectCapabilities().queue) return queueUnavailable();

  const user = await getRequestUser(req);
  const url  = new URL(req.url);

  const page   = parseInt(url.searchParams.get("page")   ?? "1");
  const limit  = Math.min(parseInt(url.searchParams.get("limit") ?? "20"), 50);
  const status = url.searchParams.get("status");
  const type   = url.searchParams.get("type");
  const jobId  = url.searchParams.get("id");

  // Single job lookup
  if (jobId) {
    const job = await prisma.job.findFirst({
      where: { id: jobId, userId: user.id },
      include: {
        campaign: { select: { id: true, name: true } },
      },
    });
    if (!job) throw new ApiError(404, "Job not found");

    const assets = job.status === "COMPLETED" && job.result
      ? await prisma.asset.findMany({
          where:  { id: { in: ((job.result as any).assetIds ?? []) } },
          select: {
            id: true, name: true, format: true, category: true,
            width: true, height: true, fileSize: true, brandScore: true,
            layoutFamily: true, createdAt: true,
          },
        })
      : [];

    return NextResponse.json({
      job: {
        id:          job.id,
        type:        job.type,
        status:      job.status,
        progress:    job.progress,
        attempts:    job.attempts,
        maxAttempts: job.maxAttempts,
        result:      job.status === "COMPLETED" ? {
          assetCount:  assets.length,
          creditCost:  (job.result as any)?.creditCost ?? 0,
          // Export job fields (A1)
          downloadUrl: (job.result as any)?.downloadUrl ?? null,
          exportKey:   (job.result as any)?.exportKey   ?? null,
          format:      (job.result as any)?.format      ?? null,
          fileSize:    (job.result as any)?.fileSize     ?? null,
          fileSizeKB:  (job.result as any)?.fileSizeKB  ?? null,
          durationMs:  (job.result as any)?.durationMs  ?? null,
          expiresAt:   (job.result as any)?.expiresAt    ?? null,
        } : null,
        error:       job.status === "FAILED"
          ? ((job.result as any)?.error ?? (job.result as any)?.failReason ?? "Unknown error")
          : null,
        failReason:  job.status === "FAILED" ? (job.result as any)?.failReason : null,
        dlq:         job.status === "FAILED" ? (job.result as any)?.dlq ?? false : false,
        campaign:    job.campaign,
        createdAt:   job.createdAt,
        startedAt:   job.startedAt,
        completedAt: job.completedAt,
      },
      assets,
    });
  }

  // List jobs
  const whereClause = {
    userId: user.id,
    ...(status ? { status: status as any } : {}),
    ...(type   ? { type: type as any }     : {}),
  };

  const jobs = await prisma.job.findMany({
    where:   whereClause,
    orderBy: { createdAt: "desc" },
    skip:    (page - 1) * limit,
    take:    limit,
    select: {
      id: true, type: true, status: true, progress: true,
      attempts: true, createdAt: true, startedAt: true, completedAt: true,
      campaign: { select: { id: true, name: true } },
    },
  });

  const total = await prisma.job.count({ where: whereClause });

  return NextResponse.json({ jobs, total, page, limit });
});

// ── DELETE /api/jobs — cancel a pending job ────────────────────────────────
export const DELETE = withErrorHandling(async (req: NextRequest) => {
  if (!detectCapabilities().queue) return queueUnavailable();

  const user  = await getRequestUser(req);
  const jobId = new URL(req.url).searchParams.get("id");
  if (!jobId) throw new ApiError(400, "Job ID required (?id=...)");

  const job = await prisma.job.findFirst({ where: { id: jobId, userId: user.id } });
  if (!job) throw new ApiError(404, "Job not found");

  if (!["PENDING"].includes(job.status)) {
    throw new ApiError(409, `Cannot cancel job with status: ${job.status}. Only PENDING jobs can be cancelled.`);
  }

  await prisma.job.update({
    where: { id: jobId },
    data:  { status: "CANCELLED" },
  });

  // Release any credits held at job-creation time (phase 1 of two-phase commit).
  // refundCredits is idempotent — safe to call even if no hold exists.
  const jobRow = await prisma.job.findUnique({
    where:  { id: jobId },
    select: { orgId: true },
  });
  if (jobRow?.orgId) {
    await refundCredits(
      jobRow.orgId,
      jobId,
      'user_cancelled',
      { prisma: prisma as any, logger }
    ).catch(err => {
      logger.error(
        { jobId, orgId: jobRow.orgId, err: err.message },
        '[api/jobs] CRITICAL: refundCredits failed on user cancel — manual review required'
      );
    });
  }

  return NextResponse.json({ cancelled: true, jobId });
});
