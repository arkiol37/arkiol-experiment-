// src/lib/jobPollState.ts
//
// Client-side job polling state machine.
//
// The production failure this module exists to prevent:
//
//   A user clicks Generate. The backend kicks off inline generation but
//   the serverless function dies before writing RUNNING. The frontend
//   polls /api/jobs?id=<jobId> every 1.5s and sees PENDING, PENDING,
//   PENDING… forever. No feedback, no way out, no retry button. 30
//   minutes later the user reloads and finds their credits gone for a
//   job that never ran.
//
// Even with the backend-side poller resume (Step 3), stale watchdog
// (Step 4), and retry path (Step 5) in place, the client UI was still
// binary — "spinner" or "done/error" — with no intermediate state when
// things were taking longer than usual. This module upgrades the UI to
// a six-state machine so every second of a slow render has a clear
// visual story:
//
//   queued   — backend says PENDING, startedAt is null
//   running  — backend says RUNNING (or PENDING with progress > 0)
//   stale    — we've been polling for CLIENT_STALE_MS with no progress
//              delta; backend hasn't written FAILED yet but we surface
//              a "taking longer than usual" banner so the UI isn't
//              mute
//   retrying — backend just flipped FAILED→PENDING through the retry
//              endpoint (result.retried === true)
//   failed   — terminal; show the error + Retry button if retryable
//   completed — terminal; hand off to the success path
//
// The machine is a pure function so it's trivially testable from
// source — no DOM, no timers. The React wrapper in useJobPolling.ts
// supplies the interval + tracks `lastProgressAtMs`.

/** Polling cadence for /api/jobs?id=<jobId>. Matches the backend
 *  heartbeat interval (PULSE_INTERVAL_MS=10s in inlineGenerate) divided
 *  by ~6 so the UI updates fluidly without hammering the DB. */
export const POLL_INTERVAL_MS = 1_500;

/** How long we wait for any progress change before surfacing the
 *  "stale" warning. Tuned slightly above the backend's HEARTBEAT_GAP_MS
 *  (90s) so by the time we show the warning, the backend watchdog is
 *  already about to flip the row to FAILED — i.e. the warning almost
 *  always precedes a real failed-with-retry UI by a few seconds. */
export const CLIENT_STALE_MS = 120_000;

/** Hard abandon: at this elapsed time we stop polling entirely and
 *  lock the UI into an "abandoned" state that forces the user to
 *  retry or reload. Matches the backend's HARD_CEILING_MS so there's
 *  no scenario where the backend is still legitimately running but
 *  the UI has given up. */
export const HARD_ABANDON_MS = 900_000;

export type JobPollState =
  | "queued"     // PENDING, not yet started
  | "running"    // actively working
  | "stale"      // still polling but no progress delta for CLIENT_STALE_MS
  | "retrying"   // just transitioned back to PENDING via the retry path
  | "failed"     // terminal — FAILED on the server
  | "completed"; // terminal — COMPLETED / SUCCEEDED on the server

export interface JobLikeForPoll {
  status?:      string | null;
  progress?:    number | null;
  attempts?:    number | null;
  maxAttempts?: number | null;
  startedAt?:   string | Date | null;
  result?: {
    // Success
    assetCount?: number;
    // Failure (enriched by /api/jobs)
    title?:      string;
    message?:    string;
    error?:      string;
    failReason?: string;
    retryable?:  boolean;
    // Retry marker — written by prepareRetry on the FAILED→PENDING claim
    retried?:       boolean;
    retryFromReason?: string | null;
    previousAttempts?: number;
  } | null;
}

export interface JobPollTimings {
  /** When the client first began observing this job, NOT job.createdAt
   *  (the server clock and the client clock may drift). */
  firstSeenAtMs:     number;
  /** Most recent client-local timestamp at which we saw a progress
   *  delta. Initialised to firstSeenAtMs. */
  lastProgressAtMs:  number;
  /** Typically Date.now(). Kept as a parameter so tests can pass a
   *  fixed clock. */
  nowMs:             number;
}

export interface JobPollView {
  state:         JobPollState;
  progress:      number;
  /** Whether the caller should clearInterval — true for terminal
   *  states and for hard-abandoned jobs that exceeded
   *  HARD_ABANDON_MS. */
  shouldStopPolling: boolean;
  /** Milliseconds since the last progress delta — drives the
   *  "Taking longer than usual — Xm Ys since last update" banner. */
  silentForMs:   number;
  /** Whether enough time has passed since firstSeenAtMs that we should
   *  give up on polling even if the backend hasn't written a terminal
   *  row yet. */
  hardAbandoned: boolean;

