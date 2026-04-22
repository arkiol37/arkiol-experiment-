// src/lib/jobDiagnostics.ts
//
// Structured per-job failure diagnostics.
//
// The production debugging nightmare this module exists to end:
//
//   A user reports "generation failed 30 seconds in". Ops looks at the
//   job row. `result.error: "Request failed with status 502"`. That's
//   it. No stage, no elapsed time, no worker mode, no context about
//   whether the OpenAI call, S3 upload, or render step threw. The only
//   way to diagnose is to grep serverless logs for the jobId and hope
//   the container that ran the job hasn't been recycled yet.
//
// What this module adds:
//
//   • A canonical stage taxonomy (JobFailStage) so every failure is
//     classifiable: "init" vs "brief_analyze" vs "pipeline_render" vs
//     "s3_upload" vs "credit_deduction" vs "terminal_write". Rolled
//     into a compact enum so dashboards can pivot by stage.
//
//   • A DiagnosticsCollector that the inline pipeline calls at every
//     stage boundary. It records: current stage, per-stage start time
//     + duration, per-class failure counters (OpenAI 5xx count, render
//     crash count, S3 upload error count), and the sequence of stages
//     actually entered. Snapshotting it is a pure operation so the
//     catch handler can stash it in result.diagnostics.
//
//   • The canonical WorkerMode taxonomy. durableRun writes the chosen
//     strategy; the collector records it alongside the stage
//     breakdown. Now ops can see "inline_fire_and_forget jobs fail at
//     rate X% vs queue jobs at rate Y%" from a single query.
//
// This module is pure TypeScript — no DB, no external calls. The catch
// handler in runInlineGeneration persists `tracker.snapshot()` to
// job.result.diagnostics. The admin dashboard reads it back.

/** Every stage the inline generation pipeline moves through. Ordered
 *  here so a linter / test can pin the canonical sequence. */
export type JobFailStage =
  | "init"                 // job record loaded, heartbeat started
  | "font_init"            // font downloads & registry build
  | "mark_running"         // DB write flipping PENDING→RUNNING
  | "brand_load"           // brand kit fetch
  | "brief_analyze"        // analyzeBrief OpenAI call
  | "pipeline_render"      // orchestrator + per-variation renders
  | "rank_select"          // best-N selection + floor-fill
  | "s3_upload"            // generated-asset uploads
  | "credit_deduction"     // org credit balance decrement
  | "terminal_write"       // final status write (COMPLETED or FAILED)
  // Non-inline stages (watchdog-owned, surfaced for parity).
  | "stale_watchdog"       // backend stale watchdog flipped the row
  | "client_abandoned"     // client UI gave up before any terminal row
  | "unknown";             // default for legacy rows

export const JOB_FAIL_STAGES: readonly JobFailStage[] = [
  "init", "font_init", "mark_running", "brand_load", "brief_analyze",
  "pipeline_render", "rank_select", "s3_upload", "credit_deduction",
  "terminal_write", "stale_watchdog", "client_abandoned", "unknown",
] as const;

/** Which dispatch path the job actually ran under. Used for error-rate
 *  comparison — e.g. is fire_and_forget correlated with more failures
 *  than next_after? */
export type WorkerMode =
  | "queue"
  | "next_after"
  | "vercel_waitUntil"
  | "fire_and_forget"
  | "poller_resume"
  | "retry";

export const WORKER_MODES: readonly WorkerMode[] = [
  "queue", "next_after", "vercel_waitUntil", "fire_and_forget",
  "poller_resume", "retry",
] as const;

/** Per-class failure counters. Each category stores a count + the most
 *  recent message so a single field in the diagnostics bundle answers
 *  "what did OpenAI last complain about for this job". */
export interface FailureClassCounter {
  count:       number;
  lastMessage: string | null;
}

/** The canonical shape persisted in `job.result.diagnostics` on both
 *  terminal states. Admin UI renders this directly. */
export interface JobDiagnostics {
  /** Which stage was active when the error fired. For COMPLETED jobs
   *  this is "terminal_write". */
  failStage:        JobFailStage;
  /** The DurableRun strategy that owned this run. */
  workerMode:       WorkerMode;
  /** Wall-clock ms from tracker.start() to snapshot(). */
  elapsedMs:        number;
  /** Per-stage entries, in order. Each entry has `stage` + `enteredAt`
   *  + `durationMs` (undefined for the still-active final stage). */
  stages: Array<{
    stage:      JobFailStage;
    enteredAt:  number;
    durationMs: number | null;
  }>;
  /** Failure counters per class. Zero counts are omitted by
   *  `snapshot()` to keep the payload compact. */
  openaiFailures:   FailureClassCounter;
  renderFailures:   FailureClassCounter;
  storageFailures:  FailureClassCounter;
  /** Stale watchdog diagnostic carry-forward (populated when the
   *  backend watchdog flipped the row to FAILED). Preserves the three
   *  values evaluateStale() produced: heartbeat gap, runningMs,
   *  expectedMs. */
  staleDiagnostic?: {
    heartbeatGapMs: number;
    runningMs:      number;
    expectedMs:     number;
    reason:         string;
  } | null;
  /** Attempt sequencing — sourced from the job row, repeated here so
   *  dashboards don't need a second query. */
  attempt:       number;
  maxAttempts:   number;
  /** Capability snapshot at run time. Ops needs this to distinguish
   *  "storage_failure because S3 wasn't configured" from "storage
   *  failed despite being configured". */
  capabilitySnapshot?: Record<string, boolean>;
}

