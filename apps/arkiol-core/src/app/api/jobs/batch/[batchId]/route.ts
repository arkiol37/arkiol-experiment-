// src/app/api/jobs/batch/[batchId]/route.ts
// GET /api/jobs/batch/:batchId — aggregate status for a bulk generation batch.
//
// Returns:
//   • BatchJob status (PENDING | RUNNING | COMPLETED | PARTIAL | FAILED | CANCELLED)
//   • Per-job breakdown with progress and result links
//   • Overall progress percentage
//   • All completed asset IDs (flat list for bulk download)
//
// The batch status is computed live from the constituent Job rows —
// the BatchJob.status column is the cached summary (updated by the generation
// worker via the batchProgressUpdater helper). Both are returned so the client
// can use whichever is more convenient.
//
// DELETE /api/jobs/batch/:batchId — cancel all PENDING jobs in the batch.

import "server-only";
import { detectCapabilities } from '@arkiol/shared';
import { NextRequest, NextResponse }  from "next/server";
import { prisma }                     from "../../../../../lib/prisma";
import { getRequestUser }             from "../../../../../lib/auth";
import { withErrorHandling }          from "../../../../../lib/error-handling";
import { ApiError }                   from "../../../../../lib/types";
import { queueUnavailable } from "../../../../../lib/error-handling";

// ── GET ───────────────────────────────────────────────────────────────────────

export const GET = withErrorHandling(async (
  req: NextRequest,
  { params }: { params: { batchId: string } }
) => {
  if (!detectCapabilities().queue) return queueUnavailable();


  const { batchId } = params;
  const user        = await getRequestUser(req);

  // Load the batch — must belong to the requesting user
  const batch = await (prisma as any).batchJob.findFirst({
    where:   { id: batchId, userId: user.id },
    include: {
      jobs: {
        include: {
          // Load the constituent Job rows via BatchJobItem
        },
        orderBy: { promptIdx: "asc" },
      },
    },
  });
  if (!batch) throw new ApiError(404, "Batch not found");

  // Load all constituent Job rows
  const items: Array<{ jobId: string; promptIdx: number }> = batch.jobs ?? [];
  const jobIds = items.map((it: any) => it.jobId);

  const jobs = jobIds.length > 0
    ? await prisma.job.findMany({
        where:   { id: { in: jobIds }, userId: user.id },
        select: {
          id: true, status: true, progress: true, result: true,
          createdAt: true, startedAt: true, completedAt: true, failedAt: true,
        },
        orderBy: { createdAt: "asc" },
      })
    : [];

  const jobMap = new Map(jobs.map(j => [j.id, j]));

  // Build per-job summary
  const jobSummaries = items.map((item: any) => {
    const job = jobMap.get(item.jobId);
    if (!job) return { promptIdx: item.promptIdx, jobId: item.jobId, status: "MISSING", progress: 0 };
    const r = job.result as Record<string, unknown> | null;
    return {
      promptIdx:   item.promptIdx,
      jobId:       job.id,
      status:      job.status,
      progress:    job.progress ?? 0,
      assetIds:    (r?.assetIds as string[] | null) ?? [],
      creditCost:  (r?.creditCost as number | null) ?? 0,
      error:       job.status === "FAILED" ? ((r?.error ?? r?.failReason) as string | null) : null,
      createdAt:   job.createdAt,
      startedAt:   job.startedAt,
      completedAt: job.completedAt,
    };
  });

  // Compute live aggregate status from Job rows
  const total     = jobSummaries.length;
  const completed = jobSummaries.filter(j => j.status === "COMPLETED").length;
  const failed    = jobSummaries.filter(j => j.status === "FAILED").length;
  const cancelled = jobSummaries.filter(j => j.status === "CANCELLED" || j.status === "CANCELED").length;
  const running   = jobSummaries.filter(j => j.status === "RUNNING").length;
  const pending   = total - completed - failed - cancelled - running;

  let liveStatus: string;
  if (completed + failed + cancelled === total) {
    if      (failed === total)     liveStatus = "FAILED";
    else if (completed === total)  liveStatus = "COMPLETED";
    else                           liveStatus = "PARTIAL";
  } else if (running > 0 || completed > 0) {
    liveStatus = "RUNNING";
  } else {
    liveStatus = "PENDING";
  }

  const overallProgress = total > 0
    ? Math.round(
        jobSummaries.reduce((acc, j) => acc + (j.progress ?? 0), 0) / total
      )
    : 0;

  // Flat list of all completed asset IDs for bulk download
  const allAssetIds = jobSummaries.flatMap(j => j.assetIds ?? []);

  return NextResponse.json({
    batch: {
      id:             batchId,
      status:         liveStatus,   // live-computed
      cachedStatus:   batch.status, // DB-cached (slightly stale, but fast)
      totalJobs:      batch.totalJobs,
      completedJobs:  completed,
      failedJobs:     failed,
      cancelledJobs:  cancelled,
      runningJobs:    running,
      pendingJobs:    pending,
      overallProgress,
      totalCreditCost: batch.totalCreditCost,
      allAssetIds,
      createdAt:      batch.createdAt,
      startedAt:      batch.startedAt,
      completedAt:    batch.completedAt,
    },
    jobs: jobSummaries,
  });
});

// ── DELETE — cancel all PENDING jobs in the batch ────────────────────────────

export const DELETE = withErrorHandling(async (
  req: NextRequest,
  { params }: { params: { batchId: string } }
) => {
  if (!detectCapabilities().queue) return queueUnavailable();

  const { batchId } = params;
  const user        = await getRequestUser(req);

  const batch = await (prisma as any).batchJob.findFirst({
    where: { id: batchId, userId: user.id },
  });
  if (!batch) throw new ApiError(404, "Batch not found");

  if (["COMPLETED", "FAILED", "CANCELLED"].includes(batch.status)) {
    throw new ApiError(400, `Batch is already in terminal state: ${batch.status}`);
  }

  // Load PENDING job IDs from BatchJobItems
  const items = await (prisma as any).batchJobItem.findMany({
    where:  { batchId },
    select: { jobId: true },
  });
  const jobIds = items.map((it: any) => it.jobId);

  // Mark PENDING jobs as CANCELLED
  const { count } = await prisma.job.updateMany({
    where:  { id: { in: jobIds }, status: { in: ["PENDING", "QUEUED"] } },
    data:   { status: "CANCELLED" as any, canceledAt: new Date() },
  });

  // Update BatchJob status
  await (prisma as any).batchJob.update({
    where: { id: batchId },
    data:  { status: "CANCELLED", completedAt: new Date() },
  });

  return NextResponse.json({
    batchId,
    cancelled: count,
    message:   `${count} pending job(s) cancelled.`,
  });
});
