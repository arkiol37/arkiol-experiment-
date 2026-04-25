// src/lib/staleDetection.ts
//
// Stage-aware stale-job detection. Replaces the old flat
// `JOB_STALE_MS = 300_000` threshold that treated every job the same:
// a quick single-variation 15-sec render and a heavy 6-variation
// multi-format run had identical patience budgets. That was too
// aggressive for heavy runs and too slow for simple ones.
//
// Smart signal, in priority order:
//
//   1. HEARTBEAT GAP — the inline worker pulses every PULSE_INTERVAL_MS
//      (~10s). Any gap > HEARTBEAT_GAP_MS means the container is
//      genuinely dead, not just busy. This is the primary signal and
//      replaces the old flat minute-scale threshold — dense heartbeats
//      make second-scale freshness reliable.
//
//   2. RUNTIME CEILING — even a job that keeps heartbeating must eventually
//      terminate. If runningMs exceeds HARD_CEILING_MS the pipeline is
//      wedged (e.g. an internal infinite loop that still manages to
//      tick updatedAt). Kill it unconditionally.
//
//   3. EXPECTED DURATION — formats × variations scales the patience
//      window for jobs that never actually started. A 1-variation
//      PENDING job that sat silent for 3 minutes is dead. A 6-variation
//      PENDING job might legitimately be deep in cold start. We compute
//      the expected duration up front and only flag the never-started
//      case when total silence exceeds expectedMs + cushion.
//
//   4. RUNNING GRACE — freshly-RUNNING jobs get RUNNING_GRACE_MS of
//      headroom before a heartbeat gap flags them. Covers cold-start
//      pauses on the first pulse fire.
//
// Healthy path: evaluateStale returns { stale: false } cheaply after
// the first fresh-heartbeat check. Only truly dead jobs travel the
// full ladder.

export const PULSE_INTERVAL_MS  = 10_000;     // mirrors inlineGenerate.ts
/**
 * The "no heartbeat for X seconds" threshold. Was 90s, which works
 * fine for the BullMQ worker on a beefy Railway/Fly box but is too
 * aggressive for Render's starter plan (0.5 shared CPU). On that
 * hardware sharp / libvips can briefly stall the event loop past
 * 90s under concurrent loads, so Vercel's polling watchdog kept
 * declaring legitimately-running jobs dead.
 *
 * The default is now 240s (4 minutes) — still tight enough to catch
 * a truly killed container but generous enough to survive Render's
 * starter-tier CPU starvation and one or two libvips stalls.
 *
 * Operators on a stronger plan or a different runtime can override
 * via `HEARTBEAT_GAP_SECONDS` (e.g. set to "60" on Railway / Fly to
 * keep tighter detection).
 */
const HEARTBEAT_GAP_DEFAULT_MS = 240_000;
export const HEARTBEAT_GAP_MS = (() => {
  const raw = process.env.HEARTBEAT_GAP_SECONDS;
  if (!raw) return HEARTBEAT_GAP_DEFAULT_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n * 1_000 : HEARTBEAT_GAP_DEFAULT_MS;
})();

/**
 * Separate, longer threshold for jobs running on the dedicated
 * Render backend. The Render wrapper now uses a worker-thread
 * heartbeat (heartbeatWorker.cjs) that pulses every 12s
 * regardless of the main thread's state — so a Render-backed job
 * silent for 6 minutes really IS dead, not just CPU-starved.
 *
 * Override via RENDER_BACKEND_HEARTBEAT_GAP_SECONDS. Defaults to
 * 360s = 6 min, comfortably above the 12s pulse interval × any
 * realistic transient pg / network hiccup.
 */
const RENDER_BACKEND_GAP_DEFAULT_MS = 360_000;
export const RENDER_BACKEND_HEARTBEAT_GAP_MS = (() => {
  const raw = process.env.RENDER_BACKEND_HEARTBEAT_GAP_SECONDS;
  if (!raw) return RENDER_BACKEND_GAP_DEFAULT_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n * 1_000 : RENDER_BACKEND_GAP_DEFAULT_MS;
})();
export const RUNNING_GRACE_MS   = 60_000;     // cold-start headroom
export const HARD_CEILING_MS    = 900_000;    // 15-min absolute runtime cap
/** Extra grace for a PENDING job that hasn't hit its first `mark_running`
 *  write yet. Covers: (a) initial Vercel cold-start + `unstable_after`
 *  schedule, (b) MAX_RESUME_ATTEMPTS × RESUME_AFTER_MS worth of poller
 *  recovery attempts, each with its own cold-start budget. Widened
 *  from 2× HEARTBEAT_GAP_MS (180s) after production showed legit
 *  cold-start-heavy deploys tripping the watchdog before resume had a
 *  fair chance. 4× gives a ~6-minute window which matches the "Your
 *  server is provisioning" expectation during a first-request cold
 *  boot. */
export const NEVER_STARTED_CUSHION_MS = HEARTBEAT_GAP_MS * 4;

// Per-asset rough budget the inline pipeline needs. Assumed to be
// sequential-ish: 12s per asset + 30s pipeline warmup. The concurrent
// execution in inlineGenerate.ts tightens this in practice, but we
// keep the sequential estimate as the patience budget so even a
// slow-path job gets a fair shake.
export const PER_ASSET_MS       = 12_000;
export const PIPELINE_WARMUP_MS = 30_000;
export const MIN_EXPECTED_MS    = 90_000;     // 1½ min floor
export const MAX_EXPECTED_MS    = 540_000;    // 9 min ceiling

