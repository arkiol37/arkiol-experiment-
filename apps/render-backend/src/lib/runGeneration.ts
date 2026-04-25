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
//   This wrapper offloads the heartbeat to a separate worker
//   THREAD (heartbeatWorker.cjs) with its own libuv event loop and
//   its own pg connection. Even if the main thread is wedged for a
//   full minute, the worker thread keeps writing pulses to the job
//   row.
//
// Lifecycle correctness contract (the bug this fix exists to kill):
//
//   The frontend's "Still waiting on a response — we haven't
//   received an update in 15 minutes" message fires when the row
//   is stuck in PENDING/RUNNING for hardAbandonMs. That happens
//   when the wrapper's previous "log completed and exit" path ran
//   even though the inner pipeline never wrote a terminal row.
//
//   This wrapper now treats the inner pipeline's RETURN as
//   advisory — the only authoritative completion signal is:
//     1. job.status === COMPLETED in the database, AND
//     2. job.result.assetIds.length > 0, AND
//     3. that many rows exist in the asset table.
//
//   Anything else is a wrapper-side FAILED write with a clear
//   error message so the row reaches a terminal state and the
//   frontend renders a real error instead of a 15-minute spinner.

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

/** Verbatim error written to result.error when the inner pipeline
 *  returns without writing COMPLETED or with empty assetIds. The
 *  UI surfaces this through the existing FAILED → result.error
 *  channel (formatJobError in the core app). */
export const NO_ASSETS_ERROR = 'Render generation returned without producing assets';

/**
 * Start the heavy generation job in the background, with a
 * Render-owned watchdog heartbeat (in a separate worker thread)
 * and explicit FAILED-write on any thrown error or empty result.
 *
 * Returns immediately after scheduling. The Express handler
 * responds 202 to the Vercel forwarder; the frontend polls
 * /api/jobs?id=<jobId> for status updates.
 */
export function scheduleRenderGeneration(params: RenderGenerationParams): void {
  const tagged: RenderGenerationParams = {
    ...params,
    workerMode: params.workerMode ?? 'render_backend',
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

/** Hard wall-clock timeout for any single DB call inside the
 *  wrapper. Mirrors the approach in inlineGenerate.ts: a hung
 *  PgBouncer must never leave the row stuck — every write either
 *  succeeds inside the budget or surfaces as a logged failure
 *  while we move on. */
const WRAPPER_DB_TIMEOUT_MS = 30_000;
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms,
    );
    timer.unref?.();
  });
  return Promise.race([p, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  }) as Promise<T>;
}

