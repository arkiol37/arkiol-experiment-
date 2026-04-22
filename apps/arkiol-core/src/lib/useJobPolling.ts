"use client";
// src/lib/useJobPolling.ts
//
// React hook wrapping the pure polling state machine in jobPollState.ts.
// This is the single source of truth for the client-side polling loop
// — every generation-style UI (GeneratePanel, EditorShell,
// AnimationStudioView, GifStudioView) should route through this hook
// so the timeout + stale + retry behaviour stays consistent.
//
// What the hook owns:
//   • The setInterval loop (stopped automatically on terminal states
//     and on unmount — no leaked timers).
//   • Tracking `lastProgressAtMs` so deriveJobView can decide when to
//     flip into the "stale" warning state without the caller needing
//     to manage two refs.
//   • The retry dispatch — POST /api/jobs/<id>/retry — so the caller
//     just calls `view.retry()` from their button onClick.
//   • Safe unmount: aborts in-flight fetches + clears the interval.
//
// What the hook does NOT own:
//   • Initial job creation (POST /api/generate). Callers dispatch
//     generation themselves and then pass the returned jobId to
//     `start()`.
//   • Rendering. The hook just returns a JobPollView; UI is the
//     caller's problem.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  deriveJobView, POLL_INTERVAL_MS,
  type JobLikeForPoll, type JobPollView,
} from "./jobPollState";

export interface UseJobPollingResult extends JobPollView {
  jobId: string | null;
  /** Begin observing a job. Safe to call repeatedly with the same id
   *  (it's a no-op after the first call); switching to a new id resets
   *  all timings. */
  start: (jobId: string) => void;
  /** Explicit retry. Hits /api/jobs/<id>/retry and, on success,
   *  restarts the polling loop. No-op when there's no active job or
   *  when one is already in flight. */
  retry: () => Promise<void>;
  /** Clear the interval + forget the current job. Callers typically
   *  use this when the user closes the modal. */
  stop: () => void;
  /** True while a retry POST is in flight. UI uses this to disable the
   *  Retry button so double-clicks don't stack retries. */
  isRetrying: boolean;
}

const EMPTY_VIEW: JobPollView = {
  state:             "queued",
  progress:          0,
  shouldStopPolling: false,
  silentForMs:       0,
  hardAbandoned:     false,
  errorTitle:        null,
  errorMessage:      null,
  retryable:         false,
  failReason:        null,
  attempts:          0,
  maxAttempts:       3,
  assetCount:        0,
};

export function useJobPolling(): UseJobPollingResult {
  const [jobId,      setJobId]      = useState<string | null>(null);
  const [view,       setView]       = useState<JobPollView>(EMPTY_VIEW);
  const [isRetrying, setIsRetrying] = useState(false);

  // Refs (not state) because the interval closure reads them every
  // tick — state would trigger re-renders we don't need.
  const intervalRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const firstSeenRef   = useRef<number>(0);
  const lastProgressRef = useRef<number>(0);
  const lastProgressValueRef = useRef<number>(-1);
  const abortRef       = useRef<AbortController | null>(null);
  // Track the currently-polled job in a ref so the tick closure reads
  // the live value instead of a stale captured one.
  const jobIdRef       = useRef<string | null>(null);

  const clearLoop = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  }, []);

  const tick = useCallback(async () => {
    const id = jobIdRef.current;
    if (!id) return;
    try {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      const res = await fetch(`/api/jobs?id=${encodeURIComponent(id)}`, { signal: ac.signal });
      if (!res.ok) return; // transient — next tick retries
      const data = await res.json().catch(() => ({}));
      const job: JobLikeForPoll | null = data?.jobs?.[0] ?? data?.job ?? null;
      if (!job) return;

      // Only bump lastProgressAtMs when progress ACTUALLY advances.
      // A stuck-at-5% row keeps silentForMs climbing until it trips
      // the client-stale threshold.
      const p = Number(job.progress ?? 0);
      if (p > lastProgressValueRef.current) {
        lastProgressValueRef.current = p;
        lastProgressRef.current      = Date.now();
      }

      const next = deriveJobView(job, {
        firstSeenAtMs:    firstSeenRef.current,
        lastProgressAtMs: lastProgressRef.current,
        nowMs:            Date.now(),
      });
      setView(next);

      if (next.shouldStopPolling) clearLoop();
    } catch (err: any) {
      // AbortError on unmount / new start — swallow silently.
      if (err?.name === "AbortError") return;
    }
  }, [clearLoop]);

  const start = useCallback((id: string) => {
    if (jobIdRef.current === id && intervalRef.current) return;
    clearLoop();
    jobIdRef.current            = id;
    firstSeenRef.current        = Date.now();
    lastProgressRef.current     = Date.now();
    lastProgressValueRef.current = -1;
    setJobId(id);
    setView({ ...EMPTY_VIEW });
    // Fire immediately so the UI doesn't sit on "queued" for a full
    // POLL_INTERVAL_MS before the first fetch.
    void tick();
    intervalRef.current = setInterval(() => { void tick(); }, POLL_INTERVAL_MS);
  }, [clearLoop, tick]);

  const stop = useCallback(() => {
    clearLoop();
    jobIdRef.current = null;
    setJobId(null);
    setView({ ...EMPTY_VIEW });
  }, [clearLoop]);

  const retry = useCallback(async () => {
    const id = jobIdRef.current;
    if (!id || isRetrying) return;
    setIsRetrying(true);
    try {
      const res = await fetch(`/api/jobs/${encodeURIComponent(id)}/retry`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Surface the backend's rejection as a failed state so the
        // user sees why (attempts exhausted, not retryable, etc.)
        // instead of a silent spinner.
        setView(v => ({
          ...v,
          state:             "failed",
          shouldStopPolling: true,
          errorTitle:        "Retry rejected",
          errorMessage:      data?.error ?? "This job can't be retried.",
          retryable:         false,
        }));
        return;
      }
      // Reset timings so the stale detector gives the retried attempt
      // a full fresh window.
      firstSeenRef.current        = Date.now();
      lastProgressRef.current     = Date.now();
      lastProgressValueRef.current = -1;
      setView(v => ({ ...v, state: "retrying", shouldStopPolling: false, errorTitle: null, errorMessage: null }));
      // Re-arm the interval in case it was cleared by the previous
      // terminal state.
      if (!intervalRef.current) {
        intervalRef.current = setInterval(() => { void tick(); }, POLL_INTERVAL_MS);
      }
      void tick();
    } finally {
      setIsRetrying(false);
    }
  }, [isRetrying, tick]);

  // Always clear on unmount so we never leak a timer + fetch pair
  // into a background tab.
  useEffect(() => () => clearLoop(), [clearLoop]);

  return { ...view, jobId, start, retry, stop, isRetrying };
}
