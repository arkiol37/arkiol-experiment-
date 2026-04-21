// src/app/api/jobs/[id]/retry/route.ts
//
// POST /api/jobs/:id/retry — explicit, user-triggered retry of a FAILED
// generation job. The companion auto-retry path inside
// runInlineGeneration (see lib/inlineGenerate.ts) uses the SAME
// prepareRetry helper so the eligibility rules can't drift.
//
// Contract:
//   • 202 on successful retry dispatch → { jobId, status: "PENDING",
//     retried: true, attemptsUsed, maxAttempts, durability }.
//   • 404 when the job doesn't exist for this user.
//   • 409 when the row is not FAILED, the failReason isn't retryable,
//     or the attempt cap has already been hit.
//
// The frontend uses the returned `status: "PENDING"` as the signal to
// resume polling /api/jobs?id=<jobId>.

import { NextRequest, NextResponse } from "next/server";
import { detectCapabilities } from "@arkiol/shared";
import { getRequestUser }    from "../../../../../lib/auth";
import { withErrorHandling, dbUnavailable } from "../../../../../lib/error-handling";
import { ApiError }          from "../../../../../lib/types";
import { logger }            from "../../../../../lib/logger";
import { prepareRetry, RetryNotAllowedError } from "../../../../../lib/jobRetry";
import { durableRunInlineGeneration } from "../../../../../lib/durableRun";

// Retry runs the same inline pipeline the original generate path runs,
// so we need the same serverless runtime headroom.
export const maxDuration = 300;

const REJECTION_STATUS: Record<string, number> = {
  not_found:         404,
  not_failed:        409,
  not_retryable:     409,
  attempts_exhausted:409,
  claim_lost:        409,
  payload_missing:   409,
};

export const POST = withErrorHandling(async (
  req: NextRequest,
  { params }: { params: { id: string } },
) => {
  if (!detectCapabilities().database) return dbUnavailable();

  const jobId = params.id;
  const user  = await getRequestUser(req);

  let prep;
  try {
    prep = await prepareRetry(jobId, user.id);
  } catch (err: any) {
    if (err instanceof RetryNotAllowedError) {
      const code = REJECTION_STATUS[err.reason] ?? 409;
      logger.info(
        { jobId, userId: user.id, reason: err.reason },
        "Retry rejected",
      );
      throw new ApiError(code, err.message);
    }
    throw err;
  }

  logger.info(
    {
      jobId,
      userId:             user.id,
      attemptsUsed:       prep.attemptsUsed,
      maxAttempts:        prep.maxAttempts,
      previousFailReason: prep.previousFailReason,
    },
    "Retry dispatched",
  );

  const dur = durableRunInlineGeneration(prep.params);

  return NextResponse.json(
    {
      jobId:        prep.jobId,
      status:       "PENDING",
      retried:      true,
      attemptsUsed: prep.attemptsUsed,
      maxAttempts:  prep.maxAttempts,
      durability:   dur.strategy,
      previousFailReason: prep.previousFailReason,
    },
    { status: 202 },
  );
});
