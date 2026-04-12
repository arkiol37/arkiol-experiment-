// src/app/api/jobs/[id]/route.ts
// GET /api/jobs/:id — single job detail for mobile and web clients.
// FIX: Removed queueUnavailable() block — job state is in the DB.
// Includes thumbnail URL resolution: signed S3 URL with SVG data-URL fallback.

import { NextRequest, NextResponse }  from "next/server";
import { detectCapabilities } from '@arkiol/shared';
import { prisma }            from "../../../../lib/prisma";
import { getRequestUser }    from "../../../../lib/auth";
import { withErrorHandling, dbUnavailable } from "../../../../lib/error-handling";
import { ApiError }          from "../../../../lib/types";

export const GET = withErrorHandling(async (
  req: NextRequest,
  { params }: { params: { id: string } }
) => {
  if (!detectCapabilities().database) return dbUnavailable();

  const jobId = params.id;
  const user  = await getRequestUser(req);

  const job = await prisma.job.findFirst({
    where: { id: jobId, userId: user.id },
    include: { campaign: { select: { id: true, name: true } } },
  });
  if (!job) throw new ApiError(404, "Job not found");

  const assets = job.status === "COMPLETED" && job.result
    ? await prisma.asset.findMany({
        where:  { id: { in: ((job.result as Record<string, unknown>).assetIds as string[] ?? []) } },
        select: {
          id: true, name: true, format: true, category: true,
          width: true, height: true, fileSize: true, brandScore: true,
          layoutFamily: true, createdAt: true, s3Key: true, svgSource: true,
        },
      })
    : [];

  // Resolve thumbnail URLs
  const assetsWithUrls = await Promise.all(assets.map(async (a: { id: string; name: string; format: string; category: string; width: number; height: number; fileSize: number; brandScore: number; layoutFamily: string | null; createdAt: Date; s3Key: string; svgSource: string | null }) => {
    let thumbnailUrl: string | null = null;
    if (a.s3Key && !a.s3Key.startsWith('inline:') && detectCapabilities().storage) {
      try {
        const { getSignedDownloadUrl } = require("../../../../lib/s3");
        thumbnailUrl = await getSignedDownloadUrl(a.s3Key, 3600).catch(() => null);
      } catch { /* no-op */ }
    }
    if (!thumbnailUrl && a.svgSource) {
      thumbnailUrl = `data:image/svg+xml;base64,${Buffer.from(a.svgSource).toString('base64')}`;
    }
    return { ...a, thumbnailUrl, svgSource: undefined };
  }));

  const r = job.result as Record<string, unknown> | null;

  return NextResponse.json({
    job: {
      id:          job.id,
      type:        job.type,
      status:      job.status,
      progress:    job.progress,
      attempts:    job.attempts,
      maxAttempts: job.maxAttempts,
      result: job.status === "COMPLETED" ? {
        assetCount:  assetsWithUrls.length,
        creditCost:  r?.creditCost  ?? 0,
        downloadUrl: r?.downloadUrl ?? null,
        exportKey:   r?.exportKey   ?? null,
        format:      r?.format      ?? null,
        fileSize:    r?.fileSize     ?? null,
        assets:      assetsWithUrls,
      } : (job.status === "FAILED" ? {
        error:     (r as any)?.error ?? "Generation failed",
        failReason:(r as any)?.failReason ?? null,
      } : null),
      error:       job.status === "FAILED" ? (r as any)?.error : undefined,
      campaign:    (job as any).campaign,
      createdAt:   job.createdAt,
      startedAt:   job.startedAt,
      completedAt: job.completedAt,
      failedAt:    job.failedAt,
    },
  });
});