  // ── Failure surface (populated on state === "failed") ──────────
  errorTitle:   string | null;
  errorMessage: string | null;
  retryable:    boolean;
  failReason:   string | null;

  // ── Attempt accounting ─────────────────────────────────────────
  attempts:     number;
  maxAttempts:  number;

  // ── Completion surface (populated on state === "completed") ───
  assetCount:   number;
}

/** Pure per-tick view derivation. Tests cover every branch by feeding
 *  a hand-rolled JobLikeForPoll + timings pair. */
export function deriveJobView(
  job:      JobLikeForPoll | null | undefined,
  timings:  JobPollTimings,
): JobPollView {
  const progress      = Math.max(0, Math.min(100, Number(job?.progress ?? 0)));
  const silentForMs   = Math.max(0, timings.nowMs - timings.lastProgressAtMs);
  const observedForMs = Math.max(0, timings.nowMs - timings.firstSeenAtMs);
  const hardAbandoned = observedForMs > HARD_ABANDON_MS;

  const attempts    = Math.max(0, Number(job?.attempts ?? 0));
  const maxAttempts = Math.max(1, Number(job?.maxAttempts ?? 3));
  const result      = job?.result ?? null;

  const base = {
    progress, silentForMs, hardAbandoned,
    errorTitle:   null as string | null,
    errorMessage: null as string | null,
    retryable:    false,
    failReason:   null as string | null,
    attempts, maxAttempts,
    assetCount:   Math.max(0, Number(result?.assetCount ?? 0)),
  };

  // Terminal: COMPLETED / SUCCEEDED. Stop polling unconditionally.
  if (job?.status === "COMPLETED" || job?.status === "SUCCEEDED") {
    return {
      ...base,
      state: "completed",
      shouldStopPolling: true,
      progress: 100,
    };
  }

  // Terminal: FAILED. Stop polling. Surface the enriched error
  // metadata from /api/jobs (title + message + retryable were written
  // server-side by formatJobError). Fall back to defaults if this is
  // an older row.
  if (job?.status === "FAILED") {
    return {
      ...base,
      state: "failed",
      shouldStopPolling: true,
      errorTitle:   (result?.title   ?? "Generation failed") || "Generation failed",
      errorMessage: (result?.message ?? result?.error ?? "Something went wrong.") || "Something went wrong.",
      retryable:    !!result?.retryable,
      failReason:   result?.failReason ?? null,
    };
  }

  // Hard-abandoned: the backend never wrote a terminal row and we've
  // been polling past HARD_ABANDON_MS. Lock the UI into an
  // "abandoned" variant of failed so the user gets a retry button
  // instead of a silent spinner.
  if (hardAbandoned) {
    return {
      ...base,
      state: "failed",
      shouldStopPolling: true,
      errorTitle:   "Still waiting on a response",
      errorMessage: `We haven't received an update in ${Math.round(observedForMs / 60_000)} minutes. Please retry.`,
      retryable:    true,
      failReason:   "client_abandoned",
    };
  }

  // Retry-in-flight: prepareRetry writes result.retried=true on the
  // FAILED→PENDING claim. The poller then picks the row back up and
  // marks it RUNNING. This branch catches the transient moment before
  // that happens so the UI can say "Retrying…" instead of flashing
  // back to "Queued".
  if (job?.status === "PENDING" && result?.retried === true) {
    return { ...base, state: "retrying", shouldStopPolling: false };
  }

  // Client-side stale: backend hasn't written FAILED yet, but no
  // progress delta for CLIENT_STALE_MS. Surface a warning state —
  // we KEEP polling (backend watchdog will flip to FAILED any moment).
  if (silentForMs > CLIENT_STALE_MS) {
    return { ...base, state: "stale", shouldStopPolling: false };
  }

  // Active RUNNING, or PENDING-with-progress (the inline pipeline
  // bumps progress to 2 before flipping to RUNNING).
  if (job?.status === "RUNNING" || progress > 0) {
    return { ...base, state: "running", shouldStopPolling: false };
  }

  // Default: queued (PENDING, no progress yet).
  return { ...base, state: "queued", shouldStopPolling: false };
}

/** Human-readable "still waiting" banner copy. Pulled out so the tests
 *  can pin the mm:ss formatting contract that the UI depends on. */
export function formatSilentDuration(silentForMs: number): string {
  const secs = Math.max(0, Math.floor(silentForMs / 1000));
  const m    = Math.floor(secs / 60);
  const s    = secs % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}