async function runWithWatchdog(params: RenderGenerationParams): Promise<void> {
  const { jobId } = params;

  // ── 1. Atomic PENDING → RUNNING claim ───────────────────────────────────
  // Wrapped in withTimeout so a hung PgBouncer at the very start
  // doesn't leave the wrapper waiting forever — we'd rather
  // surface a "claim_error" log and let the inner pipeline's own
  // claim path handle it.
  const claim = await withTimeout(
    prisma.job.updateMany({
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
    }),
    WRAPPER_DB_TIMEOUT_MS,
    "wrapper PENDING→RUNNING claim",
  ).catch((err) => {
    log('claim_error', jobId, { message: err?.message ?? String(err) });
    return { count: 0 };
  }) as { count: number };

  if (claim.count === 1) {
    log('claimed', jobId, { from: 'PENDING', to: 'RUNNING' });
  } else {
    // Some other process has already claimed this row (legitimate
    // double-dispatch is not possible in the production flow, so
    // this branch is the result of a previous wrapper run that
    // crashed mid-flight). Inspect the row: if it's already
    // terminal there's nothing to do; if it's RUNNING from a
    // genuinely-alive other worker we DON'T want to run the
    // pipeline a second time (would race the COMPLETED write
    // and double-charge credits).
    const existing = await withTimeout(
      prisma.job.findUnique({
        where:  { id: jobId },
        select: { status: true, updatedAt: true },
      }),
      WRAPPER_DB_TIMEOUT_MS,
      "wrapper claim_skipped existing-row read",
    ).catch(() => null) as { status: string | null; updatedAt: Date | null } | null;
    log('claim_skipped', jobId, {
      count:  claim.count,
      status: existing?.status ?? null,
    });
    if (
      existing?.status === JobStatus.COMPLETED ||
      existing?.status === JobStatus.FAILED ||
      existing?.status === JobStatus.RUNNING
    ) {
      log('deferring_to_existing_owner', jobId, { status: existing.status });
      return;
    }
  }

  // ── 2. Spawn heartbeat worker thread ────────────────────────────────────
  const heartbeat = startHeartbeatWorker(jobId);

  // ── 3. Run the inner pipeline ───────────────────────────────────────────
  // We pass skipClaim=true because step 1 already flipped
  // PENDING→RUNNING. Without this, runInlineGeneration would
  // re-issue its own atomic claim, see count=0 (we just consumed
  // the PENDING state), log "already claimed by another worker —
  // bailing" and return immediately — no assets ever generated.
  // That was the production-blocking stall.
  log('inline_generation_started', jobId, { skipClaim: claim.count === 1 });
  let crashed = false;
  let crashMessage = '';
  let crashStack:   string | null = null;
  try {
    await runInlineGeneration({ ...params, skipClaim: claim.count === 1 });
    log('inline_generation_returned', jobId, {});
  } catch (err: any) {
    crashed = true;
    crashMessage = err?.message ?? String(err);
    crashStack   = typeof err?.stack === 'string' ? err.stack : null;
    log('failure', jobId, {
      message: crashMessage,
      stack:   crashStack ? crashStack.split('\n').slice(0, 6).join('\n') : null,
    });
  }

  // ── 4. Verify the DB row reached a real terminal state ─────────────────
  // The inner pipeline's RETURN is advisory; the row state is
  // authoritative. Three outcomes:
  //   - COMPLETED + assetIds.length > 0 + assets exist → completed_real
  //   - FAILED                                          → preserve real error
  //   - anything else                                   → failed_real with
  //                                                       NO_ASSETS_ERROR
  const verify = await readVerify(jobId);
  log('final_db_status_after_generation', jobId, {
    status:     verify?.status ?? null,
    assetCount: verify?.assetCount ?? 0,
  });
  log('assets_created_count', jobId, { count: verify?.assetCount ?? 0 });

  let terminalWritten = false;

  if (
    !crashed &&
    verify?.status === JobStatus.COMPLETED &&
    verify.assetCount > 0
  ) {
    // Real success.
    log('completed_real', jobId, { assetCount: verify.assetCount });
    terminalWritten = true;
  } else if (verify?.status === JobStatus.FAILED) {
    // Inner pipeline (or a prior failure path) already wrote FAILED.
    // Preserve the real error — do NOT overwrite.
    log('failed_real', jobId, {
      reason:   (verify.result as any)?.failReason ?? null,
      message:  (verify.result as any)?.error ?? null,
      preserved: true,
    });
    terminalWritten = true;
  } else {
    // Either:
    //   (a) inner threw → crashed === true
    //   (b) inner returned but row is still PENDING/RUNNING, or
    //       COMPLETED with empty assetIds, or COMPLETED but the
    //       referenced asset rows do not exist in the asset table.
    // Both → wrapper-side FAILED write with the spec'd message.
    const message = crashed
      ? (crashMessage || NO_ASSETS_ERROR)
      : NO_ASSETS_ERROR;
    const writeOk = await writeFailedTerminal(jobId, {
      message,
      stack:   crashStack,
      reason:  crashed ? 'render_backend_error' : 'no_assets_produced',
      diagnostics: {
        liveStatus:        verify?.status ?? null,
        assetIdsInResult:  verify?.assetIdsInResult ?? 0,
        assetRowsInDb:     verify?.assetCount ?? 0,
        crashed,
      },
    });
    if (writeOk) {
      log('failed_real', jobId, {
        message,
        reason: crashed ? 'render_backend_error' : 'no_assets_produced',
      });
      terminalWritten = true;
    }
  }

  // ── 5. Stop heartbeat ────────────────────────────────────────────────────
  // Always after the terminal write so the heartbeat keeps the row
  // updatedAt fresh while we're verifying/writing FAILED. Stops
  // only after the row reaches a real terminal state.
  await heartbeat.stop().catch(() => { /* best-effort */ });

  if (!terminalWritten) {
    // Both the row inspection AND the FAILED write somehow failed.
    // This is the worst case (likely a DB outage). Vercel's stale
    // watchdog will eventually mark the row FAILED via the
    // heartbeat-gap path; nothing more we can do here.
    log('terminal_write_lost', jobId, {});
  }
}

