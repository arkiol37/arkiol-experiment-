// src/lib/jobRetry.ts
//
// Safe retry & resume of FAILED generation jobs.
//
// The story this module exists to solve:
//
//   A user clicks Generate, the pipeline crashes 80% of the way through —
//   maybe OpenAI 502'd on a single variation, maybe an S3 upload timed
//   out, maybe a render step blew up on a font glyph it couldn't shape.
//   Without retry, the user is left with a FAILED job, lost credits, and
//   no path forward except "type the same prompt again and pray". The
//   transient nature of those failures means the *next* attempt very
//   often succeeds — which is what makes auto/explicit retry worth
//   building.
//
// Retry contract:
//
//   1. Only FAILED jobs are eligible. PENDING / RUNNING / COMPLETED /
//      CANCELLED rows are off-limits — letting a user "retry" a RUNNING
//      job would race the live pipeline; retrying COMPLETED would
//      overwrite their assets.
//
//   2. Only retryable failure reasons are eligible. `formatJobError()`
//      already classifies each failReason as retryable or not. Hard
//      errors (missing_asset, cancelled-by-user) stay terminal — no
//      amount of retrying will fix them.
//
//   3. Per-job attempt cap. Each job has `attempts` and `maxAttempts`
//      on the row already (created in /api/generate as maxAttempts: 3).
//      We additionally enforce MAX_TOTAL_ATTEMPTS as a global ceiling so
//      legacy rows with absurd maxAttempts can't loop forever.
//
//   4. Atomic claim. Retry resets the row from FAILED → PENDING in a
//      single `updateMany` so two clicks of the Retry button (or a
//      double-fire from React StrictMode) don't both kick off
//      generation.
//
//   5. Brief snapshot reuse. The expensive analyzeBrief() call writes
//      its result back into `job.payload.briefSnapshot` after
//      success — so retries skip the analyzer and resume from the
//      render pipeline. Saves 2-5s and one OpenAI call per retry.
//
// This module is the single source of truth: the explicit retry endpoint
// (/api/jobs/[id]/retry) AND the auto-retry inside inlineGenerate's
// outer catch both go through prepareRetry() so the safety rules can't
// drift between the two paths.

// Framework-neutral: dynamically required from inlineGenerate's retry path,
// which runs both on Vercel and on apps/render-backend.
import { prisma } from "./prisma";
import { formatJobError, isAutoRetryable } from "./jobErrorFormat";
import type { InlineGenerateParams } from "./inlineGenerate";
import { JobStatus } from "@prisma/client";

/** Hard ceiling on per-job retry attempts, regardless of the row's
 *  individual maxAttempts. Picked to be permissive enough that a
 *  flaky-OpenAI window is recoverable but tight enough that a
 *  genuinely-broken prompt gives up before burning meaningful money. */
export const MAX_TOTAL_ATTEMPTS = 3;

export type RetryRejectionReason =
  | "not_found"
  | "not_failed"
  | "not_retryable"
  | "attempts_exhausted"
  | "claim_lost"
  | "payload_missing";

export class RetryNotAllowedError extends Error {
  constructor(public readonly reason: RetryRejectionReason, message: string) {
    super(message);
    this.name = "RetryNotAllowedError";
  }
}

export interface PrepareRetryResult {
  jobId:        string;
  attemptsUsed: number;
  maxAttempts:  number;
  /** Reconstructed params ready for durableRunInlineGeneration. The
   *  briefSnapshot field, if present, lets the runner skip analyzeBrief. */
  params:       InlineGenerateParams;
  /** Reason code from the previous FAILED row — surfaced in logs so
   *  ops can see e.g. "openai_failure → retry succeeded". */
  previousFailReason: string | null;
}

/** Pick out the inline-generate params from the stored job payload.
 *  Defensive defaults keep older rows (pre-payload-shape changes) from
 *  blowing up the retry. */
function paramsFromPayload(jobId: string, payload: any): InlineGenerateParams {
  return {
    jobId,
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
    // Skip analyzeBrief on retry if we already cached its result on the
    // first run. Saves an OpenAI call and ~2-5 seconds.
    briefSnapshot:      payload.briefSnapshot ?? undefined,
    // Tag so diagnostics record this as a retry dispatch, not the
    // original /api/generate worker-mode. Ops uses this to compute
    // retry success rate distinct from first-attempt success rate.
    workerMode:         "retry",
  };
}

