// apps/render-backend/src/lib/runGeneration.ts
//
// Render-side owner of the job lifecycle.
//
// Why this exists:
//   On Render's 0.5-CPU starter plan, the heavy generation pipeline
//   (sharp/libvips, large SVG assembly, JSON.stringify of fat
//   candidate sets) frequently stalls the Node main event loop for
//   tens of seconds at a time. The previous in-process setInterval
//   heartbeat lived on the SAME loop as runInlineGeneration —
//   when the loop wedged, the timer queue stalled too and Vercel's
//   polling watchdog flipped the row to FAILED with "no worker
//   heartbeat for 240s", even though the worker was alive and
//   making progress.
//
//   This wrapper now offloads the heartbeat to a separate worker
//   THREAD (heartbeatWorker.cjs) with its own libuv event loop and
//   its own pg connection. Even if the main thread is wedged for
//   a full minute, the worker thread keeps writing pulses to the
//   job row. Vercel's polling watchdog sees the row's updatedAt
//   advancing and never trips.
//
// Lifecycle the wrapper writes:
//
//   accept       → log "job accepted"
//                → atomic PENDING → RUNNING claim
//                  (status, startedAt, progress=1, attempts++)
//                → log "RUNNING written"
//                → spawn heartbeat worker thread
//   …            → worker thread updates row every WATCHDOG_INTERVAL_MS
//                → main thread runs runInlineGeneration; the inner
//                  pipeline writes its own per-stage progress bumps
//                  and the final COMPLETED row
//   pipeline ok  → log "completed"
//                → worker thread sees terminal status on next tick,
//                  exits cleanly. Wrapper also explicitly stops it.
//   pipeline err → log "failure" with stack trace
//                → wrapper writes FAILED with the real exception
//                  message and result.failReason='render_backend_error'
//                  (skipped if the inner pipeline already wrote a
//                  richer terminal row).
//                → wrapper stops the worker thread.
//
// All wrapper writes are best-effort — a transient DB hiccup must
// never kill the in-flight generation.
import { Worker } from 'node:worker_threads';
import * as path from 'node:path';
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
 * Render-owned watchdog heartbeat (in a separate worker thread)
 * and explicit FAILED-write on any thrown error.
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

  log('accepted', tagged.jobId, {
    formats:    tagged.formats,
    variations: tagged.variations,
    locale:     tagged.locale,
  });

  void runWithWatchdog(tagged);
}

interface HeartbeatHandle {
  stop: () => Promise<void>;
}