/** Re-read the job + count actual asset rows. Returns
 *  null if the row vanished. */
async function readVerify(jobId: string): Promise<
  | null
  | {
      status: string | null;
      result: unknown;
      assetIdsInResult: number;
      assetCount: number;
    }
> {
  try {
    const row = await withTimeout(
      prisma.job.findUnique({
        where:  { id: jobId },
        select: { status: true, result: true },
      }),
      WRAPPER_DB_TIMEOUT_MS,
      "verify job.findUnique",
    ) as { status: string | null; result: unknown } | null;
    if (!row) return null;
    const assetIds = (row.result as any)?.assetIds;
    const idsArray: string[] = Array.isArray(assetIds) ? assetIds.filter((x: unknown) => typeof x === 'string') : [];
    let assetCount = 0;
    if (idsArray.length > 0) {
      // Confirm the asset rows actually exist — guards against the
      // case where the inner pipeline wrote assetIds but the asset
      // INSERT was rolled back or never executed.
      try {
        assetCount = await withTimeout(
          prisma.asset.count({ where: { id: { in: idsArray } } }),
          WRAPPER_DB_TIMEOUT_MS,
          "verify asset.count",
        );
      } catch (err: any) {
        // If the asset.count itself fails (DB hiccup), we still
        // have the assetIds array — fall back to its length so we
        // don't FAIL a real success on a transient error.
        log('asset_count_query_failed', jobId, { message: err?.message ?? String(err) });
        assetCount = idsArray.length;
      }
    }
    return {
      status: row.status,
      result: row.result,
      assetIdsInResult: idsArray.length,
      assetCount,
    };
  } catch (err: any) {
    log('verify_read_failed', jobId, { message: err?.message ?? String(err) });
    return null;
  }
}

/** Atomically write a FAILED terminal row. Skipped if the row is
 *  already terminal (COMPLETED/FAILED) so we don't clobber a real
 *  success or a richer prior error. */
async function writeFailedTerminal(
  jobId:   string,
  fields: { message: string; stack: string | null; reason: string; diagnostics: Record<string, unknown> },
): Promise<boolean> {
  try {
    const final = await withTimeout(
      prisma.job.findUnique({
        where:  { id: jobId },
        select: { status: true, result: true },
      }),
      WRAPPER_DB_TIMEOUT_MS,
      "writeFailedTerminal pre-read",
    ) as { status: string | null; result: unknown } | null;
    if (!final) {
      log('failed_write_skipped', jobId, { reason: 'row_missing' });
      return false;
    }
    if (final.status === JobStatus.COMPLETED || final.status === JobStatus.FAILED) {
      log('failed_write_skipped', jobId, {
        reason: 'inner_already_terminal',
        status: final.status,
      });
      return false;
    }
    await withTimeout(prisma.job.update({
      where: { id: jobId },
      data: {
        status:   JobStatus.FAILED,
        failedAt: new Date(),
        result:   {
          ...((final.result as Record<string, unknown> | null) ?? {}),
          error:       fields.message,
          failReason:  fields.reason,
          stack:       fields.stack ? fields.stack.split('\n').slice(0, 8).join('\n') : null,
          renderDiagnostics: fields.diagnostics,
        } as any,
      },
    }), WRAPPER_DB_TIMEOUT_MS, "writeFailedTerminal job.update");
    log('failed_written', jobId, { reason: fields.reason });
    return true;
  } catch (writeErr: any) {
    log('failed_write_error', jobId, { message: writeErr?.message ?? String(writeErr) });
    return false;
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
