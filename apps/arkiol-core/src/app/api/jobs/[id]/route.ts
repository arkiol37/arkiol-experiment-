// src/app/api/jobs/[id]/route.ts
// GET /api/jobs/:id — single job detail for mobile and web clients.

import { NextRequest, NextResponse }  from "next/server";
import { detectCapabilities } from '@arkiol/shared';
import { prisma }            from "../../../../lib/prisma";
import { getRequestUser }    from "../../../../lib/auth";
import { withErrorHandling, queueUnavailable} from "../../../../lib/error-handling";
import { ApiError }          from "../../../../lib/types";

export const GET = withErrorHandling(async (
  req: NextRequest,
  { params }: { params: { id: string } }
) => {
  if (!detectCapabilities().queue) return queueUnavailable();


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
          layoutFamily: true, createdAt: true,
        },
      })
    : [];

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
        assetCount:  assets.length,
        creditCost:  r?.creditCost  ?? 0,
        downloadUrl: r?.downloadUrl ?? null,
        exportKey:   r?.exportKey   ?? null,
        format:      r?.format      ?? null,
        fileSize:    r?.fileSize    ?? null,
        fileSizeKB:  r?.fileSizeKB  ?? null,
        durationMs:  r?.durationMs  ?? null,
        expiresAt:   r?.expiresAt   ?? null,
      } : null,
      error:      job.status === "FAILED" ? (r?.error ?? r?.failReason ?? "Unknown error") : null,
      failReason: job.status === "FAILED" ? r?.failReason : null,
      dlq:        job.status === "FAILED" ? (r?.dlq ?? false) : false,
      campaign:   job.campaign,
      createdAt:  job.createdAt,
      startedAt:  job.startedAt,
      completedAt:job.completedAt,
    },
    assets,
  });
});
