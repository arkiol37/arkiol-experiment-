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
            layoutFamily: true, createdAt: true, s3Key: true,
            svgSource: true, metadata: true,
          },
        })
      : [];

    // Build asset preview URLs
    const assetsWithUrls = await Promise.all(assets.map(async (a) => {
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