/** Atomically reset a FAILED job back to PENDING so a fresh worker can
 *  pick it up. Returns the params needed to dispatch the retry.
 *
 *  Throws RetryNotAllowedError on every "this is a no-op" path so the
 *  caller (route handler or auto-retry inside inlineGenerate's catch)
 *  can map each rejection to a clean HTTP status / log line.
 *
 *  When called by the auto-retry path inside the inline pipeline,
 *  pass userId=null to skip the per-user ownership check (the inline
 *  pipeline already knows it owns the job). */
export async function prepareRetry(
  jobId:  string,
  userId: string | null,
): Promise<PrepareRetryResult> {
  const job = await prisma.job.findFirst({
    where: { id: jobId, ...(userId ? { userId } : {}) },
  });
  if (!job) {
    throw new RetryNotAllowedError("not_found", `Job ${jobId} not found`);
  }
  if (job.status !== "FAILED") {
    throw new RetryNotAllowedError(
      "not_failed",
      `Job ${jobId} is ${job.status}; only FAILED jobs can be retried`,
    );
  }

  const display = formatJobError({
    status: job.status,
    result: job.result as any,
    error:  (job.result as any)?.error ?? undefined,
  });
  // Auto-retry uses the AUTO_RETRYABLE table, not display.retryable.
  // display.retryable drives the UI's manual-retry button (we want
  // that visible for slow-path failures so users can re-attempt
  // with the same prompt). isAutoRetryable() is server-side: would
  // running this exact failure again on the same hardware right now
  // realistically change the outcome? For "timeout" /
  // "empty_gallery" / "unknown" the answer is no — auto-retrying
  // those just burns 18 more minutes of the 27-min triple-attempt
  // ladder for no gain.
  if (!isAutoRetryable(display.reason)) {
    throw new RetryNotAllowedError(
      "not_retryable",
      `Job ${jobId} failed with reason "${display.reason}" — not auto-retryable. ` +
      `(UI manual retry remains available.)`,
    );
  }

  const used  = job.attempts ?? 0;
  // Use the row's maxAttempts when set, but never exceed the global cap.
  const limit = Math.min(job.maxAttempts ?? MAX_TOTAL_ATTEMPTS, MAX_TOTAL_ATTEMPTS);
  if (used >= limit) {
    throw new RetryNotAllowedError(
      "attempts_exhausted",
      `Job ${jobId} has used ${used}/${limit} attempts; retry limit reached`,
    );
  }

  if (!job.payload) {
    throw new RetryNotAllowedError(
      "payload_missing",
      `Job ${jobId} has no payload to retry from (likely a legacy row pre-payload-persistence)`,
    );
  }

  // Atomic claim: only the first concurrent retry click flips the row.
  // The second sees count=0 and bails — no double-fire risk.
  const previousResult = (job.result ?? {}) as Record<string, unknown>;
  const previousFailReason = (previousResult.failReason as string) ?? null;
  const claim = await prisma.job.updateMany({
    where: {
      id:     jobId,
      status: JobStatus.FAILED,
    },
    data: {
      status:    JobStatus.PENDING,
      startedAt: null,
      failedAt:  null,
      progress:  0,
      result: {
        // Carry forward the previous failure context so audit logs
        // and the UI can show "retried after openai_failure (attempt 2/3)".
        retryFromReason:   previousFailReason,
        retryFromError:    previousResult.error ?? null,
        previousAttempts:  used,
        // The poller in /api/jobs treats this as a normal PENDING row
        // and will resume it. Mirror the inlineGenerated marker so the
        // downstream COMPLETED write looks identical to a first-pass run.
        inlineGenerated:   true,
      } as any,
    },
  }).catch(() => ({ count: 0 }));

  if (claim.count !== 1) {
    throw new RetryNotAllowedError(
      "claim_lost",
      `Job ${jobId} retry race lost — another worker reset the row first`,
    );
  }

  return {
    jobId,
    attemptsUsed:       used,
    maxAttempts:        limit,
    params:             paramsFromPayload(jobId, job.payload),
    previousFailReason,
  };
}