export type StaleReason =
  | "no_heartbeat"       // Running job whose container died.
  | "runtime_ceiling"    // Heartbeating but wedged past the 15-min cap.
  | "no_progress_total"; // Never-started job that sat silent past expected.

export interface JobLikeForStale {
  status?:    string | null;
  createdAt?: Date | string | null;
  startedAt?: Date | string | null;
  updatedAt?: Date | string | null;
  payload?:   unknown;
}

export interface StaleVerdict {
  stale:          boolean;
  reason:         StaleReason | null;
  /** Diagnostic values for logging / response enrichment. */
  heartbeatGapMs: number;
  runningMs:      number;
  expectedMs:     number;
  /** Human-readable sentence for `result.error` when `stale === true`. */
  message:        string | null;
}

/** Per-job patience budget from the payload's formats × variations.
 *  Clamped so degenerate payloads (missing / zero / absurd values)
 *  still produce a sane window. */
export function computeExpectedDurationMs(payload: unknown): number {
  const p          = (payload ?? {}) as Record<string, unknown>;
  const formatsArr = Array.isArray(p.formats) ? (p.formats as unknown[]) : [];
  const formatN    = Math.max(1, formatsArr.length);
  const varN       = Math.max(1, Number(p.variations ?? 1) || 1);
  const total      = formatN * varN;
  const raw        = total * PER_ASSET_MS + PIPELINE_WARMUP_MS;
  return Math.min(MAX_EXPECTED_MS, Math.max(MIN_EXPECTED_MS, raw));
}

/** Decide whether the job should be flipped to FAILED. Pure function —
 *  no DB access, no side effects. Callers (route handler, list
 *  endpoint) own the actual update.
 *
 *  When `opts.gapMs` is supplied the caller's value overrides the
 *  module-level HEARTBEAT_GAP_MS for this single check — used to
 *  give Render-backed jobs the longer 6-minute window via
 *  RENDER_BACKEND_HEARTBEAT_GAP_MS while keeping the default for
 *  in-process Vercel jobs at 4 min. */
export function evaluateStale(
  job: JobLikeForStale,
  opts?: { gapMs?: number },
): StaleVerdict {
  const gapMs = opts?.gapMs ?? HEARTBEAT_GAP_MS;
  const now = Date.now();
  const updatedMs = job.updatedAt ? new Date(job.updatedAt).getTime() : now;
  const createdMs = job.createdAt ? new Date(job.createdAt).getTime() : now;
  const startedMs = job.startedAt ? new Date(job.startedAt).getTime() : null;

  const heartbeatGapMs = Math.max(0, now - updatedMs);
  const runningMs      = startedMs ? Math.max(0, now - startedMs) : 0;
  const expectedMs     = computeExpectedDurationMs(job.payload);

  const base: StaleVerdict = {
    stale: false, reason: null,
    heartbeatGapMs, runningMs, expectedMs,
    message: null,
  };

  // Only PENDING/RUNNING jobs are candidates.
  if (job.status !== "PENDING" && job.status !== "RUNNING") return base;

  // 1. Hard ceiling — wedged with heartbeats still firing.
  if (runningMs > HARD_CEILING_MS) {
    return {
      ...base,
      stale: true, reason: "runtime_ceiling",
      message: `Generation exceeded the ${Math.round(HARD_CEILING_MS / 60_000)}-minute hard ceiling (${Math.round(runningMs / 1000)}s elapsed). The pipeline is likely deadlocked. Please retry.`,
    };
  }

  // 2. Fresh heartbeat = alive. Most common healthy path — cheap bail.
  if (heartbeatGapMs < gapMs) return base;

  // 3. Running with a dead container — past cold-start grace.
  if (startedMs && runningMs > RUNNING_GRACE_MS) {
    return {
      ...base,
      stale: true, reason: "no_heartbeat",
      message: `Generation stalled — no worker heartbeat for ${Math.round(heartbeatGapMs / 1000)}s (gap threshold ${Math.round(gapMs / 1000)}s). The worker was likely killed mid-render. Please retry.`,
    };
  }

  // 4. Never-started job still silent past its expected duration.
  //    The poller resume path (which fires every ~20s once a job is
  //    older than RESUME_AFTER_MS) handles most of these, but when
  //    resume itself exhausts MAX_RESUME_ATTEMPTS we still want a
  //    terminal FAILED so the UI can render the retry button.
  //    Empirically the old `× 2` cushion was tripping on legit
  //    cold-start-heavy Vercel deploys before resume had a fair
  //    chance — see NEVER_STARTED_CUSHION_MS above.
  const totalAgeMs = Math.max(0, now - createdMs);
  if (!startedMs && totalAgeMs > expectedMs + NEVER_STARTED_CUSHION_MS) {
    return {
      ...base,
      stale: true, reason: "no_progress_total",
      message: `Generation never started within ${Math.round(totalAgeMs / 1000)}s (expected ~${Math.round(expectedMs / 1000)}s). Please retry.`,
    };
  }

  return base;
}