async function runWithWatchdog(params: RenderGenerationParams): Promise<void> {
  const { jobId } = params;

  // ── 1. Atomic PENDING → RUNNING claim ───────────────────────────────────
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
    log('claim_error', jobId, { message: err?.message ?? String(err) });
    return { count: 0 };
  });

  if (claim.count === 1) {
    log('claimed', jobId, { from: 'PENDING', to: 'RUNNING' });
    log('running_written', jobId, {});
  } else {
    // Some other process has already claimed this row (legitimate
    // double-dispatch is not possible in the production flow, so
    // this branch is the result of a previous wrapper run that
    // crashed mid-flight). Inspect the row: if it's already
    // terminal there's nothing to do; if it's RUNNING from a
    // genuinely-alive other worker we DON'T want to run the
    // pipeline a second time (would race the COMPLETED write
    // and double-charge credits).
    const existing = await prisma.job.findUnique({
      where:  { id: jobId },
      select: { status: true, updatedAt: true },
    }).catch(() => null);
    log('claim_skipped', jobId, {
      count:  claim.count,
      status: existing?.status ?? null,
    });
    if (
      existing?.status === JobStatus.COMPLETED ||
      existing?.status === JobStatus.FAILED ||
      existing?.status === JobStatus.RUNNING
    ) {
      // Defer to whoever has it. Stale-watchdog will catch a
      // genuinely dead RUNNING worker via the heartbeat-gap path.
      log('deferring_to_existing_owner', jobId, { status: existing.status });
      return;
    }
    // PENDING but our updateMany still saw count=0 — odd. The
    // inner pipeline's own claim will retry; if it ALSO fails
    // we'll catch the silent return below and mark FAILED.
  }

  // ── 2. Spawn heartbeat worker thread ────────────────────────────────────
  // Truly out-of-loop. Writes a progress pulse every
  // WATCHDOG_INTERVAL_MS no matter what the main thread is doing.
  const heartbeat = startHeartbeatWorker(jobId);

  // ── 3. Run the inner pipeline + own the FAILED-on-throw write ───────────
  // We set skipClaim=true because step 1 already flipped
  // PENDING→RUNNING. Without this, runInlineGeneration would
  // re-issue its own atomic claim, see count=0 (we just consumed
  // the PENDING state), log "already claimed by another worker —
  // bailing" and return immediately — no assets ever generated.
  // That was the production-blocking stall.
  log('inline_started', jobId, { skipClaim: claim.count === 1 });
  let crashed = false;
  let crashMessage = '';
  let crashStack:   string | null = null;
  try {
    await runInlineGeneration({ ...params, skipClaim: claim.count === 1 });
    // Verify generation actually produced assets before declaring
    // success. The inner pipeline writes COMPLETED with assetIds;
    // if for any reason it returned without writing the terminal
    // row we mark this run as a failure rather than letting the
    // wrapper's "completed" log mislead operators.
    const verify = await prisma.job.findUnique({
      where:  { id: jobId },
      select: { status: true, result: true },
    });
    const assetIds = (verify?.result as any)?.assetIds as string[] | undefined;
    const assetCount = Array.isArray(assetIds) ? assetIds.length : 0;
    if (verify?.status === JobStatus.COMPLETED && assetCount > 0) {
      log('assets_created', jobId, { assetCount });
      log('completed', jobId, { assetCount });
    } else if (verify?.status === JobStatus.FAILED) {
      log('completed_skipped_failed', jobId, {
        reason: (verify?.result as any)?.failReason ?? null,
      });
    } else {
      // Pipeline returned without writing a terminal row — treat
      // as a silent failure rather than letting the heartbeat
      // watchdog catch it 6 minutes from now.
      crashed = true;
      crashMessage = `Inner pipeline returned without writing COMPLETED (status=${verify?.status ?? "unknown"}, assetCount=${assetCount})`;
      log('inline_returned_without_terminal', jobId, {
        status:     verify?.status ?? null,
        assetCount,
      });
    }
  } catch (err: any) {
    crashed = true;
    crashMessage = err?.message ?? String(err);
    crashStack   = typeof err?.stack === 'string' ? err.stack : null;
    log('failure', jobId, {
      message: crashMessage,
      stack:   crashStack ? crashStack.split('\n').slice(0, 6).join('\n') : null,
    });
  } finally {
    await heartbeat.stop().catch(() => { /* best-effort */ });
  }

  if (crashed) {
    // Only write FAILED if the row isn't already terminal — the
    // inner pipeline's own catch path may have already recorded a
    // richer `result.diagnostics` payload.
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
              stack:      crashStack ? crashStack.split('\n').slice(0, 8).join('\n') : null,
            } as any,
          },
        });
        log('failed_written', jobId, {});
      } else {
        log('failed_skipped', jobId, {
          reason: 'inner_already_terminal',
          status: final?.status ?? null,
        });
      }
    } catch (writeErr: any) {
      log('failed_write_error', jobId, { message: writeErr?.message ?? String(writeErr) });
    }
  }
}

/** Spawn the heartbeat worker thread for the given job. The
 *  thread runs heartbeatWorker.cjs in its own event loop, opens
 *  its own pg connection, and pulses every WATCHDOG_INTERVAL_MS
 *  until told to stop. */
function startHeartbeatWorker(jobId: string): HeartbeatHandle {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    log('heartbeat_disabled', jobId, { reason: 'no_database_url' });
    return { stop: async () => { /* no-op */ } };
  }

  const workerPath = path.resolve(__dirname, 'heartbeatWorker.cjs');
  const worker = new Worker(workerPath, {
    workerData: {
      jobId,
      intervalMs: WATCHDOG_INTERVAL_MS,
      databaseUrl,
    },
  });

  worker.on('message', (msg: any) => {
    log(`heartbeat_${msg?.type ?? 'unknown'}`, jobId, msg);
  });
  worker.on('error', (err: Error) => {
    log('heartbeat_worker_error', jobId, {
      message: err?.message,
      stack:   err?.stack?.split('\n').slice(0, 4).join('\n'),
    });
  });
  worker.on('exit', (code: number) => {
    log('heartbeat_worker_exit', jobId, { code });
  });

  return {
    stop: async () => {
      try { worker.postMessage('stop'); } catch { /* ignore */ }
      // 1.5s grace for the worker to disconnect pg cleanly. After
      // that, force-terminate so we don't leak threads.
      await new Promise<void>((resolve) => setTimeout(resolve, 1_500));
      try { await worker.terminate(); } catch { /* ignore */ }
    },
  };
}

/** Single structured logger so Render's logs are easy to grep.
 *  Each line is one JSON object preceded by [render-backend] so it
 *  shows up cleanly in the Render dashboard's log viewer. */
function log(event: string, jobId: string, extra: Record<string, unknown>): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    event,
    jobId,
    ...extra,
  });
  // eslint-disable-next-line no-console
  console.log(`[render-backend] ${line}`);
}
