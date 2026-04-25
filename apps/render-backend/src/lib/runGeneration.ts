// apps/render-backend/src/lib/runGeneration.ts
//
// Render-side owner of the job lifecycle.
//
// Why this exists:
//   The inner generation pipeline (`runInlineGeneration` from the
//   core app) owns the per-stage progress writes and the final
//   COMPLETED row, but its in-pipeline `setInterval` heartbeat can
//   stall on Render's 0.5-CPU starter plan when sharp/libvips
//   bursts saturate the event loop. When that happens the Vercel
//   polling watchdog flips the job to FAILED with "no worker
//   heartbeat for 240s", even though the worker is still alive
//   and progressing.
//
//   This wrapper adds an INDEPENDENT watchdog heartbeat that
//   updates the job row from the Render Express handler's own
//   timer — completely outside the inner pipeline's call stack.
//   So even if `runInlineGeneration` is wedged on a sync libvips
//   burst, the wrapper's heartbeat still fires (Node timers are
//   resilient to short-running sync work between ticks; the
//   wrapper does no sync work of its own).
//
//   The wrapper also owns the PENDING → RUNNING transition (so
//   the row reaches RUNNING the moment Render accepts the job,
//   not after analyzeBrief finishes inside the inner pipeline)
//   and writes a real FAILED row when the inner pipeline throws,
//   so a crashing pipeline doesn't leak as a "stale_worker"
//   verdict at the 240s mark.
//
// Lifecycle this wrapper writes:
//
//   accept       → RUNNING (startedAt, progress=1, workerMode='render_backend')
//   …            → heartbeat tick every WATCHDOG_INTERVAL_MS,
//                  updating updatedAt (and progress when the inner
//                  pipeline has bumped it past our last value)
//   pipeline ok  → leave row alone (inner pipeline already wrote
//                  COMPLETED on its own atomic claim)
//   pipeline err → FAILED with the real exception message in
//                  result.error; failReason='render_backend_error'
//
// All writes are best-effort: a transient DB hiccup never kills
// the in-flight generation. The watchdog stops only after the row
// reaches a terminal state (COMPLETED / FAILED) or the inner
// pipeline returns / throws.

import { JobStatus } from '@prisma/client';
import { prisma } from './prisma';
import {
  runInlineGeneration,
  type InlineGenerateParams,
} from '../../../arkiol-core/src/lib/inlineGenerate';

export type RenderGenerationParams = InlineGenerateParams;

const WATCHDOG_INTERVAL_MS = 12_000;

/**
 * Start the heavy generation job in the background, with a
 * Render-owned watchdog heartbeat and explicit FAILED-write on
 * any thrown error.
 *
 * Returns immediately after scheduling. The Express handler
 * responds 202 to the Vercel forwarder; the frontend polls
 * /api/jobs?id=<jobId> for status updates.
 */
export function scheduleRenderGeneration(params: RenderGenerationParams): void {
  const tagged: RenderGenerationParams = {
    ...params,
    workerMode: params.workerMode ?? ('render_backend' as any),
  };

  void runWithWatchdog(tagged);
}

/** Internal: own the RUNNING transition + watchdog timer +
 *  terminal-state cleanup. */