/** Builder-style accumulator. runInlineGeneration creates one of these
 *  at the top of the run, calls `enterStage()` as it progresses, pipes
 *  caught sub-failures into `recordFailure()`, and finally
 *  `snapshot()`s into the DB row. */
export class DiagnosticsCollector {
  private startedAt:  number;
  private stages:     Array<{ stage: JobFailStage; enteredAt: number; durationMs: number | null }> = [];
  private currentStage: JobFailStage = "init";
  private workerMode: WorkerMode;
  private openai:  FailureClassCounter = { count: 0, lastMessage: null };
  private render:  FailureClassCounter = { count: 0, lastMessage: null };
  private storage: FailureClassCounter = { count: 0, lastMessage: null };
  private stale:   JobDiagnostics["staleDiagnostic"] = null;
  private attempt:     number;
  private maxAttempts: number;
  private capabilitySnapshot?: Record<string, boolean>;

  constructor(opts: {
    workerMode:  WorkerMode;
    attempt:     number;
    maxAttempts: number;
    now?:        () => number;
    capabilitySnapshot?: Record<string, boolean>;
  }) {
    this.workerMode  = opts.workerMode;
    this.attempt     = opts.attempt;
    this.maxAttempts = opts.maxAttempts;
    this.startedAt   = (opts.now ?? Date.now)();
    this.capabilitySnapshot = opts.capabilitySnapshot;
    this.stages.push({ stage: "init", enteredAt: this.startedAt, durationMs: null });
  }

  /** Mark a stage boundary. Closes the previous entry's `durationMs`
   *  and opens a new one. Calling enterStage with the already-current
   *  stage is a no-op so repeated calls from loop bodies don't bloat
   *  the stage list. */
  enterStage(stage: JobFailStage, now: number = Date.now()): void {
    if (stage === this.currentStage) return;
    const prev = this.stages[this.stages.length - 1];
    if (prev) prev.durationMs = Math.max(0, now - prev.enteredAt);
    this.stages.push({ stage, enteredAt: now, durationMs: null });
    this.currentStage = stage;
  }

  currentFailStage(): JobFailStage { return this.currentStage; }

  /** Record a sub-failure without terminating the run (e.g. a single
   *  OpenAI call timed out but the batch as a whole is still trying).
   *  The outer catch handler uses `snapshot().failStage` to classify
   *  the terminal failure. */
  recordFailure(kind: "openai" | "render" | "storage", err: unknown): void {
    const msg = (err as any)?.message ?? String(err ?? "unknown");
    const counter =
      kind === "openai"  ? this.openai  :
      kind === "render"  ? this.render  :
                           this.storage;
    counter.count += 1;
    counter.lastMessage = msg.slice(0, 500); // bounded so we don't bloat the row
  }

  /** Carry forward the stale watchdog verdict (called from the
   *  watchdog path, not the inline pipeline). */
  setStaleDiagnostic(s: NonNullable<JobDiagnostics["staleDiagnostic"]>): void {
    this.stale = s;
  }

  /** Snapshot to JSON-safe shape. Closes the currently-open stage's
   *  durationMs so the rendered breakdown is complete. */
  snapshot(now: number = Date.now()): JobDiagnostics {
    const last = this.stages[this.stages.length - 1];
    if (last && last.durationMs === null) last.durationMs = Math.max(0, now - last.enteredAt);
    return {
      failStage:  this.currentStage,
      workerMode: this.workerMode,
      elapsedMs:  Math.max(0, now - this.startedAt),
      stages:     this.stages.map(s => ({ ...s })),
      openaiFailures:  { ...this.openai  },
      renderFailures:  { ...this.render  },
      storageFailures: { ...this.storage },
      staleDiagnostic: this.stale ?? null,
      attempt:         this.attempt,
      maxAttempts:     this.maxAttempts,
      capabilitySnapshot: this.capabilitySnapshot,
    };
  }
}

/** Normalise whatever shape landed on an older `job.result` into a
 *  JobDiagnostics-compatible view. Keeps the admin UI from having to
 *  guard against `undefined` on every field for legacy rows. */
export function readDiagnostics(result: unknown): JobDiagnostics | null {
  if (!result || typeof result !== "object") return null;
  const d = (result as Record<string, unknown>).diagnostics;
  if (!d || typeof d !== "object") return null;
  const raw = d as Record<string, unknown>;
  const stages = Array.isArray(raw.stages) ? raw.stages.map(s => ({
    stage:      String((s as any)?.stage ?? "unknown") as JobFailStage,
    enteredAt:  Number((s as any)?.enteredAt ?? 0),
    durationMs: (s as any)?.durationMs == null ? null : Number((s as any).durationMs),
  })) : [];
  return {
    failStage:  (String(raw.failStage ?? "unknown") as JobFailStage),
    workerMode: (String(raw.workerMode ?? "fire_and_forget") as WorkerMode),
    elapsedMs:  Number(raw.elapsedMs ?? 0),
    stages,
    openaiFailures:  (raw.openaiFailures  as FailureClassCounter) ?? { count: 0, lastMessage: null },
    renderFailures:  (raw.renderFailures  as FailureClassCounter) ?? { count: 0, lastMessage: null },
    storageFailures: (raw.storageFailures as FailureClassCounter) ?? { count: 0, lastMessage: null },
    staleDiagnostic: (raw.staleDiagnostic as any) ?? null,
    attempt:     Number(raw.attempt     ?? 0),
    maxAttempts: Number(raw.maxAttempts ?? 0),
    capabilitySnapshot: (raw.capabilitySnapshot as Record<string, boolean>) ?? undefined,
  };
}
