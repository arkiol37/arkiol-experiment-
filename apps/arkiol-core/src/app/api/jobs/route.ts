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
import { formatJobError }    from "../../../lib/jobErrorFormat";
import { durableRunInlineGeneration } from "../../../lib/durableRun";

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

    // ── PENDING job auto-resume ──────────────────────────────────────────
    // If a job is still PENDING with no startedAt more than RESUME_AFTER_MS
    // after creation, the original /api/generate handler almost certainly
    // terminated before `runInlineGeneration` reached its "mark RUNNING"
    // write (Vercel cold-start kill, container recycle, serverless
    // timeout before the background promise scheduled). Without this
    // resume, the job would sit at PENDING until the stale watchdog
    // eventually flipped it to FAILED and the user's credits stay gone.
    //
    // Durability story: the first serverless container that polls this
    // job after the grace period atomically claims it by setting
    // `startedAt` via updateMany (so races between concurrent polls
    // resolve cleanly — only one poll wins, rest see count=0) and then
    // kicks off durableRunInlineGeneration on ITS OWN request lifecycle.
    // If that poll's container is also killed before finishing, the
    // next poll will do the same claim-and-resume dance once the grace
    // period expires again. Effectively, polling itself becomes the
    // durability mechanism on serverless — no cron, no new infra.
    const RESUME_AFTER_MS    = 30_000;  // 30s grace for original launch
    const MAX_RESUME_ATTEMPTS = 3;
    if (
      !detectCapabilities().queue &&
      job.status === "PENDING" &&
      !job.startedAt &&
      Date.now() - new Date(job.createdAt).getTime() > RESUME_AFTER_MS &&
      (job.attempts ?? 0) < MAX_RESUME_ATTEMPTS &&
      job.type === "GENERATE_ASSETS" &&
      job.payload
    ) {
      const claim = await prisma.job.updateMany({
        where: {
          id:         job.id,
          status:     "PENDING" as any,
          startedAt:  null,
        },
        data: {
          startedAt: new Date(),
          attempts:  { increment: 1 },
        },
      }).catch(() => ({ count: 0 }));

      if (claim.count === 1) {
        const payload = job.payload as any;
        logger.info(
          { jobId: job.id, userId: user.id, attemptsUsed: (job.attempts ?? 0) + 1 },
          "Resuming PENDING job whose original handler never started",
        );
        try {
          durableRunInlineGeneration({
            jobId:              job.id,
            userId:             payload.userId,
            orgId:              payload.orgId,
            prompt:             payload.prompt,
            formats:            payload.formats ?? [],
            stylePreset:        payload.stylePreset ?? "auto",
            variations:         payload.variations ?? 1,
            brandId:            payload.brandId ?? null,
            campaignId:         payload.campaignId ?? null,
            includeGif:         !!payload.includeGif,
            locale:             payload.locale ?? "en",
            archetypeOverride:  payload.archetypeOverride,
            expectedCreditCost: payload.expectedCreditCost ?? 0,
          });
          // Re-fetch so the caller sees the claimed row (startedAt set,
          // attempts incremented) instead of the stale pre-claim copy.
          job = await prisma.job.findFirst({
            where: { id: jobId, userId: user.id },
            include: { campaign: { select: { id: true, name: true } } },
          });
          if (!job) throw new ApiError(404, "Job not found");
        } catch (resumeErr: any) {
          logger.warn(
            { jobId: job.id, err: resumeErr?.message ?? String(resumeErr) },
            "Failed to kick off resume for PENDING job",
          );
        }
      }
    }

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

    // For FAILED jobs, run the stored error through the shared
    // formatter server-side so: (1) historical rows with no `failReason`
    // still get a sensible title via inferReasonFromMessage, and (2)
    // the client can just render the returned fields without having
    // to re-apply the same logic. We still expose the raw `error` +
    // `failReason` for clients that want to format themselves.
    const failedDisplay = job.status === "FAILED"
      ? formatJobError({
          status: job.status,
          result: job.result as any,
          error:  (job.result as any)?.error ?? undefined,
        })
      : null;

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
        } : (failedDisplay ? {
          // Raw fields for clients that want to re-format themselves.
          error:      (job.result as any)?.error ?? failedDisplay.message,
          failReason: failedDisplay.reason,
          // Pre-formatted fields so simple clients (Recent Jobs tile,
          // toast) can render directly without importing the formatter.
          title:      failedDisplay.title,
          message:    failedDisplay.message,
          retryable:  failedDisplay.retryable,
        } : null),
        // Top-level `error` is kept for backward compatibility with
        // EditorShell + AnimationStudioView which read `job.error`.
        // Always populated on FAILED so a bare `job.error ?? "Job failed"`
        // fallback never surfaces the generic text.
        error:       failedDisplay?.message,
        failReason:  failedDisplay?.reason,
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

  // Enrich FAILED entries so list consumers (Recent Jobs tile) can
  // render the real reason without a second round-trip. Non-FAILED
  // rows pass through untouched to keep the response shape stable.
  const enrichedJobs = jobs.map((j: any) => {
    if (j.status !== "FAILED") return j;
    const display = formatJobError({
      status: j.status,
      result: j.result,
      error:  j.result?.error,
    });
    return {
      ...j,
      error:      display.message,
      failReason: display.reason,
      result: {
        ...(j.result ?? {}),
        error:      j.result?.error ?? display.message,
        failReason: display.reason,
        title:      display.title,
        message:    display.message,
        retryable:  display.retryable,
      },
    };
  });

  return NextResponse.json({ jobs: enrichedJobs, total, page, limit });
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
    data:  {
      status:   "FAILED" as any,
      failedAt: new Date(),
      result:   { error: "Cancelled by user", failReason: "cancelled" } as any,
    },
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
