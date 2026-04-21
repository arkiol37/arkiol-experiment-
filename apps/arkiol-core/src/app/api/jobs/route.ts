// src/app/api/jobs/route.ts
// FIX: Removed queueUnavailable() hard block — jobs are stored in the DB
// regardless of whether Redis/BullMQ is configured. The DB is the source of
// truth for job status. Queue is only needed for BullMQ-side state lookups,
// which are optional and gracefully skipped when unavailable.
import { NextRequest, NextResponse } from "next/server";
import { detectCapabilities } from '@arkiol/shared';
import { prisma }            from "../../../lib/prisma";
import { getRequestUser }    from "../../../lib/auth";
import { withErrorHandling, dbUnavailable } from "../../../lib/error-handling";
import { ApiError }          from "../../../lib/types";
import { refundCredits }     from "@arkiol/shared";
import { logger }            from "../../../lib/logger";

// GET /api/jobs — list user's jobs
export const GET = withErrorHandling(async (req: NextRequest) => {
  if (!detectCapabilities().database) return dbUnavailable();

  const user = await getRequestUser(req);
  const url  = new URL(req.url);

  const page   = parseInt(url.searchParams.get("page")   ?? "1");
  const limit  = Math.min(parseInt(url.searchParams.get("limit") ?? "20"), 50);
  const status = url.searchParams.get("status");
  const type   = url.searchParams.get("type");
  const jobId  = url.searchParams.get("id");

  // Single job lookup
  if (jobId) {
    let job = await prisma.job.findFirst({
      where: { id: jobId, userId: user.id },
      include: {
        campaign: { select: { id: true, name: true } },
      },
    });
    if (!job) throw new ApiError(404, "Job not found");

    // Stale-job watchdog. Prisma auto-bumps `updatedAt` on every
    // `.update()` call, so the generation pipeline naturally produces a
    // heartbeat each time it nudges progress. If a PENDING/RUNNING job's
    // last update is older than JOB_STALE_MS the worker has almost
    // certainly died mid-flight (Vercel maxDuration kill, container
    // recycle, crashed dyno), and the UI would otherwise poll
    // "Analyzing prompt… 5%" forever. Flip it to FAILED with a concrete
    // reason so the frontend can render a retry button.
    //
    // Threshold = generation budget + per-batch slack. If a real job ever
    // exceeds this, the inline worker has already hit its own time
    // budget and bailed out, so flagging it here is safe.
    const JOB_STALE_MS = 300_000; // 5 min
    if (
      (job.status === "PENDING" || job.status === "RUNNING") &&
      job.updatedAt &&
      Date.now() - new Date(job.updatedAt).getTime() > JOB_STALE_MS
    ) {
      const staleForMs = Date.now() - new Date(job.updatedAt).getTime();
      logger.warn(
        { jobId: job.id, userId: user.id, status: job.status, staleForMs },
        "Flipping stale job to FAILED",
      );
      try {
        await prisma.job.update({
          where: { id: job.id },
          data: {
            status:   "FAILED" as any,
            failedAt: new Date(),
            result:   {
              error:      `Generation timed out — no progress for ${Math.round(staleForMs / 1000)}s. The worker was likely killed mid-render. Please retry.`,
              failReason: "stale_worker",
            } as any,
          },
        });
        // Re-fetch so the response below reflects the new terminal state.
        job = await prisma.job.findFirst({
          where: { id: jobId, userId: user.id },
          include: { campaign: { select: { id: true, name: true } } },
        });
        if (!job) throw new ApiError(404, "Job not found");
        // Best-effort credit refund — mirror the DELETE handler.
        try {
          const creditCost = (job.payload as any)?.expectedCreditCost ?? 0;
          if (creditCost > 0 && job.orgId) {
            await refundCredits(job.orgId, job.id, "job_stale", { prisma: prisma as any, logger });
          }
        } catch { /* non-fatal */ }
      } catch (flipErr) {
        logger.warn({ jobId: job.id, err: flipErr }, "Failed to flip stale job");
      }
    }

    const assets = job.status === "COMPLETED" && job.result
      ? await prisma.asset.findMany({
          where:  { id: { in: ((job.result as any).assetIds ?? []) } },
          select: {
            id: true, name: true, format: true, category: true,
            width: true, height: true, fileSize: true, brandScore: true,
            layoutFamily: true, createdAt: true, s3Key: true,
            svgSource: true, metadata: true,
          },
        })
      : [];

    // Build asset preview URLs
    const assetsWithUrls = await Promise.all(assets.map(async (a: { id: string; name: string; format: string; category: string; width: number; height: number; fileSize: number; brandScore: number; layoutFamily: string | null; createdAt: Date; s3Key: string; svgSource: string | null; metadata: unknown }) => {
      let thumbnailUrl: string | null = null;
      if (a.s3Key && !a.s3Key.startsWith('inline:') && detectCapabilities().storage) {
        try {
          const { getSignedDownloadUrl } = require("../../../lib/s3");
          thumbnailUrl = await getSignedDownloadUrl(a.s3Key, 3600).catch(() => null);
        } catch { /* no-op */ }
      }
      // Fall back to inline SVG data URL when S3 not available
      if (!thumbnailUrl && a.svgSource) {
        thumbnailUrl = `data:image/svg+xml;base64,${Buffer.from(a.svgSource).toString('base64')}`;
      }
      return { ...a, thumbnailUrl, svgSource: undefined };
    }));

    return NextResponse.json({
      job: {
        id:          job.id,
        type:        job.type,
        status:      job.status,
        progress:    job.progress,
        attempts:    job.attempts,
        maxAttempts: job.maxAttempts,
        result:      job.status === "COMPLETED" ? {
          assetCount:  assetsWithUrls.length,
          creditCost:  (job.result as any)?.creditCost ?? 0,
          downloadUrl: (job.result as any)?.downloadUrl ?? null,
          exportKey:   (job.result as any)?.exportKey   ?? null,
          format:      (job.result as any)?.format      ?? null,
          fileSize:    (job.result as any)?.fileSize     ?? null,
          assets:      assetsWithUrls,
        } : (job.status === "FAILED" ? {
          error:     (job.result as any)?.error ?? "Generation failed",
          failReason:(job.result as any)?.failReason ?? null,
        } : null),
        error:       job.status === "FAILED" ? (job.result as any)?.error : undefined,
        campaign:    (job as any).campaign,
        createdAt:   job.createdAt,
        startedAt:   job.startedAt,
        completedAt: job.completedAt,
        failedAt:    job.failedAt,
      },
    });
  }

  // List jobs
  const jobs = await prisma.job.findMany({
    where: {
      userId: user.id,
      ...(status ? { status: status as any } : {}),
      ...(type   ? { type:   type   as any } : {}),
    },
    orderBy: { createdAt: "desc" },
    skip:    (page - 1) * limit,
    take:    limit,
    include: { campaign: { select: { id: true, name: true } } },
  });

  const total = await prisma.job.count({
    where: {
      userId: user.id,
      ...(status ? { status: status as any } : {}),
      ...(type   ? { type:   type   as any } : {}),
    },
  });

  return NextResponse.json({ jobs, total, page, limit });
});

// DELETE /api/jobs — cancel a pending job
export const DELETE = withErrorHandling(async (req: NextRequest) => {
  if (!detectCapabilities().database) return dbUnavailable();

  const user  = await getRequestUser(req);
  const url   = new URL(req.url);
  const jobId = url.searchParams.get("id");

  if (!jobId) throw new ApiError(400, "Job ID required");

  const job = await prisma.job.findFirst({ where: { id: jobId, userId: user.id } });
  if (!job) throw new ApiError(404, "Job not found");

  if (!["PENDING", "RUNNING"].includes(job.status)) {
    throw new ApiError(400, `Cannot cancel job in status: ${job.status}`);
  }

  await prisma.job.update({
    where: { id: jobId },
    data:  { status: "FAILED" as any, failedAt: new Date(), result: { error: "Cancelled by user" } as any },
  });

  // Attempt to refund credits
  try {
    const creditCost = (job.payload as any)?.expectedCreditCost ?? 0;
    if (creditCost > 0 && job.orgId) {
      await refundCredits(job.orgId, jobId, "job_cancelled", { prisma: prisma as any, logger });
    }
  } catch { /* non-fatal */ }

  logger.info({ jobId, userId: user.id }, "Job cancelled");
  return NextResponse.json({ success: true });
});