async function runWithWatchdog(params: RenderGenerationParams): Promise<void> {
  const { jobId } = params;

  // ── 1. Atomic PENDING → RUNNING claim ───────────────────────────────────
  // Race-safe: only the first wrapper to see startedAt=null wins.
  // The inner pipeline's own `mark_running` claim becomes a no-op
  // when ours already fired.
  const claim = await prisma.job.updateMany({
    where: {
      id:        jobId,
      status:    JobStatus.PENDING,
      startedAt: null,
    },
    data: {
      status:    JobStatus.RUNNING,
      startedAt: new Date(),
      progress:  1,
      attempts:  { increment: 1 },
    },
  }).catch((err) => {
    // eslint-disable-next-line no-console
    console.warn(
      `[render-backend] Could not flip job ${jobId} to RUNNING:`,
      err?.message ?? err,
    );
    return { count: 0 };
  });

  if (claim.count === 1) {
    // eslint-disable-next-line no-console
    console.info(`[render-backend] Job ${jobId} claimed → RUNNING`);
  } else {
    // eslint-disable-next-line no-console
    console.info(
      `[render-backend] Job ${jobId} already claimed (count=${claim.count}); ` +
      `running pipeline anyway — inner atomic claim will resolve.`,
    );
  }

  // ── 2. Independent heartbeat ────────────────────────────────────────────
  // Pulses updatedAt + progress every WATCHDOG_INTERVAL_MS.
  // Survives the inner pipeline blocking the event loop because:
  //   (a) this closure does no sync work — just an awaited DB write,
  //   (b) Node timer queue resumes on the very next free tick.
  let lastSeenProgress = 0;
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    try {
      const row = await prisma.job.findUnique({
        where:  { id: jobId },
        select: { status: true, progress: true },
      });
      if (!row) {
        stopped = true;
        return;
      }
      // Stop heartbeating once the row is terminal — the inner
      // pipeline (or our own catch path) wrote COMPLETED/FAILED.
      if (row.status === JobStatus.COMPLETED || row.status === JobStatus.FAILED) {
        stopped = true;
        return;
      }
      // Re-write progress to roll updatedAt forward. If the inner
      // pipeline already pushed progress past our last seen value,
      // copy that forward so the heartbeat doesn't visually
      // backtrack the bar.
      const next = Math.max(lastSeenProgress, row.progress ?? 0);
      lastSeenProgress = next;
      await prisma.job.update({
        where: { id: jobId },
        data:  { progress: next },
      });
    } catch (err: any) {
      // Best-effort — a transient DB error must never kill the
      // generation. Log once at warn so ops can spot a flapping
      // adapter without drowning the logs.
      // eslint-disable-next-line no-console
      console.warn(
        `[render-backend] Heartbeat write failed for job ${jobId}:`,
        err?.message ?? err,
      );
    }
  };
  const heartbeat = setInterval(() => { void tick(); }, WATCHDOG_INTERVAL_MS);
  // First pulse immediately so polling clients see updatedAt move
  // before the first 12s tick.
  void tick();

  // ── 3. Run the inner pipeline + own the FAILED-on-throw write ───────────
  let crashed = false;
  let crashMessage = '';
  try {
    await runInlineGeneration(params);
  } catch (err: any) {
    crashed = true;
    crashMessage = err?.message ?? String(err);
    // eslint-disable-next-line no-console
    console.error(
      `[render-backend] Inner generation threw for job ${jobId}:`,
      err?.stack ?? err,
    );
  } finally {
    stopped = true;
    clearInterval(heartbeat);
  }

  if (crashed) {
    // Only write FAILED if the row isn't already terminal — the
    // inner pipeline's own catch path may have already recorded a
    // richer `result.diagnostics` payload, and we don't want to
    // clobber it.
    try {
      const final = await prisma.job.findUnique({
        where:  { id: jobId },
        select: { status: true, result: true },
      });
      if (final && final.status !== JobStatus.COMPLETED && final.status !== JobStatus.FAILED) {
        await prisma.job.update({
          where: { id: jobId },
          data: {
            status:   JobStatus.FAILED,
            failedAt: new Date(),
            result:   {
              ...((final.result as Record<string, unknown> | null) ?? {}),
              error:      crashMessage || 'Generation crashed',
              failReason: 'render_backend_error',
            } as any,
          },
        });
        // eslint-disable-next-line no-console
        console.info(`[render-backend] Job ${jobId} marked FAILED after crash`);
      }
    } catch (writeErr: any) {
      // eslint-disable-next-line no-console
      console.error(
        `[render-backend] Could not write FAILED row for job ${jobId}:`,
        writeErr?.message ?? writeErr,
      );
    }
  }
}

